/* ============================================================
   iDoris.ai — language toggle
   ------------------------------------------------------------
   English is the inline default (so default visitors get no
   flash of unstyled/wrong language). Chinese and Thai live in
   `data-zh` and `data-th` attributes and are swapped in on demand.

   Markup contract:
     <p data-zh="中文" data-th="ไทย">English</p>        → innerHTML swap
     <text data-zh="中文" data-th="ไทย">English</text>  → textContent swap (SVG)
     <title data-zh="中文标题" data-th="ชื่อไทย">English</title>
     <meta name="description" content="…" data-zh="中文描述" data-th="คำอธิบาย">

   Choice is persisted in localStorage and mirrored to <html lang>.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'idoris-lang';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SUPPORTED = { en: true, zh: true, th: true };
  var EN = new WeakMap(); // element → original English content

  function nodes() {
    return document.querySelectorAll('[data-zh], [data-th]');
  }

  // Cache the English original before the first swap, so toggling back
  // is lossless and doesn't depend on a second set of attributes.
  function cacheEnglish() {
    nodes().forEach(function (el) {
      if (EN.has(el)) return;
      if (el.tagName === 'META') EN.set(el, el.getAttribute('content'));
      else if (el.namespaceURI === SVG_NS) EN.set(el, el.textContent);
      else EN.set(el, el.innerHTML);
    });
  }

  function apply(lang) {
    if (!SUPPORTED[lang]) lang = 'en';

    nodes().forEach(function (el) {
      var next = lang === 'en' ? EN.get(el) : el.getAttribute('data-' + lang);
      if (next == null) return;
      if (el.tagName === 'META') el.setAttribute('content', next);
      else if (el.namespaceURI === SVG_NS) el.textContent = next;
      else el.innerHTML = next;
    });

    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    document.documentElement.setAttribute('data-lang', lang);

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      var on = btn.dataset.lang === lang;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode */ }
  }

  function initial() {
    // ?lang=zh or ?lang=th wins over everything, so a link can pin language.
    var q = new URLSearchParams(location.search).get('lang');
    if (SUPPORTED[q]) return q;

    var saved;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (SUPPORTED[saved]) return saved;

    // No stored choice: default to English, but respect obvious browser locale.
    var nav = navigator.language || '';
    if (/^zh\b/i.test(nav)) return 'zh';
    if (/^th\b/i.test(nav)) return 'th';
    return 'en';
  }

  function boot() {
    cacheEnglish();
    apply(initial());

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { apply(btn.dataset.lang); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
