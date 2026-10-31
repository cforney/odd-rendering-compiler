#!/usr/bin/env node

/**
 * Render each TEI source's output "plain", the search text, through the handlers
 * from odd-to-unified.mjs: as text, <basename>.txt, and for all sources as
 * Pagefind custom records, records.json ({ url, content, language, meta }).
 * What the text leaves out is the ODD's to say, by its models for "plain"; here
 * only the line breaks are decided: a block, or any element but a span or a
 * link, stands on lines of its own.
 *
 * Usage:   node render-plain.mjs --handlers <path> --tei <path|dir|glob> [--lang <code>] [--out <dir>]
 * Output:  <dir>/<basename>.txt, <dir>/records.json
 * Read by: Pagefind, as custom records
 */

import { readFileSync } from "fs";
import { resolve, basename, extname } from "path";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import { parseArgs, createLogger, writeOut, loadHandlers, resolveTeiFiles, htmlPageName } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("render-plain");
const handlersPath = cli.get("--handlers") || "output/tei-handlers.mjs";
const teiArg = cli.getAll("--tei");
const lang = cli.get("--lang");
const outDir = cli.get("--out") || "output/plain";

const teiToHast = await loadHandlers(handlersPath);

/** The text of hast, a block or any element but a span or a link on lines of its own. */
function textOf(node) {
  if (node.type === "text") return node.value;
  const inner = (node.children ?? []).map(textOf).join("");
  const line = node.type === "element" && (!["span", "a"].includes(node.tagName) || node.properties.className?.includes("pm-block"));
  return line ? `\n${inner}\n` : inner;
}

const records = [];
for (const teiFile of resolveTeiFiles(teiArg.length ? teiArg : "../examples/simler-*.xml")) {
  const tree = parseXmlToXast(readFileSync(resolve(teiFile), "utf8"));
  const { hast, page } = teiToHast(tree, { output: "plain" });
  const text = textOf(hast).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const outFile = writeOut(outDir, `${basename(teiFile, extname(teiFile))}.txt`, text + "\n");
  log(`✓ ${teiFile} → ${outFile} (${text.split(/\s+/).length} words)`);
  records.push({
    url: htmlPageName(teiFile),
    content: text.replace(/\n/g, " "),
    ...(lang && { language: lang }),
    meta: { title: page.title?.[0] || extractTeiTitle(tree) || basename(teiFile) },
  });
}
log(`✓ ${writeOut(outDir, "records.json", JSON.stringify(records, null, 2) + "\n")} (Pagefind custom records)`);
