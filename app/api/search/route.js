import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function config() {
  const base = process.env.SCRAPER_SERVICE_URL?.replace(/\\/$/, '');
  const token = process.env.SCRAPER_API_TOKEN;
  if (!base || !token) throw new Error('Serviço de captura ainda não configurado no Vercel.');
  return { base, token };
}

export async function POST(request) {
  try {
    const { base, token } = config();
    const body = await request.json();
    const response = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível iniciar a pesquisa.' }, { status: 503 });
  }
}
