import asyncio
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client
from playwright.async_api import async_playwright

app = FastAPI(title="Escarlate Capture API", version="1.0.0")

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
    limit: int = Field(default=10, ge=1, le=50)
    channel: Literal['whatsapp', 'instagram'] = 'whatsapp'

def is_instagram_url(value: str) -> bool:
    from urllib.parse import urlparse
    try:
        host = (urlparse(value if value.startswith(('http://', 'https://')) else 'https://' + value).hostname or '').lower()
        return host == 'instagram.com' or host.endswith('.instagram.com')
    except Exception:
        return False


def normalize_instagram_profile_url(value: str) -> str:
    from urllib.parse import parse_qs, unquote, urlparse
    raw = (value or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else "https://" + raw)
    if parsed.hostname and parsed.hostname.lower().endswith("google.com"):
        params = parse_qs(parsed.query)
        raw = unquote((params.get("q") or params.get("url") or [""])[0])
        parsed = urlparse(raw if "://" in raw else "https://" + raw)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host != "instagram.com" and not host.endswith(".instagram.com"):
        return ""
    parts = [part for part in parsed.path.split("/") if part]
    if not parts or parts[0].lower() in {"p", "reel", "reels", "stories", "explore", "accounts", "direct"}:
        return ""
    if len(parts) > 1:
        return ""
    username = re.sub(r"[^A-Za-z0-9._]", "", parts[0]).strip(".")
    return f"https://www.instagram.com/{username}/" if username else ""


