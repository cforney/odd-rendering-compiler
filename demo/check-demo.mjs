#!/usr/bin/env node

/**
 * Check in a real browser that the renderings of the assembled demo show the same
 * edition. In headless Chrome, for each example and rendering (with and without the
 * views, and without JavaScript where possible), the visible text and each text
 * run's place, font and colour must equal the first rendering's, and the pixels
 * nearly so. It also checks the manifest's other claims, the inspector's records and
 * the search. The IIIF manifest comes from a stored copy.
 *
 * Writes site/verified.json, which the demo's comparison reads, and exits 1 on a difference.
 *
 * Usage:   node --experimental-websocket demo/check-demo.mjs     (after build-demo; CHROME names the browser)
 * Needs:   Chrome, and network for the CDN scripts of some renderings
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "site");
const MANIFEST = readFileSync(resolve(SITE, "../../compiler-js/test/fixtures/iiif/simler-pages.json")).toString("base64");
const VIEWPORT = { width: 1100, height: 900 };
const RENDER_TIMEOUT = 20_000;
/** Text rasterises a little differently from one page load to the next; more than this is a real difference. */
const PIXEL_TOLERANCE = 0.0005;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".xsl": "application/xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = () => [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));

if (!existsSync(join(SITE, "index.html"))) throw new Error("no demo/site: run build-demo first");
if (!chromePath()) throw new Error("Chrome not found: set CHROME");

const data = JSON.parse(readFileSync(join(SITE, "index.html"), "utf8").match(/<script id="demo-data" type="application\/json">(.*)<\/script>/)[1]);
const renderings = data.paths.filter((p) => !p.report);

const server = createServer((req, res) => {
  const file = resolve(SITE, `.${decodeURIComponent(req.url.split("?")[0])}`);
  if (!file.startsWith(SITE) || !extname(file) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(0);
const pageUrl = (url) => `http://127.0.0.1:${server.address().port}/${url}`;

const profile = mkdtempSync(join(tmpdir(), "check-demo-"));
const chrome = spawn(chromePath(), [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars",
  ...(process.env.CI ? ["--no-sandbox"] : []), "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const debugUrl = await new Promise((ok, fail) => {
  let log = "";
  chrome.stderr.on("data", (d) => {
    log += d;
    const port = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/)?.[1];
    if (port) ok(`http://127.0.0.1:${port}/json`);
  });
  chrome.on("exit", () => fail(new Error(`Chrome exited: ${log}`)));
});
const target = (await (await fetch(debugUrl)).json()).find((t) => t.type === "page");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { socket.onopen = r; });

let lastId = 0;
const waiting = new Map();
socket.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === "Fetch.requestPaused") {
    cdp("Fetch.fulfillRequest", { requestId: d.params.requestId, responseCode: 200, body: MANIFEST, responseHeaders: [{ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Content-Type", value: "application/json" }] });
  }
};
const cdp = (method, params = {}) => new Promise((r) => {
  waiting.set(++lastId, r);
  socket.send(JSON.stringify({ id: lastId, method, params }));
});
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/manifest" }] });
await cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });

/** Open a page and wait until it has rendered; without JavaScript there is nothing to wait for. */
async function open(url, js = true) {
  await cdp("Emulation.setScriptExecutionDisabled", { value: !js });
  await cdp("Page.navigate", { url: pageUrl(url) });
  if (!js) await sleep(600);
  await cdp("Emulation.setScriptExecutionDisabled", { value: false }); // what evaluates here needs it; the page has loaded without
  if (!js) return;
  for (const start = Date.now(); Date.now() - start < RENDER_TIMEOUT; await sleep(100)) {
    if (await evaluate(`document.readyState === 'complete' && !document.querySelector('[v-cloak]') && document.querySelector('.tei-edition')?.getBoundingClientRect().height > 0`)) break;
  }
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(300);
}

/** What the edition shows: its text, and each run from its first to its last visible character. */
const MEASURE = `(() => {
  const root = document.querySelector('.tei-edition');
  if (!root) return null;
  const o = root.getBoundingClientRect();
  const runs = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const start = n.nodeValue.search(/\\S/);
    if (start < 0) continue;
    const r = document.createRange();
    r.setStart(n, start);
    r.setEnd(n, n.nodeValue.trimEnd().length);
    const rects = [...r.getClientRects()];
    if (!rects.length) continue;
    const s = getComputedStyle(n.parentElement);
    runs.push({ text: n.nodeValue.trim().slice(0, 40), x: rects[0].x - o.x, y: rects[0].y - o.y, right: rects.at(-1).right - o.x, font: s.fontFamily + s.fontSize + s.fontStyle + s.fontWeight, color: s.color });
  }
  return { text: root.innerText.replace(/\\s+/g, ' ').trim(), runs, clip: { x: o.x, y: o.y + scrollY, width: o.width, height: Math.min(o.height, 6000), scale: 1 } };
})()`;

async function measure(withShot) {
  const shown = await evaluate(MEASURE);
  if (shown && withShot) shown.shot = (await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: shown.clip })).result?.data;
  return shown;
}

