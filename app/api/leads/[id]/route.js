import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const allowed = ['status', 'notes', 'name', 'phone', 'email', 'website', 'instagram'];
    const update = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nenhum campo válido para atualizar.' }, { status: 400 });
    if (update.status && !['new','contacted','interested','proposal','won','lost'].includes(update.status)) return NextResponse.json({ error: 'Etapa comercial inválida.' }, { status: 400 });
    update.updated_at = new Date().toISOString();
    const { data, error } = await getSupabaseAdmin().from('leads').update(update).eq('id', params.id).select().single();
    if (error) throw error;
    return NextResponse.json({ lead: data });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao atualizar lead.' }, { status: 503 });
  }
}
