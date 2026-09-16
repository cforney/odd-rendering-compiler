#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to CETEIcean behaviours plus a
 * self-contained page per TEI source that renders it in the browser.
 *
 * CETEIcean (https://github.com/TEIC/CETEIcean) registers TEI elements as
 * `tei-` custom elements and applies behaviours to them. The behaviours are the
 * runtime ../runtime/ceteicean.js, which chooses each element's model with the
 * unified handlers' own runtime and XPath (pm-runtime.mjs, xpath.mjs). All
 * three are inlined as classic scripts, so a page also works from file://; the
 * ODD's models follow as JSON, with predicates and params as XPath, then its
 * views.
 *
 * --tei takes the renderers' inputs: each source gives a page <basename>.html,
 * several also an index.html. The pages link edition.css, which --css copies
 * beside them.
 *
 * XPath outside the subset is degraded, as it is for the unified handlers, and
 * listed in odd-unsupported.json beside the pages; `--strict` fails the build.
 *
 * Usage:   node odd-to-ceteicean.mjs --odd <path> --tei <path|dir|glob> [--css <path>] [--out <dir>] [--strict]
 * Outputs: <dir>/tei-ceteicean-behaviours.js, <dir>/<basename>.html, <dir>/edition.css,
 *          <dir>/odd-unsupported.json
 */

import { readFileSync, copyFileSync, mkdirSync } from "fs";
import { resolve, basename } from "path";
import { readOdd, parseXmlToXast, extractTeiTitle, pageOf } from "./odd-parser.mjs";
import { checkXPath, reportUnsupported } from "./unsupported.mjs";
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
const odd = readOdd(resolve(oddPath));
const specs = odd.specs;
const grammar = checkXPath(specs);
reportUnsupported(grammar.entries, { scope: "odd-to-ceteicean", strict: cli.has("--strict") });
const runtime = (name) => readFileSync(new URL(`../runtime/${name}`, import.meta.url), "utf8");

/** An ES module of the runtime as a classic script, `var <name> = { its exports }`; its import reads `from`. */
function script(file, name, from) {
  const src = runtime(file);
  const exports = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^import (\{[^}]*\}) from .*$/m, `const $1 = ${from};`).replace(/^export /gm, "");
  return `var ${name} = (function () {\n${body}\nreturn { ${exports.join(", ")} };\n})();`;
}

/** A model as JSON: its behaviour, classes and flow, with predicate and params as XPath. */
const json = (m) => ({
  behaviour: m.behaviour, tag: m.tag, flow: m.flow,
  predicate: m.predicate ? grammar.predicate(m.predicate) : undefined, output: m.output ?? undefined,
  params: Object.fromEntries(m.params.map((p) => [p.name, grammar.param(p.value)])),
  classes: m.classes, source: m.source,
  parts: m.parts?.map(json),
});
const models = Object.fromEntries(specs.filter((s) => s.models.length).map((s) => [s.ident, s.models.map(json)]));

const behaviours = `/* tei-ceteicean-behaviours.js — generated from ${basename(oddPath)} by odd-to-ceteicean.mjs${stamp ? `, ${stamp}` : ""} */
${script("xpath.mjs", "teiXpath")}
${script("pm-runtime.mjs", "teiPm", "teiXpath")}
${runtime("ceteicean.js")}
const teiModels = ${JSON.stringify(models, null, 1)};
const teiViews = ${JSON.stringify(odd.views)};
`;

writeOut(outDir, "tei-ceteicean-behaviours.js", behaviours);
writeOut(outDir, "odd-unsupported.json", JSON.stringify(grammar.entries, null, 2) + "\n");
mkdirSync(resolve(outDir), { recursive: true });
if (resolve(cssPath) !== resolve(outDir, "edition.css")) copyFileSync(resolve(cssPath), resolve(outDir, "edition.css"));

const entries = [];
for (const teiFile of teiFiles) {
  const tei = readFileSync(resolve(teiFile), "utf-8");
  const page = runtime("ceteicean.html").split("{{behaviours}}").join(behaviours).split("{{notes}}").join(runtime("notes.js")).split("{{tei}}").join(tei.replace(/^<\?xml[^>]*\?>\s*/, ""));
  const pagePath = writeOut(outDir, htmlPageName(teiFile), page);
  log(`✓ ${pagePath} (${Object.keys(models).length} elements)`);
  const tree = parseXmlToXast(tei);
  entries.push({ href: htmlPageName(teiFile), title: extractTeiTitle(tree) || htmlPageName(teiFile), meta: "CETEIcean (in the browser)", page: pageOf(specs, tree) });
}
if (entries.length > 1) {
  writeOut(outDir, "index.html", buildIndexPage({ title: "TEI Edition — CETEIcean", subtitle: `${entries.length} documents · rendered in the browser`, entries }));
}
