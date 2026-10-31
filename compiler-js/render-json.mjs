#!/usr/bin/env node

/**
 * Render the ODD's decisions as data: for each TEI source a tree of records,
 * every element naming the model the Processing Model chose for it, and a side
 * table giving each of those models its predicate, its <desc> and the ODD it
 * was written in. Downstream tools — a site generator, a search index, a
 * coverage report — read what the ODD decided without re-implementing it.
 *
 * A record is { element, model, behaviour, classes, params, children }; a child
 * is a record, or the text as it renders. An element the ODD has no model for
 * keeps its record with `model: null`, and what a model omits has no children.
 * Predicates and params the XPath subset cannot evaluate are degraded as in the
 * other generators, and listed under `unsupported`.
 *
 * Usage:   node render-json.mjs --odd <path> --tei <path|dir|glob> [--output <name>] [--out <dir>] [--strict]
 * Output:  <dir>/<basename>.json
 * Read by: coverage.mjs (--records), and any tool that wants the decisions as data
 */

import { readFileSync } from "fs";
import { resolve, basename, extname } from "path";
import { parseXmlToXast, allModels } from "./odd-parser.mjs";
import { checkXPath, reportUnsupported } from "./unsupported.mjs";
import { createResolver } from "../runtime/pm-runtime.mjs";
import { xpath, seq, str } from "../runtime/xpath.mjs";
import { parseArgs, loadOdd, createLogger, writeOut, resolveTeiFiles } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("render-json");
const oddPath = cli.get("--odd");
const output = cli.get("--output") || "web";
const outDir = cli.get("--out") || "output/json";

if (!oddPath) {
  console.error("Usage: node render-json.mjs --odd <path> --tei <path|dir|glob> [--output <name>] [--out <dir>]");
  process.exit(1);
}

const odd = loadOdd(oddPath, "render-json");
const grammar = checkXPath(odd.specs);
reportUnsupported(grammar.entries, { scope: "render-json", strict: cli.has("--strict") });

/** The models with their XPath compiled, as the generated handlers hold them. */
const compile = (m) => ({
  ...m,
  predicate: m.predicate ? xpath(grammar.predicate(m.predicate)) : undefined,
  params: Object.fromEntries(m.params.map((p) => [p.name, xpath(grammar.param(p.value))])),
  parts: m.parts?.map(compile),
});
const models = Object.fromEntries(odd.specs.filter((s) => s.models.length).map((s) => [s.ident, s.models.map(compile)]));
const byId = new Map(allModels(odd.specs).map((m) => [m.id, m]));

const { modelOf, renderedText } = createResolver(models, output, output === "web" ? odd.views : []);
const localName = (qname) => qname.slice(qname.indexOf(":") + 1);
/** Behaviours that render nothing, so the record stops there too. */
const SILENT = ["omit", "metadata"];

/** One element as a record; `used` collects the models the document made fire. */
function record(pos, used) {
  const { node, up } = pos;
  const element = localName(node.name);
  const model = modelOf(pos);
  if (model) used.add(model.id);
  const params = Object.fromEntries(Object.entries(model?.params ?? {}).map(([name, f]) => [name, seq(f(pos)).map((item) => str([item]))]));
  const children = SILENT.includes(model?.behaviour) ? [] : (node.children ?? [])
    .filter((c) => c.type === "element" || c.type === "text")
    .map((c) => ({ node: c, up: [...up, node] }))
    .map((c) => (c.node.type === "text" ? renderedText(c) : record(c, used)))
    .filter((c) => c !== "");
  return {
    element,
    model: model?.id ?? null,
    behaviour: model?.behaviour ?? null,
    classes: [`tei-${element}`, ...(model?.classes ?? [])],
    ...(Object.keys(params).length && { params }),
    children,
  };
}

/** What the ODD says of the models a document used, a sequence's parts described with it. */
function describe(used) {
  const table = {};
  const add = (id) => {
    if (table[id]) return;
    const m = byId.get(id);
    table[id] = {
      element: m.element, behaviour: m.behaviour,
      predicate: m.predicate ?? undefined, output: m.output ?? undefined,
      desc: m.label, odd: m.odd, line: m.line,
      parts: m.parts?.map((p) => p.id),
    };
    m.parts?.forEach((p) => add(p.id));
  };
  [...used].sort().forEach(add);
  return table;
}

for (const teiFile of resolveTeiFiles(cli.getAll("--tei").length ? cli.getAll("--tei") : "../examples/simler-*.xml")) {
  const tree = parseXmlToXast(readFileSync(resolve(teiFile), "utf8"));
  const used = new Set();
  const root = record({ node: tree.children.find((n) => n.type === "element"), up: [] }, used);
  const data = {
    document: basename(teiFile),
    output,
    ...(grammar.entries.length && { unsupported: grammar.entries }),
    models: describe(used),
    root,
  };
  const outFile = writeOut(outDir, `${basename(teiFile, extname(teiFile))}.json`, JSON.stringify(data, null, 2) + "\n");
  log(`✓ ${teiFile} → ${outFile} (${used.size} models fired)`);
}
