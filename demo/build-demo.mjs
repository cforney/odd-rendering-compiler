#!/usr/bin/env node

/**
 * Assemble the comparison demo (demo/site/) from outputs both compilers already
 * produce. It copies each compiler's output/, moves each page's render-info banner
 * into the side panel, so the frame shows the edition alone, measures page weight
 * and client JS per page, reads the artefact snippets, and writes a single
 * index.html shell driven by demo/manifest.mjs. For the inspector it records what
 * decided each element, from the handlers' own trace. Build the outputs first:
 *
 *   (compiler-js)   npm run build:all && npm run render:all && npm run findings
 *   (compiler-xslt) bash build.sh
 *   node demo/build-demo.mjs
 *
 * The shell is plain static HTML + one vanilla-JS file — no framework, no server.
 */

import {
  cpSync, copyFileSync, readFileSync, writeFileSync,
  rmSync, mkdirSync, existsSync, statSync, readdirSync,
} from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { concept, paths, floor, docs, inspected, views } from "./manifest.mjs";
import { parseXmlToXast, readOdd, allModels } from "../compiler-js/odd-parser.mjs";
import { seq, str } from "../runtime/xpath.mjs";

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

// Take a copied page's banner out of it, and return what it said. The page's own view
// switches go too, from sight: the panel has them, for every rendering at once.
function takeBanner(page) {
  const html = readFileSync(page, "utf8");
  const banner = html.match(/<div class="render-info">([\s\S]*?)<\/div>\s*/);
  if (!banner) return null;
  writeFileSync(page, html.replace(banner[0], "").replace("</head>", "<style>.tei-views { display: none; }</style></head>"));
  return banner[1].trim();
}

// ---------------------------------------------------------------------------
// 1 · Reset the site and copy both compilers' outputs in, so every
//     page keeps its sibling assets (edition.css, the SEF, the runtime, …).
// ---------------------------------------------------------------------------
mkdirSync(SITE, { recursive: true });                 // emptied, not removed: a server may hold it
for (const entry of readdirSync(SITE)) rmSync(resolve(SITE, entry), { recursive: true, force: true });
for (const [dir, src] of Object.entries(SOURCES)) {
  if (!existsSync(src)) {                  // degrade gracefully: skip absent outputs
    console.warn(`[build-demo] ${src} not found — paths from "${dir}/" will be skipped.`);
    continue;
  }
  cpSync(src, resolve(SITE, dir), { recursive: true });
}
for (const asset of ["shell.css", "shell.js", "robots.txt"]) copyFileSync(resolve(DEMO, asset), resolve(SITE, asset));

// ---------------------------------------------------------------------------
// 2 · Resolve each path and document against the copied site: URL and metrics
//     per page, the artefact snippet per path.
// ---------------------------------------------------------------------------
const resolved = paths.flatMap((p) => {
  const pages = {};
  let banner = null;
  for (const doc of docs) {
    const url = `${p.dir}/${p.file.replace("{doc}", doc.id)}`;
    const page = resolve(SITE, url);
    if (!existsSync(page)) continue;
    if (page.endsWith(".html")) banner = takeBanner(page) ?? banner;
    const js = measureClientJs(page);
    pages[doc.id] = { url, pageKB: kb(sizeOf(page)), jsKB: kb(js.bytes), jsExternal: [...new Set(js.external)] };
  }
  if (!Object.keys(pages).length) {
    console.warn(`[build-demo] skipping ${p.id}: no ${p.dir}/${p.file} found`);
    return [];
  }
  const artefactFile = resolve(SITE, p.artefact.file);
  return [{
    id: p.id, family: p.family, label: p.label, hue: p.hue, pages, needsJs: Boolean(p.needsJs), interactive: Boolean(p.interactive), server: Boolean(p.server),
    fetchesKB: p.fetches ? kb(sizeOf(resolve(SITE, p.fetches))) : null,
    plain: p.plain, report: Boolean(p.report),
    how: banner?.replace(/<h3>[\s\S]*?<\/h3>\s*/, "") ?? null,
    artefact: {
      label: p.artefact.label,
      url: p.artefact.file,
      snippet: existsSync(artefactFile) ? snippet(readFileSync(artefactFile, "utf8")) : "",
    },
  }];
});
if (!resolved.length) { console.error("[build-demo] no paths resolved — nothing to build."); process.exit(1); }

