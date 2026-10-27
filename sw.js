/* MUÑIZ Pedidos - service worker  ·  v223
   Two jobs: (1) load instantly and work offline in the field, (2) make sure
   nobody is stuck on an old version. Rules:
     · Same-origin app files (html/js/css/json) are NETWORK-FIRST with a short
       timeout: if there is signal the phone always runs the newest files;
       if not, it falls back to the copy it has. The network fetch asks the
       server to revalidate (no-cache), so unchanged files come back as a tiny
       304 and cost almost nothing.
     · When a new sw.js is published (this file changes), the new worker takes
       over immediately (skipWaiting + clients.claim). index.html listens for
       that hand-over and reloads the page - every open tab, every home-screen
       app - so a push reaches all phones the next time they look at it.
     · Product photos (remote) stay network-then-cache. Supabase REST, function
       and auth calls bypass the worker: nothing from the database is stored on the
       device, and the office machine stops filling Cache Storage with every poll (v213).
     · The phones pre-cache only the phone pages: the Command Center files are cached
       on first use by the office browser, not pushed to every foreman phone (v213).
     · sw.js itself is never answered from the phone's copy: updater.js reads it
       to know the published version (v213).
     · When code (html/js/css) has to come from the phone's copy, the page is
       told (MUNIZ_STALE, and in its MUNIZ_VERSION answer): it may be running an
       older version than the one published (v213).
     · v214: the office PIN lives in the database (parche175): MODO OFICINA asks office_unlock,
       the accepted PIN travels with PEDIR PARA and TICKET, config.js carries names only.
     · v215: supervisors enter the bandeja by tapping their name (parche176); only the office types a PIN.
     · v216: the Command Center's EDIT PO also changes a fuel PO's station (parche177).
     · v217: the Command Center's ACTIVITY room fits an iPhone (phone cards, feed times).
     · v218: the Command Center on a phone: rooms switch at once, ACTIVITY opens fast, search fits.
     · v219: tapping a room tab leaves the search (the box clears, the room shows).
     · v220: the fuel app no longer re-sends old failed attempts (they became ghost POs).
   Publishing rule: EVERY push must change this file (bump the version below).
   The version line is what makes phones notice. */
const CACHE = "muniz-pedidos-v223";
const SHELL = [
  "./","./index.html","./updater.js","./app.js","./styles.css","./pedidos-ui.css","./pedidos-motion.js","./manifest.json","./config.js","./link_rescue.js","./pedidos_db.js","./mz_track.js","./pedidos_menu.js","./catalog_ace.json","./catalog_cmc.json","./fotos_ace.json","./fotos_cmc.json","./catalog_rss.json","./fotos_rss.json","./catalog_whitecap.json","./fotos_whitecap.json","./fuel.html","./fuel.js","./fuel.css","./bandeja.html","./bandeja.js","./bandeja.css",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png"
];
const NET_TIMEOUT_MS = 3500;
/* without these the app cannot run: if they fail to download, the install fails
   and the phone KEEPS the version it has (old cache is never deleted first) */
const CRITICAL = ["./index.html","./updater.js","./app.js","./styles.css","./config.js","./link_rescue.js","./pedidos_db.js","./pedidos_menu.js","./fuel.js"];

self.addEventListener("install", (e) => { e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  const ok = await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "no-cache" })).then(() => u, () => null)));
  const missing = CRITICAL.filter(u => ok.indexOf(u) < 0);
  if (missing.length) { await caches.delete(CACHE); throw new Error("install incomplete: " + missing.join(",")); }
  self.skipWaiting();
})()); });

/* pages that run updater.js answer MUNIZ_ACK and reload themselves at a safe
   moment. Pages that DON'T answer are old builds with no updater: after 1.5 s
   the worker reloads them itself (client.navigate), so even phones stuck on a
   weeks-old version come over the first time they open the app. */
