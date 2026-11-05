import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(_request, { params }) {
  try {
    const rawBase = process.env.SCRAPER_SERVICE_URL || '';\n    const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
    const token = process.env.SCRAPER_API_TOKEN;
    if (!base || !token) throw new Error('Serviço de captura ainda não configurado no Vercel.');
    const response = await fetch(`${base}/api/jobs/${encodeURIComponent(params.id)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível consultar a pesquisa.' }, { status: 503 });
  }
}
