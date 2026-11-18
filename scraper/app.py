import asyncio
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import parse_qs, quote, unquote, urlparse

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client
from playwright.async_api import async_playwright

app = FastAPI(title="Escarlate Capture API", version="1.0.0")

# Keep only one Chromium session active on the 512 MiB Render instance.
SEARCH_LOCK = asyncio.Lock()
ACTIVE_JOBS = set()

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
    limit: int = Field(default=20, ge=1, le=100)
    channel: Literal['whatsapp', 'instagram'] = 'whatsapp'


def normalize_instagram_profile_url(value: str) -> str:
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
    if not parts or parts[0].lower() in {"p", "reel", "reels", "stories", "explore", "accounts", "direct"} or len(parts) > 1:
        return ""
    username = re.sub(r"[^A-Za-z0-9._]", "", parts[0]).strip(".")
    return f"https://www.instagram.com/{username}/" if username else ""


async def find_public_instagram_profile(page, name: str, city: str, category: str) -> str:
    """Find a likely public Instagram profile using progressively broader public Google queries."""
    clean_name = re.sub(r"\\s+", " ", (name or "").strip())
    clean_city = re.sub(r"\\s+", " ", (city or "").strip())
    name_tokens = [
        token.lower() for token in re.findall(r"[A-Za-zÀ-ÿ]{3,}", clean_name)
        if token.lower() not in {
            "nutricionista", "nutricionistas", "clinica", "clínica",
            "consultorio", "consultório", "profissional", "servicos", "serviços",
        }
    ]
    if not clean_name:
        return ""

    queries = [
        f'site:instagram.com/ "{clean_name}" "{clean_city}" -inurl:/p/ -inurl:/reel/ -inurl:/stories/',
        f'site:instagram.com/ "{clean_name}" -inurl:/p/ -inurl:/reel/ -inurl:/stories/',
    ]
    if name_tokens:
        queries.append(
            f'site:instagram.com/ "{name_tokens[0]}" "{clean_city}" -inurl:/p/ -inurl:/reel/ -inurl:/stories/'
        )

    seen = set()
    for query in queries:
        try:
            await page.goto(
                "https://www.google.com/search?q=" + quote(query),
                wait_until="domcontentloaded",
                timeout=25000,
            )
            await page.wait_for_timeout(700)
            anchors = await page.locator('a[href*="instagram.com"]').all()
        except Exception as exc:
            print(f"Google não retornou resultados para {clean_name[:60]}: {type(exc).__name__}", flush=True)
            continue

        for anchor in anchors[:40]:
            href = await anchor.get_attribute("href") or ""
            profile = normalize_instagram_profile_url(href)
            if not profile or profile in seen:
                continue
            seen.add(profile)
            username = urlparse(profile).path.strip("/").lower()
            try:
                result_text = await anchor.evaluate(
                    "el => (el.closest('div.MjjYud') || el.parentElement?.parentElement || el).innerText || ''"
                )
            except Exception:
                try:
                    result_text = await anchor.inner_text()
                except Exception:
                    result_text = ""
            evidence = (result_text + " " + username).lower()
            # A candidate must have at least one distinctive part of the business/person name.
            if name_tokens and not any(token in evidence for token in name_tokens):
                continue
            return profile
    return ""


def digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")

SOCIAL_HOSTS = {
    "instagram.com": "instagram",
    "facebook.com": "facebook", "fb.com": "facebook",
    "tiktok.com": "tiktok",
    "linkedin.com": "linkedin",
    "youtube.com": "youtube", "youtu.be": "youtube",
    "x.com": "x", "twitter.com": "x",
    "threads.net": "threads",
    "twitch.tv": "twitch", "discord.com": "discord", "discord.gg": "discord",
    "reddit.com": "reddit", "tumblr.com": "tumblr", "medium.com": "medium",
    "bsky.app": "bluesky", "mastodon.social": "mastodon", "vimeo.com": "vimeo",
    "soundcloud.com": "soundcloud", "t.me": "telegram", "telegram.org": "telegram",
    "pinterest.com": "pinterest",
    "snapchat.com": "snapchat",
    "kwai.com": "kwai",
    "whatsapp.com": "whatsapp", "wa.me": "whatsapp",
    "linktr.ee": "social", "beacons.ai": "social",
    "bio.site": "social", "solo.to": "social",
    "msha.ke": "social", "campsite.bio": "social",
}

