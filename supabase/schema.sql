-- Escarlate CRM — schema inicial para Supabase (PostgreSQL)
-- Execute no SQL Editor do seu projeto Supabase.
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_phone_normalized_unique
  on public.leads(phone_normalized) where phone_normalized is not null and phone_normalized <> '';
create unique index if not exists leads_google_maps_url_unique
  on public.leads(google_maps_url) where google_maps_url is not null and google_maps_url <> '';
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_status_idx on public.leads(status);

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

-- Segurança: o acesso será feito por rotas server-side do Next.js.
-- Não exponha a chave service_role no navegador.
alter table public.leads enable row level security;
alter table public.search_jobs enable row level security;
