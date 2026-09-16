/**
 * The XPath of predicates and params, compiled once at build time.
 *
 * An expression the subset in ../runtime/xpath.mjs cannot evaluate is degraded
 * to what a failing evaluation would have returned anyway — `false()` for a
 * predicate, the empty sequence for a param — and recorded with the element,
 * the model and the line of the ODD it was written in. A foreign ODD therefore
 * renders, with a report of what was dropped, instead of failing the build.
 *
 * `--strict` restores the failure, and is how our own ODDs are compiled, so a
 * regression in them stays a build error.
 */

import { xpath } from "../runtime/xpath.mjs";
import { allModels } from "./odd-parser.mjs";

/**
 * Compile every expression of `specs`. Returns the table of what could not be
 * compiled — `{ element, model, where, expression, reason, odd, line }` — and
 * `predicate`/`param`, which give an expression back, or its degraded stand-in.
 */
export function checkXPath(specs) {
  const entries = [];
  const failed = new Map();

  const check = (expression, where, site) => {
    if (!failed.has(expression)) {
      try {
        xpath(expression);
        failed.set(expression, null);
      } catch (e) {
        failed.set(expression, e.message.replace(`XPath "${expression}": `, ""));
      }
    }
    const reason = failed.get(expression);
    if (reason) entries.push({ element: site.element, model: site.id, where, expression, reason, odd: site.odd, line: site.line });
  };

  for (const m of allModels(specs)) {
    if (m.predicate) check(m.predicate, "predicate", m);
    for (const p of m.params) check(p.value, `param ${p.name}`, { ...m, line: p.line });
  }

  const runs = (expression) => !failed.get(expression);
  return {
    entries,
    predicate: (expression) => (runs(expression) ? expression : "false()"),
    param: (expression) => (runs(expression) ? expression : "()"),
  };
}

/**
 * Print what was degraded: one line with the count, or every entry and a
 * non-zero exit under `--strict`.
 */
export function reportUnsupported(entries, { scope, strict }) {
  if (!entries.length) return;
  if (!strict) {
    console.warn(`[${scope}] ⚠ ${entries.length} expression(s) outside the XPath subset, degraded (see odd-unsupported.json)`);
    return;
  }
  for (const e of entries) console.error(`[${scope}] ✗ <${e.element}> (${e.model}, ${e.odd}:${e.line}), ${e.where}: XPath "${e.expression}": ${e.reason}`);
  process.exit(1);
}
