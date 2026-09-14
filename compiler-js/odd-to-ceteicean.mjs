#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to CETEIcean behaviours plus a
 * self-contained page that renders the TEI in the browser.
 *
 * CETEIcean (https://github.com/TEIC/CETEIcean) registers TEI elements as
 * `tei-` custom elements and applies behaviours to them. This tier takes a
 * subset of the Processing Model, what a browser can check on custom elements:
 * models without @output and sequences; predicates `@a`, `@a='v'`, `parent::X`,
 * `ancestor::X`, as CSS selectors; params that are literals, `@a`, or
 * `count(ancestor::X)` plus a number. A model outside it is left out with a
 * warning. The behaviours are the runtime ../runtime/ceteicean.js.
 *
 * --tei takes the renderers' inputs: each source gives a page <basename>.html,
 * several also an index.html. The pages link edition.css, which --css copies
 * beside them.
 *
 * Usage:   node odd-to-ceteicean.mjs --odd <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]
 * Outputs: <dir>/tei-ceteicean-behaviours.js, <dir>/<basename>.html, <dir>/edition.css
 */

import { readFileSync, copyFileSync, mkdirSync } from "fs";
import { resolve, basename } from "path";
import { readOdd, parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut, generatedStamp,
  resolveInputFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("odd-to-ceteicean");
const oddPath = cli.get("--odd");
const teiFiles = resolveInputFiles(cli.getAll("--tei").length ? cli.getAll("--tei") : "../examples/simler-*.xml");
const cssPath = cli.get("--css") || "output/edition.css";
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-ceteicean.mjs --odd <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]");
  process.exit(1);
}

log(`Parsing ODD: ${oddPath}`);
const specs = readOdd(resolve(oddPath)).specs;
const runtime = (name) => readFileSync(new URL(`../runtime/${name}`, import.meta.url), "utf8");

/** A predicate as a CSS selector on the custom element, or undefined outside the subset. */
function selector(pred) {
  let m;
  if ((m = pred.match(/^@([\w-]+)$/))) return `[${m[1]}]`;
  if ((m = pred.match(/^@([\w-]+)\s*=\s*'([^']*)'$/))) return `[${m[1]}="${m[2]}"]`;
  if ((m = pred.match(/^(parent|ancestor)::([\w-]+)$/))) {
    return `:is(tei-${m[2].toLowerCase()}, .tei-${m[2]})${m[1] === "parent" ? " > " : " "}*`;
  }
}

/** A param as a literal, { attr } or { count, plus }, or undefined outside the subset. */
function param(value) {
  let m;
  if ((m = value.match(/^'([^']*)'$/))) return m[1];
  if (/^\d+$/.test(value)) return Number(value);
  if ((m = value.match(/^@([\w-]+)$/))) return { attr: m[1] };
  if ((m = value.match(/^count\(ancestor::([\w-]+)\)(?:\s*\+\s*(\d+))?$/))) return { count: m[1].toLowerCase(), plus: Number(m[2] ?? 0) };
}

const models = {};
for (const { ident, models: all } of specs) {
  const kept = [];
  for (const m of all.filter((m) => !m.output)) {
    const when = m.predicate ? selector(m.predicate) : undefined;
    if (m.parts || (m.predicate && !when)) {
      log(`⚠ <${ident}>: ${m.parts ? m.behaviour : `predicate ${m.predicate}`} is outside the CETEIcean tier, model left out`);
      continue;
    }
    const params = {};
    for (const p of m.params) {
      const v = param(p.value);
      if (v === undefined) log(`⚠ <${ident}>: param ${p.name}="${p.value}" is outside the CETEIcean tier, left out`);
      else params[p.name] = v;
    }
    kept.push({ behaviour: m.behaviour, tag: m.tag, when, classes: m.classes, source: m.source, params });
  }
  if (kept.length) models[ident] = kept;
}

const behaviours = `/* tei-ceteicean-behaviours.js — generated from ${basename(oddPath)} by odd-to-ceteicean.mjs${stamp ? `, ${stamp}` : ""} */
${runtime("ceteicean.js")}
const teiModels = ${JSON.stringify(models, null, 1)};
`;

writeOut(outDir, "tei-ceteicean-behaviours.js", behaviours);
mkdirSync(resolve(outDir), { recursive: true });
if (resolve(cssPath) !== resolve(outDir, "edition.css")) copyFileSync(resolve(cssPath), resolve(outDir, "edition.css"));

const entries = [];
for (const teiFile of teiFiles) {
  const tei = readFileSync(resolve(teiFile), "utf-8");
  const page = runtime("ceteicean.html").split("{{behaviours}}").join(behaviours).split("{{tei}}").join(tei.replace(/^<\?xml[^>]*\?>\s*/, ""));
  const pagePath = writeOut(outDir, htmlPageName(teiFile), page);
  log(`✓ ${pagePath} (${Object.keys(models).length} elements)`);
  entries.push({ href: htmlPageName(teiFile), title: extractTeiTitle(parseXmlToXast(tei)) || htmlPageName(teiFile), meta: "CETEIcean (in the browser)" });
}
if (entries.length > 1) {
  writeOut(outDir, "index.html", buildIndexPage({ title: "TEI Edition — CETEIcean", subtitle: `${entries.length} documents · rendered in the browser`, entries }));
}
