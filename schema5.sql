-- Iscilerin bolme uzre icazeleri (bazada real olaraq tetbiq olunur)
alter table public.staff add column if not exists perms text[] not null default '{}';

create or replace function public.coll_perm(c text)
returns text language sql immutable as $$
  select case c when 'scooters' then 'skuterler' when 'contracts' then 'muqavileler'
    when 'payments' then 'odenisler' when 'customers' then 'musteriler' when 'settings' then 'ayarlar' else 'admin' end
$$;

create or replace function public.has_perm(p text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and (role = 'admin' or p = any(perms)))
$$;

-- docs: oxumaq (settings hamiya acig - mueqavile ucun icaredar melumati lazimdir), yazmaq yalniz icazeli bolmede
drop policy if exists "staff docs hamisi" on public.docs;
drop policy if exists "docs oxu" on public.docs;
drop policy if exists "docs yaz" on public.docs;
drop policy if exists "docs deyis" on public.docs;
drop policy if exists "docs sil" on public.docs;
-- "sayt" icazesi: skuter kartlari + settings/site senedi (on sayt mezmunu), muqavile/odenise toxunmur
create or replace function public.can_write_doc(c text, d text)
returns boolean language sql security definer set search_path = public stable as $$
  select public.has_perm(public.coll_perm(c))
      or (c = 'scooters' and public.has_perm('sayt'))
      or (c = 'settings' and d = 'site' and public.has_perm('sayt'))
$$;
create policy "docs oxu" on public.docs for select to authenticated
  using (public.is_staff() and (coll = 'settings' or public.has_perm(public.coll_perm(coll)) or (coll = 'scooters' and public.has_perm('sayt'))));
create policy "docs yaz" on public.docs for insert to authenticated
  with check (public.can_write_doc(coll, id));
create policy "docs deyis" on public.docs for update to authenticated
  using (public.can_write_doc(coll, id)) with check (public.can_write_doc(coll, id));
create policy "docs sil" on public.docs for delete to authenticated
  using (public.can_write_doc(coll, id));

-- sekil/video/sened qovlugu: yalniz muqavile ve ya musteri icazesi olanlar
drop policy if exists "staff media hamisi" on storage.objects;
create policy "staff media hamisi" on storage.objects for all to authenticated
  using (bucket_id = 'media' and (public.has_perm('muqavileler') or public.has_perm('musteriler')))
  with check (bucket_id = 'media' and (public.has_perm('muqavileler') or public.has_perm('musteriler')));

drop policy if exists "staff catalog yazir" on storage.objects;
create policy "staff catalog yazir" on storage.objects for all to authenticated
  using (bucket_id = 'catalog' and (public.has_perm('skuterler') or public.has_perm('sayt')))
  with check (bucket_id = 'catalog' and (public.has_perm('skuterler') or public.has_perm('sayt')));

drop policy if exists "staff linkler" on public.sign_links;
create policy "staff linkler" on public.sign_links for all to authenticated
  using (public.has_perm('muqavileler')) with check (public.has_perm('muqavileler'));

-- ozunun rolu/icazeleri
create or replace function public.my_access()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce((select jsonb_build_object('role', role, 'perms', to_jsonb(perms)) from public.staff where user_id = auth.uid()), 'null'::jsonb)
$$;

-- isci siyahisi (yalniz admin)
drop function if exists public.staff_list();
create function public.staff_list()
returns table(user_id uuid, email text, role text, perms text[])
language sql security definer set search_path = public, auth stable as $$
  select s.user_id, u.email::text, s.role, s.perms
  from public.staff s join auth.users u on u.id = s.user_id
  where public.is_admin()
  order by s.role, u.email
$$;

-- rol ve icazeleri deyismek (yalniz admin)
create or replace function public.staff_set(p_user uuid, p_role text, p_perms text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Icaze yoxdur'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'Oz admin hüququnuzu ala bilmezsiniz'; end if;
  update public.staff set role = case when p_role = 'admin' then 'admin' else 'worker' end,
    perms = (select coalesce(array_agg(x), '{}') from unnest(p_perms) x where x in ('skuterler','muqavileler','musteriler','odenisler','ayarlar','sayt'))
  where user_id = p_user;
end $$;

drop function if exists public.staff_add(text, text);

revoke execute on function public.my_access() from public, anon;
revoke execute on function public.staff_list() from public, anon;
revoke execute on function public.staff_set(uuid, text, text[]) from public, anon;
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.can_write_doc(text, text) from public, anon;
grant execute on function public.can_write_doc(text, text) to authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.staff_list() to authenticated;
grant execute on function public.staff_set(uuid, text, text[]) to authenticated;
grant execute on function public.has_perm(text) to authenticated;
