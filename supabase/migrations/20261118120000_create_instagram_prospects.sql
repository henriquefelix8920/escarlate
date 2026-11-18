-- Radar Instagram: pipeline independente do CRM de prospecção atual.
create table if not exists public.instagram_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null,
  instagram_url text not null,
  city text,
  bio text,
  website text,
  maps_website text,
  opportunity_reason text,
  notes text not null default '',
  initial_message text,
  source text not null default 'instagram_manual_review',
  status text not null default 'new' check (status in ('new','reviewed','message_prepared','contacted','replied','qualified','handed_off','not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists instagram_prospects_url_unique on public.instagram_prospects (lower(instagram_url));
create index if not exists instagram_prospects_status_created_idx on public.instagram_prospects (status, created_at desc);
alter table public.instagram_prospects enable row level security;
revoke all on table public.instagram_prospects from anon, authenticated;
grant all on table public.instagram_prospects to service_role;