// ---------------------------------------------------------------------------
// The inspector's records: one per element rendered, in document order. The shell
// finds an element by its place among those with a class of NOT_ELEMENTS' pattern.
// ---------------------------------------------------------------------------
/** tei- classes the renderers add for themselves, not for an element of the source. */
const NOT_ELEMENTS = ["tei-edition", "tei-views", "tei-footnotes", "tei-notes", "tei-note-body", "tei-note-num", "tei-toc", "tei-tooltip", "tei-alternate-default", "tei-alternate-alt"];
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const xmlOf = (n) => {
  if (n.type === "text") return n.value;
  const name = n.name.replace(/^\{.*\}/, "");
  const attrs = Object.entries(n.attributes).map(([k, v]) => ` ${k}="${v}"`).join("");
  return n.children.length ? `<${name}${attrs}>${n.children.map(xmlOf).join("")}</${name}>` : `<${name}${attrs}/>`;
};

async function writeInspection() {
  const handlers = resolve(ROOT, inspected.handlers);
  if (!existsSync(handlers)) return false;
  const { teiToHast } = await import(pathToFileURL(handlers).href);
  const odd = readOdd(resolve(ROOT, inspected.odd));
  const oddLines = readFileSync(resolve(ROOT, inspected.odd), "utf8").split(/\r?\n/);
  const byId = new Map(allModels(odd.specs).map((m) => [m.id, m]));
  /** A model as the ODD wrote it, without its indentation. */
  const written = ({ line }) => {
    const end = oddLines.findIndex((l, i) => i >= line - 1 && /\/>\s*$|<\/model(Sequence)?>\s*$/.test(l));
    const lines = oddLines.slice(line - 1, end + 1);
    const indent = lines[0].match(/^\s*/)[0].length;
    return clip(lines.map((l) => l.slice(indent)).join("\n"), 900);
  };
  mkdirSync(resolve(SITE, "inspect"), { recursive: true });
  for (const doc of docs) {
    const tei = resolve(ROOT, inspected.tei.replace("{doc}", doc.id));
    if (!existsSync(tei)) continue;
    const { hast, sources } = teiToHast(parseXmlToXast(readFileSync(tei, "utf8")), { trace: true });
    const records = [];
    (function walk(el) {
      const cls = el.properties?.className?.[0];
      if (cls?.startsWith("tei-") && !NOT_ELEMENTS.includes(cls)) {
        const { pos, model } = sources.get(el);
        const wrote = byId.get(model.id);
        const spec = odd.specs.find((s) => s.key === pos.node.name);
        records.push({
          cls, element: pos.node.name.replace(/^\{.*\}/, ""), behaviour: model.behaviour,
          predicate: wrote.predicate, odd: wrote.odd, line: wrote.line, source: written(wrote),
          tei: clip(xmlOf(pos.node), 700),
          params: Object.fromEntries(Object.entries(model.params).map(([k, f]) => [k, clip(seq(f(pos)).map((i) => str([i])).join(" "), 160)])),
          candidates: spec.models.filter((m) => !m.output || m.output === "web").map((m) => ({
            behaviour: m.behaviour, output: m.output, predicate: m.predicate,
            chosen: m.id === model.id || (m.parts ?? []).some((p) => p.id === model.id),
          })),
        });
      }
      for (const c of el.children ?? []) if (c.type === "element") walk(c);
    })(hast);
    writeFileSync(resolve(SITE, "inspect", `${doc.id}.json`), JSON.stringify(records));
  }
  return true;
}

