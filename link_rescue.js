/* =====================================================================
   MUÑIZ PEDIDOS · LINKS DE APROBACIÓN CORTOS Y CORTADOS  ·  v1.3
   v1.3 (v247, revisión iPhone · docs/UX_IPHONE_AUDIT_2026-11-08.md #7 #13 #14 #18 #27):
         · "Abriendo el pedido…" ya no espera para siempre: cada intento se corta a los 10 s, y a los 8 s salen ABRIR MI
           BANDEJA e IR AL INICIO debajo de la ruedita. Los 3 intentos, las marcas link_* y el evento "error" quedan igual
           (si la persona ya se fue al inicio, el "error" sale igual, pero ya no se le cambia la pantalla).
         · window.MZlinkDone({st, req, f, p, po, dm}): la tarjeta "✓ APROBADO" / "✓ YA TIENE PO" / "✗ RECHAZADO" encima de
           lo que haya. app.js la llama después de SÍ, YA LO MANDÉ y de RECHAZAR; llamarla dos veces deja una sola tarjeta.
         · Un link #r= (completo o corto) le pregunta a order_for_link cómo va el pedido: si ya no está SOLICITADO, sale la
           tarjeta. Sin respuesta / 404 / error = no se sabe: no sale nada, y la revisión nunca espera esa respuesta.
         · El look de docs/DESIGN.md (claro; el ícono de verdad, apple-touch-icon.png). La caja es un diálogo que VoiceOver
           lee primero (el título recibe el foco), se desplaza cuando no cabe (letra grande, teléfono de lado) y sus
           botones se ven apretados al tocarlos.
   v1.2 (v240): un pedido largo manda un LINK CORTO (#r= con solo mayordomo, tienda y hora): los textos de más de
         ~1,000 letras no le llegaban completos al supervisor (Miguel Juarez: S1026, S1031, S1096, S1167). Aquí se
         trae el pedido completo del servidor (order_for_link, parche192) y se abre la revisión de siempre. Un link
         que llega cortado se busca igual (my_orders ya no da el pedido a otro teléfono desde parche175). Si no se
         encuentra después de 3 intentos: avisa a Tito (evento "error" a nombre del supervisor) y ofrece OTRA VEZ y
         la Bandeja (el supervisor entra tocando su nombre, sin clave, desde v215).
   v1.1: busca el pedido por el nombre del mayordomo (parche172, p_by_name). Antes my_orders solo veía los pedidos
         de este teléfono, y en el teléfono del supervisor nunca encontraba el pedido.
   ---------------------------------------------------------------------
   Si el link (#r= / #t= / #p=) trae el pedido completo, el app lo abre como siempre (y si es #r= y ya se decidió,
   sale la tarjeta encima). Si no:
     1. link corto: ya trae mayordomo, tienda y hora; link cortado: del pedazo que sí llegó saca lo que pueda;
     2. pide ese pedido al servidor (quedó registrado cuando el mayordomo tocó MANDAR) y abre la revisión normal;
     3. si no, dice claramente qué pasó y ofrece OTRA VEZ / la Bandeja.
   Deja una marca en "events" (link_corto / link_cortado / link_recuperado; parche192 las deja pasar).

   Se carga en index.html después de config.js y ANTES de app.js. No toca app.js.
   ===================================================================== */
