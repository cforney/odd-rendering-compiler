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
 * page chrome and interactive scaffolding. --tei accepts the same inputs, with
 * the same pages.
 *
 * Usage:  node render-unified-interactive.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>]
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut, toHtml, loadHandlers,
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

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-*.xml");
const multi = teiFiles.length > 1;

log(`Handlers: ${handlersPath}`);
log(`TEI:      ${teiFiles.join(", ")}`);
log(`CSS:      ${cssPath}`);

const teiToHast = await loadHandlers(handlersPath);

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
// Render one TEI document → an interactive (petite-vue) HTML page.
// ---------------------------------------------------------------------------
function renderPage(teiFile) {
  const xastTree = parseXmlToXast(readFileSync(resolve(teiFile), "utf-8"));
  const { hast, notes } = teiToHast(xastTree);

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
            className: refNode.properties.className,
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

  const htmlBody = toHtml(hast);
  const title = extractTeiTitle(xastTree);

  // -------------------------------------------------------------------------
  // Compose HTML page with petite-vue
  // -------------------------------------------------------------------------
  const html = `<!DOCTYPE html>
<html lang="en" data-mode="light">
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
      background: #fef3c7; border: 1px solid #fbbf24;
      padding: 1em; border-radius: 6px; margin-bottom: 2em;
      font-size: 0.85em;
    }
    .render-info h3 { margin: 0 0 0.5em; color: #d97706; }
    .render-info code { background: #fef9c3; padding: 0.1em 0.3em; border-radius: 3px; }

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

  </style>
</head>
<body>
  <script>document.documentElement.classList.add('js');</script>

  <div class="render-info">
    <h3>Interactive unified/xast Rendering Path (petite-vue)</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-unified.mjs</code> →
      tei-handlers.mjs → xast → hast → HTML + <strong>petite-vue</strong> directives</p>
    <p>Build-time conversion embeds <code>v-scope</code>, <code>v-show</code> and
      <code>@click</code> directives that
      <a href="https://github.com/vuejs/petite-vue" target="_blank" rel="noopener">petite-vue</a>
      (~7 KB) activates at load time: click notes to expand, click apparatus
      readings to toggle. Without JavaScript the content stays fully visible.</p>
  </div>

  <!-- petite-vue mount scope -->
  <div id="edition" v-scope @vue:mounted="$el.removeAttribute('v-cloak')" v-cloak>
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
  const pageName = htmlPageName(teiFile);
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

log(`  petite-vue (~7 KB) provides interactivity`);
log(`  Content visible without JS (graceful degradation)`);
