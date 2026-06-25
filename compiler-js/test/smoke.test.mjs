/**
 * End-to-end smoke tests for the canonical pipeline (odd-to-css →
 * odd-to-unified → render-unified), using only Node's built-in test runner.
 * Run with `npm test`.
 *
 * Each test asserts the rendered HTML actually contains the expected output — a
 * heading, a footnote ref, a tagged entity, an apparatus, a compiled facsimile —
 * so a passing run means the pipeline ran end to end, not just exited 0. The
 * XSLT and CETEIcean paths need optional engines and are out of scope here.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

test("odd-to-css generates edition.css from the Processing Model", () => {
  run("odd-to-css.mjs", ["--odd", ODD, "--out", outDir]);

  const css = readFileSync(join(outDir, "edition.css"), "utf8");
  assert.match(css, /CSS generated from TEI ODD Processing Model/);
  // One rule block per element with a Processing Model (24 in the Simler ODD).
  assert.equal((css.match(/\/\* --- </g) || []).length, 24, "a rule block per PM element");
  // The 19 source-appearance renditions from <tagsDecl> compile to .r-* rules,
  // including the CSS-grid layout that reconstructs the acrostic pages.
  assert.equal((css.match(/^\.r-/gm) || []).length, 19, "source renditions compiled");
  assert.match(css, /\.r-twocol\s*\{[^}]*display:\s*grid/, "two-column grid rendition compiled from the ODD");
});

test("odd-to-unified + render-unified produce a rendered edition", () => {
  run("odd-to-unified.mjs", ["--odd", ODD, "--out", outDir]);
  run("render-unified.mjs", [
    "--handlers", join(outDir, "tei-handlers.mjs"),
    "--tei", TEI,
    "--out", outDir,
  ]);

  const html = readFileSync(join(outDir, "rendered-unified.html"), "utf8");
  assert.match(html, /<h1 class="tei-head"/, "heading rendered from <head>");
  assert.match(html, /class="tei-note-ref"/, "footnote reference rendered from <note>");
  assert.match(html, /class="tei-footnotes"/, "collected footnotes section present");
  assert.match(html, /class="tei-rs/, "tagged entity rendered from <rs>");
  assert.match(html, /class="tei-alternate/, "editorial apparatus rendered from <choice>");
});

test("Boot's nested model: Simler's <pb> compiles to a clickable facsimile", () => {
  // tei_simler.odd renders <pb facs> via a nested model (Boot 2024): a compound
  // link + graphic where the link WRAPS the graphic, so it is one clickable
  // thumbnail — and both IIIF image URLs are built from @facs inside the ODD.
  // Reuses the handlers/CSS built above.
  run("render-unified.mjs", [
    "--handlers", join(outDir, "tei-handlers.mjs"),
    "--tei", TEI,
    "--css", join(outDir, "edition.css"),
    "--out", outDir,
  ]);

  const html = readFileSync(join(outDir, "rendered-unified.html"), "utf8");
  assert.match(
    html,
    /<a class="tei-pb" href="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/full\/0\/default\.jpg"><figure class="tei-pb"><img src="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/pct:25\/0\/default\.jpg"/,
    "pb compiles to a clickable facsimile thumbnail (link wraps graphic)",
  );
});

test("render-unified renders a corpus (glob) with an index", () => {
  // Both Simler poems → one page per source plus a linking index. Reuses the
  // handlers + CSS the previous tests generated into outDir.
  const multiOut = join(outDir, "edition");
  run("render-unified.mjs", [
    "--handlers", join(outDir, "tei-handlers.mjs"),
    "--tei", "../examples/simler-*.xml", // a glob — passed literally (no shell here)
    "--css", join(outDir, "edition.css"),
    "--out", multiOut,
  ]);

  // One page per source, named after the source basename.
  const sample = readFileSync(join(multiOut, "simler-poem.html"), "utf8");
  const buchst = readFileSync(join(multiOut, "simler-buchstabwechsel.html"), "utf8");
  assert.match(sample, /<h1 class="tei-head"/, "first poem rendered");
  // The acrostic poem's two columns + marginal letters are CSS-grid renditions
  // from the ODD applied at render time.
  assert.match(buchst, /class="tei-lg r-twocol"/, "the <lg> becomes the two-column grid container");
  assert.match(buchst, /class="tei-hi r-acroInit"/, "acrostic initials pinned to the margin cell");

  // An index links both pages.
  const index = readFileSync(join(multiOut, "index.html"), "utf8");
  assert.match(index, /href="simler-poem\.html"/);
  assert.match(index, /href="simler-buchstabwechsel\.html"/);

  // Multi-file mode must NOT emit the single-file legacy filename.
  assert.equal(
    existsSync(join(multiOut, "rendered-unified.html")), false,
    "multi mode uses per-source names, not rendered-unified.html",
  );
});

test("odd-to-css resolves <specGrpRef> indirection (tei_simplePrint)", () => {
  // The TEI's simplePrint exemplar composes its schema through <specGrpRef>
  // (seven references) rather than inlining every <elementSpec>. Resolving it
  // is what lets the generator reach the full element set, so a successful run
  // with the expected rule count proves the resolver ran.
  const spOut = join(outDir, "simpleprint");
  run("odd-to-css.mjs", ["--odd", "../examples/tei_simplePrint.odd", "--out", spOut]);

  const css = readFileSync(join(spOut, "edition.css"), "utf8");
  // 111 of simplePrint's 119 elements carry a Processing Model → one rule block
  // each; far more than any single <specGrp> holds, so the references resolved.
  assert.equal((css.match(/\/\* --- </g) || []).length, 111, "all referenced specs reached the schema");
  assert.match(css, /\.tei-p\b/, "a spec pulled in via <specGrpRef> is present");
});