(function () {
  "use strict";
  var D = document;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }   // lo que viene del link: nunca como HTML
  function up(s) { return String(s || "").toUpperCase().trim(); }
  function when(fn) { if (D.body) fn(); else D.addEventListener("DOMContentLoaded", fn); }
  var RM = false;
  try { RM = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { }

  // ---------- el look: docs/DESIGN.md (los valores escritos aquí; este archivo no carga CSS) ----------
  var F = '-apple-system,"SF Pro Text",system-ui,sans-serif', FD = '-apple-system,"SF Pro Display",system-ui,sans-serif';
  var CSS = [
    "#mzr-box{position:fixed;top:0;right:0;bottom:0;left:0;z-index:100000;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;",
    "-webkit-overflow-scrolling:touch;overscroll-behavior:contain;box-sizing:border-box;",
    "padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));",
    "background:#F2F2F7;color:#1C1C1E;font:400 17px/1.35 " + F + ";text-align:center;-webkit-text-size-adjust:100%;text-size-adjust:100%}",
    "#mzr-box *{box-sizing:border-box}",
    "#mzr-box .mzr-in{margin:auto;width:100%;max-width:420px}",                     // centrado sin cortar arriba cuando no cabe
    "#mzr-box .mzr-ic{display:block;width:64px;height:64px;margin:0 auto 16px;border-radius:14px;",
    "box-shadow:0 0 0 1px #D1D1D6,0 1px 2px rgba(0,0,0,.06),0 4px 12px -6px rgba(0,0,0,.18)}",
    "#mzr-box h1{margin:0;font:800 24px/1.15 " + FD + ";letter-spacing:-.01em;color:#1C1C1E;overflow-wrap:anywhere;outline:none}",
    "#mzr-box h1.mzr-st{font-size:34px;line-height:1.05}",
    "#mzr-box h1.mzr-ok{color:#1E7B34}#mzr-box h1.mzr-no{color:#C81E1E}",
    "#mzr-box .mzr-id{display:inline-block;max-width:100%;margin:16px 0 0;padding:8px 12px;border-radius:12px;background:#FFFFFF;",
    "box-shadow:0 1px 2px rgba(0,0,0,.06),0 4px 12px -6px rgba(0,0,0,.18);font:800 15px/1.3 " + F + ";color:#1C1C1E;overflow-wrap:anywhere}",
    "#mzr-box .mzr-tx{margin:12px 0 0;font:400 17px/1.35 " + F + ";color:#3A3A3C;overflow-wrap:anywhere}",
    "#mzr-box .mzr-tx b{font-weight:700;color:#1C1C1E}",
    "#mzr-box #mzr-note:empty{margin:0}",
    "#mzr-box .mzr-sp{width:28px;height:28px;margin:24px auto 0;border-radius:50%;border:3px solid #D1D1D6;border-top-color:#FF5A00;",
    "animation:mzrSpin .8s linear infinite}",
    "#mzr-box .mzr-bs{margin-top:24px}",
    "#mzr-box .mzr-b{display:flex;align-items:center;justify-content:center;width:100%;margin:12px 0 0;padding:10px 16px;border-radius:12px;",
    "text-decoration:none;font:800 17px/1.2 " + F + ";text-align:center;overflow-wrap:anywhere;cursor:pointer;",
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation}",
    "#mzr-box .mzr-bs>.mzr-b:first-child{margin-top:0}",
    "#mzr-box .mzr-go,#mzr-box .mzr-act{min-height:56px;color:#FFFFFF;font-size:20px}",
    "#mzr-box .mzr-go{background:#1E7B34}#mzr-box .mzr-act{background:#C2410C}",
    "#mzr-box .mzr-sec{min-height:48px;background:#FFFFFF;color:#1C1C1E;border:2px solid #D1D1D6}",
    "#mzr-box .mzr-q{min-height:44px;background:transparent;color:#0066CC;font-weight:700}",
    "#mzr-box .mzr-b:active{transform:scale(.97)}",
    "#mzr-box .mzr-go:active,#mzr-box .mzr-act:active{box-shadow:inset 0 0 0 100px rgba(0,0,0,.16)}",   // el fondo se oscurece, la letra no
    "#mzr-box .mzr-sec:active,#mzr-box .mzr-q:active{background:#E9E9EE}",
    "#mzr-box .mzr-b:focus-visible{outline:2px solid #0066CC;outline-offset:2px}",
    "@keyframes mzrSpin{to{transform:rotate(360deg)}}",
    "@keyframes mzrIn{from{opacity:0;transform:translateY(8px)}}",
    "@keyframes mzrFade{from{opacity:0}}",
    "@media (prefers-reduced-motion:no-preference){",
    "#mzr-box{animation:mzrFade .15s ease-out backwards}#mzr-box .mzr-in{animation:mzrIn .18s ease-out backwards}",
    "#mzr-box.mzr-out{opacity:0;transition:opacity .15s ease-in}",
    "#mzr-box .mzr-b{transition:transform .1s ease,box-shadow .1s ease,background-color .1s ease}}",
    "@media (prefers-reduced-motion:reduce){#mzr-box .mzr-sp{animation-duration:1.6s}}"
  ].join("");
  function css() {
    if (D.getElementById("mzr-css")) return;
    var s = D.createElement("style"); s.id = "mzr-css"; s.textContent = CSS;
    (D.head || D.documentElement).appendChild(s);
    try { D.addEventListener("touchstart", function () { }, { passive: true }); } catch (e) { }   // iOS solo pinta :active con esto
  }

  // ---------- la caja: un diálogo encima de todo (z-index 100000), lo primero que lee VoiceOver ----------
  var box = null, fading = null, mode = "", hid = [];
  function kill(el) { try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) { } }
  function hideRest() {                                         // lo de atrás no se lee mientras la caja está
    var b = D.body; if (!b) return;
    for (var c = b.firstElementChild; c; c = c.nextElementSibling) {
      if (c === box || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(c.tagName) || c.getAttribute("aria-hidden") === "true") continue;
      c.setAttribute("aria-hidden", "true"); hid.push(c);
    }
  }
  function showRest() {
    for (var i = 0; i < hid.length; i++) { try { hid[i].removeAttribute("aria-hidden"); } catch (e) { } }
    hid = [];
  }
  function boxShow(kind, html, after) {
    css();
    if (fading) { kill(fading); fading = null; }
    if (!box || !box.parentNode) {
      box = D.createElement("div");
      box.id = "mzr-box";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", "mzr-t");
      var b = D.body || D.documentElement;
      b.insertBefore(box, b.firstChild);                        // antes iba al final, después de toda la lista de nombres
      hideRest();
    }
    mode = kind;
    box.innerHTML = '<div class="mzr-in">' + html + "</div>";
    if (after) after();
    box.scrollTop = 0;
    var t = D.getElementById("mzr-t");
    if (t) { try { t.focus({ preventScroll: true }); } catch (e) { try { t.focus(); } catch (x) { } } }
  }
  function boxClose(then) {
    var b = box; box = null; mode = "";
    showRest();
    if (!b) { if (then) then(); return; }
    var end = function () { kill(b); if (fading === b) fading = null; if (then && !box) then(); };   // otra tarjeta ya abrió: su foco se queda
    if (RM) { end(); return; }
    fading = b; b.classList.add("mzr-out"); setTimeout(end, 160);
  }
  function btn(b, i) {                                          // main: OTRA VEZ verde (go), lo demás naranja (action)
    var c = b.main ? (b.go ? "mzr-go" : "mzr-act") : b.quiet ? "mzr-q" : "mzr-sec";
    return '<a href="' + b.href + '" id="mzr-b' + i + '" class="mzr-b ' + c + '"' + (b.onclick ? ' role="button"' : "") + ">" + b.text + "</a>";
  }
  function wire(list, base) {
    for (var i = 0; i < list.length; i++) {
      if (!list[i].onclick) continue;
      var el = D.getElementById("mzr-b" + (base + i)); if (el) el.onclick = list[i].onclick;
    }
  }
  function focusApp() {
    try {
      var h = D.querySelector("#root h1, #root h2");
      if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    } catch (e) { }
  }

  // ---------- v1.3 · la tarjeta de "ya se decidió": window.MZlinkDone ----------
  var STORE = { WHITECAP: "WHITE CAP" }, doneKey = "", doneAny = false, known = null;
  function remember(f, p, req) { if (req) known = { f: up(f), p: up(p), req: up(req) }; }   // el S#### que contestó el servidor
  function home(ev) {                                           // al inicio de verdad: sin el link (app.js ya dibujó la revisión)
    if (ev) ev.preventDefault();
    try { location.replace(location.pathname + location.search); } catch (e) { location.href = "./"; }
  }
  function seeOrder(ev) { if (ev) ev.preventDefault(); boxClose(focusApp); }
  window.MZlinkDone = function (o) {
    try {
      o = o || {};
      var st = up(o.st);
      if (st !== "APROBADO" && st !== "PO_ASIGNADO" && st !== "RECHAZADO") return false;
      var no = st === "RECHAZADO", po = up(o.po), pr = up(o.p), req = up(o.req);
      if (!req && known && (!o.f || up(o.f) === known.f) && (!pr || pr === known.p)) req = known.req;   // app.js manda {st, f, p}
      var head = no ? "✗ RECHAZADO" : po ? "✓ YA TIENE PO " + po : st === "PO_ASIGNADO" ? "✓ YA TIENE PO" : "✓ APROBADO";
      var who = [req, up(o.f), STORE[pr] || pr].filter(Boolean).join(" · ");
      if (o.dm) who = "PRÁCTICA" + (who ? " · " + who : "");
      var msg = o.dm ? "Era de práctica: no cuenta." : no ? "Al mayordomo le sale RECHAZADO en MIS PEDIDOS." : "Ya está en la oficina.";
      var key = head + "|" + who + "|" + msg;
      doneAny = true;
      when(function () {
        if (box && mode === "done" && key === doneKey) return;   // la misma tarjeta ya está en la pantalla
        doneKey = key;
        var L = [{ text: "ABRIR MI BANDEJA", href: "./bandeja.html", main: true },
                 { text: "IR AL INICIO", href: "./", onclick: home },
                 { text: "VER EL PEDIDO", href: "#", onclick: seeOrder, quiet: true }];
        boxShow("done", '<h1 id="mzr-t" tabindex="-1" class="mzr-st ' + (no ? "mzr-no" : "mzr-ok") + '">' + esc(head) + "</h1>" +
          (who ? '<p class="mzr-id">' + esc(who) + "</p>" : "") + '<p class="mzr-tx">' + esc(msg) + "</p>" +
          '<div class="mzr-bs">' + L.map(btn).join("") + "</div>", function () { wire(L, 0); });
      });
      return true;
    } catch (e) { return false; }
  };

  // ---------- el link ----------
  var h = location.hash || "";
  var m = /^#([rtp])=([A-Za-z0-9_-]*)/.exec(h);
  if (!m) return;

  function b64(t) {
    t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "=";
    var a = atob(t), r = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) r[i] = a.charCodeAt(i);
    return new TextDecoder().decode(r);
  }
  function enc(o) {
    var b = new TextEncoder().encode(JSON.stringify(o)), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  var CFG = window.MUNIZ_CONFIG || {}, SB = CFG.SUPABASE || {};
  var URL_ = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  var KEY = String(SB.ANON_KEY || "").trim();
  var CUT = 10000, SLOW = 8000;                                 // v1.3: cada intento se corta a los 10 s; la salida a los 8 s
  function ask(body) {
    return new Promise(function (res, rej) {
      var over = false, ctl = null, t = 0;
      try { ctl = new AbortController(); } catch (e) { ctl = null; }
      t = setTimeout(function () {                              // aunque el fetch no haga caso del corte, el intento termina
        if (over) return; over = true;
        try { if (ctl) ctl.abort(); } catch (e) { }
        rej(new Error("no answer in " + CUT / 1000 + " s"));
      }, CUT);
      var opt = { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body) };
      if (ctl) opt.signal = ctl.signal;
      try {
        fetch(URL_ + "/rest/v1/rpc/order_for_link", opt)
          .then(function (r) { if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return r.json(); })
          .then(function (x) { if (over) return; over = true; clearTimeout(t); res(x); },
                function (e) { if (over) return; over = true; clearTimeout(t); rej(e); });
      } catch (e) { if (!over) { over = true; clearTimeout(t); rej(e); } }
    });
  }

  // v1.3 · un link #r= completo: si el pedido ya se decidió, la tarjeta encima de la revisión (nunca la detiene)
  function late(o) { if (doneAny) return; when(function () { if (!doneAny) window.MZlinkDone(o); }); }
  function check(J) {
    var cf = up(J.f), cts = +J.ts || 0, cp = up(J.p);
    if (!cf || !cts) return;
    var s = null;
    try { s = JSON.parse(sessionStorage.getItem("mzr_st") || "null"); sessionStorage.removeItem("mzr_st"); } catch (e) { s = null; }
    if (s && s.k === cf + "|" + cts + "|" + cp && Date.now() - (+s.t || 0) < 120000) {   // el link corto acaba de preguntar
      remember(cf, cp, s.req);
      late({ st: s.st, req: s.req, f: cf, p: cp, dm: s.dm || J.dm });
      return;
    }
    if (!URL_ || !KEY) return;
    ask({ p_f: cf, p_ts: cts, p_p: cp || null }).then(function (o) {
      if (!o || typeof o !== "object") return;
      remember(o.f || cf, o.p || cp, o.req);
      if (o.st) late({ st: o.st, req: o.req, f: o.f || cf, p: o.p || cp, dm: o.dm || J.dm });
    }, function () { });                                        // sin respuesta / 404 / error: no se sabe, no sale nada
  }

  var kind = m[1], tok = m[2], J = null;
  try { J = JSON.parse(b64(tok)); } catch (e) { J = null; }
  if (J && Array.isArray(J.o)) {                                // el link llegó completo: el app lo abre como siempre
    if (kind === "r") check(J);
    return;
  }

  // v1.2 · link corto (v240): {v, p, f, ts} sin líneas. Si no, un link cortado: el principio trae tienda, mayordomo y hora
  var short = kind === "r" && !!J && typeof J === "object" && !!J.f && !!J.ts;
  var f = "", ts = 0, p = "";
  if (short) { f = up(J.f); ts = +J.ts || 0; p = up(J.p); }
  else {
    var head = "";
    try { head = b64(tok.slice(0, tok.length - (tok.length % 4))); } catch (e) { head = ""; }
    f = up((/"f":"([^"]+)"/.exec(head) || [])[1]);
    ts = +((/"ts":(\d{10,})/.exec(head) || [])[1] || 0);
    p = ((/"p":"([A-Z]+)"/.exec(head) || [])[1] || "");
  }

  function ls(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function dev() { try { return localStorage.getItem("muniz_device_id") || ""; } catch (e) { return ""; } }
  function me() { var x = ls("muniz_pedido"); return x && x.name ? up(x.name) : ""; }
  // a quién le llegó el texto: el supervisor de ese mayordomo. El nombre guardado en el teléfono del supervisor suele ser
  // el de un mayordomo (Miguel: ALVARO AGUIRRE, ENRIQUE ALVARADO), así que solo cuenta si es de un supervisor o de la oficina
  function sup() {
    var a = CFG.ASIGNACIONES || {}, s = f && a[f] ? up(a[f]) : ""; if (s) return s;
    var n = me(), S = CFG.SUPERVISORES || {}, O = CFG.OFICINA || {}, k;
    for (k in S) if (up(k) === n) return n;
    for (k in O) if (up(k) === n) return n;
    return "";
  }
  function mark(ev, meta) {
    if (!URL_ || !KEY) return;
    try {
      var body = { device_id: dev() || null, app: "pedidos", event: ev, who: sup() || null };
      if (meta) body.meta = meta;
      fetch(URL_ + "/rest/v1/events", { method: "POST", keepalive: true,
        headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body) }).catch(function () { });
    } catch (e) { }
  }
  function nice(n) { return String(n || "").toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }); }
  var who = f ? esc(nice(f)) : "el mayordomo";

  // ---------- las pantallas del link (encima del app, que mientras tanto se queda en el inicio) ----------
  var ICON = '<img class="mzr-ic" src="./apple-touch-icon.png" alt="" width="64" height="64">';   // el ícono de la pantalla de inicio
  var left = false, slowT = 0;
  function screen(title, text, buttons, busy) {
    clearTimeout(slowT); slowT = 0;
    var L = buttons || [];
    boxShow("link", ICON + '<h1 id="mzr-t" tabindex="-1">' + title + '</h1><p class="mzr-tx">' + text + "</p>" +
      (busy ? '<div class="mzr-sp" aria-hidden="true"></div><p class="mzr-tx" id="mzr-note" role="status" aria-live="polite"></p><div id="mzr-more"></div>' : "") +
      (L.length ? '<div class="mzr-bs">' + L.map(btn).join("") + "</div>" : ""), function () { wire(L, 0); });
    if (busy) slowT = setTimeout(slow, SLOW);
  }
  function slow() {                                             // v1.3: a los 8 s, una salida (los intentos siguen)
    var n = D.getElementById("mzr-note"), mo = D.getElementById("mzr-more");
    if (mode !== "link" || !n || !mo || mo.firstChild) return;
    var L = [{ text: "ABRIR MI BANDEJA", href: "./bandeja.html" }, { text: "IR AL INICIO", href: "./", onclick: go }];
    n.innerHTML = "Está tardando. Sigo buscándolo — o apruébalo en tu <b>Bandeja</b> (toca tu nombre).";
    mo.className = "mzr-bs";
    mo.innerHTML = L.map(function (b, i) { return btn(b, 10 + i); }).join("");
    wire(L, 10);
  }
  function go(ev) {
    if (ev) ev.preventDefault();
    left = true; clearTimeout(slowT);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { }
    boxClose(focusApp);
  }
  function again(ev) { ev.preventDefault(); location.reload(); }
  var HOME = { text: "IR AL INICIO", href: "./", onclick: go };
  function show(why) {
    if (kind !== "r") {
      screen("El link llegó cortado", "El texto llegó en pedazos y el link no está completo. Pide que lo manden otra vez.",
        [{ text: "IR AL INICIO", href: "./", onclick: go, main: true }]);
    } else if (short && why === "net") {
      screen("Sin señal", "No pude traer el pedido de " + who + ".<br><br>Cuando tengas señal, toca <b>OTRA VEZ</b>.",
        [{ text: "OTRA VEZ", href: "#", onclick: again, main: true, go: true }, { text: "ABRIR MI BANDEJA", href: "./bandeja.html" }, HOME]);
    } else if (short && why === "nf") {
      screen("Todavía no llega el pedido", "El pedido de " + who + " todavía no está en la oficina (a lo mejor su teléfono se quedó sin señal).<br><br>" +
        "Toca <b>OTRA VEZ</b> en un minuto, o apruébalo en tu <b>Bandeja</b> (toca tu nombre).",
        [{ text: "OTRA VEZ", href: "#", onclick: again, main: true, go: true }, { text: "ABRIR MI BANDEJA", href: "./bandeja.html" }, HOME]);
    } else if (short) {
      screen("No se pudo abrir el pedido", "El pedido de " + who + " no se pudo abrir desde el link. Ya le avisé a Tito.<br><br>" +
        "<b>Apruébalo en tu Bandeja</b> (toca tu nombre), o toca <b>OTRA VEZ</b>.",
        [{ text: "ABRIR MI BANDEJA", href: "./bandeja.html", main: true }, { text: "OTRA VEZ", href: "#", onclick: again }, HOME]);
    } else {
      screen("El link llegó cortado",
        "Tu teléfono recibió el texto" + (f ? " de " + who : "") + " en pedazos, y el link no llegó completo.<br><br>" +
        "<b>Apruébalo en tu Bandeja</b> (toca tu nombre), o " + (f ? "pídele a " + who + " que lo mande" : "pide que lo manden") + " otra vez.",
        [{ text: "ABRIR MI BANDEJA", href: "./bandeja.html", main: true }, HOME]);
    }
  }
  // no se pudo: Tito se entera en ese momento (las alertas de error de parche167), y el supervisor ve qué hacer
  function fail(why, err) {
    var reason = why === "nf" ? "the order isn't on the server" : why === "net" ? "no signal (" + String(err && err.message || "network") + ")"
      : why === "none" ? "nothing in the link to look it up by" : "the server answered " + String(err && err.status || "?");
    mark("error", { msg: "Approval link for " + (f ? nice(f) + "'s " : "an ") + (p ? p + " " : "") + "order didn't open: " + reason +
      (short ? " · short link" : " · cut link"), where: "link", f: f || null, ts: ts || null, p: p || null });
    when(function () { if (!left) show(why); });                // ya se fue al inicio: el aviso a Tito sí, la pantalla no
  }

  var info = { f: f || null, ts: ts || null, p: p || null };
  mark(short ? "link_corto" : "link_cortado", info);
  if (kind !== "r") { when(function () { show(); }); return; }
  if (!f || !ts || !URL_ || !KEY) { fail("none"); return; }

  // ---------- traer el pedido del servidor ----------
  function open(o) {
    var E = { v: 1, p: o.p || p || "ACE", f: o.f || f, j: o.j || "", d: o.d || "", ts: o.ts || ts, u: o.u || {}, o: o.o };
    if (o.nf) E.nf = o.nf; if (o.ch) E.ch = o.ch; if (o.ad) E.ad = 1; if (o.dm) E.dm = 1;
    mark("link_recuperado", { f: E.f, ts: E.ts, p: E.p, req: o.req || null, short: short ? 1 : 0 });
    // v1.3: cómo va el pedido (ya lo contestó el servidor): la revisión que se abre ahora no vuelve a preguntar
    try { sessionStorage.setItem("mzr_st", JSON.stringify({ k: up(E.f) + "|" + E.ts + "|" + up(E.p), st: up(o.st), req: o.req || "", dm: o.dm ? 1 : 0, t: Date.now() })); } catch (e) { }
    location.replace(location.pathname + location.search + "#r=" + enc(E));
    location.reload();
  }
  var tries = 0, WAIT = [2500, 6000];                           // 3 intentos: ahora, a los 2.5 s y a los 6 s más
  function attempt() {
    ask({ p_f: f, p_ts: ts, p_p: p || null }).then(function (o) {
      if (o && Array.isArray(o.o) && o.o.length) { if (!left) open(o); return; }   // se fue al inicio: ya no se abre
      if (tries < WAIT.length) { setTimeout(attempt, WAIT[tries++]); return; }
      fail("nf");
    }).catch(function (e) {
      if (e && e.status) { fail("srv", e); return; }            // el servidor contestó con error: no se repite
      if (tries < WAIT.length) { setTimeout(attempt, WAIT[tries++]); return; }
      fail("net", e);
    });
  }
  when(function () {
    screen("Abriendo el pedido…", short ? "Pedido de " + who + ". Lo estoy trayendo de la oficina." :
      "El link llegó cortado. Lo estoy buscando completo en el servidor.", [], true);
    attempt();
  });
})();
