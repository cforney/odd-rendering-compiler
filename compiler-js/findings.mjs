#!/usr/bin/env node

/**
 * Build-time findings: what the ODD does not foresee in the encoding.
 *
 * A root element outside the TEI namespace. In a document's text: attribute values outside the ODD's value lists,
 * renditions it does not declare, elements it has no model for, note ranges
 * (@targetEnd) whose start is missing and anchors no range starts at, and page
 * images without the IIIF manifest to resolve them (by the root's model for
 * output "page"). In the ODD: custom properties its CSS reads but nothing
 * defines. Each finding is printed; each document gets a page,
 * <dir>/<basename>.html, and all of them <dir>/findings.json.
 *
 * Usage:   node findings.mjs --odd <path> --tei <path|dir|glob> [--tokens <css>] [--out <dir>]
 * Output:  <dir>/<basename>.html, <dir>/findings.json
 * Read by: the ODD's author
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { pathToFileURL } from "url";
import { parseXmlToXast, pageOf, allModels } from "./odd-parser.mjs";
import { checkXPath } from "./unsupported.mjs";
import { parseArgs, loadOdd, createLogger, writeOut, resolveTeiFiles, htmlPageName, buildReportPage } from "./cli.mjs";

/** Custom properties the ODD's CSS reads that neither the tokens, the ODD's CSS nor a `--…` param defines. */
export function undefinedProperties({ specs, renditions }, tokens = "") {
  const css = [...renditions, ...specs.flatMap((s) => s.rules)].map((r) => r.css).join("\n");
  const names = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
  const params = allModels(specs).flatMap((m) => m.params);
  const defined = new Set([...names(`${tokens}\n${css}`, /(--[\w-]+)\s*:/g), ...params.map((p) => p.name)]);
  return [...new Set(names(css, /var\(\s*(--[\w-]+)/g))].filter((name) => !defined.has(name));
}

/** The findings in one document's text, each once, with a count where it recurs. */
export function documentFindings({ specs, renditions }, tree) {
  const found = [];
  const spec = Object.fromEntries(specs.map((s) => [s.key, s]));
  const declared = new Set(renditions.map((r) => r.id));
  const all = [];
  (function walk(node, up) {
    if (node.type !== "element") return;
    all.push({ node, up });
    node.children.forEach((c) => walk(c, [...up, node]));
  })(tree.children.find((n) => n.type === "element"), []);

  if (all[0].node.name.startsWith("{")) found.push(`Root element not in the TEI namespace, so no model applies: <${all[0].node.name}>`);
  const inText = all.filter(({ node, up }) => node.name === "text" || up.some((a) => a.name === "text"));
  for (const { node } of inText) {
    const { models = [], values = {} } = spec[node.name] ?? {};
    if (!models.length) found.push(`No model in the ODD, rendered as its content: <${node.name}>`);
    for (const [name, value] of Object.entries(node.attributes)) {
      if (values[name] && !values[name].includes(value)) found.push(`Value not in the ODD's list: <${node.name}> ${name}="${value}"`);
    }
    for (const r of (node.attributes.rendition ?? "").split(/\s+/).filter(Boolean)) {
      if (!declared.has(r.replace(/^#/, ""))) found.push(`Rendition not declared in the ODD: ${r}`);
    }
  }

  const ids = new Set(all.map(({ node }) => node.attributes["xml:id"]).filter(Boolean));
  const ends = inText.flatMap(({ node }) => (node.attributes.targetEnd ?? "").split(/\s+/).filter(Boolean).map((t) => t.replace(/^#/, "")));
  for (const end of ends) if (!ids.has(end)) found.push(`Note range without its start: targetEnd="${end}"`);
  for (const { node } of inText) {
    const id = node.attributes["xml:id"];
    if (node.name === "anchor" && id && !ends.includes(id)) found.push(`Anchor no note range starts at: ${id}`);
  }

  const { pages = [], manifest = [] } = pageOf(specs, tree);
  if (pages.length && !manifest.some(Boolean)) found.push("Page images without a IIIF manifest to resolve them");

  const counts = new Map();
  for (const f of found) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts].map(([f, n]) => (n > 1 ? `${n}× ${f}` : f));
}

/** A findings page for one document. */
const page = (file, own, odd) => buildReportPage({
  title: `Findings: ${file}`,
  lead: "What the ODD does not foresee, found at build time.",
  sections: [{ heading: "In the document", items: own }, { heading: "In the ODD", items: odd }],
});

// --- CLI ---
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const cli = parseArgs();
  const log = createLogger("findings");
  const oddPath = cli.get("--odd");
  const outDir = cli.get("--out") || "output/findings";
  if (!oddPath) {
    console.error("Usage: node findings.mjs --odd <path> --tei <path|dir|glob> [--tokens <css>] [--out <dir>]");
    process.exit(1);
  }
  const odd = loadOdd(oddPath, "findings");
  const tokens = cli.get("--tokens") ? readFileSync(resolve(cli.get("--tokens")), "utf8") : "";
  const oddFindings = [
    ...undefinedProperties(odd, tokens).map((name) => `Custom property defined nowhere: var(${name})`),
    ...checkXPath(odd.specs).entries.map((e) => `XPath outside the subset, degraded: <${e.element}> ${e.where} "${e.expression}" (${e.odd}:${e.line})`),
  ];
  for (const f of oddFindings) log(`  ${basename(oddPath)}: ${f}`);

  const report = { odd: oddFindings, documents: {} };
  for (const teiFile of resolveTeiFiles(cli.getAll("--tei").length ? cli.getAll("--tei") : "../examples/simler-*.xml")) {
    const own = documentFindings(odd, parseXmlToXast(readFileSync(resolve(teiFile), "utf8")));
    report.documents[basename(teiFile)] = own;
    log(`${basename(teiFile)}: ${own.length ? `${own.length} finding(s)` : "no findings"}`);
    for (const f of own) log(`  ${f}`);
    writeOut(outDir, htmlPageName(teiFile), page(basename(teiFile), own, oddFindings));
  }
  writeOut(outDir, "findings.json", JSON.stringify(report, null, 2) + "\n");
}
