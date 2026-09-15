/* =====================================================================
   MUÑIZ PEDIDOS · MENÚ DESPUÉS DEL NOMBRE  ·  v1.0
   ---------------------------------------------------------------------
   Toca tu nombre → ¿Qué vas a hacer?
     🧱 MATERIALES   → sigue igual (¿A qué tienda vas?)
     ⛽ COMBUSTIBLE  → abre el app de combustible con tu nombre ya puesto
   No toca app.js. Se carga en index.html después de pedidos_db.js.
   ===================================================================== */
(function () {
  "use strict";
  var K_PED = "muniz_pedido", K_FUEL_ME = "muniz_fuel_me", K_SEEN = "muniz_menu_seen";
  var TITLE = /¿A QUÉ TIENDA VAS\?/i;
  var FUEL_URL = "./fuel.html";

  function ls(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function who() { var p = ls(K_PED); return p && p.name ? String(p.name).toUpperCase() : ""; }
  function seen(name) { try { return sessionStorage.getItem(K_SEEN) === name; } catch (e) { return false; } }
  function markSeen(name) { try { sessionStorage.setItem(K_SEEN, name); } catch (e) { } }
  function clearSeen() { try { sessionStorage.removeItem(K_SEEN); } catch (e) { } }

  var overlay = null;
  function hide() { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; }

  function show(name) {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9990;background:#EEECE6;display:flex;flex-direction:column;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;";
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
    overlay.querySelector("#mz-mat").onclick = function () { markSeen(name); hide(); };
    overlay.querySelector("#mz-fuel").onclick = function () {
      markSeen(name);
      try { localStorage.setItem(K_FUEL_ME, JSON.stringify(name)); } catch (e) { }   // el wizard arranca en el paso 2 con el nombre puesto
      location.href = FUEL_URL;
    };
    overlay.querySelector("#mz-back").onclick = function () { hide(); clearSeen(); history.back(); };
  }
  function card(id, color, icon, title, sub, btn) {
    return '<button id="' + id + '" style="text-align:left;background:#fff;border:3px solid ' + color + ';border-radius:22px;padding:22px 20px;cursor:pointer;display:block;width:100%">' +
      '<div style="font-size:40px;line-height:1">' + icon + '</div>' +
      '<div style="font:900 34px/1 system-ui,sans-serif;color:' + color + ';margin-top:10px;letter-spacing:.01em">' + title + '</div>' +
      '<div style="font:600 15px/1.3 system-ui,sans-serif;color:#374151;margin-top:8px">' + sub + '</div>' +
      '<div style="display:inline-block;margin-top:14px;background:' + color + ';color:#fff;font:900 15px/1 system-ui,sans-serif;padding:14px 18px;border-radius:14px;letter-spacing:.03em">' + btn + '</div>' +
    '</button>';
  }

  /* ¿estamos en la pantalla de la tienda? (aparece justo después del nombre) */
  function onStoreScreen() {
    var els = document.querySelectorAll("h1,h2,h3,div,span");
    for (var i = 0; i < els.length; i++) { if (els[i].children.length === 0 && TITLE.test(els[i].textContent || "")) return true; }
    return false;
  }
  function onNameScreen() {
    var els = document.querySelectorAll("h1,h2,h3,div,p");
    for (var i = 0; i < els.length; i++) { if (els[i].children.length === 0 && /Toca tu nombre/i.test(els[i].textContent || "")) return true; }
    return false;
  }
  var t;
  function check() {
    clearTimeout(t);
    t = setTimeout(function () {
      if (onNameScreen()) { clearSeen(); hide(); return; }          // volvió a la lista: la próxima vez pregunta otra vez
      if (onStoreScreen()) { var n = who(); if (n && !seen(n)) show(n); }
      else hide();
    }, 60);
  }
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", check);
  window.addEventListener("hashchange", check);
  check();
})();
