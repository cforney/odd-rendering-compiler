#!/usr/bin/env node

/**
 * Islands variant of render-unified.mjs. The static body is produced exactly as
 * render-unified does (same tei-handlers.mjs); only the *enhancement* differs:
 * each interactive region is wrapped in a <tei-island> custom element, and one
 * tiny generic runtime (islands-runtime.js) hydrates each region on demand. No
 * framework, no per-element components — the principled generalisation of the
 * petite-vue and vanilla-JS interactive tiers (see islands-runtime.js for the
 * model, which mirrors Astro's <astro-island> + client:* directives).
 *
 * --tei accepts the same inputs as the other renderers, with the same pages.
 *
 * Usage: node render-unified-islands.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut, toHtml, loadHandlers,
  resolveInputFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("render-islands");

const handlersPath = cli.get("--handlers") || "output/tei-handlers.mjs";
const teiArg       = cli.getAll("--tei");
const cssPath      = cli.get("--css")      || "output/edition.css";
const outDir       = cli.get("--out")      || "output";

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-*.xml");
const multi = teiFiles.length > 1;

const teiToHast = await loadHandlers(handlersPath);

let editionCss = "";
try { editionCss = readFileSync(resolve(cssPath), "utf-8"); }
catch { log(`⚠ edition.css not found at ${cssPath} — the edition will be unstyled`); }

// The generic runtime ships verbatim beside the page as tei-islands.js.
const runtime = readFileSync(new URL("islands-runtime.js", import.meta.url), "utf-8");

// ---------------------------------------------------------------------------
// Mark interactive regions as islands. The static markup inside stays intact, so
// the page reads with no JavaScript; the runtime upgrades each wrapper on demand.
// ---------------------------------------------------------------------------
const island = (type, on, child) =>
  ({ type: "element", tagName: "tei-island", properties: { type, on }, children: [child] });

function markIslands(node) {
  if (node.type !== "element") return node;
  const cls = node.properties?.className || [];
  if (cls.includes("tei-note-ref")) return island("note", "visible", node);
  if (cls.includes("tei-alternate")) return island("choice", "visible", node);
  node.children = node.children.map(markIslands);
  return node;
}

// ---------------------------------------------------------------------------
// Render one TEI document → a progressively-enhanced islands page.
// ---------------------------------------------------------------------------
function renderPage(teiFile) {
  const xastTree = parseXmlToXast(readFileSync(resolve(teiFile), "utf-8"));
  const { hast, notes } = teiToHast(xastTree);
  const htmlBody = toHtml(markIslands(hast));
  const title = extractTeiTitle(xastTree);

  const html = `<!DOCTYPE html>
<html lang="en" data-mode="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Islands Rendering — TEI Edition (Web Components)</title>

  <!-- ODD-generated stylesheet (odd-to-css.mjs): the static floor this islands
       layer progressively enhances. Inlined for a self-contained file. -->
  <style id="edition-css">
${editionCss}
  </style>

  <style>
    /* Demo page chrome (the preview page, not the edition). */
    body { font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
      max-width: 42em; margin: 2em auto; padding: 0 1em;
      background: #fefefe; color: #222; line-height: 1.7; }
    .render-info { font-family: system-ui, sans-serif; background: #d1fae5;
      border: 1px solid #34d399; padding: 1em; border-radius: 6px;
      margin-bottom: 2em; font-size: 0.85em; }
    .render-info h3 { margin: 0 0 0.5em; color: #059669; }
    .render-info code { background: #ecfdf5; padding: 0.1em 0.3em; border-radius: 3px; }

    /* Island wrappers are transparent to layout, like Astro's <astro-island>. */
    tei-island { display: contents; }

    /* Note: a footnote anchor without JS; an inline toggle once hydrated. The
       collected footnotes show by default and retire only when JS is present. */
    .tei-note-body { display: block; }
    html.islands .tei-footnotes { display: none; }
    .tei-note-ref { color: #059669; text-decoration: none; cursor: pointer; }
    .tei-note-ref:hover { text-decoration: underline; }
    .tei-note-inline { display: none; }
    tei-island.open .tei-note-inline { display: inline; background: #ecfdf5;
      border: 1px solid #a7f3d0; padding: 0.15em 0.4em; border-radius: 4px;
      margin-left: 0.25em; font-size: 0.9em; }

    /* Choice/apparatus toggle (interactive only once hydrated). */
    tei-island[type="choice"][data-hydrated] .tei-alternate {
      border-bottom: 1px dotted #999; cursor: pointer; }
    .tei-alternate-alt { color: #b91c1c; }
  </style>
</head>
<body>

  <div class="render-info">
    <h3>Islands Rendering Path (Web Components)</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-unified.mjs</code> →
      tei-handlers.mjs → xast → hast → HTML + <code>&lt;tei-island&gt;</code> markers</p>
    <p>The static body is unchanged; interactive regions are wrapped in
      <code>&lt;tei-island&gt;</code> custom elements that one ~2 KB generic runtime
      hydrates on demand (<code>on="load|idle|visible|media()"</code>). Only marked
      regions ship behaviour, and only when needed. Without JavaScript the content
      stays fully readable.</p>
  </div>

  ${htmlBody}

  <!-- The generic island runtime — self-hosted, framework-free. -->
  <script src="tei-islands.js" defer></script>

</body>
</html>`;

  return { html, notes, title };
}

// ---------------------------------------------------------------------------
// Render each input; ship the runtime; in multi-file mode also emit an index.
// ---------------------------------------------------------------------------
writeOut(outDir, "tei-islands.js", runtime);

const indexEntries = [];
for (const teiFile of teiFiles) {
  const { html, notes, title } = renderPage(teiFile);
  const pageName = htmlPageName(teiFile);
  const outFile = writeOut(outDir, pageName, html);
  log(`✓ ${teiFile} → ${outFile}`);
  indexEntries.push({ href: pageName, title: title || pageName, meta: `${notes.length} note(s) · islands` });
}

if (multi) {
  const indexFile = writeOut(outDir, "index.html", buildIndexPage({
    title: "TEI Edition — unified/xast + islands (Web Components)",
    subtitle: `${teiFiles.length} documents · prebuilt HTML, ~2 KB generic runtime, degrades to zero-JS`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}

log(`  Generic island runtime hydrates only the marked regions, on demand`);
