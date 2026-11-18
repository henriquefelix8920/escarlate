import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const { data, error } = await getSupabaseAdmin().from('instagram_prospects').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return NextResponse.json({ prospects: data || [] });
  } catch (error) { return NextResponse.json({ error: error.message || 'Falha ao carregar o Radar Instagram.' }, { status: 503 }); }
}
export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body.name || '').trim().slice(0, 180);
    const instagramUrl = String(body.instagram_url || '').trim();
    if (!name) return NextResponse.json({ error: 'Informe o nome da profissional.' }, { status: 400 });
    let parsed;
    try { parsed = new URL(instagramUrl); } catch { return NextResponse.json({ error: 'Informe um link válido do Instagram.' }, { status: 400 }); }
    if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(parsed.hostname.toLowerCase())) return NextResponse.json({ error: 'O perfil precisa ser um endereço do Instagram.' }, { status: 400 });
    const username = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (!username || ['p', 'reel', 'stories', 'explore'].includes(username.toLowerCase())) return NextResponse.json({ error: 'Use o endereço do perfil, não de uma publicação.' }, { status: 400 });
    const row = { name, instagram_url: 'https://www.instagram.com/' + username.replace(/^@/, '') + '/', username: username.replace(/^@/, '').slice(0, 80), city: String(body.city || '').trim().slice(0, 120) || null, bio: String(body.bio || '').trim().slice(0, 2000) || null, website: String(body.website || '').trim().slice(0, 500) || null, maps_website: String(body.maps_website || '').trim().slice(0, 500) || null, opportunity_reason: String(body.opportunity_reason || '').trim().slice(0, 1000) || null, notes: String(body.notes || '').trim().slice(0, 2000), status: 'new', source: 'instagram_manual_review' };
    const { data, error } = await getSupabaseAdmin().from('instagram_prospects').insert(row).select().single();
    if (error?.code === '23505') return NextResponse.json({ error: 'Esse perfil já está cadastrado no Radar.' }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ prospect: data }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error.message || 'Não foi possível salvar o perfil.' }, { status: 503 }); }
}