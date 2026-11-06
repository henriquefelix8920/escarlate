import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function config() {
  const rawBase = process.env.SCRAPER_SERVICE_URL || '';
  const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const token = process.env.SCRAPER_API_TOKEN;
  if (!base || !token) throw new Error('Serviço de captura ainda não configurado no Vercel.');
  return { base, token };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`O serviço de captura retornou uma resposta vazia (HTTP ${response.status}). Tente novamente em instantes.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`O serviço de captura retornou uma resposta inválida (HTTP ${response.status}). Tente novamente em instantes.`);
  }
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
    const payload = await readJsonResponse(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível iniciar a pesquisa.' }, { status: 503 });
  }
}
