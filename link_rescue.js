/* =====================================================================
   MUÑIZ PEDIDOS · LINKS DE APROBACIÓN CORTOS Y CORTADOS  ·  v1.2
   v1.2 (v240): un pedido largo manda un LINK CORTO (#r= con solo mayordomo, tienda y hora): los textos de más de
         ~1,000 letras no le llegaban completos al supervisor (Miguel Juarez: S1026, S1031, S1096, S1167). Aquí se
         trae el pedido completo del servidor (order_for_link, parche192) y se abre la revisión de siempre. Un link
         que llega cortado se busca igual (my_orders ya no da el pedido a otro teléfono desde parche175). Si no se
         encuentra después de 3 intentos: avisa a Tito (evento "error" a nombre del supervisor) y ofrece OTRA VEZ y
         la Bandeja (el supervisor entra tocando su nombre, sin clave, desde v215).
   v1.1: busca el pedido por el nombre del mayordomo (parche172, p_by_name). Antes my_orders solo veía los pedidos
         de este teléfono, y en el teléfono del supervisor nunca encontraba el pedido.
   ---------------------------------------------------------------------
   Si el link (#r= / #t= / #p=) trae el pedido completo, este archivo no hace nada.
   Si no:
     1. link corto: ya trae mayordomo, tienda y hora; link cortado: del pedazo que sí llegó saca lo que pueda;
     2. pide ese pedido al servidor (quedó registrado cuando el mayordomo tocó MANDAR) y abre la revisión normal;
     3. si no, dice claramente qué pasó y ofrece OTRA VEZ / la Bandeja.
   Deja una marca en "events" (link_corto / link_cortado / link_recuperado; parche192 las deja pasar).

   Se carga en index.html después de config.js y ANTES de app.js. No toca app.js.
   ===================================================================== */
