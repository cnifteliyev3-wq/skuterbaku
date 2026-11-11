-- Telegram ile dogrulama (2 merheleli giris)
-- Yalniz Telegram bagladan istifadecilerde isleyir; baglamayanlar evvelki kimi girir.
create table if not exists public.tg_link (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null,
  linked_at timestamptz not null default now()
);
create table if not exists public.tg_pending (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('link','login')),
  code_hash text not null,
  expires_at timestamptz not null,
  tries int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);
create table if not exists public.tg_session (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  verified_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
alter table public.tg_link enable row level security;
alter table public.tg_pending enable row level security;
alter table public.tg_session enable row level security;
-- siyaset yoxdur: yalniz Edge Function (service role) ve asagidaki funksiyalar toxuna biler

-- bu sessiya kecib? (baglamayanlar ucun hemise beli)
create or replace function public.tg_pass()
returns boolean language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.tg_link where user_id = auth.uid())
      or exists (select 1 from public.tg_session
                 where user_id = auth.uid() and session_id = coalesce(auth.jwt()->>'session_id', ''))
$$;

-- butun icaze funksiyalari dogrulamani nezere alir
create or replace function public.is_staff()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid()) and public.tg_pass()
$$;
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin') and public.tg_pass()
$$;
create or replace function public.has_perm(p text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and (role = 'admin' or p = any(perms))) and public.tg_pass()
$$;

-- giris sehifesi ucun veziyyet
create or replace function public.tg_status()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'linked', exists (select 1 from public.tg_link where user_id = auth.uid()),
    'verified', public.tg_pass())
$$;

-- oz Telegram baglantisini yalniz dogrulanmis sessiyada ayirmaq olar
create or replace function public.tg_unlink()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tg_pass() then raise exception 'Evvelce dogrulayin'; end if;
  delete from public.tg_link where user_id = auth.uid();
  delete from public.tg_session where user_id = auth.uid();
end $$;

revoke execute on function public.tg_pass() from public, anon;
revoke execute on function public.tg_status() from public, anon;
revoke execute on function public.tg_unlink() from public, anon;
grant execute on function public.tg_pass() to authenticated;
grant execute on function public.tg_status() to authenticated;
grant execute on function public.tg_unlink() to authenticated;