async def find_public_instagram_profile(page, name: str, city: str, category: str) -> str:
    """Best-effort lookup of a public, indexed Instagram profile; always requires human review."""
    query = f'site:instagram.com/ "{name}" "{city}" "{category}" -inurl:/p/ -inurl:/reel/ -inurl:/stories/'
    await page.goto("https://www.google.com/search?q=" + quote(query), wait_until="domcontentloaded", timeout=25000)
    await page.wait_for_timeout(500)
    anchors = await page.locator('a[href*="instagram.com"]').all()
    name_tokens = [
        token.lower() for token in re.findall(r"[A-Za-zÀ-ÿ]{3,}", name)
        if token.lower() not in {"nutricionista", "nutricionistas", "clinica", "clínica", "consultorio", "consultório"}
    ]
    for anchor in anchors[:30]:
        href = await anchor.get_attribute("href") or ""
        profile = normalize_instagram_profile_url(href)
        if not profile:
            continue
        try:
            result_text = await anchor.evaluate(
                "el => (el.closest('div.MjjYud') || el.parentElement?.parentElement || el).innerText || ''"
            )
        except Exception:
            result_text = await anchor.inner_text()
        normalized_text = re.sub(r"\\s+", " ", result_text or "").lower()
        if name_tokens and not any(token in normalized_text for token in name_tokens):
            continue
        return profile
    return ""


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
        result = client.table("search_jobs").select("*").eq("id", job_id).maybe_single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Search not found")
        current = result.data
        if current.get("status") in {"completed", "failed", "cancelled"}:
            return current
        client.table("search_jobs").update({"status": "cancelling"}).eq("id", job_id).execute()
        return {**current, "status": "cancelling", "message": "Interrupção solicitada. A captura será encerrada com segurança."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not cancel search: {str(exc)[:180]}")

@app.get("/api/jobs/active", dependencies=[Depends(require_token)])
def get_active_job():
    try:
        result = db().table("search_jobs").select("*").in_("status", ["queued", "running", "cancelling"]).order("created_at", desc=True).limit(1).execute()
        return result.data[0] if result.data else {}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not read active search: {str(exc)[:180]}")

@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
def get_job(job_id: str):
    try:
        result = db().table("search_jobs").select("*").eq("id", job_id).maybe_single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Search not found")
        return result.data
    except HTTPException:
        raise
    except Exception as exc:
        # Preserve the exact database/API failure in Render logs for diagnosis.
        print(f"Falha ao consultar pesquisa {job_id}: {type(exc).__name__}: {str(exc)[:500]}", flush=True)
        raise HTTPException(status_code=503, detail=f"Could not read search ({type(exc).__name__}): {str(exc)[:180]}")

class SearchCancelled(Exception):
    pass

async def run_search(job_id: str, data: SearchRequest):
    client = db()
    browser = None
    progress = {
        "version": 1, "phase": "starting", "detail": "Preparando a pesquisa…",
        "scanned": 0, "candidates": 0, "with_website": 0,
        "with_instagram": 0, "duplicates": 0, "errors": 0, "saved": 0,
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
        result = client.table("search_jobs").select("status").eq("id", job_id).maybe_single().execute()
        if result.data and result.data.get("status") in {"cancelling", "cancelled"}:
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
            page = await browser.new_page(locale="pt-BR", viewport={"width": 1280, "height": 720})

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
            for scroll_number in range(8):
                check_cancelled()
                anchors = await page.locator('a[href*="/maps/place/"]').all()
                for anchor in anchors:
                    href = await anchor.get_attribute("href")
                    if href:
                        links.add(href)
                if len(links) >= data.limit * 3:
                    break
                await feed.evaluate("el => el.scrollBy(0, Math.max(el.scrollHeight, 700))")
                await page.wait_for_timeout(1000)
                report_progress(
                    phase="collecting",
                    detail=f"Encontrando empresas no Google Maps (varredura {scroll_number + 1}/8)…",
                    candidates=len(links),
                )

            found = 0
            report_progress(
                phase="analyzing",
                detail=f"{len(links)} empresas encontradas. Analisando cada uma…",
                candidates=len(links),
            )
            for maps_url in list(links):
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

                    instagram_url = ""
                    if data.channel == "instagram":
                        if is_instagram_url(website):
                            instagram_url = normalize_instagram_profile_url(website)
                            if not instagram_url:
                                progress["scanned"] += 1
                                report_progress(detail=f"Analisando: {name[:70]} — o link do Instagram não parece ser um perfil.")
                                continue
                        elif website.strip():
                            progress["with_website"] += 1
                            progress["scanned"] += 1
                            report_progress(detail=f"Analisando: {name[:70]} — descartada porque informa um site próprio.")
                            continue
                        else:
                            report_progress(detail=f"Analisando: {name[:70]} — sem site no Maps; procurando Instagram público…")
                            try:
                                instagram_url = await find_public_instagram_profile(page, name, data.city, data.category)
                            except Exception as lookup_exc:
                                print(f"Busca pública de Instagram falhou para {name[:70]}: {type(lookup_exc).__name__}: {str(lookup_exc)[:180]}", flush=True)
                            if not instagram_url:
                                progress["scanned"] += 1
                                report_progress(detail=f"Analisando: {name[:70]} — não foi possível confirmar um perfil público de Instagram.")
                                continue
                        progress["with_instagram"] += 1
                    elif website.strip():
                        progress["with_website"] += 1
                        progress["scanned"] += 1
                        report_progress(detail=f"Analisando: {name[:70]} — descartada porque já tem site próprio.")
                        continue

                    normalized = digits(phone)
                    row = {
                        "name": name[:200], "category": data.category,
                        "phone": phone or None, "phone_normalized": normalized or None,
                        "website": None, "instagram": instagram_url or None, "address": address or None,
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
            detail="Pesquisa concluída. Confira o resumo da coleta abaixo.",
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
        if browser:
            try:
                await browser.close()
            except Exception:
                pass


class InstagramSearchRequest(BaseModel):
    city: str = Field(min_length=2, max_length=100)
    category: str = Field(default="nutricionista", min_length=2, max_length=100)
    limit: int = Field(default=20, ge=1, le=50)


@app.post("/api/instagram-search", dependencies=[Depends(require_token)])
async def start_instagram_search(data: InstagramSearchRequest, background: BackgroundTasks):
    job_id = str(uuid.uuid4())
    row = {"id": job_id, "term": data.category, "city": data.city, "status": "queued", "requested_limit": data.limit, "found_count": 0}
    try:
        db().table("search_jobs").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not create Instagram search job: {str(exc)[:180]}")
    background.add_task(run_instagram_search, job_id, data)
    return {"id": job_id, "status": "queued"}


async def run_instagram_search(job_id: str, data: InstagramSearchRequest):
    client = db()
    browser = None
    progress = {"version": 1, "phase": "starting", "detail": "Preparando a busca de nutricionistas…", "scanned": 0, "candidates": 0, "with_instagram": 0, "duplicates": 0, "errors": 0, "saved": 0}

    def update_job(**values):
        client.table("search_jobs").update(values).eq("id", job_id).execute()

    def report_progress(phase=None, detail=None, **counts):
        if phase is not None: progress["phase"] = phase
        if detail is not None: progress["detail"] = detail
        progress.update(counts)
        update_job(found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False))

    def check_cancelled():
        result = client.table("search_jobs").select("status").eq("id", job_id).maybe_single().execute()
        if result.data and result.data.get("status") in {"cancelling", "cancelled"}:
            update_job(status="cancelled", finished_at=datetime.now(timezone.utc).isoformat())
            raise SearchCancelled()

    try:
        check_cancelled()
        update_job(status="running")
        report_progress(phase="opening_maps", detail="Abrindo o Google Maps para localizar nutricionistas…")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-default-apps", "--no-zygote", "--renderer-process-limit=1"])
            page = await browser.new_page(locale="pt-BR", viewport={"width": 1280, "height": 720})
            async def block_heavy_resources(route):
                if route.request.resource_type in {"image", "media", "font"}: await route.abort()
                else: await route.continue_()
            await page.route("**/*", block_heavy_resources)
            target = "https://www.google.com/maps/search/" + quote(f"{data.category} em {data.city}")
            await page.goto(target, wait_until="domcontentloaded", timeout=60000)
            check_cancelled()
            report_progress(phase="collecting", detail="Localizando nutricionistas no Google Maps…")
            try: await page.locator('div[role="feed"]').wait_for(timeout=25000)
            except Exception: raise RuntimeError("Google Maps não apresentou a lista. Pode haver CAPTCHA, bloqueio ou ausência de resultados.")
            feed = page.locator('div[role="feed"]')
            links = set()
            for scroll_number in range(10):
                check_cancelled()
                for anchor in await page.locator('a[href*="/maps/place/"]').all():
                    href = await anchor.get_attribute("href")
                    if href: links.add(href)
                if len(links) >= data.limit * 4: break
                await feed.evaluate("el => el.scrollBy(0, Math.max(el.scrollHeight, 700))")
                await page.wait_for_timeout(900)
                report_progress(phase="collecting", detail=f"Encontrando nutricionistas (varredura {scroll_number + 1}/10)…", candidates=len(links))
            report_progress(phase="analyzing", detail=f"{len(links)} estabelecimentos encontrados. Verificando quais divulgam Instagram…", candidates=len(links))
            for maps_url in list(links):
                check_cancelled()
                if progress["saved"] >= data.limit: break
                try:
                    await page.goto(maps_url, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(700)
                    check_cancelled()
                    title = page.locator("h1").first
                    name = (await title.inner_text()).strip() if await title.count() else ""
                    if not name:
                        progress["scanned"] += 1
                        report_progress(detail="Analisando os estabelecimentos encontrados…")
                        continue
                    address = ""
                    address_el = page.locator('button[data-item-id="address"]').first
                    if await address_el.count():
                        value = (await address_el.get_attribute("aria-label")) or (await address_el.inner_text())
                        address = value.replace("Endereço:", "").strip()
                    website_el = page.locator('a[data-item-id="authority"]').first
                    website = (await website_el.get_attribute("href") or "") if await website_el.count() else ""
                    if not is_instagram_url(website):
                        progress["scanned"] += 1
                        report_progress(detail=f"Analisando {name[:65]} — sem link direto do Instagram no Maps.")
                        continue
                    from urllib.parse import urlparse
                    parsed = urlparse(website if website.startswith(("http://", "https://")) else "https://" + website)
                    username = (parsed.path.strip("/").split("/")[0] if parsed.path.strip("/") else "").replace("@", "")
                    if not username or username.lower() in {"p", "reel", "stories", "explore"}:
                        progress["scanned"] += 1
                        continue
                    instagram_url = f"https://www.instagram.com/{username}/"
                    existing = client.table("instagram_prospects").select("id").ilike("instagram_url", instagram_url).limit(1).execute()
                    if existing.data:
                        progress["duplicates"] += 1
                        progress["scanned"] += 1
                        report_progress(detail=f"{name[:65]} — perfil já está no Radar.")
                        continue
                    row = {
                        "name": name[:180], "username": username[:80], "instagram_url": instagram_url,
                        "city": data.city, "maps_website": website[:500],
                        "opportunity_reason": "O Google Maps informa o Instagram como site do estabelecimento; não foi identificado um site próprio nesse campo.",
                        "notes": f"Encontrado automaticamente em uma busca por {data.category} em {data.city}. Confira a bio e valide se existe site próprio antes de abordar.",
                        "source": "google_maps_instagram_discovery", "status": "new",
                    }
                    try: client.table("instagram_prospects").insert(row).execute()
                    except Exception as insert_exc:
                        if "duplicate" in str(insert_exc).lower() or "23505" in str(insert_exc):
                            progress["duplicates"] += 1
                            progress["scanned"] += 1
                            continue
                        raise
                    progress["with_instagram"] += 1
                    progress["saved"] += 1
                    progress["scanned"] += 1
                    report_progress(detail=f"Adicionado ao Radar: {name[:65]} (@{username}).")
                except SearchCancelled: raise
                except Exception as exc:
                    progress["errors"] += 1
                    progress["scanned"] += 1
                    print(f"Erro na descoberta Instagram {job_id}: {type(exc).__name__}: {str(exc)[:250]}", flush=True)
                    report_progress(detail="Um resultado apresentou erro; a busca continuou.")
            check_cancelled()
        report_progress(phase="completed", detail=f"Busca concluída: {progress['saved']} perfis adicionados ao Radar. Revise cada perfil antes de abordar.")
        update_job(status="completed", found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False), finished_at=datetime.now(timezone.utc).isoformat())
    except SearchCancelled: return
    except Exception as exc:
        try: check_cancelled()
        except SearchCancelled: return
        progress["phase"] = "failed"
        progress["detail"] = "A busca foi interrompida por um erro."
        try: update_job(status="failed", found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False), error=str(exc)[:500], finished_at=datetime.now(timezone.utc).isoformat())
        except Exception as update_exc: print(f"Falha ao registrar erro da busca Instagram {job_id}: {update_exc}", flush=True)
    finally:
        if browser:
            try: await browser.close()
            except Exception: pass
