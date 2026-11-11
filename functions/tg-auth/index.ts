// Supabase Edge Function: tg-auth
// Telegram ile baglama ve giris dogrulamasi. Bot tokeni yalniz Supabase secret-de saxlanir (TELEGRAM_BOT_TOKEN).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const sha = async (s: string) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const rnd = (n: number, alphabet: string) => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((x) => alphabet[x % alphabet.length]).join('');
};
const sessionOf = (auth: string) => {
  try {
    const p = auth.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(atob(p)).session_id ?? '');
  } catch { return ''; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) return json({ error: 'Telegram bot hele qosulmayib (TELEGRAM_BOT_TOKEN yoxdur)' }, 500);
    const authH = req.headers.get('Authorization') ?? '';
    const tgSend = async (chat: number, text: string) => {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      });
      return await r.json();
    };
    const svc = createClient(url, service);
    // butun adminlere (Telegram bagli olanlara) bildiris
    const notifyAdmins = async (text: string) => {
      const { data: adm } = await svc.from('staff').select('user_id').eq('role', 'admin');
      const ids = (adm ?? []).map((x: { user_id: string }) => x.user_id);
      if (!ids.length) return 0;
      const { data: links } = await svc.from('tg_link').select('chat_id').in('user_id', ids);
      let n = 0;
      for (const l of links ?? []) { const r = await tgSend(l.chat_id, text); if (r?.ok) n++; }
      return n;
    };

    // DB-den gelen bildirisler: gizli acar ile qorunur (istifadeci sessiyasi lazim deyil)
    const nk = Deno.env.get('NOTIFY_KEY');
    if (nk && req.headers.get('x-notify-key') === nk) {
      const nb = await req.json().catch(() => ({}));
      if (nb.action === 'notify') {
        const n = await notifyAdmins(String(nb.text ?? '').slice(0, 3500));
        return json({ ok: true, sent: n });
      }
      if (nb.action === 'daily') {
        const { data: cs } = await svc.from('docs').select('data').eq('coll', 'contracts');
        const { data: sc } = await svc.from('docs').select('id,data').eq('coll', 'scooters');
        const name = (id: string) => (sc ?? []).find((s: { id: string }) => s.id === id)?.data?.name ?? 'skuter';
        const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
        const dn = (d: string) => Math.floor(Date.parse(d) / 864e5);
        const act = (cs ?? []).map((x: { data: Record<string, any> }) => x.data).filter((c) => c.status === 'aktiv');
        const lines: string[] = [];
        for (const c of act) {
          if (!c.end) continue;
          const left = dn(c.end) - dn(today);
          if (left < 0) lines.push(`⛔ ${c.renter} · ${name(c.scooterId)} — müddət ${-left} gün əvvəl bitib`);
          else if (left <= 3) lines.push(`⏳ ${c.renter} · ${name(c.scooterId)} — ${left === 0 ? 'bu gün bitir' : left + ' gün qalıb'}`);
        }
        const repair = (sc ?? []).filter((s: { data: Record<string, any> }) => s.data.status === 'temir' || s.data.status === 'itib')
          .map((s: { data: Record<string, any> }) => `🛠 ${s.data.name} — ${s.data.status === 'itib' ? 'itkin' : 'təmirdə'}`);
        const txt = `🌅 Gündəlik xülasə (${today})\nAktiv müqavilə: ${act.length}\n` + ([...lines, ...repair].join('\n') || 'Diqqət tələb edən yoxdur.');
        const n = await notifyAdmins(txt);
        return json({ ok: true, sent: n });
      }
      if (nb.action === 'rain') {
        // Baki ucun yagis yoxlamasi (Open-Meteo, acar teleb olunmur). Veziyyet kecidinde bir defe bildiris gonderilir.
        const w = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.4093&longitude=49.8671&current=precipitation,rain,showers,weather_code&minutely_15=precipitation&forecast_minutely_15=4&timezone=auto')).json();
        const cur = w?.current ?? {};
        const wet = (cur.precipitation ?? 0) > 0 || (cur.rain ?? 0) > 0 || (cur.showers ?? 0) > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(cur.weather_code);
        const soon = !wet && ((w?.minutely_15?.precipitation ?? []) as number[]).some((x) => x > 0.1);
        const state = wet ? 'rain' : soon ? 'soon' : 'dry';
        const { data: ps } = await svc.from('docs').select('data').eq('coll', 'settings').eq('id', 'rainState').maybeSingle();
        const prev = ps?.data?.state ?? 'dry';
        await svc.from('docs').upsert({ coll: 'settings', id: 'rainState', data: { state, at: new Date().toISOString() } });
        if (state === 'dry' || state === prev || (state === 'soon' && prev === 'rain')) return json({ ok: true, state, sent: 0 });
        const { data: cs } = await svc.from('docs').select('data').eq('coll', 'contracts');
        const { data: sc } = await svc.from('docs').select('id,data').eq('coll', 'scooters');
        const rented = (cs ?? []).map((x: { data: Record<string, any> }) => x.data).filter((c) => c.status === 'aktiv' && c.handed !== false);
        if (!rented.length) return json({ ok: true, state, sent: 0, note: 'kirayede skuter yoxdur' });
        const nm = (id: string) => (sc ?? []).find((s: { id: string }) => s.id === id)?.data?.name ?? 'skuter';
        const list = rented.map((c) => `• ${nm(c.scooterId)} — ${c.renter}${c.phone ? ' (' + c.phone + ')' : ''}`).join('\n');
        const head = state === 'rain' ? '🌧 Bakıda yağış yağır.' : '🌦 Bakıda 1 saat ərzində yağış gözlənilir.';
        const n = await notifyAdmins(`${head}\nİndi kirayədə olan skuterlər:\n${list}\n\nŞərtlərə görə yağışda sürmək qadağandır. İcarəçilərə xəbərdarlıq edin.`);
        return json({ ok: true, state, sent: n });
      }
      return json({ error: 'Namelum emel' }, 400);
    }

    const caller = createClient(url, anon, { global: { headers: { Authorization: authH } } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: 'Giris teleb olunur' }, 401);
    const uid = u.user.id;
    const admin = createClient(url, service);
    const { data: st } = await admin.from('staff').select('user_id').eq('user_id', uid).maybeSingle();
    if (!st) return json({ error: 'Icaze yoxdur' }, 403);

    const tg = async (method: string, body: Record<string, unknown> = {}) => {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return await r.json();
    };
    const b = await req.json().catch(() => ({}));
    const now = Date.now();

    if (b.action === 'link_start') {
      // yeni baglama yalniz artiq baglamayibsa ve ya dogrulanmis sessiyada
      const { data: lk } = await admin.from('tg_link').select('user_id').eq('user_id', uid).maybeSingle();
      if (lk) {
        const { data: ok } = await admin.from('tg_session').select('user_id').eq('user_id', uid).eq('session_id', sessionOf(authH)).maybeSingle();
        if (!ok) return json({ error: 'Evvelce Telegram kodu ile dogrulayin' }, 403);
      }
      const code = rnd(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
      await admin.from('tg_pending').upsert({
        user_id: uid, kind: 'link', code_hash: await sha(code + uid), expires_at: new Date(now + 10 * 60e3).toISOString(), tries: 0,
      });
      const me = await tg('getMe');
      return json({ ok: true, code, bot: me?.result?.username ?? '' });
    }

    if (b.action === 'link_check') {
      const { data: p } = await admin.from('tg_pending').select('*').eq('user_id', uid).eq('kind', 'link').maybeSingle();
      if (!p || new Date(p.expires_at).getTime() < now) return json({ error: 'Kodun vaxti kecib, yeniden baslayin' }, 400);
      const upd = await tg('getUpdates', { limit: 100, timeout: 0 });
      if (!upd?.ok) return json({ error: 'Telegram cavab vermedi: ' + (upd?.description ?? '') }, 502);
      let chat = 0;
      for (const x of upd.result ?? []) {
        const m = x.message;
        if (!m || m.chat?.type !== 'private' || typeof m.text !== 'string') continue;
        const codes = m.text.toUpperCase().match(/[A-Z0-9]{8}/g) ?? [];
        for (const c of codes) if (await sha(c + uid) === p.code_hash) chat = m.chat.id;
      }
      if (!chat) return json({ ok: false, waiting: true });
      const { data: taken } = await admin.from('tg_link').select('user_id').eq('chat_id', chat).neq('user_id', uid).maybeSingle();
      if (taken) return json({ error: 'Bu Telegram hesabi basqa istifadeciye baglidir' }, 400);
      await admin.from('tg_link').upsert({ user_id: uid, chat_id: chat });
      await admin.from('tg_pending').delete().eq('user_id', uid).eq('kind', 'link');
      await admin.from('tg_session').upsert({ user_id: uid, session_id: sessionOf(authH) });
      await tg('sendMessage', { chat_id: chat, text: '✅ Skuter paneli: Telegram uğurla bağlandı. Bundan sonra girişdə bu çata kod gələcək.' });
      return json({ ok: true });
    }

    if (b.action === 'login_send') {
      const { data: lk } = await admin.from('tg_link').select('chat_id').eq('user_id', uid).maybeSingle();
      if (!lk) return json({ error: 'Telegram bagli deyil' }, 400);
      const { data: old } = await admin.from('tg_pending').select('created_at').eq('user_id', uid).eq('kind', 'login').maybeSingle();
      if (old && now - new Date(old.created_at).getTime() < 30e3) return json({ error: '30 saniye gozleyin, sonra yeniden isteyin' }, 429);
      const code = rnd(6, '0123456789');
      await admin.from('tg_pending').upsert({
        user_id: uid, kind: 'login', code_hash: await sha(code + uid), expires_at: new Date(now + 5 * 60e3).toISOString(), tries: 0, created_at: new Date(now).toISOString(),
      });
      const r = await tg('sendMessage', { chat_id: lk.chat_id, text: `🔐 Skuter paneli giriş kodu: ${code}\nKod 5 dəqiqə etibarlıdır. Siz daxil olmursunuzsa, heç kimə verməyin və şifrənizi dəyişin.` });
      if (!r?.ok) return json({ error: 'Telegram mesaji gonderilmedi' }, 502);
      return json({ ok: true });
    }

    if (b.action === 'login_verify') {
      const { data: p } = await admin.from('tg_pending').select('*').eq('user_id', uid).eq('kind', 'login').maybeSingle();
      if (!p || new Date(p.expires_at).getTime() < now) return json({ error: 'Kodun vaxti kecib, yeni kod isteyin' }, 400);
      if (p.tries >= 5) { await admin.from('tg_pending').delete().eq('user_id', uid).eq('kind', 'login'); return json({ error: 'Cox sehv cehd. Yeni kod isteyin' }, 429); }
      const code = String(b.code ?? '').replace(/\D/g, '');
      if (await sha(code + uid) !== p.code_hash) {
        await admin.from('tg_pending').update({ tries: p.tries + 1 }).eq('user_id', uid).eq('kind', 'login');
        return json({ error: 'Kod sehvdir' }, 400);
      }
      const sid = sessionOf(authH);
      if (!sid) return json({ error: 'Sessiya taninmadi' }, 400);
      await admin.from('tg_session').upsert({ user_id: uid, session_id: sid });
      await admin.from('tg_pending').delete().eq('user_id', uid).eq('kind', 'login');
      await notifyAdmins(`🔑 ${u.user.email ?? 'istifadəçi'} panelə daxil oldu.`);
      return json({ ok: true });
    }

    return json({ error: 'Namelum emel' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
