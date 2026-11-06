-- Corrige o limite e os estados de pesquisa para corresponder à API atual.
-- Seguro para executar mais de uma vez.
alter table public.search_jobs
  add column if not exists message text;

alter table public.search_jobs
  drop constraint if exists search_jobs_requested_limit_check;

alter table public.search_jobs
  add constraint search_jobs_requested_limit_check
  check (requested_limit between 1 and 100);

alter table public.search_jobs
  drop constraint if exists search_jobs_status_check;

alter table public.search_jobs
  add constraint search_jobs_status_check
  check (status in ('queued','running','cancelling','completed','failed','cancelled'));

notify pgrst, 'reload schema';
