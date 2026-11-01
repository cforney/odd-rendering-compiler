#!/usr/bin/env node

/**
 * Search over an edition: the records of render-plain.mjs as a Pagefind index, with
 * a small page that queries it. Diplomatic text would hide its words from a reader,
 * who types "selig" for "ſelig", so index and query are folded alike: compatibility
 * forms and marks go, ß becomes ss. An excerpt therefore shows the folded text, and
 * a result's title the ODD's own. Pagefind runs in the browser and fetches its index,
 * so the page must be served over HTTP.
 *
 * Usage:   node search-index.mjs --records <records.json> [--pages <prefix>] [--out <dir>]
 *          --pages is where the rendered pages are, from the search page (default: beside it)
 * Output:  <dir>/search.html, <dir>/pagefind/
 * Read by: a browser
 */

import { existsSync, readFileSync, rmSync, statSync } from "fs";
import { join, resolve } from "path";
import { parseArgs, createLogger, writeOut, escapeXml } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("search-index");
const recordsPath = cli.get("--records") || "output/plain/records.json";
const pages = cli.get("--pages") || "";
const outDir = cli.get("--out") || "output/search";

/** The same in the index and in the query; written into the search page as it stands. */
const fold = (text) => text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss");

const pagefind = await import("pagefind").catch(() => {
  console.error("[search-index] ✗ the pagefind package is not installed: npm install pagefind");
  process.exit(1);
});

const records = JSON.parse(readFileSync(resolve(recordsPath), "utf8"));
// Pagefind asks for a language; the page's lang picks the same index.
const language = records[0]?.language ?? "en";
const { index, errors } = await pagefind.createIndex({ forceLanguage: language });
if (!index) throw new Error(`Pagefind: ${errors.join("; ")}`);
for (const { url, content, meta } of records) {
  const added = await index.addCustomRecord({ url, content: fold(content), language, meta });
  if (added.errors.length) throw new Error(`Pagefind, ${url}: ${added.errors.join("; ")}`);
}
// Pagefind adds to what a folder holds, and closing can outrun its last write, which leaves a page that finds nothing.
const bundle = resolve(outDir, "pagefind");
rmSync(bundle, { recursive: true, force: true });
const written = await index.writeFiles({ outputPath: bundle });
if (written.errors.length) throw new Error(`Pagefind: ${written.errors.join("; ")}`);
const entry = join(bundle, "pagefind-entry.json");
const complete = () => existsSync(entry) && statSync(entry).size > 0;
for (let tries = 0; tries < 100 && !complete(); tries++) await new Promise((r) => setTimeout(r, 100));
await pagefind.close();
if (!complete()) throw new Error(`Pagefind wrote no index: ${entry} is empty`);

const html = `<!DOCTYPE html>
<html lang="${escapeXml(language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search the edition</title>
  <style>
    body { max-width: 42em; margin: 2em auto; padding: 0 1em; font: 15px/1.6 system-ui, sans-serif; color: #222; background: #fefefe; }
    h1 { font-size: 1.2rem; }
    input { width: 100%; padding: 0.45em 0.6em; font: inherit; border: 1px solid #bbb; border-radius: 6px; }
    #status { color: #666; }
    ol { padding: 0; list-style: none; }
    li { padding: 0.6em 0; border-bottom: 1px solid #eee; }
    li a { display: block; font-weight: 600; color: #2563eb; }
    mark { background: #fef08a; }
  </style>
</head>
<body>
  <h1>Search the edition</h1>
  <noscript><p>Searching needs JavaScript. The pages of the edition do not.</p></noscript>
  <input id="query" type="search" aria-label="Search the edition" placeholder="A word of the text" autofocus>
  <p id="status" role="status"></p>
  <ol id="results"></ol>
  <script type="module">
    const fold = ${fold};
    const pages = ${JSON.stringify(pages)};
    const [input, status, results] = ["query", "status", "results"].map((id) => document.getElementById(id));
    let pagefind;
    try {
      pagefind = await import("./pagefind/pagefind.js");
      await pagefind.options({ baseUrl: "/" }); // or a result's URL starts at the index, not at the record's
    } catch {
      status.textContent = "The search index could not be loaded: this page must be served over HTTP.";
      input.disabled = true;
    }
    input.addEventListener("input", async () => {
      const found = await pagefind.debouncedSearch(fold(input.value));
      if (found === null) return; // a later keystroke replaced this search
      const hits = await Promise.all(found.results.map((r) => r.data()));
      status.textContent = input.value.trim() ? \`\${hits.length} document(s)\` : "";
      results.replaceChildren(...hits.map((hit) => {
        const item = document.createElement("li");
        const link = item.appendChild(document.createElement("a"));
        link.href = pages + hit.url.replace(/^\\//, "");
        link.textContent = hit.meta.title;
        item.appendChild(document.createElement("span")).innerHTML = hit.excerpt; // Pagefind's, with <mark> around the words
        return item;
      }));
    });
  </script>
</body>
</html>
`;
log(`✓ ${writeOut(outDir, "search.html", html)}, ${join(outDir, "pagefind")} (${records.length} record(s), ${language})`);
