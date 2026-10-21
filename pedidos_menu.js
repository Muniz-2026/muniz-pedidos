/* =====================================================================
   MUÑIZ PEDIDOS · MENÚ DESPUÉS DEL NOMBRE  ·  v2.11
   v2.11: COMBUSTIBLE de la oficina: PARA MÍ va arriba, grande, con tu nombre (antes era un renglón gris al
          final de la lista y Tito no lo encontraba). La gente de oficina sale en la lista (Claudia, Lupe…):
          la oficina también carga gasolina (Tito, Oct 20).
   v2.10: al escoger PARA QUIÉN, el app ya trae la franja PARA en el primer cuadro (antes llegaba 1-2 cuadros tarde).
   v2.9: PEDIR PARA vive dentro del app (app.js 7.8). Se quitaron la pastilla flotante y el reloj de 0.7 s que
         cambiaba el texto del botón, tocaba OFICINA y apretaba los botones del app por control remoto.
   v2.8: mientras el menú o el combustible están encima, el app de abajo (#root) se oculta: ya no se
         ve la lista de tiendas por un instante detrás de la pantalla que entra.
   ---------------------------------------------------------------------
   Toca tu nombre → ¿Qué vas a hacer?
     🧱 MATERIALES   → sigue igual (¿A qué tienda vas?)
     ⛽ COMBUSTIBLE  → el wizard de combustible se abre AQUÍ, en un panel encima del app,
                       con tu nombre ya puesto. ← regresa a este menú. Nunca cambia de sitio.
   v2.0: el combustible ya NO es un iframe ni otro sitio. fuel.js (window.MunizFuel)
   dibuja el wizard AQUÍ mismo, en este documento, con el mismo estilo que pedidos:
   una sola cabecera, una sola flecha ←. En el primer paso ← regresa a este menú.
   No toca app.js. Se carga en index.html después de pedidos_db.js y fuel.js.
   ===================================================================== */
