#!/usr/bin/env node

/**
 * Corpus coverage: read the ODD back against the records render-json.mjs wrote,
 * and answer the two questions an ODD author has.
 *
 * What the ODD says that never runs — models no document made fire, models that
 * can never fire because an earlier model of the same output has no predicate,
 * and elements the ODD has models for that no record names. What the corpus
 * holds that the ODD never handles — elements with no model at all, and the
 * silent case: elements whose spec has models of which none applied, which
 * render nothing and warn about nothing.
 *
 * Models a chained ODD wrote are reported apart: they are not this ODD's author's
 * to fix. Inside an `alternate`, leaving a reading unrendered is a decision, not
 * an oversight, so unhandled elements below one are not reported.
 *
 * Coverage is per output: the records say which one they are, and models for
 * another are left out of this run. A sequence counts as the one model the
 * records name; which of its parts fired is not in them.
 *
 * Usage:   node coverage.mjs --odd <path> [--records <path|dir|glob>] [--out <dir>]
 * Output:  <dir>/coverage.json, <dir>/index.html
 * Read by: the ODD's author
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { parseArgs, loadOdd, createLogger, writeOut, resolveInputFiles, buildReportPage } from "./cli.mjs";

/** The models that fired, every element the records name, and the elements no model took. */
function rollUp(records) {
  const fired = new Set();
  const seen = new Set();
  const unhandled = new Map();
  const walk = (r, inAlternate) => {
    seen.add(r.element);
    if (r.model) fired.add(r.model);
    else if (!inAlternate) unhandled.set(r.element, (unhandled.get(r.element) ?? 0) + 1);
    for (const c of r.children) {
      if (typeof c === "object") walk(c, inAlternate || r.behaviour === "alternate");
    }
  };
  for (const { root } of records) walk(root, false);
  return { fired, seen, unhandled };
}

/** Models of a spec an earlier model of the same output already decided, so they can never fire. */
function unreachableIn(spec) {
  const decided = new Map();
  const found = [];
  for (const m of spec.models) {
    const output = m.output ?? "";
    if (decided.has(output)) found.push({ ...m, element: spec.ident, after: decided.get(output) });
    else if (!m.predicate) decided.set(output, m.id);
  }
  return found;
}

/** The coverage of one ODD by one stream of records. */
export function coverage(odd, records, local) {
  const { fired, seen, unhandled } = rollUp(records);
  const output = records[0].output;
  // A model of another output was never up for selection in these records.
  const inRun = (m) => !m.output || m.output === output;
  const specs = odd.specs.filter((s) => s.models.some(inRun));

  const unreachable = odd.specs.flatMap(unreachableIn);
  const blocked = new Set(unreachable.map((m) => m.id));
  const never = specs
    .filter((s) => seen.has(s.ident))
    .flatMap((s) => s.models.filter((m) => inRun(m) && !fired.has(m.id) && !blocked.has(m.id)).map((m) => ({ ...m, element: s.ident })));
  const absent = specs.filter((s) => !seen.has(s.ident)).map((s) => {
    const [first] = s.models.filter(inRun);
    return { element: s.ident, models: s.models.filter(inRun).length, odd: first.odd, line: first.line };
  });

  const entry = (m) => ({ model: m.id, element: m.element, behaviour: m.behaviour, predicate: m.predicate ?? undefined, desc: m.label, odd: m.odd, line: m.line, after: m.after });
  const order = (a, b) => `${a.element} ${a.model ?? ""}`.localeCompare(`${b.element} ${b.model ?? ""}`);
  /** `ours` picks the models this ODD wrote, or those a chained one did. */
  const models = (list, ours) => list.map(entry).filter((e) => (e.odd === local) === ours).sort(order);
  const specced = new Set(specs.map((s) => s.ident));
  const elements = (known) => [...unhandled]
    .filter(([element]) => specced.has(element) === known)
    .map(([element, count]) => ({ element, count }))
    .sort(order);

  return {
    odd: local,
    output,
    documents: records.map((r) => r.document),
    written: {
      never: models(never, true),
      unreachable: models(unreachable, true),
      absent: absent.filter((e) => e.odd === local).sort(order),
    },
    encoded: { unmodelled: elements(false), silent: elements(true) },
    inherited: {
      never: models(never, false),
      unreachable: models(unreachable, false),
      absent: absent.filter((e) => e.odd !== local).sort(order),
    },
  };
}

/** One model, one element, as a line of the report. */
const modelLine = (e) => [
  `<${e.element}> ${e.model} (${e.odd}:${e.line})`,
  e.desc,
  e.predicate && `predicate ${e.predicate}`,
  e.after && `after ${e.after}, which has no predicate`,
].filter(Boolean).join(" — ");
const absentLine = (e) => `<${e.element}> — ${e.models} model(s) in ${e.odd}, no record names it`;

/** The coverage as a page. */
function page({ odd, output, documents, written, encoded, inherited }) {
  return buildReportPage({
    title: `Coverage: ${odd}`,
    lead: `${documents.length} document(s), output ${output}. What the ODD says that never runs, and what the corpus holds that it never handles.`,
    sections: [
      { heading: "Written, never run", note: "No document made these models fire.", items: written.never.map(modelLine) },
      { heading: "Written, unreachable", note: "An earlier model of the same output has no predicate, so these can never be reached.", items: written.unreachable.map(modelLine) },
      { heading: "Never exercised", note: "The ODD has models for these elements; no record names them.", items: written.absent.map(absentLine) },
      { heading: "Encoded, unmodelled", note: "In the corpus with no model in the ODD, so rendered as their content.", items: encoded.unmodelled.map((e) => `<${e.element}> — ${e.count}×`) },
      { heading: "Encoded, silent", note: "A spec with models, none of which applied: no output, and no warning.", items: encoded.silent.map((e) => `<${e.element}> — ${e.count}×`) },
      { heading: "From a chained ODD", note: "Reported apart: not this ODD's to fix.", items: [...inherited.never, ...inherited.unreachable].map(modelLine).concat(inherited.absent.map(absentLine)) },
    ],
  });
}

// --- CLI ---
const cli = parseArgs();
const log = createLogger("coverage");
const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output/coverage";

if (!oddPath) {
  console.error("Usage: node coverage.mjs --odd <path> [--records <path|dir|glob>] [--out <dir>]");
  process.exit(1);
}

const files = resolveInputFiles(cli.getAll("--records").length ? cli.getAll("--records") : "output/json/*.json", ".json");
const records = files.map((f) => JSON.parse(readFileSync(resolve(f), "utf8")));
if (!records.length) {
  console.error("[coverage] ✗ no records found — run render-json.mjs first");
  process.exit(1);
}
if (new Set(records.map((r) => r.output)).size > 1) {
  console.error("[coverage] ✗ the records mix outputs; coverage reads one output at a time");
  process.exit(1);
}

const report = coverage(loadOdd(oddPath, "coverage"), records, basename(oddPath));
const { written, encoded, inherited } = report;
log(`${report.documents.length} document(s), output ${report.output}`);
log(`  the ODD: ${written.never.length} model(s) never run, ${written.unreachable.length} unreachable, ${written.absent.length} element(s) not exercised`);
log(`  the corpus: ${encoded.unmodelled.length} element(s) with no model, ${encoded.silent.length} with a spec but no model applied`);
log(`  from a chained ODD: ${inherited.never.length + inherited.unreachable.length + inherited.absent.length} finding(s)`);
writeOut(outDir, "index.html", page(report));
log(`✓ ${writeOut(outDir, "coverage.json", JSON.stringify(report, null, 2) + "\n")}`);
