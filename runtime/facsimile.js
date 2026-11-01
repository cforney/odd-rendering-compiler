/*
 * facsimile.js — a page's image beside its text, the same on every interactive
 * page. A click on a page break ([data-page], from the ODD) opens a panel with its
 * image, which steps to the previous or next page; Escape closes it. Without
 * JavaScript the break stays a plain marker. The image comes from the IIIF manifest
 * the edition names (data-manifest), version 2 or 3, fetched at the first opening;
 * the page's identifier is the end of its canvas, image or image service id.
 * TeiFacsimile.resolve(id, manifestUrl) may be replaced, for another way to find an
 * image: it returns a promise of { image, credit, rights }, or of null. The page may
 * render its text later (SaxonJS, CETEIcean), so breaks are watched for.
 */
(function () {
  var BREAK = '[data-page]:not([data-page=""])';
  var panel, title, image, status, full, credit, shown = null, manifests = {};

  /** A manifest's text, which may be a string, a list, a { "@value" } or a { language: list }. */
  function plain(v) {
    if (!v || typeof v === "string") return v || "";
    if (Array.isArray(v)) return plain(v[0]);
    return plain(v["@value"] || v.value || v[Object.keys(v)[0]]);
  }
  function idOf(o) { return o && (o.id || o["@id"]); }

  /** What a manifest says of the page `id`: its image, and whom to credit; null if it has no such page. */
  function imageOf(manifest, id) {
    var canvases = manifest.items || (manifest.sequences && manifest.sequences[0].canvases) || [];
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      var body = c.images ? c.images[0].resource : c.items[0].items[0].body;
      var service = [].concat(body.service || [])[0];
      var named = [idOf(c), idOf(body), idOf(service)].some(function (u) { return u === id || (u && u.slice(-id.length - 1) === "/" + id); });
      if (named) {
        return {
          image: idOf(body),
          credit: plain(manifest.attribution || (manifest.requiredStatement && manifest.requiredStatement.value)),
          rights: plain(manifest.rights || manifest.license),
        };
      }
    }
    return null;
  }

  /** A page with an image of its own needs no manifest. */
  function resolve(id, manifestUrl) {
    if (!manifestUrl) return Promise.resolve(/^https?:/.test(id) ? { image: id } : null);
    manifests[manifestUrl] = manifests[manifestUrl] || fetch(manifestUrl).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    return manifests[manifestUrl].then(function (m) { return imageOf(m, id); });
  }

  window.TeiFacsimile = { imageOf: imageOf, resolve: resolve };

  function build() {
    panel = document.createElement("aside");
    panel.className = "tei-facsimile";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Page image");
    panel.tabIndex = -1;
    panel.hidden = true;
    panel.innerHTML = '<div class="tei-tooltip-head"><p class="tei-tooltip-title"></p><span>' +
      '<button type="button" data-step="-1" aria-label="Previous page">‹</button>' +
      '<button type="button" data-step="1" aria-label="Next page">›</button>' +
      '<button type="button" data-close aria-label="Close" title="Close (Esc)">×</button></span></div>' +
      '<p class="tei-facsimile-status" role="status"></p><img alt="" hidden>' +
      '<p class="tei-facsimile-foot"><a target="_blank" rel="noopener" hidden>Full image ↗</a> <span></span></p>';
    document.body.appendChild(panel);
    title = panel.querySelector(".tei-tooltip-title");
    status = panel.querySelector(".tei-facsimile-status");
    image = panel.querySelector("img");
    full = panel.querySelector("a");
    credit = panel.querySelector(".tei-facsimile-foot span");
    image.onload = function () { status.textContent = ""; image.hidden = false; };
    image.onerror = function () { if (image.getAttribute("src")) status.textContent = "The image could not be loaded."; };
  }

  /** The breaks a reader can see: a view may hide some. */
  function breaks() {
    return [].filter.call(document.querySelectorAll(BREAK), function (b) { return b.getClientRects().length; });
  }

  function open(marker) {
    if (!panel) build();
    if (shown) shown.removeAttribute("aria-expanded");
    marker.setAttribute("aria-expanded", "true");
    shown = marker;
    var all = breaks(), at = all.indexOf(marker), label = marker.textContent.trim();
    title.textContent = "Page " + label + (all.length > 1 ? ", " + (at + 1) + " of " + all.length : "");
    panel.querySelectorAll("[data-step]").forEach(function (b) {
      b.disabled = !all[at + Number(b.dataset.step)];
      b.hidden = all.length < 2;
    });
    image.hidden = full.hidden = true;
    image.removeAttribute("src");
    credit.textContent = "";
    status.textContent = "Loading…";
    panel.hidden = false;
    panel.focus({ preventScroll: true });
    var edition = marker.closest("[data-manifest]");
    window.TeiFacsimile.resolve(marker.dataset.page, edition && edition.dataset.manifest).then(function (found) {
      if (shown !== marker) return;
      if (!found) { status.textContent = "No image is known for this page."; return; }
      image.alt = "Page " + label;
      image.src = full.href = found.image;
      full.hidden = false;
      credit.textContent = [found.credit, found.rights].filter(Boolean).join(" · ");
    }).catch(function () {
      if (shown === marker) status.textContent = "The list of page images could not be loaded.";
    });
  }

  function close() {
    if (!shown) return;
    var marker = shown;
    panel.hidden = true;
    marker.removeAttribute("aria-expanded");
    shown = null;
    marker.focus({ preventScroll: true });
  }

  /** Page breaks answer the keyboard too. Idempotent, as it runs on every change to the page. */
  function upgrade() {
    document.querySelectorAll(BREAK + ":not([role])").forEach(function (b) {
      b.setAttribute("role", "button");
      b.setAttribute("aria-haspopup", "dialog");
      b.title = "Show the page image";
      b.tabIndex = 0;
    });
  }
  upgrade();
  new MutationObserver(upgrade).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t.closest) return;
    if (panel && panel.contains(t)) {
      var step = t.closest("[data-step]");
      var next = step && breaks()[breaks().indexOf(shown) + Number(step.dataset.step)];
      if (next) { next.scrollIntoView({ block: "center" }); open(next); }
      if (t.closest("[data-close]")) close();
      return;
    }
    var marker = t.closest(BREAK);
    if (marker) open(marker);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") return close();
    var marker = (e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest(BREAK);
    if (marker) { e.preventDefault(); open(marker); }
  });
})();
