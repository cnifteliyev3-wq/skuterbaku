/* Vəsiqə şəklindən məlumat oxuma: OCR brauzerin içində işləyir (şəkil heç yerə göndərilmir).
   Yalnız dil faylları və Tesseract kitabxanası CDN-dən yüklənir. Nəticə həmişə istifadəçi tərəfindən yoxlanılmalıdır. */
(function (root) {
  'use strict';
  var TITLE = function (s, loc) {
    loc = loc || 'az';
    return String(s || '').toLocaleLowerCase(loc).replace(/(^|[\s-])(\S)/g, function (m, a, b) { return a + b.toLocaleUpperCase(loc); })
      .replace(/ Oğlu$/, ' oğlu').replace(/ Qızı$/, ' qızı');
  };
  var ISO = function (d, m, y) {
    d = +d; m = +m; y = +y;
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };
  var LETTERS = /^[A-ZƏĞİIÖÜÇŞ][A-ZƏĞİIÖÜÇŞ\s'-]{1,40}$/;

  /* MRZ (vəsiqənin arxasındakı 3 sətir, 30 simvol): doğum tarixi və ad üçün etibarlı mənbə */
  function parseMrz(lines) {
    var cand = lines.map(function (l) {
      return l.toUpperCase().replace(/\s+/g, '').replace(/[«‹(\[{]/g, '<');
    }).filter(function (l) { return l.length >= 24 && l.length <= 34 && (l.match(/</g) || []).length >= 3 && /^[A-Z0-9<]+$/.test(l); });
    var out = {};
    cand.forEach(function (l) {
      var m = l.match(/^(\d{2})(\d{2})(\d{2})\d[MF<]\d{6}/);        // 2-ci sətir: YYMMDD
      if (m) {
        var yy = +m[1], y = yy > (new Date().getFullYear() % 100) ? 1900 + yy : 2000 + yy;
        out.birth = ISO(m[3], m[2], y);
      }
      if (/^[A-Z]+<</.test(l) && !/\d/.test(l)) {                    // 3-cü sətir: SOYAD<<AD<AD
        var p = l.replace(/<+$/, '').split('<<');
        if (p[0]) out.surname = p[0].replace(/</g, ' ').trim();
        if (p[1]) out.given = p[1].replace(/</g, ' ').trim();
      }
      var s = l.match(/^[IAC]<?AZE([A-Z0-9]{8,9})/);                 // 1-ci sətir: sənəd nömrəsi
      if (s) out.docno = s[1].replace(/</g, '');
    });
    return out;
  }

  function after(lines, re, skip) {
    for (var i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        // dəyər eyni sətirdə (":" və ya "/" sonrası) ya da növbəti sətirlərdə
        for (var j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          var v = lines[j].trim();
          if (!v || (skip && skip.test(v))) continue;
          if (LETTERS.test(v.toUpperCase())) return v;
        }
      }
    }
    return '';
  }

  function parseId(text) {
    var raw = String(text || '');
    var lines = raw.split(/\r?\n/).map(function (l) { return l.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var up = lines.map(function (l) { return l.toLocaleUpperCase('az'); });
    var out = { name: '', fin: '', series: '', birth: '', address: '' };
    var mrz = parseMrz(lines);
    var LABEL = /SOYAD|SURNAME|ATASI|PATRONYM|GIVEN|DOĞUM|DOGUM|BIRTH|CINS|SEX|VƏTƏNDAŞ|CITIZEN|FİN|FIN\b|SERIYA|AZƏRBAYCAN|AZERBAIJAN|VƏSİQƏ|IDENTITY|CARD/;

    // FİN: 7 simvol (hərf+rəqəm). Etiketin yanında axtarılır, yoxdursa ayrıca sətirdə
    for (var i = 0; i < up.length && !out.fin; i++) {
      if (/F[İI]N/.test(up[i])) {
        var seg = up[i] + ' ' + (up[i + 1] || '');
        var m = seg.replace(/F[İI]N/g, ' ').match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{7}\b/);
        if (m) out.fin = m[0];
      }
    }
    if (!out.fin) {
      for (var k = 0; k < up.length; k++) {
        var m2 = up[k].match(/^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{7}$/);
        if (m2) { out.fin = m2[0]; break; }
      }
    }

    // Seriya/nömrə: AZE12345678 və ya AA1234567
    var all = up.join(' ');
    var sm = all.match(/\bAZE\s?(\d{8})\b/) || all.match(/\b([A-Z]{2}\s?\d{7})\b/);
    if (sm) out.series = sm[0].replace(/\s+/g, '');
    else if (mrz.docno) out.series = mrz.docno;

    // Ad / soyad / ata adı (ön üz)
    var sur = after(lines, /SOYAD|SURNAME/i, LABEL);
    var giv = after(lines, /^(ADI|AD\b|GIVEN)|\bADI\b.*GIVEN|GIVEN NAME/i, /SOYAD|SURNAME|ATASI|PATRONYM|DOĞUM/i);
    var pat = after(lines, /ATASININ|PATRONYM/i, LABEL);
    var fromMrz = !sur && !giv;
    sur = sur || (mrz.surname || '');
    giv = giv || (mrz.given || '');
    var parts = [sur, giv, pat].filter(Boolean).map(function (s) { return TITLE(s, fromMrz ? 'en' : 'az'); });
    out.name = parts.join(' ');

    // Doğum tarixi: MRZ varsa o; yoxdursa mətndəki ən qədim tarix (doğum < verilmə < bitmə)
    var dates = [], re = /(\d{2})[.\-/ ](\d{2})[.\-/ ](\d{4})/g, dm;
    while ((dm = re.exec(raw))) { var iso = ISO(dm[1], dm[2], dm[3]); if (iso) dates.push(iso); }
    out.birth = mrz.birth || (dates.length ? dates.slice().sort()[0] : '');

    // Ünvan (arxa üz)
    for (var a = 0; a < lines.length; a++) {
      if (/ÜNVAN|UNVAN|ADDRESS|QEYDİYYAT|QEYDIYYAT|YAŞAYIŞ|YASAYIS/i.test(lines[a])) {
        var acc = [], same = lines[a].split(/[:/]/).pop().trim();
        if (same && !/ÜNVAN|UNVAN|ADDRESS|QEYD|YAŞAYIŞ|YASAYIS/i.test(same) && same.length > 6) acc.push(same);
        for (var b = a + 1; b < Math.min(lines.length, a + 4); b++) {
          if (/[<]{2}/.test(lines[b]) || /ORGAN|AUTHORITY|VERILM|ISSUED|MÜDDƏT|EXPIR|CIN[SZ]|SEX/i.test(lines[b])) break;
          if (lines[b].length > 3) acc.push(lines[b].replace(/[,;\s]+$/, ''));
        }
        out.address = acc.join(', ');
        if (out.address) break;
      }
    }
    return out;
  }

  /* Şəkli OCR üçün hazırla: böyüt, boz tona çevir, kontrastı artır */
  async function prep(file) {
    var bmp = await createImageBitmap(file);
    var k = Math.min(2.5, 2200 / Math.max(bmp.width, bmp.height));
    if (k < 1) k = Math.max(k, 0.3);
    var c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    var g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height);
    var im = g.getImageData(0, 0, c.width, c.height), d = im.data, lo = 255, hi = 0, i, y;
    for (i = 0; i < d.length; i += 4) { y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; d[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
    var sc = hi > lo ? 255 / (hi - lo) : 1;
    for (i = 0; i < d.length; i += 4) { y = Math.max(0, Math.min(255, (d[i] - lo) * sc)); d[i] = d[i + 1] = d[i + 2] = y; }
    g.putImageData(im, 0, 0);
    return c;
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (root.Tesseract) return res();
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('OCR kitabxanası yüklənmədi')); };
      document.head.appendChild(s);
    });
  }
  async function read(files, onProgress) {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    var w = await root.Tesseract.createWorker('eng+aze', 1, { logger: function (m) { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); } });
    var text = '';
    try {
      for (var i = 0; i < files.length; i++) {
        var cv = await prep(files[i]);
        var r = await w.recognize(cv);
        text += '\n' + (r.data && r.data.text || '');
      }
    } finally { await w.terminate(); }
    return { text: text, fields: parseId(text) };
  }
  root.skIdOcr = { read: read, parse: parseId };
  if (typeof module !== 'undefined') module.exports = { parseId: parseId };
})(typeof window !== 'undefined' ? window : globalThis);
