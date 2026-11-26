/* =====================================================================
   MUÑIZ PEDIDOS · CAMIÓN (los camiones grandes)  ·  camion.js  ·  v1.1
   Dos pantallas nuevas, sin tocar app.js:
     · camion/parada — el chofer de camión: TU SIGUIENTE PARADA (rpc dsp_my_stop), y mientras el camión está
       parado: PROBLEMA, ACTIVAR AVISOS y la dirección para el mapa del teléfono. COMBUSTIBLE está siempre, desde el
       primer cuadro, también mientras el camión se mueve (spec2 §12.14a). Sin señal enseña lo último que llegó, con la
       hora en que se leyó.
     · camion/pedir — el mayordomo pide un camión: ¿QUÉ NECESITAS? → ¿CUÁNTO? → ¿DÓNDE? → ¿CUÁNDO? → PEDIR CAMIÓN
       (rpc dsp_request_create). Sin señal lo dice y lo intenta otra vez SOLO mientras sigue en esa pantalla, con el
       mismo client_ref; nunca después.
   Cómo entra: pedidos_menu.js abre un panel encima del app (como el combustible) y llama a mountTrucker / mountRequest.
   Todo lo nuevo depende de dsp_hello (cache 10 min en este teléfono): si falla, tarda, contesta algo raro o dice
   "off", pedidos_menu.js hace lo de hoy (el chofer va directo a combustible; el menú tiene sus dos tarjetas).
   Si este archivo no carga o truena, window.MunizCamion no existe y todo sigue como hoy.
   Nunca enseña precios. Nunca guarda claves (la clave de oficina solo viaja, como en pedidos_db.js).
   ===================================================================== */
