import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const status = searchParams.get('status');
    let query = getSupabaseAdmin().from('leads').select('*').order('created_at', { ascending: false }).limit(500);
    if (status && status !== 'all') query = query.eq('status', status);
    if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,city.ilike.%${q}%,category.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ leads: data || [] });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao consultar leads.' }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const items = Array.isArray(body) ? body : [body];
    if (!items.length || items.length > 500) return NextResponse.json({ error: 'Envie entre 1 e 500 leads por vez.' }, { status: 400 });
    const rows = items.map((item) => ({
      name: String(item.name || item.nome || 'Lead sem nome').trim().slice(0, 200),
      phone: item.phone || item.telefone || null,
      phone_normalized: item.phone_normalized || item.phoneKey || null,
      email: item.email || null, category: item.category || item.categoria || null,
      address: item.address || item.endereco || null, city: item.city || null,
      website: item.website || item.site || null, instagram: item.instagram || null,
      profile: item.profile || null, google_maps_url: item.google_maps_url || item.mapsUrl || null,
      source: item.source || 'csv', search_term: item.search_term || null,
      status: item.status || 'new', notes: item.notes || item.note || '',
    }));
    const db = getSupabaseAdmin();
    const inserted = [];
    let duplicates = 0;
    for (const row of rows) {
      const { data, error } = await db.from('leads').insert(row).select().single();
      if (error?.code === '23505') { duplicates++; continue; }
      if (error) throw error;
      inserted.push(data);
    }
    return NextResponse.json({ inserted: inserted.length, duplicates, leads: inserted }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao salvar leads.' }, { status: 503 });
  }
}
