#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to a unified/xast handler module: for each
 * element its models, in document order, with predicates and params kept as
 * XPath. The module runs on a small runtime that ships beside it
 * (../runtime/pm-runtime.mjs for the behaviours, xpath.mjs for the XPath subset), and its
 * hast output plugs into the unified ecosystem (rehype, Astro, Eleventy).
 *
 * Every predicate and param is compiled here once. XPath outside the subset is
 * degraded and listed in odd-unsupported.json beside the handlers; `--strict`
 * fails the build instead, with the element and model named.
 *
 * Usage:   node odd-to-unified.mjs --odd <path> [--out <dir>] [--strict]
 * Output:  <dir>/tei-handlers.mjs, with pm-runtime.mjs, xpath.mjs and odd-unsupported.json
 * Read by: render-unified*.mjs and render-plain.mjs (--handlers)
 */

import { copyFileSync } from "fs";
import { basename, join } from "path";
import { parseXml } from "@rgrove/parse-xml";
import { checkXPath, reportUnsupported } from "./unsupported.mjs";
import { parseArgs, loadOdd, createLogger, writeOut, generatedStamp } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("odd-to-unified");
const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-unified.mjs --odd <path> [--out <dir>] [--strict]");
  process.exit(1);
}

log(`Parsing ODD: ${oddPath}`);
const odd = loadOdd(oddPath, "odd-to-unified");
const specs = odd.specs.filter((s) => s.models.length);
const grammar = checkXPath(odd.specs);
reportUnsupported(grammar.entries, { scope: "odd-to-unified", strict: cli.has("--strict") });

/** An XPath expression as a call that compiles it when the module loads, degraded where the subset cannot. */
const xp = (expr, kind) => `xp(${JSON.stringify(grammar[kind](expr))})`;

/** A template as the runtime fills it in: its text as strings, its elements as { name, attributes, children }. */
const tree = (xml) => {
  const node = (n) => (n.type === "element" ? { name: n.name, attributes: n.attributes, children: n.children.map(node) } : n.text);
  return parseXml(`<t>${xml}</t>`).root.children.map(node);
};

/** One model as a JS object literal. */
function modelJs(m, pad) {
  const params = m.params.map((p) => `${JSON.stringify(p.name)}: ${xp(p.value, "param")}`);
  const fields = [
    `behaviour: ${JSON.stringify(m.behaviour)}`,
    m.tag && `tag: ${JSON.stringify(m.tag)}`,
    `flow: ${JSON.stringify(m.flow)}`,
    m.output && `output: ${JSON.stringify(m.output)}`,
    m.predicate && `predicate: ${xp(m.predicate, "predicate")}`,
    `params: {${params.length ? ` ${params.join(", ")} ` : ""}}`,
    `classes: ${JSON.stringify(m.classes)}`,
    `source: ${m.source}`,
    m.template && `template: ${JSON.stringify(tree(m.template))}`,
  ].filter(Boolean);
  if (m.parts) {
    const parts = m.parts.map((p) => modelJs(p, pad + "  "));
    fields.push(`parts: [\n${parts.map((p) => `${pad}  ${p},`).join("\n")}\n${pad}]`);
  }
  return `{ ${fields.join(", ")} }`;
}

const table = specs.map((s) => {
  const models = s.models.map((m) => `    ${modelJs(m, "    ")},`);
  return `  ${JSON.stringify(s.ident)}: [\n${models.join("\n")}\n  ],`;
});

const source = `/**
 * tei-handlers.mjs — generated from ${basename(oddPath)}${stamp ? `, ${stamp}` : ""}
 *
 * The ODD's Processing Model as unified/xast handlers: for each TEI element its
 * models, in document order, and the views laid over the page. pm-runtime.mjs
 * renders by them; teiToHast(tree, { output }) returns { hast, notes, page }.
 */

import { xpath as xp } from "./xpath.mjs";
import { createRenderer } from "./pm-runtime.mjs";

export const models = {
${table.join("\n")}
};

export const views = ${JSON.stringify(odd.views)};

export const teiToHast = createRenderer(models, views);
`;

const handlersPath = writeOut(outDir, "tei-handlers.mjs", source);
writeOut(outDir, "odd-unsupported.json", JSON.stringify(grammar.entries, null, 2) + "\n");
for (const runtime of ["pm-runtime.mjs", "xpath.mjs"]) {
  copyFileSync(new URL(`../runtime/${runtime}`, import.meta.url), join(outDir, runtime));
}
log(`✓ ${handlersPath} (${specs.length} elements, ${specs.reduce((n, s) => n + s.models.length, 0)} models) + pm-runtime.mjs, xpath.mjs`);
