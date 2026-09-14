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
 * --tei accepts the same inputs as the other renderers; one input →
 * rendered-unified-islands.html, several → per-source pages + index.
 *
 * Usage: node render-unified-islands.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]
 */

import { readFileSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut, escapeHtml as esc,
  resolveInputFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const cli = parseArgs();
const log = createLogger("render-islands");

const handlersPath = cli.get("--handlers") || "output/tei-handlers.mjs";
const teiArg       = cli.getAll("--tei");
const cssPath      = cli.get("--css")      || "output/edition.css";
const outDir       = cli.get("--out")      || "output";

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-poem.xml");
const multi = teiFiles.length > 1;

// ---------------------------------------------------------------------------
// Import the generated handlers (copied to temp to dodge the # in the path).
// ---------------------------------------------------------------------------
const tempDir = join(tmpdir(), `odd-islands-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
copyFileSync(resolve(handlersPath), join(tempDir, "tei-handlers.mjs"));

let teiToHast;
try {
  const mod = await import(`file:///${join(tempDir, "tei-handlers.mjs").replace(/\\/g, "/")}`);
  teiToHast = mod.teiToHast;
  if (!teiToHast) throw new Error("teiToHast not exported");
} catch (e) {
  console.error(`[render-islands] ✗ Failed to import handlers: ${e.message}`);
  process.exit(1);
}

let editionCss = "";
try { editionCss = readFileSync(resolve(cssPath), "utf-8"); }
catch { log(`⚠ edition.css not found at ${cssPath} — the edition will be unstyled`); }

// The generic runtime ships verbatim beside the page as tei-islands.js.
const runtime = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "islands-runtime.js"), "utf-8");

// ---------------------------------------------------------------------------
// Serialise hast → HTML (custom-element and data-* attributes pass through).
// ---------------------------------------------------------------------------
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

function serialize(node) {
  if (!node) return "";
  if (node.type === "text") return esc(node.value || "");
  if (node.type === "root") return (node.children || []).map(serialize).join("");
  if (node.type !== "element") return "";
  const props = node.properties || {};
  const attrs = [];
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === "className") {
      const cls = Array.isArray(val) ? val.join(" ") : val;
      if (cls) attrs.push(`class="${esc(cls)}"`);
    } else if (val === true) attrs.push(key);
    else attrs.push(`${key}="${esc(String(val))}"`);
  }
  const attrStr = attrs.length ? " " + attrs.join(" ") : "";
  if (VOID_ELEMENTS.has(node.tagName)) return `<${node.tagName}${attrStr}>`;
  return `<${node.tagName}${attrStr}>${(node.children || []).map(serialize).join("")}</${node.tagName}>`;
}

// ---------------------------------------------------------------------------
// Mark interactive regions as islands. The static markup inside stays intact, so
// the page reads with no JavaScript; the runtime upgrades each wrapper on demand.
// ---------------------------------------------------------------------------
const island = (type, on, child) =>
  ({ type: "element", tagName: "tei-island", properties: { type, on }, children: [child] });

function markIslands(node, ctx) {
  if (!node || node.type === "text") return node;
  if (node.type === "root") { node.children = (node.children || []).map((c) => markIslands(c, ctx)); return node; }
  if (node.type !== "element") return node;
  const cls = node.properties?.className || [];
  if (cls.includes("tei-pb")) ctx.hasFacs = true;
  if (cls.includes("tei-note-ref")) return island("note", "visible", node);
  if (cls.includes("tei-alternate")) return island("choice", "visible", node);
  if (node.children) node.children = node.children.map((c) => markIslands(c, ctx));
  return node;
}

// ---------------------------------------------------------------------------
// Render one TEI document → a progressively-enhanced islands page.
// ---------------------------------------------------------------------------
function renderPage(teiFile) {
  const teiSrc = readFileSync(resolve(teiFile), "utf-8");
  const xastTree = parseXmlToXast(teiSrc);
  const inputTree = (xastTree.type === "root" && xastTree.children)
    ? xastTree.children.find((c) => c.type === "element") || xastTree
    : xastTree;

  const { hast, notes } = teiToHast(inputTree);
  const ctx = { hasFacs: false };
  markIslands(hast, ctx);
  const htmlBody = serialize(hast);
  const title = extractTeiTitle(xastTree);
  const facsIsland = ctx.hasFacs ? `<tei-island type="facsimile" on="load"></tei-island>\n    ` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
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

    /* Facsimile thumbnails + the injected show/hide control. Reset the colliding
       .tei-pb floor rules that also land on this <a>/<figure>. */
    a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px;
      margin: 1.2em auto; padding: 4px; border: 1px solid #ccc; background: #fafafa; line-height: 0; }
    a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none; margin: 0; border: 0; }
    a.tei-pb img { display: block; width: 100%; height: auto; }
    [data-edition].facs-hidden a.tei-pb { display: none; }
    .facs-toggle-btn { font: inherit; font-family: system-ui, sans-serif; font-size: 0.85em;
      cursor: pointer; padding: 0.3em 0.8em; margin: 0 0 1.2em;
      border: 1px solid #c7c7c7; border-radius: 4px; background: #f3f3f3; }
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

  <div data-edition>
    ${facsIsland}${htmlBody}
  </div>

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
  const pageName = multi ? htmlPageName(teiFile) : "rendered-unified-islands.html";
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

try { rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }
log(`  Generic island runtime hydrates only the marked regions, on demand`);
