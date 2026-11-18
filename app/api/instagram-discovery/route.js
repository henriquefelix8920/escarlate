import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const rawBase = process.env.SCRAPER_SERVICE_URL || '';
    const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
    const token = process.env.SCRAPER_API_TOKEN;
    if (!base || !token) throw new Error('Serviço de captura ainda não configurado no Vercel.');
    const body = await request.json();
    const response = await fetch(base + '/api/instagram-discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body), cache: 'no-store',
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('O serviço de captura retornou uma resposta inválida.'); }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível iniciar a descoberta automática.' }, { status: 503 });
  }
}
