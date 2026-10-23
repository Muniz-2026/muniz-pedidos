/* MUÑIZ Pedidos · actualizador  ·  v2.1
   v2.1 (23 oct 2026): la bandeja del supervisor también se actualiza sola (bandeja.js levanta __mzBusy mientras una
         tarjeta tiene cambios sin guardar, y entonces no se recarga); se quitan dos registros que nadie leía.
   v2.0 (22 oct 2026): un app que el teléfono deja abierto en memoria (sobre todo el ícono de la pantalla de
         inicio en iPhone) se podía quedar días con la versión vieja: solo recargaba cuando el worker nuevo
         "tomaba el control", y eso a veces no pasa o se queda esperando a que se cierre un PO de combustible
         que nadie cerró. Ahora la página sabe qué versión corre (la publicada cuando cargó; si el worker le
         sirvió código de la copia del teléfono por falta de señal, la del worker) y cada vez que el app
         vuelve a la pantalla, y cada 10 min, lee la publicada. Si va atrás, recarga sola en un momento
         seguro: nunca mientras se escribe, nunca a la mitad de un pedido o de un PO, ni con un PO en pantalla
         (se le enseña al de la bomba), ni mientras la persona lo está usando (espera a que regrese al app o
         a que no lo toque en 1 min). Si no es momento, lo vuelve a intentar cada 5 s.
         Cada carga, y los regresos después de un rato, dejan un registro "build" (events) con la versión que
         corre el teléfono: la oficina ve en el Command Center (sala ACTIVITY) qué teléfonos van atrasados.
   v1.0: registra sw.js; busca un worker nuevo al abrir, al volver a la pantalla y cada 10 min; cuando el
         worker nuevo toma el control recarga (nunca a la mitad de un PO: espera __mzFlushReload).
   El estado de pedidos vive en localStorage, así que recargar no pierde nada. */
