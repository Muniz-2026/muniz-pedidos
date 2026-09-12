/* =====================================================================
   MUÑIZ PEDIDOS · REGISTRO EN LA BASE DE DATOS (Fase 2)  ·  v1.0
   ---------------------------------------------------------------------
   Qué hace: en el instante en que alguien toca MANDAR / APROBAR /
   RECHAZAR / TICKET en el app de pedidos, el pedido queda registrado en
   Supabase — ANTES de que se abra Mensajes. Si el mayordomo nunca manda
   el texto, la oficina lo ve de todos modos.

   Cómo lo hace: el app ya mete el pedido completo, codificado, dentro
   del link que abre Mensajes (#r= / #t= / #p=). Este archivo escucha
   ese toque, decodifica el pedido, le agrega descripción y precio de
   catálogo a cada línea y lo manda a la función register_material_order.
   No toca app.js. Si no hay señal, lo guarda y lo reintenta solo.

   Se carga en index.html después de config.js. Sin URL/ANON_KEY no hace nada.
   ===================================================================== */
(function () {
  "use strict";
  var CFG = window.MUNIZ_CONFIG || {};
  var SB = CFG.SUPABASE || {};
  var URL_ = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
  var KEY = String(SB.ANON_KEY || "").trim();
  if (!URL_ || !KEY) return;                      // sin base de datos: el app sigue igual que antes

  var VERSION = "1.1";
  var K_DEV = "muniz_device_id", K_OUT = "muniz_db_outbox", K_LAST = "muniz_db_last", K_PED = "muniz_pedido";
  var PROVS = { ACE: 1, CMC: 1, RSS: 1, WHITECAP: 1 };
  var STAGE = { r: "SOLICITADO", t: "APROBADO", p: "TICKET" };

  /* ---------- utilidades ---------- */
  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function deviceId() {
    try {
      var d = localStorage.getItem(K_DEV);
      if (!d) { d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); localStorage.setItem(K_DEV, d); }
      return d;
    } catch (e) { return "nodev"; }
  }
  function b64urlJson(t) {
    try {
      t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "=";
      var a = atob(t), r = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) r[i] = a.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(r));
    } catch (e) { return null; }
  }
  function whoAmI() { var p = ls(K_PED, null); return p && p.name ? String(p.name).toUpperCase() : ""; }

  /* ---------- catálogos: código -> {es, p}. Mismo archivo que usa el app (ya está en caché) ---------- */
  var CAT = {}, CAT_P = {};
  function loadCat(prov) {
    if (CAT[prov]) return Promise.resolve(CAT[prov]);
    if (CAT_P[prov]) return CAT_P[prov];
    CAT_P[prov] = fetch("./catalog_" + prov.toLowerCase() + ".json").then(function (r) { return r.json(); }).then(function (j) {
      var m = {}; ((j && j.items) || []).forEach(function (it) { if (it && it.c) m[String(it.c).trim()] = { es: String(it.es || it.en || "").slice(0, 110), p: (it.p != null && isFinite(Number(it.p))) ? Number(it.p) : null }; });
      CAT[prov] = m; return m;
    }).catch(function () { CAT_P[prov] = null; return {}; });
    return CAT_P[prov];
  }
  function enrich(tok) {
    var prov = PROVS[tok.p] ? tok.p : "ACE";
    // si el catálogo tarda (primera vez sin caché), no detenemos el registro: se manda sin precio
    var withTimeout = Promise.race([loadCat(prov), new Promise(function (res) { setTimeout(function () { res({}); }, 800); })]);
    return withTimeout.then(function (m) {
      var look = function (c) { return m[String(c || "").trim()] || null; };
      var o = (tok.o || []).map(function (l) {
        var code = String(l[0] || ""), qty = Number(l[1]) || 0;
        if (code.charAt(0) === "*") return [code, qty, String(l[2] || ""), null];           // fuera de catálogo
        var it = look(code); return [code, qty, it ? it.es : String(l[2] || ""), it ? it.p : null];
      });
      var x = (tok.x || []).map(function (l) {                                                  // quitadas / no autorizadas
        var code = String(l[0] || ""), qty = Number(l[1]) || 0; var it = look(code);
        if (it) return [code, qty, it.es];
        return ["*", qty, String(l[2] || code)];                   // el app manda la descripción cuando es fuera de catálogo
      });
      var out = {}; for (var k in tok) if (Object.prototype.hasOwnProperty.call(tok, k)) out[k] = tok[k];
      out.o = o; out.x = x; out.p = prov; return out;
    });
  }

  /* ---------- decodificar el link que abre Mensajes ---------- */
  function parseSms(href) {
    var m = /[?&]body=([^&]*)/.exec(href); if (!m) return null;
    var body = ""; try { body = decodeURIComponent(m[1]); } catch (e) { body = m[1]; }
    var to = (/^sms:\+?(\d+)/.exec(href) || [])[1] || "";
    var t = /#([rtp])=([A-Za-z0-9_-]+)/.exec(body);
    var tok = t ? b64urlJson(t[2]) : null;
    return { body: body, to: to, kind: t ? t[1] : "", tok: tok && Array.isArray(tok.o) ? tok : null };
  }
  function hashToken() { var h = location.hash || ""; var t = /^#([rtp])=([A-Za-z0-9_-]+)$/.exec(h); return t ? { kind: t[1], tok: b64urlJson(t[2]) } : null; }

  /* ---------- cola de salida: nunca se pierde un pedido ---------- */
  var sentKeys = {};
  function enqueue(stage, payload, showToast) {
    var out = ls(K_OUT, []);
    var id = stage + "|" + (payload.f || "") + "|" + (payload.ts || payload.po || "") + "|" + (payload.p || "");
    if (stage !== "TICKET" && sentKeys[id]) return;                 // el mismo toque dos veces (ej. "ABRIR MENSAJES OTRA VEZ")
    sentKeys[id] = 1;
    out.push({ id: id, stage: stage, payload: payload, dev: deviceId(), t: Date.now(), toast: !!showToast });
    lsSet(K_OUT, out.slice(-60));
    if (stage === "SOLICITADO" || stage === "APROBADO") lsSet(K_LAST, { stage: stage, f: payload.f, ts: payload.ts, p: payload.p, t: Date.now() });
    flush();
  }
  var flushing = false;
  function flush() {
    if (flushing) return; var out = ls(K_OUT, []); if (!out.length) return;
    if (navigator.onLine === false) { if (out.some(function (i) { return i.toast; })) toast("⏳ Sin señal — el pedido se registra solo al tener señal", "amber", 4500); return; }
    flushing = true;
    var item = out[0];
    fetch(URL_ + "/rest/v1/rpc/register_material_order", {
      method: "POST", keepalive: true,
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_stage: item.stage, payload: item.payload, p_device: item.dev })
    }).then(function (r) {
      return r.text().then(function (txt) { return { ok: r.ok, status: r.status, txt: txt }; });
    }).then(function (res) {
      var cur = ls(K_OUT, []);
      if (res.ok) {
        var row = null; try { var j = JSON.parse(res.txt); row = Array.isArray(j) ? j[0] : j; } catch (e) { }
        cur = cur.filter(function (i) { return i.id !== item.id; }); lsSet(K_OUT, cur);
        if (item.toast) {
          var no = row && row.req_no ? " · " + row.req_no : "";
          if (item.payload.dm) toast("🎓 Práctica registrada (no cuenta)" + no, "gray", 3500);
          else if (item.stage === "SOLICITADO" && row && row.note) {
            // el motor de reglas ya decidió: verde (aprobado solo), rojo (rechazado / detenido) o amarillo (lo ve el supervisor)
            var lane = row.lane || "", tone = lane === "VERDE" ? "green" : lane === "ROJO" ? "red" : "amber";
            toast(row.note + no, tone, 8000, lane !== "VERDE" ? "./bandeja.html#mis" : null);
          }
          else if (item.stage === "SOLICITADO") toast("✓ Pedido registrado en la oficina" + no, "green", 5000);
          else if (item.stage === "APROBADO") toast("✓ Aprobación registrada" + no, "green", 5000);
          else if (item.stage === "TICKET") toast("✓ PO " + (row && row.po ? row.po : "") + " ligado al pedido" + no, "green", 5000);
          else if (item.stage === "RECHAZADO") toast("✓ Rechazo registrado" + no, "gray", 3500);
        }
      } else if (res.status >= 400 && res.status < 500) {
        // la base de datos lo rechazó (proveedor raro, sin nombre, etc.): no reintentar para siempre
        cur = cur.filter(function (i) { return i.id !== item.id; }); lsSet(K_OUT, cur);
        logEvent("error", { who: item.payload.f, meta: { stage: item.stage, status: res.status, err: String(res.txt).slice(0, 300) } });
        if (item.toast) toast("⚠ No se pudo registrar el pedido — avisa a Tito", "red", 6000);
      }
      // 5xx o sin cuerpo: se queda en la cola y se reintenta
    }).catch(function () {
      if (item.toast) toast("⏳ Sin señal — el pedido se registra solo al tener señal", "amber", 4500);
    }).finally(function () {
      flushing = false;
      var left = ls(K_OUT, []);
      if (left.length && left[0].id !== item.id) setTimeout(flush, 50);   // siguiente en la cola
    });
  }

  /* ---------- telemetría ligera: quién está en el app (para "EN EL APP AHORA") ---------- */
  function logEvent(event, extra) {
    try {
      var body = { device_id: deviceId(), app: "pedidos", event: event, who: whoAmI() || null };
      if (extra) for (var k in extra) body[k] = extra[k];
      fetch(URL_ + "/rest/v1/events", { method: "POST", keepalive: true, headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(function () { });
    } catch (e) { }
  }

  /* ---------- aviso en pantalla (no estorba el botón de abajo) ---------- */
  var toastEl = null, toastTimer = null;
  function toast(msg, tone, ms, link) {
    var colors = { green: "#1F8A3B", amber: "#B45309", red: "#C81E1E", gray: "#4B5563" };
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("role", "status");
      toastEl.style.cssText = "position:fixed;left:10px;right:10px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:9999;color:#fff;font:800 14px/1.25 system-ui,-apple-system,sans-serif;padding:12px 14px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.28);text-align:center;transform:translateY(-140%);transition:transform .25s ease;pointer-events:none;";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg + (link ? "  ›  MIS PEDIDOS" : ""); toastEl.style.background = colors[tone] || colors.gray;
    toastEl.style.pointerEvents = link ? "auto" : "none"; toastEl.onclick = link ? function () { location.href = link; } : null;
    requestAnimationFrame(function () { toastEl.style.transform = "translateY(0)"; });
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.style.transform = "translateY(-140%)"; }, ms || 4000);
  }

  /* ---------- el toque que importa ---------- */
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href^='sms:'], button") : null;
    if (!a) return;
    var txt = String(a.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();

    // "SÍ, YA LO MANDÉ": confirma el último pedido/aprobación mandado desde este teléfono
    if (a.tagName === "BUTTON") {
      if (/S[IÍ], YA LO MAND/.test(txt)) {
        var last = ls(K_LAST, null);
        if (last && Date.now() - last.t < 30 * 60e3) enqueue("CONFIRMADO", { f: last.f, ts: last.ts, p: last.p }, false);
      }
      return;
    }

    var href = a.getAttribute("href") || "";
    var sms = parseSms(href); if (!sms) return;

    // RECHAZAR: el link va al mayordomo sin código; el pedido es el que está abierto en la pantalla (#r=)
    if (!sms.tok && /RECHAZ/.test(txt + " " + sms.body)) {
      var h = hashToken();
      if (h && h.kind === "r" && h.tok && h.tok.f) enqueue("RECHAZADO", { f: h.tok.f, ts: h.tok.ts, p: h.tok.p, j: h.tok.j, s: whoAmI() || null }, true);
      return;
    }
    if (!sms.tok) return;                                     // ayuda al catálogo, etc.: no es un pedido

    var stage = STAGE[sms.kind]; if (!stage) return;
    var tok = sms.tok; tok.to = sms.to;
    if (stage === "APROBADO" && !tok.s) tok.s = whoAmI() || null;   // quien aprueba desde este teléfono
    enrich(tok).then(function (payload) { enqueue(stage, payload, true); });
    logEvent(stage === "SOLICITADO" ? "sent" : stage.toLowerCase(), { meta: { prov: tok.p, lines: (tok.o || []).length } });
  }, true);

  /* ---------- reintentos y presencia ---------- */
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { flush(); logEvent("open"); } });
  setInterval(flush, 60e3);
  setTimeout(function () { flush(); logEvent("open"); ["ACE", "CMC", "RSS", "WHITECAP"].forEach(loadCat); }, 2500);

  window.MUNIZ_DB = { version: VERSION, flush: flush, pending: function () { return ls(K_OUT, []).length; } };
})();
