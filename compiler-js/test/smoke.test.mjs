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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { readOdd, parseXmlToXast } from "../odd-parser.mjs";
import { loadHandlers } from "../cli.mjs";
import { compileOdd, renderDocument, OddError } from "../index.mjs";
import { cssResidue } from "../findings.mjs";

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

test("odd-to-css counts the models CSS alone cannot render", () => {
  const models = [
    { behaviour: "inline", tag: "span", predicate: "parent::lg or ancestor::note" },
    { behaviour: "inline", tag: "span", predicate: "@rend='x'" },
    { behaviour: "note", predicate: null },
    { behaviour: "omit", predicate: "parent::titleStmt/parent::fileDesc" },
  ];
  assert.deepEqual(cssResidue(/** @type {any} */ ([{ models }])), [models[1], models[2]], "an attribute test, and a behaviour without a tag");
  assert.match(run("odd-to-css.mjs", ["--odd", ODD, "--out", join(outDir, "residue")]), /\b\d+ of 95 models need the renderers/);
});

test("odd-to-css adds the design tokens and reports custom properties nothing defines", () => {
  assert.match(run("odd-to-css.mjs", ["--odd", ODD, "--out", join(outDir, "bare")]), /var\(--c-muted\) is defined nowhere/);
  const log = run("odd-to-css.mjs", ["--odd", ODD, "--tokens", TOKENS, "--out", outDir]);
  assert.doesNotMatch(log, /defined nowhere/, "the tokens define every custom property the ODD's CSS reads");

  const css = readFileSync(join(outDir, "edition.css"), "utf8");
  assert.match(css, /--c-muted: 106 102 95;/, "the tokens come first");
  assert.equal((css.match(/^\.r-/gm) || []).length, 22, "the 22 source renditions of <tagsDecl>");
  assert.match(css, /^\.r-twocol \{[^}]*display: grid/m, "the two-column grid rendition");
  assert.match(css, /^\.pb-group \{[^}]*display: flex/m, "a model group's rendition on its class");
  assert.match(css, /^\.pb-rule::before \{/m, "a scoped rendition as a pseudo-element");
  const on = (output) => `:is\\(\\[data-${output}='on'\\], \\.tei-edition:has\\(> \\.tei-views input\\[data-view='${output}'\\]:checked\\)\\)`;
  assert.match(css, new RegExp(`^${on("entities")} \\.entity-person \\{`, "m"), "an output's CSS where that output is on");
  assert.match(css, new RegExp(`^${on("normalized")} \\.normalized-omit \\{ display: none; \\}`, "m"), "a view hides what it omits");
  assert.match(css, /^\.tei-tooltip \{/m, "the renderers' own furniture last");
});

test("render-unified renders every example, with an index", () => {
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", EXAMPLES, "--out", join(outDir, "unified")]);

  const psalms = page("unified", "simler-psalmen");
  assert.match(psalms, /<h5 class="tei-head head-first r-b r-c">/, "a heading one level below its fourth division");
  assert.match(psalms, /<span class="tei-pb pb-group pb-rule" data-image="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049203\/full\/!1000,1500\/0\/default\.jpg" data-page="4049203">\[4\]<\/span>/, "a page break as its labelled rule, with its image");
  assert.match(psalms, /<a class="tei-note note-anchored tei-note-ref" href="#note-1" data-range="a23">1<\/a>/, "a range note's marker");
  assert.match(psalms, /<section class="tei-footnotes">/, "the notes collected at the end");
  assert.match(psalms, /wort be<span class="tei-lb lb-hyphen normalized-omit">-<\/span><br class="tei-lb lb-hyphen normalized-omit">trachtet/,
    "at a joined line end one hyphen, the line break's, which the normalized view omits");

  const columns = page("unified", "simler-buchstabwechsel");
  assert.match(columns, /<div class="tei-lg lg-outer r-twocol">/, "the two-column grid");
  assert.match(columns, /<div class="tei-l l-twocol" style="--acro: 1; --fin: 1; --indent: 0">/, "an acrostic line with a closing letter");
  assert.match(columns, /<div class="tei-l l-twocol" style="--acro: 1; --fin: 0; --indent: 1">/, "an indented line in a column with acrostics");

  const notes = page("unified", "simler-hausswesen");
  assert.match(notes, /<span class="tei-note note-margin r-smaller r-et" data-margin="right">Tob\.[^<]*<span class="tei-anchor" id="a119"><\/span><span class="tei-unclear">17<\/span><a [^>]*href="#note-1"/,
    "a range note inside a printed Bible note");

  assert.match(page("unified", "simler-regenten-kleinodt"), /<span class="tei-note note-margin r-smaller" data-margin="right">David bit<span class="tei-lb lb-hyphen normalized-omit">-<\/span>/,
    "a marginal gloss, with its joined line ends");

  const index = readFileSync(join(outDir, "unified", "index.html"), "utf8");
  for (const name of ["simler-psalmen", "simler-buchstabwechsel", "simler-hausswesen", "simler-regenten-kleinodt"]) {
    assert.match(index, new RegExp(`href="${name}\\.html"`));
  }
  assert.match(index, /<a href="simler-psalmen\.html">Haubtbegriff des erſten Pſalms, Psalms I–V \(C 1663, pp\. 4–5\)<\/a>/, "the title the page model gives");
  assert.match(index, /2 page image\(s\) · <a href="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049159\/manifest">IIIF manifest<\/a>/, "its page images and manifest");
});

test("the library compiles and renders in memory, as the command lines do, and never exits", () => {
  const out = join(outDir, "library");
  run("odd-to-css.mjs", ["--odd", ODD, "--tokens", TOKENS, "--out", out, "--no-timestamp"]);
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", EXAMPLES, "--out", out]);
  const edition = compileOdd(join(pocDir, ODD), { tokens: readFileSync(join(pocDir, TOKENS), "utf8") });
  assert.equal(edition.css, readFileSync(join(out, "edition.css"), "utf8"), "the stylesheet odd-to-css writes");
  for (const name of readdirSync(join(pocDir, "../examples")).filter((f) => /^simler-.*\.xml$/.test(f))) {
    const { html, page: meta } = renderDocument(edition, readFileSync(join(pocDir, "../examples", name), "utf8"));
    assert.ok(page("library", name.replace(".xml", "")).includes(html), `${name}: the edition render-unified writes`);
    assert.ok(meta.title[0], "with the page model's params");
  }
  const bare = join(out, "bare.odd");
  writeFileSync(bare, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="b"><elementSpec ident="p" mode="change"/></schemaSpec></body></text></TEI>`);
  assert.throws(() => compileOdd(bare), OddError, "an ODD it cannot compile throws");

  // The published package is the root's: it carries runtime/ and the behaviour table, which compiler-js imports.
  const root = JSON.parse(readFileSync(join(pocDir, "../package.json"), "utf8"));
  const dev = JSON.parse(readFileSync(join(pocDir, "package.json"), "utf8"));
  for (const key of ["name", "version", "license", "engines", "dependencies", "optionalDependencies"]) assert.deepEqual(root[key], dev[key], `both package.json agree on ${key}`);
  assert.ok(dev.private, "only the root's is published");
  assert.ok(["runtime/", "behaviour-map.json"].every((f) => root.files.includes(f)));
  assert.ok([root.exports, root.bin["odd-render"]].every((f) => existsSync(join(pocDir, "..", f))));
});

test("render-unified lays the views over the page, each with a switch", () => {
  const columns = page("unified", "simler-buchstabwechsel");
  assert.match(columns, /<div class="tei-edition" data-web="on" data-manifest="[^"]+"><form class="tei-views"><label><input type="checkbox" data-view="entities"> Entitäten<\/label><label><input type="checkbox" data-view="normalized"> Normalisiert<\/label><\/form>/,
    "a checkbox per view, labelled by its models' <desc>");
  assert.match(columns, /<span class="tei-rs entity-person" data-key="person_[0-9]+">/, "a view's model of the same behaviour adds its classes");

  const notes = page("unified", "simler-hausswesen");
  assert.match(notes, /<span class="tei-alternate-default normalized-alternate"><span class="tei-sic">f<\/span><\/span><span class="tei-alternate-alt normalized-default" hidden>/,
    "an alternate's readings marked as the view reads them");
  assert.match(notes, /<br class="tei-lb normalized-omit">/, "what a view omits is marked");
});

test("render-unified renders another output alone: the entities", () => {
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-buchstabwechsel.xml", "--out", join(outDir, "entities"), "--output", "entities"]);
  const body = page("entities", "simler-buchstabwechsel").split("<body>")[1];
  assert.match(body, /<div class="tei-edition" data-entities="on"[^>]*>/, "the output is on");
  assert.match(body, /<span class="tei-rs entity-person">/, "the output's model takes precedence");
  assert.doesNotMatch(body, /tei-views|normalized-/, "no views laid over it");
});

test("odd-to-ceteicean writes a page per example, over the unified runtime", () => {
  const out = join(outDir, "ceteicean");
  run("odd-to-ceteicean.mjs", ["--odd", ODD, "--tei", EXAMPLES, "--css", join(outDir, "edition.css"), "--out", out]);

  const context = vm.createContext({});
  vm.runInContext(`${readFileSync(join(out, "tei-ceteicean-behaviours.js"), "utf8")}
    this.twocol = teiModels.l[0].predicate; this.compiled = Object.keys(teiCompile(teiModels)).length; this.views = teiViews;`, context);
  const fake = (attrs, kids = []) => ({ nodeType: 1, namespaceURI: "http://www.tei-c.org/ns/1.0", localName: "p", attributes: attrs, childNodes: kids });
  const xast = vm.runInContext(`var Node = { TEXT_NODE: 3, CDATA_SECTION_NODE: 4, ELEMENT_NODE: 1 }; teiXast`, context)(
    fake([{ name: "xmlns:t", prefix: "xmlns", namespaceURI: "http://www.w3.org/2000/xmlns/", localName: "t", value: "u" }, { name: "xml:id", prefix: "xml", namespaceURI: "http://www.w3.org/XML/1998/namespace", localName: "id", value: "i" }, { name: "f:n", prefix: "f", namespaceURI: "urn:f", localName: "n", value: "1" }],
      [{ ...fake([]), namespaceURI: "urn:f" }]));
  assert.equal(xast.name, "p", "the browser's tree names elements as the parser's does");
  assert.equal(xast.children[0].name, "{urn:f}p");
  assert.deepEqual({ ...xast.attributes }, { "xml:id": "i", "{urn:f}n": "1" });
  assert.equal(context.twocol, "parent::lg[contains-token(@rendition, '#twocol')]", "the models keep their XPath");
  assert.ok(context.compiled > 40, "the inlined XPath module compiles every model");
  assert.deepEqual(Array.from(context.views, (v) => v.output), ["entities", "normalized"], "and the views");

  const html = readFileSync(join(out, "simler-buchstabwechsel.html"), "utf8");
  const source = html.match(/<script type="application\/json" id="tei-source">(.*)<\/script>/)[1];
  assert.match(JSON.parse(source), /^<!--\n  Simler Digital[\s\S]*<TEI [\s\S]*<\/TEI>\s*$/, "the TEI, in its script, whole");
  assert.ok(!source.includes("<"), "with no markup a tool that rewrites pages could take for the page's");
  assert.equal(html.split("</body>").length, 2, "so the page has one </body>");
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
    `Note range without its start: missing`,
    "Anchor no note range starts at: lonely",
    "Page images without a IIIF manifest to resolve them",
  ]);
  assert.match(readFileSync(join(out, "flawed.html"), "utf8"), /<li>No model in the ODD, rendered as its content: &lt;foo&gt;<\/li>/, "and a page per document");
});

test("the facsimile finds a page's image in a IIIF manifest, version 2 or 3", () => {
  const context = { document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {} }, MutationObserver: class { observe() {} } };
  context.window = context;
  vm.runInNewContext(readFileSync(join(pocDir, "../runtime/facsimile.js"), "utf8"), context);
  const { imageOf } = context.TeiFacsimile;

  const v2 = JSON.parse(readFileSync(join(pocDir, "test/fixtures/iiif/e-rara-4049159.json"), "utf8"));
  const found = imageOf(v2, "4049203");
  assert.equal(found.image, "https://www.e-rara.ch/download/webcache/1000/4049203");
  assert.match(found.credit, /e-rara/);
  assert.equal(imageOf(v2, "9203"), null, "an identifier is a whole path segment");

  const body = { id: "https://x.org/full/7.jpg", type: "Image", service: [{ id: "https://x.org/img/7", type: "ImageService3" }] };
  const v3 = { requiredStatement: { label: { en: ["Credit"] }, value: { en: ["A library"] } }, rights: "https://rightsstatements.org/x", items: [{ id: "https://x.org/canvas/a", items: [{ items: [{ body }] }] }] };
  for (const id of ["a", "7", "https://x.org/canvas/a"]) assert.equal(imageOf(v3, id).image, body.id, id);
  assert.equal(imageOf(v3, "a").credit, "A library");
  assert.equal(imageOf(v3, "a").rights, v3.rights);
});

test("the facsimile asks again after a failed manifest", async () => {
  let asked = 0;
  const context = {
    document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {} }, MutationObserver: class { observe() {} }, Promise,
    fetch: async () => (++asked === 1 ? { ok: false, status: 500 } : { ok: true, json: async () => ({ items: [] }) }),
  };
  context.window = context;
  vm.runInNewContext(readFileSync(join(pocDir, "../runtime/facsimile.js"), "utf8"), context);
  await assert.rejects(context.TeiFacsimile.resolve("p", "https://x.org/manifest"));
  assert.equal(await context.TeiFacsimile.resolve("p", "https://x.org/manifest"), null, "the second opening reaches the manifest");
  assert.equal(asked, 2);
  await context.TeiFacsimile.resolve("p", "https://x.org/manifest");
  assert.equal(asked, 2, "and one that loaded stays loaded");
});

test("the edition names its manifest, and each example's page breaks are in the stored one", () => {
  run("odd-to-css.mjs", ["--odd", ODD, "--tokens", TOKENS, "--out", outDir]);
  const out = join(outDir, "manifest");
  run("render-unified.mjs", ["--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-psalmen.xml", "--css", join(outDir, "edition.css"), "--out", out]);
  const html = page("manifest", "simler-psalmen");
  assert.match(html, /class="tei-edition"[^>]*data-manifest="https:\/\/www\.e-rara\.ch\/i3f\/v20\/4049159\/manifest"/);
  assert.match(html, /data-page="4049203"/);
  assert.doesNotMatch(html, /<script/, "the static page stays without a script");
  assert.match(readFileSync(join(outDir, "edition.css"), "utf8"), /\.tei-facsimile/);
});

test("odd-render --search writes a search page and an index, linked from the index page", { skip: !existsSync(join(pocDir, "node_modules/pagefind")) && "pagefind not installed" }, () => {
  const out = join(outDir, "searched");
  run("odd-render.mjs", [ODD, EXAMPLES, "--tokens", TOKENS, "--lang", "de", "--search", "--out", out]);
  assert.ok(existsSync(join(out, "pagefind", "pagefind.js")), "the index");
  assert.equal(Object.keys(JSON.parse(readFileSync(join(out, "pagefind", "pagefind-entry.json"), "utf8")).languages).join(), "de", "whole, in the language asked for");
  const html = readFileSync(join(out, "search.html"), "utf8");
  assert.match(html, /<html lang="de">/, "the page's language picks the index");
  assert.match(html, /const fold = /, "the query is folded as the index is");
  assert.match(readFileSync(join(out, "index.html"), "utf8"), /<a href="search\.html">/);
  assert.doesNotMatch(readFileSync(join(out, "simler-psalmen.html"), "utf8"), /<script/, "the pages stay without a script");
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

test("odd-to-unified degrades XPath outside the subset, and --strict fails on it", () => {
  const odd = join(outDir, "bad.odd");
  writeFileSync(odd, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="x">
    <elementSpec ident="p" mode="change">
      <model predicate="@a | @b" behaviour="inline"><param name="content" value="let $x := . return $x"/></model>
      <model behaviour="block"/>
    </elementSpec>
  </schemaSpec></body></text></TEI>`);
  const out = join(outDir, "bad");
  run("odd-to-unified.mjs", ["--odd", odd, "--out", out]);

  assert.deepEqual(JSON.parse(readFileSync(join(out, "odd-unsupported.json"), "utf8")), [
    { element: "p", model: "p-1", where: "predicate", expression: "@a | @b", reason: `unexpected "|"`, odd: "bad.odd", line: 3 },
    { element: "p", model: "p-1", where: "param content", expression: "let $x := . return $x", reason: `cannot read "$x := . return $x"`, odd: "bad.odd", line: 3 },
  ], "the table names each expression, where it stands and the line it was written on");
  const handlers = readFileSync(join(out, "tei-handlers.mjs"), "utf8");
  assert.match(handlers, /predicate: xp\("false\(\)", "p-1, bad\.odd:3"\), params: \{ "content": xp\("\(\)", "p-1, bad\.odd:3"\) \}/,
    "a predicate degrades to false, a param to nothing — what a failing evaluation returns");

  const result = spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", odd, "--out", out, "--strict"], { cwd: pocDir, encoding: "utf8" });
  assert.notEqual(result.status, 0, "--strict fails the build");
  assert.match(result.stderr, /<p> \(p-1, bad\.odd:3\), predicate: XPath "@a \| @b"/, "naming the element, the model and where it was written");
});

test("render-json writes the ODD's decisions as records, with a table of the models that fired", () => {
  const out = join(outDir, "json");
  run("render-json.mjs", ["--odd", ODD, "--tei", "../examples/simler-psalmen.xml", "--out", out, "--strict"]);
  const { document, output, models, root } = JSON.parse(readFileSync(join(out, "simler-psalmen.json"), "utf8"));

  assert.deepEqual([document, output], ["simler-psalmen.xml", "web"]);
  assert.equal(root.element, "TEI");
  assert.deepEqual(root.children[0], { element: "teiHeader", model: "teiHeader-1", behaviour: "metadata", classes: ["tei-teiHeader"], outcome: "omitted", children: [] },
    "what the ODD omits is recorded, and stops there");

  const find = (node, element) =>
    node.element === element ? node : node.children.reduce((hit, c) => hit ?? (typeof c === "string" ? null : find(c, element)), null);
  assert.deepEqual(find(root, "pb"), {
    element: "pb", model: "pb-2", behaviour: "break", classes: ["tei-pb", "pb-group", "pb-rule"],
    params: { type: ["page"], "data-page": ["4049203"], "data-image": ["https://www.e-rara.ch/i3f/v20/4049203/full/!1000,1500/0/default.jpg"], label: ["[4]"] }, outcome: "rendered", children: [],
  }, "a record names the model that won, its classes and its params as evaluated");

  assert.equal(models["pb-2"].odd, "tei_simler.odd", "the side table says which ODD the model came from");
  assert.match(models["div-1"].predicate, /^preceding-sibling::/, "and its predicate");
  assert.deepEqual(models["lb-3"].parts, ["lb-4", "lb-5"], "a sequence is described with its parts");
  assert.ok(!("l-1" in models), "only the models the document made fire");
});

test("what renders is the ODD's to say: line joins, headings, ranges, the title, language and credit come from its models", () => {
  const out = join(outDir, "declared");
  mkdirSync(out, { recursive: true });
  const specs = {
    TEI: `<model behaviour="document"/><model output="page" behaviour="metadata"><param name="title" value="string(@n)"/><param name="lang" value="string(@type)"/><param name="credit" value="'Text: A &amp; B, CC BY 4.0'"/></model>`,
    div: `<model behaviour="block"/>`,
    p: `<model behaviour="paragraph"/>`,
    list: `<model behaviour="index"/>`,
    item: `<model behaviour="heading"/>`,
    head: `<model behaviour="block"/>`,
    milestone: `<model behaviour="anchor"/>`,
    seg: `<model behaviour="inline"><param name="range" value="@corresp"/></model>`,
    lb: `<model predicate="@break='no'" behaviour="break"><param name="type" value="'line'"/></model><model behaviour="break"><param name="type" value="'line'"/></model>`,
    ptr: `<model behaviour="break"><param name="type" value="'line'"/><param name="join" value="'~'"/></model>`,
  };
  const odd = join(out, "d.odd");
  writeFileSync(odd, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="d">${Object.entries(specs).map(([k, v]) => `<elementSpec ident="${k}" mode="change">${v}</elementSpec>`).join("")}</schemaSpec></body></text></TEI>`);
  const tei = join(out, "d.xml");
  writeFileSync(tei, `<TEI xmlns="http://www.tei-c.org/ns/1.0" n="Declared &amp; kept" type="la"><div><p>kept-<lb break="no"/>word gone~<ptr/>joined kept-<ptr/>x</p>
    <list><item>One</item><head>Not one</head><item>Two</item></list><milestone xml:id="m1"/><milestone xml:id="m2"/><seg corresp="#m1">s</seg><seg corresp="#m9">t</seg></div></TEI>`);
  run("odd-to-unified.mjs", ["--odd", odd, "--out", out]);
  run("render-unified.mjs", ["--handlers", join(out, "tei-handlers.mjs"), "--tei", tei, "--css", join(outDir, "edition.css"), "--out", out]);
  const html = readFileSync(join(out, "d.html"), "utf8");
  assert.match(html, /<title>Declared &amp; kept<\/title>/, "the title of the page model, escaped");
  assert.match(html, /<html data-mode="light" lang="la">/, "and its language");
  assert.match(html, /<footer class="tei-credit">Text: A &amp; B, CC BY 4.0<\/footer><\/div>/, "and its credit, closing the edition");
  assert.match(html, /kept-<br class="tei-lb">word/, "a break with no join keeps its line's hyphen, even as lb break=no");
  assert.match(html, /gone<br class="tei-ptr">joined/, "any element's model can join, with the characters it names");
  assert.match(html, /kept-<br class="tei-ptr">x/, "and only those");
  assert.match(html, /<li>One<\/li><li>Two<\/li>/, "an index lists what a model says is a heading, whatever the element");
  run("findings.mjs", ["--odd", odd, "--tei", tei, "--out", join(out, "findings")]);
  const [found] = Object.values(JSON.parse(readFileSync(join(out, "findings", "findings.json"), "utf8")).documents ?? {});
  const text = JSON.stringify(found ?? JSON.parse(readFileSync(join(out, "findings", "findings.json"), "utf8")));
  assert.match(text, /Note range without its start: m9/, "a range is the param's, whatever the attribute");
  assert.match(text, /Anchor no note range starts at: m2/, "an anchor the behaviour's, whatever the element");
  assert.doesNotMatch(text, /starts at: m1/);
});

test("the records are the render: what a page shows, no more and no less", () => {
  const out = join(outDir, "traced");
  mkdirSync(out, { recursive: true });
  const specs = {
    p: `<model behaviour="paragraph"><param name="content" value="'REPLACED'"/></model>`,
    ab: `<model behaviour="block"><param name="content" value="(hi[2], hi[1], hi[2])"/></model>`,
    hi: `<model behaviour="inline"/>`,
    del: `<model behaviour="omit"/>`,
    lb: `<model behaviour="break"><param name="type" value="'line'"/></model>`,
    seg: `<modelSequence><model predicate="@n" behaviour="inline"/><model predicate="not(@n)" behaviour="block"/></modelSequence>`,
    term: `<model predicate="@n" behaviour="inline"/>`,
    title: `<model behaviour="inline"><pb:template xmlns:pb="http://teipublisher.com/1.0">see [[content]] end</pb:template><param name="content" value="'T'"/></model>`,
    note: `<model behaviour="note"><param name="place" value="'foot'"/></model>`,
    choice: `<model behaviour="alternate"><param name="default" value="sic"/><param name="alternate" value="corr"/></model>`,
  };
  const odd = join(out, "t.odd");
  writeFileSync(odd, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="t">${Object.entries(specs).map(([k, v]) => `<elementSpec ident="${k}" mode="change">${v}</elementSpec>`).join("")}</schemaSpec></body></text></TEI>`);
  const tei = join(out, "d.xml");
  writeFileSync(tei, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><p><hi>GONE</hi></p><ab><hi>one</hi><hi>two</hi><del>skip</del></ab><div><lb/>a<del>out</del><seg n="1">s</seg><term>kept</term><title/><note>in <hi>n</hi></note><choice><sic>x</sic><corr>y</corr><del>not a reading</del></choice></div></TEI>`);
  run("render-json.mjs", ["--odd", odd, "--tei", tei, "--out", out]);
  const { models, root } = JSON.parse(readFileSync(join(out, "d.json"), "utf8"));
  const [p, ab, div] = root.children;
  const named = (name) => div.children.filter((c) => c.element === name);

  assert.deepEqual(p.children, ["REPLACED"], "a literal content: its text, and nothing of what it replaces");
  assert.deepEqual(ab.children.map((c) => c.children[0]), ["two", "one", "two"], "selected content in its own order, as often as selected");
  assert.equal(root.outcome, "passed-through", "no model: its content renders in its place");
  assert.deepEqual([named("lb")[0].outcome, named("del")[0].outcome], ["empty", "omitted"], "a model that gave nothing is not one that left out");
  assert.deepEqual(named("seg")[0].parts, ["seg-2"], "a sequence names the parts that ran");
  assert.deepEqual([named("term")[0].model, named("term")[0].outcome, named("term")[0].children], [null, "passed-through", ["kept"]], "no model applied");
  assert.deepEqual(named("title")[0].children, ["see ", "T", " end"], "a template's text");
  assert.deepEqual(named("note")[0].children.map((c) => c.element ?? c), ["in ", "hi"], "a note's body where the note is");
  assert.deepEqual(named("choice")[0].children.map((c) => c.element), ["sic", "corr"], "both readings of an alternate, and nothing else of it");
  assert.ok("del-1" in models, "what left it out did run");

  run("coverage.mjs", ["--odd", odd, "--records", out, "--out", join(out, "report")]);
  const { written, encoded } = JSON.parse(readFileSync(join(out, "report", "coverage.json"), "utf8"));
  assert.deepEqual(written.never.map((e) => e.model), ["seg-3", "term-1"], "the part of a sequence that stayed behind, and a model that never applied");
  assert.deepEqual(encoded.omitted, [{ element: "del", count: 1 }], "left out: of three, those a content param or an alternate passed over are not counted");
  assert.deepEqual(encoded.empty, [{ element: "lb", count: 1 }], "rendered as nothing");
  assert.deepEqual(encoded.silent, [{ element: "term", count: 1 }], "passed through");
  const page = readFileSync(join(out, "report", "index.html"), "utf8");
  for (const heading of ["Encoded, silent", "Left out", "Rendered as nothing"]) assert.ok(page.includes(`<h2>${heading}</h2>`), heading);
});

test("the records agree with the page on every example: the same text, notes in place of at the end", async () => {
  const out = join(outDir, "agree");
  run("render-json.mjs", ["--odd", ODD, "--tei", EXAMPLES, "--out", out]);
  const teiToHast = await loadHandlers(join(outDir, "tei-handlers.mjs"));
  const recordText = (r) => (typeof r === "string" ? r : r.children.map(recordText).join(""));
  const squeeze = (s) => [...s.replace(/\s+/g, "")].sort().join("");
  for (const file of readdirSync(out)) {
    const { root } = JSON.parse(readFileSync(join(out, file), "utf8"));
    const { hast } = teiToHast(parseXmlToXast(readFileSync(join(pocDir, "../examples", file.replace(".json", ".xml")), "utf8")));
    // What the renderer adds, or a param gives, is not text of the render.
    const added = (n) => n.tagName === "form" || n.properties.className?.some((c) => ["tei-note-ref", "tei-note-num", "tei-credit", "tei-pb", "tei-lb", "tei-cb", "tei-milestone"].includes(c));
    const body = (n) => (n.type === "text" ? n.value : added(n) ? "" : n.children.map(body).join(""));
    assert.equal(squeeze(recordText(root)), squeeze(body(hast)), file);
  }
});

test("coverage reads the ODD back against the records of a corpus", () => {
  const out = join(outDir, "cov");
  mkdirSync(out, { recursive: true });
  const odd = (name, body) => {
    const file = join(out, name);
    writeFileSync(file, body);
    return file;
  };
  odd("base.odd", `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="base">
    <elementSpec ident="p" mode="change"><model behaviour="block"/></elementSpec>
    <elementSpec ident="hi" mode="change"><model behaviour="inline"/></elementSpec>
  </schemaSpec></body></text></TEI>`);
  const chained = odd("cov.odd", `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="cov" source="base.odd">
    <elementSpec ident="TEI" mode="change"><model behaviour="text"/></elementSpec>
    <elementSpec ident="teiHeader" mode="change"><model behaviour="metadata"/></elementSpec>
    <elementSpec ident="text" mode="change"><model behaviour="text"/></elementSpec>
    <elementSpec ident="body" mode="change"><model behaviour="text"/></elementSpec>
    <elementSpec ident="l" mode="change"><model behaviour="block"/><model predicate="@n" behaviour="inline"/></elementSpec>
    <elementSpec ident="note" mode="change"><model predicate="@place='foot'" behaviour="note"/></elementSpec>
    <elementSpec ident="figure" mode="change"><model behaviour="block"/></elementSpec>
    <elementSpec ident="choice" mode="change"><model behaviour="alternate"><param name="default" value="sic"/><param name="alternate" value="corr"/></model></elementSpec>
  </schemaSpec></body></text></TEI>`);
  const tei = join(out, "doc.xml");
  writeFileSync(tei, `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>T</title></titleStmt></fileDesc></teiHeader>
    <text><body><p>Hi <foo>x</foo><note>n</note></p><l>line</l><choice><sic>s</sic><corr>c</corr></choice></body></text></TEI>`);
  run("render-json.mjs", ["--odd", chained, "--tei", tei, "--out", join(out, "records")]);
  run("coverage.mjs", ["--odd", chained, "--records", join(out, "records"), "--out", join(out, "report")]);

  const { written, encoded, inherited } = JSON.parse(readFileSync(join(out, "report", "coverage.json"), "utf8"));
  assert.deepEqual(written.never.map((e) => e.model), ["note-1"], "a model no document made fire");
  assert.deepEqual(written.unreachable.map((e) => [e.model, e.after]), [["l-2", "l-1"]],
    "and one that can never fire: an earlier model of the same output has no predicate");
  assert.deepEqual(written.absent.map((e) => e.element), ["figure"], "an element the ODD models but no record names");
  assert.deepEqual(encoded.unmodelled, [{ element: "foo", count: 1 }],
    "an element with no model — and nothing from inside the alternate, where an unrendered reading is a decision");
  assert.deepEqual(encoded.silent, [{ element: "note", count: 1 }], "a spec with models of which none applied: its content passes through, with no warning");
  assert.deepEqual(inherited.absent.map((e) => [e.element, e.odd]), [["hi", "base.odd"]], "what the chained ODD wrote is reported apart");
  assert.deepEqual(inherited.never, [], "its model for <p> did fire");

  assert.match(readFileSync(join(out, "report", "index.html"), "utf8"),
    /<li>&lt;l&gt; l-2 \(cov\.odd:6\) — predicate @n — after l-1, which has no predicate<\/li>/, "and a page beside the data");
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

test("the handlers can say which model gave each element they rendered", async () => {
  const teiToHast = await loadHandlers(join(outDir, "tei-handlers.mjs"));
  const tree = parseXmlToXast(readFileSync(resolve(pocDir, "../examples/simler-psalmen.xml"), "utf8"));
  const { sources } = teiToHast(tree, { trace: true });
  const models = [...sources.values()].map((s) => s.model.id);
  assert.ok(models.includes("pb-2"), "the model of a page break");
  assert.ok([...sources.values()].some((s) => s.pos.node.name === "pb"), "and where it stands");
  assert.equal(teiToHast(tree).sources.size, 0, "only when asked");
});

test("the petite-vue example leaves the alternate reading hidden, without JS and for the views' CSS", () => {
  const out = join(outDir, "interactive");
  run("render-unified.mjs", ["--enhance", "petite-vue", "--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-hausswesen.xml", "--css", join(outDir, "edition.css"), "--out", out]);
  const html = readFileSync(join(out, "simler-hausswesen.html"), "utf8");
  assert.match(html, /<span class="tei-alternate-alt normalized-default" hidden :hidden="!alt">/);
  assert.match(html, /<span class="tei-alternate-default normalized-alternate" :hidden="alt">/);
  assert.doesNotMatch(html, /v-show/, "an inline display would beat the view that chooses this reading");
});

test("an enhancer adds scripts to a page, and changes nothing of the edition", () => {
  const render = (name, ...enhance) => {
    run("render-unified.mjs", [...enhance, "--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-hausswesen.xml", "--css", join(outDir, "edition.css"), "--out", join(outDir, name)]);
    return page(name, "simler-hausswesen");
  };
  const edition = (html) => html.slice(html.indexOf('<div class="tei-edition"'), html.indexOf("<script") < 0 ? html.indexOf("</body>") : html.indexOf("<script"));
  const plain = render("floor");
  assert.doesNotMatch(plain, /<script/);
  for (const name of ["script", "islands"]) assert.equal(edition(render(`enhanced-${name}`, "--enhance", name)).trim(), edition(plain).trim(), name);
  assert.match(page("enhanced-script", "simler-hausswesen"), /tei-alternate-default[\s\S]*a\.tei-note-ref[\s\S]*TeiFacsimile/, "the small script brings all three behaviours inline");
  assert.equal(spawnSync(process.execPath, ["render-unified.mjs", "--enhance", "nope"], { cwd: pocDir }).status, 1, "an unknown enhancer is an error");
});

test("the islands enhancer finds its regions in the browser and opens notes as tooltips", () => {
  const out = join(outDir, "islands");
  run("render-unified.mjs", ["--enhance", "islands", "--handlers", join(outDir, "tei-handlers.mjs"), "--tei", "../examples/simler-hausswesen.xml", "--css", join(outDir, "edition.css"), "--out", out]);

  const html = readFileSync(join(out, "simler-hausswesen.html"), "utf8");
  assert.doesNotMatch(html, /<tei-island/, "nothing is marked at build time");
  for (const script of ["readings.js", "facsimile.js"]) assert.ok(existsSync(join(out, script)), `${script} waits beside the page`);
  assert.doesNotMatch(html, /TeiFacsimile/, "and is not in it");
  assert.match(html, /<a class="tei-note note-anchored tei-note-ref" href="#note-1"/, "a note marker stays a link to its note");
  assert.match(html, /class="tei-footnotes"/, "the notes at the end (works with no JS)");
  assert.match(html, /a\.tei-note-ref\[href\^="#note-"\]/, "the shared notes script");
  assert.match(html, /<script src="tei-islands\.js" defer>/, "the generic runtime is shipped");

  const runtime = readFileSync(join(out, "tei-islands.js"), "utf8");
  assert.match(runtime, /customElements\.define\("tei-island"/, "runtime defines the island custom element");
  assert.match(runtime, /mark\("\.tei-alternate", "choice", "visible"\)/, "and marks the readings by their class");
});

test("odd-render compiles and renders an edition in one command", () => {
  const out = join(outDir, "cli");
  const log = run("odd-render.mjs", [ODD, "../examples/simler-psalmen.xml", "--tokens", TOKENS, "--out", out, "--strict", "--reports", "--lang", "de"]);

  assert.match(readFileSync(join(out, "simler-psalmen.html"), "utf8"), /<h5 class="tei-head head-first r-b r-c">/, "the edition, rendered by the ODD");
  assert.match(readFileSync(join(out, "artefacts", "edition.css"), "utf8"), /--c-muted: 106 102 95;/, "the artefacts beside it, with the tokens");
  for (const report of ["plain", "json", "coverage", "findings"]) {
    assert.ok(readdirSync(join(out, "reports", report)).length, `the ${report} report`);
  }
  assert.match(log, /1 page\(s\) in .+ — the static tier of tei_simler\.odd/, "and one summary line");

  run("odd-render.mjs", [ODD, "../examples/simler-psalmen.xml", "--out", join(outDir, "cli-islands"), "--tier", "islands"]);
  assert.ok(existsSync(join(outDir, "cli-islands", "tei-islands.js")), "another tier brings its own runtime");

  const bad = spawnSync(process.execPath, ["odd-render.mjs", ODD, "nope.xml", "--out", out], { cwd: pocDir, encoding: "utf8" });
  assert.equal(bad.status, 1, "a source that is not there is an error, not an empty build");
  assert.match(bad.stderr, /TEI source not found: nope\.xml/);
});

test("odd-render refuses sources that would overwrite each other, before writing anything", () => {
  const dir = join(outDir, "clash");
  for (const sub of ["a", "b"]) mkdirSync(join(dir, sub), { recursive: true });
  const tei = (path) => {
    writeFileSync(join(dir, path), "<TEI/>");
    return join(dir, path);
  };
  const render = (name, ...sources) => ({ out: join(dir, name), ...spawnSync(process.execPath, ["odd-render.mjs", ODD, ...sources, "--out", join(dir, name)], { cwd: pocDir, encoding: "utf8" }) });
  const [a, b, index, upper] = [tei("a/text.xml"), tei("b/text.xml"), tei("index.xml"), tei("b/TEXT2.xml")];

  const same = render("same", a, b);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /text\.xml, .*text\.xml would write text\.html, the same page/);
  assert.ok(!existsSync(same.out), "nothing written");
  assert.match(render("case", upper, tei("a/text2.xml")).stderr, /would write text2\.html/, "names that differ only in case");
  assert.match(render("index", index, a).stderr, /index\.xml would write index\.html, the index of several sources/);

  assert.equal(render("alone", index).status, 0, "a lone index.xml has no index to overwrite");
  const twice = render("twice", a, join(dir, "b", "..", "a", "text.xml"));
  assert.equal(twice.status, 0, "one file under two spellings is one source");
  assert.match(twice.stdout, /✓ 1 page\(s\)/);
});

const scratchOdd = (name, specs, attrs = "", around = (s) => s) => {
  const file = join(outDir, name);
  writeFileSync(file, around(`<TEI xmlns="http://www.tei-c.org/ns/1.0"><schemaSpec ident="x"${attrs}>${specs}</schemaSpec></TEI>`));
  return file;
};
const P = `<elementSpec ident="p"><model behaviour="block"/></elementSpec>`;

test("only a view gets a switch, scoped to its edition; a channel renders alone", () => {
  const { views } = readOdd(scratchOdd("channels.odd", `${P}<elementSpec ident="hi">
    <model output="print" behaviour="omit"/><model output="latex" behaviour="omit"/><model output="opm-web" behaviour="omit"/><model output="orc-fo" behaviour="omit"/>
    <model output="reading" behaviour="omit"/><model behaviour="inline"/></elementSpec>`));
  assert.deepEqual(views.map((v) => v.output), ["reading"]);
  const out = join(outDir, "channels");
  run("odd-to-css.mjs", ["--odd", join(outDir, "channels.odd"), "--out", out]);
  const css = readFileSync(join(out, "edition.css"), "utf8");
  assert.ok(css.includes(".tei-edition:has(> .tei-views input[data-view='reading']:checked)) .reading-omit"), "two editions on a page switch apart");
  assert.doesNotMatch(css, /:root:has|#view-/);
});

test("a view that cannot be laid over the page is diagnosed", () => {
  const { diagnostics } = readOdd(scratchOdd("views.odd", `${P}<elementSpec ident="hi">
    <model output="a" behaviour="omit"/>
    <model output="b" behaviour="block"/>
    <model output="c" behaviour="inline"><param name="content" value="'x'"/></model>
    <model output="d" behaviour="inline"/>
    <model behaviour="inline"/></elementSpec>`));
  assert.deepEqual(diagnostics.map((d) => [d.code, d.model, d.severity]), [["view-unrealized", "hi-2", "warning"], ["view-unrealized", "hi-3", "warning"]]);
  assert.match(diagnostics[1].message, /view "c" changes the content/);
});

test("the chain resolves against @xml:base, stays local, and can be locked", () => {
  mkdirSync(join(outDir, "bases"), { recursive: true });
  writeFileSync(join(outDir, "bases", "base.odd"), `<TEI xmlns="http://www.tei-c.org/ns/1.0"><schemaSpec ident="b">${P}</schemaSpec></TEI>`);
  const child = scratchOdd("child.odd", "", ` source="base.odd" xml:base="bases/"`);
  const { specs, sources } = readOdd(child);
  assert.deepEqual(specs.map((s) => s.ident), ["p"]);
  assert.deepEqual(sources.map((s) => s.odd), ["base.odd", "child.odd"]);
  assert.match(sources[0].sha256, /^[0-9a-f]{64}$/);

  assert.throws(() => readOdd(scratchOdd("remote.odd", P, ` source="https://example.org/x.odd"`)), /remote\.odd:1: <schemaSpec source="https:\/\/example\.org\/x\.odd">: not a local file/);
  assert.throws(() => readOdd(scratchOdd("release.odd", P, ` source="tei:current"`)), /not a local file/);

  const lock = join(outDir, "chain.lock.json");
  const unified = (...args) => spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", child, "--out", join(outDir, "locked"), "--lock", lock, ...args], { cwd: pocDir, encoding: "utf8" });
  assert.equal(unified().status, 0, "the first run writes the lock");
  assert.equal(unified().status, 0, "and the next agrees");
  writeFileSync(join(outDir, "bases", "base.odd"), `<TEI xmlns="http://www.tei-c.org/ns/1.0"><schemaSpec ident="b">${P}<!-- changed --></schemaSpec></TEI>`);
  assert.match(unified().stderr, /the ODD chain does not match/);
});

test("diagnostics have codes and places, go to a file, and can fail the build", () => {
  const odd = scratchOdd("diag.odd", `<specGrpRef target="#gone"/><elementSpec ident="p"><modelGrp><model predicate="@a" behaviour="block"/></modelGrp><model behaviour="nonsense"/></elementSpec>
    <elementSpec ident="hi"><model predicate="let $x := 1 return $x" behaviour="inline"/></elementSpec>`);
  const out = join(outDir, "diag");
  const unified = (...args) => spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", odd, "--out", out, ...args], { cwd: pocDir, encoding: "utf8" });
  const quiet = unified();
  assert.equal(quiet.status, 0, "they do not fail it unasked");
  assert.match(quiet.stderr, /⚠ spec-group-unresolved diag\.odd:1: <specGrpRef target="#gone"> names no <specGrp>: skipped/);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "diagnostics.json"), "utf8")).map((d) => [d.code, d.severity]).sort(), [
    ["behaviour-unknown", "warning"], ["group-fallback", "info"], ["spec-group-unresolved", "warning"], ["xpath-unsupported", "warning"],
  ]);
  assert.equal(unified("--fail-on", "error").status, 0);
  const failed = unified("--fail-on", "warning");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /✗ 3 diagnostic\(s\) at --fail-on warning: spec-group-unresolved, behaviour-unknown, xpath-unsupported/);
  assert.equal(unified("--fail-on", "nope").status, 2);

  const tei = join(outDir, "diag.xml");
  writeFileSync(tei, `<p xmlns="http://www.tei-c.org/ns/1.0"/>`);
  const render = spawnSync(process.execPath, ["odd-render.mjs", odd, tei, "--out", join(outDir, "diag-render"), "--fail-on", "warning"], { cwd: pocDir, encoding: "utf8" });
  assert.equal(render.status, 1, "odd-render passes it on");
  assert.equal(render.stderr.match(/spec-group-unresolved diag/g)?.length, 1, "and one step prints the warnings");
  assert.ok(existsSync(join(outDir, "diag-render", "artefacts", "diagnostics.json")), "written before it fails");

  const several = readOdd(scratchOdd("several.odd", P, "", (s) => s.replace("</TEI>", `<schemaSpec ident="y"><elementSpec ident="hi"><model behaviour="inline"/></elementSpec></schemaSpec></TEI>`)));
  assert.deepEqual(several.specs.map((s) => s.ident), ["p", "hi"]);
  assert.deepEqual(several.diagnostics.map((d) => d.code), ["schema-spec-several"]);
});

test("an error in rendering names the document, the expression and the model", () => {
  const odd = scratchOdd("runtime.odd", `<elementSpec ident="p"><model predicate="(1, 2) eq 2" behaviour="block"/></elementSpec>`);
  const tei = join(outDir, "runtime.xml");
  writeFileSync(tei, `<p xmlns="http://www.tei-c.org/ns/1.0"/>`);
  const out = join(outDir, "runtime");
  run("odd-to-unified.mjs", ["--odd", odd, "--out", out]);
  const failed = spawnSync(process.execPath, ["render-unified.mjs", "--handlers", join(out, "tei-handlers.mjs"), "--tei", tei, "--out", out], { cwd: pocDir, encoding: "utf8" });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /runtime\.xml: XPath "\(1, 2\) eq 2" \(p-1, runtime\.odd:1\): eq compares single items, not 2/);
});

test("readOdd keeps a model's group, and says what it holds with no model", () => {
  const { specs } = readOdd(scratchOdd("kept.odd", `<elementSpec ident="p"><modelGrp><model predicate="@a" behaviour="block"/></modelGrp><modelGrp><model behaviour="block"/></modelGrp><model behaviour="inline"/></elementSpec>`));
  assert.deepEqual(specs[0].models.map((m) => m.group), [1, 2, undefined]);
  assert.throws(() => readOdd(scratchOdd("schema.odd", `<elementSpec ident="p"/>`)), /holds no <model>.*chain one: <schemaSpec source="tei_simplePrint\.odd">/);
});

test("readOdd resolves <specGrpRef> indirection (tei_simplePrint)", () => {
  // simplePrint composes its schema from seven <specGrpRef>s: 111 of its 119
  // elements carry a Processing Model, far more than any single <specGrp> holds.
  const { specs } = readOdd(resolve(pocDir, "../examples/tei_simplePrint.odd"));
  assert.equal(specs.length, 119, "every referenced spec reached the schema");
  assert.equal(specs.filter((s) => s.models.length).length, 111);
});
