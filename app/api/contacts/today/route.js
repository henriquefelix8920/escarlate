import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getSaoPauloDate } from '@/lib/sao-paulo-date';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readTodayCount(db, today) {
  const { count, error } = await db
    .from('lead_contact_events')
    .select('lead_id', { count: 'exact', head: true })
    .eq('contacted_on', today);

  if (error) throw error;
  return Number(count || 0);
}

export async function GET() {
  try {
    const today = getSaoPauloDate();
    const count = await readTodayCount(getSupabaseAdmin(), today);
    return NextResponse.json({ date: today, count, timeZone: 'America/Sao_Paulo' });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao consultar contatos de hoje.' }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const leadId = String(body.lead_id || '').trim();
    const channel = body.channel === 'manual' ? 'manual' : 'whatsapp';

    if (!UUID_PATTERN.test(leadId)) {
      return NextResponse.json({ error: 'Informe um lead válido para registrar o contato.' }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data: lead, error: leadError } = await db
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 });

    const today = getSaoPauloDate();
    const { error: insertError } = await db
      .from('lead_contact_events')
      .upsert(
        { lead_id: leadId, contacted_on: today, channel },
        { onConflict: 'lead_id,contacted_on', ignoreDuplicates: true },
      );

    if (insertError) throw insertError;

    const count = await readTodayCount(db, today);
    return NextResponse.json({ date: today, count, timeZone: 'America/Sao_Paulo' });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Falha ao registrar contato.' }, { status: 503 });
  }
}
