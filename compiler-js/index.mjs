/**
 * The library: the compiler without its command lines, for a build that renders
 * TEI itself (a static-site generator, a rehype pipeline). It reads an ODD and
 * renders documents in memory; it writes no files and never exits the process:
 * an ODD it cannot read throws an OddError, and XPath outside the subset is
 * returned as `unsupported`, degraded as on the command line.
 *
 *   import { compileOdd, renderDocument } from "odd-rendering-compiler";
 *   const edition = compileOdd("tei_simler.odd");
 *   const { html, page } = renderDocument(edition, xml);
 *
 * The pages, the corpus index, the enhancers and the reports stay with the
 * command lines (odd-render, render-unified.mjs, …).
 */

import { readFileSync } from "fs";
import { basename } from "path";
import { readOdd, parseXmlToXast, on } from "./odd-parser.mjs";
import { checkXPath, compileModels } from "./unsupported.mjs";
import { createRenderer } from "../runtime/pm-runtime.mjs";
import { toHtml } from "./html.mjs";

export { readOdd, parseXmlToXast, OddError } from "./odd-parser.mjs";
export { toHtml };

/**
 * edition.css: the design tokens, the source renditions as `.r-<id>` rules, each
 * model's <outputRendition>, the rules that lay each view over the page, then the
 * renderers' own furniture (../runtime/ui.css).
 * @param {ReturnType<typeof readOdd>} odd
 * @param {{ tokens?: string, source?: string, stamp?: string }} [options]  the tokens' CSS; the ODD's name and a date for the header
 */
export function editionCss({ specs, renditions, views }, { tokens = "", source = "the ODD", stamp = "" } = {}) {
  return [
    `/* edition.css — generated from ${source}${stamp ? `, ${stamp}` : ""}; edit the ODD, not this file. */`,
    ...(tokens.trim() ? [tokens.trim()] : []),
    ".pm-block { display: block; }",
    ...renditions.map((r) => `.r-${r.id} { ${r.css} }`),
    ...specs.flatMap((s) => s.rules).map((r) => `${r.selector} { ${r.css} }`),
    // A view hides what it omits, and shows its own readings of an alternate.
    ...views.flatMap(({ output: v }) => [
      `${on(v)} .${v}-omit { display: none; }`,
      `${on(v)} .tei-alternate-default.${v}-alternate { display: none; }`,
      `${on(v)} .tei-alternate-alt.${v}-default { display: inline; }`,
    ]),
    readFileSync(new URL("../runtime/ui.css", import.meta.url), "utf8").trim(),
    "",
  ].join("\n");
}

/**
 * An ODD compiled for rendering: the ODD as read, its stylesheet, the XPath it
 * degraded, and the renderer.
 * @param {string} path
 * @param {{ tokens?: string }} [options]  the design tokens' CSS, put at the top of the stylesheet
 */
export function compileOdd(path, { tokens = "" } = {}) {
  const odd = readOdd(path);
  const grammar = checkXPath(odd.specs);
  return {
    odd,
    css: editionCss(odd, { tokens, source: basename(path) }),
    unsupported: grammar.entries,
    teiToHast: createRenderer(compileModels(odd.specs, grammar), odd.views),
  };
}

/**
 * One TEI document rendered: the edition as HTML and as hast, its notes, and the
 * params of the page model (title, lang, credit, …), each a list of strings.
 * @param {ReturnType<typeof compileOdd>} edition
 * @param {string | object} source  the TEI as a string, or as xast
 * @param {{ output?: string }} [options]  the Processing-Model output (default: web, the page)
 */
export function renderDocument(edition, source, { output = "web" } = {}) {
  const { hast, notes, page } = edition.teiToHast(typeof source === "string" ? parseXmlToXast(source) : source, { output });
  return { html: toHtml(hast), hast, notes, page };
}
