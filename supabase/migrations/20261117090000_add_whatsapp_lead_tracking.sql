-- Persistência do acompanhamento das conversas iniciadas pelo Assistente WhatsApp.
-- O Escarlate registra quando prepara uma mensagem e quando o operador confirma o envio.
alter table public.leads
  add column if not exists whatsapp_tracking_status text not null default 'inactive',
  add column if not exists whatsapp_messages_sent integer not null default 0,
  add column if not exists whatsapp_total_messages integer not null default 4,
  add column if not exists whatsapp_last_message text,
  add column if not exists whatsapp_last_message_at timestamptz,
  add column if not exists whatsapp_started_at timestamptz;

alter table public.leads
  drop constraint if exists leads_whatsapp_tracking_status_check;

alter table public.leads
  add constraint leads_whatsapp_tracking_status_check
  check (whatsapp_tracking_status in ('inactive', 'active', 'completed', 'archived'));

alter table public.leads
  drop constraint if exists leads_whatsapp_messages_sent_check;

alter table public.leads
  add constraint leads_whatsapp_messages_sent_check
  check (whatsapp_messages_sent >= 0 and whatsapp_total_messages >= 0);

create index if not exists leads_whatsapp_tracking_idx
  on public.leads (whatsapp_tracking_status, whatsapp_last_message_at desc)
  where whatsapp_tracking_status = 'active';
