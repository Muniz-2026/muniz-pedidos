/* MUÑIZ Pedidos - service worker  ·  v250
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
     · v226: a page this device has no copy of waits for the network instead of opening as another page (Oct 27:
       the Command Center opened as Pedidos). Only the phone pages fall back to the Pedidos home.
     · v227: the Command Center's browser tab shows its plain name (no badge count in front).
     · v234: the Command Center's Fleet room has no TRUCK IDLE tile (it counted 8 days and skid steers' work as truck idle).
     · v235: the Command Center's Fuel → IDLE tab has no IDLE · TRUCKS & PICKUPS total tile.
     · v236: the Command Center's ACTIVITY feed scrolls back through the whole day (it showed the newest 160 rows).
     · v237: the Command Center's Permits room: a ROW permit turns amber 14 days before it expires (parche188), and
       a permit replaced before its date reads "replaced · valid through <date>", not "expired".
     · v238: the fuel app refuses an odometer that doesn't match Fleetio + the GPS miles since (parche189; the
       office can still go ahead), and the Command Center's fuel PO window shows each PO's odometer check.
     · v239: the odometer never stops a fuel PO (Tito, Oct 29: "do not block anyone from being able to fuel"):
       a reading that doesn't match only warns, and the office sees the PO flagged (parche190).
     · v240: a long order's approval text carries a short link (texts over ~1,000 characters reached Miguel's phone
       without the order in the link): the supervisor's phone loads the order from the server (order_for_link,
       parche192); a cut link is rescued the same way; a link that can't open tells Tito and offers the Bandeja.
     · v241: the Command Center's Haul room has a FOREMEN side, and on it and on TRUCKERS the week of where each one
       worked (the job site the truck sat at most of the day, from its GPS, and that job's cost code from the crew
       emails), with an Excel of foremen and truckers for payroll (Claudia, Nov 6).
     · v242: weeks on that grid open at once (the nightly payroll_days answers when parche193 has run, the week before
       read ahead, GPS read eight trucks at a time otherwise), and the whole Command Center redraws and refreshes in the
       background without blocking a click or a scroll (Tito, Nov 6: "laggy and not very smooth").
     · v243: every map in the Command Center's Haul room has the Fleet / Live map's style switch (MAP, STREETS,
       NEARMAP AERIAL, LABELS).
     · v244: every Haul map zooms with the mouse wheel, like the Fleet map.
     · v245: a fuel PO that meets a moment with no signal tries again by itself (same tap, up to 25 s) before SIN SEÑAL;
       the Command Center shows such a blip in grey ("no signal for a moment · F#### went through 3 s later").
     · v246: the Command Center's Live map shows only what the board's tab lists (All, Crews, Moving, Idling, Dark).
     · v247: the phone app's iPhone pass (docs/DESIGN.md): readable sizes, 44 px taps, clear errors, undo, a page that
       opened from the phone's copy takes its files from that same copy at once (no 3.5 s wait per file).
     · v248: the OFICINA button and MODO OFICINA show only under an office name (Tito, Claudia). A phone where the office
       PIN had been entered showed them under every name tapped after it.
     · v249: tapping a notification opens the exact thing it is about: an order's push opens that order, a fuel PO's push
       that PO, an idle truck's push the Live map on that truck (Tito, Nov 9). The push's tag carries the id.
     · v250: speed, quick fixes after the Nov 9 audit: the pages connect to the database while they load, the catalog
       files start with the scripts, the Command Center builds its number / time formatters once and reads its ten live
       lists together on first load. Nothing changes in how phones cache or update.
   Publishing rule: EVERY push must change this file (bump the version below).
   The version line is what makes phones notice. */
const CACHE = "muniz-pedidos-v250";
const SHELL = [
  "./","./index.html","./updater.js","./app.js","./styles.css","./pedidos-ui.css","./pedidos-motion.js","./manifest.json","./config.js","./link_rescue.js","./pedidos_db.js","./mz_track.js","./pedidos_menu.js","./catalog_ace.json","./catalog_cmc.json","./fotos_ace.json","./fotos_cmc.json","./catalog_rss.json","./fotos_rss.json","./catalog_whitecap.json","./fotos_whitecap.json","./fuel.html","./fuel.js","./fuel.css","./bandeja.html","./bandeja.js","./bandeja.css",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png","./fuel.webmanifest"
];
const NET_TIMEOUT_MS = 3500;
/* without these the app cannot run: if they fail to download, the install fails
   and the phone KEEPS the version it has (old cache is never deleted first) */
const CRITICAL = ["./index.html","./updater.js","./app.js","./styles.css","./config.js","./link_rescue.js","./pedidos_db.js","./pedidos_menu.js","./fuel.js"];
/* the pages the phones keep a copy of: with no signal and no copy of their own, only these fall back to the Pedidos
   home. Any other page (the Command Center, admin) is only ever answered with itself (v226) */
