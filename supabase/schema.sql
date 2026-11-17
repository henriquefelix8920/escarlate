-- Escarlate CRM — schema inicial para Supabase (PostgreSQL)
create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  phone_normalized text,
  email text,
  category text,
  address text,
  city text,
  website text,
  instagram text,
  profile text,
  google_maps_url text,
  source text not null default 'manual',
  search_term text,
  status text not null default 'new'
    check (status in ('new','contacted','interested','proposal','won','lost')),
  notes text not null default '',
  deal_value numeric(12,2) not null default 0,
  whatsapp_tracking_status text not null default 'inactive' check (whatsapp_tracking_status in ('inactive','active','completed','archived')),
  whatsapp_messages_sent integer not null default 0 check (whatsapp_messages_sent >= 0),
  whatsapp_total_messages integer not null default 4 check (whatsapp_total_messages >= 0),
  whatsapp_last_message text,
  whatsapp_last_message_at timestamptz,
  whatsapp_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Atualiza instalações existentes sem apagar dados.
alter table public.leads add column if not exists deal_value numeric(12,2) not null default 0;
alter table public.leads add column if not exists whatsapp_tracking_status text not null default 'inactive';
alter table public.leads add column if not exists whatsapp_messages_sent integer not null default 0;
alter table public.leads add column if not exists whatsapp_total_messages integer not null default 4;
alter table public.leads add column if not exists whatsapp_last_message text;
alter table public.leads add column if not exists whatsapp_last_message_at timestamptz;
alter table public.leads add column if not exists whatsapp_started_at timestamptz;
create index if not exists leads_whatsapp_tracking_idx on public.leads (whatsapp_tracking_status, whatsapp_last_message_at desc) where whatsapp_tracking_status = 'active';

create unique index if not exists leads_phone_normalized_unique
  on public.leads(phone_normalized) where phone_normalized is not null and phone_normalized <> '';
create unique index if not exists leads_google_maps_url_unique
  on public.leads(google_maps_url) where google_maps_url is not null and google_maps_url <> '';
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_status_idx on public.leads(status);

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

create table if not exists public.search_jobs (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  city text not null,
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed')),
  requested_limit integer not null default 10 check (requested_limit between 1 and 50),
  found_count integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.leads enable row level security;
alter table public.lead_contact_events enable row level security;
alter table public.search_jobs enable row level security;

-- Esta tabela é usada somente pelas rotas server-side com a chave service_role.
revoke all on table public.lead_contact_events from anon, authenticated;
grant all on table public.lead_contact_events to service_role;
