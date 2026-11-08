-- Kirayeci linki: birdefelik imza/yukleme linkleri
create table if not exists public.sign_links (
  token text primary key,
  contract_id text not null,
  kind text not null check (kind in ('handover','return')),
  title text,
  renter text,
  html text not null,
  status text not null default 'open',
  expires_at timestamptz not null,
  result jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.sign_links enable row level security;

drop policy if exists "staff linkler" on public.sign_links;
create policy "staff linkler" on public.sign_links
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- link aciqdirmi (storage siyaseti ucun)
create or replace function public.link_is_open(p_token text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.sign_links where token = p_token and status = 'open' and expires_at > now())
$$;
grant execute on function public.link_is_open(text) to anon, authenticated;

-- kirayeci sehifesi sened ve veziyyeti oxuyur
create or replace function public.link_get(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare l public.sign_links;
begin
  select * into l from public.sign_links where token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'kind', l.kind, 'title', l.title, 'renter', l.renter, 'html', l.html,
    'status', case when l.status = 'open' and l.expires_at <= now() then 'expired' else l.status end
  );
end $$;
grant execute on function public.link_get(text) to anon, authenticated;

-- kirayeci gonderir: sened mediasi + imza
create or replace function public.link_submit(p_token text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.sign_links;
  d jsonb;
  m jsonb;
  pref text;
  grp text;
  arr jsonb;
  it jsonb;
  today_s text := to_char(now() at time zone 'Asia/Baku', 'YYYY-MM-DD');
  sigpath text;
  hdr jsonb;
  ip text;
begin
  select * into l from public.sign_links where token = p_token for update;
  if not found or l.status <> 'open' or l.expires_at <= now() then
    raise exception 'Link kecersizdir ve ya vaxti kecib';
  end if;
  pref := 'links/' || p_token || '/';
  sigpath := p_payload->>'signature';
  if sigpath is null or left(sigpath, length(pref)) <> pref then
    raise exception 'Imza yoxdur';
  end if;
  select data into d from public.docs where coll = 'contracts' and id = l.contract_id;
  if d is null then raise exception 'Muqavile tapilmadi'; end if;
  m := coalesce(d->'media', '{}'::jsonb);

  foreach grp in array array['id','renter','handover','return'] loop
    arr := coalesce(m->grp, '[]'::jsonb);
    for it in select * from jsonb_array_elements(coalesce(p_payload->grp, '[]'::jsonb)) loop
      if left(coalesce(it->>'path',''), length(pref)) = pref then
        arr := arr || jsonb_build_array(jsonb_build_object(
          'id', it->>'path', 'url', 'sb://' || (it->>'path'),
          'name', left(coalesce(it->>'name', 'fayl'), 80),
          'type', case when it->>'type' = 'video' then 'video' else 'image' end,
          'at', today_s, 'via', 'link'));
      end if;
    end loop;
    m := jsonb_set(m, array[grp], arr);
  end loop;

  begin
    hdr := current_setting('request.headers', true)::jsonb;
    ip := split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'cf-connecting-ip', ''), ',', 1);
  exception when others then ip := '';
  end;

  if l.kind = 'handover' then
    d := d || jsonb_build_object('media', m, 'signedAt', today_s, 'signedOnline', true,
      'signature', jsonb_build_object('url', 'sb://' || sigpath, 'name', left(coalesce(p_payload->>'signer', ''), 120),
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'ua', left(coalesce(p_payload->>'ua',''), 250), 'ip', ip));
  else
    d := d || jsonb_build_object('media', m, 'returnSignedAt', today_s,
      'returnSignature', jsonb_build_object('url', 'sb://' || sigpath, 'name', left(coalesce(p_payload->>'signer', ''), 120),
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'ua', left(coalesce(p_payload->>'ua',''), 250), 'ip', ip));
  end if;

  update public.docs set data = d, updated_at = now() where coll = 'contracts' and id = l.contract_id;
  update public.sign_links set status = 'done', done_at = now(), result = p_payload where token = p_token;
end $$;
grant execute on function public.link_submit(text, jsonb) to anon, authenticated;

-- kirayeci yalniz oz linkinin qovlugunda fayl yukleye biler
drop policy if exists "link yukleme" on storage.objects;
create policy "link yukleme" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'links'
    and public.link_is_open((storage.foldername(name))[2])
  );
