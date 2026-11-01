/*
 * Generic island hydration — framework-free, ~2 KB.
 *
 * The renderer wraps each interactive region in
 *   <tei-island type="choice" on="load|idle|visible|media(…)">
 * around HTML that already works without JavaScript. This custom element upgrades
 * that one region when its strategy fires, so only marked regions ship behaviour,
 * and only on demand — static-first interactivity. The `type` → behaviour table is
 * a registry; add a type with TeiIslands.register(name, fn) and emit the marker.
 *
 * The model mirrors Astro's <astro-island> and its client:load / client:idle /
 * client:visible / client:media directives (display:contents wrapper; "visible"
 * observes the children, since the wrapper itself has no box).
 */
(function () {
  "use strict";

  var behaviours = Object.create(null);
  function register(type, hydrate) { behaviours[type] = hydrate; }

  // Run `cb` per the chosen strategy.
  function schedule(on, el, cb) {
    var m = /^media\((.+)\)$/.exec(on || "");
    if (on === "idle") return (window.requestIdleCallback || function (f) { setTimeout(f, 200); })(cb);
    if (m) {
      var mq = matchMedia(m[1]);
      if (mq.matches) return cb();
      return mq.addEventListener("change", function once(e) {
        if (e.matches) { mq.removeEventListener("change", once); cb(); }
      });
    }
    if (on === "visible" && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) { io.disconnect(); return cb(); }
      });
      // display:contents wrappers have no box, so observe the children.
      for (var c = 0; c < el.children.length; c++) io.observe(el.children[c]);
      return el.children.length ? undefined : cb();
    }
    return cb();                                   // "load", or no observer support
  }

  // --- Standard TEI island behaviours --------------------------------------

  // Choice/apparatus: click or keyboard toggles between the two readings.
  register("choice", function (island) {
    var alt = island.querySelector(".tei-alternate");
    var readings = alt && [].filter.call(alt.children, function (n) { return n.nodeType === 1; });
    if (!readings || readings.length < 2) return;
    var showAlt = false;
    function toggle() {
      showAlt = !showAlt;
      readings[0].hidden = showAlt; readings[1].hidden = !showAlt;
      alt.setAttribute("aria-checked", String(showAlt));
    }
    readings[1].hidden = true;
    alt.setAttribute("role", "switch");
    alt.setAttribute("aria-checked", "false");
    alt.setAttribute("tabindex", "0");
    alt.addEventListener("click", toggle);
    alt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });

  // A page break: the first in view loads the facsimile, which then serves them all.
  var facsimile = new URL("facsimile.js", document.currentScript.src).href;
  register("facsimile", function () {
    if (document.querySelector('script[src="' + facsimile + '"]')) return;
    document.head.appendChild(document.createElement("script")).src = facsimile;
  });

  window.TeiIslands = { register: register };

  // Defined last, so the registry is populated before any element upgrades.
  customElements.define("tei-island", class extends HTMLElement {
    connectedCallback() {
      var hydrate = behaviours[this.getAttribute("type")];
      if (!hydrate || this.dataset.hydrated != null) return;
      var self = this;
      schedule(this.getAttribute("on") || "visible", this, function () {
        if (self.dataset.hydrated != null) return;
        self.dataset.hydrated = "";
        hydrate(self);
      });
    }
  });
})();
