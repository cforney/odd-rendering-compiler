/*
 * ceteicean.js — the runtime of a generated tei-ceteicean-behaviours.js, the
 * CETEIcean tier. Both CETEIcean generators copy it in, followed by the ODD's
 * models as `teiModels`.
 *
 * This tier is a subset of the Processing Model, run in the browser: each TEI
 * custom element takes the first of its models whose `when` selector matches
 * (none: always) and is reshaped into the HTML the other renderers emit, with
 * the same classes, so edition.css styles it alike. The generators pass only
 * what it can do: models without @output, predicates that are CSS selectors,
 * and params that are literals, { attr } or { count, plus }.
 */
var teiNotes = 0;

/** A param's value: a literal, an attribute, or a count of ancestors plus a number. */
function teiParam(el, v) {
  if (v && v.attr) return el.getAttribute(v.attr) || "";
  if (v && v.count) {
    var n = v.plus;
    for (var p = el.parentElement; p; p = p.parentElement) if (p.localName === "tei-" + v.count) n++;
    return n;
  }
  return v == null ? "" : v;
}

/** `@rendition="#a #b"` → r-a r-b */
function teiRenditions(el) {
  return (el.getAttribute("rendition") || "").split(/\s+/).filter(Boolean).map(function (t) { return "r-" + t.replace(/^#/, ""); });
}

/** Move the element's content into a new HTML element; the custom element stays, without a box. */
function teiReshape(el, tag, cls) {
  var n = document.createElement(tag);
  n.className = cls;
  while (el.firstChild) n.appendChild(el.firstChild);
  el.style.display = "contents";
  el.appendChild(n);
  return n;
}

function teiRender(el, ident, m) {
  var p = m.params;
  var cls = ["tei-" + ident].concat(m.classes, m.source ? teiRenditions(el) : []).join(" ");
  switch (m.behaviour) {
    case "omit":
    case "metadata":
      el.style.display = "none";
      return;
    case "text":
      el.style.display = "contents";
      return;
    case "heading":
      teiReshape(el, "h" + Math.min(6, Math.max(1, Math.trunc(Number(teiParam(el, p.level))) || 1)), cls);
      return;
    // A note at the end or foot: a marker that opens its body inline; elsewhere, not shown.
    case "note":
      var place = p.place == null ? "end" : String(teiParam(el, p.place));
      if (place !== "end" && place !== "foot") { el.style.display = "none"; return; }
      var body = teiReshape(el, "span", "tei-note-body");
      var ref = document.createElement("a");
      ref.className = cls + " tei-note-ref";
      ref.href = "#";
      ref.textContent = ++teiNotes;
      el.insertBefore(ref, body);
      el.classList.add("tei-note-interactive");
      return;
    // The first two child elements are the readings; the page script toggles them.
    case "alternate":
      var readings = Array.prototype.slice.call(el.children, 0, 2);
      var alt = teiReshape(el, "span", cls + " tei-alternate");
      alt.replaceChildren();
      ["tei-alternate-default", "tei-alternate-alt"].forEach(function (c, i) {
        var s = document.createElement("span");
        s.className = c;
        s.hidden = i === 1;
        if (readings[i]) s.appendChild(readings[i]);
        alt.appendChild(s);
      });
      return;
    case "link":
      teiReshape(el, "a", cls).href = teiParam(el, p.uri);
      return;
    case "graphic":
      var img = document.createElement("img");
      img.className = cls;
      img.src = teiParam(el, p.url);
      img.alt = "";
      el.style.display = "contents";
      el.replaceChildren(img);
      return;
    case "anchor":
      el.className = cls;
      el.id = el.getAttribute("xml:id") || "";
      return;
    case "break":
      if (p.label == null) teiReshape(el, "br", cls);
      else teiReshape(el, "span", cls).textContent = teiParam(el, p.label);
      return;
    default:
      teiReshape(el, m.tag || "span", cls);
  }
}

/** CETEIcean behaviours from the models: one function per TEI element. */
function teiBehaviours(models) {
  var tei = {};
  Object.keys(models).forEach(function (ident) {
    tei[ident] = function (el) {
      for (var i = 0; i < models[ident].length; i++) {
        var m = models[ident][i];
        if (!m.when || el.matches(m.when)) return teiRender(el, ident, m);
      }
    };
  });
  return { tei: tei };
}
