#!/usr/bin/env node

/**
 * Compile a TEI ODD to edition.css: the design tokens given with --tokens, the
 * source renditions of <tagsDecl> as `.r-<id>` rules, each model's
 * <outputRendition> as a rule on the class the renderers give the element for
 * that model (see odd-parser.mjs), the rules that lay each view over the page,
 * then the renderers' own furniture (../runtime/ui.css). The renderers evaluate
 * the predicates, so the CSS needs none. It reports any custom property the
 * ODD's CSS reads but nothing defines, and how many models the CSS alone cannot
 * render (cssResidue in findings.mjs).
 *
 * Usage:   node odd-to-css.mjs --odd <path> [--tokens <css>] [--out <dir>]
 * Output:  <dir>/edition.css
 * Read by: every renderer (--css), and the CETEIcean pages
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { editionCss } from "./index.mjs";
import { undefinedProperties, cssResidue } from "./findings.mjs";
import { parseArgs, loadOdd, createLogger, writeOut, generatedStamp } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("odd-to-css");
const oddPath = cli.get("--odd");
const tokensPath = cli.get("--tokens");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-css.mjs --odd <path> [--tokens <css>] [--out <dir>]");
  process.exit(1);
}

log(`Parsing ODD: ${oddPath}`);
const odd = loadOdd(oddPath, "odd-to-css");
const { specs, renditions, views } = odd;
const tokens = tokensPath ? readFileSync(resolve(tokensPath), "utf8").trim() : "";

for (const name of undefinedProperties(odd, tokens)) {
  log(`⚠ var(${name}) is defined nowhere${tokensPath ? "" : " (no --tokens)"}`);
}

const css = editionCss(odd, { tokens, source: basename(oddPath), stamp });
const rules = specs.flatMap((s) => s.rules);
const cssPath = writeOut(outDir, "edition.css", css);
log(`✓ ${cssPath} (${tokens ? "tokens, " : ""}${renditions.length} renditions, ${rules.length} model rules, ${views.length} views; ${specs.filter((s) => s.models.length).length} of ${specs.length} elements have a model)`);
log(`${cssResidue(specs).length} of ${specs.flatMap((s) => s.models).length} models need the renderers: a behaviour CSS cannot express, or a predicate on more than ancestry`);
