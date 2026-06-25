/**
 * Maps each PM behaviour to its HTML element and base style. Every generator
 * imports BEHAVIOURS and reads the fields it needs:
 *
 *   tag          HTML element (span/div/p/h/ul/…); used by the XSLT and
 *                unified/xast paths.
 *   display      CSS `display` value; used by the CSS and CETEIcean paths.
 *                Absent where there is no single display (document root,
 *                JS-driven, pass-through).
 *   css          extra base declarations the CSS path appends after `display`.
 *   requiresJS   behaviour needs a script at runtime; drives the CSS path's
 *                "flagged for JS" warnings.
 *   omit         produces no visible output.
 *   passthrough  emits only its children.
 *
 * Behaviours with per-pipeline logic (note, link, alternate, graphic, heading)
 * keep their DOM code in each generator; only the shared element/style core is
 * here.
 */

export const BEHAVIOURS = {
  // ── Structural ──────────────────────────────────────────────────────────
  document: { tag: "article" },                       // root wrapper; CSS path emits no display rule
  body:     { tag: "div",        display: "block" },
  section:  { tag: "section",     display: "block" },
  block:    { tag: "div",        display: "block" },
  paragraph:{ tag: "p",          display: "block", css: "margin-top: 0.5em; margin-bottom: 0.5em;" },
  heading:  { tag: "h",          display: "block", css: "font-weight: bold;" },

  // ── Inline ──────────────────────────────────────────────────────────────
  inline:   { tag: "span",       display: "inline" },
  title:    { tag: "span" },                          // JSON-mapping path overrides to <cite>
  text:     { passthrough: true },

  // ── Lists & tables ──────────────────────────────────────────────────────
  list:     { tag: "ul",         display: "block", css: "list-style-type: disc; padding-left: 1.5em;" },
  listItem: { tag: "li",         display: "list-item" },
  table:    { tag: "table",      display: "table" },
  row:      { tag: "tr",         display: "table-row" },
  cell:     { tag: "td",         display: "table-cell" },

  // ── Quotation / breaks ──────────────────────────────────────────────────
  cit:      { tag: "blockquote", display: "block" },
  break:    { tag: "br",         display: "block", css: "/* break */", void: true },

  // ── Hidden ──────────────────────────────────────────────────────────────
  metadata: { display: "none", omit: true },
  omit:     { display: "none", omit: true },

  // ── JS-required (no static CSS expression) ──────────────────────────────
  note:      { requiresJS: true },
  link:      { requiresJS: true },
  alternate: { requiresJS: true },
  graphic:   { requiresJS: true },
  glyph:     { requiresJS: true },
  anchor:    { requiresJS: true },
  index:     { requiresJS: true },

  // ── Compound (Boot 2024 nested-model) ───────────────────────────────────
  // Expanded by each generator into its sub-behaviours (e.g. link + graphic);
  // never rendered directly, so it carries no tag/display of its own.
  compound: { compound: true },
};

/** Behaviour idents that cannot be expressed in static CSS (need a script). */
export const JS_BEHAVIOURS = new Set(
  Object.entries(BEHAVIOURS)
    .filter(([, def]) => def.requiresJS)
    .map(([name]) => name)
);

/**
 * Base CSS declaration for a behaviour: a real `display: …;` rule where the
 * behaviour has a display, otherwise a CSS-comment sentinel (never emitted as a
 * property) for behaviours with no static CSS form.
 */
export function behaviourBaseCss(behaviour) {
  const def = BEHAVIOURS[behaviour];
  if (!def) return `/* behaviour: ${behaviour} */`;
  if (def.display) {
    return `display: ${def.display};${def.css ? ` ${def.css}` : ""}`;
  }
  return `/* behaviour "${behaviour}" has no static CSS */`;
}
