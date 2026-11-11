/* Supabase adapteri: tətbiq kodu "claude.use('db'|'assets'|'downloads')" ilə işləyir, burada eyni interfeys Supabase üzərində qurulur. */
(function () {
  'use strict';
  var cfg = window.SB_CONFIG || {};
  var sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  var BUCKET = 'media';

  /* ---------- giriş (login) ---------- */
  var resolveAuth, authed = new Promise(function (r) { resolveAuth = r; });
  var gate = document.createElement('div');
  gate.id = 'gate';
  gate.innerHTML = '<form id="gform"><h2>Skuter İcarə</h2><p class="muted">İdarəetmə panelinə giriş</p>' +
    '<div class="f"><label for="gem">E-poçt</label><input id="gem" type="email" autocomplete="username" required></div>' +
    '<div class="f"><label for="gpw">Şifrə</label><input id="gpw" type="password" autocomplete="current-password" required></div>' +
    '<div class="err" id="gerr" role="alert"></div><button class="primary" id="gbtn">Daxil ol</button></form>';
  var css = document.createElement('style');
  css.textContent = '#gate{position:fixed;inset:0;z-index:100;background:var(--bg);display:grid;place-items:center;padding:16px}' +
    '#gform{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:28px;width:min(380px,100%);display:grid;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.15)}' +
    '#gform h2{margin:0}#gform p{margin:0}' +
    '#logoutBtn{position:fixed;top:8px;right:8px;z-index:35;display:none}' +
    '@media(max-width:820px){#logoutBtn{display:block}}' +
    '.side #logoutBtn{position:static;display:block;margin-top:auto}';
  document.head.appendChild(css);
  document.body.appendChild(gate);

  function msg(t) { document.getElementById('gerr').textContent = t || ''; }
  async function enter(session) {
    var res = await sb.from('staff').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (res.error || !res.data) {
      await sb.auth.signOut();
      msg('Bu hesaba icazə verilməyib. Admin sizi əlavə etməlidir.');
      document.getElementById('gbtn').disabled = false;
      return false;
    }
    gate.remove();
    var lb = document.createElement('button');
    lb.id = 'logoutBtn'; lb.className = 'sm'; lb.textContent = 'Çıxış';
    lb.onclick = async function () { await sb.auth.signOut(); location.reload(); };
    var side = document.querySelector('.side');
    (side || document.body).appendChild(lb);
    resolveAuth();
    return true;
  }
  document.getElementById('gform').onsubmit = async function (e) {
    e.preventDefault(); msg(''); document.getElementById('gbtn').disabled = true;
    var r = await sb.auth.signInWithPassword({ email: document.getElementById('gem').value.trim(), password: document.getElementById('gpw').value });
    if (r.error) { msg('E-poçt və ya şifrə səhvdir.'); document.getElementById('gbtn').disabled = false; return; }
    await enter(r.data.session);
  };
  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) enter(r.data.session); });

  /* ---------- fayllar: şəxsi qovluq, "sb://yol" kimi saxlanır, göstərəndə imzalı linkə çevrilir ---------- */
  var signed = new Map(), rev = new Map();
  async function signRows(rows) {
    var paths = new Set();
    (function walk(v) {
      if (typeof v === 'string') { if (v.indexOf('sb://') === 0) paths.add(v.slice(5)); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k]); });
    })(rows.map(function (r) { return r.data; }));
    var now = Date.now();
    var need = Array.from(paths).filter(function (p) { var s = signed.get(p); return !s || s.exp < now; });
    if (need.length) {
      var r = await sb.storage.from(BUCKET).createSignedUrls(need, 86400);
      (r.data || []).forEach(function (d) {
        if (d.signedUrl) { signed.set(d.path, { url: d.signedUrl, exp: now + 20 * 3600e3 }); rev.set(d.signedUrl, 'sb://' + d.path); }
      });
    }
    function rep(v) {
      if (typeof v === 'string') { if (v.indexOf('sb://') === 0) { var s = signed.get(v.slice(5)); return s ? s.url : v; } return v; }
      if (Array.isArray(v)) return v.map(rep);
      if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = rep(v[k]); }); return o; }
      return v;
    }
    return rows.map(function (r) { return { id: r.id, data: rep(r.data) }; });
  }
  function unsign(v) {
    if (typeof v === 'string') return rev.get(v) || v;
    if (Array.isArray(v)) return v.map(unsign);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = unsign(v[k]); }); return o; }
    return v;
  }
  function fail(error) { var e = new Error(error.message || 'Xəta'); e.code = error.code; throw e; }

  /* ---------- verilənlər bazası (Firestore-a bənzər interfeys) ---------- */
  function listen(coll, only, emit, onErr) {
    var timer = null, dead = false;
    async function load() {
      var q = sb.from('docs').select('id,data').eq('coll', coll);
      if (only) q = q.eq('id', only);
      var r = await q;
      if (dead) return;
      if (r.error) { if (onErr) onErr({ message: r.error.message, code: r.error.code }); return; }
      emit(await signRows(r.data || []));
    }
    function later() { clearTimeout(timer); timer = setTimeout(load, 200); }
    var ch = sb.channel('docs-' + coll + '-' + (only || 'all') + '-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'coll=eq.' + coll }, later).subscribe();
    load();
    return function () { dead = true; clearTimeout(timer); sb.removeChannel(ch); };
  }
  function docRef(path) {
    var parts = path.split('/'), coll = parts[0], id = parts[1];
    return {
      id: id,
      onSnapshot: function (cb, errCb) {
        return listen(coll, id, function (rows) {
          var row = rows[0];
          cb({ exists: !!row, id: id, data: function () { return row ? row.data : undefined; } });
        }, errCb);
      },
      update: async function (data) { var r = await sb.rpc('doc_merge', { p_coll: coll, p_id: id, p_data: unsign(data) }); if (r.error) fail(r.error); },
      set: async function (data) { var r = await sb.from('docs').upsert({ coll: coll, id: id, data: unsign(data), updated_at: new Date().toISOString() }); if (r.error) fail(r.error); },
      delete: async function () { var r = await sb.from('docs').delete().eq('coll', coll).eq('id', id); if (r.error) fail(r.error); }
    };
  }
  var dbApi = {
    doc: docRef,
    collection: function (coll) {
      return {
        add: async function (data) {
          var id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
          var r = await sb.from('docs').insert({ coll: coll, id: id, data: unsign(data) });
          if (r.error) fail(r.error);
          return { id: id };
        },
        onSnapshot: function (cb, errCb) {
          return listen(coll, null, function (rows) {
            cb({ docs: rows.map(function (x) { return { id: x.id, data: function () { return x.data; } }; }) });
          }, errCb);
        }
      };
    }
  };

  var assetsApi = {
    upload: async function (file) {
      var ext = ((file.name || '').split('.').pop() || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
      var path = ((self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)) + (ext ? '.' + ext : '');
      var r = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (r.error) throw new Error(r.error.message || 'Fayl yüklənmədi');
      return { id: path, url: 'sb://' + path, sizeBytes: file.size, contentType: file.type };
    }
  };

  var dlApi = {
    save: async function (o) {
      var blob = new Blob([o.data], { type: /\.html$/i.test(o.filename) ? 'text/html;charset=utf-8' : 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = o.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }
  };

  /* Kirayəçi linki: birdəfəlik imza/yükləmə linki yaradır (köhnə açıq linklər ləğv olunur) */
  window.skLinks = {
    create: async function (o) {
      await authed;
      await sb.from('sign_links').update({ status: 'replaced' }).eq('contract_id', o.contractId).eq('kind', o.kind).eq('status', 'open');
      var a = new Uint8Array(18); crypto.getRandomValues(a);
      var token = Array.prototype.map.call(a, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      var r = await sb.from('sign_links').insert({
        token: token, contract_id: o.contractId, kind: o.kind, title: o.title, renter: o.renter, html: o.html,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString()
      });
      if (r.error) fail(r.error);
      return new URL('sign.html', location.href).href.split('#')[0].split('?')[0] + '#' + token;
    }
  };

  /* Ön sayt şəkilləri: ictimai "catalog" qovluğu; şəkil yüklənmədən əvvəl 1600 px-ə kiçildilir */
  function shrink(file) {
    return new Promise(function (res) {
      if (!/^image\//.test(file.type) || /svg|gif/.test(file.type)) return res(file);
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(u); res(file); };
      img.src = u;
    });
  }
  window.skPublic = {
    upload: async function (file) {
      await authed;
      var blob = await shrink(file);
      var id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      var path = 's/' + id + (blob === file ? '.' + (((file.name || '').split('.').pop() || 'jpg').replace(/[^A-Za-z0-9]/g, '').slice(0, 5)) : '.jpg');
      var r = await sb.storage.from('catalog').upload(path, blob, { contentType: blob.type || 'image/jpeg', cacheControl: '31536000' });
      if (r.error) throw new Error(r.error.message || 'Şəkil yüklənmədi');
      return sb.storage.from('catalog').getPublicUrl(path).data.publicUrl;
    }
  };

  /* Tətbiq "claude.use(...)" çağırır. Vəsiqə oxuma (sample) veb versiyada hələ yoxdur. */
  window.claude = {
    use: async function (name) {
      await authed;
      if (name === 'db') return dbApi;
      if (name === 'assets') return assetsApi;
      if (name === 'downloads') return dlApi;
      return null;
    }
  };
})();
