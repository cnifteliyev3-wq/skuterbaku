/* Tətbiq kimi quraşdırma (iOS + Android). Panel və sayt üçün ortaq.
   Android/Chrome: 1 toxunuş + sistem təsdiqi. iOS: Apple başqa yol vermir, ona görə şəkilli addımlar göstərilir. */
(function () {
  var dp = null, KEY = 'pwaSkip:' + location.pathname.replace(/[^a-z]/gi, '');
  var ready = false, bar, sheet, pulse;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); dp = e; if (ready) show(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  var ua = navigator.userAgent;
  var ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var android = /android/i.test(ua);
  var safari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || !(ios || android)) return;
  function skipped() { try { return Date.now() < +localStorage.getItem(KEY); } catch (e) { return false; } }
  function skip(days) { try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch (e) {} }
  var css = '#pwaBar{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:99999;display:none;align-items:center;gap:12px;background:#2a0f66;color:#fff;border-radius:18px;padding:12px 14px;box-shadow:0 10px 30px rgba(20,5,60,.5);font:600 14px/1.3 system-ui,sans-serif}' +
    '#pwaBar img{width:44px;height:44px;border-radius:11px;flex:none}#pwaBar .t{flex:1}#pwaBar small{display:block;font-weight:500;opacity:.8;font-size:12px}' +
    '#pwaBar button{border:0;border-radius:12px;font:700 15px/1 system-ui,sans-serif;padding:12px 16px;cursor:pointer}#pwaGo{background:#ffd36b;color:#2a0f66}#pwaNo{background:transparent;color:#fff;opacity:.7;padding:8px}' +
    '#pwaSheet{position:fixed;inset:0;z-index:100000;display:none;background:rgba(10,0,30,.6);align-items:flex-end}#pwaSheet .c{background:#fff;color:#1d1230;width:100%;border-radius:22px 22px 0 0;padding:20px 20px calc(24px + env(safe-area-inset-bottom));font:500 16px/1.45 system-ui,sans-serif;max-height:90vh;overflow:auto}' +
    '#pwaSheet h3{margin:0 0 12px;font-size:19px}#pwaSheet ol{margin:0;padding:0;list-style:none;counter-reset:s}#pwaSheet li{counter-increment:s;display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid #eee}' +
    '#pwaSheet li:before{content:counter(s);flex:none;width:30px;height:30px;border-radius:50%;background:#6d2fe0;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}#pwaSheet li svg{flex:none;width:30px;height:30px}' +
    '#pwaSheet .ok{width:100%;margin-top:14px;border:0;border-radius:14px;background:#6d2fe0;color:#fff;font:700 16px/1 system-ui,sans-serif;padding:15px}' +
    '#pwaArrow{position:fixed;z-index:100001;display:none;font-size:42px;color:#ffd36b;text-shadow:0 2px 8px #000;animation:pwab 1s infinite}@keyframes pwab{50%{transform:translateY(-12px)}}';
  var SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>';
  var ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  var DOTS = '<svg viewBox="0 0 24 24" fill="#222"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    bar = document.createElement('div'); bar.id = 'pwaBar';
    bar.innerHTML = '<img src="img/icon-192.png" alt=""><div class="t">Telefona tətbiq kimi yüklə<small>Bir toxunuşla ana ekrana əlavə olunur</small></div><button id="pwaGo">Yüklə</button><button id="pwaNo" aria-label="Bağla">✕</button>';
    sheet = document.createElement('div'); sheet.id = 'pwaSheet';
    pulse = document.createElement('div'); pulse.id = 'pwaArrow'; pulse.textContent = '⬇';
    document.body.appendChild(bar); document.body.appendChild(sheet); document.body.appendChild(pulse);
    document.getElementById('pwaNo').onclick = function () { bar.style.display = 'none'; skip(3); };
    document.getElementById('pwaGo').onclick = go;
    sheet.onclick = function (e) { if (e.target === sheet || e.target.className === 'ok') close(); };
  }
  function close() { sheet.style.display = 'none'; pulse.style.display = 'none'; }
  function open(title, steps, arrow) {
    sheet.innerHTML = '<div class="c"><h3>' + title + '</h3><ol>' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol><button class="ok">Başa düşdüm</button></div>';
    sheet.style.display = 'flex';
    if (arrow) pulse.style.cssText = 'display:block;' + arrow;
  }
  function go() {
    if (dp) { var p = dp; dp = null; p.prompt(); p.userChoice.then(function (r) { if (r && r.outcome === 'accepted') bar.style.display = 'none'; }); return; }
    if (ios && !safari) return open('Safari-də açın', ['Ünvanı kopyalayın: <b>' + location.host + location.pathname + '</b>', '<b>Safari</b> brauzerini açıb ünvanı yapışdırın', 'Bu pəncərə orada yenidən çıxacaq'], '');
    if (ios) return open('iPhone-a yüklə', [SHARE + '<span>Aşağıdakı <b>Paylaş</b> düyməsinə basın (ortadakı kvadrat-ox)</span>', ADD + '<span>Siyahını yuxarı çəkin, <b>“Ana ekrana əlavə et”</b> seçin</span>', '<span>Sağ yuxarıda <b>Əlavə et</b> basın. Hazırdır!</span>'], 'bottom:6px;left:50%;margin-left:-16px');
    open('Android-ə yüklə', [DOTS + '<span>Brauzerin sağ yuxarı <b>⋮</b> menyusunu açın</span>', ADD + '<span><b>“Tətbiqi yüklə”</b> və ya <b>“Ana ekrana əlavə et”</b> seçin</span>', '<span>Təsdiq edin. Hazırdır!</span>'], 'top:6px;right:6px');
  }
  function show() { if (!skipped() && bar) bar.style.display = 'flex'; }
  window.addEventListener('appinstalled', function () { if (bar) bar.style.display = 'none'; close(); });
  function init() { build(); ready = true; setTimeout(show, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
