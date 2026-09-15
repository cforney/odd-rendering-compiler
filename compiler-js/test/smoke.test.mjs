/**
 * End-to-end smoke tests for the canonical pipeline (odd-to-css →
 * odd-to-unified → render-unified), and the findings and plain text beside it,
 * on the Simler ODD and its excerpts, using only Node's built-in test runner.
 * Run with `npm test`.
 *
 * Each test asserts the rendered HTML contains what the ODD asks for, so a pass
 * means the pipeline ran end to end, not just that it exited 0. The behaviours
 * one by one are the business of fixtures.test.mjs.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readOdd } from "../odd-parser.mjs";

const pocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ODD = "../examples/tei_simler.odd";
const TOKENS = "../examples/simler-tokens.css";
const EXAMPLES = "../examples/simler-*.xml";

let outDir;

/** Run a build script from this directory; throws (failing the test) on error, else returns its output. */
function run(script, args) {
  return execFileSync(process.execPath, [script, ...args], { cwd: pocDir, encoding: "utf8" });
}
const page = (dir, name) => readFileSync(join(outDir, dir, `${name}.html`), "utf8");

before(() => {
  outDir = mkdtempSync(join(tmpdir(), "odd-smoke-"));
  run("odd-to-unified.mjs", ["--odd", ODD, "--out", outDir]);
});

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test("odd-to-css adds the design tokens and reports custom properties nothing defines", () => {
  assert.match(run("odd-to-css.mjs", ["--odd", ODD, "--out", join(outDir, "bare")]), /var\(--c-muted\) is defined nowhere/);
  const log = run("odd-to-css.mjs", ["--odd", ODD, "--tokens", TOKENS, "--out", outDir]);
  assert.doesNotMatch(log, /defined nowhere/, "the tokens define every custom property the ODD's CSS reads");

  const css = readFileSync(join(outDir, "edition.css"), "utf8");
  assert.match(css, /--c-muted: 106 102 95;/, "the tokens come first");
  assert.equal((css.match(/^\.r-/gm) || []).length, 20, "the 20 source renditions of <tagsDecl>");
  assert.match(css, /^\.r-twocol \{[^}]*display: grid/m, "the two-column grid rendition");
  assert.match(css, /^\.pb-group \{[^}]*display: flex/m, "a model group's rendition on its class");
  assert.match(css, /^\.pb-rule::before \{/m, "a scoped rendition as a pseudo-element");
  const on = (output) => `:is\\(\\[data-${output}='on'\\], :root:has\\(#view-${output}:checked\\)\\)`;
  assert.match(css, new RegExp(`^${on("entities")} \\.entity-person \\{`, "m"), "an output's CSS where that output is on");
  assert.match(css, new RegExp(`^${on("normalized")} \\.normalized-omit \\{ display: none; \\}`, "m"), "a view hides what it omits");
  assert.match(css, /^\.tei-tooltip \{/m, "the renderers' own furniture last");
});

test("render-unified renders every example, with an index", () => {
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", EXAMPLES, "--out", join(outDir, "unified")]);

  const psalms = page("unified", "simler-psalmen");
  assert.match(psalms, /<h5 class="tei-head head-first r-b r-c">/, "a heading one level below its fourth division");
  assert.match(psalms, /<span class="tei-pb pb-group pb-rule" data-page="4049203">\[4\]<\/span>/, "a page break as its labelled rule, with its image");
  assert.match(psalms, /<a class="tei-note note-anchored tei-note-ref" href="#note-1" data-range="a23">1<\/a>/, "a range note's marker");
  assert.match(psalms, /<section class="tei-footnotes">/, "the notes collected at the end");
  assert.match(psalms, /wort be<span class="tei-lb lb-hyphen normalized-omit">-<\/span><br class="tei-lb lb-hyphen normalized-omit">trachtet/,
    "at a joined line end one hyphen, the line break's, which the normalized view omits");

  const columns = page("unified", "simler-buchstabwechsel");
  assert.match(columns, /<div class="tei-lg lg-outer r-twocol">/, "the two-column grid");
  assert.match(columns, /<div class="tei-l l-twocol" style="--acro: 1; --fin: 1; --indent: 0">/, "an acrostic line with a closing letter");
  assert.match(columns, /<div class="tei-l l-twocol" style="--acro: 1; --fin: 0; --indent: 1">/, "an indented line in a column with acrostics");

  const notes = page("unified", "simler-hausswesen");
  assert.match(notes, /<span class="tei-note note-bibl r-et r-smaller">Tob\.[^<]*<span class="tei-anchor" id="a119"><\/span><span class="tei-unclear">17<\/span><a [^>]*href="#note-1"/,
    "a range note inside a printed Bible note");

  assert.match(page("unified", "simler-regenten-kleinodt"), /<div class="tei-note note-marginalia r-smaller">David bit<span class="tei-lb lb-hyphen normalized-omit">-<\/span>/,
    "a marginal gloss, with its joined line ends");

  const index = readFileSync(join(outDir, "unified", "index.html"), "utf8");
  for (const name of ["simler-psalmen", "simler-buchstabwechsel", "simler-hausswesen", "simler-regenten-kleinodt"]) {
    assert.match(index, new RegExp(`href="${name}\\.html"`));
  }
  assert.match(index, /<a href="simler-psalmen\.html">Haubtbegriff des erſten Pſalms, Psalms I–V \(C 1663, pp\. 4–5\)<\/a>/, "the title the page model gives");
  assert.match(index, /2 page image\(s\) · <a href="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049159\/manifest">IIIF manifest<\/a>/, "its page images and manifest");
});

test("render-unified lays the views over the page, each with a switch", () => {
  const columns = page("unified", "simler-buchstabwechsel");
  assert.match(columns, /<div class="tei-edition" data-web="on"><form class="tei-views"><label><input type="checkbox" id="view-entities"> entities<\/label><label><input type="checkbox" id="view-normalized"> normalized<\/label><\/form>/,
    "a checkbox per view, labelled by the output where its models have no <desc>");
  assert.match(columns, /<span class="tei-rs entity-person">/, "a view's model of the same behaviour adds its classes");

  const notes = page("unified", "simler-hausswesen");
  assert.match(notes, /<span class="tei-alternate-default normalized-alternate"><span class="tei-sic">f<\/span><\/span><span class="tei-alternate-alt normalized-default" hidden>/,
    "an alternate's readings marked as the view reads them");
  assert.match(notes, /<br class="tei-lb normalized-omit">/, "what a view omits is marked");
});

test("render-unified renders another output alone: the entities", () => {
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-buchstabwechsel.xml", "--out", join(outDir, "entities"), "--output", "entities"]);
  const body = page("entities", "simler-buchstabwechsel").split("<body>")[1];
  assert.match(body, /<div class="tei-edition" data-entities="on">/, "the output is on");
  assert.match(body, /<span class="tei-rs entity-person">/, "the output's model takes precedence");
  assert.doesNotMatch(body, /tei-views|normalized-/, "no views laid over it");
});

test("odd-to-ceteicean writes a page per example, over the unified runtime", () => {
  const out = join(outDir, "ceteicean");
  run("odd-to-ceteicean.mjs", ["--odd", ODD, "--tei", EXAMPLES, "--css", join(outDir, "edition.css"), "--out", out]);

  const context = vm.createContext({});
  vm.runInContext(`${readFileSync(join(out, "tei-ceteicean-behaviours.js"), "utf8")}
    this.twocol = teiModels.l[0].predicate; this.compiled = Object.keys(teiCompile(teiModels)).length; this.views = teiViews;`, context);
  assert.equal(context.twocol, "parent::lg[contains-token(@rendition, '#twocol')]", "the models keep their XPath");
  assert.ok(context.compiled > 40, "the inlined XPath module compiles every model");
  assert.deepEqual(Array.from(context.views, (v) => v.output), ["entities", "normalized"], "and the views");

  const html = readFileSync(join(out, "simler-buchstabwechsel.html"), "utf8");
  assert.match(html, /<script type="application\/xml" id="tei-source"><!--\n  Simler Digital/, "the TEI, in its script");
  assert.equal(html.split("<TEI ").length, 2, "and only there");
});

test("findings reports what the ODD does not foresee", () => {
  const tei = join(outDir, "flawed.xml");
  writeFileSync(tei, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>Flawed</title></titleStmt></fileDesc></teiHeader>
    <text><body><p rendition="#nowhere">A <foo>strange</foo> <rs type="alien">name</rs><note targetEnd="#missing">n</note><anchor xml:id="lonely"/><pb facs="1"/></p></body></text></TEI>`);
  const out = join(outDir, "findings");
  const log = run("findings.mjs", ["--odd", ODD, "--tei", tei, "--tei", "../examples/simler-psalmen.xml", "--out", out]);
  assert.match(log, /simler-psalmen\.xml: no findings/, "the excerpts are clean");

  const { odd, documents } = JSON.parse(readFileSync(join(out, "findings.json"), "utf8"));
  assert.ok(odd.includes("Custom property defined nowhere: var(--c-muted)"), "without the tokens, a custom property defined nowhere");
  assert.deepEqual(documents["flawed.xml"], [
    "Rendition not declared in the ODD: #nowhere",
    "No model in the ODD, rendered as its content: <foo>",
    `Value not in the ODD's list: <rs> type="alien"`,
    `Note range without its start: targetEnd="missing"`,
    "Anchor no note range starts at: lonely",
    "Page images without a IIIF manifest to resolve them",
  ]);
  assert.match(readFileSync(join(out, "flawed.html"), "utf8"), /<li>No model in the ODD, rendered as its content: &lt;foo&gt;<\/li>/, "and a page per document");
});

test("render-plain writes the plain output as text and as Pagefind records", () => {
  const out = join(outDir, "plain");
  run("render-plain.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-hausswesen.xml", "--lang", "de", "--out", out]);
  const text = readFileSync(join(out, "simler-hausswesen.txt"), "utf8");
  assert.doesNotMatch(text, /[<>]/, "no markup");
  assert.match(text, /Haußweſen/, "the text");

  const [record] = JSON.parse(readFileSync(join(out, "records.json"), "utf8"));
  assert.deepEqual({ ...record, content: undefined }, {
    url: "simler-hausswesen.html", content: undefined, language: "de",
    meta: { title: "Chriſtenliches Haußweſen, stanzas 1–4 (C 1663, pp. 321–322)" },
  });
  assert.equal(record.content, text.trim().replace(/\n/g, " "), "the text on one line");
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
  const out = join(outDir, "nested-pb");
  run("odd-to-unified.mjs", ["--odd", "../examples/extensions/nested-pb/tei_simler-nested-pb.odd", "--out", out]);
  run("render-unified.mjs", ["--handlers", join(out, "tei-handlers.mjs"), "--tei", "../examples/simler-psalmen.xml", "--out", out]);

  const html = readFileSync(join(out, "simler-psalmen.html"), "utf8");
  assert.match(html,
    /<a class="tei-pb pb-link" href="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/full\/0\/default\.jpg"><img class="tei-pb pb-thumbnail" src="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/pct:25\/0\/default\.jpg" alt=""><\/a>/,
    "the link wraps the thumbnail; both IIIF URLs come from @facs and the manifest");
  assert.match(html, /<h5 class="tei-head head-first r-b r-c">/, "the rest of the Simler ODD, through the chain");
});

