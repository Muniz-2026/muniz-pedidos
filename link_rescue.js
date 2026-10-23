/* =====================================================================
   MUÑIZ PEDIDOS · LINKS QUE LLEGAN CORTADOS  ·  v1.1
   v1.1: busca el pedido por el nombre del mayordomo (parche172, p_by_name). Antes my_orders solo veía los pedidos
         de este teléfono, y en el teléfono del supervisor nunca encontraba el pedido.
   ---------------------------------------------------------------------
   Un pedido largo hace un texto largo, y algunos teléfonos o compañías lo
   parten en pedazos: el link del pedido llega cortado. Antes el app no lo
   podía leer y se iba al inicio sin decir nada.

   Ahora, si el link (#r= / #t= / #p=) no se puede leer completo:
     1. del pedazo que sí llegó saca el nombre del mayordomo y la hora del pedido;
     2. busca ese pedido en el servidor (quedó registrado cuando el mayordomo
        tocó MANDAR) y, si lo encuentra, abre la revisión normal, completa;
     3. si no, dice claramente qué pasó y ofrece la Bandeja, donde el
        supervisor aprueba con su clave.
   Deja una marca en "events" (link_cortado / link_recuperado) para saber
   cuántas veces pasa.

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
  function complete(t) { try { var j = JSON.parse(b64(t)); return !!(j && Array.isArray(j.o)); } catch (e) { return false; } }
  if (complete(m[2])) return;                                   // el link llegó completo: el app lo abre como siempre

  var kind = m[1], tok = m[2];
  // lo que sí llegó: el principio del pedido trae tienda, mayordomo y hora
  var head = "";
  try { head = b64(tok.slice(0, tok.length - (tok.length % 4))); } catch (e) { head = ""; }
  var f = ((/"f":"([^"]+)"/.exec(head) || [])[1] || "").toUpperCase();
  var ts = +((/"ts":(\d{10,})/.exec(head) || [])[1] || 0);
  var p = ((/"p":"([A-Z]+)"/.exec(head) || [])[1] || "");

  var CFG = window.MUNIZ_CONFIG || {}, SB = CFG.SUPABASE || {};
  var URL_ = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  var KEY = String(SB.ANON_KEY || "").trim();
  function ls(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function dev() { try { return localStorage.getItem("muniz_device_id") || ""; } catch (e) { return ""; } }
  function me() { var x = ls("muniz_pedido"); return x && x.name ? String(x.name).toUpperCase() : null; }
  function mark(ev) {
    if (!URL_ || !KEY) return;
    try {
      fetch(URL_ + "/rest/v1/events", { method: "POST", keepalive: true,
        headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: dev() || null, app: "pedidos", event: ev, who: me() }) }).catch(function () { });
    } catch (e) { }
  }

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
  function show() {
    var go = function (ev) { ev.preventDefault(); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { } if (box && box.parentNode) box.parentNode.removeChild(box); box = null; };
    var who = f ? esc(f.replace(/\b\w+/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); })) : "el mayordomo";
    if (kind === "r") {
      screen("El link llegó cortado",
        "Tu teléfono recibió el texto de " + who + " en pedazos, y el link no llegó completo.<br><br>" +
        "<b>Aprueba el pedido en tu Bandeja</b> (con tu clave), o pídele a " + who + " que lo mande otra vez.",
        [{ text: "ABRIR MI BANDEJA", href: "./bandeja.html", main: true }, { text: "IR AL INICIO", href: "./", onclick: go }]);
    } else {
      screen("El link llegó cortado", "El texto llegó en pedazos y el link no está completo. Pide que lo manden otra vez.",
        [{ text: "IR AL INICIO", href: "./", onclick: go, main: true }]);
    }
  }

  mark("link_cortado");
  if (kind !== "r" || !f || !ts || !URL_ || !KEY) { (document.body ? show() : document.addEventListener("DOMContentLoaded", show)); return; }

  // ---------- buscar el pedido en el servidor ----------
  function start() {
    screen("Abriendo el pedido…", "El link llegó cortado. Lo estoy buscando completo en el servidor.", [], true);
    var done = false, t = setTimeout(function () { if (!done) { done = true; show(); } }, 9000);
    fetch(URL_ + "/rest/v1/rpc/my_orders", { method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_device: dev() || "link", p_name: f, p_by_name: true }) })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (done) return;
        var hit = null;
        (rows || []).forEach(function (o) {
          var k = o && o.payload || {};
          if (!hit && +k.ts === ts && Array.isArray(k.o) && String(o.foreman || f).toUpperCase() === f) hit = o;
        });
        if (!hit) { done = true; clearTimeout(t); show(); return; }
        var k = hit.payload || {};
        var o = (k.o || []).map(function (x) {                              // líneas como las manda el app: [código, cantidad] (o con descripción)
          if (Array.isArray(x)) return x;
          var c = x.c || x.k || x.sku, n = x.n != null ? x.n : x.q != null ? x.q : x.qty;
          return x.d != null ? [c, n, x.d] : [c, n];
        });
        var E = { v: 1, p: hit.provider || k.p || p || "ACE", f: hit.foreman || f, j: hit.jobsite || k.j || "", d: k.d || "", ts: k.ts, u: k.u || {}, o: o };
        if (k.nf) E.nf = k.nf; if (k.ch) E.ch = k.ch; if (k.ad) E.ad = 1; if (k.dm) E.dm = 1;
        done = true; clearTimeout(t);
        mark("link_recuperado");
        location.replace(location.pathname + location.search + "#r=" + enc(E));
        location.reload();
      })
      .catch(function () { if (!done) { done = true; clearTimeout(t); show(); } });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
