/**
 * Behaviour → HTML/CSS contract for the JS generators.
 *
 * The DATA lives in the shared `../behaviour-map.json` — the single source of
 * truth read by BOTH compilers (the XSLT generators read the same file with
 * `json-doc()`), so the JS and XSLT element/style maps cannot drift. This module
 * loads it and exposes the derived helpers the JS generators use:
 *
 *   BEHAVIOURS         the map, keyed by behaviour. Fields: tag, display, css,
 *                      wrapper, requiresJS, omit, passthrough, void, compound
 *                      (documented in behaviour-map.json / docs/behaviour-table.md).
 *   JS_BEHAVIOURS      behaviours that need a script (no static CSS form).
 *   behaviourBaseCss() the base CSS declaration for a behaviour.
 *
 * Behaviours with per-pipeline logic (note, link, alternate, graphic, heading)
 * keep their DOM code in each generator; only the shared element/style core is
 * declared in the JSON.
 */

import { readFileSync } from "node:fs";

const raw = JSON.parse(
  readFileSync(new URL("../behaviour-map.json", import.meta.url), "utf8"),
);

// Drop documentation keys (the leading-underscore convention in the JSON).
export const BEHAVIOURS = Object.fromEntries(
  Object.entries(raw).filter(([key]) => !key.startsWith("_")),
);

/** Behaviour idents that cannot be expressed in static CSS (need a script). */
export const JS_BEHAVIOURS = new Set(
  Object.entries(BEHAVIOURS)
    .filter(([, def]) => def.requiresJS)
    .map(([name]) => name),
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
