alter table public.leads
  add column if not exists contacted_at timestamptz;

alter table public.leads
  drop constraint if exists leads_status_check;

alter table public.leads
  add constraint leads_status_check
  check (status = any (array['new','contacted','follow_up','interested','proposal','won','lost']));

update public.leads
set contacted_at = coalesce(contacted_at, updated_at)
where status = 'contacted'
  and contacted_at is null;

create index if not exists leads_contacted_at_follow_up_idx
  on public.leads (contacted_at)
  where status = 'contacted';

create or replace function public.set_lead_contacted_at()
returns trigger
language plpgsql
as $function$
begin
  if new.status = 'contacted' then
    if tg_op = 'INSERT' then
      new.contacted_at := now();
    elsif old.status is distinct from new.status then
      new.contacted_at := now();
    elsif new.contacted_at is null then
      new.contacted_at := now();
    end if;
  elsif new.status <> 'follow_up' then
    new.contacted_at := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists leads_set_contacted_at on public.leads;

create trigger leads_set_contacted_at
before insert or update of status, contacted_at
on public.leads
for each row
execute function public.set_lead_contacted_at();

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'escarlate-follow-up-24h',
  '*/5 * * * *',
  $cron$
    update public.leads
    set status = 'follow_up',
        updated_at = now()
    where status = 'contacted'
      and contacted_at is not null
      and contacted_at <= now() - interval '24 hours';
  $cron$
);
