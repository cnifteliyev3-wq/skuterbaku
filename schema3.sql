-- On sayt: ictimai sekil qovlugu + katalog funksiyasi
insert into storage.buckets (id, name, public, file_size_limit)
values ('catalog', 'catalog', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "staff catalog yazir" on storage.objects;
create policy "staff catalog yazir" on storage.objects
  for all to authenticated
  using (bucket_id = 'catalog' and public.is_staff())
  with check (bucket_id = 'catalog' and public.is_staff());

-- Yalniz saytda gosterilen skuterler ve "settings/site" senedi qaytarilir (musteri/odenis melumati yox)
create or replace function public.site_catalog()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'site', coalesce((select data from public.docs where coll = 'settings' and id = 'site'), '{}'::jsonb),
    'scooters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.data->>'name',
        'desc', coalesce(d.data->>'desc', ''),
        'rate', d.data->'rate',
        'unit', coalesce(d.data->>'unit', 'day'),
        'photos', coalesce(d.data->'photos', '[]'::jsonb),
        'specs', coalesce(d.data->'specs', '{}'::jsonb),
        'avail', case
          when coalesce(d.data->>'status', '') <> '' then 'off'
          when exists (select 1 from public.docs c where c.coll = 'contracts' and c.data->>'scooterId' = d.id and c.data->>'status' = 'aktiv') then 'rented'
          else 'free' end
      ) order by d.data->>'no', d.data->>'name')
      from public.docs d
      where d.coll = 'scooters' and d.data->>'public' = 'true'
    ), '[]'::jsonb)
  )
$$;
grant execute on function public.site_catalog() to anon, authenticated;
