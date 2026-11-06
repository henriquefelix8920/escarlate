-- Checkpoints persistidos permitem retomar pesquisas após reinícios do worker.
alter table public.search_jobs
  add column if not exists candidates jsonb not null default '[]'::jsonb,
  add column if not exists next_candidate_index integer not null default 0,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_heartbeat_at timestamptz;

alter table public.search_jobs
  drop constraint if exists search_jobs_status_check;

alter table public.search_jobs
  add constraint search_jobs_status_check
  check (status in ('queued','running','retry_wait','cancelling','completed','failed','cancelled'));
