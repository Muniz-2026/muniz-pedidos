/* =====================================================================
   MUÑIZ · ACTIVIDAD EN VIVO  ·  mz_track.js  ·  v1.0
   v1.0 (Oct 22, 2026): la oficina ve en el Command Center (sala ACTIVITY), mientras pasa, lo que hace cada
         teléfono: en qué pantalla está, qué va metiendo al carrito, qué busca, cada paso del PO de combustible
         y en qué pantalla cierra el app. Con eso se mide todo: cuántos usan el app, cuánto tardan del primer
         artículo al pedido, si cambian cantidades, si quitan lo que metieron, qué botones nadie toca.
   ---------------------------------------------------------------------
   Qué guarda: la pantalla, el texto del botón que se toca, cada cambio del carrito (código y cantidad), lo
   que se busca en el catálogo, la placa y el odómetro que se teclean en la bomba, los pasos del PO, cuándo
   se manda el pedido, cuándo se esconde / regresa / cierra el app, los errores del app.
   Qué NO guarda nunca: la clave (los números del teclado no se guardan), contraseñas, correos, ni lo que
   se escribe en cualquier otro campo.
   Cómo: no toca app.js. Lee el pedido que el app ya guarda en el teléfono (muniz_pedido) en el momento en
   que lo guarda, escucha los toques, y los pasos que fuel.js avisa (evento mz-fuel). Junta todo y lo manda
   cada 2 s en un solo envío (rpc/activity_push, parche171). Sin señal lo guarda (hasta 400) y lo manda
   después. Si algo falla aquí el app sigue igual: todo va dentro de try/catch y nada espera a este archivo.
   Se carga en index.html (antes de app.js), fuel.html y bandeja.html, después de config.js.
   ===================================================================== */