const near = (a, b) => Math.abs(a - b) <= 1;
function difference(base, other) {
  if (!other) return "no edition";
  if (other.text !== base.text) {
    let i = 0;
    while (other.text[i] === base.text[i]) i++;
    return `text at ${i}: "${other.text.slice(Math.max(0, i - 25), i + 25)}", not "${base.text.slice(Math.max(0, i - 25), i + 25)}"`;
  }
  const i = base.runs.findIndex((r, k) => {
    const s = other.runs[k];
    return !s || r.text !== s.text || r.font !== s.font || r.color !== s.color || !near(r.x, s.x) || !near(r.y, s.y) || !near(r.right, s.right);
  });
  return i < 0 ? null : `"${base.runs[i].text}" looks or stands differently`;
}

/** Pixels differing between two shots, or null if their sizes differ. */
const pixelsApart = (a, b) => evaluate(`(async () => {
  const load = (d) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + d; });
  const [x, y] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
  if (x.width !== y.width || x.height !== y.height) return null;
  const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const [p, q] = [px(x), px(y)];
  let n = 0;
  for (let k = 0; k < p.length; k += 4) if (p[k] !== q[k] || p[k + 1] !== q[k + 1] || p[k + 2] !== q[k + 2]) n++;
  return n;
})()`);

const results = Object.fromEntries(renderings.map((p) => [p.id, []]));
const report = (path, doc, state, why) => {
  results[path.id].push(`${doc.label}, ${state}: ${why}`);
  console.log(`✗ ${path.id}, ${doc.id}, ${state}: ${why}`);
};

for (const doc of data.docs) {
  const records = data.inspect ? JSON.parse(readFileSync(join(SITE, "inspect", `${doc.id}.json`), "utf8")) : null;
  const notElements = JSON.stringify(data.notElements);
  const bases = {};
  const shots = [];
  for (const path of renderings) {
    const url = path.pages[doc.id]?.url;
    if (!url) continue;
    const compare = (state, shown) => {
      bases[state] ??= shown;
      const why = difference(bases[state], shown);
      if (why) report(path, doc, state, why);
      if (shown?.shot) shots.push({ path, state, shown, base: bases[state] });
    };

    await open(url);
    compare("as it opens", await measure(true));
    if (records) {
      const classes = await evaluate(`[...(document.querySelector('.tei-edition')?.querySelectorAll('[class]') ?? [])].map((e) => e.classList[0]).filter((c) => c.startsWith('tei-') && !${notElements}.includes(c))`);
      if (JSON.stringify(classes) !== JSON.stringify(records.map((r) => r.cls))) report(path, doc, "the inspector", "its records do not fit the elements rendered");
    }
    const acts = await evaluate(`(async () => {
      const wait = (n) => new Promise((r) => setTimeout(r, n));
      const alt = document.querySelector('.tei-alternate');
      let swaps = null;
      if (alt) { alt.scrollIntoView(); await wait(500); const before = alt.innerText; alt.click(); await wait(150); swaps = alt.innerText !== before; if (swaps) alt.click(); }
      const ref = document.querySelector('a.tei-note-ref');
      let tooltip = null, focus = null;
      if (ref) {
        ref.focus(); ref.click(); await wait(150); tooltip = !!document.querySelector('.tei-tooltip:not([hidden])')?.getClientRects().length;
        if (tooltip) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); focus = document.activeElement === ref; }
        ref.blur(); document.body.click();
      }
      // A link to an entry the ODD marks as a card opens it, titled by its first child.
      const name = [...document.querySelectorAll('a[href^="#"]')].find((a) => document.getElementById(a.getAttribute('href').slice(1))?.hasAttribute('data-card'));
      let card = null;
      if (name) {
        name.scrollIntoView(); await wait(300); name.click(); await wait(150);
        const entry = document.getElementById(name.getAttribute('href').slice(1));
        card = !!document.querySelector('.tei-tooltip:not([hidden])')?.getClientRects().length && document.querySelector('.tei-tooltip-title').textContent === entry.firstElementChild.textContent.trim();
        document.body.click();
      }
      const page = document.querySelector('[data-page]');
      let facsimile = null;
      if (page) { page.scrollIntoView(); await wait(500); page.click(); await wait(400); const src = document.querySelector('.tei-facsimile:not([hidden]) img')?.src; facsimile = !!src && (page.dataset.image ? src === page.dataset.image : src.endsWith('/' + page.dataset.page)); }
      return { swaps, tooltip, "focus back after Escape": focus, card, facsimile };
    })()`);
    for (const [name, did] of Object.entries(acts)) {
      if (did !== null && did !== path.interactive) report(path, doc, name, `the manifest says ${path.interactive ? "it does" : "it does not"}`);
    }

    await open(url);
    await evaluate("document.querySelectorAll('.tei-views input').forEach((b) => b.click())");
    await sleep(150);
    compare("with the views on", await measure(true));

    await open(url, false);
    const noJs = await measure(false);
    if (path.needsJs) {
      if (noJs) report(path, doc, "without JavaScript", "the manifest says it needs JavaScript");
      else if (!/needs JavaScript/.test(await evaluate("document.body.innerText"))) report(path, doc, "without JavaScript", "no message says why the page is empty");
    } else compare("without JavaScript", noJs);
  }
  await cdp("Page.navigate", { url: "about:blank" });
  for (const { path, state, shown, base } of shots) {
    if (shown === base) continue;
    const apart = await pixelsApart(base.shot, shown.shot);
    if (apart === null || apart > shown.clip.width * shown.clip.height * PIXEL_TOLERANCE) report(path, doc, state, `${apart ?? "all"} pixels differ`);
  }
}