def classify_social_url(value: str) -> tuple[str | None, str | None]:
    """Return (network, url) for social profiles; unknown domains are business websites."""
    raw = (value or "").strip()
    if not raw:
        return None, None
    candidate = raw if "://" in raw else "https://" + raw
    parsed = urlparse(candidate)
    if parsed.hostname and parsed.hostname.lower().endswith("google.com"):
        wrapped = parse_qs(parsed.query)
        destination = (wrapped.get("q") or wrapped.get("url") or [None])[0]
        if destination:
            raw = unquote(destination)
            candidate = raw if "://" in raw else "https://" + raw
            parsed = urlparse(candidate)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    for domain, network in SOCIAL_HOSTS.items():
        if host == domain or host.endswith("." + domain):
            return network, raw
    return None, None


@app.get("/health")
def health():
    return {"ok": True}


@app.on_event("startup")
async def recover_interrupted_jobs():
    # Recupera no máximo uma pesquisa válida. Pesquisas antigas deixadas como
    # running por reinicializações/OOM não podem bloquear a prospecção para sempre.
    try:
        client = db()
        result = client.table("search_jobs").select("*").in_(
            "status", ["queued", "running", "retry_wait", "cancelling"]
        ).order("created_at", desc=True).limit(100).execute()
        now = datetime.now(timezone.utc)
        recovered = False

        def age_seconds(value):
            if not value:
                return None
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return max(0, (now - parsed.astimezone(timezone.utc)).total_seconds())
            except (TypeError, ValueError):
                return None

        for row in result.data or []:
            job_id = row["id"]
            status = row.get("status")
            created_age = age_seconds(row.get("created_at"))
            heartbeat_age = age_seconds(row.get("last_heartbeat_at"))

            if status == "cancelling":
                client.table("search_jobs").update({
                    "status": "cancelled",
                    "finished_at": now.isoformat(),
                    "error": None,
                }).eq("id", job_id).execute()
                continue

            stale = (
                (status == "running" and (
                    # Uma busca nunca deve ser retomada depois de ficar aberta por mais
                    # de uma hora, mesmo que um processo antigo tenha atualizado o heartbeat.
                    created_age is None or created_age > 3600
                    or heartbeat_age is None and created_age > 180
                    or heartbeat_age is not None and heartbeat_age > 180
                ))
                or (status == "queued" and created_age is not None and created_age > 600)
                or (status == "retry_wait" and created_age is not None and created_age > 900)
            )
            if stale:
                client.table("search_jobs").update({
                    "status": "failed",
                    "finished_at": now.isoformat(),
                    "error": "Pesquisa encerrada após reinicialização: o processo anterior não retomou a atividade.",
                }).eq("id", job_id).execute()
                continue

            if not recovered:
                try:
                    saved_message = json.loads(row.get("message") or "{}")
                except Exception:
                    saved_message = {}
                if saved_message.get("kind") == "instagram_discovery":
                    discovery_data = InstagramDiscoveryRequest(
                        region=saved_message.get("region") or row.get("city") or "Brasil",
                        category=saved_message.get("category") or "nutricionista",
                        limit=row.get("requested_limit") or 25,
                    )
                    asyncio.create_task(run_instagram_discovery(job_id, discovery_data))
                else:
                    data = SearchRequest(
                        city=row["city"], category=row["term"], limit=row["requested_limit"],
                        channel=saved_message.get("channel", "whatsapp")
                    )
                    asyncio.create_task(run_search(job_id, data))
                recovered = True
            else:
                # O Escarlate executa uma busca global por vez. Evita enfileirar
                # várias pesquisas antigas que ficariam parecendo uma busca atual.
                client.table("search_jobs").update({
                    "status": "failed",
                    "finished_at": now.isoformat(),
                    "error": "Pesquisa encerrada porque havia outra pesquisa mais recente em recuperação.",
                }).eq("id", job_id).execute()
    except Exception as exc:
        print(f"Falha ao recuperar pesquisas pendentes: {type(exc).__name__}: {str(exc)[:300]}", flush=True)