(function () {
  var hasSW = "serviceWorker" in navigator;
  var ctl0 = hasSW ? navigator.serviceWorker.controller : null;   // el worker que sirvió esta página
  var had = !!ctl0;                                    // ya había un worker: entonces un cambio = versión nueva
  var pending = false, reloading = false, waitT = 0, BUILD = 0, PUB = 0, stale = false;
  var hiddenAt = 0, backAt = 0, touchedAt = 0, lastRep = 0, readyRes = null;
  var ready = new Promise(function (r) { readyRes = r; });
  /* pantallas donde recargar no estorba: lo que se ve vuelve igual (el carrito y la pantalla viven en el teléfono).
     Fuera de aquí: la lista para mandar, ¿YA LO MANDASTE?, las de aprobar y recoger, y los pasos del PO de combustible
     después de escoger la estación (TU PO ES … sigue en pantalla hasta SÍ, YA QUEDÓ). La bandeja del supervisor sí
     entra, pero bandeja.js levanta __mzBusy mientras una tarjeta tiene cantidades cambiadas o un motivo de rechazo
     escrito, y entonces no se recarga. fuel/para (el que escoge la oficina no se guarda) y fuel/oficina (login) quedan
     fuera a propósito. Una pantalla nueva de mz_track.js no recarga hasta que se agregue aquí */
  var SAFE = { inicio: 1, para: 1, prov: 1, menu: 1, pedir: 1, "pedir/foto": 1, listo: 1, hecho: 1, mis: 1,
               "fuel/inicio": 1, "fuel/nombre": 1, "fuel/est": 1, bandeja: 1 };
  function screen() { try { return window.MZT && window.MZT.screen ? String(window.MZT.screen() || "") : ""; } catch (e) { return ""; } }
  window.__mzUpd = function () { return { build: BUILD, pub: PUB, stale: stale, pending: pending, reloading: reloading, busy: !!window.__mzBusy, had: had, screen: screen() }; };
  function typing() { try { var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); } catch (e) { return false; } }
  /* nadie lo está usando: acaba de regresar al app y no ha tocado nada, o no lo toca hace 1 min */
  function idle() { return touchedAt <= backAt || Date.now() - touchedAt >= 60000; }
  function safe() {
    if (document.visibilityState !== "visible" || typing() || !idle()) return false;
    var s = screen();
    if (!s) return !window.__mzBusy;                                   // sin mz_track: como antes, solo cuida el PO abierto
    if (window.__mzBusy && !/^fuel\/(est|nombre)$/.test(s)) return false;   // un PO a medias o con el número en pantalla
    return !!SAFE[s];
  }
  function reload() { if (reloading) return; reloading = true; location.reload(); }
  function tryReload() {
    if (!pending || reloading) return;
    if (safe()) { reload(); return; }
    if (!waitT) waitT = setInterval(function () { if (!pending || reloading) { clearInterval(waitT); waitT = 0; return; } if (safe()) reload(); }, 5000);
  }
  window.__mzFlushReload = tryReload;                  // pedidos_menu.js la llama al cerrar el PO

  /* la versión: el número de sw.js (cada publicación lo sube). sw.js nunca sale de la copia del teléfono
     (el worker lo deja pasar directo al servidor), así que esto es lo publicado o nada (sin señal) */
  function verOf(t) { var m = /muniz-pedidos-v(\d+)/.exec(String(t || "")); return m ? +m[1] : 0; }
  function published() {
    try { return fetch("./sw.js", { cache: "no-store" }).then(function (r) { return r && r.ok ? r.text() : ""; }).then(verOf, function () { return 0; }); }
    catch (e) { return Promise.resolve(0); }
  }
  /* el worker: su versión, y si a esta página le sirvió código de la copia del teléfono (sin señal o lenta) */
  function fromWorker(w) {
    return new Promise(function (res) {
      try {
        var done = false; if (!w) { res({ v: 0 }); return; }
        var off = function () { navigator.serviceWorker.removeEventListener("message", on); };
        var on = function (ev) { var d = ev.data || {}; if (d.type === "MUNIZ_SW_VERSION" && !done) { done = true; off(); res({ v: verOf(d.cache), stale: !!d.stale }); } };
        navigator.serviceWorker.addEventListener("message", on);
        w.postMessage({ type: "MUNIZ_VERSION" });
        setTimeout(function () { if (!done) { done = true; off(); res({ v: 0 }); } }, 1500);
      } catch (e) { res({ v: 0 }); }
    });
  }
  /* una versión publicada se intenta una vez cada 10 min: si la recarga vuelve a salir de la copia vieja, no recarga en círculo */
  var K_TRY = "muniz_upd_try";
  function tried(v) { try { var t = JSON.parse(localStorage.getItem(K_TRY) || "null"); return !!(t && t.v === v && Date.now() - t.at < 600000); } catch (e) { return false; } }
  function behind() {
    if (!PUB || (BUILD && PUB <= BUILD) || tried(PUB)) return false;
    try { localStorage.setItem(K_TRY, JSON.stringify({ v: PUB, at: Date.now() })); } catch (e) { }
    return true;
  }

  /* el registro "build": qué versión corre este teléfono (y cuál está publicada) */
  function report(kind, away) {
    lastRep = Date.now();
    try {
      var c = window.MUNIZ_CONFIG || {}, S = c.SUPABASE || {}, K = String(S.ANON_KEY || "").trim();
      var U = String(S.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
      if (!U || !K) return;
      var pg = (location.pathname.split("/").pop() || "index.html").replace(/\.html?$/, ""), d = null, w = null;
      try {
        d = localStorage.getItem("muniz_device_id");
        if (!d) { d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); localStorage.setItem("muniz_device_id", d); }
      } catch (e) { d = null; }
      try { var p = JSON.parse(localStorage.getItem("muniz_pedido") || "null"); w = p && p.name ? String(p.name).toUpperCase().trim() : null; } catch (e) { }
      if (!w && pg === "fuel") try { w = String(JSON.parse(localStorage.getItem("muniz_fuel_me") || "\"\"") || "").toUpperCase().trim() || null; } catch (e) { }
      var m = { b: BUILD || null, pub: PUB || null, k: kind,
                sa: !!(navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)) };
      if (stale) m.st = 1;
      if (away) m.away = Math.round(away / 60000);
      fetch(U + "/rest/v1/events", { method: "POST", keepalive: true,
        headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ device_id: d, app: pg === "fuel" ? "fuel" : pg === "bandeja" ? "bandeja" : "pedidos", event: "build", who: w, meta: m }) }).catch(function () { });
    } catch (e) { }
  }

  var reg = null;
  function check() { try { if (reg && reg.update) reg.update().catch(function () { }); } catch (e) { } }
  if (hasSW) {
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!had) { had = true; return; }                  // primera instalación: no hay nada que recargar
      /* un worker nuevo tomó el control: recarga solo si es más nuevo que lo que corre esta página
         (si la página ya cargó la versión nueva de la red, no hace falta recargar otra vez) */
      ready.then(function () { return fromWorker(navigator.serviceWorker.controller); }).then(function (w) {
        if (!BUILD || !w.v || w.v > BUILD) { pending = true; tryReload(); }
      });
    });
    navigator.serviceWorker.addEventListener("message", function (ev) {
      var d = ev.data || {};
      if (d.type === "MUNIZ_SW_ACTIVATED") { try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: "MUNIZ_ACK" }); } catch (e) { } }
      if (d.type === "MUNIZ_STALE") stale = true;        // el worker sirvió código de la copia del teléfono
    });
    try { if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages(); } catch (e) { }
  }
  window.addEventListener("load", function () {
    if (hasSW) navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(function (r) {
      reg = r;
      if (r.waiting) r.waiting.postMessage({ type: "MUNIZ_SKIP_WAITING" });
      r.addEventListener("updatefound", function () {
        var nw = r.installing; if (!nw) return;
        nw.addEventListener("statechange", function () { if (nw.state === "installed" && r.waiting) r.waiting.postMessage({ type: "MUNIZ_SKIP_WAITING" }); });
      });
      check();
    }).catch(function () { });
    Promise.all([published(), fromWorker(ctl0)]).then(function (a) {
      var P = a[0], W = a[1].v;
      if (a[1].stale) stale = true;
      BUILD = stale ? (W || P) : (P || W);               // código de la copia del teléfono: cuenta la versión del worker, no la publicada
      if (P) PUB = P;
      readyRes();
      report("load", 0);
      if (PUB > BUILD) check();                          // la versión nueva llega con su worker (controllerchange)
    });
  });
  /* de regreso al app: ¿hay versión nueva? El registro solo si va atrás, si estuvo fuera 10 min o más,
     o si hace una hora que no manda uno (ir y volver de Mensajes no llena la tabla) */
  function back() {
    if (Date.now() - backAt < 2000) return;              // visibilitychange y pageshow del mismo regreso
    var away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0; backAt = Date.now();
    tryReload();                                         // una versión nueva ya estaba esperando
    check();
    ready.then(published).then(function (v) {
      if (v) PUB = v;
      var late = behind();
      if (late || away >= 600000 || Date.now() - lastRep >= 3600000) report("back", away);
      if (late) { pending = true; tryReload(); }
    });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") back(); else hiddenAt = Date.now(); });
  window.addEventListener("pageshow", function (ev) { if (ev.persisted) back(); });
  ["pointerdown", "keydown", "touchstart"].forEach(function (t) { document.addEventListener(t, function () { touchedAt = Date.now(); }, { capture: true, passive: true }); });
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    check();
    ready.then(published).then(function (v) { if (v) PUB = v; if (behind()) { pending = true; tryReload(); } });
  }, 10 * 60 * 1000);
})();