// The search: a word as spelled today finds the old spelling, and as spelled then; its result opens.
const search = data.paths.find((p) => p.id === "search");
if (search) {
  const corpus = { id: "corpus", label: "All examples" };
  results[search.id] = [];
  await cdp("Page.navigate", { url: pageUrl(Object.values(search.pages)[0].url) });
  await sleep(1000);
  for (const word of ["selig", "ſelig", "waſſerfluß", "wasserfluss"]) {
    const hit = await evaluate(`(async () => {
      const input = document.getElementById('query');
      input.value = ${JSON.stringify(word)};
      input.dispatchEvent(new Event('input'));
      for (let i = 0; i < 40 && !document.querySelector('#results a'); i++) await new Promise((r) => setTimeout(r, 100));
      const link = document.querySelector('#results a')?.href;
      const opens = link && (await fetch(link)).ok;
      document.getElementById('results').replaceChildren();
      return { link, opens };
    })()`);
    if (!hit?.opens) report(search, corpus, `searching "${word}"`, hit?.link ? `${hit.link} does not open` : "nothing found");
  }
}

// The comparison opens, with a row per rendering and the builders merged.
await cdp("Page.navigate", { url: pageUrl("index.html") });
await sleep(800);
const compared = await evaluate(`(() => { document.getElementById('compare-open').click(); return { open: document.getElementById('compare').open, rows: document.querySelectorAll('#compare-rows tr').length, builders: document.querySelectorAll('#compare-rows th').length }; })()`);
const builders = new Set(renderings.map((p) => p.builder)).size;
if (!compared?.open || compared.rows !== renderings.length || compared.builders !== builders) {
  results[renderings[0].id].push(`the comparison: ${JSON.stringify(compared)}`);
  console.log(`✗ the comparison: ${JSON.stringify(compared)}`);
}

writeFileSync(join(SITE, "verified.json"), JSON.stringify({
  checked: new Date().toISOString().slice(0, 10), browser: (await (await fetch(debugUrl.replace("/json", "/json/version"))).json()).Browser,
  examples: data.docs.length, results,
}));
socket.close();
chrome.kill();
server.close();
await sleep(300);
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

const differences = Object.values(results).flat().length;
console.log(differences ? `[check-demo] ✗ ${differences} difference(s)` : `[check-demo] ✓ ${renderings.length} renderings of ${data.docs.length} examples show the same edition`);
process.exit(differences ? 1 : 0);
