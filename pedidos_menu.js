/* =====================================================================
   MUÑIZ PEDIDOS · MENÚ DESPUÉS DEL NOMBRE  ·  v1.3
   ---------------------------------------------------------------------
   Toca tu nombre → ¿Qué vas a hacer?
     🧱 MATERIALES   → sigue igual (¿A qué tienda vas?)
     ⛽ COMBUSTIBLE  → el wizard de combustible se abre AQUÍ, en un panel encima del app,
                       con tu nombre ya puesto. ← regresa a este menú. Nunca cambia de sitio.
   No toca app.js. Se carga en index.html después de pedidos_db.js.
   ===================================================================== */
(function () {
  "use strict";
  var K_PED = "muniz_pedido", K_FUEL_ME = "muniz_fuel_me", K_SEEN = "muniz_menu_seen";
  var TITLE = /¿A QUÉ TIENDA VAS\?/i;
  var FUEL_URL = "./fuel.html#embed";

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
    el.style.transition = "opacity .16s ease-in, transform .16s ease-in"; el.style.opacity = "0"; el.style.transform = "translateY(10px)";
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); hiding = false; }, 170);
  }
  function card(id, color, icon, title, sub, btn) {
    return '<button id="' + id + '" style="text-align:left;background:#fff;border:3px solid ' + color + ';border-radius:22px;padding:22px 20px;cursor:pointer;display:block;width:100%">' +
      '<div style="font-size:40px;line-height:1">' + icon + '</div>' +
      '<div style="font:900 34px/1 system-ui,sans-serif;color:' + color + ';margin-top:10px;letter-spacing:.01em">' + title + '</div>' +
      '<div style="font:600 15px/1.3 system-ui,sans-serif;color:#374151;margin-top:8px">' + sub + '</div>' +
      '<div style="display:inline-block;margin-top:14px;background:' + color + ';color:#fff;font:900 15px/1 system-ui,sans-serif;padding:14px 18px;border-radius:14px;letter-spacing:.03em">' + btn + '</div>' +
    '</button>';
  }
  function show(name) {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9990;background:#EEECE6;display:flex;flex-direction:column;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;opacity:0;transform:translateY(14px);will-change:opacity,transform;";
    overlay.innerHTML =
      '<div style="background:#fff;padding:calc(env(safe-area-inset-top,0px) + 14px) 16px 14px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 10px rgba(0,0,0,.06)">' +
        '<button id="mz-back" aria-label="Regresar" style="width:56px;height:56px;border:0;border-radius:16px;background:#111;color:#fff;font-size:26px;line-height:1;cursor:pointer">←</button>' +
        '<div><div style="font:900 22px/1.05 system-ui,sans-serif;letter-spacing:.02em">¿QUÉ VAS A HACER?</div>' +
        '<div style="font:600 14px/1.2 system-ui,sans-serif;color:#6B7280;margin-top:3px">' + name + '</div></div>' +
      '</div>' +
      '<div style="padding:18px 16px;display:flex;flex-direction:column;gap:16px;flex:1">' +
        card("mz-mat", "#FF5A00", "🧱", "MATERIALES", "Pedir a ACE · CMC · RSS · White Cap", "ENTRAR A PEDIDOS →") +
        card("mz-fuel", "#1E3A8A", "⛽", "COMBUSTIBLE", "PO de diésel o gasolina · Tex-Con · Leo's", "SACAR PO DE COMBUSTIBLE →") +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay && (overlay.style.transition = "opacity .22s cubic-bezier(.2,.8,.2,1), transform .26s cubic-bezier(.2,.8,.2,1)", overlay.style.opacity = "1", overlay.style.transform = "translateY(0)"); });
    overlay.querySelector("#mz-mat").onclick = function () { markSeen(name); hide(); };
    overlay.querySelector("#mz-fuel").onclick = function () {
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

  /* ---------- COMBUSTIBLE dentro del app: un panel con el wizard ---------- */
  var panel = null;
  function openFuel(name) {
    if (panel) return;
    panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.style.cssText = "position:fixed;inset:0;z-index:9995;background:#0B0F14;display:flex;flex-direction:column;";
    panel.innerHTML =
      '<div style="background:#fff;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 10px rgba(0,0,0,.15);flex:none">' +
        '<button id="mz-fuel-back" aria-label="Regresar" style="width:48px;height:48px;border:0;border-radius:14px;background:#111;color:#fff;font-size:24px;line-height:1;cursor:pointer">←</button>' +
        '<div><div style="font:900 18px/1.05 system-ui,sans-serif;letter-spacing:.02em;color:#111">COMBUSTIBLE</div>' +
        '<div style="font:600 13px/1.2 system-ui,sans-serif;color:#6B7280;margin-top:2px">' + name + '</div></div>' +
      '</div>' +
      '<iframe id="mz-fuel-frame" title="Combustible" src="' + FUEL_URL + '" style="border:0;flex:1;width:100%;background:#0B0F14"></iframe>';
    document.body.appendChild(panel);
    document.body.style.overflow = "hidden";
    panel.querySelector("#mz-fuel-back").onclick = closeFuel;
  }
  function closeFuel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; document.body.style.overflow = "";
    clearSeen(); check();                           // de vuelta al menú ¿QUÉ VAS A HACER?
  }
  window.addEventListener("message", function (ev) { if (ev && ev.data && ev.data.type === "muniz-fuel-close") closeFuel(); });

  /* ---------- el toque en el nombre: el menú aparece EN ESE INSTANTE, antes de que el app cambie de pantalla ---------- */
  var tapped = "", tappedAt = 0;
  document.addEventListener("click", function (ev) {
    if (panel || overlay) return;
    if (!hasText(/Toca tu nombre/i, "h1,h2,h3,div,p")) return;
    var b = ev.target && ev.target.closest ? ev.target.closest("button") : null; if (!b) return;
    var txt = (b.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!txt || /MIS PEDIDOS|CAMBIAR|^EN$|^ES$|^←/.test(txt) || txt.length > 40) return;
    tapped = txt; tappedAt = Date.now();
    show(tapped);
    // si el app NO pasó a la tienda (ej. pidió PIN a oficina), el menú se quita solo
    setTimeout(function () { if (overlay && !panel && !hasText(TITLE, "h1,h2,h3,div,span")) { hide(); clearSeen(); } }, 450);
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
      if (panel) return;                                                          // combustible abierto encima: no tocar
      if (hasText(/Toca tu nombre/i, "h1,h2,h3,div,p")) { clearSeen(); hide(); return; }   // lista de nombres: la próxima vez pregunta otra vez
      if (hasText(TITLE, "h1,h2,h3,div,span")) { var n = who() || (Date.now() - tappedAt < 2000 ? tapped : ""); if (n && !seen(n)) show(n); }
      else hide();
    }, 60);
  }
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", check);
  window.addEventListener("hashchange", check);
  check();
})();