const acked = new Set();
self.addEventListener("activate", (e) => { e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
  const cl = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  cl.forEach(c => c.postMessage({ type: "MUNIZ_SW_ACTIVATED", cache: CACHE }));
  await new Promise(r => setTimeout(r, 1500));
  for (const c0 of cl) {
    if (acked.has(c0.id)) continue;                       // a page with updater.js: it reloads itself at a safe moment
    let c = null; try { c = await self.clients.get(c0.id); } catch (err) { }   // must be re-fetched right before navigate() or Chromium ignores it
    if (!c || typeof c.navigate !== "function") continue;
    try { await Promise.race([c.navigate(c.url), new Promise(r => setTimeout(r, 3000))]); } catch (err) { }   // the navigation happens; its promise may never settle
  }
})()); });

/* ---------- push notifications (Command Center) ----------
   The database pings notify-po, which sends a Web Push to every office phone
   that turned notifications on in Mando. We show it and, on tap, open Mando. */
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Muñiz · Command Center", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Muñiz · Command Center";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag,
    icon: "./icon-192.png", badge: "./icon-192.png", timestamp: d.ts || Date.now(),
    data: { url: d.url || "./mando.html" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  let target = new URL("./mando.html", self.registration.scope).href;   // only our own pages open from a notification
  try { const u = new URL((e.notification.data && e.notification.data.url) || "./mando.html", self.registration.scope); if (u.origin === self.location.origin) target = u.href; } catch (err) { }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mando = wins.find(c => /mando\.html/.test(c.url));
    if (mando) { try { await mando.focus(); if (typeof mando.navigate === "function") await mando.navigate(target); } catch (err) {} return; }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "MUNIZ_ACK" && e.source) acked.add(e.source.id);
  if (d.type === "MUNIZ_SKIP_WAITING") self.skipWaiting();
  if (d.type === "MUNIZ_VERSION" && e.source) e.source.postMessage({ type: "MUNIZ_SW_VERSION", cache: CACHE, stale: stale.has(e.source.id) });
});

/* pages whose code came from the cache because the network failed or was too slow (kept 10 min) */
const stale = new Map();
function markStale(id) {
  if (!id) return;
  const now = Date.now(); stale.set(id, now);
  stale.forEach((t, k) => { if (now - t > 600000) stale.delete(k); });
  self.clients.get(id).then(c => { if (c) c.postMessage({ type: "MUNIZ_STALE", cache: CACHE }); }, () => { });
}

function withTimeout(p, ms) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then(v => { clearTimeout(t); res(v); }, err => { clearTimeout(t); rej(err); }); });
}

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (/\/sw\.js$/.test(url.pathname)) return;         // the version check (updater.js) always asks the server
    const code = req.mode === "navigate" || /(\.(html?|js|css)|\/)$/.test(url.pathname), cid = e.resultingClientId || e.clientId;
    // app files: newest if there is signal, cached copy if not
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const res = await withTimeout(fetch(new Request(req, { cache: "no-cache" })), NET_TIMEOUT_MS);
        if (res && res.status === 200) { c.put(req, res.clone()); return res; }
        if (res && res.status === 304) { const cached = await c.match(req); if (cached) return cached; }
        const cached = await c.match(req); if (cached && code) markStale(cid); return cached || res;
      } catch (err) {
        const cached = await c.match(req); if (cached) { if (code) markStale(cid); return cached; }
        if (req.mode === "navigate") { const home = await c.match("./index.html"); if (home) { markStale(cid); return home; } }
        return Response.error();
      }
    })());
    return;
  }
  // Supabase REST, function and auth calls: straight to the network, never stored on the device
  if (/^\/(rest|functions|auth)\/v1\//.test(url.pathname)) return;
  // product photos (remote): try network, fall back to cache, else the emoji placeholder handles it
  e.respondWith((async () => {
    try { const res = await fetch(req);
      if (res && res.status === 200) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    } catch (err) { const cached = await caches.match(req); return cached || Response.error(); }
  })());
});
