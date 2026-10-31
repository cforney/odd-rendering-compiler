#!/usr/bin/env node

/**
 * Render TEI XML to static HTML through the handlers from odd-to-unified.mjs:
 * the TEI is parsed into xast, the generated teiToHast() turns it into hast, and
 * the result is serialised. The ODD-generated edition.css (odd-to-css.mjs) is
 * inlined, so all element styling comes from the ODD; this script owns only the
 * page chrome and the note scaffolding.
 *
 * --tei takes a file, a directory, a glob, a comma-separated list, or repeated
 * flags. Each source gives <basename>.html; several also an index.html. --output names the PM output to render (default web).
 *
 * Usage:   node render-unified.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>] [--output <name>]
 * Output:  <dir>/<basename>.html, and for several sources <dir>/index.html
 * Read by: a browser
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut, toHtml, loadHandlers, readTei,
  resolveTeiFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("render-unified");

const handlersPath = cli.get("--handlers") || "output/tei-handlers.mjs";
const teiArg       = cli.getAll("--tei");
const cssPath      = cli.get("--css")      || "output/edition.css";
const outDir       = cli.get("--out")      || "output";
const output       = cli.get("--output")   || "web";

const teiFiles = resolveTeiFiles(teiArg.length ? teiArg : "../examples/simler-*.xml");
const multi = teiFiles.length > 1;

const teiToHast = await loadHandlers(handlersPath);

let editionCss = "";
try {
  editionCss = readFileSync(resolve(cssPath), "utf-8");
} catch {
  log(`⚠ edition.css not found at ${cssPath} — run odd-to-css.mjs first; the edition will be unstyled`);
}

/** Render one TEI document → a self-contained HTML page. */
function renderPage(teiFile) {
  const tree = readTei(teiFile);
  const { hast, notes, page } = teiToHast(tree, { output });

  const html = `<!DOCTYPE html>
<html lang="en" data-mode="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>unified/xast Rendering — TEI Edition</title>

  <!-- ODD-generated stylesheet (odd-to-css.mjs), inlined for a self-contained file. -->
  <style id="edition-css">
${editionCss}
  </style>

  <style>
    /* Page chrome, not the edition. */
    body {
      font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
      max-width: 42em; margin: 2em auto; padding: 0 1em;
      background: #fefefe; color: #222; line-height: 1.7;
    }
    .render-info {
      font-family: system-ui, sans-serif;
      background: #fef3c7; border: 1px solid #fbbf24;
      padding: 1em; border-radius: 6px; margin-bottom: 2em;
      font-size: 0.85em;
    }
    .render-info h3 { margin: 0 0 0.5em; color: #d97706; }
    .render-info code { background: #fef9c3; padding: 0.1em 0.3em; border-radius: 3px; }

    /* Apparatus scaffolding the renderer adds; not TEI elements. Notes: edition.css. */
    .tei-alternate-alt[hidden] { display: none; }
  </style>
</head>
<body>
  <div class="render-info">
    <h3>unified/xast Rendering Path</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-unified.mjs</code> →
      tei-handlers.mjs → xast → hast → HTML (build time, Node.js)</p>
    <p>Each element takes the first of its ODD models whose predicate holds;
      predicates and params are XPath, evaluated at build time. The output plugs
      into the unified ecosystem (rehype, Astro, Eleventy content layers).</p>
  </div>
  ${toHtml(hast)}
</body>
</html>`;

  return { html, notes, title: extractTeiTitle(tree), page };
}

const indexEntries = [];
for (const teiFile of teiFiles) {
  const { html, notes, title, page } = renderPage(teiFile);
  const pageName = htmlPageName(teiFile);
  const outFile = writeOut(outDir, pageName, html);
  log(`✓ ${teiFile} → ${outFile} (${notes.length} note(s))`);
  indexEntries.push({ href: pageName, title: title || pageName, meta: `${notes.length} note(s)`, page });
}

if (multi) {
  const indexFile = writeOut(outDir, "index.html", buildIndexPage({
    title: "TEI Edition — unified/xast (prebuilt, zero-JS)",
    subtitle: `${teiFiles.length} documents · prebuilt static HTML, no server required`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}