test("render-unified-islands wraps the readings as islands and opens notes as tooltips", () => {
  const out = join(outDir, "islands");
  run("render-unified-islands.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-hausswesen.xml", "--css", join(outDir, "edition.css"), "--out", out]);

  const html = readFileSync(join(out, "simler-hausswesen.html"), "utf8");
  assert.match(html, /<tei-island type="choice" on="visible">/, "apparatus region wrapped as an island");
  assert.match(html, /<a class="tei-note note-anchored tei-note-ref" href="#note-1"/, "a note marker stays a link to its note");
  assert.match(html, /class="tei-footnotes"/, "the notes at the end (works with no JS)");
  assert.match(html, /a\.tei-note-ref\[href\^="#note-"\]/, "the shared notes script");
  assert.match(html, /<script src="tei-islands\.js" defer>/, "the generic runtime is shipped");

  const runtime = readFileSync(join(out, "tei-islands.js"), "utf8");
  assert.match(runtime, /customElements\.define\("tei-island"/, "runtime defines the island custom element");
});

test("readOdd resolves <specGrpRef> indirection (tei_simplePrint)", () => {
  // simplePrint composes its schema from seven <specGrpRef>s: 111 of its 119
  // elements carry a Processing Model, far more than any single <specGrp> holds.
  const { specs } = readOdd(resolve(pocDir, "../examples/tei_simplePrint.odd"));
  assert.equal(specs.length, 119, "every referenced spec reached the schema");
  assert.equal(specs.filter((s) => s.models.length).length, 111);
});
