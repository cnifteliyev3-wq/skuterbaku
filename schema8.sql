-- Yagis xeberdarligi: her 15 deqiqeden bir Baki ucun yagis yoxlanir (quick-service funksiyasi, action: rain).
-- Yagis baslayanda ve ya 1 saat erzinde gozlenende, kirayede skuter varsa, adminlere Telegram bildirisi gedir.
create or replace function public.tg_rain()
returns void language sql security definer set search_path = public, extensions as $$
  select public.tg_post(jsonb_build_object('action', 'rain'))
$$;
revoke execute on function public.tg_rain() from public, anon, authenticated;
select cron.unschedule('tg-rain') where exists (select 1 from cron.job where jobname = 'tg-rain');
select cron.schedule('tg-rain', '*/15 * * * *', 'select public.tg_rain()');
