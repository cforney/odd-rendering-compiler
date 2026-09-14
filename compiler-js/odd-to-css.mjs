#!/usr/bin/env node

/**
 * Compile a TEI ODD to edition.css: the design tokens given with --tokens, the
 * source renditions of <tagsDecl> as `.r-<id>` rules, then each model's
 * <outputRendition> as a rule on the class the renderers give the element for
 * that model (see odd-parser.mjs). The renderers evaluate the predicates, so
 * the CSS needs none. A custom property the ODD's CSS reads but nothing defines
 * is reported.
 *
 * Usage:  node odd-to-css.mjs --odd <path> [--tokens <css>] [--out <dir>]
 * Output: <dir>/edition.css
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { readOdd } from "./odd-parser.mjs";
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
const { specs, renditions } = readOdd(resolve(oddPath));
const rules = specs.flatMap((s) => s.rules);
const tokens = tokensPath ? [readFileSync(resolve(tokensPath), "utf8").trim()] : [];
const oddCss = [
  ...renditions.map((r) => `.r-${r.id} { ${r.css} }`),
  ...rules.map((r) => `${r.selector} { ${r.css} }`),
];

// Custom properties are defined by the tokens, by the ODD's CSS, and by `--…` params.
const names = (lines, re) => [...lines.join("\n").matchAll(re)].map((m) => m[1]);
const models = specs.flatMap((s) => s.models).flatMap((m) => [m, ...(m.parts ?? [])]);
const defined = new Set([
  ...names([...tokens, ...oddCss], /(--[\w-]+)\s*:/g),
  ...models.flatMap((m) => m.params.map((p) => p.name)),
]);
for (const name of new Set(names(oddCss, /var\(\s*(--[\w-]+)/g))) {
  if (!defined.has(name)) log(`⚠ var(${name}) is defined nowhere${tokensPath ? "" : " (no --tokens)"}`);
}

const css = [
  `/* edition.css — generated from ${basename(oddPath)}${stamp ? `, ${stamp}` : ""}; edit the ODD, not this file. */`,
  ...tokens,
  ".pm-block { display: block; }",
  ...oddCss,
  "",
].join("\n");

const cssPath = writeOut(outDir, "edition.css", css);
log(`✓ ${cssPath} (${tokens.length ? "tokens, " : ""}${renditions.length} renditions, ${rules.length} model rules)`);
