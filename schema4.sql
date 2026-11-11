-- Iscilerin idare edilmesi: yalniz admin elave ede/silebilir
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.staff_list()
returns table(user_id uuid, email text, role text)
language sql security definer set search_path = public, auth stable as $$
  select s.user_id, u.email::text, s.role
  from public.staff s join auth.users u on u.id = s.user_id
  where public.is_admin()
  order by s.role, u.email
$$;

create or replace function public.staff_add(p_email text, p_role text default 'worker')
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Icaze yoxdur'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Bu e-poct Supabase-de yoxdur. Evvelce hesab yaradin.'; end if;
  insert into public.staff (user_id, role) values (uid, case when p_role = 'admin' then 'admin' else 'worker' end)
  on conflict (user_id) do update set role = excluded.role;
end $$;

create or replace function public.staff_remove(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Icaze yoxdur'; end if;
  if p_user = auth.uid() then raise exception 'Ozunuzu sile bilmezsiniz'; end if;
  delete from public.staff where user_id = p_user;
end $$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.staff_list() from public, anon;
revoke execute on function public.staff_add(text, text) from public, anon;
revoke execute on function public.staff_remove(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.staff_list() to authenticated;
grant execute on function public.staff_add(text, text) to authenticated;
grant execute on function public.staff_remove(uuid) to authenticated;
