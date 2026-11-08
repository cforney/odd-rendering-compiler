/*
 * tei-islands.js — the enhancer that loads behaviour when it is needed, framework-free.
 *
 * It finds the interactive regions by what every renderer writes (.tei-alternate,
 * [data-page]) and wraps each in a <tei-island type on="load|idle|visible|media(…)">,
 * so a page needs nothing from its build; a renderer may write such an element itself.
 * When a region's strategy fires, its type's behaviour runs. A standard type fetches
 * the shared script of that behaviour, beside this one, which then serves the whole
 * page; so a page without a kind of region never loads its script. Add a type with
 * TeiIslands.register(name, fn), where fn receives the island.
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

  var here = /** @type {HTMLScriptElement} */ (document.currentScript).src;
  /** A behaviour that fetches a script beside this one, once. */
  function fetches(file) {
    var url = new URL(file, here).href;
    return function () {
      if (!document.querySelector('script[src="' + url + '"]')) document.head.appendChild(document.createElement("script")).src = url;
    };
  }
  register("choice", fetches("readings.js"));
  register("facsimile", fetches("facsimile.js"));

  window.TeiIslands = { register: register };

  /** Wrap what matches as an island, unless it is inside a reading, which swaps as a whole. */
  function mark(selector, type, on) {
    document.querySelectorAll(selector).forEach(function (el) {
      if (el.parentElement.closest(".tei-alternate")) return;
      var island = document.createElement("tei-island");
      island.setAttribute("type", type);
      island.setAttribute("on", on);
      el.replaceWith(island);
      island.appendChild(el);
    });
  }
  mark(".tei-alternate", "choice", "visible");
  mark('[data-page]:not([data-page=""])', "facsimile", "visible");

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
