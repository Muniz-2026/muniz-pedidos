/* MUÑIZ Pedidos · actualizador  ·  v1.0
   Hace que TODOS los teléfonos corran la versión más nueva sin que nadie
   tenga que "refrescar":
     · registra sw.js y le pide al navegador que busque una versión nueva
       cada vez que el app vuelve a la pantalla (visibilitychange), al abrir,
       y cada 10 minutos mientras está abierto;
     · cuando un sw.js nuevo toma el control (controllerchange), recarga la
       página - en TODAS las pestañas y en el ícono de inicio a la vez;
     · nunca recarga a la mitad de un PO de combustible: si el panel está
       abierto espera a que se cierre (pedidos_menu.js llama __mzFlushReload).
   El estado de pedidos vive en localStorage, así que recargar no pierde nada. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  var had = !!navigator.serviceWorker.controller;      // ya había un worker: entonces un cambio = versión nueva
  var pending = false, reloading = false;
  window.__mzUpd = function () { return { pending: pending, reloading: reloading, busy: !!window.__mzBusy, had: had }; };
  function busy() { return !!window.__mzBusy || document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.visibilityState === "visible" && window.__mzTyping; }
  function reload() { if (reloading) return; reloading = true; try { sessionStorage.setItem("muniz_reloaded", String(Date.now())); } catch (e) { } location.reload(); }
  function flush() { if (pending && !window.__mzBusy) reload(); }
  window.__mzFlushReload = flush;

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!had) { had = true; return; }                  // primera instalación: no hay nada que recargar
    if (window.__mzBusy || document.visibilityState !== "visible") { pending = true; return; }
    reload();
  });
  navigator.serviceWorker.addEventListener("message", function (ev) {
    var d = ev.data || {};
    if (d.type === "MUNIZ_SW_ACTIVATED") { window.__mzSwCache = d.cache; try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: "MUNIZ_ACK" }); } catch (e) { } }
  });

  var reg = null;
  function check() { try { if (reg && reg.update) reg.update().catch(function () { }); } catch (e) { } }
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(function (r) {
      reg = r;
      if (r.waiting) r.waiting.postMessage({ type: "MUNIZ_SKIP_WAITING" });
      r.addEventListener("updatefound", function () {
        var nw = r.installing; if (!nw) return;
        nw.addEventListener("statechange", function () { if (nw.state === "installed" && r.waiting) r.waiting.postMessage({ type: "MUNIZ_SKIP_WAITING" }); });
      });
      check();
    }).catch(function () { });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    flush();                                           // había una versión nueva esperando: ahora que lo abrió, recarga
    check();
  });
  window.addEventListener("pageshow", function (ev) { if (ev.persisted) { flush(); check(); } });
  setInterval(function () { if (document.visibilityState === "visible") check(); }, 10 * 60 * 1000);
})();
