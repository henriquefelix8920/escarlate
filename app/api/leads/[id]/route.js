import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const allowed = ['status', 'notes', 'name', 'phone', 'email', 'website', 'instagram', 'deal_value', 'whatsapp_tracking_status', 'whatsapp_messages_sent', 'whatsapp_total_messages', 'whatsapp_last_message', 'whatsapp_last_message_at', 'whatsapp_started_at'];
    const update = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(update).length) return NextResponse.json({ error: 'Nenhum campo válido para atualizar.' }, { status: 400 });
    if (update.status && !['new','contacted','follow_up','interested','proposal','won','lost'].includes(update.status)) return NextResponse.json({ error: 'Etapa comercial inválida.' }, { status: 400 });
    if (Object.prototype.hasOwnProperty.call(update, 'whatsapp_tracking_status') && !['inactive', 'active', 'completed', 'archived'].includes(update.whatsapp_tracking_status)) {
      return NextResponse.json({ error: 'Status de acompanhamento do WhatsApp inválido.' }, { status: 400 });
    }
    for (const field of ['whatsapp_messages_sent', 'whatsapp_total_messages']) {
      if (Object.prototype.hasOwnProperty.call(update, field)) {
        const amount = Number(update[field]);
        if (!Number.isInteger(amount) || amount < 0 || amount > 1000) {
          return NextResponse.json({ error: 'Progresso de mensagens inválido.' }, { status: 400 });
        }
        update[field] = amount;
      }
    }
    for (const field of ['whatsapp_last_message', 'whatsapp_last_message_at', 'whatsapp_started_at']) {
      if (Object.prototype.hasOwnProperty.call(update, field) && update[field] !== null) {
        update[field] = String(update[field]).slice(0, field === 'whatsapp_last_message' ? 300 : 40);
      }
    }
    if (Object.prototype.hasOwnProperty.call(update, 'deal_value')) {
      const amount = Number(update.deal_value);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) return NextResponse.json({ error: 'Informe um valor válido para o negócio.' }, { status: 400 });
      update.deal_value = amount;
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await getSupabaseAdmin().from('leads').update(update).eq('id', params.id).select().single();
    if (error) throw error;
    return NextResponse.json({ lead: data });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao atualizar lead.' }, { status: 503 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('leads')
      .delete()
      .eq('id', params.id)
      .select('id')
      .single();
    if (error) throw error;
    return NextResponse.json({ deleted: true, id: data.id });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao excluir lead.' }, { status: 503 });
  }
}
