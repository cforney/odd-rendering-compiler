#!/usr/bin/env node

/**
 * Compile a TEI ODD to edition.css: the design tokens given with --tokens, the
 * source renditions of <tagsDecl> as `.r-<id>` rules, each model's
 * <outputRendition> as a rule on the class the renderers give the element for
 * that model (see odd-parser.mjs), the rules that lay each view over the page,
 * then the renderers' own furniture (../runtime/ui.css). The renderers evaluate
 * the predicates, so the CSS needs none. A custom property the ODD's CSS reads
 * but nothing defines is reported.
 *
 * Usage:  node odd-to-css.mjs --odd <path> [--tokens <css>] [--out <dir>]
 * Output: <dir>/edition.css
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { readOdd, on } from "./odd-parser.mjs";
import { undefinedProperties } from "./findings.mjs";
import { parseArgs, createLogger, writeOut, generatedStamp } from "./cli.mjs";

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
const odd = readOdd(resolve(oddPath));
const { specs, renditions, views } = odd;
const rules = specs.flatMap((s) => s.rules);
const tokens = tokensPath ? readFileSync(resolve(tokensPath), "utf8").trim() : "";
const oddCss = [
  ...renditions.map((r) => `.r-${r.id} { ${r.css} }`),
  ...rules.map((r) => `${r.selector} { ${r.css} }`),
];
// A view hides what it omits, and shows its own readings of an alternate.
const viewCss = views.flatMap(({ output: v }) => [
  `${on(v)} .${v}-omit { display: none; }`,
  `${on(v)} .tei-alternate-default.${v}-alternate { display: none; }`,
  `${on(v)} .tei-alternate-alt.${v}-default { display: inline; }`,
]);

for (const name of undefinedProperties(odd, tokens)) {
  log(`⚠ var(${name}) is defined nowhere${tokensPath ? "" : " (no --tokens)"}`);
}

const css = [
  `/* edition.css — generated from ${basename(oddPath)}${stamp ? `, ${stamp}` : ""}; edit the ODD, not this file. */`,
  ...(tokens ? [tokens] : []),
  ".pm-block { display: block; }",
  ...oddCss,
  ...viewCss,
  readFileSync(new URL("../runtime/ui.css", import.meta.url), "utf8").trim(),
  "",
].join("\n");

const cssPath = writeOut(outDir, "edition.css", css);
log(`✓ ${cssPath} (${tokens ? "tokens, " : ""}${renditions.length} renditions, ${rules.length} model rules, ${views.length} views)`);
