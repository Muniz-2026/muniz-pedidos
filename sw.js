/* MUÑIZ Pedidos - service worker  ·  v264
     · v264: Command Center Fleet / Live map: full screen (corner button, Esc to leave) + find any unit inside it.
     · v263: Command Center order window: the jobsite list = the scheduled jobs (jobsites table), not only past orders.
   Two jobs: (1) load instantly and work offline in the field, (2) make sure
   nobody is stuck on an old version. Rules:
     · Same-origin app files (html/js/css/json) are NETWORK-FIRST with a short
       timeout: if there is signal the phone always runs the newest files;
       if not, it falls back to the copy it has. The network fetch asks the
       server to revalidate (no-cache), so unchanged files come back as a tiny
       304 and cost almost nothing.
     · When a new sw.js is published (this file changes), the new worker takes
       over immediately (skipWaiting + clients.claim). Since v212 updater.js reloads
       each open page at a safe moment (never in the middle of an order or a PO); a page without it
       is reloaded by the worker after 1.5 s. So a push reaches all phones the next time they look.
     · Remote product photos go to the network: an <img> answer is opaque (status 0), so no copy is
       kept (Nov 10 audit). Supabase REST, function
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
     · v251: the product photos are kept in their own copy ("muniz-fotos") under the hash of their content, and a release
       no longer deletes or re-downloads them (it was 11 MB per phone per release). The catalog asks for a vendor's photos
       when that vendor is opened, not for all of them on every open. Code files: exactly as before.
     · v252: the Command Center's CREWS ON SITE comes from the foremen's trucks — where each has been working (payroll's
       places) and where it is now — not from the crew email (Tito, Nov 10). Phones: nothing changes.
     · v253: Pedidos' bottom bars end above the iPhone home indicator (index.html viewport-fit=cover: iOS answered
       0 for the safe area, and the green PEDIR PARA / MANDAR button ran off the bottom of the screen, Nov 10).
     · v254: Pedidos: the read-aloud buttons are gone for everyone (ESCUCHAR MI PEDIDO on the cart, ESCUCHAR EL
       PEDIDO on the supervisor's review, the Bandeja's speaker): 0 taps since Oct 22 (Tito, Nov 10: "it is not being used").
     · v255: Pedidos: the marking paint is ordered by the can (1–11) or by the box of 12, at most one box per order;
       a box goes in the order as 12 cans of the same code, the way ACE bills it (Tito, Nov 10). Everything else is unchanged.
     · v256: the Command Center's search opens the exact record: a fuel PO's window, an invoice's window (its lines),
       a statement ticket, a person's card, not only the room (Tito, Nov 10). Phones: nothing changes.
     · v257: Pedidos: the cart has no COPIAR TEXTO button (foremen's and supervisors' carts): MANDAR sends the order.
       It was tapped once in 3,865 taps since Oct 22 (Tito, Nov 10: "I do not understand the purpose of that").
     · v258: Pedidos: a short notice closes when the screen changes. "Pedido vaciado · DESHACER" stayed up
       to 10 s on the next screens, the name list too (Tito, Nov 10: "that looks buggy").
     · v259: the Command Center's fuel PO window gets NOTES, the same as an order's window: a running log,
       office only, who and when on every note (Tito, Nov 10). Phones: nothing changes.
     · v260: the Command Center's Fuel room has no STATION STATEMENTS tab or tile (Tito, Nov 10: "It is
       irrelevant"). The station tickets still reconcile the fuel POs. Phones: nothing changes.
     · v261: Pedidos: no screen flashes between a name and its menu. The menu showed for a frame before the office
       PIN pad, and the store list showed for a moment before the menu (after the PIN) (Tito, Nov 10: "glitchy").
     · v262: fixes from the Nov 10 audit. Command Center: three reads that the database cut at 1,000 rows (ODOMETER
       vs GPS, the Haul truckers' live trails, the events list) read every page; Spanish that still showed is English;
       duplicate orders have a tag and are not counted twice. Phones: ACTIVITY sees the real screen after IR AL INICIO on
       an approval link (and updater.js can update that phone); the office PARA MÍ name line is 13 px.
   Publishing rule: EVERY push must change this file (bump the version below).
   The version line is what makes phones notice. */
const CACHE = "muniz-pedidos-v264";
const SHELL = [
  "./","./index.html","./updater.js","./app.js","./styles.css","./pedidos-ui.css","./pedidos-motion.js","./manifest.json","./config.js","./link_rescue.js","./pedidos_db.js","./mz_track.js","./pedidos_menu.js","./catalog_ace.json","./catalog_cmc.json","./catalog_rss.json","./catalog_whitecap.json","./fuel.html","./fuel.js","./fuel.css","./bandeja.html","./bandeja.js","./bandeja.css",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png","./fuel.webmanifest"
];
const NET_TIMEOUT_MS = 3500;
/* without these the app cannot run: if they fail to download, the install fails
   and the phone KEEPS the version it has (old cache is never deleted first) */
const CRITICAL = ["./index.html","./updater.js","./app.js","./styles.css","./config.js","./link_rescue.js","./pedidos_db.js","./pedidos_menu.js","./fuel.js"];
/* the pages the phones keep a copy of: with no signal and no copy of their own, only these fall back to the Pedidos
   home. Any other page (the Command Center, admin) is only ever answered with itself (v226) */
const PHONE_PAGES = SHELL.filter(u => u === "./" || /\.html$/.test(u)).map(u => new URL(u, location.href).pathname);

