#!/usr/bin/env node

/**
 * The interactive variant of render-unified.mjs. It reuses the same
 * tei-handlers.mjs but post-processes the hast tree to inject petite-vue
 * (https://github.com/vuejs/petite-vue) directives: notes become inline
 * open/close toggles and choice/alternate elements toggle between readings on
 * click. The page is fully rendered at build time and stays readable without JS
 * (graceful degradation); petite-vue (~7 KB) adds the interactivity at load.
 *
 * As in render-unified.mjs, edition.css is inlined and this script owns only the
 * page chrome and interactive scaffolding. --tei accepts the same inputs; one
 * input → rendered-unified-interactive.html, several → per-source pages + index.
 *
 * Usage:  node render-unified-interactive.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]
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
const log = createLogger("render-interactive");

const handlersPath = cli.get("--handlers") || "output/tei-handlers.mjs";
const teiArg       = cli.getAll("--tei");
const cssPath      = cli.get("--css")      || "output/edition.css";
const outDir       = cli.get("--out")      || "output";

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-poem.xml");
const multi = teiFiles.length > 1;

log(`Handlers: ${handlersPath}`);
log(`TEI:      ${teiFiles.join(", ")}`);
log(`CSS:      ${cssPath}`);

// ---------------------------------------------------------------------------
// Import handler module (copy to temp to avoid # in path)
// ---------------------------------------------------------------------------
const tempDir = join(tmpdir(), `odd-interactive-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
const tempHandlers = join(tempDir, "tei-handlers.mjs");
copyFileSync(resolve(handlersPath), tempHandlers);

let teiToHast;
try {
  const mod = await import(`file:///${tempHandlers.replace(/\\/g, "/")}`);
  teiToHast = mod.teiToHast;
  if (!teiToHast) throw new Error("teiToHast not exported");
  log(`✓ Handler module loaded`);
} catch (e) {
  console.error(`[render-interactive] ✗ Failed: ${e.message}`);
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
// Serialize hast → HTML
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
      // Preserve Vue directive attributes as-is (v-scope, v-show, @click, etc.)
      attrParts.push(`${key}="${esc(String(val))}"`);
    }
  }

  const attrStr = attrParts.length > 0 ? " " + attrParts.join(" ") : "";
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrStr}>`;
  const children = (node.children || []).map(serialize).join("");
  return `<${tag}${attrStr}>${children}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Render one TEI document → an interactive (petite-vue) HTML page.
// ---------------------------------------------------------------------------
function renderPage(teiFile) {
  const teiSrc = readFileSync(resolve(teiFile), "utf-8");
  const xastTree = parseXmlToXast(teiSrc);

  const inputTree = (xastTree.type === "root" && xastTree.children)
    ? xastTree.children.find(c => c.type === "element") || xastTree
    : xastTree;

  const { hast, notes } = teiToHast(inputTree);

  // -------------------------------------------------------------------------
  // Post-process hast: inject petite-vue reactive directives.
  // noteMap / noteIdx are per-document state, so they live in this scope.
  // -------------------------------------------------------------------------
  const noteMap = new Map();
  for (const note of notes) {
    const id = note.properties?.id;
    if (id) noteMap.set(id, note);
  }

  let noteIdx = 0;

  /**
   * Walk the hast tree and transform interactive elements:
   *   1. .tei-note-ref → inline note with v-scope toggle
   *   2. .tei-alternate → v-scope toggle between readings
   *   3. Remove the footnotes section (notes are now inline)
   */
  function transformForPetiteVue(node) {
    if (!node || node.type === "text") return node;
    if (node.type === "root") {
      node.children = (node.children || []).map(transformForPetiteVue).filter(Boolean);
      return node;
    }
    if (node.type !== "element") return node;

    const cls = node.properties?.className || [];

    // Skip the footnotes section — notes are now inline
    if (cls.includes("tei-footnotes")) return null;

    // Transform .tei-alternate → petite-vue toggle
    if (cls.includes("tei-alternate")) {
      return transformAlternate(node);
    }

    // Transform .tei-note-ref → inline note with toggle
    if (cls.includes("tei-note-ref")) {
      return transformNoteRef(node);
    }

    // Recurse into children
    if (node.children) {
      node.children = node.children.map(transformForPetiteVue).filter(Boolean);
    }
    return node;
  }

  function transformNoteRef(refNode) {
    noteIdx++;
    // Extract the note ID from href="#note-1"
    const href = refNode.properties?.href || "";
    const noteId = href.replace(/^#/, "");
    const noteBody = noteMap.get(noteId);

    // Create a petite-vue scoped wrapper
    const wrapper = {
      type: "element",
      tagName: "span",
      properties: {
        className: ["tei-note-interactive"],
        "v-scope": "{ open: false }",
      },
      children: [
        // The clickable ref marker
        {
          type: "element",
          tagName: "a",
          properties: {
            className: ["tei-note-ref"],
            href: "#",
            role: "doc-noteref",
            "aria-label": `Note ${noteIdx}`,
            "@click.prevent": "open = !open",
            ":aria-expanded": "String(open)",
          },
          children: [
            {
              type: "element",
              tagName: "sup",
              properties: {},
              children: [{ type: "text", value: `${noteIdx}` }],
            },
          ],
        },
        // Inline note body — hidden by default, shown on click
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["tei-note-body"],
            id: noteId,
            role: "doc-footnote",
            "v-show": "open",
          },
          children: noteBody ? (noteBody.children || []) : [],
        },
      ],
    };

    return wrapper;
  }

  function transformAlternate(node) {
    const children = (node.children || []).filter(c => c.type === "element");
    if (children.length < 2) return node;

    const defaultChild = children[0];
    const altChild = children[1];

    // Remove hidden from alt child (petite-vue handles visibility)
    if (altChild.properties) delete altChild.properties.hidden;

    // Add petite-vue directives
    node.properties = node.properties || {};
    node.properties["v-scope"] = "{ alt: false }";
    node.properties["@click"] = "alt = !alt";
    node.properties.role = "switch";
    node.properties[":aria-checked"] = "String(alt)";
    node.properties.tabindex = "0";
    node.properties["@keydown.enter.prevent"] = "alt = !alt";
    node.properties["@keydown.space.prevent"] = "alt = !alt";
    node.properties.title = "Click to toggle between readings";

    // Default child: shown when !alt
    defaultChild.properties = defaultChild.properties || {};
    defaultChild.properties["v-show"] = "!alt";

    // Alt child: shown when alt
    altChild.properties = altChild.properties || {};
    altChild.properties["v-show"] = "alt";

    node.children = [defaultChild, altChild];
    return node;
  }

  transformForPetiteVue(hast);
  log(`✓ ${teiFile}: petite-vue directives injected (${noteMap.size} notes, inline)`);

  const htmlBody = serialize(hast);
  const title = extractTeiTitle(xastTree);

  // -------------------------------------------------------------------------
  // Compose HTML page with petite-vue
  // -------------------------------------------------------------------------
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive unified/xast Rendering — TEI Edition (petite-vue)</title>

  <!-- ODD-generated stylesheet (odd-to-css.mjs): the edition's element
       styling is derived from the ODD Processing Model — the same Tier-1 floor
       this interactive layer (Tier 2) progressively enhances. Inlined for a
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
      background: #ede9fe; border: 1px solid #a78bfa;
      padding: 1em; border-radius: 6px; margin-bottom: 2em;
      font-size: 0.85em;
    }
    .render-info h3 { margin: 0 0 0.5em; color: #7c3aed; }
    .render-info code { background: #f5f3ff; padding: 0.1em 0.3em; border-radius: 3px; }

    /* Renderer scaffolding + interactive layer: classes this renderer
       synthesises (note refs/bodies, choice toggles) and the petite-vue
       directives. These are NOT TEI elements, so they are not in the ODD. */

    /* Note: inline toggle */
    .tei-note-interactive { display: inline; }
    .tei-note-ref {
      color: #2563eb; text-decoration: none; cursor: pointer;
    }
    .tei-note-ref:hover { text-decoration: underline; }
    .tei-note-ref sup { font-size: 0.75em; }
    .tei-note-body {
      display: block; background: #fffde7; border: 1px solid #e0e0e0;
      padding: 0.5em 0.75em; margin: 0.25em 0; font-size: 0.9em;
      border-radius: 4px;
    }

    /* Alternate/choice toggle */
    .tei-alternate {
      border-bottom: 1px dotted #999;
      cursor: pointer;
    }
    .tei-alternate:hover { background: #f0f0f0; }
    .tei-alternate-default { /* original reading */ }
    .tei-alternate-alt { color: #b91c1c; }

    /* petite-vue [v-cloak] hides elements until mounted */
    [v-cloak] { display: none; }

    /* Before/after markers */
    .tei-before, .tei-after { font-size: 0.85em; color: #999; }

    /* Facsimile thumbnails (pb compound: a linked thumbnail) + show/hide
       toggle. Its own centred block that stacks vertically between the text;
       resets the colliding .tei-pb rules that also land on this <a>/<figure>
       (the page-break fallback's height:0 would otherwise collapse the box so
       the image overflows onto the text). */
    a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px;
      margin: 1.2em auto; padding: 4px; border: 1px solid #ccc;
      background: #fafafa; line-height: 0; }
    a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none; margin: 0; border: 0; }
    a.tei-pb img { display: block; width: 100%; height: auto; }
    #edition.facs-hidden a.tei-pb { display: none; }
    .facs-toggle { display: none; margin: 0 0 1.2em; font-family: system-ui, sans-serif; }
    html.js .facs-toggle { display: block; }
    .facs-toggle button { font: inherit; font-size: 0.85em; cursor: pointer;
      padding: 0.3em 0.8em; border: 1px solid #c7c7c7; border-radius: 4px; background: #f3f3f3; }

    /* Legend */
    .legend {
      font-family: system-ui, sans-serif; font-size: 0.8em;
      display: flex; flex-wrap: wrap; gap: 1em; margin: 1.5em 0;
      padding: 0.8em; background: #f8f8f8; border-radius: 4px;
    }
    .legend-dot {
      display: inline-block; width: 12px; height: 12px;
      border-radius: 2px; vertical-align: middle; margin-right: 4px;
    }
  </style>
</head>
<body>
  <script>document.documentElement.classList.add('js');</script>

  <div class="render-info">
    <h3>Interactive unified/xast Rendering Path (petite-vue)</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-unified.mjs</code> →
      tei-handlers.mjs → xast → hast → HTML + <strong>petite-vue</strong> directives</p>
    <p>Build-time conversion produces static HTML with embedded <code>v-scope</code>,
      <code>v-show</code>, and <code>@click</code> directives.
      <a href="https://github.com/vuejs/petite-vue" target="_blank" rel="noopener">petite-vue</a>
      (~7 KB) activates interactivity at load time.</p>
    <p><strong>Interactive elements:</strong> Click notes to expand/collapse;
      click <span style="border-bottom:1px dotted #999">dotted-underlined</span>
      text to toggle between readings.</p>
    <p><strong>Graceful degradation:</strong> Without JS, all content remains
      visible — notes are expanded, both readings shown.</p>
    <p><strong>Styling:</strong> derived from the ODD — the inlined
      <code>edition.css</code> generated by <code>odd-to-css.mjs</code> (the
      same Tier-1 floor), plus per-element rules the handlers resolve at build time.</p>
  </div>

  <div class="legend">
    <span><span class="legend-dot" style="background:#8e44ad"></span> Person</span>
    <span><span class="legend-dot" style="background:#27ae60"></span> Place</span>
    <span><span class="legend-dot" style="background:#2980b9"></span> Link</span>
    <span><span class="legend-dot" style="background:#e67e22"></span> Abbreviation</span>
    <span><span class="legend-dot" style="background:#c0392b"></span> Correction</span>
    <span><span class="legend-dot" style="background:#2563eb"></span> Note (click to expand)</span>
  </div>

  <!-- petite-vue mount scope -->
  <div id="edition" v-scope="{ facs: true }" :class="{ 'facs-hidden': !facs }"
       @vue:mounted="$el.removeAttribute('v-cloak')" v-cloak>
    <div class="facs-toggle">
      <button type="button" @click="facs = !facs" :aria-pressed="facs ? 'true' : 'false'"
        v-text="facs ? 'Hide facsimiles' : 'Show facsimiles'">Hide facsimiles</button>
    </div>
    ${htmlBody}
  </div>

  <!-- petite-vue (~7 KB, ESM) -->
  <script type="module">
    import { createApp } from 'https://unpkg.com/petite-vue@0.4.1/dist/petite-vue.es.js';
    createApp().mount('#edition');
  </script>

  <!-- No-JS fallback: show everything if petite-vue doesn't load -->
  <noscript>
    <style>
      [v-show] { display: revert !important; }
      [v-cloak] { display: block !important; }
    </style>
  </noscript>

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
  const pageName = multi ? htmlPageName(teiFile) : "rendered-unified-interactive.html";
  const outFile = writeOut(outDir, pageName, html);
  log(`✓ ${teiFile} → ${outFile}`);
  indexEntries.push({ href: pageName, title: title || pageName, meta: `${notes.length} note(s) · interactive` });
}

if (multi) {
  const indexFile = writeOut(outDir, "index.html", buildIndexPage({
    title: "TEI Edition — unified/xast + petite-vue (progressively enhanced)",
    subtitle: `${teiFiles.length} documents · prebuilt HTML, ~7 KB petite-vue, degrades to zero-JS`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}

try { rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }

log(`  petite-vue (~7 KB) provides interactivity`);
log(`  Content visible without JS (graceful degradation)`);
