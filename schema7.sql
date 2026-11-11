-- Telegram bildirisleri: DB hadiseleri -> Edge Function (quick-service) -> adminlerin Telegramina
-- DIQQET: asagidaki __URL__, __ANON__, __KEY__ yerlerini real deyerle evez edib yalniz Supabase SQL redaktorunda isledin (repoya yazmayin).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.notify_cfg (
  id int primary key default 1 check (id = 1),
  url text not null,
  anon text not null,
  key text not null
);
alter table public.notify_cfg enable row level security;
insert into public.notify_cfg (id, url, anon, key) values (1, '__URL__', '__ANON__', '__KEY__')
  on conflict (id) do update set url = excluded.url, anon = excluded.anon, key = excluded.key;

create or replace function public.tg_post(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare c public.notify_cfg;
begin
  select * into c from public.notify_cfg where id = 1;
  if not found then return; end if;
  perform net.http_post(url := c.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.anon, 'apikey', c.anon, 'x-notify-key', c.key),
    body := p_body);
exception when others then null;
end $$;

create or replace function public.tg_notify(msg text)
returns void language sql security definer set search_path = public, extensions as $$
  select public.tg_post(jsonb_build_object('action', 'notify', 'text', msg))
$$;
create or replace function public.tg_daily()
returns void language sql security definer set search_path = public, extensions as $$
  select public.tg_post(jsonb_build_object('action', 'daily'))
$$;
revoke execute on function public.tg_post(jsonb) from public, anon, authenticated;
revoke execute on function public.tg_notify(text) from public, anon, authenticated;
revoke execute on function public.tg_daily() from public, anon, authenticated;

create or replace function public.docs_notify()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  o jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  n jsonb := new.data;
  sn text; rn text; cn jsonb;
begin
  if new.coll = 'contracts' then
    select data->>'name' into sn from public.docs where coll = 'scooters' and id = n->>'scooterId';
    rn := coalesce(n->>'renter', '?'); sn := coalesce(sn, 'skuter');
    if tg_op = 'INSERT' then
      perform public.tg_notify('📄 Yeni müqavilə: ' || rn || ' · ' || sn);
    else
      if coalesce(o->>'signedAt', '') = '' and coalesce(n->>'signedAt', '') <> '' then
        perform public.tg_notify('✍️ Müqavilə imzalandı: ' || rn || ' · ' || sn || case when n->>'signedOnline' = 'true' then ' (onlayn)' else '' end);
      end if;
      if coalesce(o->>'returnSignedAt', '') = '' and coalesce(n->>'returnSignedAt', '') <> '' then
        perform public.tg_notify('↩️ Qaytarma aktı imzalandı: ' || rn || ' · ' || sn);
      end if;
      if n->>'handed' = 'true' and o->>'handed' is distinct from 'true' then
        perform public.tg_notify('🛴 Skuter təhvil verildi: ' || rn || ' · ' || sn);
      end if;
      if n->>'status' = 'baglanib' and o->>'status' is distinct from 'baglanib' then
        perform public.tg_notify('✅ Müqavilə bağlandı: ' || rn || ' · ' || sn);
      end if;
    end if;
  elsif new.coll = 'payments' and tg_op = 'INSERT' then
    select data into cn from public.docs where coll = 'contracts' and id = n->>'contractId';
    perform public.tg_notify('💰 Ödəniş: ' || coalesce(cn->>'renter', '?') || ' — ' || coalesce(n->>'amount', '?') || ' ₼ (' || coalesce(n->>'kind', '') || ')');
  elsif new.coll = 'scooters' and tg_op = 'UPDATE' then
    if coalesce(o->>'status', '') is distinct from coalesce(n->>'status', '') then
      perform public.tg_notify('🛴 ' || coalesce(n->>'name', 'skuter') || ': ' || case n->>'status' when 'temir' then 'təmirdə' when 'itib' then 'itkin' else 'işlək' end);
    end if;
  end if;
  return null;
exception when others then
  return null;  -- bildiris xetasi esas emeliyyati pozmasin
end $$;

drop trigger if exists docs_notify_t on public.docs;
create trigger docs_notify_t after insert or update on public.docs
  for each row execute function public.docs_notify();

-- her gun 09:00 (Baki vaxti = 05:00 UTC)
select cron.unschedule('tg-daily') where exists (select 1 from cron.job where jobname = 'tg-daily');
select cron.schedule('tg-daily', '0 5 * * *', 'select public.tg_daily()');
