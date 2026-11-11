/* Tətbiq kimi quraşdırma düyməsi (iOS + Android). Panel və sayt üçün ortaq. */
(function () {
  var KEY = 'pwaHide:' + location.pathname.replace(/[^a-z]/gi,'');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  var btn = document.getElementById('pwaBtn'), tip = document.getElementById('pwaTip'), dp = null;
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}
  function hide() { btn.style.display = 'none'; tip.style.display = 'none'; try { localStorage.setItem(KEY, '1'); } catch (e) {} }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); dp = e; btn.style.display = 'flex'; });
  window.addEventListener('appinstalled', hide);
  var ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var safari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  var android = /android/i.test(ua);
  if (ios || android) btn.style.display = 'flex';   // Android-də düymə hazır olanda da görünür; basanda ya sistem pəncərəsi, ya izah çıxır
  var X = '<div style="text-align:right;margin:-6px -4px 4px"><a href="#" id="pwaX" style="color:#888;text-decoration:none;font-size:18px">✕</a></div>';
  btn.addEventListener('click', function () {
    if (dp) { dp.prompt(); dp.userChoice.then(function () { dp = null; btn.style.display = 'none'; }); return; }
    var h;
    if (ios && !safari) h = '<b>iPhone/iPad:</b> bu brauzerdə quraşdırmaq olmur. Ünvanı kopyalayıb <b>Safari</b>-də açın (<b>skuterbaku.az/panel.html</b>), sonra Paylaş → <b>Ana ekrana əlavə et</b>.';
    else if (ios) h = '<b>iPhone/iPad (Safari):</b><br>1) Aşağıdakı <b>Paylaş</b> düyməsinə basın (kvadrat və ox işarəsi ⬆︎)<br>2) Aşağı sürüşdürüb <b>“Ana ekrana əlavə et”</b> seçin<br>3) <b>Əlavə et</b> basın';
    else h = '<b>Android:</b> brauzerin sağ yuxarı menyusunu (⋮) açın → <b>“Tətbiqi yüklə”</b> və ya <b>“Ana ekrana əlavə et”</b> seçin. (Chrome və ya Samsung Internet işlədin.)';
    tip.innerHTML = X + h; tip.style.display = 'block';
    var x = document.getElementById('pwaX'); if (x) x.onclick = function (e) { e.preventDefault(); tip.style.display = 'none'; };
  });
})();
