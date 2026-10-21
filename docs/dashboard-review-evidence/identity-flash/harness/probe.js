// Identity-flash probe. Injected with add_init_script, so it runs at document
// creation in every top-level document (every navigation, every redirect hop),
// BEFORE any page script and before the first paint. It samples on every
// animation frame (rAF runs in the rendering step just before paint), every
// 50 ms, and on DOM mutations, and records only what a viewer can actually see:
//   - document.title (tab text) and the favicon <link> hrefs,
//   - visible text nodes (in the viewport, not covered by an overlay, not
//     transparent) that match a legacy or target identity pattern,
//   - visible <img> elements whose src is the legacy emblem,
//   - the text of the identity slots (header/sidebar/footer/splash) for a
//     human-readable timeline.
// Samples go to window.__frames and, on change, to the Python binding
// window.__flashEmit (survives navigations because it is context-wide).
// Read-only: it never touches storage, cookies or the network.
(() => {
  if (window.top !== window) return;
  if (window.__flashProbe) return;
  window.__flashProbe = 1;
  const LEG = [
    ['NHDW', /\bNHDW\b/],
    ['National Health Data Warehouse', /National\s+Health\s+Data\s+Warehouse/i],
    ['Federal Ministry of Health', /Federal\s+Ministry\s+of\s+Health/i],
    ['FMoH', /\bFMoH\b/],
  ];
  // Product names: count everywhere, including page content.
  const PRODUCT_KEYS = new Set(['NHDW', 'National Health Data Warehouse']);
  const LEG_ASSET = /logo-fmoh/i;
  const LEG_ALT = /Federal Ministry of Health/i;
  const TGT = [
    ['Data Intelligence Platform', /Data\s+Intelligence\s+Platform/i],
    ['Powered by Palladium', /Powered\s+by\s+Palladium/i],
    ['Palladium', /\bPalladium\b/],
  ];
  // Identity slots (chrome). Legacy text here always counts.
  const ID_SEL = [
    '.gov-mark', '.gov-skip', '.bi-sidehead', '.admin-sidehead', '.ws-sidehead',
    '.bi-sidebar-foot', '.admin-sidebar-foot', '.ws-side-foot', '.breadcrumb',
    '.foot-brand', '.ws-foot', 'footer', '.topbar .brand', '.brand', '.brand-name',
    '.brand-sub', '.stage-foot', '.hero-strip', '.strip', '[class*="strip-owner"]',
    '.ai-h-title', 'header',
  ].join(',');
  // An app shell is present -> text outside ID_SEL is "content"; otherwise the
  // whole page is identity ("page": Keycloak, 403, sign-in error, raw 404).
  const APP_SEL = '.gov, .bi-sidebar, .admin-side, .ws-side, .bi-topbar, #root > *';
  const MAX = 6000;
  window.__frames = [];
  let lastSig = '', lastEmitT = 0, lastRunT = 0, n = 0;

  const vw = () => window.innerWidth || 1440;
  const vh = () => window.innerHeight || 900;
  const inView = r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh() && r.left < vw();
  function transparent(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return true;
    }
    return false;
  }
  function hit(el, r) {
    const pts = [[r.left + Math.min(r.width / 2, 10), r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height / 2]];
    for (const [x0, y0] of pts) {
      const x = Math.min(Math.max(x0, 0), vw() - 1), y = Math.min(Math.max(y0, 0), vh() - 1);
      const h = document.elementFromPoint(x, y);
      if (h && (h === el || el.contains(h) || h.contains(el))) return true;
    }
    return false;
  }
  function overlayEl() {
    const c = document.elementFromPoint(vw() / 2, vh() / 2);
    for (let e = c; e && e.nodeType === 1 && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.position === 'fixed') {
        const r = e.getBoundingClientRect();
        if (r.width >= vw() * 0.9 && r.height >= vh() * 0.9) return e;
      }
    }
    return null;
  }
  function zoneOf(el, ov, hasApp) {
    if (ov && ov.contains(el)) return 'overlay';
    if (el.closest(ID_SEL)) return 'chrome';
    return hasApp ? 'content' : 'page';
  }
  const clip = (s, k) => (s || '').replace(/\s+/g, ' ').trim().slice(0, k);
  function urlShort() {
    try {
      const u = new URL(location.href);
      const q = [...u.searchParams.keys()];
      return u.host.split('.')[0] + u.pathname + (q.length ? '?' + q.join('&') : '') + (u.hash ? u.hash.slice(0, 40) : '');
    } catch (e) { return ''; }
  }

  function sample(src) {
    const t = performance.timeOrigin + performance.now();
    lastRunT = t;
    const title = document.title || '';
    const fav = [...document.querySelectorAll('link[rel~="icon"]')].map(l => l.getAttribute('href') || '');
    const hits = [];
    const tg = {};
    for (const [k, re] of LEG) if (re.test(title)) hits.push({ k, z: 'title', s: clip(title, 90) });
    for (const f of fav) if (LEG_ASSET.test(f)) hits.push({ k: 'logo-fmoh.png', z: 'favicon', s: f.split('/').pop() });
    for (const [k, re] of TGT) if (re.test(title)) tg[k] = 'title';
    const ids = [];
    let ov = null, ovText = '', hasApp = false, bodyLen = 0;
    const body = document.body;
    if (body) {
      hasApp = !!document.querySelector(APP_SEL);
      ov = overlayEl();
      if (ov) ovText = clip(ov.innerText, 120);
      const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node, legN = 0;
      while ((node = w.nextNode())) {
        const v = node.nodeValue;
        if (!v || v.length < 4) continue;
        bodyLen += v.length;
        let mk = null;
        for (const [k, re] of LEG) if (re.test(v)) { mk = k; break; }
        let tk = null;
        if (!mk) for (const [k, re] of TGT) if (!tg[k] && re.test(v)) { tk = k; break; }
        if (!mk && !tk) continue;
        const el = node.parentElement;
        if (!el || el.closest('script,style,noscript,template,title')) continue;
        const rg = document.createRange(); rg.selectNodeContents(node);
        const r = rg.getBoundingClientRect();
        if (!inView(r) || transparent(el) || !hit(el, r)) continue;
        const z = zoneOf(el, ov, hasApp);
        if (mk) { if (legN++ < 25) hits.push({ k: mk, z, s: clip(v, 90) }); }
        else tg[tk] = z;
      }
      for (const im of document.images) {
        const s = im.currentSrc || im.src || '';
        if (!LEG_ASSET.test(s) && !LEG_ALT.test(im.alt || '')) continue;
        if (!im.complete || !im.naturalWidth) continue;
        const r = im.getBoundingClientRect();
        if (!inView(r) || transparent(im) || !hit(im, r)) continue;
        hits.push({ k: 'logo-fmoh.png', z: zoneOf(im, ov, hasApp) === 'content' ? 'img' : zoneOf(im, ov, hasApp), s: s.split('/').pop().split('?')[0] });
      }
      const taken = [];
      document.querySelectorAll(ID_SEL).forEach(e => {
        if (ids.length >= 6 || taken.some(c => c.contains(e))) return;
        if (e.tagName === 'HEADER' && e.querySelector('.gov-mark, .breadcrumb, .brand')) return; // prefer the specific slot
        taken.push(e);
        const r = e.getBoundingClientRect();
        if (!inView(r) || transparent(e) || !hit(e, r)) return;
        const tx = clip(e.innerText, 90);
        if (tx) ids.push({ sel: (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : e.tagName.toLowerCase()), t: tx });
      });
    }
    // A hit counts unless it is ministry wording inside page content (articles
    // may legitimately cite the ministry as a source).
    for (const h of hits) h.c = !(h.z === 'content' && !PRODUCT_KEYS.has(h.k));
    const rec = { t, u: urlShort(), rs: document.readyState, title: clip(title, 120), fav: fav.map(f => f.split('/').pop()),
                  hits, tg, ids, ov: ovText, app: hasApp, len: bodyLen };
    const sig = JSON.stringify([rec.u, rec.title, rec.fav, hits.map(h => h.k + '|' + h.z + '|' + h.s), tg, ids, ovText, hasApp, bodyLen > 0]);
    n++;
    if (sig !== lastSig || t - lastEmitT > 1000) {
      rec.n = n; rec.src = src; rec.chg = sig !== lastSig;
      lastSig = sig; lastEmitT = t;
      if (window.__frames.length < MAX) window.__frames.push(rec);
      try { if (window.__flashEmit) window.__flashEmit(rec); } catch (e) { /* binding not ready */ }
    }
  }
  const safe = src => { try { sample(src); } catch (e) { /* never break the page */ } };
  safe('start');
  const raf = () => { safe('raf'); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  setInterval(() => safe('int'), 50);
  try {
    new MutationObserver(() => {
      const now = performance.timeOrigin + performance.now();
      if (now - lastRunT > 16) safe('mut');
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'src', 'style', 'class'] });
  } catch (e) { /* ignore */ }
  document.addEventListener('DOMContentLoaded', () => safe('dcl'));
  window.addEventListener('load', () => safe('load'));
  window.addEventListener('pagehide', () => safe('hide'));
})();
