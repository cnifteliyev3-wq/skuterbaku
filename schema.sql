-- Skuter İcarə: Supabase baza quruluşu
-- Supabase > SQL Editor > New query: bütün mətni yapışdırın > Run

-- 1) Əsas cədvəl: bütün kolleksiyalar (scooters, contracts, payments, customers, settings) burada saxlanır
create table if not exists public.docs (
  coll text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);

-- 2) İşçi/admin siyahısı: yalnız burada olan istifadəçilər məlumatı görə bilər
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin'
);

alter table public.docs enable row level security;
alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

drop policy if exists "staff oz setrini oxuyur" on public.staff;
create policy "staff oz setrini oxuyur" on public.staff
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "staff docs hamisi" on public.docs;
create policy "staff docs hamisi" on public.docs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 3) Sənədin bəzi sahələrini yeniləmək (mövcud məlumatla birləşdirir)
create or replace function public.doc_merge(p_coll text, p_id text, p_data jsonb)
returns void language plpgsql security invoker as $$
begin
  update public.docs set data = data || p_data, updated_at = now()
   where coll = p_coll and id = p_id;
  if not found then
    raise exception 'Sened tapilmadi: %/%', p_coll, p_id;
  end if;
end $$;

-- 4) Canlı yenilənmə (bir cihazda dəyişiklik digərində dərhal görünsün)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null;
end $$;

-- 5) Şəkil və video üçün şəxsi qovluq (50 MB-a qədər fayl)
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "staff media hamisi" on storage.objects;
create policy "staff media hamisi" on storage.objects
  for all to authenticated
  using (bucket_id = 'media' and public.is_staff())
  with check (bucket_id = 'media' and public.is_staff());
