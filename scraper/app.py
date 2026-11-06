import asyncio
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client
from playwright.async_api import async_playwright

app = FastAPI(title="Escarlate Capture API", version="1.0.0")

# Keep only one Chromium session active on the 512 MiB Render instance.
SEARCH_LOCK = asyncio.Lock()

def db() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Supabase environment is not configured")
    return create_client(url, key)

def require_token(authorization: str | None = Header(default=None)):
    expected = os.environ.get("SCRAPER_API_TOKEN", "")
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not expected or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")

class SearchRequest(BaseModel):
    city: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=100)
    limit: int = Field(default=20, ge=1, le=200)

def digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/search", dependencies=[Depends(require_token)])
async def start_search(data: SearchRequest, background: BackgroundTasks):
    job_id = str(uuid.uuid4())
    row = {"id": job_id, "term": data.category, "city": data.city, "status": "queued", "requested_limit": data.limit, "found_count": 0}
    try:
        db().table("search_jobs").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not create search job: {str(exc)[:180]}")
    background.add_task(run_search, job_id, data)
    return {"id": job_id, "status": "queued"}

@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
def cancel_job(job_id: str):
    try:
        client = db()
        result = client.table("search_jobs").select("*").eq("id", job_id).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Search not found")
        current = result.data[0]
        if current.get("status") in {"completed", "failed", "cancelled"}:
            return current
        client.table("search_jobs").update({"status": "cancelling"}).eq("id", job_id).execute()
        return {**current, "status": "cancelling", "message": "Interrupção solicitada. A captura será encerrada com segurança."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not cancel search: {str(exc)[:180]}")

@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
def get_job(job_id: str):
    try:
        result = db().table("search_jobs").select("*").eq("id", job_id).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Search not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        # Preserve the exact database/API failure in Render logs for diagnosis.
        print(f"Falha ao consultar pesquisa {job_id}: {type(exc).__name__}: {str(exc)[:500]}", flush=True)
        raise HTTPException(status_code=503, detail=f"Could not read search ({type(exc).__name__}): {str(exc)[:180]}")

class SearchCancelled(Exception):
    pass

async def run_search(job_id: str, data: SearchRequest):
    async with SEARCH_LOCK:
        await _run_search(job_id, data)


async def _run_search(job_id: str, data: SearchRequest):
    client = db()
    browser = None
    browser_context = None
    progress = {
        "version": 1, "phase": "starting", "detail": "Preparando a pesquisa…",
        "scanned": 0, "candidates": 0, "with_website": 0,
        "duplicates": 0, "errors": 0, "saved": 0,
        "batch": 0, "total_batches": 0,
    }

    def update_job(**values):
        client.table("search_jobs").update(values).eq("id", job_id).execute()

    def report_progress(phase=None, detail=None, **counts):
        if phase is not None:
            progress["phase"] = phase
        if detail is not None:
            progress["detail"] = detail
        progress.update(counts)
        update_job(found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False))

    def check_cancelled():
        result = client.table("search_jobs").select("status").eq("id", job_id).limit(1).execute()
        if result.data and result.data[0].get("status") in {"cancelling", "cancelled"}:
            update_job(status="cancelled", finished_at=datetime.now(timezone.utc).isoformat())
            raise SearchCancelled()

    try:
        check_cancelled()
        update_job(status="running")
        report_progress(phase="opening_maps", detail="Abrindo o Google Maps…")
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                    "--disable-background-networking",
                    "--disable-default-apps",
                    "--no-zygote",
                    "--renderer-process-limit=1",
                ],
            )
            browser_context = await browser.new_context(
                locale="pt-BR", viewport={"width": 960, "height": 640},
                device_scale_factor=1, service_workers="block",
            )
            page = await browser_context.new_page()

            async def block_heavy_resources(route):
                if route.request.resource_type in {"image", "media", "font"}:
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", block_heavy_resources)
            check_cancelled()
            target = "https://www.google.com/maps/search/" + quote(f"{data.category} em {data.city}")
            await page.goto(target, wait_until="domcontentloaded", timeout=60000)
            check_cancelled()
            report_progress(phase="collecting", detail="Localizando empresas no Google Maps…")
            try:
                await page.locator('div[role="feed"]').wait_for(timeout=25000)
            except Exception:
                check_cancelled()
                raise RuntimeError("Google Maps não apresentou a lista. Pode haver CAPTCHA, bloqueio ou ausência de resultados.")
            feed = page.locator('div[role="feed"]')
            links = set()
            # Collect up to 200 Maps listings, scrolling in small increments.
            # The cap protects the free 512 MiB worker while allowing multiple batches.
            candidate_limit = 200
            stagnant_scrolls = 0
            scroll_number = 0
            while len(links) < candidate_limit and stagnant_scrolls < 4 and scroll_number < 40:
                check_cancelled()
                before = len(links)
                # Read hrefs in one browser-side operation; avoid one Playwright handle per anchor.
                hrefs = await page.locator('a[href*="/maps/place/"]').evaluate_all(
                    "(elements) => elements.map((element) => element.href).filter(Boolean)"
                )
                links.update(hrefs)
                if len(links) >= candidate_limit:
                    break
                stagnant_scrolls = stagnant_scrolls + 1 if len(links) == before else 0
                scroll_number += 1
                await feed.evaluate("el => el.scrollBy(0, Math.max(el.scrollHeight, 700))")
                await page.wait_for_timeout(1000)
                report_progress(
                    phase="collecting",
                    detail=f"Encontrando empresas no Google Maps — {len(links)} de até {candidate_limit}…",
                    candidates=len(links),
                )

            found = 0
            candidates = list(links)[:candidate_limit]
            total_batches = (len(candidates) + 19) // 20
            report_progress(
                phase="analyzing",
                detail=f"{len(candidates)} empresas encontradas. Iniciando análise em lotes de até 20…",
                candidates=len(candidates),
                total_batches=total_batches,
            )
            for batch_index in range(total_batches):
                batch = candidates[batch_index * 20:(batch_index + 1) * 20]
                report_progress(
                    phase="analyzing",
                    detail=f"Analisando lote {batch_index + 1} de {total_batches} ({len(batch)} empresas)…",
                    batch=batch_index + 1,
                    total_batches=total_batches,
                )
                for maps_url in batch:
                    check_cancelled()
                    if found >= data.limit:
                        break
                try:
                    await page.goto(maps_url, wait_until="domcontentloaded", timeout=30000)
                    check_cancelled()
                    await page.wait_for_timeout(800)
                    check_cancelled()
                    title = page.locator("h1").first
                    name = (await title.inner_text()).strip() if await title.count() else ""
                    if not name:
                        progress["scanned"] += 1
                        report_progress(detail="Analisando empresas encontradas…")
                        continue
                    address = phone = website = ""
                    for selector, field in [
                        ('button[data-item-id="address"]', "address"),
                        ('button[data-item-id^="phone:"]', "phone"),
                        ('a[data-item-id="authority"]', "website"),
                    ]:
                        element = page.locator(selector).first
                        if await element.count():
                            value = (await element.get_attribute("aria-label")) or (await element.inner_text())
                            if field == "address":
                                address = value.replace("Endereço:", "").strip()
                            elif field == "phone":
                                phone = value.replace("Telefone:", "").strip()
                            else:
                                website = await element.get_attribute("href") or ""

                    if website.strip():
                        progress["with_website"] += 1
                        progress["scanned"] += 1
                        report_progress(detail=f"Analisando: {name[:70]} — descartada porque já tem site.")
                        continue

                    normalized = digits(phone)
                    row = {
                        "name": name[:200], "category": data.category,
                        "phone": phone or None, "phone_normalized": normalized or None,
                        "website": None, "address": address or None,
                        "city": data.city, "google_maps_url": maps_url,
                        "source": "google_maps", "search_term": f"{data.category} em {data.city}",
                        "status": "new",
                    }
                    existing = client.table("leads").select("id").eq("google_maps_url", maps_url).limit(1).execute()
                    if existing.data:
                        progress["duplicates"] += 1
                        progress["scanned"] += 1
                        report_progress(detail=f"Analisando: {name[:70]} — empresa já cadastrada.")
                        continue
                    if normalized:
                        by_phone = client.table("leads").select("id").eq("phone_normalized", normalized).limit(1).execute()
                        if by_phone.data:
                            progress["duplicates"] += 1
                            progress["scanned"] += 1
                            report_progress(detail=f"Analisando: {name[:70]} — telefone já cadastrado.")
                            continue
                        by_raw_phone = client.table("leads").select("id").eq("phone", phone).limit(1).execute()
                        if by_raw_phone.data:
                            progress["duplicates"] += 1
                            progress["scanned"] += 1
                            report_progress(detail=f"Analisando: {name[:70]} — telefone já cadastrado.")
                            continue

                    check_cancelled()
                    client.table("leads").insert(row).execute()
                    found += 1
                    progress["saved"] = found
                    progress["scanned"] += 1
                    report_progress(detail=f"Lead salvo: {name[:70]}.")
                except SearchCancelled:
                    raise
                except Exception as exc:
                    progress["errors"] += 1
                    progress["scanned"] += 1
                    print(f"Erro ao analisar empresa no job {job_id}: {type(exc).__name__}: {str(exc)[:300]}", flush=True)
                    report_progress(detail="Uma empresa apresentou erro; a pesquisa continuou com as próximas.")
            check_cancelled()
        report_progress(
            phase="completed",
            detail=f"Pesquisa concluída após {progress.get('batch', 0)} lote(s). Confira o resumo abaixo.",
        )
        update_job(status="completed", found_count=found, message=json.dumps(progress, ensure_ascii=False), finished_at=datetime.now(timezone.utc).isoformat())
    except SearchCancelled:
        return
    except Exception as exc:
        try:
            check_cancelled()
        except SearchCancelled:
            return
        progress["phase"] = "failed"
        progress["detail"] = "A pesquisa foi interrompida por um erro. Consulte a mensagem de erro."
        try:
            update_job(status="failed", found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False), error=str(exc)[:500], finished_at=datetime.now(timezone.utc).isoformat())
        except Exception as update_exc:
            print(f"Falha ao registrar erro do job {job_id}: {update_exc}", flush=True)
    finally:
        if browser_context:
            try:
                await browser_context.close()
            except Exception:
                pass
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