const floorFile = resolve(SITE, floor.file);
const data = {
  concept, paths: resolved, inspect: await writeInspection(), notElements: NOT_ELEMENTS,
  views: readOdd(resolve(ROOT, inspected.odd)).views.map((v) => ({ output: v.output, label: views[v.output]?.label ?? v.label, help: views[v.output]?.help ?? "" })),
  docs: docs.filter((d) => resolved.some((p) => p.pages[d.id])),
  floor: {
    label: floor.label, url: floor.file,
    sizeKB: kb(sizeOf(floorFile)),
    snippet: existsSync(floorFile) ? snippet(readFileSync(floorFile, "utf8")) : "",
  },
};

// ---------------------------------------------------------------------------
// 3 · Write the shell. It carries the manifest as embedded JSON; shell.js builds
//     the path tabs, the document picker, the JS on/off toggle and the side panel.
// ---------------------------------------------------------------------------
writeFileSync(resolve(SITE, "index.html"), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>ODD Rendering Compiler — compare the rendering paths</title>
  <link rel="stylesheet" href="shell.css">
</head>
<body>
  <header class="bar">
    <div>
      <h1>The TEI ODD as static-build configuration</h1>
      <p>${data.concept}</p>
    </div>
    <div class="controls">
      <button type="button" class="compare-open" id="compare-open">Compare the renderings</button>
      <label>Document <select id="doc"></select></label>
      <label><input type="checkbox" id="js-on" checked> JavaScript</label>
    </div>
  </header>

  <div class="navs">
    <nav class="paths" aria-label="Rendering path">
      <span class="nav-title">One edition, rendered by</span>
      <div class="nav-tabs" id="paths"></div>
    </nav>
    <nav class="paths reports" aria-label="Build reports">
      <span class="nav-title">Also from the build</span>
      <div class="nav-tabs" id="reports"></div>
    </nav>
  </div>

  <main class="stage">
    <iframe id="page" title="Rendered edition"></iframe>
    <aside class="side">
      <section class="about" id="about-box">
        <h2 id="about-title"></h2>
        <p id="about-purpose"></p>
        <p class="muted" id="metrics"></p>
        <p class="verified" id="verified" hidden></p>
        <p class="notice" id="notice" hidden>This path renders in the browser, so with JavaScript off there is nothing to show. The prebuilt paths keep their text.</p>
        <details id="how"><summary>How it works</summary><div id="how-text"></div></details>
      </section>
      <section id="views" hidden>
        <h3>Show in the text</h3>
        <div id="view-list"></div>
      </section>
      <section id="inspect" hidden>
        <h3>Why does it look like this?</h3>
        <p class="muted" id="inspect-hint"></p>
        <button type="button" id="inspect-toggle" aria-pressed="false">Inspect the text</button>
        <div id="inspected"></div>
      </section>
      <section>
        <h3>Generated behind it</h3>
        <a id="artefact-link"></a>
        <details><summary>Show the start</summary><pre class="code" id="artefact-code"></pre></details>
      </section>
      <section id="floor">
        <h3>Shared stylesheet</h3>
        <p class="muted">Every path renders against <a id="floor-link"></a> (<span id="floor-size"></span>).</p>
        <details><summary>Show the start</summary><pre class="code" id="floor-code"></pre></details>
      </section>
      <p class="muted small">Static HTML framing the files both compilers build — nothing is re-rendered here.</p>
    </aside>
  </main>

  <dialog id="compare" aria-labelledby="compare-title">
    <header>
      <h2 id="compare-title">Which rendering should I use?</h2>
      <button type="button" id="compare-close">Close</button>
    </header>
    <p class="muted">They all show the same edition; they differ in what the reader downloads and what the page can do. Sizes are for the document picked.</p>
    <table>
      <thead><tr><th>Rendering</th><th>Page</th><th>Script</th><th>Works without JavaScript</th><th>Needs a server</th><th>Readings and notes in place</th><th>Same as the others</th></tr></thead>
      <tbody id="compare-rows"></tbody>
    </table>
  </dialog>

  <script id="demo-data" type="application/json">${JSON.stringify(data)}</script>
  <script src="shell.js" defer></script>
</body>
</html>
`);

console.log(`[build-demo] ✓ demo/site/index.html — ${resolved.length} path(s): ${resolved.map((p) => p.id).join(", ")}`);
