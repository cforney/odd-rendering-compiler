#!/usr/bin/env node

/**
 * Render the ODD's decisions as data: for each TEI source the render itself as a
 * tree of records, from the runtime's trace, and a side table giving each model
 * that ran its predicate, its <desc> and the ODD it was written in. Downstream
 * tools — a site generator, a search index, a coverage report — read what the
 * ODD decided without re-implementing it.
 *
 * A record is PmRecord in ../runtime/pm-runtime.mjs: { element, model, behaviour,
 * classes, params, parts, outcome, children }; a child is a record, or the text as
 * it renders. Only what the render reached has a record: an element a `content`
 * param leaves out has none, and one it selects twice has two.
 * Predicates and params the XPath subset cannot evaluate are degraded as in the
 * other generators, and listed under `unsupported`.
 *
 * Usage:   node render-json.mjs --odd <path> --tei <path|dir|glob> [--output <name>] [--out <dir>] [--strict]
 * Output:  <dir>/<basename>.json
 * Read by: coverage.mjs (--records), and any tool that wants the decisions as data
 */

import { basename, extname } from "path";
import { allModels, writtenAt, templateTree } from "./odd-parser.mjs";
import { checkXPath, reportUnsupported } from "./unsupported.mjs";
import { createRenderer } from "../runtime/pm-runtime.mjs";
import { xpath } from "../runtime/xpath.mjs";
import { parseArgs, loadOdd, createLogger, writeOut, resolveTeiFiles, readTei } from "./cli.mjs";

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

/** The models as the generated handlers hold them: XPath compiled, templates parsed. */
const compile = (m) => ({
  ...m,
  predicate: m.predicate ? xpath(grammar.predicate(m.predicate), writtenAt(m.id, m)) : undefined,
  params: Object.fromEntries(m.params.map((p) => [p.name, xpath(grammar.param(p.value), writtenAt(m.id, p))])),
  template: m.template && templateTree(m.template),
  parts: m.parts?.map(compile),
});
const models = Object.fromEntries(odd.specs.filter((s) => s.models.length).map((s) => [s.key, s.models.map(compile)]));
const byId = new Map(allModels(odd.specs).map((m) => [m.id, m]));

const teiToHast = createRenderer(models, odd.views);

/** The models a record and those below it ran, a sequence's parts too. */
function collect(record, used) {
  if (record.model) used.add(record.model);
  record.parts?.forEach((id) => used.add(id));
  for (const c of record.children) if (typeof c === "object") collect(c, used);
}

/** What the ODD says of the models a document used, a sequence's parts described with it. */
function describe(used) {
  const table = {};
  const add = (id) => {
    if (table[id]) return;
    const m = byId.get(id);
    table[id] = {
      element: m.element, behaviour: m.behaviour,
      predicate: m.predicate ?? undefined, output: m.output ?? undefined, group: m.group,
      desc: m.label, odd: m.odd, line: m.line,
      parts: m.parts?.map((p) => p.id),
    };
    m.parts?.forEach((p) => add(p.id));
  };
  [...used].sort().forEach(add);
  return table;
}

for (const teiFile of resolveTeiFiles(cli.getAll("--tei").length ? cli.getAll("--tei") : "../examples/simler-*.xml")) {
  const { record: root } = teiToHast(/** @type {any} */ (readTei(teiFile)), { output, trace: true });
  const used = new Set();
  collect(root, used);
  const data = {
    document: basename(teiFile),
    output,
    ...(grammar.entries.length && { unsupported: grammar.entries }),
    models: describe(used),
    root,
  };
  const outFile = writeOut(outDir, `${basename(teiFile, extname(teiFile))}.json`, JSON.stringify(data, null, 2) + "\n");
  log(`✓ ${teiFile} → ${outFile} (${used.size} models ran)`);
}
