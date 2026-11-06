import asyncio
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
    limit: int = Field(default=10, ge=1, le=15)

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
        raise HTTPException(status_code=503, detail=f"Could not read search: {str(exc)[:180]}")

class SearchCancelled(Exception):
    pass

async def run_search(job_id: str, data: SearchRequest):
    client = db()
    browser = None

    def update_job(**values):
        client.table("search_jobs").update(values).eq("id", job_id).execute()

    def check_cancelled():
        result = client.table("search_jobs").select("status").eq("id", job_id).maybe_single().execute()
        if result.data and result.data.get("status") in {"cancelling", "cancelled"}:
            update_job(status="cancelled", finished_at=datetime.now(timezone.utc).isoformat())
            raise SearchCancelled()

    try:
        check_cancelled()
        update_job(status="running")
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
            try:
                await page.locator('div[role="feed"]').wait_for(timeout=25000)
            except Exception:
                check_cancelled()
                raise RuntimeError("Google Maps não apresentou a lista. Pode haver CAPTCHA, bloqueio ou ausência de resultados.")
            feed = page.locator('div[role="feed"]')
            links = set()
            for _ in range(8):
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

            found = 0
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
                        continue
                    if normalized:
                        by_phone = client.table("leads").select("id").eq("phone_normalized", normalized).limit(1).execute()
                        if by_phone.data:
                            continue
                        by_raw_phone = client.table("leads").select("id").eq("phone", phone).limit(1).execute()
                        if by_raw_phone.data:
                            continue

                    check_cancelled()
                    client.table("leads").insert(row).execute()
                    found += 1
                    update_job(found_count=found)
                except SearchCancelled:
                    raise
                except Exception:
                    continue
            check_cancelled()
        update_job(status="completed", found_count=found, finished_at=datetime.now(timezone.utc).isoformat())
    except SearchCancelled:
        return
    except Exception as exc:
        try:
            check_cancelled()
        except SearchCancelled:
            return
        update_job(status="failed", error=str(exc)[:500], finished_at=datetime.now(timezone.utc).isoformat())
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
