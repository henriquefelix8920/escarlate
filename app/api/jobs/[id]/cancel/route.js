import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(_request, { params }) {
  try {
    const rawBase = process.env.SCRAPER_SERVICE_URL || '';
    const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
    const token = process.env.SCRAPER_API_TOKEN;
    if (!base || !token) throw new Error('Serviço de captura ainda não configurado no Vercel.');
    const response = await fetch(base + '/api/jobs/' + encodeURIComponent(params.id) + '/cancel', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
    });
    const text = await response.text();
    if (!text.trim()) throw new Error('O serviço de captura retornou uma resposta vazia (HTTP ' + response.status + ').');
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error('O serviço de captura retornou uma resposta inválida (HTTP ' + response.status + ').'); }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível interromper a pesquisa.' }, { status: 503 });
  }
}
