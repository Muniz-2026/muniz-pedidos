/* =====================================================================
   MUÑIZ PEDIDOS · MENÚ DESPUÉS DEL NOMBRE  ·  v2.0
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
    el.style.transition = "opacity .16s ease-in, transform .16s ease-in"; el.style.opacity = "0"; el.style.transform = "translateY(10px)";
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); hiding = false; if (!panel) showPills(); }, 170);
  }
  function card(id, color, icon, title, sub, btn) {
    return '<button id="' + id + '" style="text-align:left;background:#fff;border:3px solid ' + color + ';border-radius:22px;padding:22px 20px;cursor:pointer;display:block;width:100%">' +
      '<div style="font-size:40px;line-height:1">' + icon + '</div>' +
      '<div style="font:900 34px/1 \'Archivo Black\',system-ui,sans-serif;color:' + color + ';margin-top:10px;letter-spacing:-.02em">' + title + '</div>' +
      '<div style="font:600 15px/1.3 system-ui,sans-serif;color:#374151;margin-top:8px">' + sub + '</div>' +
      '<div style="display:inline-block;margin-top:14px;background:' + color + ';color:#fff;font:900 15px/1 system-ui,sans-serif;padding:14px 18px;border-radius:14px;letter-spacing:.03em">' + btn + '</div>' +
    '</button>';
  }
  function show(name) {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9990;background:#EDEBE6;display:flex;flex-direction:column;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;opacity:0;transform:translateY(14px);will-change:opacity,transform;";
    /* misma cabecera que el resto del app: franja, flecha negra de 48px, título Archivo Black 15px, nombre en gris */
    overlay.innerHTML =
      '<div style="height:8px;background:repeating-linear-gradient(45deg,#17181A 0 14px,#FFB800 14px 28px)"></div>' +
      '<div style="background:#fff;border-bottom:1px solid #D8D4CB;padding:6px 8px;display:flex;align-items:center;gap:8px">' +
        '<button id="mz-back" aria-label="Regresar" style="width:48px;height:48px;flex:none;border:0;border-radius:12px;background:#17181A;color:#fff;font-size:24px;font-weight:900;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center">←</button>' +
        '<div style="flex:1;min-width:0"><div style="font:900 15px/1.2 \'Archivo Black\',system-ui,sans-serif;letter-spacing:-.025em;color:#17181A">¿QUÉ VAS A HACER?</div>' +
        '<div style="font:400 10px/1.25 system-ui,sans-serif;color:#6B675E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</div></div>' +
      '</div>' +
      '<div style="padding:18px 16px;display:flex;flex-direction:column;gap:16px;flex:1">' +
        card("mz-mat", "#FF5A00", "🧱", "MATERIALES", "Pedir a ACE · CMC · RSS · White Cap", "ENTRAR A PEDIDOS →") +
        card("mz-fuel", "#1E3A8A", "⛽", "COMBUSTIBLE", "PO de diésel o gasolina · Tex-Con · Leo's", "SACAR PO DE COMBUSTIBLE →") +
      '</div>';
    document.body.appendChild(overlay);
    hidePills();
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

  /* ---------- COMBUSTIBLE dentro del app: mismo documento, mismo estilo, una sola cabecera ---------- */
  var panel = null, fuelHandle = null, hiddenPills = [];
  function openFuel(name) {
    if (panel) return;
    if (!(window.MunizFuel && window.MunizFuel.mount)) { alert("No cargó combustible (fuel.js). Recarga el app."); return; }
    panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.className = "mzf-scroll";
    panel.style.cssText = "position:fixed;inset:0;z-index:9995;background:#EDEBE6;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;";
    document.body.appendChild(panel);
    document.body.style.overflow = "hidden";
    hidePills();
    fuelHandle = window.MunizFuel.mount(panel, { who: name, onClose: closeFuel });
  }
  function closeFuel() {
    if (fuelHandle) { try { fuelHandle.unmount(); } catch (e) { } fuelHandle = null; }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; document.body.style.overflow = "";
    if (overlay) hidePills(); else showPills();          // el menú sigue abierto debajo: la pastilla sigue escondida
    clearSeen(); check();                           // de vuelta al menú ¿QUÉ VAS A HACER?
  }
  /* la pastilla flotante "MIS PEDIDOS" (pedidos_db.js) no debe verse encima del combustible */
  function hidePills() {
    var els = document.querySelectorAll("button, a, div");
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
      if (panel) { hidePills(); return; }                                          // combustible abierto encima: no tocar
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
