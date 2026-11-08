/*
 * notes.js — a note as a tooltip, the same on every interactive page. A click on
 * a note marker (a.tei-note-ref, a link to its note at the end) opens a panel
 * with that note, which steps to the previous or next one; Escape or a click
 * elsewhere closes it, and focus returns to the marker. A link to an element the
 * ODD marks with data-card (a register entry) opens that element in the same
 * panel, titled by its first child. Without JavaScript both stay links. The page may
 * render its text later (SaxonJS, CETEIcean), so clicks are caught on the document.
 */
(function () {
  var MARKER = 'a.tei-note-ref[href^="#note-"]';
  var LINK = 'a[href^="#"]';
  var MARGIN = 8;
  var panel, title, body, jump, shown = null;

  function build() {
    panel = document.createElement("aside");
    panel.className = "tei-tooltip";
    panel.setAttribute("role", "note");
    panel.tabIndex = -1;
    panel.hidden = true;
    panel.innerHTML = '<div class="tei-tooltip-head"><p class="tei-tooltip-title"></p><span>' +
      '<button type="button" data-step="-1" aria-label="Previous note">‹</button>' +
      '<button type="button" data-step="1" aria-label="Next note">›</button>' +
      '<button type="button" data-close aria-label="Close" title="Close (Esc)">×</button></span></div>' +
      '<div class="tei-tooltip-body"></div><p class="tei-tooltip-foot"><a href="#">Show in the notes ↓</a></p>';
    document.body.appendChild(panel);
    title = panel.querySelector(".tei-tooltip-title");
    body = panel.querySelector(".tei-tooltip-body");
    jump = panel.querySelector(".tei-tooltip-foot a");
  }

  function markers() {
    return [].filter.call(document.querySelectorAll(MARKER), function (m) { return !panel || !panel.contains(m); });
  }

  /** Below the marker, above it where there is no room, never off an edge. */
  function place() {
    var box = shown.getBoundingClientRect();
    var below = box.bottom + MARGIN, above = box.top - panel.offsetHeight - MARGIN;
    var top = below + panel.offsetHeight <= innerHeight || above < 0 ? below : above;
    panel.style.top = Math.max(MARGIN, Math.min(top, innerHeight - panel.offsetHeight - MARGIN)) + "px";
    panel.style.left = Math.min(Math.max(MARGIN, box.left), Math.max(MARGIN, innerWidth - panel.offsetWidth - MARGIN)) + "px";
  }

  /** What a link opens: a note for its marker, a card for a link to a data-card element. */
  function targetOf(link) {
    var target = link && document.getElementById(link.getAttribute("href").slice(1));
    return target && (link.matches(MARKER) || target.hasAttribute("data-card")) ? target : null;
  }

  function open(marker) {
    var note = targetOf(marker);
    if (!note) return false;
    if (!panel) build();
    var card = !marker.matches(MARKER);
    var all = card ? [marker] : markers(), at = all.indexOf(marker);
    var copy = /** @type {Element} */ (note.cloneNode(true));
    copy.removeAttribute("id");
    copy.querySelectorAll("[id]").forEach(function (e) { e.removeAttribute("id"); }); // the original keeps them
    var head = card ? copy.firstElementChild : copy.querySelector(".tei-note-num");
    if (head) head.remove();
    title.textContent = card ? (head ? head.textContent.trim() : "") :
      "Note " + marker.textContent.trim() + (all.length > 1 ? " of " + all.length : "");
    body.replaceChildren.apply(body, card ? [copy] : copy.childNodes);
    jump.href = "#" + note.id;
    jump.textContent = card ? "Show the entry ↓" : "Show in the notes ↓";
    panel.querySelectorAll("[data-step]").forEach(function (b) {
      var to = at + Number(b.dataset.step);
      b.disabled = to < 0 || to >= all.length;
      b.hidden = all.length < 2;
    });
    if (shown) shown.removeAttribute("aria-expanded");
    marker.setAttribute("aria-expanded", "true");
    shown = marker;
    panel.hidden = false;
    place();
    panel.focus({ preventScroll: true });
    return true;
  }

  /** Focus that was in the panel goes back to its marker, unless it follows a link. */
  function close(leaving) {
    if (!shown) return;
    var back = !leaving && panel.contains(document.activeElement);
    panel.hidden = true;
    shown.removeAttribute("aria-expanded");
    if (back) shown.focus({ preventScroll: true });
    shown = null;
  }

  document.addEventListener("click", function (e) {
    var t = /** @type {HTMLElement} */ (e.target);
    if (!t.closest) return;
    if (panel && panel.contains(t)) {
      var step = t.closest("[data-step]");
      var next = step && markers()[markers().indexOf(shown) + Number(step.getAttribute("data-step"))];
      if (next) { next.scrollIntoView({ block: "center" }); open(next); }
      if (t.closest("[data-close]")) close();
      if (t.closest(".tei-tooltip-foot a")) close(true);
      return;
    }
    var marker = t.closest(LINK);
    if (marker && open(marker)) e.preventDefault();
    else close();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  addEventListener("scroll", function () { if (shown) place(); }, { passive: true });
  addEventListener("resize", function () { if (shown) place(); });
})();
