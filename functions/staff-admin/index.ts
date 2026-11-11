// Supabase Edge Function: staff-admin
// Yalniz admin iscisi yeni isci hesabi yarada biler. Gizli aclar Supabase terefinden avtomatik verilir (kodda yazilmir).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const PERMS = ['skuterler', 'muqavileler', 'musteriler', 'odenisler', 'ayarlar', 'sayt'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: 'Giris teleb olunur' }, 401);
    const { data: isAdmin } = await caller.rpc('is_admin');
    if (!isAdmin) return json({ error: 'Yalniz admin isci elave ede biler' }, 403);

    const b = await req.json();
    const email = String(b.email ?? '').trim().toLowerCase();
    const password = String(b.password ?? '');
    const role = b.role === 'admin' ? 'admin' : 'worker';
    const perms = (Array.isArray(b.perms) ? b.perms : []).filter((p: string) => PERMS.includes(p));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'E-poct duzgun deyil' }, 400);
    if (password.length < 8) return json({ error: 'Sifre en azi 8 simvol olmalidir' }, 400);

    const admin = createClient(url, service);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) return json({ error: error?.message ?? 'Hesab yaradilmadi' }, 400);
    const { error: e2 } = await admin.from('staff').insert({ user_id: data.user.id, role, perms });
    if (e2) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: e2.message }, 400);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