@app.post("/api/search", dependencies=[Depends(require_token)])
async def start_search(data: SearchRequest, background: BackgroundTasks):
    job_id = str(uuid.uuid4())
    row = {"id": job_id, "term": data.category, "city": data.city, "status": "queued", "requested_limit": data.limit, "found_count": 0, "message": json.dumps({"channel": data.channel})}
    try:
        client = db()
        active = client.table("search_jobs").select("*").in_(
            "status", ["queued", "running", "retry_wait", "cancelling"]
        ).order("created_at", desc=True).limit(1).execute()
        if active.data:
            # Pesquisas são globais: um segundo aparelho acompanha a ativa em vez de iniciar outra.
            return active.data[0]
        client.table("search_jobs").insert(row).execute()
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
        # Sem tarefa ativa neste processo, não existe worker que possa confirmar
        # o cancelamento. Finaliza o job órfão imediatamente para não travar o CRM.
        active_in_process = job_id in ACTIVE_JOBS
        next_status = "cancelling" if active_in_process else "cancelled"
        finished_at = None if active_in_process else datetime.now(timezone.utc).isoformat()
        client.table("search_jobs").update({
            "status": next_status,
            "finished_at": finished_at,
        }).eq("id", job_id).execute()
        return {
            **current,
            "status": next_status,
            "finished_at": finished_at,
            "message": (
                "Interrupção solicitada. A captura será encerrada com segurança."
                if active_in_process else
                "Pesquisa interrompida. Não havia um processo ativo para continuar esta tarefa."
            ),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not cancel search: {str(exc)[:180]}")

@app.get("/api/jobs/active", dependencies=[Depends(require_token)])
def get_active_job():
    try:
        client = db()
        active = client.table("search_jobs").select("*").in_(
            "status", ["queued", "running", "retry_wait", "cancelling"]
        ).order("created_at", desc=True).limit(1).execute()
        if active.data:
            return active.data[0]
        latest = client.table("search_jobs").select("*").order(
            "created_at", desc=True
        ).limit(1).execute()
        return latest.data[0] if latest.data else {"status": "idle"}
    except Exception as exc:
        print(f"Falha ao consultar pesquisa ativa: {type(exc).__name__}: {str(exc)[:400]}", flush=True)
        raise HTTPException(status_code=503, detail=f"Could not read active search: {str(exc)[:180]}")

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
    if job_id in ACTIVE_JOBS:
        return
    ACTIVE_JOBS.add(job_id)
    try:
        async with SEARCH_LOCK:
            await _run_search(job_id, data)
    finally:
        ACTIVE_JOBS.discard(job_id)


async def retry_search_later(job_id: str, data: SearchRequest, delay: int):
    await asyncio.sleep(delay)
    await run_search(job_id, data)


async def _run_search(job_id: str, data: SearchRequest):
    client = db()
    browser = None
    browser_context = None
    job_result = client.table("search_jobs").select("*").eq("id", job_id).limit(1).execute()
    job_row = job_result.data[0] if job_result.data else {}
    try:
        progress = json.loads(job_row.get("message") or "{}")
        if not isinstance(progress, dict):
            progress = {}
        elif progress.get("version") != 1:
            progress = {"channel": progress.get("channel", "whatsapp")}
    except Exception:
        progress = {}
    progress = {
        "version": 1, "phase": "starting", "detail": "Preparando a pesquisa…",
        "scanned": 0, "candidates": 0, "with_website": 0, "with_social": 0, "with_instagram": 0,
        "duplicates": 0, "errors": 0, "saved": int(job_row.get("found_count") or 0),
        "batch": 0, "total_batches": 0, **progress,
    }
    found = int(job_row.get("found_count") or 0)
    candidates = job_row.get("candidates") or []
    next_candidate_index = int(job_row.get("next_candidate_index") or 0)

    def update_job(**values):
        client.table("search_jobs").update(values).eq("id", job_id).execute()

    def report_progress(phase=None, detail=None, **counts):
        if phase is not None:
            progress["phase"] = phase
        if detail is not None:
            progress["detail"] = detail
        progress.update(counts)
        update_job(
            found_count=progress["saved"],
            message=json.dumps(progress, ensure_ascii=False),
            last_heartbeat_at=datetime.now(timezone.utc).isoformat(),
        )

    def check_cancelled():
        result = client.table("search_jobs").select("status").eq("id", job_id).limit(1).execute()
        if result.data and result.data[0].get("status") in {"cancelling", "cancelled"}:
            update_job(status="cancelled", finished_at=datetime.now(timezone.utc).isoformat())
            raise SearchCancelled()

    try:
        check_cancelled()
        # Não sobrescreve um cancelamento que chegou entre a primeira checagem
        # e esta atualização de status.
        client.table("search_jobs").update({
            "status": "running",
            "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).in_("status", ["queued", "running", "retry_wait"]).execute()
        check_cancelled()
        report_progress(phase="opening_maps" if not candidates else "resuming",
                        detail="Abrindo o Google Maps…" if not candidates else f"Retomando do registro {next_candidate_index + 1}…")
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
            if not candidates:
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
                # Collect up to 100 Maps listings, scrolling in small increments.
                # The cap protects the free 512 MiB worker while allowing multiple batches.
                candidate_limit = 100
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
    
    
                candidates = list(links)[:candidate_limit]
                update_job(candidates=candidates, next_candidate_index=0,
                           last_heartbeat_at=datetime.now(timezone.utc).isoformat())
            else:
                report_progress(phase="resuming",
                                detail=f"Retomando análise de {len(candidates)} empresas salvas…",
                                candidates=len(candidates))
            total_batches = (len(candidates) + 19) // 20
            report_progress(
                phase="analyzing",
                detail=f"{len(candidates)} empresas encontradas. Iniciando análise em lotes de até 20…",
                candidates=len(candidates),
                total_batches=total_batches,
            )
            for batch_index in range(next_candidate_index // 20, total_batches):
                batch_start = max(batch_index * 20, next_candidate_index)
                batch = candidates[batch_start:(batch_index + 1) * 20]
                report_progress(
                    phase="analyzing",
                    detail=f"Analisando lote {batch_index + 1} de {total_batches} ({len(batch)} empresas)…",
                    batch=batch_index + 1,
                    total_batches=total_batches,
                )
                for local_index, maps_url in enumerate(batch):
                    candidate_index = batch_start + local_index
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
    
                        social_network, social_url = classify_social_url(website)
                        if data.channel == "instagram" and social_network != "instagram":
                            if website.strip() and not social_network:
                                progress["with_website"] += 1
                                progress["scanned"] += 1
                                report_progress(detail=f"Analisando: {name[:70]} — descartada porque já tem site próprio.")
                                continue
                            report_progress(detail=f"Analisando: {name[:70]} — sem Instagram no Maps; procurando perfil público…")
                            try:
                                public_profile = await find_public_instagram_profile(page, name, data.city, data.category)
                            except Exception as lookup_exc:
                                public_profile = ""
                                print(f"Busca pública de Instagram falhou para {name[:70]}: {type(lookup_exc).__name__}: {str(lookup_exc)[:180]}", flush=True)
                            if not public_profile:
                                progress["scanned"] += 1
                                report_progress(detail=f"Analisando: {name[:70]} — nenhum perfil público correspondente foi encontrado.")
                                continue
                            social_network, social_url = "instagram", public_profile
                        elif data.channel == "instagram":
                            social_url = normalize_instagram_profile_url(social_url or website)
                            if not social_url:
                                progress["scanned"] += 1
                                report_progress(detail=f"Analisando: {name[:70]} — link do Instagram não corresponde a um perfil.")
                                continue

                        if social_network:
                            progress["with_social"] += 1
                        if social_network == "instagram":
                            progress["with_instagram"] += 1

                        normalized = digits(phone)
                        row = {
                            "name": name[:200], "category": data.category,
                            "phone": phone or None, "phone_normalized": normalized or None,
                            "website": None, "instagram": social_url if social_network == "instagram" else None,
                            "profile": social_url if social_network and social_network != "instagram" else None,
                            "address": address or None,
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
                    finally:
                        # Checkpoint após cada empresa; se o processo cair no meio,
                        # a próxima execução repete apenas esta empresa.
                        update_job(next_candidate_index=candidate_index + 1,
                                   last_heartbeat_at=datetime.now(timezone.utc).isoformat())
                check_cancelled()
                if batch_index + 1 < total_batches:
                    await page.wait_for_timeout(1500)
        report_progress(
            phase="completed",
            detail=f"Pesquisa concluída após {progress.get('batch', 0)} lote(s). Confira o resumo abaixo.",
        )
        update_job(status="completed", found_count=found, message=json.dumps(progress, ensure_ascii=False), error=None, finished_at=datetime.now(timezone.utc).isoformat())
    except SearchCancelled:
        return
    except Exception as exc:
        try:
            check_cancelled()
        except SearchCancelled:
            return
        attempt_count = int(job_row.get("attempt_count") or 0) + 1
        retryable = attempt_count <= 3
        progress["phase"] = "retry_wait" if retryable else "failed"
        progress["detail"] = ("Falha temporária. A pesquisa será retomada automaticamente." if retryable
                              else "A pesquisa atingiu o limite de tentativas. Consulte o erro.")
        try:
            update_job(status="retry_wait" if retryable else "failed",
                       attempt_count=attempt_count, found_count=progress["saved"],
                       message=json.dumps(progress, ensure_ascii=False),
                       error=str(exc)[:500],
                       finished_at=None if retryable else datetime.now(timezone.utc).isoformat())
            if retryable:
                delay = min(30 * (2 ** (attempt_count - 1)), 300)
                asyncio.create_task(retry_search_later(job_id, data, delay))
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


class InstagramDiscoveryRequest(BaseModel):
    region: str = Field(default="Brasil", min_length=2, max_length=100)
    category: str = Field(default="nutricionista", min_length=2, max_length=100)
    limit: int = Field(default=25, ge=1, le=50)


@app.post("/api/instagram-discovery", dependencies=[Depends(require_token)])
async def start_instagram_discovery(data: InstagramDiscoveryRequest, background: BackgroundTasks):
    client = db()
    active = client.table("search_jobs").select("*").in_("status", ["queued", "running", "retry_wait", "cancelling"]).order("created_at", desc=True).limit(1).execute()
    if active.data:
        return active.data[0]
    job_id = str(uuid.uuid4())
    client.table("search_jobs").insert({
        "id": job_id, "term": f"Instagram: {data.category}", "city": data.region,
        "status": "queued", "requested_limit": data.limit, "found_count": 0,
        "message": json.dumps({"kind": "instagram_discovery", "region": data.region, "category": data.category}, ensure_ascii=False),
    }).execute()
    background.add_task(run_instagram_discovery, job_id, data)
    return {"id": job_id, "status": "queued"}


async def _run_instagram_discovery(job_id: str, data: InstagramDiscoveryRequest):
    client = db()
    browser = None
    progress = {"version": 1, "phase": "starting", "detail": "Preparando descoberta de perfis públicos indexados…", "scanned": 0, "candidates": 0, "duplicates": 0, "errors": 0, "saved": 0}
    def update_job(**values):
        client.table("search_jobs").update(values).eq("id", job_id).execute()
    def report(phase=None, detail=None, **counts):
        if phase: progress["phase"] = phase
        if detail: progress["detail"] = detail
        progress.update(counts)
        update_job(found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False), last_heartbeat_at=datetime.now(timezone.utc).isoformat())
    def check_cancelled():
        row = client.table("search_jobs").select("status").eq("id", job_id).limit(1).execute()
        if row.data and row.data[0].get("status") in {"cancelling", "cancelled"}:
            update_job(status="cancelled", finished_at=datetime.now(timezone.utc).isoformat())
            raise SearchCancelled()
    try:
        check_cancelled()
        update_job(status="running", last_heartbeat_at=datetime.now(timezone.utc).isoformat())
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--no-zygote", "--renderer-process-limit=1"])
            page = await browser.new_page(locale="pt-BR", viewport={"width": 1280, "height": 800})
            async def block_heavy(route):
                if route.request.resource_type in {"image", "media", "font"}:
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", block_heavy)
            query = f'site:instagram.com/ "{data.category}" "{data.region}" -inurl:/p/ -inurl:/reel/ -inurl:/stories/'
            target = "https://www.google.com/search?q=" + quote(query) + "&num=50"
            report(phase="searching", detail=f"Pesquisando perfis públicos indexados para {data.category} — {data.region}…")
            await page.goto(target, wait_until="domcontentloaded", timeout=60000)
            check_cancelled()
            try:
                await page.locator("body").wait_for(timeout=10000)
            except Exception:
                raise RuntimeError("A pesquisa não retornou uma página utilizável.")
            results = await page.locator("a[href]").evaluate_all("""els => els.map(a => {
              const href = a.href || '';
              const box = a.closest('div.MjjYud') || a.parentElement?.parentElement;
              return {href, text: (box?.innerText || a.innerText || '').slice(0, 1200)};
            })""")
            found_urls = {}
            for item in results:
                href = item.get("href", "")
                try:
                    u = urlparse(href)
                    host = (u.hostname or "").lower().removeprefix("www.")
                    if host not in {"instagram.com", "m.instagram.com"}: continue
                    parts = [p for p in u.path.split("/") if p]
                    if not parts or parts[0].lower() in {"p","reel","reels","stories","explore","accounts","about","developer"}: continue
                    username = parts[0].lstrip("@")
                    if not re.fullmatch(r"[A-Za-z0-9._]{2,30}", username): continue
                    canonical = f"https://www.instagram.com/{username}/"
                    found_urls.setdefault(username.lower(), {"username": username, "url": canonical, "snippet": item.get("text","")})
                except Exception:
                    continue
            report(phase="analyzing", detail=f"{len(found_urls)} perfis candidatos encontrados no índice de pesquisa. Verificando duplicados…", candidates=len(found_urls))
            for candidate in list(found_urls.values()):
                check_cancelled()
                if progress["saved"] >= data.limit: break
                progress["scanned"] += 1
                username = candidate["username"]
                try:
                    existing = client.table("instagram_prospects").select("id").ilike("instagram_url", candidate["url"]).limit(1).execute()
                    if existing.data:
                        progress["duplicates"] += 1
                        report(detail=f"@{username} já está no Radar.")
                        continue
                    snippet = re.sub(r"\s+", " ", candidate["snippet"]).strip()[:1800]
                    row = {
                        "name": username.replace(".", " ").replace("_", " ").title()[:180],
                        "username": username[:80], "instagram_url": candidate["url"],
                        "city": data.region[:120],
                        "bio": snippet or None,
                        "opportunity_reason": "Perfil profissional candidato encontrado em resultados públicos indexados. A existência de site próprio e a correspondência com uma nutricionista ainda precisam ser validadas.",
                        "notes": f"Descoberto automaticamente por pesquisa pública: {query}. Confira o perfil, a bio e cruze o nome com o Google Maps antes de abordar.",
                        "source": "public_search_index",
                        "status": "new",
                    }
                    client.table("instagram_prospects").insert(row).execute()
                    progress["saved"] += 1
                    report(detail=f"Perfil candidato adicionado: @{username}.")
                except Exception as exc:
                    if "23505" in str(exc).lower() or "duplicate" in str(exc).lower():
                        progress["duplicates"] += 1
                    else:
                        progress["errors"] += 1
                        print(f"Instagram discovery {job_id}: {type(exc).__name__}: {str(exc)[:250]}", flush=True)
                    report(detail=f"Analisando perfis encontrados… ({progress['scanned']})")
            check_cancelled()
        report(phase="completed", detail=f"Descoberta concluída: {progress['saved']} perfis candidatos adicionados. Revise os perfis e confirme a especialidade e o site antes de abordar.")
        update_job(status="completed", found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False), finished_at=datetime.now(timezone.utc).isoformat())
    except SearchCancelled:
        return
    except Exception as exc:
        try: check_cancelled()
        except SearchCancelled: return
        progress["phase"] = "failed"
        progress["detail"] = "A descoberta foi interrompida por um erro."
        update_job(status="failed", found_count=progress["saved"], message=json.dumps(progress, ensure_ascii=False), error=str(exc)[:500], finished_at=datetime.now(timezone.utc).isoformat())
    finally:
        if browser:
            try: await browser.close()
            except Exception: pass


async def run_instagram_discovery(job_id: str, data: InstagramDiscoveryRequest):
    async with SEARCH_LOCK:
        await _run_instagram_discovery(job_id, data)


class InstagramSearchRequest(BaseModel):
    city: str = Field(min_length=2, max_length=100)
    category: str = Field(default="nutricionista", min_length=2, max_length=100)
    limit: int = Field(default=20, ge=1, le=50)


@app.post("/api/instagram-search", dependencies=[Depends(require_token)])
async def start_instagram_search(data: InstagramSearchRequest, background: BackgroundTasks):
    job_id = str(uuid.uuid4())
    row = {
        "id": job_id, "term": data.category, "city": data.city,
        "status": "queued", "requested_limit": data.limit, "found_count": 0,
    }
    try:
        db().table("search_jobs").insert(row).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not create Instagram search job: {str(exc)[:180]}")
    background.add_task(run_instagram_search, job_id, data)
    return {"id": job_id, "status": "queued"}


async def run_instagram_search(job_id: str, data: InstagramSearchRequest):
    client = db()
    browser = None
    progress = {
        "version": 1, "phase": "starting",
        "detail": "Preparando a busca de nutricionistas no Google Maps…",
        "scanned": 0, "candidates": 0, "with_instagram": 0,
        "duplicates": 0, "errors": 0, "saved": 0,
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
        report_progress(phase="opening_maps", detail="Abrindo o Google Maps para localizar nutricionistas…")
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                      "--disable-extensions", "--disable-background-networking",
                      "--disable-default-apps", "--no-zygote", "--renderer-process-limit=1"],
            )
            page = await browser.new_page(locale="pt-BR", viewport={"width": 1280, "height": 720})

            async def block_heavy_resources(route):
                if route.request.resource_type in {"image", "media", "font"}:
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", block_heavy_resources)
            target = "https://www.google.com/maps/search/" + quote(f"{data.category} em {data.city}")
            await page.goto(target, wait_until="domcontentloaded", timeout=60000)
            check_cancelled()
            report_progress(phase="collecting", detail="Localizando nutricionistas no Google Maps…")
            try:
                await page.locator('div[role="feed"]').wait_for(timeout=25000)
            except Exception:
                raise RuntimeError("Google Maps não apresentou a lista. Pode haver CAPTCHA, bloqueio ou ausência de resultados.")
            feed = page.locator('div[role="feed"]')
            links = set()
            for scroll_number in range(10):
                check_cancelled()
                anchors = await page.locator('a[href*="/maps/place/"]').all()
                for anchor in anchors:
                    href = await anchor.get_attribute("href")
                    if href:
                        links.add(href)
                if len(links) >= data.limit * 4:
                    break
                await feed.evaluate("el => el.scrollBy(0, Math.max(el.scrollHeight, 700))")
                await page.wait_for_timeout(900)
                report_progress(
                    phase="collecting",
                    detail=f"Encontrando nutricionistas (varredura {scroll_number + 1}/10)…",
                    candidates=len(links),
                )

            report_progress(
                phase="analyzing",
                detail=f"{len(links)} estabelecimentos encontrados. Verificando quais divulgam Instagram…",
                candidates=len(links),
            )
            for maps_url in list(links):
                check_cancelled()
                if progress["saved"] >= data.limit:
                    break
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
                    website = ""
                    address_el = page.locator('button[data-item-id="address"]').first
                    if await address_el.count():
                        value = (await address_el.get_attribute("aria-label")) or (await address_el.inner_text())
                        address = value.replace("Endereço:", "").strip()
                    website_el = page.locator('a[data-item-id="authority"]').first
                    if await website_el.count():
                        website = (await website_el.get_attribute("href")) or ""

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
                        "name": name[:180],
                        "username": username[:80],
                        "instagram_url": instagram_url,
                        "city": data.city,
                        "maps_website": website[:500],
                        "opportunity_reason": "O Google Maps informa o Instagram como site do estabelecimento; não foi identificado um site próprio nesse campo.",
                        "notes": f"Encontrado automaticamente em uma busca por {data.category} em {data.city}. Confira a bio e valide se existe site próprio antes de abordar.",
                        "source": "google_maps_instagram_discovery",
                        "status": "new",
                    }
                    try:
                        client.table("instagram_prospects").insert(row).execute()
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
                except SearchCancelled:
                    raise
                except Exception as exc:
                    progress["errors"] += 1
                    progress["scanned"] += 1
                    print(f"Erro na descoberta Instagram {job_id}: {type(exc).__name__}: {str(exc)[:250]}", flush=True)
                    report_progress(detail="Um resultado apresentou erro; a busca continuou.")

            check_cancelled()
        report_progress(
            phase="completed",
            detail=f"Busca concluída: {progress['saved']} perfis adicionados ao Radar. Revise cada perfil antes de abordar.",
        )
        update_job(
            status="completed", found_count=progress["saved"],
            message=json.dumps(progress, ensure_ascii=False),
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
    except SearchCancelled:
        return
    except Exception as exc:
        try:
            check_cancelled()
        except SearchCancelled:
            return
        progress["phase"] = "failed"
        progress["detail"] = "A busca foi interrompida por um erro."
        try:
            update_job(
                status="failed", found_count=progress["saved"],
                message=json.dumps(progress, ensure_ascii=False),
                error=str(exc)[:500], finished_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as update_exc:
            print(f"Falha ao registrar erro da busca Instagram {job_id}: {update_exc}", flush=True)
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
