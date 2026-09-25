/* =====================================================================
   MUÑIZ PEDIDOS · iPhone motion · v1
   Small touches that make the app feel alive: counters bump when they change,
   the "sent" screen gets a burst of Muñiz colors, the splash fades out.
   Never touches app logic; if anything fails, the app works exactly as before.
   ===================================================================== */
(function () {
  "use strict";
  try {
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* counters (cart badge, totals) bump when their number changes */
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var n = ms[i].target, el = n.nodeType === 3 ? n.parentElement : n;
        if (!el || !el.closest) continue;
        var b = el.closest(".rounded-full");
        var t = b && (b.textContent || "").trim();
        if (b && t && t.length <= 4 && /^\d+$/.test(t)) { b.classList.remove("pz-bump"); void b.offsetWidth; b.classList.add("pz-bump"); }
      }
    }).observe(document.body, { subtree: true, characterData: true });

    /* the "sent" moment: a burst of Muñiz colors around the check */
    var seen = typeof WeakSet === "function" ? new WeakSet() : null;
    function burst(el) {
      if (reduce) return;
      var r = el.getBoundingClientRect(); if (!r.width) return;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var cols = ["#FF5A00", "#0071E3", "#248A3D", "#FFB300", "#AF52DE", "#FF8A3D"];
      for (var i = 0; i < 24; i++) {
        var d = document.createElement("i"); d.className = "pz-burst";
        var a = Math.PI * 2 * i / 24 + Math.random() * 0.35, dist = 70 + Math.random() * 80;
        d.style.left = cx + "px"; d.style.top = cy + "px"; d.style.background = cols[i % cols.length];
        d.style.setProperty("--dx", Math.cos(a) * dist + "px"); d.style.setProperty("--dy", Math.sin(a) * dist + "px");
        d.style.animationDelay = (0.2 + Math.random() * 0.12) + "s";
        document.body.appendChild(d);
        (function (x) { setTimeout(function () { x.remove(); }, 1500); })(d);
      }
    }
    new MutationObserver(function () {
      var els = document.querySelectorAll(".w-24.h-24.rounded-full,.mzf .ck");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (seen ? seen.has(el) : el.__pz) continue;
        seen ? seen.add(el) : (el.__pz = 1);
        (function (e) { setTimeout(function () { burst(e); }, 140); })(el);
      }
    }).observe(document.body, { subtree: true, childList: true });
  } catch (e) { /* motion is optional */ }
})();