/* v251 · product photos have their own copy on the phone, and a release does not throw it away. Before, every release
   emptied the whole copy and GitHub Pages stamps every file as new on each deploy, so each phone downloaded all the photos
   again (11 MB) after every release, and read 15 MB of them on every open. Each photo file is kept under the hash of its
   content (FOTOS): the same hash is answered from the phone with no request; a new hash is downloaded once.
   A release that changes a photo file rewrites FOTOS (tools/release/v251/fotos_map.js) — a stale hash = stale photos. */
const FOTOS = {"fotos_ace.json":"582812a5f09ab609","fotos_cmc.json":"90286523c228680c","fotos_rss.json":"a6c5348ab1ad210b","fotos_whitecap.json":"3a57f9ac70d5d66b","fotos_hd_ace.json":"c09dd4c4c46a81fc","fotos_hd_cmc.json":"0575ce31d4882ab8","fotos_hd_rss.json":"2b7a15006fb0d7ae","fotos_hd_whitecap.json":"be6f75079197b2a3"};
const FCACHE = "muniz-fotos";
const THUMBS = ["fotos_ace.json","fotos_cmc.json","fotos_rss.json","fotos_whitecap.json"];
const isFoto = n => Object.prototype.hasOwnProperty.call(FOTOS, n);
const fotoKey = n => new URL("./" + n + "?h=" + FOTOS[n], location.href).href;
const fotoBusy = new Map();
async function fotoSha(buf) { const d = await crypto.subtle.digest("SHA-256", buf); return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, "0")).join(""); }
/* older versions of a photo file go once its current version is on the phone (or the file is no longer used) */
async function fotoPrune(c) {
  const keep = new Set(Object.keys(FOTOS).map(fotoKey));
  for (const r of await c.keys()) {
    if (keep.has(r.url)) continue;
    const n = new URL(r.url).pathname.split("/").pop();
    if (!isFoto(n) || await c.match(fotoKey(n), { ignoreVary: true })) await c.delete(r);
  }
}
/* download one photo file into the photo copy (one download at a time per file); true = it is on the phone */
function fotoFill(n) {
  if (fotoBusy.has(n)) return fotoBusy.get(n);
  const p = (async () => {
    try {
      const c = await caches.open(FCACHE), key = fotoKey(n);
      if (await c.match(key, { ignoreVary: true })) return true;
      const res = await fetch(new Request("./" + n, { cache: "no-cache" }));
      if (!res || res.status !== 200) return false;
      await c.put(key, res);
      await fotoPrune(c);
      return true;
    } catch (err) { return false; } finally { fotoBusy.delete(n); }
  })();
  fotoBusy.set(n, p); return p;
}
/* the copies an earlier version kept inside its release copy move over, when they are byte for byte the current file */
async function fotoSeed() {
  const c = await caches.open(FCACHE);
  for (const n of Object.keys(FOTOS)) {
    try {
      if (await c.match(fotoKey(n), { ignoreVary: true })) continue;
      const old = await caches.match(new URL("./" + n, location.href).href, { ignoreVary: true });
      if (!old || old.status !== 200) continue;
      const buf = await old.arrayBuffer();
      if ((await fotoSha(buf)).slice(0, 16) !== FOTOS[n]) continue;
      await c.put(fotoKey(n), new Response(buf, { status: 200, headers: { "Content-Type": "application/json" } }));
    } catch (err) { }
  }
}
async function fotoServe(n) {
  try {
    const c = await caches.open(FCACHE), key = fotoKey(n);
    const hit = await c.match(key, { ignoreVary: true }); if (hit) return hit;
    await fotoFill(n);
    const got = await c.match(key, { ignoreVary: true }); if (got) return got;
  } catch (err) { }
  try { return await fetch("./" + n); } catch (err) { return Response.error(); }   // the copy could not be kept (no room): the network, as before
}

self.addEventListener("install", (e) => { e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  const ok = await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "no-cache" })).then(() => u, () => null)));
  const missing = CRITICAL.filter(u => ok.indexOf(u) < 0);
  if (missing.length) { await caches.delete(CACHE); throw new Error("install incomplete: " + missing.join(",")); }
  /* v251 · photos: what the phone already has moves over; only a missing or changed thumbnail file is downloaded */
  try { await fotoSeed(); await Promise.all(THUMBS.map(fotoFill)); } catch (err) { }
  self.skipWaiting();
})()); });

/* pages that run updater.js answer MUNIZ_ACK and reload themselves at a safe
   moment. Pages that DON'T answer are old builds with no updater: after 1.5 s
   the worker reloads them itself (client.navigate), so even phones stuck on a
   weeks-old version come over the first time they open the app. */
const acked = new Set();
self.addEventListener("activate", (e) => { e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE && k !== FCACHE).map(k => caches.delete(k)));
  try { await fotoPrune(await caches.open(FCACHE)); } catch (err) { }
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
  /* v251 · the page asks for a photo file to be kept (the ACE zoom photos): downloaded only if it is not on the phone */
  if (d.type === "MUNIZ_WARM_FOTOS" && Array.isArray(d.names)) e.waitUntil(Promise.all(d.names.filter(isFoto).map(fotoFill)));
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
    const fn = url.pathname.split("/").pop();
    if (isFoto(fn) && !url.search) { e.respondWith(fotoServe(fn)); return; }   // v251: photos from their own copy, by content hash
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
