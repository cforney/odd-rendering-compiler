/**
 * behaviour-map.mjs
 *
 * THE single source of truth for "PM behaviour → HTML element + base style".
 *
 * Each generator imports BEHAVIOURS and reads the fields it needs:
 *
 *   - tag         HTML element a behaviour maps to (span/div/p/h/ul/…).
 *                 Consumed by the XSLT, unified/xast, and JSON-mapping paths.
 *   - display     CSS `display` value for behaviours laid out by CSS alone.
 *                 Consumed by the CSS path (odd-to-css) and the CETEIcean
 *                 path. Absent for behaviours that have no single CSS display
 *                 (document root, JS-driven, pass-through).
 *   - css         Extra base CSS declarations the CSS path appends after the
 *                 `display` rule (e.g. list padding, paragraph margins).
 *   - requiresJS  true for behaviours that cannot be expressed in static CSS
 *                 and need a script (e.g. a CETEIcean behaviour) at runtime.
 *                 Drives the CSS path's "flagged for JS" warnings.
 *   - omit        true for behaviours that produce no visible output.
 *   - passthrough true for behaviours that emit only their children.
 *
 * Behaviours whose richer logic genuinely differs per pipeline (note, link,
 * alternate, graphic, heading levels, …) still carry their DOM-manipulation
 * code inside each generator; only the shared element/style core lives here.
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
 * Base CSS declaration string for a behaviour, as used by the CSS path.
 * Returns a real `display: …;` rule for behaviours with a CSS display, or a
 * CSS-comment sentinel (never emitted as a property) for behaviours that have
 * no static CSS representation.
 */
export function behaviourBaseCss(behaviour) {
  const def = BEHAVIOURS[behaviour];
  if (!def) return `/* behaviour: ${behaviour} */`;
  if (def.display) {
    return `display: ${def.display};${def.css ? ` ${def.css}` : ""}`;
  }
  return `/* behaviour "${behaviour}" has no static CSS */`;
}