(function () {
  "use strict";
  var K_PED = "muniz_pedido", K_FUEL_ME = "muniz_fuel_me", K_SEEN = "muniz_menu_seen";
  var TITLE = /¿A QUÉ TIENDA VAS\?/i;

  function ls(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function who() { var p = ls(K_PED); return p && p.name ? String(p.name).toUpperCase() : ""; }
  function seen(name) { try { return sessionStorage.getItem(K_SEEN) === name; } catch (e) { return false; } }
  function markSeen(name) { try { sessionStorage.setItem(K_SEEN, name); } catch (e) { } }
  function clearSeen() { try { sessionStorage.removeItem(K_SEEN); } catch (e) { } }

  /* ---------- el menú ---------- */
  var overlay = null, hiding = false;
  function hide() {
    if (!overlay || hiding) return; hiding = true;
    var el = overlay; overlay = null;
    if (el.parentNode) el.parentNode.removeChild(el); hiding = false; if (!panel) { showPills(); dlg(false); }
  }
  /* el último PO de combustible de esta persona en este teléfono (lo guarda fuel.js) */
  function lastFuelPO(name) {
    try {
      var h = JSON.parse(localStorage.getItem("muniz_fuel_hist") || "[]"), n = String(name || "").toUpperCase().trim(), best = null;
      for (var i = 0; i < h.length; i++) { var e = h[i]; if (e && e.po && String(e.who || "").toUpperCase().trim() === n && (!best || e.ts > best.ts)) best = e; }
      if (!best || Date.now() - best.ts > 12 * 3600e3) return null;
      var min = Math.round((Date.now() - best.ts) / 60000);
      best.ago = min < 1 ? "ahora mismo" : min < 60 ? "hace " + min + " min" : "hace " + Math.round(min / 60) + " h";
      return best;
    } catch (e) { return null; }
  }
  function fuelSubHTML(name) {
    var p = lastFuelPO(name);
    if (!p) return "PO de diésel o gasolina · Tex-Con · Leo's";
    return '<span style="display:inline-block;background:#FFF4E8;border:2px solid #FF5A00;border-radius:10px;padding:6px 10px;color:#1C1C1E">' +
      '<span style="font:900 11px/1 system-ui,sans-serif;letter-spacing:.08em;color:#FF5A00">TU ÚLTIMO PO · ' + p.ago.toUpperCase() + '</span><br>' +
      '<span style="font:900 26px/1.1 ui-monospace,Menlo,Consolas,monospace">' + p.po + '</span>' +
      '<span style="font:700 12px/1 system-ui,sans-serif;color:#6E6E73"> · ' + (p.est === "TEXCON" ? "TEX-CON" : p.est === "LEOS" ? "LEO\'S" : (p.est || "")) + (p.placa ? " · " + p.placa : "") + '</span></span>';
  }
  /* el último PO de material de esta persona (lo guarda pedidos_db.js cuando la oficina lo asigna) */
  function lastMatPO(name) {
    try {
      var p = JSON.parse(localStorage.getItem("muniz_db_lastpo") || "null"); if (!p || !p.po) return null;
      if (String(p.name || "").toUpperCase().trim() !== String(name || "").toUpperCase().trim()) return null;
      var at = new Date(p.at).getTime() || Date.now(); if (Date.now() - at > 3 * 86400e3) return null;   // tres días
      var min = Math.round((Date.now() - at) / 60000);
      p.ago = min < 1 ? "ahora mismo" : min < 60 ? "hace " + min + " min" : min < 1440 ? "hace " + Math.round(min / 60) + " h" : "hace " + Math.round(min / 1440) + " d";
      return p;
    } catch (e) { return null; }
  }
  function matSubHTML(name) {
    var p = lastMatPO(name);
    if (!p) return "Pedir a ACE · CMC · RSS · White Cap";
    return '<span style="display:inline-block;background:#E6F5EA;border:2px solid #248A3D;border-radius:10px;padding:6px 10px;color:#1C1C1E">' +
      '<span style="font:900 11px/1 system-ui,sans-serif;letter-spacing:.08em;color:#248A3D">TU ÚLTIMO PO · ' + p.ago.toUpperCase() + '</span><br>' +
      '<span style="font:900 26px/1.1 ui-monospace,Menlo,Consolas,monospace">' + p.po + '</span>' +
      '<span style="font:700 12px/1 system-ui,sans-serif;color:#6E6E73"> · ' + (p.prov || "ACE") + ' ya lo tiene · pasa a recoger</span></span>';
  }
  window.__mzRefreshMenuCards = function () { try { if (!overlay) return; var n = who() || tapped; var a = overlay.querySelector("#mz-mat-sub"); if (a) a.innerHTML = matSubHTML(n); var b = overlay.querySelector("#mz-fuel-sub"); if (b) b.innerHTML = fuelSubHTML(n); } catch (e) { } };
  function card(id, color, icon, title, sub, btn) {
    return '<button id="' + id + '" style="text-align:left;background:#fff;border:3px solid ' + color + ';border-radius:22px;padding:22px 20px;cursor:pointer;display:block;width:100%">' +
      '<div style="font-size:40px;line-height:1">' + icon + '</div>' +
      '<div style="font:900 34px/1 \'Archivo Black\',system-ui,sans-serif;color:' + color + ';margin-top:10px;letter-spacing:-.02em">' + title + '</div>' +
      '<div id="' + id + '-sub" style="font:600 15px/1.3 system-ui,sans-serif;color:#374151;margin-top:8px">' + sub + '</div>' +
      '<div style="display:inline-block;margin-top:14px;background:' + color + ';color:#fff;font:900 15px/1 system-ui,sans-serif;padding:14px 18px;border-radius:14px;letter-spacing:.03em">' + btn + '</div>' +
    '</button>';
  }

  /* ---------- la oficina pide a nombre de un mayordomo ----------
     Tito y Claudia nunca piden para sí mismos: piden para alguien. Antes de
     entrar a MATERIALES escogen para quién. Siguen con acceso de oficina
     (lo bloqueado se puede pedir), pero el pedido sale a nombre de ese
     mayordomo, con su obra, y lo registra/aprueba la oficina de un toque. */
  var K_PARA = "muniz_of_para";
  function upk(s) { return String(s || "").toUpperCase().trim(); }
  function isOfficeName(n) {
    try { var o = (window.MUNIZ_CONFIG || {}).OFICINA || {}, t = upk(n); for (var k in o) if (upk(k) === t) return true; } catch (e) { }
    return false;
  }
  function getPara() { try { return sessionStorage.getItem(K_PARA) || ""; } catch (e) { return ""; } }
  function setPara(p) { try { if (p) sessionStorage.setItem(K_PARA, p); else sessionStorage.removeItem(K_PARA); } catch (e) { } window.__ofPara = p || "";
    // llamada directa, no evento: así el app se redibuja ANTES de que se quite esta pantalla, en el mismo cuadro
    // (con un evento el app esperaba al siguiente cuadro y se veía 1-2 cuadros sin la franja PARA)
    try { if (window.__mzParaRefresh) window.__mzParaRefresh(); else window.dispatchEvent(new Event("mz-para")); } catch (e) { } }
  function peopleForPicker() {
    var c = window.MUNIZ_CONFIG || {}, F = c.COMBUSTIBLE || {}, seen = {}, groups = { may: [], sup: [], pm: [] };
    var office = {}; Object.keys(c.OFICINA || {}).forEach(function (k) { office[upk(k)] = 1; });
    var drivers = {}; (F.CHOFERES_CAMION || []).forEach(function (k) { drivers[upk(k)] = 1; });
    var sups = {}; Object.keys(c.SUPERVISORES || {}).forEach(function (k) { sups[upk(k)] = 1; });
    var pms = {}; (Array.isArray(c.GERENTES) ? c.GERENTES : Object.keys(c.GERENTES || {})).forEach(function (k) { pms[upk(k)] = 1; });
    function add(n, g) { n = upk(n); if (!n || seen[n] || office[n] || drivers[n]) return; seen[n] = 1; groups[g].push(n); }
    Object.keys(sups).forEach(function (n) { add(n, "sup"); });
    Object.keys(pms).forEach(function (n) { add(n, "pm"); });
    Object.keys(c.ASIGNACIONES || {}).forEach(function (n) { add(n, "may"); });
    (c.PERSONAL || []).forEach(function (n) { add(n, "may"); });
    ["may", "sup", "pm"].forEach(function (g) { groups[g].sort(); });
    return groups;
  }
  function showPara(name, fromApp) {
    if (!overlay) return;
    var g = peopleForPicker();
    function grid(title, color, list) {
      if (!list.length) return "";
      return '<div style="font:900 11px/1 system-ui,sans-serif;letter-spacing:.1em;color:' + color + ';margin:16px 2px 8px">' + title + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        list.map(function (n) { return '<button data-para="' + n + '" style="min-height:52px;border-radius:12px;border:2px solid #E3E3E8;background:#fff;font:900 13px/1.15 system-ui,sans-serif;color:#1C1C1E;padding:6px">' + n + '</button>'; }).join("") + '</div>';
    }
    overlay.innerHTML =
      '<div style="position:fixed;inset:0;background:#F2F2F7;z-index:9997;overflow:auto;-webkit-overflow-scrolling:touch;padding:calc(env(safe-area-inset-top,0px) + 16px) 14px calc(env(safe-area-inset-bottom,0px) + 24px)">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<button id="mz-para-back" style="width:52px;height:52px;border-radius:14px;background:#1C1C1E;color:#fff;border:0;font:900 26px/1 system-ui">\u2190</button>' +
          '<div><div style="font:900 22px/1.05 \'Archivo Black\',system-ui,sans-serif;color:#1C1C1E">\u00bfPARA QUI\u00c9N ES?</div>' +
          '<div style="font:700 12px/1.3 system-ui,sans-serif;color:#6E6E73;margin-top:3px">Pides con acceso de oficina. El pedido sale a su nombre y t\u00fa lo apruebas.</div></div>' +
        '</div>' +
        grid("MAYORDOMOS", "#1C1C1E", g.may) + grid("SUPERVISORES", "#0071E3", g.sup) + grid("GERENTES DE PROYECTO", "#7A4E1D", g.pm) +
        '<button id="mz-para-me" style="margin-top:22px;width:100%;min-height:48px;border-radius:12px;border:2px dashed #C7C7CC;background:transparent;font:800 13px/1 system-ui,sans-serif;color:#6E6E73">PARA LA OFICINA (a mi nombre)</button>' +
      '</div>';
    overlay.querySelector("#mz-para-back").onclick = function () { hide(); if (!fromApp) show(name); };   // desde la franja PARA del app: ← regresa al pedido
    overlay.querySelector("#mz-para-me").onclick = function () { setPara(""); markSeen(name); hide(); };
    Array.prototype.forEach.call(overlay.querySelectorAll("[data-para]"), function (b) {
      b.onclick = function () { setPara(b.getAttribute("data-para")); markSeen(name); hide(); };
    });
  }
  /* v2.9 · el renglón, el botón PEDIR PARA, la pantalla PEDIDO REGISTRADO, TERMINAR y OTRO PEDIDO viven en el app.
     Aquí sólo queda la lista ¿PARA QUIÉN ES?; la franja azul PARA: … de la cabecera del app la abre con esto. */
  window.__mzOpenPara = function () {
    var n = who() || tapped; if (!n) return;
    if (!overlay) { dlg(true); overlay = document.createElement("div"); document.body.appendChild(overlay); }
    showPara(n, true);
  };

  /* choferes de camión (config COMBUSTIBLE.CHOFERES_CAMION): solo combustible.
     Sin menú, sin MATERIALES: el nombre abre la estación directo. */
  function isDriver(name) {
    try { var l = ((window.MUNIZ_CONFIG || {}).COMBUSTIBLE || {}).CHOFERES_CAMION || [], n = String(name || "").toUpperCase().trim();
      for (var i = 0; i < l.length; i++) if (String(l[i]).toUpperCase().trim() === n) return true; } catch (e) { }
    return false;
  }
  var directFuel = false;
  function show(name) {
    if (overlay || panel) return;
    dlg(true);
    if (isDriver(name)) {
      directFuel = true; markSeen(name);
      try { localStorage.setItem(K_FUEL_ME, JSON.stringify(name)); } catch (e) { }
      openFuel(name);
      return;
    }
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9990;background:#F2F2F7;display:flex;flex-direction:column;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;";
    /* misma cabecera que el resto del app: franja, flecha negra de 48px, título Archivo Black 15px, nombre en gris */
    overlay.innerHTML =
      '<div style="height:8px;background:repeating-linear-gradient(45deg,#1C1C1E 0 14px,#FFB800 14px 28px)"></div>' +
      '<div style="background:#fff;border-bottom:1px solid #E3E3E8;padding:6px 8px;display:flex;align-items:center;gap:8px">' +
        '<button id="mz-back" aria-label="Regresar" style="width:48px;height:48px;flex:none;border:0;border-radius:12px;background:#1C1C1E;color:#fff;font-size:24px;font-weight:900;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center">←</button>' +
        '<div style="flex:1;min-width:0"><div style="font:900 15px/1.2 \'Archivo Black\',system-ui,sans-serif;letter-spacing:-.025em;color:#1C1C1E">¿QUÉ VAS A HACER?</div>' +
        '<div style="font:400 10px/1.25 system-ui,sans-serif;color:#6E6E73;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</div></div>' +
      '</div>' +
      '<div style="padding:18px 16px;display:flex;flex-direction:column;gap:16px;flex:1">' +
        card("mz-mat", "#FF5A00", "🧱", "MATERIALES", matSubHTML(name), "ENTRAR A PEDIDOS →") +
        card("mz-fuel", "#1E3A8A", "⛽", "COMBUSTIBLE", fuelSubHTML(name), lastFuelPO(name) ? "OTRO PO →" : "PO PARA COMBUSTIBLE →") +
      '</div>';
    document.body.appendChild(overlay);
    hidePills();
    overlay.querySelector("#mz-mat").onclick = function () { if (isOfficeName(name)) { showPara(name); return; } markSeen(name); hide(); };
    overlay.querySelector("#mz-fuel").onclick = function () {
      if (isOfficeName(name)) { showFuelPara(name); return; }     // oficina: ¿para quién es el combustible?
      try { localStorage.setItem(K_FUEL_ME, JSON.stringify(name)); } catch (e) { }   // el wizard arranca en el paso 2 con el nombre puesto
      openFuel(name);
    };
    overlay.querySelector("#mz-back").onclick = function () { hide(); clearSeen(); appBack(); };
  }

  /* el app no crea historial al tocar un nombre: para regresar, tocamos SU flecha ← (la de la pantalla de la tienda) */
  function appBack() {
    var btns = document.querySelectorAll("button, a");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i]; if (overlay && overlay.contains(b)) continue; if (panel && panel.contains(b)) continue;
      var txt = (b.textContent || "").trim(), lab = (b.getAttribute("aria-label") || "").toLowerCase();
      if (txt === "←" || txt === "‹" || /atr[aá]s|regresar|volver|back/.test(lab)) { b.click(); return true; }
    }
    try { history.back(); } catch (e) { }
    return false;
  }

  /* ---------- COMBUSTIBLE dentro del app: mismo documento, mismo estilo, una sola cabecera ---------- */
  var panel = null, fuelHandle = null, hiddenPills = [];
  /* ---------- combustible: ¿PARA QUIÉN ES? (solo oficina) ----------
     Cuando un chofer llama a la oficina por combustible, la oficina pide el PO A NOMBRE DE ÉL:
     sale con su nombre y su unidad (placa, diésel/gasolina, millaje), y el servidor anota quién
     lo pidió (requested_by → "Pedido por oficina: …"). Así nadie vuelve a pedir "como si fuera suyo".
     La lista son TODAS las personas activas (tengan clave o no). Sin señal: la lista del config. */
  var fuelPeople = null;
  function fEsc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fFold(v) { var t = String(v || "").toUpperCase(); try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) { } return t; }
  function fuelPeopleFallback() {
    var c = window.MUNIZ_CONFIG || {}, F = c.COMBUSTIBLE || {}, out = [];
    function add(n, r) { n = upk(n); if (n) out.push({ name: n, role: r }); }
    (F.CHOFERES_CAMION || []).forEach(function (n) { add(n, "CHOFER"); });
    Object.keys(c.CHOFERES || {}).forEach(function (n) { add(n, "CHOFER"); });
    Object.keys(c.ASIGNACIONES || {}).forEach(function (n) { add(n, "MAYORDOMO"); });
    Object.keys(c.SUPERVISORES || {}).forEach(function (n) { add(n, "SUPERVISOR"); });
    (Array.isArray(c.GERENTES) ? c.GERENTES : Object.keys(c.GERENTES || {})).forEach(function (n) { add(n, "GERENTE"); });
    (F.USUARIOS_EXTRA || []).forEach(function (n) { add(n, "PERSONAL"); });
    (c.PERSONAL || []).forEach(function (n) { add(n, "PERSONAL"); });
    Object.keys(c.OFICINA || {}).forEach(function (n) { add(n, "OFICINA"); });
    return out;
  }
  function loadFuelPeople(cb) {
    if (fuelPeople) { cb(fuelPeople); return; }
    var sb = (window.MUNIZ_CONFIG || {}).SUPABASE || {}, done = false;
    function finish(list) { if (done) return; done = true; if (list && list.length) fuelPeople = list; cb(list && list.length ? list : fuelPeopleFallback()); }
    if (!sb.URL || !sb.ANON_KEY) { finish(null); return; }
    setTimeout(function () { finish(null); }, 6000);
    fetch(sb.URL + "/rest/v1/people?select=name,role,active&order=name", { headers: { apikey: sb.ANON_KEY, Authorization: "Bearer " + sb.ANON_KEY } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        finish((rows || []).filter(function (x) { return x && x.name && x.active !== false; })
          .map(function (x) { return { name: upk(x.name), role: upk(x.role) }; }));
      })
      .catch(function () { finish(null); });
  }
  function fuelGroups(list, me) {
    var c = window.MUNIZ_CONFIG || {}, F = c.COMBUSTIBLE || {}, trucks = {}, seenN = {}, g = { cam: [], all: [] };
    (F.CHOFERES_CAMION || []).forEach(function (k) { trucks[upk(k)] = 1; });
    list.forEach(function (x) {
      var n = upk(x.name); if (!n || seenN[n] || n === upk(me)) return; seenN[n] = 1;   // quien pide va arriba, en PARA MÍ
      (trucks[n] || x.role === "CHOFER" ? g.cam : g.all).push({ name: n, role: x.role || "" });
    });
    function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
    g.cam.sort(byName); g.all.sort(byName);
    return g;
  }
  var ROLE_ES = { CHOFER: "chofer", MAYORDOMO: "mayordomo", SUPERVISOR: "supervisor", GERENTE: "gerente de proyecto", PERSONAL: "personal", OFICINA: "oficina" };
  function showFuelPara(name) {
    if (!overlay) return;
    overlay.innerHTML =
      '<div style="position:fixed;inset:0;background:#F2F2F7;z-index:9997;overflow:auto;-webkit-overflow-scrolling:touch;padding:calc(env(safe-area-inset-top,0px) + 16px) 14px calc(env(safe-area-inset-bottom,0px) + 24px)">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<button id="mz-fpara-back" aria-label="Regresar" style="width:52px;height:52px;flex:none;border-radius:14px;background:#1C1C1E;color:#fff;border:0;font:900 26px/1 system-ui">\u2190</button>' +
          '<div><div style="font:900 22px/1.05 \'Archivo Black\',system-ui,sans-serif;color:#1C1C1E">\u00bfPARA QUI\u00c9N ES EL COMBUSTIBLE?</div>' +
          '<div style="font:700 12px/1.3 system-ui,sans-serif;color:#6E6E73;margin-top:3px">El PO sale a nombre de quien va a cargar, con su unidad. Queda anotado que lo pediste t\u00fa.</div></div>' +
        '</div>' +
        '<button id="mz-fpara-me" style="margin-top:16px;width:100%;min-height:68px;border-radius:16px;border:0;background:#1E3A8A;color:#fff;padding:12px 16px;text-align:left;display:flex;align-items:center;gap:12px;cursor:pointer">' +
          '<span style="font-size:30px;line-height:1;flex:none">\u26FD</span>' +
          '<span style="flex:1;min-width:0"><span style="display:block;font:900 20px/1.05 \'Archivo Black\',system-ui,sans-serif;letter-spacing:-.01em">PARA M\u00cd</span>' +
          '<span style="display:block;font:700 12px/1.25 system-ui,sans-serif;opacity:.85;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + fEsc(name) + ' \u00b7 a mi nombre</span></span>' +
          '<span style="font:900 22px/1 system-ui;flex:none">\u2192</span>' +
        '</button>' +
        '<div style="font:900 11px/1 system-ui,sans-serif;letter-spacing:.1em;color:#6E6E73;margin:22px 2px 0">O A NOMBRE DE OTRA PERSONA</div>' +
        '<input id="mz-fpara-q" type="search" placeholder="Buscar nombre\u2026" autocomplete="off" autocapitalize="characters" style="margin-top:8px;width:100%;box-sizing:border-box;min-height:50px;border-radius:12px;border:2px solid #C7C7CC;background:#fff;padding:0 14px;font:800 16px/1 system-ui,sans-serif;color:#1C1C1E">' +
        '<div id="mz-fpara-list"><div style="padding:28px 0;text-align:center;font:700 13px/1.3 system-ui,sans-serif;color:#6E6E73">Cargando nombres\u2026</div></div>' +
      '</div>';
    var listEl = overlay.querySelector("#mz-fpara-list"), q = overlay.querySelector("#mz-fpara-q");
    overlay.querySelector("#mz-fpara-back").onclick = function () { hide(); show(name); };
    overlay.querySelector("#mz-fpara-me").onclick = function () {
      try { localStorage.setItem(K_FUEL_ME, JSON.stringify(name)); } catch (e) { }
      hide(); openFuel(name);
    };
    function btn(x) {
      return '<button data-fpara="' + fEsc(x.name) + '" data-fold="' + fEsc(fFold(x.name)) + '" style="min-height:56px;border-radius:12px;border:2px solid #E3E3E8;background:#fff;font:900 13px/1.15 system-ui,sans-serif;color:#1C1C1E;padding:6px;text-align:center">' +
        fEsc(x.name) + (x.role ? '<span style="display:block;font:700 10px/1.2 system-ui,sans-serif;color:#8E8E93;margin-top:3px">' + fEsc(ROLE_ES[x.role] || x.role.toLowerCase()) + '</span>' : '') + '</button>';
    }
    function section(title, color, arr) {
      if (!arr.length) return "";
      return '<div data-fsec><div style="font:900 11px/1 system-ui,sans-serif;letter-spacing:.1em;color:' + color + ';margin:16px 2px 8px">' + title + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + arr.map(btn).join("") + '</div></div>';
    }
    function filter() {
      var t = fFold(q.value).trim();
      Array.prototype.forEach.call(listEl.querySelectorAll("[data-fpara]"), function (b) { b.style.display = !t || b.getAttribute("data-fold").indexOf(t) >= 0 ? "" : "none"; });
      Array.prototype.forEach.call(listEl.querySelectorAll("[data-fsec]"), function (sec) {
        var any = Array.prototype.some.call(sec.querySelectorAll("[data-fpara]"), function (b) { return b.style.display !== "none"; });
        sec.style.display = any ? "" : "none";
      });
    }
    q.oninput = filter;
    loadFuelPeople(function (list) {
      if (!overlay || !overlay.contains(listEl)) return;            // ya se salió de esta pantalla
      var g = fuelGroups(list, name);
      listEl.innerHTML = (section("CHOFERES DE CAMI\u00d3N", "#1E3A8A", g.cam) + section("TODOS", "#1C1C1E", g.all)) ||
        '<div style="padding:28px 0;text-align:center;font:700 13px/1.3 system-ui,sans-serif;color:#6E6E73">No cargaron los nombres. Revisa la se\u00f1al.</div>';
      Array.prototype.forEach.call(listEl.querySelectorAll("[data-fpara]"), function (b) {
        b.onclick = function () { var para = b.getAttribute("data-fpara"); hide(); openFuel(para, name); };
      });
      filter();
    });
  }
  
