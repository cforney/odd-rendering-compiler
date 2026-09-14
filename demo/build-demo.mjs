#!/usr/bin/env node

/**
 * Assemble the comparison demo (demo/site/) from outputs both compilers already
 * produce. It copies each compiler's output/ verbatim, measures page weight and
 * client JS per page, reads the artefact snippets, and writes a single index.html
 * shell driven by demo/manifest.mjs. Build the outputs first:
 *
 *   (compiler-js)   npm run build:all && npm run render:all
 *   (compiler-xslt) bash build.sh
 *   node demo/build-demo.mjs
 *
 * The shell is plain static HTML + one vanilla-JS file — no framework, no server.
 */

import {
  cpSync, copyFileSync, readFileSync, writeFileSync,
  rmSync, mkdirSync, existsSync, statSync,
} from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { concept, paths, floor, docs } from "./manifest.mjs";

const DEMO = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DEMO, "..");
const SITE = resolve(DEMO, "site");
const SOURCES = {                          // manifest `dir` → compiler output
  js: resolve(ROOT, "compiler-js", "output"),
  xslt: resolve(ROOT, "compiler-xslt", "output"),
};

const kb = (bytes) => (bytes / 1024).toFixed(1);
const sizeOf = (file) => (existsSync(file) ? statSync(file).size : 0);

// First lines of an artefact, for the "generated behind it" panel.
function snippet(text, maxLines = 40) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const head = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? head + "\n…" : head;
}

// Client JS a page actually ships: inline <script> bytes plus local script files
// (measured); CDN scripts — whether a <script src> or an import inside an inline
// module — can't be weighed offline, so they're listed by name.
function measureClientJs(htmlFile) {
  const html = readFileSync(htmlFile, "utf8");
  const base = dirname(htmlFile);
  let bytes = 0;
  const external = [];
  const isRemote = (url) => /^(https?:)?\/\//i.test(url);
  const note = (url) => external.push(basename(url.split(/[?#]/)[0]));
  for (const [, attrs, inner] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = attrs.match(/src\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) { isRemote(src) ? note(src) : (bytes += sizeOf(resolve(base, src))); continue; }
    bytes += Buffer.byteLength(inner, "utf8");                 // inline script
    for (const [, url] of inner.matchAll(/(?:from|import)\s*\(?\s*["'](https?:\/\/[^"']+)["']/gi)) note(url);
  }
  return { bytes, external };
}

// ---------------------------------------------------------------------------
// 1 · Reset the site and copy both compilers' outputs in verbatim, so every
//     page keeps its sibling assets (edition.css, the SEF, the runtime, …).
// ---------------------------------------------------------------------------
rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
for (const [dir, src] of Object.entries(SOURCES)) {
  if (!existsSync(src)) {                  // degrade gracefully: skip absent outputs
    console.warn(`[build-demo] ${src} not found — paths from "${dir}/" will be skipped.`);
    continue;
  }
  cpSync(src, resolve(SITE, dir), { recursive: true });
}
for (const asset of ["shell.css", "shell.js"]) copyFileSync(resolve(DEMO, asset), resolve(SITE, asset));

// ---------------------------------------------------------------------------
// 2 · Resolve each path and document against the copied site: URL and metrics
//     per page, the artefact snippet per path.
// ---------------------------------------------------------------------------
const resolved = paths.flatMap((p) => {
  const pages = {};
  for (const doc of docs) {
    const url = `${p.dir}/${p.file.replace("{doc}", doc.id)}`;
    const page = resolve(SITE, url);
    if (!existsSync(page)) continue;
    const js = measureClientJs(page);
    pages[doc.id] = { url, pageKB: kb(sizeOf(page)), jsKB: kb(js.bytes), jsExternal: [...new Set(js.external)] };
  }
  if (!Object.keys(pages).length) {
    console.warn(`[build-demo] skipping ${p.id}: no ${p.dir}/${p.file} found`);
    return [];
  }
  const artefactFile = resolve(SITE, p.artefact.file);
  return [{
    id: p.id, label: p.label, hue: p.hue, pages,
    artefact: {
      label: p.artefact.label,
      url: p.artefact.file,
      snippet: existsSync(artefactFile) ? snippet(readFileSync(artefactFile, "utf8")) : "",
    },
  }];
});
if (!resolved.length) { console.error("[build-demo] no paths resolved — nothing to build."); process.exit(1); }

const floorFile = resolve(SITE, floor.file);
const data = {
  concept, paths: resolved,
  docs: docs.filter((d) => resolved.some((p) => p.pages[d.id])),
  floor: {
    label: floor.label, url: floor.file,
    sizeKB: kb(sizeOf(floorFile)),
    snippet: existsSync(floorFile) ? snippet(readFileSync(floorFile, "utf8")) : "",
  },
};

// ---------------------------------------------------------------------------
// 3 · Write the shell. It carries the manifest as embedded JSON; shell.js builds
//     the tabs, the side-by-side view, the JS on/off toggle and the artefact panel.
// ---------------------------------------------------------------------------
writeFileSync(resolve(SITE, "index.html"), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ODD Rendering Compiler — compare the rendering paths</title>
  <link rel="stylesheet" href="shell.css">
</head>
<body>
  <header class="demo-head">
    <h1>The TEI ODD as static-build configuration</h1>
    <p class="concept">${data.concept}</p>
  </header>

  <nav class="tabs" id="tabs" aria-label="Rendering path"></nav>

  <div class="controls">
    <label class="doc">Document <select id="doc"></select></label>
    <label class="js-toggle"><input type="checkbox" id="js-on" checked> JavaScript</label>
    <label class="compare"><input type="checkbox" id="side-by-side"> Side by side</label>
  </div>

  <main class="stage" id="stage">
    <section class="pane" data-pane="a">
      <div class="pane-bar"><span class="pane-label" data-pane="a"></span></div>
      <iframe data-pane="a" title="Rendered edition"></iframe>
    </section>
    <section class="pane secondary" data-pane="b" hidden>
      <div class="pane-bar">
        <select class="pane-pick" data-pane="b"></select>
        <button type="button" id="swap" title="Swap the two panes">⤢ swap</button>
      </div>
      <iframe data-pane="b" title="Rendered edition (compare)"></iframe>
    </section>

    <aside class="artefact" id="artefact">
      <h2>Generated artefact</h2>
      <p class="floor-note">Every path renders against the same visual floor,
        <a id="floor-link" href="#"></a> (<span id="floor-size"></span>).</p>
      <pre class="code" id="floor-code"></pre>
      <h3 id="artefact-title"></h3>
      <pre class="code" id="artefact-code"></pre>
      <p class="metrics" id="metrics"></p>
    </aside>
  </main>

  <footer class="demo-foot">
    Static HTML framing the files both compilers build — nothing is re-rendered here.
  </footer>

  <script id="demo-data" type="application/json">${JSON.stringify(data)}</script>
  <script src="shell.js" defer></script>
</body>
</html>
`);

console.log(`[build-demo] ✓ demo/site/index.html — ${resolved.length} path(s): ${resolved.map((p) => p.id).join(", ")}`);