(function () {
  "use strict";
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
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }   // el nombre viene del link: nunca como HTML
  function up(s) { return String(s || "").toUpperCase().trim(); }

  var kind = m[1], tok = m[2], J = null;
  try { J = JSON.parse(b64(tok)); } catch (e) { J = null; }
  if (J && Array.isArray(J.o)) return;                          // el link llegó completo: el app lo abre como siempre

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

  var CFG = window.MUNIZ_CONFIG || {}, SB = CFG.SUPABASE || {};
  var URL_ = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  var KEY = String(SB.ANON_KEY || "").trim();
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

  // ---------- la pantalla (encima del app, que mientras tanto se queda en el inicio) ----------
  var box = null;
  function screen(title, text, buttons, busy) {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;inset:0;z-index:100000;background:#EDEBE6;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif";
      (document.body || document.documentElement).appendChild(box);
    }
    var html = '<div style="max-width:420px;width:100%;text-align:center">' +
      '<div style="width:64px;height:64px;margin:0 auto 14px;border-radius:18px;background:#FF5A00;color:#fff;display:flex;align-items:center;justify-content:center;font:900 34px/1 system-ui">M</div>' +
      '<div style="font:900 24px/1.15 system-ui;color:#17181A">' + title + '</div>' +
      '<div style="font:600 16px/1.4 system-ui;color:#374151;margin-top:10px">' + text + '</div>' +
      (busy ? '<div style="margin:22px auto 0;width:26px;height:26px;border-radius:50%;border:3px solid rgba(0,0,0,.12);border-top-color:#FF5A00;animation:mzspin .8s linear infinite"></div><style>@keyframes mzspin{to{transform:rotate(360deg)}}</style>' : '');
    (buttons || []).forEach(function (b, i) {
      html += '<a href="' + b.href + '" id="mzr-b' + i + '" style="display:block;margin-top:' + (i ? 10 : 22) + 'px;padding:16px;border-radius:14px;text-decoration:none;font:900 17px/1 system-ui;' +
        (b.main ? 'background:#1F8A3B;color:#fff' : 'background:#fff;color:#17181A;border:2px solid #D8D4CB') + '">' + b.text + '</a>';
    });
    box.innerHTML = html + '</div>';
    (buttons || []).forEach(function (b, i) { if (b.onclick) { var el = document.getElementById("mzr-b" + i); if (el) el.onclick = b.onclick; } });
  }
  function go(ev) { ev.preventDefault(); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { } if (box && box.parentNode) box.parentNode.removeChild(box); box = null; }
  function again(ev) { ev.preventDefault(); location.reload(); }
  var HOME = { text: "IR AL INICIO", href: "./", onclick: go };
  function show(why) {
    if (kind !== "r") {
      screen("El link llegó cortado", "El texto llegó en pedazos y el link no está completo. Pide que lo manden otra vez.",
        [{ text: "IR AL INICIO", href: "./", onclick: go, main: true }]);
    } else if (short && why === "net") {
      screen("Sin señal", "No pude traer el pedido de " + who + ".<br><br>Cuando tengas señal, toca <b>OTRA VEZ</b>.",
        [{ text: "OTRA VEZ", href: "#", onclick: again, main: true }, { text: "ABRIR MI BANDEJA", href: "./bandeja.html" }, HOME]);
    } else if (short && why === "nf") {
      screen("Todavía no llega el pedido", "El pedido de " + who + " todavía no está en la oficina (a lo mejor su teléfono se quedó sin señal).<br><br>" +
        "Toca <b>OTRA VEZ</b> en un minuto, o apruébalo en tu <b>Bandeja</b> (toca tu nombre).",
        [{ text: "OTRA VEZ", href: "#", onclick: again, main: true }, { text: "ABRIR MI BANDEJA", href: "./bandeja.html" }, HOME]);
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
  function when(fn) { if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn); }
  // no se pudo: Tito se entera en ese momento (las alertas de error de parche167), y el supervisor ve qué hacer
  function fail(why, err) {
    var reason = why === "nf" ? "the order isn't on the server" : why === "net" ? "no signal (" + String(err && err.message || "network") + ")"
      : why === "none" ? "nothing in the link to look it up by" : "the server answered " + String(err && err.status || "?");
    mark("error", { msg: "Approval link for " + (f ? nice(f) + "'s " : "an ") + (p ? p + " " : "") + "order didn't open: " + reason +
      (short ? " · short link" : " · cut link"), where: "link", f: f || null, ts: ts || null, p: p || null });
    when(function () { show(why); });
  }

  var info = { f: f || null, ts: ts || null, p: p || null };
  mark(short ? "link_corto" : "link_cortado", info);
  if (kind !== "r") { when(function () { show(); }); return; }
  if (!f || !ts || !URL_ || !KEY) { fail("none"); return; }

  // ---------- traer el pedido del servidor ----------
  function ask() {
    return fetch(URL_ + "/rest/v1/rpc/order_for_link", { method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_f: f, p_ts: ts, p_p: p || null }) })
      .then(function (r) { if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return r.json(); });
  }
  function open(o) {
    var E = { v: 1, p: o.p || p || "ACE", f: o.f || f, j: o.j || "", d: o.d || "", ts: o.ts || ts, u: o.u || {}, o: o.o };
    if (o.nf) E.nf = o.nf; if (o.ch) E.ch = o.ch; if (o.ad) E.ad = 1; if (o.dm) E.dm = 1;
    mark("link_recuperado", { f: E.f, ts: E.ts, p: E.p, req: o.req || null, short: short ? 1 : 0 });
    location.replace(location.pathname + location.search + "#r=" + enc(E));
    location.reload();
  }
  var tries = 0, WAIT = [2500, 6000];                           // 3 intentos: ahora, a los 2.5 s y a los 6 s más
  function attempt() {
    ask().then(function (o) {
      if (o && Array.isArray(o.o) && o.o.length) { open(o); return; }
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
