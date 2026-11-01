#!/usr/bin/env node

/**
 * Render TEI XML to static HTML through the handlers from odd-to-unified.mjs:
 * the TEI is parsed into xast, the generated teiToHast() turns it into hast, and
 * the result is serialised. The ODD-generated edition.css (odd-to-css.mjs) is
 * inlined, so all element styling comes from the ODD; this script owns only the
 * page around it. --enhance adds an enhancer: scripts of ../runtime, as pm.xsl adds
 * them in the XSLT path, which read only what every renderer writes. The edition
 * stays as it is, except with petite-vue, an example of what a framework takes.
 *
 * --tei takes a file, a directory, a glob, a comma-separated list, or repeated
 * flags. Each source gives <basename>.html; several also an index.html. --output names the PM output to render (default web).
 *
 * Usage:   node render-unified.mjs --handlers <path> --tei <path|dir|glob> [--css <path>] [--out <dir>] [--output <name>] [--enhance script|islands|petite-vue]
 * Output:  <dir>/<basename>.html, what the enhancer ships beside the page, and for several sources <dir>/index.html
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

const runtime = (name) => readFileSync(new URL(`../runtime/${name}`, import.meta.url), "utf8");
const inlined = (...names) => names.map((name) => `<script>\n${runtime(name)}\n  </script>`).join("\n  ");

/** Petite-vue's directives on every alternate. `hidden`, not v-show: the page stays right without JS, and a view's CSS can still choose a reading. */
function addDirectives(node) {
  if (node.type !== "element") return node;
  const [first, second] = (node.children ?? []).filter((c) => c.type === "element");
  if (node.properties?.className?.includes("tei-alternate") && second) {
    Object.assign(node.properties, {
      "v-scope": "{ alt: false }", "@click": "alt = !alt", ":role": "'switch'", ":aria-checked": "String(alt)", tabindex: "0",
      "@keydown.enter.prevent": "alt = !alt", "@keydown.space.prevent": "alt = !alt", title: "Swap the readings",
    });
    first.properties[":hidden"] = "alt";
    second.properties[":hidden"] = "!alt";
    return node;
  }
  (node.children ?? []).forEach(addDirectives);
  return node;
}

/** What each enhancer adds to the page, and ships beside it. */
const ENHANCERS = {
  script: {
    about: "A small script swaps the readings; notes open as tooltips, and page breaks their image.",
    scripts: () => inlined("readings.js", "notes.js", "facsimile.js"),
  },
  islands: {
    about: `One small loader finds the readings and the page breaks, and fetches the script of each
      when the first comes into view. Notes open as tooltips.`,
    scripts: () => `<script src="tei-islands.js" defer></script>\n  ${inlined("notes.js")}`,
    beside: ["tei-islands.js", "readings.js", "facsimile.js"],
  },
  // An example, not an alternative: petite-vue evaluates its expressions, which a strict Content
  // Security Policy forbids, and a stylesheet could not write its directives, which are not XML names.
  "petite-vue": {
    about: `An example of using a framework: directives written at build time, which
      <a href="https://github.com/vuejs/petite-vue">petite-vue</a> activates from a CDN. The small
      script does the same with no dependency.`,
    transform: addDirectives,
    wrap: (body) => `<div id="edition" v-scope>\n${body}\n  </div>`,
    scripts: () => `<script type="module">
    import { createApp } from 'https://unpkg.com/petite-vue@0.4.1/dist/petite-vue.es.js';
    createApp().mount('#edition');
  </script>
  ${inlined("notes.js", "facsimile.js")}`,
  },
};

const enhance = cli.get("--enhance");
const enhancer = enhance && ENHANCERS[enhance];
if (enhance && !enhancer) {
  console.error(`[render-unified] ✗ unknown enhancer "${enhance}": one of ${Object.keys(ENHANCERS).join(", ")}`);
  process.exit(1);
}

const teiFiles = resolveTeiFiles(teiArg.length ? teiArg : "../examples/simler-*.xml");
const multi = teiFiles.length > 1;

const teiToHast = await loadHandlers(handlersPath);

let editionCss = "";
try {
  editionCss = readFileSync(resolve(cssPath), "utf-8");
} catch {
  log(`⚠ edition.css not found at ${cssPath} — run odd-to-css.mjs first; the edition will be unstyled`);
}

const name = `unified/xast${enhance ? ` + ${enhance}` : ""}`;

/** Render one TEI document → a self-contained HTML page. */
function renderPage(teiFile) {
  const tree = readTei(teiFile);
  const { hast, notes, page } = teiToHast(tree, { output });
  const body = toHtml(enhancer?.transform?.(hast) ?? hast);

  const html = `<!DOCTYPE html>
<html lang="en" data-mode="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} Rendering — TEI Edition</title>

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
  </style>
</head>
<body>
  <div class="render-info">
    <h3>${name} Rendering Path</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-unified.mjs</code> →
      tei-handlers.mjs → xast → hast → HTML (build time, Node.js)</p>
    <p>${enhancer?.about ?? `Each element takes the first of its ODD models whose predicate holds;
      predicates and params are XPath, evaluated at build time. The output plugs
      into the unified ecosystem (rehype, Astro, Eleventy content layers).`}</p>
  </div>
  ${enhancer?.wrap?.(body) ?? body}
  ${enhancer?.scripts() ?? ""}
</body>
</html>`;

  return { html, notes, title: extractTeiTitle(tree), page };
}

for (const file of enhancer?.beside ?? []) writeOut(outDir, file, runtime(file));

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
    title: `TEI Edition — ${name}`,
    subtitle: `${teiFiles.length} documents · prebuilt static HTML, no server required${enhance ? ", degrades to zero-JS" : ""}`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}