(function () {
  try {
    "use strict";
    if (window.MunizCamion) return;
    var CFG = window.MUNIZ_CONFIG || {}, SB = CFG.SUPABASE || {};
    var URL_ = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
    var KEY = String(SB.ANON_KEY || "").trim();
    if (!URL_ || !KEY) return;                                   // sin base de datos: nada nuevo
    var VERSION = "1.1";                                          // 1.1 = round 4 (spec2 §12.14)
    var K_HELLO = "muniz_cam_hello", K_LAST = "muniz_cam_last", K_STOP = "muniz_cam_stop", K_PUSH = "muniz_cam_push", K_DEV = "muniz_device_id", K_PED = "muniz_pedido";
    var HELLO_MS = 10 * 60e3, MOVE_MAX_S = 1200;
    // round 4 (spec2 §12.14): a "live" trucker answer opens the stop up to 18 h (the 10 min only decide when to ask again);
    // after an ask that failed, no new ask for that name for 10 min (a tap: once a minute at most); "moving" only from an
    // answer read less than 3 min ago
    var HELLO_LIVE_MS = 18 * 3600e3, FAIL_MS = 10 * 60e3, TAP_MS = 60e3, MOVE_FRESH_MS = 3 * 60e3;
    var MODES = { off: 1, shadow: 1, live: 1 }, ROLES = { trucker: 1, practice: 1, requester: 1, none: 1 };

    /* ---------- utilidades ---------- */
    function up(s) { return String(s == null ? "" : s).toUpperCase().trim(); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function lget(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
    function deviceId() {
      try {
        var d = localStorage.getItem(K_DEV);
        if (!d) { d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); localStorage.setItem(K_DEV, d); }
        return d;
      } catch (e) { return "nodev"; }
    }
    function rid() { return "cam-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }
    function savedName() { var p = lget(K_PED, null); return p && p.name ? up(p.name) : ""; }
    function isOffice(n) { try { var o = CFG.OFICINA || {}; for (var k in o) if (up(k) === up(n)) return true; } catch (e) { } return false; }
    function practiceNames() { try { return ((CFG.CAMION || {}).PRACTICA || []).map(up); } catch (e) { return []; } }
    function isPractice(n) { return practiceNames().indexOf(up(n)) >= 0; }
    var PEOPLE = null;                                             // los nombres de config.js (los que salen en la lista)
    function isPerson(n) {
      if (!PEOPLE) { PEOPLE = {}; try { var F = CFG.COMBUSTIBLE || {}; [CFG.ASIGNACIONES, CFG.PERSONAL, CFG.SUPERVISORES, CFG.GERENTES, CFG.OFICINA, F.CHOFERES_CAMION, (CFG.CAMION || {}).PRACTICA].forEach(function (o) { if (o) (Array.isArray(o) ? o : Object.keys(o)).forEach(function (k) { PEOPLE[up(k)] = 1; }); }); } catch (e) { } }
      return !!PEOPLE[up(n)];
    }
    var TF = null;
    function hhmm(iso) {
      var t = iso ? new Date(iso) : null; if (!t || isNaN(t.getTime())) return "";
      try { if (!TF) { try { TF = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }); } catch (e) { TF = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }); } } return TF.format(t); }
      catch (e) { return t.getHours() + ":" + ("0" + t.getMinutes()).slice(-2); }
    }
    function isIOS() { try { return /iPhone|iPad|iPod/.test(navigator.userAgent || ""); } catch (e) { return false; } }
    function standalone() { try { return navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); } catch (e) { return false; } }

    /* ---------- la base de datos: una llamada, con tiempo límite ---------- */
    // resuelve {ok:true, j} (respuesta 2xx en JSON) o {ok:false, net:true|false, status}
    function rpc(fn, body, ms) {
      return new Promise(function (res) {
        var done = false, ac = null;
        function fin(v) { if (!done) { done = true; res(v); } }
        try { ac = new AbortController(); } catch (e) { }
        var to = setTimeout(function () { try { if (ac) ac.abort(); } catch (e) { } fin({ ok: false, net: true, timeout: true }); }, ms || 8000);
        try {
          fetch(URL_ + "/rest/v1/rpc/" + fn, { method: "POST", signal: ac ? ac.signal : undefined, cache: "no-store",
            headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
            .then(function (r) {
              return r.text().then(function (t) {
                clearTimeout(to);
                var j; try { j = JSON.parse(t); } catch (e) { return fin({ ok: false, net: false, status: r.status, junk: true }); }
                if (!r.ok) return fin({ ok: false, net: r.status >= 500 || r.status === 408 || r.status === 429, status: r.status, j: j });
                fin({ ok: true, j: j, status: r.status });
              });
            }, function () { clearTimeout(to); fin({ ok: false, net: true }); });
        } catch (e) { clearTimeout(to); fin({ ok: false, net: true }); }
      });
    }

    /* ---------- dsp_hello: ¿qué le toca a este nombre? (cache 10 min) ---------- */
    function validHello(h) {
      return !!(h && typeof h === "object" && !Array.isArray(h) && h.ok === true && MODES[h.mode] && ROLES[h.role]);
    }
    // each name: {at, h} = the last answer and when it was read; fa = when the last ask failed (the answer before it stays)
    function helloCached(name, maxMs) {
      var n = up(name); if (!n) return null;
      var c = lget(K_HELLO, {}) || {}, e = c[n];
      if (!e || !e.at || Date.now() - e.at > (maxMs || HELLO_MS) || Date.now() < e.at - 60000 || !validHello(e.h)) return null;
      return e.h;
    }
    function helloSave(c) {
      var keys = Object.keys(c);
      keys.sort(function (a, b) { return ((c[a] || {}).at || (c[a] || {}).fa || 0) - ((c[b] || {}).at || (c[b] || {}).fa || 0); });
      while (Object.keys(c).length > 8) delete c[keys.shift()];
      lset(K_HELLO, c);
    }
    function helloPut(name, h) {
      var c = lget(K_HELLO, {}) || {};
      c[up(name)] = { at: Date.now(), h: h };
      helloSave(c);
    }
    function helloFail(name) {                                     // round 4 · d: the ask failed; what was read before stays
      var c = lget(K_HELLO, {}) || {}, n = up(name), e = c[n] && typeof c[n] === "object" ? c[n] : {};
      c[n] = { at: e.at || 0, h: e.h || null, fa: Date.now() };
      helloSave(c);
    }
    function helloOff(name) {                                      // el servidor dijo "off": nadie ve nada nuevo
      helloPut(name, { ok: true, v: 1, mode: "off", world: "real", role: "none", can_request: false, truck: null });
    }
    function helloMode(name, mode) {                               // round 4 · f: dsp_my_stop says the mode is no longer live
      var c = lget(K_HELLO, {}) || {}, e = c[up(name)], h = e && validHello(e.h) ? JSON.parse(JSON.stringify(e.h)) : null;
      if (!h) return; h.mode = mode; helloPut(name, h);
    }
    var asking = {}, askedAt = {};
    // idle = the app asking on its own (warm); else a tap on a name / the menu: once a minute at most
    function ask(name, idle) {
      var n = up(name); if (!n) return Promise.resolve(null);
      if (asking[n]) return asking[n];
      var t = Date.now(), e = (lget(K_HELLO, {}) || {})[n];
      if (e && e.fa && t >= e.fa - 60000 && t - e.fa < (idle ? FAIL_MS : TAP_MS)) return Promise.resolve(null);   // backed off
      if (!idle && askedAt[n] && t - askedAt[n] < TAP_MS) return Promise.resolve(null);
      askedAt[n] = t;
      var p = rpc("dsp_hello", { p_name: n, p_device: deviceId() }, 4000).then(function (r) {
        delete asking[n];
        if (r.ok && validHello(r.j)) { helloPut(n, r.j); return r.j; }
        helloFail(n); return null;                                 // falla, tarda, 404, 429, rate o algo raro: lo de hoy
      }, function () { delete asking[n]; helloFail(n); return null; });
      asking[n] = p; return p;
    }
    /* "real" | "practice" | null: este nombre abre la pantalla del chofer en vez de lo de hoy.
       round 4 · f: "trucker + live" counts up to 18 h (the first tap of the day opens the stop; fuel is on it from the
       first paint, and the stop's own read sends him to today's fuel when the mode is no longer live) */
    function truckerWorld(name) {
      var h = helloCached(name, HELLO_LIVE_MS);
      if (h && h.role === "trucker" && h.mode === "live") return "real";
      h = helloCached(name);
      if (h && h.role === "practice" && h.mode !== "off" && isPractice(name)) return "practice";
      return null;
    }
    function wantsCard(name) {
      var h = helloCached(name); if (!h || h.mode === "off") return false;
      if (h.role === "trucker" || h.role === "practice") return false;
      return h.role === "requester" || h.can_request === true;
    }
    /* el nombre guardado: la respuesta se mantiene fresca mientras el app está a la vista (para que el toque decida al instante) */
    function warm() {
      try {
        if (document.visibilityState !== "visible") return;
        // the practice name is never kept fresh: it always opens its practice stop, and after ← the phone is not him (§12.14c)
        var c = lget(K_HELLO, {}) || {}, ns = [savedName(), up(lget(K_LAST, ""))].filter(function (n, i, a) { return n && a.indexOf(n) === i && !isPractice(n); });
        ns.forEach(function (n) { var e = c[n]; if (!e || !e.at || Date.now() - e.at > 8 * 60e3) ask(n, true); });
      } catch (e) { }
    }
    setTimeout(warm, 300);
    document.addEventListener("visibilitychange", warm);
    setInterval(warm, 60000);
    // un nombre tocado en la lista: se pregunta ya (la próxima vez el toque decide sin esperar)
    document.addEventListener("click", function (ev) {
      try {
        var b = ev.target && ev.target.closest ? ev.target.closest("button") : null; if (!b) return;
        var t = up((b.textContent || "").replace(/\s+/g, " ")); if (!t || t.length > 40 || !/^[A-ZÁÉÍÓÚÜÑ]+( [A-ZÁÉÍÓÚÜÑ]+)+$/.test(t)) return;
        if (!isPerson(t) || isPractice(t)) return;
        lset(K_LAST, t);                                         // el último nombre tocado en este teléfono: se mantiene fresco (warm)
        var c = lget(K_HELLO, {}) || {}, e = c[t]; if (!e || !e.at || Date.now() - e.at > 8 * 60e3) ask(t);
      } catch (e) { }
    }, true);

    /* ---------- palabras ---------- */
    var WHAT = { base: "BASE", sand: "ARENA", topsoil: "TIERRA NEGRA", loam: "LOAM", stone: "PIEDRA", mulch: "MULCH", cold_mix: "COLD MIX",
                 other: "OTRO", concrete: "CONCRETO", dirt: "TIERRA" };
    // the database gives one code or several ("base, sand": a dump stop carries every load in the bed); an unknown code is shown as is
    function whatEs(w) { return String(w || "").split(/\s*,\s*/).filter(Boolean).map(function (x) { var k = x.toLowerCase().trim(); return WHAT[k] || up(x); }).join(" + "); }
    function amountEs(a) {
      var x = +a; if (!x || x === 1) return "";
      if (Math.abs(x - 0.25) < 0.01) return "¼"; if (Math.abs(x - 0.5) < 0.01) return "½"; if (Math.abs(x - 0.75) < 0.01) return "¾";
      return String(Math.round(x * 100) / 100);
    }
    function actionEs(s) {
      var w = whatEs(s.what), a = amountEs(s.amount);
      switch (String(s.action || "")) {
        case "load": return ("CARGAR " + w + (a ? " " + a : "")).trim();
        case "unload": return ("DESCARGAR " + w + (a ? " " + a : "")).trim();
        case "pick": return ("RECOGER " + w + (a ? " " + a : "")).trim();
        case "dump": return "TIRAR" + (w ? " " + w : "");
        case "wait": return "ESPERAR";
        case "home": return "REGRESAR";
        default: return up(s.action || "PARADA");
      }
    }
    function placeName(s) { return (s && s.place && s.place.name) || (s && s.jobsite) || "Lugar sin nombre"; }
    function mapsHref(s) {
      var p = s && s.place; if (!p || p.lat == null || p.lon == null || isNaN(+p.lat) || isNaN(+p.lon)) return "";
      var ll = (+p.lat).toFixed(6) + "," + (+p.lon).toFixed(6);
      return isIOS() ? "https://maps.apple.com/?daddr=" + ll + "&dirflg=d" : "https://www.google.com/maps/dir/?api=1&destination=" + ll;
    }

    /* ---------- lo que está montado ---------- */
    var cur = null;                                               // {kind, el, stop()}
    function unmount() {
      var c = cur; cur = null; if (!c) return;
      try { c.stop(); } catch (e) { }
      try { c.el.innerHTML = ""; c.el.classList.remove("mzc-host"); } catch (e) { }
    }
    function setScr(el, s) { try { el.setAttribute("data-scr", s); } catch (e) { } }
    function btn(cls, label, mzt, attrs) {
      return '<button type="button" class="mzc-btn ' + cls + '" data-mzt="' + esc(mzt || label) + '"' + (attrs || "") + '>' + label + '</button>';
    }
    function header(title, sub) {
      return '<div class="mzc-head"><button type="button" class="mzc-back" aria-label="Regresar" data-mzt="←" data-act="back">←</button>' +
        '<div class="mzc-htx"><h1 tabindex="-1">' + esc(title) + '</h1>' + (sub ? '<div class="mzc-hsub">' + esc(sub) + '</div>' : '') + '</div></div>';
    }

    /* =====================================================================
       camion/parada · la pantalla del chofer
       opts: {who, world: "real"|"practice", onFuel(), onClose(), onFallback(why)}
       ===================================================================== */
    function mountTrucker(el, opts) {
      unmount();
      opts = opts || {};
      var who = up(opts.who), world = opts.world === "practice" ? "practice" : "real";
      var st = { ans: null, readAt: 0, stale: false, updating: false, first: true, sheet: null, sheetMsg: "", sending: false, newAt: 0, lastNowId: null, msg: "", pushMsg: "" };
      var saved = lget(K_STOP, null);
      if (saved && saved.who === who && saved.world === world && saved.ans && Date.now() - saved.at < 18 * 3600e3) { st.ans = saved.ans; st.readAt = saved.at; st.updating = true; st.lastNowId = saved.ans.now ? saved.ans.now.id : null; }
      var alive = true, timer = 0;
      el.classList.add("mzc-host"); setScr(el, "camion/parada");

      // round 4 · a: "moving" only from an answer read less than 3 min ago; an older one, or one kept after a failed read
      // (st.stale), counts as standing. It only hides PROBLEMA, the maps link and ACTIVAR AVISOS: COMBUSTIBLE never waits.
      function moving() {
        var a = st.ans; if (!a || a.moving !== true || st.stale || !st.readAt) return false;
        var held = Date.now() - st.readAt; if (held < -60000 || held > MOVE_FRESH_MS) return false;
        return (+a.gps_age_s || 0) + held / 1000 <= MOVE_MAX_S;
      }
      function stopCard(s) {
        var isNew = st.newAt && Date.now() - st.newAt < 120000;
        var arr = s.status === "arrived" ? '<span class="mzc-pill go">YA LLEGASTE</span>' : "";
        var whoFor = s.for_who ? '<div class="mzc-for">PARA ' + esc(up(s.for_who)) + '</div>' : (s.jobsite && s.jobsite !== placeName(s) ? '<div class="mzc-for">' + esc(s.jobsite) + '</div>' : "");
        var hr = hhmm(s.planned_arrive);
        return '<div class="mzc-card mzc-stop' + (isNew ? ' new' : '') + '">' +
          '<div class="mzc-lab">TU SIGUIENTE PARADA' + (isNew ? ' <span class="mzc-pill warn">NUEVA</span>' : '') + arr + '</div>' +
          '<div class="mzc-act">' + esc(actionEs(s)) + '</div>' +
          '<div class="mzc-place">' + esc(placeName(s)) + '</div>' + whoFor +
          (hr ? '<div class="mzc-hr">COMO A LAS ' + esc(hr) + '</div>' : '') +
          // the stop's note is the office's (English: "PROBLEM site_not_ready", "request cancelled by the sender"): never shown here

        '</div>';
      }
      function render() {
        if (!alive) return;
        var a = st.ans, now = a && a.now, nxt = a && a.next, mv = moving(), h = "";
        if (world === "practice") h += '<div class="mzc-band" role="note">PRÁCTICA · CAMIÓN DE MENTIRA · NADA ES REAL</div>';
        h += header("MI CAMIÓN", who + (a && a.truck && a.truck.label ? " · " + a.truck.label : ""));
        h += '<div class="mzc-body">';
        if (st.stale && st.readAt) h += '<div class="mzc-status warn" role="status">SIN SEÑAL · lo último que llegó, leído a las ' + esc(hhmm(new Date(st.readAt).toISOString())) + '</div>';
        else if (st.readAt && st.updating) h += '<div class="mzc-status" role="status">Actualizando… · lo último, leído a las ' + esc(hhmm(new Date(st.readAt).toISOString())) + '</div>';
        else if (st.readAt) h += '<div class="mzc-status" role="status">Leído a las ' + esc(hhmm(new Date(st.readAt).toISOString())) + '</div>';
        else if (st.first) h += '<div class="mzc-status" role="status">Buscando tu parada…</div>';
        if (world === "practice" && st.off) h += '<div class="mzc-card mzc-stop none"><div class="mzc-act">PRÁCTICA APAGADA</div><div class="mzc-place">El sistema de camiones está apagado. Regresa con ←.</div></div>';
        else if (world === "practice" && !a && !st.first) h += '<div class="mzc-card mzc-stop none"><div class="mzc-act">SIN SEÑAL</div><div class="mzc-place">No se pudo leer la parada de práctica. Regresa con ← o espera.</div></div>';
        if (a) {
          if (now) h += stopCard(now);
          else h += '<div class="mzc-card mzc-stop none"><div class="mzc-act">SIN PARADA POR AHORA</div><div class="mzc-place">Tacho te llama</div></div>';
          if (now && nxt) h += '<div class="mzc-after"><span class="mzc-lab">DESPUÉS</span> ' + esc(actionEs(nxt)) + ' · ' + esc(placeName(nxt)) + (hhmm(nxt.planned_arrive) ? ' · ' + esc(hhmm(nxt.planned_arrive)) : '') + '</div>';
        }
        // round 4 · a: on the real screen COMBUSTIBLE is there from the first paint and in every state (reading, moving, no
        // signal, no stop); while moving only PROBLEMA, the maps link and ACTIVAR AVISOS (and the practice buttons) wait
        var rest = !mv && !(world === "practice" && !a) && (a || !st.first), acts = "";
        if (rest && world === "practice" && now) {
          acts += now.status === "arrived" ? btn("go big", "LISTO", "PRÁCTICA · LISTO", ' data-act="done"') : btn("go big", "LLEGUÉ", "PRÁCTICA · LLEGUÉ", ' data-act="arrived"');
        }
        if (rest && world === "practice") acts += btn("action", "🚛 PEDIR CAMIÓN (PRÁCTICA)", "PRÁCTICA · PEDIR CAMIÓN", ' data-act="request"');
        var href = rest && now ? mapsHref(now) : "";
        if (href) acts += '<a class="mzc-btn sec mzc-map" href="' + esc(href) + '" target="_blank" rel="noopener" data-mzt="CÓMO LLEGAR">📍 ' + esc(placeName(now)) + '<span>ABRIR EN EL MAPA</span></a>';
        if (world === "real") acts += btn("fuel big", "⛽ COMBUSTIBLE", "COMBUSTIBLE", ' data-act="fuel"');   // práctica: nunca un PO real
        if (rest && now) acts += btn("stop", "PROBLEMA", "PROBLEMA", ' data-act="problem"');
        if (rest) acts += pushBlock();
        if (mv) h += '<div class="mzc-moving" role="note">' + (world === "real" ? "MANEJANDO · los demás botones salen cuando el camión se pare" : "MANEJANDO · los botones salen cuando el camión se pare") + '</div>';
        if (acts) h += '<div class="mzc-acts">' + acts + '</div>';
        if (st.msg) h += '<div class="mzc-toast" role="status">' + esc(st.msg) + '</div>';
        h += '</div>';
        if (st.sheet) h += sheetHTML();
        el.innerHTML = h;
      }
      /* ---- avisos (push) ---- */
      // this phone's notifications: dsp_my_stop says push 'none' | 'asked' | 'approved' (spec2 §12.11K, by this device's id); the
      // phone's own mark (asked after ACTIVAR AVISOS) counts only while the database has not said
      function pushState() {
        var a = st.ans; if (a && (a.push === "none" || a.push === "asked" || a.push === "approved")) return a.push;
        var p = lget(K_PUSH, {}) || {}; return p[who] && p[who].asked ? "asked" : "none";
      }
      function pushBlock() {
        try {
          if (st.pushMsg) return '<div class="mzc-info">' + esc(st.pushMsg) + '</div>';
          var ps = pushState();
          if (ps === "approved") return '<div class="mzc-info ok">🔔 AVISOS ACTIVADOS en este teléfono</div>';
          if (ps === "asked") return '<div class="mzc-info">🔔 AVISOS PEDIDOS · la oficina tiene que aprobar este teléfono. Tu parada sigue saliendo aquí.</div>';
          if (isIOS() && !standalone()) return '<div class="mzc-info"><b>AVISOS:</b> abre el app desde su ícono. Toca Compartir ↑ y luego “Agregar a inicio”; después ábrelo desde ese ícono.</div>';
          if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "";
          if (Notification.permission === "denied") return '<div class="mzc-info">Los avisos están bloqueados en este teléfono.</div>';
          return btn("sec", "🔔 ACTIVAR AVISOS", "ACTIVAR AVISOS", ' data-act="push"');
        } catch (e) { return ""; }
      }
      function b64u(s) { s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
      function activatePush() {
        st.pushMsg = "Activando avisos…"; render();
        var fail = function (m) { st.pushMsg = m; render(); };
        try {
          Notification.requestPermission().then(function (perm) {
            if (perm !== "granted") return fail("Sin permiso no llegan avisos. Tu parada sigue saliendo aquí.");
            var ready = new Promise(function (res, rej) { navigator.serviceWorker.ready.then(res, rej); setTimeout(function () { rej(new Error("sw")); }, 6000); });
            return rpc("push_public_key", {}, 8000).then(function (k) {
              if (!k.ok || typeof k.j !== "string" || !k.j) return fail("No se pudieron activar los avisos. Intenta otra vez con señal.");
              return ready.then(function (reg) {
                return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(k.j) }); });
              }).then(function (sub) {
                var j = sub.toJSON ? sub.toJSON() : {}, ks = j.keys || {};
                return rpc("dsp_push_subscribe", { p: { name: who, device: deviceId(), endpoint: j.endpoint, p256dh: ks.p256dh, auth: ks.auth, ua: String(navigator.userAgent || "").slice(0, 200) } }, 10000);
              }).then(function (r) {
                if (r && r.ok && r.j && r.j.ok) {                  // {ok, approved: false}: asked; the office approves it
                  var p = lget(K_PUSH, {}) || {}; p[who] = { asked: true, at: Date.now() }; lset(K_PUSH, p);
                  if (st.ans) st.ans.push = r.j.approved === true ? "approved" : "asked";
                  st.pushMsg = ""; render();
                }
                else fail(r && r.j && r.j.why === "too_many" ? "Ya hay tres teléfonos con avisos para este nombre. Pide a la oficina que quite uno." : "No se pudieron activar los avisos. Intenta otra vez con señal.");
              });
            });
          }).catch(function () { fail("No se pudieron activar los avisos en este teléfono."); });
        } catch (e) { fail("No se pudieron activar los avisos en este teléfono."); }
      }
      /* ---- PROBLEMA ---- */
      var REASONS = [["cannot_load", "NO SE PUEDE CARGAR"], ["site_not_ready", "LA OBRA NO ESTÁ LISTA"], ["truck", "PROBLEMA CON EL CAMIÓN"], ["other", "OTRO"]];
      function sheetHTML() {
        var s = st.sheet, h = '<div class="mzc-veil"></div><div class="mzc-sheet" role="dialog" aria-modal="true" aria-label="Problema"><div class="mzc-handle"></div>' +
          '<h2>¿QUÉ PASÓ?</h2><div class="mzc-list">';
        REASONS.forEach(function (r) { h += btn("chip" + (s.reason === r[0] ? " on" : ""), r[1], "PROBLEMA · " + r[1], ' data-act="reason" data-v="' + r[0] + '" aria-pressed="' + (s.reason === r[0]) + '"'); });
        h += '</div>';
        if (s.reason === "other") h += '<label class="mzc-flab" for="mzc-pnote">CUÉNTALE A LA OFICINA (corto)</label><textarea id="mzc-pnote" class="mzc-field" maxlength="140" rows="2" autocomplete="off">' + esc(s.note || "") + '</textarea>';
        if (st.sheetMsg) h += '<div class="mzc-status warn" role="alert">' + esc(st.sheetMsg) + '</div>';
        h += '<div class="mzc-row">' + btn("sec", "CANCELAR", "PROBLEMA \u00b7 CANCELAR", ' data-act="sheet-x"') +
          btn("go", st.sending ? "MANDANDO…" : "AVISAR A LA OFICINA", "AVISAR A LA OFICINA", ' data-act="sheet-send"' + (s.reason && !st.sending && (s.reason !== "other" || String(s.note || "").trim()) ? "" : " disabled")) + '</div>' +
          (s.reason === "other" && !String(s.note || "").trim() ? '<div class="mzc-hint">Con OTRO, escribe qué pasó.</div>' : '') + '</div>';
        return h;
      }
      function openSheet() { st.sheet = { reason: "", note: "" }; st.sheetMsg = ""; window.__mzBusy = true; render(); }
      function closeSheet() { st.sheet = null; st.sheetMsg = ""; st.sending = false; window.__mzBusy = false; render(); try { if (window.__mzFlushReload) window.__mzFlushReload(); } catch (e) { } }
      function sendProblem() {
        var s = st.sheet, a = st.ans; if (!s || !s.reason || st.sending || !a || !a.now) return;
        var ta = el.querySelector("#mzc-pnote"); if (ta) s.note = ta.value;
        st.sending = true; st.sheetMsg = ""; render();
        rpc("dsp_stop_tap", { p: { name: who, device: deviceId(), stop_id: a.now.id, tap: "problem", reason: s.reason, note: String(s.note || "").slice(0, 140) } }, 10000).then(function (r) {
          if (!alive || !st.sheet) return;
          st.sending = false;
          if (r.ok && r.j && r.j.ok) { closeSheet(); toast("AVISADO · la oficina ya lo ve"); return; }
          st.sheetMsg = r.net ? "SIN SEÑAL · no se mandó. Toca otra vez cuando tengas señal." : whyEs(r.j && r.j.why, r.j && r.j.detail);
          render();
        });
      }
      /* ---- práctica: LLEGUÉ / LISTO mueven el camión de mentira ---- */
      function practiceTap(tap) {
        var a = st.ans; if (!a || !a.now) return;
        rpc("dsp_stop_tap", { p: { name: who, device: deviceId(), stop_id: a.now.id, tap: tap } }, 10000).then(function (r) {
          if (!alive) return;
          if (r.ok && r.j && r.j.ok) read(); else toast(r.net ? "SIN SEÑAL · toca otra vez" : whyEs(r.j && r.j.why, r.j && r.j.detail));
        });
      }
      var tt = 0;
      function toast(m) { st.msg = m; render(); clearTimeout(tt); tt = setTimeout(function () { st.msg = ""; render(); }, 4000); }

      /* ---- leer la parada ---- */
      var reading = false;
      function fallback(why) {
        if (!alive) return;
        if (why === "off") helloOff(who);
        else if (why === "shadow") helloMode(who, "shadow");         // round 4 · f: the saved "live" no longer opens the stop
        // the practice name never goes back to today's screens (§12.5d: he is in no People row: no real order, no real fuel PO)
        if (world === "practice") { st.off = why === "off" || why === "world" || why === "mode_off" || why === "not_allowed" || why === "unknown_name"; st.first = false; st.updating = false; if (st.off) st.ans = null; if (!st.sheet) render(); return; }
        try { if (opts.onFallback) opts.onFallback(why); } catch (e) { }
      }
      function read() {
        if (!alive || reading) return; reading = true;
        rpc("dsp_my_stop", { p_name: who, p_device: deviceId() }, 6000).then(function (r) {
          reading = false; if (!alive) return;
          st.updating = false;
          var j = r.ok ? r.j : null;
          if (j && typeof j === "object" && j.ok === true && MODES[j.mode]) {
            if (j.mode === "off") return fallback("off");
            if (world === "real" && (j.mode !== "live" || j.world === "practice")) return fallback(j.mode);
            if (world === "practice" && j.world !== "practice") return fallback("world");
            st.off = false;
            var nid = j.now ? j.now.id : null;
            if (st.ans && nid !== st.lastNowId && nid != null) st.newAt = Date.now();
            st.lastNowId = nid; st.ans = j; st.readAt = Date.now(); st.stale = false; st.first = false;
            lset(K_STOP, { who: who, world: world, at: st.readAt, ans: j });
            if (!st.sheet) render();
            return;
          }
          if (j && j.ok === false && (j.why === "mode_off" || j.why === "not_allowed" || j.why === "unknown_name")) return fallback(j.why === "mode_off" ? "off" : j.why);
          // sin señal, tardó, o algo raro: lo último que llegó, con su hora; sin nada guardado = lo de hoy (combustible)
          if (!st.ans) return fallback("net");
          st.stale = true; st.first = false; if (!st.sheet) render();
        });
      }
      function onVis() { if (document.visibilityState === "visible") read(); }
      el.onclick = function (ev) {
        try {
          var b = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null; if (!b || !el.contains(b) || b.disabled) return;
          var act = b.getAttribute("data-act");
          if (act === "back") { if (opts.onClose) opts.onClose(); return; }
          if (act === "fuel") { if (opts.onFuel) opts.onFuel(); return; }   // round 4 · a: nunca se detiene (regla 4 de la casa)
          if (moving() && act !== "sheet-x") return;               // el camión se mueve: los demás toques esperan
          if (act === "problem") return openSheet();
          if (act === "push") return activatePush();
          if (act === "reason") { var ta = el.querySelector("#mzc-pnote"); if (ta) st.sheet.note = ta.value; st.sheet.reason = b.getAttribute("data-v"); st.sheetMsg = ""; render(); return; }
          if (act === "sheet-x") return closeSheet();
          if (act === "sheet-send") return sendProblem();
          if (act === "arrived" || act === "done") return practiceTap(act);
          if (act === "request" && world === "practice") {           // PEDIR CAMIÓN (PRÁCTICA): el formulario aquí mismo; ← vuelve a su parada
            var o = opts; mountRequest(el, { who: who, practiceDriver: true, onClose: function () { mountTrucker(el, o); } }); return;
          }
        } catch (e) { }
      };
      el.oninput = function (ev) {                               // OTRO: AVISAR sólo con algo escrito (el servidor lo pide)
        try {
          var t = ev.target; if (!t || t.id !== "mzc-pnote" || !st.sheet) return;
          st.sheet.note = t.value; var b = el.querySelector('[data-act="sheet-send"]'); if (b) b.disabled = !String(t.value).trim() || st.sending;
        } catch (e) { }
      };
      document.addEventListener("visibilitychange", onVis);
      timer = setInterval(function () { if (document.visibilityState === "visible" && !st.sheet) read(); else if (!st.sheet) render(); }, 60000);
      render(); read();
      cur = { kind: "trucker", el: el, stop: function () { alive = false; clearInterval(timer); clearTimeout(tt); document.removeEventListener("visibilitychange", onVis); el.onclick = null; el.oninput = null; if (st.sheet) window.__mzBusy = false; } };
      return { unmount: unmount, read: read };
    }

    /* ---------- los motivos que da el servidor, en español ---------- */
    function whyEs(w, detail) {
      if (w === "not_allowed" && detail === "for_name") return "No puedes pedir camión para esa persona: solo para ti o para un mayordomo activo.";
      if (w === "not_allowed" && detail === "office_proof") return "Tu clave de oficina no pasó. Sal, entra otra vez con tu clave y toca PEDIR CAMIÓN.";
      if (w === "not_allowed" && detail === "client_ref") return "Este pedido ya lo mandó otra persona. Toca OTRO CAMIÓN.";
      if (w === "unknown_name" && detail === "for_name") return "Esa persona no está activa. Escoge otro nombre.";
      if (w === "bad_value" && /^where\.here/.test(detail || "")) return "No se sabe dónde está tu camioneta ahora. Escoge la obra de la lista u OTRO LUGAR.";
      return ({ mode_off: "El sistema de camiones está apagado. Llama a Tacho.", not_allowed: "Con este nombre no se puede pedir camión. Llama a la oficina.",
        unknown_name: "Tu nombre no está activo. Llama a la oficina.", bad_value: "Algo no cuadra en el pedido. Revísalo y toca otra vez.",
        too_many: "Son demasiadas cargas: máximo 10.", rate: "Muchos intentos seguidos. Espera un minuto.",
        too_late: "Ya no se puede: el camión ya va en camino.", not_found: "No se encontró. Llama a la oficina." })[w] || "NO SE MANDÓ · no pasó. Toca otra vez.";
    }
    // the refusals of spec2 §12.2; anything else ('error', §12.5c, or a new word) = it did not go through. The raw word is never shown.
    var KNOWN_WHY = { mode_off: 1, not_allowed: 1, unknown_name: 1, bad_value: 1, too_many: 1, rate: 1, too_late: 1, not_found: 1 };

    /* =====================================================================
       camion/pedir · pedir un camión
       opts: {who, office: bool, practiceDriver: bool, onClose()}
       ¿PARA QUIÉN ES? (PARA MÍ primero) a quien dsp_hello le dice for_others (la oficina, los supervisores; spec2 §12.7a); el
       nombre de práctica escoge entre los mayordomos y todo lo suyo es de práctica (§12.7c). La oficina tiene el switch
       PRÁCTICA · CAMIÓN DE MENTIRA (apagado): prendido manda practice:true con su clave de oficina.
       ===================================================================== */
    var MATS = [["base", "BASE"], ["sand", "ARENA"], ["topsoil", "TIERRA NEGRA"], ["loam", "LOAM"], ["stone", "PIEDRA"], ["mulch", "MULCH"], ["cold_mix", "COLD MIX"], ["other", "OTRO"]];
    var HAUL = [[0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, "LLENO"], ["more", "MÁS DE UNO"]];
    function mountRequest(el, opts) {
      unmount();
      opts = opts || {};
      var me = up(opts.who), office = !!opts.office || isOffice(me), pdrv = !!opts.practiceDriver;
      var hh = helloCached(me);
      var others = pdrv || office || !!(hh && hh.for_others === true);
      var f = { para: others ? "" : me, kind: "", material: "", note: "", loads: 0, more: false, loader: null, where: null, whereText: "", whenSet: false, ready: null, crew: null };
      var st = { step: others ? "para" : "que", sites: null, sitesFail: false, mine: null, sending: false, msg: "", ref: "", tries: 0, sent: null, q: "", practice: pdrv,
        cmsg: "", siteQ: "", allSites: false };                  // round 4 (§12.15 b, c): a refused CANCELAR's words; the ¿DÓNDE? filter
      var alive = true, poll = 0, retryT = 0;
      el.classList.add("mzc-host"); setScr(el, "camion/pedir");
      window.__mzBusy = true;                                     // un formulario abierto: el app no se recarga
      if (!hh && !pdrv) ask(me).then(function (h) {               // la respuesta guardada venció: si dice for_others, sale ¿PARA QUIÉN ES?
        if (!alive || !h || h.for_others !== true || others || st.step !== "que" || f.kind) return;
        others = true; f.para = ""; st.step = "para"; render();
      });

      function loadSites() {
        rpc("dsp_sites_for", { p_name: me, p_device: deviceId() }, 6000).then(function (r) {
          if (!alive) return;
          // keep only what the screen uses: "here" is a yes/no (spec2 §12.11A); never a position, a distance or its place
          if (r.ok && r.j && r.j.ok === true) {
            var hr = r.j.here && typeof r.j.here === "object" ? { ok: r.j.here.ok === true } : null;
            st.sites = { here: hr, jobsite: r.j.jobsite || null, foremen: Array.isArray(r.j.foremen) ? r.j.foremen : null,
              sites: (Array.isArray(r.j.sites) ? r.j.sites : []).map(function (x) { return { place_id: x && x.place_id, name: x && x.name }; }).filter(function (x) { return x.place_id; }) };
            st.sitesFail = false;
          } else st.sitesFail = true;
          render();
        });
      }
      // lo que esta persona pidió (para sí o para otros): dsp_my_requests por quien manda
      function loadMine() {
        rpc("dsp_my_requests", { p_name: me, p_device: deviceId() }, 6000).then(function (r) {
          if (!alive) return;
          if (r.ok && r.j && r.j.ok === true && Array.isArray(r.j.requests)) { st.mine = r.j.requests; render(); }
        });
      }
      function foremen() {
        // la oficina: los mayordomos activos que da dsp_sites_for; si no (supervisor, práctica, sin señal): los de config.js
        var l = (st.sites && Array.isArray(st.sites.foremen) && st.sites.foremen.length) ? st.sites.foremen : Object.keys(CFG.ASIGNACIONES || {});
        var seen = {}, out = [];
        l.forEach(function (n) { n = up(n); if (n && n !== me && !seen[n] && !isOffice(n) && !isPractice(n)) { seen[n] = 1; out.push(n); } });
        return out.sort();
      }
      function reqLine(q) {
        var sent = q.status === "planned" && !q.truck_label ? "open" : q.status;   // en shadow no se manda camión: no decir "asignado"
        var stEs = { open: "RECIBIDO", planned: "CAMIÓN ASIGNADO", working: "EN CAMINO", done: "TERMINADO", cancelled: "CANCELADO" }[sent] || "RECIBIDO";
        var what = q.what ? whatEs(q.what) : (q.kind === "haul" ? "RECOGER" : "MATERIAL");
        var t = esc(q.req_no || "") + " · " + esc(what) + (q.loads ? " · " + esc(amountEs(q.loads) || "1") : "") + (q.where ? " · " + (q.where === "here" ? "AQUÍ DONDE ESTOY" : esc(q.where)) : "") + (q.world === "practice" ? " · PRÁCTICA" : "") +
          (q.for_name && up(q.for_name) !== me ? " · PARA " + esc(up(q.for_name)) : "");
        var s = '<b>' + esc(stEs) + '</b>' + (q.truck_label ? " · CAMIÓN " + esc(q.truck_label) : "") + (q.planned_arrive && q.truck_label ? " · como a las " + esc(hhmm(q.planned_arrive)) : "");
        return '<div class="mzc-req"><div class="mzc-reqt">' + t + '</div><div class="mzc-reqs">' + s + '</div>' +
          (q.can_cancel ? btn("stop small", "CANCELAR", "CANCELAR PEDIDO", ' data-act="cancel" data-v="' + esc(q.id) + '"') : '') + '</div>';
      }
      function practiceSwitch() {                                  // sólo la oficina: apagado al abrir
        if (!office || pdrv) return "";
        return '<button type="button" class="mzc-btn mzc-switch' + (st.practice ? ' on' : '') + '" role="switch" aria-checked="' + st.practice + '" data-act="practice" data-mzt="PRÁCTICA · SWITCH">' +
          '<span class="mzc-sw-l">PRÁCTICA · CAMIÓN DE MENTIRA</span><span class="mzc-sw-v">' + (st.practice ? "PRENDIDO" : "APAGADO") + '</span></button>';
      }
      function summary() {
        var a = [];
        if (f.kind === "deliver") a.push((f.material === "other" ? "OTRO MATERIAL" : whatEs(f.material)) + " · " + f.loads + (f.loads === 1 ? " CARGA" : " CARGAS"));
        if (f.kind === "haul") a.push("RECOGER " + whatEs(f.debris) + " · " + (amountEs(f.loads) || "LLENO") + (f.loads > 1 ? " CARGAS" : "") + (f.loader === true ? " · HAY MÁQUINA" : f.loader === false ? " · SIN MÁQUINA" : ""));
        if (f.where) a.push(f.where.here ? "AQUÍ DONDE ESTOY" : f.where.text ? "EN: " + f.where.text : "EN: " + (f.where.name || ""));
        if (f.whenSet) a.push(f.ready ? (new Date(f.ready).getDate() !== new Date().getDate() ? "MAÑANA " : "") + "A LAS " + hhmm(f.ready) : "YA");
        if (f.crew != null) a.push(f.crew ? "CUADRILLA PARADA" : "LA CUADRILLA SIGUE TRABAJANDO");
        return a;
      }
      function hours() {
        var out = [], d = new Date(); d.setMinutes(0, 0, 0);
        for (var i = 1; i <= 12 && out.length < 8; i++) { var t = new Date(d.getTime() + i * 3600e3); if (t.getDate() === d.getDate() && t.getHours() >= 6 && t.getHours() <= 18) out.push(t); }
        if (out.length < 4) {                                     // tarde: también mañana temprano (6 a 9 AM)
          var m = new Date(d.getTime()); m.setDate(m.getDate() + 1); m.setHours(6, 0, 0, 0);
          for (var k = 0; k < 4 && out.length < 8; k++) out.push(new Date(m.getTime() + k * 3600e3));
        }
        return out;
      }
      function render() {
        if (!alive) return;
        var sub = f.para && f.para !== me ? "PARA " + f.para + " · pide " + me : me, s = st.step;
        var h = (st.practice ? '<div class="mzc-band" role="note">PRÁCTICA · CAMIÓN DE MENTIRA · NADA ES REAL</div>' : '') + header(st.practice ? "PEDIR CAMIÓN · PRÁCTICA" : "PEDIR CAMIÓN", sub);
        h += '<div class="mzc-body">';
        if (s === "para" || s === "que") h += practiceSwitch();
        if (s === "para") {
          h += '<h2 class="mzc-q">¿PARA QUIÉN ES?</h2><div class="mzc-hint">' + (pdrv ? "Práctica: el pedido es de mentira, a nombre del mayordomo que escojas." : "Sale a su nombre. Queda anotado que lo pediste tú.") + '</div>';
          if (!pdrv) h += btn("go big", "PARA MÍ<span>" + esc(me) + "</span>", "PARA MÍ", ' data-act="para" data-v="' + esc(me) + '"');
          h += '<div class="mzc-sec">' + (pdrv ? "MAYORDOMOS" : "O PARA UN MAYORDOMO") + '</div>' +
            '<input id="mzc-q" class="mzc-field" type="search" placeholder="Buscar nombre…" autocomplete="off" autocapitalize="characters" value="' + esc(st.q) + '">' +
            '<div class="mzc-grid2">';
          var q = up(st.q);
          foremen().forEach(function (n) { if (!q || n.indexOf(q) >= 0) h += '<button type="button" class="mzc-btn tile" data-act="para" data-v="' + esc(n) + '" data-mzt="PARA QUIÉN">' + esc(n) + '</button>'; });
          h += '</div>';
        } else if (s === "que") {
          h += '<h2 class="mzc-q">¿QUÉ NECESITAS?</h2><div class="mzc-big">' +
            btn("tile big", "🧱 MATERIAL<span>Base, arena, tierra, piedra…</span>", "MATERIAL", ' data-act="kind" data-v="deliver"') +
            btn("tile big", "🚛 RECOGER CONCRETO<span>Concreto quebrado para tirar</span>", "RECOGER CONCRETO", ' data-act="kind" data-v="concrete"') +
            btn("tile big", "🚛 RECOGER TIERRA<span>Tierra para tirar</span>", "RECOGER TIERRA", ' data-act="kind" data-v="dirt"') + '</div>';
          if (st.cmsg) h += '<div class="mzc-status warn" role="alert">' + esc(st.cmsg) + '</div>';   // §12.15b: on the screen with the list
          if (st.mine && st.mine.length) { h += '<div class="mzc-sec">TUS PEDIDOS DE CAMIÓN</div>'; st.mine.slice(0, 6).forEach(function (q) { h += reqLine(q); }); }
        } else if (s === "cuanto") {
          if (f.kind === "deliver") {
            h += '<h2 class="mzc-q">¿QUÉ MATERIAL?</h2><div class="mzc-grid2">';
            MATS.forEach(function (m) { h += btn("tile" + (f.material === m[0] ? " on" : ""), m[1], "MATERIAL \u00b7 " + m[1], ' data-act="mat" data-v="' + m[0] + '" aria-pressed="' + (f.material === m[0]) + '"'); });
            h += '</div>';
            if (f.material === "other") h += '<label class="mzc-flab" for="mzc-mnote">¿QUÉ MATERIAL? (escríbelo)</label><input id="mzc-mnote" class="mzc-field" type="text" maxlength="80" autocomplete="off" value="' + esc(f.note) + '">';
            h += '<h2 class="mzc-q">¿CUÁNTAS CARGAS?</h2><div class="mzc-grid4">';
            [1, 2, 3].forEach(function (n) { h += btn("tile" + (f.loads === n && !f.more ? " on" : ""), String(n), n + " CARGAS", ' data-act="loads" data-v="' + n + '" aria-pressed="' + (f.loads === n && !f.more) + '"'); });
            h += btn("tile" + (f.more ? " on" : ""), "+", "MÁS CARGAS", ' data-act="more" aria-label="Más de 3 cargas" aria-pressed="' + f.more + '"') + '</div>';
            if (f.more) h += stepper();
          } else {
            h += '<h2 class="mzc-q">¿CUÁNTO ' + (f.debris === "dirt" ? "TIERRA" : "CONCRETO") + ' HAY?</h2><div class="mzc-grid3">';
            HAUL.forEach(function (x) { var on = x[0] === "more" ? f.more : (!f.more && f.loads === x[0]); h += btn("tile" + (on ? " on" : ""), x[1], "HAY " + (x[0] === 1 ? "LLENO" : x[0] === "more" ? "MÁS DE UNO" : "PARTE"), ' data-act="haul" data-v="' + x[0] + '" aria-pressed="' + on + '"'); });
            h += '</div>';
            if (f.more) h += stepper();
            h += '<h2 class="mzc-q">¿HAY MÁQUINA PARA CARGAR?</h2><div class="mzc-grid2">' +
              btn("tile" + (f.loader === true ? " on" : ""), "SÍ", "MÁQUINA · SÍ", ' data-act="loader" data-v="1" aria-pressed="' + (f.loader === true) + '"') +
              btn("tile" + (f.loader === false ? " on" : ""), "NO", "MÁQUINA · NO", ' data-act="loader" data-v="0" aria-pressed="' + (f.loader === false) + '"') + '</div>';
          }
          var ok = f.kind === "deliver" ? (f.material && f.loads >= 1 && (f.material !== "other" || String(f.note).trim())) : (f.loads > 0 && f.loader != null);
          h += '<div class="mzc-bar">' + btn("action", "SIGUIENTE →", "CAMI\u00d3N \u00b7 SIGUIENTE", ' data-act="next"' + (ok ? "" : " disabled")) + (ok ? "" : '<div class="mzc-hint">' + (f.kind === "deliver" ? "Escoge el material y cuántas cargas." : "Escoge cuánto hay y si hay máquina.") + '</div>') + '</div>';
        } else if (s === "donde") {
          var S = st.sites || {};
          h += '<h2 class="mzc-q">¿DÓNDE?</h2><div class="mzc-list">';
          // AQUÍ: where his own truck is right now; the database places it. Off (with the reason) when it has no recent position
          if (S.here && !office) h += S.here.ok ? btn("tile big" + (f.where && f.where.here ? " on" : ""), "📍 AQUÍ DONDE ESTOY<span>Donde está tu camioneta ahorita</span>", "AQUÍ DONDE ESTOY", ' data-act="here"')
            : btn("tile big", "📍 AQUÍ DONDE ESTOY<span>No se sabe dónde está tu camioneta ahorita (sin GPS reciente). Escoge la obra o OTRO LUGAR.</span>", "AQUÍ DONDE ESTOY", ' data-act="here" disabled');
          // §12.15c: every site the database lists, in its order (the person's own first): the first six as big buttons, a
          // filter box over all of them and VER TODAS LAS OBRAS for the rest; a chosen site is always on screen
          var all = Array.isArray(S.sites) ? S.sites : [], SHOW = 6, sq = up(st.siteQ), many = all.length > SHOW, shown = [];
          all.forEach(function (x, i) {
            var on = !!(f.where && f.where.place_id === x.place_id);
            if (sq ? up(x.name).indexOf(sq) >= 0 : (st.allSites || !many || i < SHOW || on)) shown.push(i);
          });
          if (many) h += '<input id="mzc-sq" class="mzc-field" type="search" placeholder="Buscar obra…" aria-label="Buscar obra" autocomplete="off" autocapitalize="characters" value="' + esc(st.siteQ) + '">';
          shown.forEach(function (i) {
            var x = all[i], on = f.where && f.where.place_id === x.place_id;
            h += btn("tile" + (on ? " on" : ""), esc(x.name || "Obra"), "OBRA DE LA LISTA", ' data-act="site" data-i="' + i + '" aria-pressed="' + !!on + '"');
          });
          if (sq && !shown.length) h += '<div class="mzc-hint">Ninguna obra con ese nombre. Borra la búsqueda o usa OTRO LUGAR.</div>';
          if (many && !sq && !st.allSites) h += btn("sec", "VER TODAS LAS OBRAS (" + all.length + ")", "MÁS OBRAS", ' data-act="allsites"');
          if (!st.sites && !st.sitesFail) h += '<div class="mzc-hint">Buscando las obras…</div>';
          if (st.sitesFail) h += '<div class="mzc-hint">No cargaron las obras (señal). Escribe el lugar abajo.</div>';
          h += btn("tile" + (f.where && f.where.text != null ? " on" : ""), "OTRO LUGAR<span>Escribe las calles</span>", "OTRO LUGAR", ' data-act="other"') + '</div>';
          if (f.where && f.where.text != null) h += '<label class="mzc-flab" for="mzc-wtext">CALLES (ej. Burnet Rd y Anderson Ln) · la oficina lo pone en el mapa</label><input id="mzc-wtext" class="mzc-field" type="text" maxlength="120" autocomplete="off" value="' + esc(f.whereText) + '">';
          var okw = f.where && (f.where.text == null || String(f.whereText).trim().length >= 3);
          h += '<div class="mzc-bar">' + btn("action", "SIGUIENTE →", "CAMI\u00d3N \u00b7 SIGUIENTE", ' data-act="next"' + (okw ? "" : " disabled")) + (okw ? "" : '<div class="mzc-hint">Escoge dónde' + (f.where ? " y escribe las calles" : "") + '.</div>') + '</div>';
        } else if (s === "cuando") {
          h += '<h2 class="mzc-q">¿CUÁNDO?</h2><div class="mzc-grid3">' + btn("tile" + (f.whenSet && !f.ready ? " on" : ""), "YA", "CUÁNDO · YA", ' data-act="ya" aria-pressed="' + (f.whenSet && !f.ready) + '"');
          hours().forEach(function (t) { var on = f.ready && Math.abs(new Date(f.ready).getTime() - t.getTime()) < 60000; h += btn("tile" + (on ? " on" : ""), (t.getDate() !== new Date().getDate() ? "MAÑANA " : "") + esc(hhmm(t.toISOString())), "A LAS #", ' data-act="hour" data-v="' + t.toISOString() + '" aria-pressed="' + !!on + '"'); });
          h += '</div><h2 class="mzc-q">¿LA CUADRILLA ESTÁ PARADA?</h2><div class="mzc-hint">Parada = no pueden trabajar hasta que llegue el camión.</div><div class="mzc-grid2">' +
            btn("tile" + (f.crew === true ? " on" : ""), "SÍ, PARADA", "CUADRILLA PARADA · SÍ", ' data-act="crew" data-v="1" aria-pressed="' + (f.crew === true) + '"') +
            btn("tile" + (f.crew === false ? " on" : ""), "NO", "CUADRILLA PARADA · NO", ' data-act="crew" data-v="0" aria-pressed="' + (f.crew === false) + '"') + '</div>';
          var okc = f.whenSet && f.crew != null;
          h += '<div class="mzc-card mzc-sum"><div class="mzc-lab">TU PEDIDO</div>' + summary().map(function (x) { return '<div>' + esc(x) + '</div>'; }).join("") + '</div>';
          if (st.msg) h += '<div class="mzc-status ' + (st.sending ? "" : "warn") + '" role="alert">' + esc(st.msg) + '</div>';
          h += '<div class="mzc-bar">' + btn("go hero", st.sending ? "MANDANDO…" : "🚛 PEDIR CAMIÓN", "PEDIR CAMIÓN", ' data-act="send"' + (okc && !st.sending ? "" : " disabled")) + (okc ? "" : '<div class="mzc-hint">Escoge cuándo y si la cuadrilla está parada.</div>') + '</div>';
        } else if (s === "hecho") {
          var mine = (st.mine || []).filter(function (q) { return st.sent && q.id === st.sent.id; })[0];
          var prw = !!(st.sent && st.sent.world === "practice");
          h += '<div class="mzc-card mzc-done"><div class="mzc-big1">✅ PEDIDO MANDADO' + (prw ? " · PRÁCTICA" : "") + '</div><div class="mzc-place">' + esc(st.sent && st.sent.req_no || "") + '</div>' +
            (prw ? '<div class="mzc-pr">Fue al camión de PRÁCTICA (de mentira). Ningún camión real se mueve.</div>' : '') +
            '<div class="mzc-line" role="status">' + (mine ? reqLine(mine) : prw ? "" : "Recibido · la oficina lo acomoda en un camión") + '</div>' +
            '<div class="mzc-hint">Esta línea se actualiza sola. No escoges el camión: Tacho y el sistema lo acomodan.</div></div>' +
            (st.cmsg ? '<div class="mzc-status warn" role="alert">' + esc(st.cmsg) + '</div>' : '') +
            '<div class="mzc-bar">' + btn("action", "LISTO", "CAMI\u00d3N \u00b7 LISTO", ' data-act="close"') + btn("sec", "OTRO CAMIÓN", "OTRO CAMIÓN", ' data-act="again"') + '</div>';
        }
        h += '</div>';
        var focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : "";
        var caret = focus && document.activeElement.selectionStart;
        el.innerHTML = h;
        if (focus) { var fe = el.querySelector("#" + focus); if (fe) { try { fe.focus(); if (caret != null) fe.setSelectionRange(caret, caret); } catch (e) { } } }
      }
      function stepper() {
        return '<div class="mzc-step"><button type="button" class="mzc-btn ink" data-act="dec" aria-label="Una carga menos" data-mzt="CARGAS −">−</button><div class="mzc-n" aria-live="polite">' + f.loads + ' CARGAS</div>' +
          '<button type="button" class="mzc-btn action" data-act="inc" aria-label="Una carga más" data-mzt="CARGAS +">+</button></div>';
      }
      var ORDER = ["que", "cuanto", "donde", "cuando"];
      function go(s) { if (st.step === "cuando" && s !== "cuando") { st.ref = ""; } st.step = s; st.msg = ""; st.cmsg = ""; render(); try { el.scrollTop = 0; var sc = el.querySelector(".mzc-body"); if (sc) sc.scrollTop = 0; window.scrollTo(0, 0); } catch (e) { } }
      function back() {
        st.sending = false;                                       // salir mientras manda = deja de intentar (nunca después)
        var i = ORDER.indexOf(st.step);
        if (st.step === "hecho" || (i <= 0 && (!others || st.step === "para"))) { if (opts.onClose) opts.onClose(); return; }
        if (i === 0 && others) return go("para");
        go(ORDER[i - 1]);
      }
      /* ---- mandar: mismo client_ref en cada intento; reintenta solo mientras sigue aquí (≤ 25 s, cada intento ≤ 10 s) ---- */
      function payload() {
        var w = f.where && f.where.here ? { here: true } : f.where && f.where.text != null ? { text: String(f.whereText).trim().slice(0, 120) } : { place_id: f.where && f.where.place_id };
        var p = { name: me, for_name: f.para || me, device: deviceId(), client_ref: st.ref, kind: f.kind, loads: f.loads, loader: f.kind === "haul" ? !!f.loader : null,
          where: w, ready_at: f.ready || null, crew_stopped: !!f.crew, can_wait: false, note: f.material === "other" ? String(f.note).trim().slice(0, 80) : null, practice: !!st.practice };
        if (f.kind === "deliver") p.material = f.material; else p.debris = f.debris;
        // the office PIN travels only with a practice request from an office name (spec2 §12.7b); never stored or shown here
        if (office && st.practice && !pdrv) { try { var pin = sessionStorage.getItem("muniz_of_pin") || ""; if (pin) p.office_proof = pin; } catch (e) { } }
        return p;
      }
      function send() {
        if (st.sending || st.step !== "cuando") return;
        if (!st.ref) st.ref = rid();
        st.sending = true; st.tries = 0; st.msg = ""; var t0 = Date.now(), ref = st.ref; render();
        (function once() {
          if (!alive || st.step !== "cuando" || st.ref !== ref) { st.sending = false; return; }
          if (document.visibilityState === "hidden") { st.sending = false; st.msg = "NO SE MANDÓ · saliste del app. Toca PEDIR CAMIÓN otra vez."; render(); return; }
          st.tries++;
          rpc("dsp_request_create", { p: payload() }, 10000).then(function (r) {
            if (!alive || st.step !== "cuando" || st.ref !== ref) { st.sending = false; return; }      // se fue de la pantalla: nunca después
            var j = r.ok ? r.j : null;
            if (j && j.ok === true && j.req_no) { st.sending = false; st.sent = j; st.step = "hecho"; window.__mzBusy = false; render(); loadMine(); return; }
            // a known refusal: said plainly, no retry. 'error' (§12.5c) or a why this phone does not know = it did not go
            // through: the retry rule of a failed send (only here, the same client_ref)
            if (j && j.ok === false && KNOWN_WHY[j.why]) { st.sending = false; st.msg = whyEs(j.why, j.detail); render(); return; }
            if (j && j.ok === false) r = { ok: false, net: true };
            var again = (r.net || (r.status >= 500) || (r.j && /PGRST002|schema cache/i.test(JSON.stringify(r.j)))) && Date.now() - t0 < 25000;
            if (again) { st.msg = "SIN SEÑAL · intentando otra vez… (no te salgas)"; render(); retryT = setTimeout(once, 2500); return; }
            st.sending = false;
            st.msg = r.net || r.status >= 500 ? "NO SE MANDÓ · sin señal. Cuando tengas señal toca PEDIR CAMIÓN otra vez." : "NO SE MANDÓ · la oficina no contestó bien. Llama a la oficina.";
            render();
          });
        })();
      }
      function cancelReq(id) {
        rpc("dsp_request_cancel", { p: { name: me, device: deviceId(), id: isNaN(+id) ? id : +id } }, 10000).then(function (r) {
          if (!alive) return;
          // §12.15b: a refusal is worded on the screen that holds the list (¿QUÉ NECESITAS? or the sent screen), and the list is
          // read again either way (the request may have moved on: too_late)
          if (r.ok && r.j && r.j.ok) st.cmsg = "";
          else { var w = r.j && r.j.why; st.cmsg = "NO SE CANCELÓ · " + (r.net ? "sin señal. Toca CANCELAR otra vez con señal." : KNOWN_WHY[w] ? whyEs(w, r.j.detail) : "no pasó. Toca CANCELAR otra vez."); }
          render(); loadMine();
        });
      }
      el.oninput = function (ev) {
        var t = ev.target; if (!t) return;
        if (t.id === "mzc-q") { st.q = t.value; render(); }
        else if (t.id === "mzc-sq") { st.siteQ = t.value; render(); }
        else if (t.id === "mzc-mnote") { f.note = t.value; var b = el.querySelector('[data-act="next"]'); if (b) { b.disabled = !String(f.note).trim(); } }
        else if (t.id === "mzc-wtext") { f.whereText = t.value; var b2 = el.querySelector('[data-act="next"]'); if (b2) b2.disabled = String(f.whereText).trim().length < 3; }
      };
      el.onclick = function (ev) {
        try {
          var b = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null; if (!b || !el.contains(b) || b.disabled) return;
          var a = b.getAttribute("data-act"), v = b.getAttribute("data-v");
          if (a === "back") return back();
          if (a === "close") { if (opts.onClose) opts.onClose(); return; }
          if (st.sending) return;
          if (a === "practice") { st.practice = !st.practice; render(); return; }
          if (a === "para") { f.para = v; return go("que"); }
          if (a === "kind") { f.kind = v === "deliver" ? "deliver" : "haul"; f.debris = v === "deliver" ? "" : v; f.material = ""; f.loads = 0; f.more = false; f.loader = null; return go("cuanto"); }
          if (a === "mat") { f.material = v; render(); return; }
          if (a === "loads") { f.loads = +v; f.more = false; render(); return; }
          if (a === "more") { f.more = true; f.loads = Math.max(f.kind === "deliver" ? 4 : 2, f.loads | 0); render(); return; }
          if (a === "dec") { f.loads = Math.max(f.kind === "deliver" ? 4 : 2, f.loads - 1); render(); return; }
          if (a === "inc") { f.loads = Math.min(10, f.loads + 1); render(); return; }
          if (a === "haul") { if (v === "more") { f.more = true; f.loads = Math.max(2, f.loads >= 2 ? f.loads : 2); } else { f.more = false; f.loads = +v; } render(); return; }
          if (a === "loader") { f.loader = v === "1"; render(); return; }
          if (a === "here") { f.where = { here: true }; render(); return; }
          if (a === "site") { var x = (st.sites && st.sites.sites || [])[+b.getAttribute("data-i")]; if (x) f.where = { place_id: x.place_id, name: x.name || x.job }; render(); return; }
          if (a === "allsites") { st.allSites = true; render(); return; }
          if (a === "other") { f.where = { text: "" }; render(); var i2 = el.querySelector("#mzc-wtext"); if (i2) try { i2.focus(); } catch (e) { } return; }
          if (a === "ya") { f.whenSet = true; f.ready = null; render(); return; }
          if (a === "hour") { f.whenSet = true; f.ready = v; render(); return; }
          if (a === "crew") { f.crew = v === "1"; render(); return; }
          if (a === "next") {
            if (st.step === "cuanto") { if (!st.sites) loadSites(); return go("donde"); }
            if (st.step === "donde") return go("cuando");
          }
          if (a === "send") return send();
          if (a === "again") { f.kind = ""; f.material = ""; f.note = ""; f.loads = 0; f.more = false; f.loader = null; f.where = null; f.whereText = ""; f.whenSet = false; f.ready = null; f.crew = null; st.sent = null; st.ref = ""; st.siteQ = ""; st.allSites = false; window.__mzBusy = true; return go("que"); }
          if (a === "cancel") { if (window.confirm("¿Cancelar este pedido de camión?")) cancelReq(v); return; }
        } catch (e) { }
      };
      poll = setInterval(function () { if (document.visibilityState === "visible" && (st.step === "hecho" || st.step === "que")) loadMine(); }, 30000);
      loadMine(); loadSites();
      render();
      cur = { kind: "request", el: el, stop: function () { alive = false; clearInterval(poll); clearTimeout(retryT); el.onclick = null; el.oninput = null; window.__mzBusy = false; } };
      return { unmount: unmount };
    }

    window.MunizCamion = { version: VERSION, mountTrucker: mountTrucker, mountRequest: mountRequest, unmount: unmount,
      // para pedidos_menu.js (decide al instante, sin esperar la red) y las pruebas
      truckerWorld: truckerWorld, wantsCard: wantsCard, ask: ask, isPractice: isPractice, helloCached: helloCached };
  } catch (err) {
    try { delete window.MunizCamion; } catch (e) { window.MunizCamion = undefined; }
  }
})();