function openFuel(name, por) {
    if (panel) return;
    if (!(window.MunizFuel && window.MunizFuel.mount)) { alert("No cargó combustible (fuel.js). Recarga el app."); return; }
    dlg(true);
    panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.className = "mzf-scroll";
    panel.style.cssText = "position:fixed;inset:0;z-index:9995;background:#F2F2F7;overflow:hidden;";
    document.body.appendChild(panel);
    document.body.style.overflow = "hidden";
    window.__mzBusy = true;                              // no recargar el app a la mitad de un PO
    hidePills();
    window.__mzFuelPor = por ? upk(por) : "";            // oficina pidiendo a nombre de otra persona
    fuelHandle = window.MunizFuel.mount(panel, { who: name, requestedBy: por || "", onClose: closeFuel });
  }
  function closeFuel() {
    window.__mzFuelPor = "";
    if (fuelHandle) { try { fuelHandle.unmount(); } catch (e) { } fuelHandle = null; }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; document.body.style.overflow = ""; window.__mzBusy = false; if (!overlay) dlg(false);
    if (overlay) { hidePills(); try { var sub = overlay.querySelector("#mz-fuel-sub"); if (sub) sub.innerHTML = fuelSubHTML(who() || tapped); var cta = overlay.querySelector("#mz-fuel > div:last-child"); if (cta && lastFuelPO(who() || tapped)) cta.textContent = "OTRO PO →"; } catch (e) { } }
    else showPills();
    if (window.__mzFlushReload) window.__mzFlushReload();   // si llegó una versión nueva mientras cargaba, ahora sí
    if (directFuel) { directFuel = false; clearSeen(); appBack(); return; }   // chofer: de regreso a la lista de nombres
    clearSeen(); check();                           // de vuelta al menú ¿QUÉ VAS A HACER?
  }
  /* mientras hay una pantalla nuestra encima (menú, PARA, combustible), el app de abajo no se ve:
     la pantalla que entra se dibuja sobre el fondo liso, no sobre la lista de tiendas */
  function dlg(on) {
    try {
      var H = document.documentElement;
      if (on) {
        if (!document.getElementById("mz-dialog-css")) { var c = document.createElement("style"); c.id = "mz-dialog-css"; c.textContent = "html.mz-dialog #root{visibility:hidden}"; document.head.appendChild(c); }
        H.classList.add("mz-dialog");
      } else H.classList.remove("mz-dialog");
    } catch (e) { }
  }
  /* la pastilla flotante "MIS PEDIDOS" (pedidos_db.js) no debe verse encima del combustible */
  function hidePills() {
    var direct = document.querySelectorAll('a[href$="bandeja.html#mis"]');
    for (var d = 0; d < direct.length; d++) { if (hiddenPills.indexOf(direct[d]) < 0) { direct[d].setAttribute("data-mz-hidden", direct[d].style.visibility || ""); direct[d].style.visibility = "hidden"; hiddenPills.push(direct[d]); } }
    if (direct.length) return;
    var els = document.querySelectorAll("button, a");
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (panel && panel.contains(el)) continue; if (overlay && overlay.contains(el)) continue;
      if (el.children.length > 3) continue;                       // la pastilla trae hasta 2 numeritos
      var txt = (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!/MIS PEDIDOS/.test(txt) || txt.length > 24) continue;
      var pos = getComputedStyle(el).position; if (pos !== "fixed" && pos !== "absolute") continue;
      if (hiddenPills.indexOf(el) < 0) { el.setAttribute("data-mz-hidden", el.style.visibility || ""); el.style.visibility = "hidden"; hiddenPills.push(el); }
    }
  }
  function showPills() {
    hiddenPills.forEach(function (el) { el.style.visibility = el.getAttribute("data-mz-hidden") || ""; el.removeAttribute("data-mz-hidden"); });
    hiddenPills = [];
  }


  /* ---------- el toque en el nombre: el menú aparece EN ESE INSTANTE, antes de que el app cambie de pantalla ---------- */
  var tapped = "", tappedAt = 0;
  /* ¿está la pantalla de la CLAVE (oficina) encima? */
  function pinOpen() {
    var els = document.querySelectorAll("div");
    for (var i = 0; i < els.length; i++) { if (els[i].children.length === 0 && /^CLAVE$/.test((els[i].textContent || "").trim())) return true; }
    return false;
  }
  /* un nombre son dos o más palabras de puras letras: "RUBEN CANO". Un dígito del
     teclado, BORRAR, SALIR o MODO PRÁCTICA no son nombres y no abren el menú. */
  var NAME_RE = /^[A-ZÁÉÍÓÚÜÑ]+(?: [A-ZÁÉÍÓÚÜÑ]+)+$/;
  var NOT_NAME = /MIS PEDIDOS|CAMBIAR|PRÁCTICA|PRACTICA|CHOFER|CANCELAR|AGREGAR|QUITAR|BORRAR|SALIR|^EN$|^ES$|^←/;
  document.addEventListener("click", function (ev) {
    if (panel || overlay) return;
    if (!hasText(/Toca tu nombre/i, "h1,h2,h3,div,p")) return;
    if (pinOpen()) return;                                                       // tecleando la clave: no es un nombre
    var b = ev.target && ev.target.closest ? ev.target.closest("button") : null; if (!b) return;
    var txt = (b.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!txt || NOT_NAME.test(txt) || txt.length > 40 || !NAME_RE.test(txt)) return;
    tapped = txt; tappedAt = Date.now();
    show(tapped);
    // si el app pidió la CLAVE (oficina) o no pasó a la tienda, el menú se quita solo - rápido
    var tries = 0, w = setInterval(function () {
      tries++;
      if (!overlay || panel) { clearInterval(w); return; }
      if (pinOpen()) { clearInterval(w); hide(); clearSeen(); return; }
      if (hasText(TITLE, "h1,h2,h3,div,span")) { clearInterval(w); return; }
      if (tries >= 10) { clearInterval(w); hide(); clearSeen(); }
    }, 45);
  }, true);

  /* ---------- ¿en qué pantalla está el app? ---------- */
  function hasText(re, sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) { if (els[i].children.length === 0 && re.test(els[i].textContent || "")) return true; }
    return false;
  }
  var t;
  function check() {
    clearTimeout(t);
    t = setTimeout(function () {
      if (panel) { hidePills(); return; }                                           // combustible abierto encima: no tocar
      if (hasText(/Toca tu nombre/i, "h1,h2,h3,div,p")) { clearSeen(); hide(); if (getPara()) setPara(""); return; }   // lista de nombres: se olvida para quién era
      if (pinOpen()) { hide(); return; }                                             // pantalla de la clave: nada encima
      if (hasText(TITLE, "h1,h2,h3,div,span")) { var n = who() || (Date.now() - tappedAt < 2000 ? tapped : ""); if (n && !seen(n)) show(n); }
      else hide();
    }, 60);
  }
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", check);
  window.addEventListener("hashchange", check);
  check();
})();
