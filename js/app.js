/* ============================================================
   WAVELENGTH — app.js
   Small bootstrap: bring the store up, then hand off to UI.
   ============================================================ */
(function (global) {
  "use strict";

  function boot() {
    try {
      MP.Store.init();
      MP.UI.init();
    } catch (e) {
      console.error("Wavelength failed to start:", e);
      const root = document.getElementById("app");
      if (root) {
        root.innerHTML =
          '<div style="grid-column:1/3;grid-row:1/3;display:flex;align-items:center;justify-content:center;' +
          'height:100vh;color:#98a3b3;font-family:Manrope,sans-serif;text-align:center;padding:24px;">' +
          '<div><h2 style="color:#eaeef4;font-family:\'Space Grotesk\',sans-serif;margin-bottom:8px;">' +
          'Wavelength hit a snag on startup</h2><p>Try reloading the page. If it keeps happening, ' +
          "your browser may not support the Web Audio APIs this player relies on.</p></div></div>";
      }
    }
  }

  // Surface any otherwise-silent promise rejections as a toast once UI exists,
  // instead of failing silently.
  window.addEventListener("unhandledrejection", (e) => {
    console.warn("Wavelength: unhandled rejection", e.reason);
    if (global.MP && global.MP.UI && global.MP.UI.toast) {
      try { global.MP.UI.toast("Something went wrong with that last action.", "error"); } catch (err) {}
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
