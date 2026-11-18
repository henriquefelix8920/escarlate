import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime = 'nodejs';
const allowedStatuses = ['new','reviewed','message_prepared','contacted','replied','qualified','handed_off','not_interested'];
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const allowed = ['status','initial_message','notes','opportunity_reason'];
    const update = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nenhum campo válido para atualizar.' }, { status: 400 });
    if (update.status && !allowedStatuses.includes(update.status)) return NextResponse.json({ error: 'Etapa inválida.' }, { status: 400 });
    for (const key of ['initial_message','notes','opportunity_reason']) if (Object.prototype.hasOwnProperty.call(update,key)) update[key] = String(update[key] || '').slice(0, key === 'initial_message' ? 3000 : 2000);
    update.updated_at = new Date().toISOString();
    const { data, error } = await getSupabaseAdmin().from('instagram_prospects').update(update).eq('id', params.id).select().single();
    if (error) throw error;
    return NextResponse.json({ prospect: data });
  } catch (error) { return NextResponse.json({ error: error.message || 'Falha ao atualizar oportunidade.' }, { status: 503 }); }
}
export async function DELETE(_request, { params }) {
  try {
    const { data, error } = await getSupabaseAdmin().from('instagram_prospects').delete().eq('id', params.id).select('id').single();
    if (error) throw error;
    return NextResponse.json({ deleted: true, id: data.id });
  } catch (error) { return NextResponse.json({ error: error.message || 'Falha ao excluir oportunidade.' }, { status: 503 }); }
}