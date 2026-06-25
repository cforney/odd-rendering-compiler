#!/usr/bin/env node

/**
 * Render TEI XML to HTML through the unified/xast handlers from
 * odd-to-unified.mjs. The TEI is parsed with @rgrove/parse-xml (the parser
 * unified's xast-util-from-xml uses) into an xast tree, the generated
 * teiToHast() converts it to hast, and the result is serialised with
 * hast-util-to-html if installed, else a built-in serialiser.
 *
 * The ODD-generated edition.css (odd-to-css.mjs) is inlined, so element styling
 * comes from the ODD; this script owns only the page chrome and the scaffolding
 * classes it synthesises (footnote refs/bodies, choice toggles), which aren't
 * TEI elements.
 *
 * --tei takes a file, a directory, a glob, a comma-separated list, or repeated
 * flags. One input → rendered-unified.html; several → one <basename>.html per
 * source plus an index.html.
 *
 * Usage:   node render-unified.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]
 */

import {
  readFileSync, mkdirSync, copyFileSync, rmSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut, escapeHtml as esc,
  resolveInputFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const cli = parseArgs();
const log = createLogger("render-unified");

const handlersPath = cli.get("--handlers") || "output/tei-handlers.mjs";
const teiArg       = cli.getAll("--tei");
const cssPath      = cli.get("--css")      || "output/edition.css";
const outDir       = cli.get("--out")      || "output";

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-poem.xml");
const multi = teiFiles.length > 1;

log(`Handlers module: ${handlersPath}`);
log(`TEI source(s):   ${teiFiles.join(", ")}`);
log(`Edition CSS:     ${cssPath}`);

// ---------------------------------------------------------------------------
// Dynamic import of generated handlers (handles # in path)
// ---------------------------------------------------------------------------
// Copy the handlers module to a temp location to avoid issues with the
// # character in the workspace path.
const tempDir = join(tmpdir(), `odd-unified-render-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
const tempHandlers = join(tempDir, "tei-handlers.mjs");
copyFileSync(resolve(handlersPath), tempHandlers);

const handlersUrl = `file:///${tempHandlers.replace(/\\/g, "/")}`;
log(`Importing handler module…`);

let teiToHast;
try {
  const mod = await import(handlersUrl);
  teiToHast = mod.teiToHast;
  if (!teiToHast) throw new Error("teiToHast not exported");
  log(`✓ Handler module loaded`);
} catch (e) {
  console.error(`[render-unified] ✗ Failed to import handlers: ${e.message}`);
  console.error(`  Make sure you have generated the handlers first:`);
  console.error(`  node odd-to-unified.mjs --odd ../examples/tei_simler.odd`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read the ODD-generated stylesheet (odd-to-css.mjs) once, to inline below.
// ---------------------------------------------------------------------------
let editionCss = "";
try {
  editionCss = readFileSync(resolve(cssPath), "utf-8");
  log(`✓ Inlining ODD-generated CSS (${cssPath})`);
} catch {
  log(`⚠ edition.css not found at ${cssPath} — run odd-to-css.mjs first; the edition will be unstyled`);
}

// ---------------------------------------------------------------------------
// Resolve the hast → HTML serializer once: hast-util-to-html if installed,
// otherwise the built-in serializer below.
// ---------------------------------------------------------------------------
let toHtml = null;
try {
  ({ toHtml } = await import("hast-util-to-html"));
  log(`✓ Serializing with hast-util-to-html`);
} catch {
  log(`hast-util-to-html not available, using built-in serializer`);
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

function serialize(node) {
  if (!node) return "";
  if (node.type === "text") return esc(node.value || "");
  if (node.type === "root") {
    return (node.children || []).map(serialize).join("");
  }
  if (node.type !== "element") return "";

  const tag = node.tagName;
  const props = node.properties || {};
  const attrParts = [];

  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === "className") {
      const cls = Array.isArray(val) ? val.join(" ") : val;
      if (cls) attrParts.push(`class="${esc(cls)}"`);
    } else if (val === true) {
      attrParts.push(key);
    } else {
      attrParts.push(`${key}="${esc(String(val))}"`);
    }
  }

  const attrStr = attrParts.length > 0 ? " " + attrParts.join(" ") : "";

  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrStr}>`;

  const children = (node.children || []).map(serialize).join("");
  return `<${tag}${attrStr}>${children}</${tag}>`;
}

const serializeHast = (hast) => (toHtml ? toHtml(hast) : serialize(hast));

// ---------------------------------------------------------------------------
// Render one TEI document → a self-contained HTML page.
// ---------------------------------------------------------------------------
function renderPage(teiFile) {
  // The generated handlers expect nodes with:
  //   { type: 'element', name, attributes, children } or { type: 'text', value }
  // parseXmlToXast (odd-parser.mjs) uses @rgrove/parse-xml — the same parser
  // xast-util-from-xml is built on — to produce exactly that shape.
  const teiSrc = readFileSync(resolve(teiFile), "utf-8");
  const xastTree = parseXmlToXast(teiSrc);

  // The generated teiToHast() handles 'element'/'text'; if the tree wraps the
  // document in a 'root' node, extract the top-level element first.
  const inputTree = (xastTree.type === "root" && xastTree.children)
    ? xastTree.children.find(c => c.type === "element") || xastTree
    : xastTree;

  const { hast, notes } = teiToHast(inputTree);
  const htmlBody = serializeHast(hast);
  const title = extractTeiTitle(xastTree);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>unified/xast Rendering — TEI Edition</title>

  <!-- ODD-generated stylesheet (odd-to-css.mjs): the edition's element
       styling is derived from the ODD Processing Model. Inlined for a
       self-contained file; for a multi-page edition use a <link> instead. -->
  <style id="edition-css">
${editionCss}
  </style>

  <style>
    /* Demo page chrome (the presentation of this preview page, not the edition). */
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

    /* Renderer scaffolding: classes this renderer synthesises for footnote
       collection and choice display. These are NOT TEI elements, so they are
       not in the ODD and cannot come from edition.css. */
    .tei-note-ref { color: #c0392b; font-size: 0.85em; text-decoration: none; }
    .tei-footnotes { margin-top: 2em; border-top: 1px solid #ddd; padding-top: 1em; }
    .tei-note-body { display: block; margin: 0.3em 0; font-size: 0.9em; }
    .tei-alternate { border-bottom: 1px dotted #999; cursor: pointer; }
    .tei-alternate-alt[hidden] { display: none; }
    .tei-before, .tei-after { font-size: 0.85em; color: #999; }

    /* Facsimile thumbnails: a <pb facs> compiles (Boot nested model) to a
       linked thumbnail. Render it as its own centred block that stacks
       vertically between the text — and reset the colliding .tei-pb rules that
       also land on this <a>/<figure> (the page-break fallback's height:0 would
       otherwise collapse the box so the image overflows onto the text). */
    a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px;
      margin: 1.2em auto; padding: 4px; border: 1px solid #ccc;
      background: #fafafa; line-height: 0; }
    a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none;
      margin: 0; border: 0; }
    a.tei-pb img { display: block; width: 100%; height: auto; }
  </style>
</head>
<body>

  <div class="render-info">
    <h3>unified/xast Rendering Path</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-unified.mjs</code> →
      tei-handlers.mjs → xast → hast → HTML (server-side, Node.js)</p>
    <p>All 25 PM behaviours evaluated at build time. XPath predicates translated
      to JavaScript conditions — no translation gap. Output integrates with
      the unified ecosystem (rehype, Astro, Eleventy content layers).</p>
  </div>

  ${htmlBody}

</body>
</html>`;

  return { html, notes, title };
}

// ---------------------------------------------------------------------------
// Render each input; in multi-file mode also emit an index.
// ---------------------------------------------------------------------------
const indexEntries = [];
for (const teiFile of teiFiles) {
  const { html, notes, title } = renderPage(teiFile);
  const pageName = multi ? htmlPageName(teiFile) : "rendered-unified.html";
  const outFile = writeOut(outDir, pageName, html);
  log(`✓ ${teiFile} → ${outFile} (${notes.length} note(s))`);
  indexEntries.push({ href: pageName, title: title || pageName, meta: `${notes.length} note(s)` });
}

if (multi) {
  const indexFile = writeOut(outDir, "index.html", buildIndexPage({
    title: "TEI Edition — unified/xast (prebuilt, zero-JS)",
    subtitle: `${teiFiles.length} documents · prebuilt static HTML, no server required`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}

try { rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }

log(`  Static HTML — no client-side JS required`);