(function () {
  "use strict";
  if (window.MZT) return;
  var CFG = window.MUNIZ_CONFIG || {}, SB = CFG.SUPABASE || {};
  var URL_ = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
  var KEY = String(SB.ANON_KEY || "").trim();
  if (!URL_ || !KEY) return;                      // sin base de datos: no hace nada

  var VERSION = "1.0";
  var ME = document.currentScript, PAGE = (ME && ME.getAttribute("data-page")) || "pedidos";   // pedidos · fuel · bandeja
  var K_DEV = "muniz_device_id", K_PED = "muniz_pedido", K_Q = "muniz_mzt_q_" + PAGE, K_FIRST = "muniz_mzt_first", K_SEEN = "muniz_mzt_seen";
  var MAXQ = 400;

  /* ---------- utilidades ---------- */
  var LS = null; try { LS = window.localStorage; } catch (e) { }
  var origSet = null; try { origSet = Storage.prototype.setItem; } catch (e) { }
  function get(k) { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } }
  function put(k, v) { try { if (LS && origSet) origSet.call(LS, k, v); } catch (e) { } }   // sin pasar por el gancho de abajo
  function jget(k, d) { try { var v = get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function now() { return Date.now(); }
  function up(s) { return String(s || "").toUpperCase().trim(); }
  function rid() { return (now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(-12); }
  function day() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function deviceId() {
    var d = get(K_DEV);
    if (!d) { d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(now()) + Math.random().toString(36).slice(2); put(K_DEV, d); }
    return d || "nodev";
  }
  var LT = {};
  function later(k, fn, ms) { clearTimeout(LT[k]); LT[k] = setTimeout(function () { try { fn(); } catch (e) { } }, ms); }

  /* ---------- quién y dónde ---------- */
  var SESS = rid(), LINK = "", fuelWho = "", fuelS = null, lastQ = "";
  try { var h0 = location.hash || ""; LINK = /^#r=/.test(h0) ? "revisar" : /^#p=/.test(h0) ? "recoger" : /^#t=/.test(h0) ? "final" : ""; } catch (e) { }
  var prevPed = jget(K_PED, null);
  function who() {
    if (PAGE === "fuel") return fuelWho || up(jget("muniz_fuel_me", ""));
    return prevPed && prevPed.name ? up(prevPed.name) : "";
  }
  /* la gente de config (mayordomos, supervisores, gerentes, oficina, choferes): un toque en un nombre es "NOMBRE" */
  var PEOPLE = null;
  function isPerson(l) {
    if (!PEOPLE) {
      PEOPLE = {};
      try {
        var c = window.MUNIZ_CONFIG || {}, F = c.COMBUSTIBLE || {};
        [c.ASIGNACIONES, c.PERSONAL, c.SUPERVISORES, c.GERENTES, c.OFICINA, F.CHOFERES_CAMION].forEach(function (o) {
          if (!o) return;
          (Array.isArray(o) ? o : Object.keys(o)).forEach(function (n) { PEOPLE[up(n)] = 1; });
        });
      } catch (e) { }
    }
    return !!PEOPLE[up(l)];
  }
  var NAME_RE = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ.'-]*(?: [A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ.'-]*)+$/;
  var NOT_NAME = /MIS PEDIDOS|CAMBIAR|PR[AÁ]CTICA|CHOFER|CANCELAR|AGREGAR|QUITAR|BORRAR|SALIR|OFICINA|REGRESAR|OTRO|LISTO|ENTRAR|BUSCAR/;
  var NAME_SCR = { inicio: 1, para: 1, "fuel/para": 1, "fuel/nombre": 1 };
  var LETTER = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
  function confirmOpen() {                       // ¿YA LO MANDASTE? (después de MANDAR, antes de SÍ, YA LO MANDÉ)
    var b = document.querySelectorAll("#root button");
    for (var i = 0; i < b.length && i < 120; i++) if (/YA LO MAND/.test(b[i].textContent || "")) return true;
    return false;
  }
  function where() {
    try {
      var d = document, H = d.documentElement;
      if (PAGE === "bandeja") return location.hash === "#mis" ? "mis" : "bandeja";
      if (PAGE === "fuel") {
        if (/^#(oficina|f=)/.test(location.hash || "")) return "fuel/oficina";
        if (d.querySelector(".mzf-names")) return "fuel/nombre";
        return "fuel/" + ((fuelS && fuelS.open && fuelS.step) || "inicio");
      }
      var panel = d.querySelector("body > .mzf-scroll");
      if (panel) return panel.querySelector(".mzf-names") ? "fuel/nombre" : "fuel/" + ((fuelS && fuelS.open && fuelS.step) || "est");
      if (d.getElementById("mz-fpara-q")) return "fuel/para";
      if (d.getElementById("mz-para-back")) return "para";
      if (d.getElementById("mz-mat")) return "menu";
      var foto = H.classList.contains("mz-photo") ? "/foto" : "";
      if (LINK) return LINK + foto;
      var st = prevPed || {}, s = st.name ? String(st.screen || "prov") : "inicio";
      if (foto) return s + foto;
      if (s === "lista" && confirmOpen()) return "lista/mandar";
      return s;
    } catch (e) { return lastScr || "?"; }
  }

  /* ---------- la cola: se manda cada 2 s ---------- */
  var Q = jget(K_Q, []); if (!Array.isArray(Q)) Q = []; Q = Q.slice(-MAXQ); put(K_Q, "[]");
  var lastScr = "", scrAt = now(), spMax = 0, dead = false, sending = false, timer = 0, fails = 0, liveSent = "", liveAt = 0;
  function add(e, x, scr) {
    if (dead) return;
    try {
      var r = { e: e, t: now(), s: scr || lastScr || "", z: SESS }, w = who();
      if (w) r.w = w;
      if (x) r.x = x;
      Q.push(r); if (Q.length > MAXQ) Q.splice(0, Q.length - MAXQ);
      soon();
    } catch (err) { }
  }
  function soon(ms) { if (!timer && !dead) timer = setTimeout(function () { flush(false); }, ms || 2000); }
  function save() { put(K_Q, JSON.stringify(Q.slice(-MAXQ))); }
  function bag(st) {                              // el carrito entero: "ACE|CÓDIGO" → cantidad, y lo de fuera de catálogo "ACE|*texto"
    var m = {}, c = (st && st.cart) || {}, k;
    for (k in c) { var q = +c[k] || 0; if (q > 0) m[k.indexOf("|") < 0 ? "ACE|" + k : k] = q; }
    var cu = (st && st.customs) || [];
    for (var i = 0; i < cu.length; i++) {
      var x = cu[i]; if (!x || !x.d) continue;
      var kk = (x.dm ? "~" : "") + (x.pr || "ACE") + "|*" + String(x.d).slice(0, 60);
      m[kk] = (m[kk] || 0) + (+x.n || 1);
    }
    return m;
  }
  function live() {                               // lo que se ve en la pantalla ahora (app_live)
    var l = { scr: lastScr || "", hid: document.hidden ? 1 : 0, pg: PAGE };
    if (LINK) l.link = LINK;
    if (PAGE === "pedidos") {
      var st = prevPed || {}, b = bag(st), c = {}, n = 0, k;
      if (st.name) l.name = up(st.name);
      if (st.prov) l.prov = String(st.prov).slice(0, 20);
      if (st.job) l.job = String(st.job).slice(0, 80);
      for (k in b) { if (n++ >= 80) break; c[k.slice(0, 90)] = b[k]; }
      if (n) l.cart = c;
      if (st.sent && st.sent.t) l.sent = { t: st.sent.t, prov: st.sent.prov || "", n: +st.sent.n || 0 };
      if (st.adm) l.adm = 1;
      if (st.extra) l.note = String(st.extra).slice(0, 120);
      var fm = jget(K_FIRST, null); if (fm && typeof fm === "object" && Object.keys(fm).length) l.first = fm;
    }
    if (fuelS && fuelS.open) l.f = fuelS;
    if (lastQ) l.q = lastQ;
    return l;
  }
  function flush(final) {
    clearTimeout(timer); timer = 0;
    if (dead || (sending && !final)) { if (!dead) soon(); return; }
    var l = null, ls = "";
    try { l = live(); ls = JSON.stringify(l); } catch (e) { }
    var liveDue = !!ls && (ls !== liveSent || now() - liveAt > 60e3);
    if (!Q.length && !liveDue) return;
    var p = { d: deviceId(), w: who() || null, a: PAGE, s: SESS, v: VERSION, r: [] }, rows = Q.splice(0, 60), body = "";
    if (liveDue) p.l = l;
    for (;;) {                                    // un envío chico: si no cabe, la mitad ahora y la otra mitad después
      p.r = rows; body = JSON.stringify({ p: p });
      if (body.length < 45000 || rows.length <= 1) break;
      var half = Math.ceil(rows.length / 2); Q = rows.slice(half).concat(Q); rows = rows.slice(0, half);
    }
    sending = true;
    var done = function (ok, kill) {
      sending = false;
      if (ok) { fails = 0; if (liveDue) { liveSent = ls; liveAt = now(); } if (Q.length) soon(final ? 60 : 2000); return; }
      if (kill) { dead = true; Q = []; put(K_Q, "[]"); return; }          // la base todavía no tiene activity_push: no insistir
      Q = rows.concat(Q).slice(-MAXQ); fails = Math.min(fails + 1, 6); save();
      soon(Math.min(120e3, 2000 * Math.pow(2, fails)));
    };
    try {
      fetch(URL_ + "/rest/v1/rpc/activity_push", { method: "POST", keepalive: true, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: body })
        .then(function (res) { done(res.ok, !res.ok && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429); })
        .catch(function () { done(false, false); });
    } catch (e) { done(false, false); }
    if (final && Q.length) flush(true);           // al cerrar: todo lo que queda, ya
  }

  /* ---------- pantallas ---------- */
  function checkScreen() {
    var s = where();
    if (!s) return;
    if (fuelS && fuelS.open && (s.indexOf("fuel/") !== 0 || s === "fuel/nombre" || s === "fuel/oficina")) fuelS.open = 0;   // cerró el PO de combustible
    if (s === lastScr) return;
    if (lastQ && s.indexOf("pedir") !== 0) lastQ = "";                          // la búsqueda es del catálogo
    var from = lastScr, x = {};
    if (from) { x.from = from; x.ms = now() - scrAt; if (spMax) x.sp = spMax; }
    lastScr = s; scrAt = now(); spMax = 0;
    add("scr", x, s);
    later("seen", snapshot, 1200);
  }

  /* ---------- el carrito: cada cambio, en el momento en que el app lo guarda ---------- */
  function preOf(k) { var i = k.indexOf("|"); return i < 0 ? "" : k.slice(0, i + 1); }
  function anyPre(m, pre) { for (var k in m) if (k.indexOf(pre) === 0) return true; return false; }
  var addAt = {};
  function diffPed(a, b) {
    if (!b || typeof b !== "object") return;
    a = a || {};
    var na = up(a.name), nb = up(b.name), k;
    prevPed = b;
    if (nb && nb !== na) add("who", { v: nb });
    if ((b.prov || "") !== (a.prov || "") && b.prov) add("prov", { v: String(b.prov).slice(0, 20) });
    if ((b.job || "") !== (a.job || "")) later("job", function () { add("job", { v: String((prevPed && prevPed.job) || "").slice(0, 80) }); }, 1500);
    if ((b.adm ? 1 : 0) !== (a.adm ? 1 : 0)) add("adm", { v: b.adm ? 1 : 0 });
    if ((b.extra || "") !== (a.extra || "")) later("note", function () { add("note", { v: String((prevPed && prevPed.extra) || "").slice(0, 160) }); }, 2000);
    var A = bag(a), B = bag(b), sentPre = "", fm = jget(K_FIRST, {}) || {}, fmDirty = false;
    if (b.sent && b.sent.t && (!a.sent || a.sent.t !== b.sent.t)) {           // MANDÓ el pedido
      sentPre = (b.sent.dm ? "~" : "") + (b.sent.prov || a.prov || "ACE") + "|";
      var lines = 0, units = 0, cu = 0, it = [];
      for (k in A) if (k.indexOf(sentPre) === 0) {
        lines++; units += A[k]; if (k.charAt(sentPre.length) === "*") cu++;
        if (it.length < 60) it.push([k.slice(sentPre.length, sentPre.length + 60), A[k]]);
      }
      var f0 = +fm[sentPre] || 0;
      add("sent", { prov: String(b.sent.prov || "").slice(0, 20), n: +b.sent.n || units, lines: lines, units: units, cu: cu, it: it, first: f0 ? now() - f0 : null,
        job: String(b.sent.job || b.job || "").slice(0, 80), to: String(b.sent.target || "").slice(0, 40), ad: b.sent.ad ? 1 : 0, dm: b.sent.dm ? 1 : 0 });
      if (fm[sentPre]) { delete fm[sentPre]; fmDirty = true; }
    }
    var keys = {};
    for (k in A) keys[k] = 1;
    for (k in B) keys[k] = 1;
    for (k in keys) {
      var p = A[k] || 0, q = B[k] || 0, pre = preOf(k);
      if (p === q) continue;
      if (sentPre && q === 0 && pre === sentPre) continue;                      // se fue en el pedido, no lo quitaron
      var x = { k: k.slice(0, 90), q: q, p: p };
      if (p === 0) {
        addAt[k] = now();
        if (!anyPre(A, pre) && !fm[pre]) { fm[pre] = now(); fmDirty = true; x.first = 1; }   // el primer artículo de este carrito
      } else if (q === 0 && addAt[k]) x.ms = now() - addAt[k];
      if (q === 0) delete addAt[k];
      add("cart", x);
    }
    for (var pr in fm) if (pr !== sentPre && !anyPre(B, pr)) {                 // vació el carrito sin mandar
      add("empty", { pre: pr, ms: now() - (+fm[pr] || now()) });
      delete fm[pr]; fmDirty = true;
    }
    if (fmDirty) put(K_FIRST, JSON.stringify(fm));
  }
  /* se compara lo último que guardó el app, 1/4 de segundo después: al abrir, el app guarda un instante un pedido
     vacío antes de poner el que tenía (eso no es "quitó todo y lo volvió a poner") */
  var pendV = null, drainT = 0, drainAt = 0;
  function drain() {
    drainT = 0; drainAt = 0;
    var v = pendV; pendV = null;
    if (v != null) { try { diffPed(prevPed, JSON.parse(v)); } catch (e) { } }
    checkScreen();
  }
  if (PAGE === "pedidos" && LS && origSet) {
    try {
      Storage.prototype.setItem = function (k, v) {
        var r = origSet.apply(this, arguments);                                  // primero lo del app, igual que siempre
        try {
          if (k === K_PED && this === LS) {
            pendV = String(v); if (!drainAt) drainAt = now();
            clearTimeout(drainT); drainT = setTimeout(drain, now() - drainAt > 1000 ? 0 : 250);
          }
        } catch (e) { }
        return r;
      };
    } catch (e) { }
  }

  /* ---------- los toques ---------- */
  function textOf(el) {
    var t = "";
    try {
      t = el.getAttribute("aria-label") || "";
      if (!t && el.tagName !== "SELECT") {          // una tarjeta trae título y renglones que cambian (TU ÚLTIMO PO…): cuenta el título
        var lines = String((el.innerText != null ? el.innerText : el.textContent) || "").split(/\n+/);
        for (var i = 0; i < lines.length && !t; i++) if (LETTER.test(lines[i])) t = lines[i];
        if (!t) t = lines.join(" ");
      }
      if (!t && el.tagName === "SELECT") t = "(lista)";
      if (!t && el.tagName === "INPUT") t = "(" + (el.type || "input") + ")";
      if (!t && el.querySelector) { var im = el.querySelector("img[alt]"); if (im) t = im.getAttribute("alt") || ""; }
    } catch (e) { }
    return String(t).replace(/\s+/g, " ").trim().slice(0, 48);
  }
  function cardCode(el) {                         // una tarjeta del catálogo: su código
    try {
      var c = el.closest("div.relative.rounded-xl.overflow-hidden"); if (!c) return "";
      var m = c.querySelector(".font-mono"); return m ? String(m.textContent || "").trim().slice(0, 60) : "";
    } catch (e) { return ""; }
  }
  function tapLabel(el, s) {                      // → [texto, extra] · null = no se guarda
    var code = cardCode(el), v;
    if (code) {
      var al = el.getAttribute("aria-label") || "", t0 = String(el.textContent || "").trim();
      return ["ARTÍCULO" + (al ? " · 🔍" : (t0 === "−" || t0 === "+") ? " · " + t0 : ""), { c: code }];
    }
    v = el.getAttribute("data-para") || el.getAttribute("data-fpara");
    if (v) return ["NOMBRE", { v: up(v).slice(0, 40) }];
    var l = textOf(el);
    if (!l) return null;
    if (/\d/.test(l) && !LETTER.test(l)) return null;                           // teclado de la clave, cantidades: nunca
    if (isPerson(l) || (NAME_SCR[s] && NAME_RE.test(l) && !NOT_NAME.test(l))) return ["NOMBRE", { v: l.slice(0, 40) }];
    return [l, null];
  }
  function onTap(ev) {
    try {
      if (dead) return;
      var t = ev.target, el = t && t.closest ? t.closest("button, a, [role=button], summary, select, input[type=checkbox], input[type=radio]") : null;
      if (!el) return;
      checkScreen();
      var s = lastScr, r = tapLabel(el, s);
      if (!r) return;
      // los botones que salen un momento (CONTINUAR, GENERAR PO) se cuentan antes de que el toque cambie la pantalla
      if (s.indexOf("pedir") !== 0 && now() - (snapAt[s] || 0) > 3000) snapshot();
      var x = r[1] || {};
      x.l = r[0];
      if (el.tagName === "A") { var h = String(el.getAttribute("href") || ""); x.a = /^sms:/i.test(h) ? "sms" : /^tel:/i.test(h) ? "tel" : /bandeja\.html/i.test(h) ? "mis" : "link"; }
      add("tap", x, s);
      setTimeout(checkScreen, 450);
      later("seen", snapshot, 1500);
    } catch (e) { }
  }

  /* ---------- lo que se ve en cada pantalla (una vez al día): para saber qué botones nadie toca ---------- */
  var SEEN = null;
  function layer() {                              // la capa de arriba: combustible, menú, foto, o el app
    var d = document, H = d.documentElement, f = d.querySelector("body > .mzf-scroll"), i;
    if (f) return f;
    if (H.classList.contains("mz-dialog")) {
      var kids = d.body.children;
      for (i = kids.length - 1; i >= 0; i--) { var k = kids[i]; if (k.tagName === "DIV" && k.id !== "root" && k.id !== "boot" && k.querySelector("button")) return k; }
    }
    var r = d.getElementById("root") || d.getElementById("fuel-root") || d.body, ov = r.querySelectorAll(".fixed.inset-0");
    for (i = ov.length - 1; i >= 0; i--) if (ov[i].getClientRects().length && ov[i].querySelector("button")) return ov[i];
    return r;
  }
  function norm(l) { return String(l).replace(/\d+/g, "#").slice(0, 40); }
  var snapAt = {};
  function snapshot() {
    try {
      if (document.hidden || dead) return;
      if (where() !== lastScr) { checkScreen(); return; }                     // cambió de pantalla: se cuenta la nueva en un momento
      var s = lastScr; if (!s) return;
      snapAt[s] = now();
      var d = day();
      if (!SEEN || SEEN.d !== d) { SEEN = jget(K_SEEN, null); if (!SEEN || SEEN.d !== d || !SEEN.s) SEEN = { d: d, s: {} }; }
      var have = SEEN.s[s] || (SEEN.s[s] = []), got = {}, nu = [];
      var els = layer().querySelectorAll("button, a[href], [role=button], select, summary");
      for (var i = 0; i < els.length && i < 900; i++) {
        var el = els[i];
        if (el.disabled || !el.getClientRects().length) continue;
        var t = tapLabel(el, s); if (!t) continue;
        var l = norm(t[0]); if (got[l]) continue; got[l] = 1;
        if (have.indexOf(l) < 0 && have.length < 150) { have.push(l); nu.push(l); }
      }
      if (nu.length) { put(K_SEEN, JSON.stringify(SEEN)); add("seen", { l: nu.slice(0, 80) }, s); }
    } catch (e) { }
  }

  /* ---------- lo que se teclea: solo buscar, placa y odómetro ---------- */
  function fieldOf(el) {
    try {
      if (!el || el.tagName !== "INPUT") return "";
      var ty = String(el.type || "text").toLowerCase(), cl = " " + (el.className || "") + " ";
      if (ty === "password" || ty === "email" || ty === "hidden") return "";
      if (cl.indexOf(" mzf-input ") >= 0 && cl.indexOf(" big ") >= 0) return "placa";
      if (cl.indexOf(" mzf-input ") >= 0 && cl.indexOf(" num ") >= 0) return "odometro";
      var ph = String(el.getAttribute("placeholder") || "");
      if (/buscar/i.test(ph) || ty === "search") return /nombre/i.test(ph) ? "nombre" : "buscar";
    } catch (e) { }
    return "";
  }
  var FV = {};
  function onInput(ev) {
    try {
      if (dead) return;
      var el = ev.target, f = fieldOf(el); if (!f) return;
      checkScreen();
      var v = String(el.value || "").replace(/\s+/g, " ").trim().slice(0, 60), s = lastScr;
      if (f === "placa" || f === "odometro") { fuelS = fuelS || { open: 1, t0: now() }; fuelS[f === "placa" ? "placa" : "odo"] = v; soon(); }
      if (f === "buscar") { lastQ = v; soon(); }
      later("seen", snapshot, 1500);
      later("in_" + f, function () {
        if (FV[f] === v || !v) { FV[f] = v; return; }
        FV[f] = v;
        var x = { f: f, v: v };
        if (f === "buscar") x.n = document.querySelectorAll("#root div.relative.rounded-xl.overflow-hidden").length;
        add(f === "buscar" ? "search" : "field", x, s);
      }, 1200);
    } catch (e) { }
  }

  /* ---------- combustible: fuel.js avisa cada paso (mz-fuel) ---------- */
  window.addEventListener("mz-fuel", function (ev) {
    try {
      var d = ev.detail || {}, e = String(d.event || ""), m = d.meta || {};
      if (d.who) fuelWho = up(d.who);
      if (e === "open") fuelS = { open: 1, step: "est", t0: now(), who: fuelWho };
      else {
        fuelS = fuelS || { open: 1, t0: now(), who: fuelWho };
        if (e === "step") {
          fuelS.open = 1;
          if (m.screen) fuelS.step = String(m.screen).slice(0, 16);
          if (m.station != null) fuelS.est = String(m.station || "").slice(0, 20);
          if (Array.isArray(m.fuels)) fuelS.fu = m.fuels.slice(0, 4);
        }
        if (e === "po_created") { fuelS.po = String(m.po || "").slice(0, 12); if (m.seconds != null) fuelS.secs = m.seconds; delete fuelS.err; }
        if (e === "error") fuelS.err = String(m.msg || m.where || "error").slice(0, 80);
      }
      try { if (window.__mzFuelPor) fuelS.por = up(window.__mzFuelPor).slice(0, 40); } catch (x0) { }
      if (e !== "step") {                         // los pasos salen como cambios de pantalla
        var x = { k: e.slice(0, 16) };
        if (e === "po_created") { x.po = fuelS.po; x.secs = fuelS.secs; x.est = String(m.station || fuelS.est || "").slice(0, 20); x.fu = (m.fuels || fuelS.fu || []).slice(0, 4); x.ms = now() - (fuelS.t0 || now()); }
        if (e === "error") { x.where = String(m.where || "").slice(0, 30); x.msg = String(m.msg || "").slice(0, 160); }
        if (fuelS.who && fuelS.who !== who()) x.para = fuelS.who;
        add("fuel", x, "fuel/" + (fuelS.step || "est"));
      }
      setTimeout(checkScreen, 0);
      soon();
    } catch (err) { }
  });

  /* ---------- se esconde, regresa, cierra ---------- */
  var visAt = now(), hidAt = 0, errN = 0;
  document.addEventListener("visibilitychange", function () {
    try {
      if (document.hidden) { hidAt = now(); checkScreen(); add("hide", { ms: now() - visAt }); flush(true); }
      else {
        var away = hidAt ? now() - hidAt : 0; visAt = now(); hidAt = 0;
        if (away > 30 * 60e3) { SESS = rid(); add("open", meta(1)); } else add("show", { ms: away });
        checkScreen(); soon();
      }
    } catch (e) { }
  });
  window.addEventListener("pagehide", function () { try { add("exit", { ms: now() - visAt }); flush(true); save(); } catch (e) { } });
  window.addEventListener("error", function (ev) {
    try { if (++errN > 5) return; add("err", { m: String(ev.message || "").slice(0, 160), f: String(ev.filename || "").split("/").pop().slice(0, 40), ln: ev.lineno || 0 }); } catch (e) { }
  });
  window.addEventListener("unhandledrejection", function (ev) {
    try { if (++errN > 5) return; var r = ev.reason; add("err", { m: String((r && r.message) || r || "").slice(0, 160), p: 1 }); } catch (e) { }
  });
  document.addEventListener("scroll", function (ev) {                           // qué tanto bajó en la pantalla
    try {
      var el = ev.target && ev.target.nodeType === 1 ? ev.target : (document.scrollingElement || document.documentElement);
      var h = el.scrollHeight - el.clientHeight; if (h < 120) return;
      var p = Math.round(Math.max(0, Math.min(1, el.scrollTop / h)) * 100);
      if (p > spMax) spMax = p;
    } catch (e) { }
  }, { capture: true, passive: true });
  document.addEventListener("click", onTap, true);
  document.addEventListener("input", onInput, true);

  /* ---------- al abrir ---------- */
  function meta(resume) {
    var m = { v: VERSION };
    try {
      m.sa = !!(navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches));
      var ua = navigator.userAgent || "";
      m.os = /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "other";
      m.push = ("Notification" in window && "PushManager" in window) ? String(Notification.permission) : "none";
      m.vw = window.innerWidth || 0; m.vh = window.innerHeight || 0;
      if (LINK) m.link = LINK;
      if (resume) m.resume = 1;
      if (navigator.onLine === false) m.off = 1;
      var c = navigator.connection; if (c && c.effectiveType) m.net = String(c.effectiveType).slice(0, 8);
      var ref = !resume && document.referrer ? String(document.referrer).split("#")[0].split("?")[0].split("/").pop() : "";
      if (ref) m.ref = ref.slice(0, 30);
    } catch (e) { }
    return m;
  }
  add("open", meta(0), "");
  setTimeout(checkScreen, 700);
  setInterval(function () { try { if (document.hidden) return; checkScreen(); if (now() - liveAt > 60e3) soon(); } catch (e) { } }, 1500);
  window.MZT = { v: VERSION, page: PAGE, sess: function () { return SESS; }, queued: function () { return Q.length; }, flush: function () { flush(true); } };
})();
