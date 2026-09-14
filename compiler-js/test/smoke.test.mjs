/**
 * End-to-end smoke tests for the canonical pipeline (odd-to-css →
 * odd-to-unified → render-unified) on the example ODDs, using only Node's
 * built-in test runner. Run with `npm test`.
 *
 * Each test asserts the rendered HTML contains what the ODD asks for, so a pass
 * means the pipeline ran end to end, not just that it exited 0. The behaviours
 * one by one are the business of fixtures.test.mjs.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOdd } from "../odd-parser.mjs";

const pocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ODD = "../examples/tei_simler.odd";
const TEI = "../examples/simler-poem.xml";

let outDir;

/** Run a build script from this directory; throws (failing the test) on error. */
function run(script, args) {
  execFileSync(process.execPath, [script, ...args], { cwd: pocDir, stdio: "pipe" });
}

before(() => {
  outDir = mkdtempSync(join(tmpdir(), "odd-smoke-"));
});

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test("odd-to-css generates edition.css from the ODD", () => {
  run("odd-to-css.mjs", ["--odd", ODD, "--out", outDir]);

  const css = readFileSync(join(outDir, "edition.css"), "utf8");
  assert.equal((css.match(/^\.r-/gm) || []).length, 19, "the 19 source renditions of <tagsDecl>");
  assert.match(css, /^\.r-twocol \{[^}]*display: grid/m, "the two-column grid rendition");
  assert.match(css, /^\.pb-group \{[^}]*display: flex/m, "a model group's rendition on its class");
  assert.match(css, /^\.pb-rule::before \{/m, "a scoped rendition as a pseudo-element");
});

test("odd-to-unified + render-unified produce a rendered edition", () => {
  run("odd-to-unified.mjs", ["--odd", ODD, "--out", outDir]);
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", TEI, "--out", outDir]);

  const html = readFileSync(join(outDir, "rendered-unified.html"), "utf8");
  assert.match(html, /<h1 class="tei-head">/, "heading rendered from <head>");
  assert.match(html, /<span class="tei-hi r-b r-c">/, "the source rendition where the model uses it");
  assert.match(html, /<a class="tei-note tei-note-ref" href="#note-1">1<\/a>/, "numbered note marker");
  assert.match(html, /<section class="tei-footnotes">/, "collected footnotes");
  assert.match(html, /class="tei-rs rs-1/, "entity rendered from the first <rs> model that fits");
  assert.match(html, /class="tei-choice tei-alternate/, "apparatus rendered from <choice>");
  assert.match(html, /<span class="tei-pb pb-group pb-rule" data-page="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203">\[194\]<\/span>/,
    "a page break as its labelled rule, carrying the page image");
});

test("odd-to-unified fails on XPath outside the subset, naming the model", () => {
  const odd = join(outDir, "bad.odd");
  writeFileSync(odd, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="x">
    <elementSpec ident="p" mode="change"><model behaviour="block"/><model predicate="@a | @b" behaviour="inline"/></elementSpec>
  </schemaSpec></body></text></TEI>`);
  const result = spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", odd, "--out", join(outDir, "bad")], { cwd: pocDir, encoding: "utf8" });
  assert.notEqual(result.status, 0, "the build fails");
  assert.match(result.stderr, /<p>, model 2: XPath "@a \| @b"/, "the error names the element and the model");
});

test("the nested page-break extension renders a facsimile thumbnail", () => {
  const ext = "../examples/extensions/nested-pb";
  const out = join(outDir, "nested-pb");
  run("odd-to-unified.mjs", ["--odd", `${ext}/tei_simler-nested-pb.odd`, "--out", out]);
  run("render-unified.mjs", ["--handlers", join(out, "tei-handlers.mjs"), "--tei", `${ext}/sample.xml`, "--out", out]);

  const html = readFileSync(join(out, "rendered-unified.html"), "utf8");
  assert.match(html,
    /<a class="tei-pb pb-link" href="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/full\/0\/default\.jpg"><img class="tei-pb pb-thumbnail" src="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/pct:25\/0\/default\.jpg" alt=""><\/a>/,
    "the link wraps the thumbnail; both IIIF URLs come from @facs and the manifest");
  assert.match(html, /<span class="tei-pb pb-rule">\[6\]<\/span>/, "without a facsimile, the page number");
  assert.match(html, /<div class="tei-l r-et">/, "the rest of the Simler ODD, through the chain");
});

test("render-unified-islands wraps interactive regions and ships the runtime", () => {
  run("render-unified-islands.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", TEI, "--css", join(outDir, "edition.css"), "--out", outDir]);

  const html = readFileSync(join(outDir, "rendered-unified-islands.html"), "utf8");
  assert.match(html, /<tei-island type="note" on="visible">/, "note region wrapped as an island");
  assert.match(html, /<tei-island type="choice" on="visible">/, "apparatus region wrapped as an island");
  assert.match(html, /class="tei-footnotes"/, "static footnote fallback preserved (works with no JS)");
  assert.match(html, /<script src="tei-islands\.js" defer>/, "the generic runtime is shipped");

  const runtime = readFileSync(join(outDir, "tei-islands.js"), "utf8");
  assert.match(runtime, /customElements\.define\("tei-island"/, "runtime defines the island custom element");
});

test("render-unified renders a corpus (glob) with an index", () => {
  const multiOut = join(outDir, "edition");
  run("render-unified.mjs", [
    "--handlers", join(outDir, "tei-handlers.mjs"),
    "--tei", "../examples/simler-*.xml", // a glob — passed literally (no shell here)
    "--css", join(outDir, "edition.css"),
    "--out", multiOut,
  ]);

  const buchst = readFileSync(join(multiOut, "simler-buchstabwechsel.html"), "utf8");
  assert.match(buchst, /class="tei-lg r-twocol"/, "the <lg> becomes the two-column grid container");
  assert.match(buchst, /class="tei-hi r-acroInit"/, "acrostic initials pinned to the margin cell");

  const index = readFileSync(join(multiOut, "index.html"), "utf8");
  assert.match(index, /href="simler-poem\.html"/);
  assert.match(index, /href="simler-buchstabwechsel\.html"/);
  assert.equal(existsSync(join(multiOut, "rendered-unified.html")), false, "multi mode uses per-source names");
});

test("readOdd resolves <specGrpRef> indirection (tei_simplePrint)", () => {
  // simplePrint composes its schema from seven <specGrpRef>s: 111 of its 119
  // elements carry a Processing Model, far more than any single <specGrp> holds.
  const { specs } = readOdd(resolve(pocDir, "../examples/tei_simplePrint.odd"));
  assert.equal(specs.length, 119, "every referenced spec reached the schema");
  assert.equal(specs.filter((s) => s.models.length).length, 111);
});