const PHONE_PAGES = SHELL.filter(u => u === "./" || /\.html$/.test(u)).map(u => new URL(u, location.href).pathname);

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
    data: { url: d.url || "./mando.html", tag: d.tag || "" }
  }));
});
/* v249 · a tap opens the exact thing the push is about (Tito, Nov 9: "when i click on an order notification I want it to open up
   that exact order and not just take me to the orders tab. Same with the idle notification I want it to take me to the live tab
   and go to that exact fleet location that is idling"). The database names each push by what it is about — tag mat-/matpo-<order
   id>, fuel-<fuel PO id>, notracker-<F####>, fidle-/dump-<tracker id> — and the Command Center opens #order/…, #fuelpo/… and
   #unit/… (mando.js MZjump). Any other push keeps its own address. A notification shown before v249 has its tag on itself. */
function exactLink(url, tag) {
  const t = String(tag || ""); let m;
  if ((m = /^(?:mat|matpo)-(\d+)$/.exec(t))) return "./mando.html#order/" + m[1];
  if ((m = /^fuel-(\d+)$/.exec(t))) return "./mando.html#fuelpo/" + m[1];
  if ((m = /^notracker-(F\d+)$/i.exec(t))) return "./mando.html#fuelpo/" + m[1].toUpperCase();
  if ((m = /^(?:fidle|dump)-(\d+)$/.exec(t))) return "./mando.html#unit/" + m[1];
  return url;
}
function ourPage(u) { try { const x = new URL(u || "./mando.html", self.registration.scope); return x.origin === self.location.origin ? x.href : null; } catch (err) { return null; } }
/* an open Command Center from v249 on opens the link in place and answers MUNIZ_OPENED; an older one doesn't answer */
const asked = new Map();
function askPage(client, url) {
  return new Promise(res => {
    const id = Math.random().toString(36).slice(2);
    let t = 0;
    const done = ok => { clearTimeout(t); asked.delete(id); res(ok); };
    asked.set(id, () => done(true));
    t = setTimeout(() => done(false), 2000);
    try { client.postMessage({ type: "MUNIZ_OPEN", url: url, id: id }); } catch (err) { done(false); }
  });
}
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const plain = ourPage(data.url) || ourPage("./mando.html");   // only our own pages open from a notification
  const target = ourPage(exactLink(data.url, data.tag || e.notification.tag)) || plain;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mando = wins.find(c => /mando\.html/.test(c.url));
    if (!mando) { await self.clients.openWindow(target); return; }
    try { await mando.focus(); } catch (err) { }
    if (target !== plain && await askPage(mando, target)) return;
    /* a page from before v249 (or no answer): the push's own address, as before */
    if (typeof mando.navigate === "function") { try { await Promise.race([mando.navigate(plain), new Promise(r => setTimeout(r, 3000))]); } catch (err) { } }
  })());
});

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "MUNIZ_ACK" && e.source) acked.add(e.source.id);
  if (d.type === "MUNIZ_SKIP_WAITING") self.skipWaiting();
  if (d.type === "MUNIZ_OPENED" && asked.has(d.id)) asked.get(d.id)();   // v249: the page opened the notification's link
  if (d.type === "MUNIZ_VERSION" && e.source) e.source.postMessage({ type: "MUNIZ_SW_VERSION", cache: CACHE, stale: stale.has(e.source.id) });
});

/* v247: pages that just opened from the phone's copy: their files come from that copy at once for 20 s */
const fast = new Map();
function markFast(id) { if (!id) return; const now = Date.now(); fast.set(id, now); fast.forEach((t, k) => { if (now - t > 60000) fast.delete(k); }); }
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
    const nav = req.mode === "navigate", code = nav || /(\.(html?|js|css)|\/)$/.test(url.pathname), cid = e.resultingClientId || e.clientId;
    // app files: newest if there is signal, cached copy if not
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const ask = () => fetch(new Request(req, { cache: "no-cache" })), net = ask();
      if (!nav && cid && fast.has(cid) && Date.now() - fast.get(cid) < 20000) {
        const quick = await c.match(req);
        if (quick) { net.then(res => { if (res && res.status === 200) c.put(req, res.clone()); }, () => { }); return quick; }
      }
      try {
        const res = await withTimeout(net, NET_TIMEOUT_MS);
        if (res && res.status === 200) { c.put(req, res.clone()); return res; }
        if (res && res.status === 304) { const cached = await c.match(req); if (cached) return cached; }
        const cached = await c.match(req); if (cached && code) { markStale(cid); if (nav) markFast(cid); } return cached || res;
      } catch (err) {
        const cached = await c.match(req) || (nav ? await c.match(req, { ignoreSearch: true }) : undefined);
        if (cached) { if (code) markStale(cid); if (nav) markFast(cid); return cached; }
        if (nav && PHONE_PAGES.indexOf(url.pathname) >= 0) { const home = await c.match("./index.html"); if (home) { markStale(cid); markFast(cid); return home; } }
        /* no copy on this device (the Command Center is saved on first use, and every release starts an empty copy):
           a slow answer is still the right page, so wait for it; a page load asks again for ~8 s (a computer just
           back from sleep has no network for a moment). Never another page instead (v226) */
        let tries = nav ? 6 : 1;
        for (let p = net; ; p = ask()) {
          try { const res = await p; if (res && res.status === 200) c.put(req, res.clone()); return res; }
          catch (err2) { if (--tries <= 0) return Response.error(); }
          await new Promise(r => setTimeout(r, 1500));
        }
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
