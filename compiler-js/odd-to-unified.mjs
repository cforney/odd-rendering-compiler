#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to a unified/xast handler module: for each
 * element its models, in document order, with predicates and params kept as
 * XPath. The module runs on a small runtime that ships beside it
 * (../runtime/pm-runtime.mjs for the behaviours, xpath.mjs for the XPath subset), and its
 * hast output plugs into the unified ecosystem (rehype, Astro, Eleventy).
 *
 * Every predicate and param is compiled here once, so XPath outside the subset
 * fails the build with the element and model named.
 *
 * Usage:  node odd-to-unified.mjs --odd <path> [--out <dir>]
 * Output: <dir>/tei-handlers.mjs (+ pm-runtime.mjs, xpath.mjs); render it with render-unified.mjs
 */

import { copyFileSync } from "fs";
import { resolve, basename, join } from "path";
import { readOdd } from "./odd-parser.mjs";
import { xpath } from "../runtime/xpath.mjs";
import { parseArgs, createLogger, writeOut, generatedStamp } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("odd-to-unified");
const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-unified.mjs --odd <path> [--out <dir>]");
  process.exit(1);
}

log(`Parsing ODD: ${oddPath}`);
const specs = readOdd(resolve(oddPath)).specs.filter((s) => s.models.length);

/** An XPath expression as a call that compiles it when the module loads; checked here first. */
function xp(expr, where) {
  try {
    xpath(expr);
  } catch (e) {
    console.error(`[odd-to-unified] ✗ ${where}: ${e.message}`);
    process.exit(1);
  }
  return `xp(${JSON.stringify(expr)})`;
}

/** One model as a JS object literal. */
function modelJs(m, where, pad) {
  const params = m.params.map((p) => `${JSON.stringify(p.name)}: ${xp(p.value, `${where}, param ${p.name}`)}`);
  const fields = [
    `behaviour: ${JSON.stringify(m.behaviour)}`,
    m.tag && `tag: ${JSON.stringify(m.tag)}`,
    `flow: ${JSON.stringify(m.flow)}`,
    m.output && `output: ${JSON.stringify(m.output)}`,
    m.predicate && `predicate: ${xp(m.predicate, where)}`,
    `params: {${params.length ? ` ${params.join(", ")} ` : ""}}`,
    `classes: ${JSON.stringify(m.classes)}`,
    `source: ${m.source}`,
  ].filter(Boolean);
  if (m.parts) {
    const parts = m.parts.map((p, k) => modelJs(p, `${where}, part ${k + 1}`, pad + "  "));
    fields.push(`parts: [\n${parts.map((p) => `${pad}  ${p},`).join("\n")}\n${pad}]`);
  }
  return `{ ${fields.join(", ")} }`;
}

const table = specs.map((s) => {
  const models = s.models.map((m, k) => `    ${modelJs(m, `<${s.ident}>, model ${k + 1}`, "    ")},`);
  return `  ${JSON.stringify(s.ident)}: [\n${models.join("\n")}\n  ],`;
});

const source = `/**
 * tei-handlers.mjs — generated from ${basename(oddPath)}${stamp ? `, ${stamp}` : ""}
 *
 * The ODD's Processing Model as unified/xast handlers: for each TEI element its
 * models, in document order. pm-runtime.mjs renders by them; teiToHast(tree,
 * { output }) returns { hast, notes }.
 */

import { xpath as xp } from "./xpath.mjs";
import { createRenderer } from "./pm-runtime.mjs";

export const models = {
${table.join("\n")}
};

export const teiToHast = createRenderer(models);
`;

const handlersPath = writeOut(outDir, "tei-handlers.mjs", source);
for (const runtime of ["pm-runtime.mjs", "xpath.mjs"]) {
  copyFileSync(new URL(`../runtime/${runtime}`, import.meta.url), join(outDir, runtime));
}
log(`✓ ${handlersPath} (${specs.length} elements, ${specs.reduce((n, s) => n + s.models.length, 0)} models) + pm-runtime.mjs, xpath.mjs`);
