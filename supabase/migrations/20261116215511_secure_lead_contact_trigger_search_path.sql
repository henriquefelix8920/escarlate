create or replace function public.set_lead_contacted_at()
returns trigger
language plpgsql
set search_path = pg_catalog
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
