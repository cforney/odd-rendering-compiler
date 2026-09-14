#!/usr/bin/env node

/**
 * Compile a TEI ODD to edition.css: the source renditions of <tagsDecl> as
 * `.r-<id>` rules, then each model's <outputRendition> as a rule on the class
 * the renderers give the element for that model (see odd-parser.mjs). The
 * renderers evaluate the predicates, so the CSS needs none.
 *
 * Usage:  node odd-to-css.mjs --odd <path> [--out <dir>]
 * Output: <dir>/edition.css
 */

import { resolve, basename } from "path";
import { readOdd } from "./odd-parser.mjs";
import { parseArgs, createLogger, writeOut, generatedStamp } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("odd-to-css");
const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-css.mjs --odd <path> [--out <dir>]");
  process.exit(1);
}

log(`Parsing ODD: ${oddPath}`);
const { specs, renditions } = readOdd(resolve(oddPath));
const rules = specs.flatMap((s) => s.rules);

const css = [
  `/* edition.css — generated from ${basename(oddPath)}${stamp ? `, ${stamp}` : ""}; edit the ODD, not this file. */`,
  ".pm-block { display: block; }",
  ...renditions.map((r) => `.r-${r.id} { ${r.css} }`),
  ...rules.map((r) => `${r.selector} { ${r.css} }`),
  "",
].join("\n");

const cssPath = writeOut(outDir, "edition.css", css);
log(`✓ ${cssPath} (${renditions.length} renditions, ${rules.length} model rules)`);
