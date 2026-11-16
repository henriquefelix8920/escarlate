create table if not exists public.lead_contact_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  contacted_on date not null,
  channel text not null default 'whatsapp',
  created_at timestamptz not null default now(),
  constraint lead_contact_events_lead_day_unique unique (lead_id, contacted_on)
);

create index if not exists lead_contact_events_contacted_on_idx
  on public.lead_contact_events (contacted_on);

alter table public.lead_contact_events enable row level security;
revoke all on table public.lead_contact_events from anon, authenticated;
grant all on table public.lead_contact_events to service_role;
