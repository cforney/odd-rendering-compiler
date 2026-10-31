/**
 * Conformance fixtures: fixtures/tei/<case>.xml rendered by fixtures/pm.odd must
 * give fixtures/<case>.html, and for the plain output fixtures/<case>.plain.html
 * where one exists, compared as byte-identity.mjs compares renders. Every case
 * goes through the unified handlers; with Saxon HE 12 at $SAXON_HOME also
 * through the stylesheets of both XSLT generators.
 *
 * fixtures/invalid.odd is an ODD neither compiler can read: both must refuse it,
 * naming each problem.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { parseXmlToXast } from "../odd-parser.mjs";
import { toHtml, loadHandlers } from "../cli.mjs";
import { normaliseRenderedBody } from "../byte-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pocDir = resolve(here, "..");
const fixtures = join(here, "fixtures");
const odd = join(fixtures, "pm.odd");
const cases = readdirSync(join(fixtures, "tei")).map((f) => basename(f, ".xml"));
const OUTPUTS = ["web", "plain"];

/** The expected render of a case for an output, or null where the fixtures have none. */
function expected(name, output) {
  const file = join(fixtures, output === "web" ? `${name}.html` : `${name}.${output}.html`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function check(name, output, html) {
  const want = expected(name, output);
  if (want !== null) assert.equal(normaliseRenderedBody(html), normaliseRenderedBody(want), `${name} (${output})`);
}

let out;
before(() => { out = mkdtempSync(join(tmpdir(), "odd-fixtures-")); });
after(() => rmSync(out, { recursive: true, force: true }));

test("the unified handlers render the fixtures", async () => {
  execFileSync(process.execPath, ["odd-to-unified.mjs", "--odd", odd, "--out", out, "--strict"], { cwd: pocDir });
  const teiToHast = await loadHandlers(join(out, "tei-handlers.mjs"));
  for (const name of cases) {
    const tei = readFileSync(join(fixtures, "tei", `${name}.xml`), "utf8");
    for (const output of OUTPUTS) check(name, output, toHtml(teiToHast(parseXmlToXast(tei), { output }).hast));
  }
});

test("conformance.mjs runs the suite against a command, here the unified handlers", () => {
  const conformance = (...args) => spawnSync(process.execPath, ["conformance.mjs", ...args], { cwd: pocDir, encoding: "utf8" });
  const render = `node odd-to-unified.mjs --odd "{odd}" --out "{out}" && node render-unified.mjs --handlers "{out}/tei-handlers.mjs" --tei "{tei}" --output {output} --out "{out}"`;
  for (const level of ["strict", "structure"]) {
    const run = conformance("--run", render, "--level", level);
    assert.equal(run.status, 0, run.stdout);
    assert.match(run.stdout, /✓ params \(plain\)/, "an output other than web, where the suite expects one");
  }
  const none = conformance("--run", "exit 0");
  assert.equal(none.status, 1);
  assert.match(none.stdout, /✗ notes \(web\): the command wrote no notes\.html/);
});

/** What both compilers name in fixtures/invalid.odd, each with its line. @type {[number, string][]} */
const PROBLEMS = [
  [6, `<schemaSpec source="missing.odd">: not found`],
  [8, `<model> in <elementSpec ident="p"> has no @behaviour`],
  [9, `<param> in <elementSpec ident="p"> has no @name`],
  [11, `<modelSequence> in <elementSpec ident="p"> holds no <model>`],
  [13, `<elementSpec> has no @ident`],
];

test("the JS compiler refuses an ODD it cannot read, naming each problem and its line", () => {
  const refuse = (file) => spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", file, "--out", out], { cwd: pocDir, encoding: "utf8" });
  const invalid = refuse(join(fixtures, "invalid.odd"));
  assert.equal(invalid.status, 1);
  assert.deepEqual(invalid.stderr.trim().split("\n"), PROBLEMS.map(([line, p]) => `[odd-to-unified] ✗ invalid.odd:${line}: ${p}`));

  writeFileSync(join(out, "empty.odd"), `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p/></body></text></TEI>`);
  assert.match(refuse(join(out, "empty.odd")).stderr, /✗ empty\.odd: holds no <model>, so there is no Processing Model to compile/);
  writeFileSync(join(out, "broken.odd"), `<TEI>\n  <model>\n</TEI>`);
  assert.match(refuse(join(out, "broken.odd")).stderr, /✗ broken\.odd:3: not well-formed XML: Missing end tag for element model/);
});

const QUOTED_ODD = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><encodingDesc><tagsDecl><rendition xml:id="r">content:   "a  b";</rendition></tagsDecl></encodingDesc>
  <schemaSpec><elementSpec ident="p"><model behaviour="block"><outputRendition>--literal:  'a  \\'  b';
    color:  red;</outputRendition></model></elementSpec></schemaSpec></TEI>`;
const QUOTED_CSS = [`content: "a  b";`, `--literal: 'a  \\'  b'; color: red;`];

test("the JS compiler keeps the whitespace of a quoted CSS string", () => {
  const odd = join(out, "quoted.odd");
  writeFileSync(odd, QUOTED_ODD);
  execFileSync(process.execPath, ["odd-to-css.mjs", "--odd", odd, "--out", join(out, "quoted")], { cwd: pocDir });
  for (const css of QUOTED_CSS) assert.ok(readFileSync(join(out, "quoted", "edition.css"), "utf8").includes(css), css);
});

test("the JS compiler refuses an ODD that inherits from itself", () => {
  const refuse = (file) => spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", file, "--out", out], { cwd: pocDir, encoding: "utf8" });
  const chain = (name, source) => writeFileSync(join(out, name), `<TEI xmlns="http://www.tei-c.org/ns/1.0"><schemaSpec source="${source}"><elementSpec ident="p"><model behaviour="block"/></elementSpec></schemaSpec></TEI>`);
  chain("self.odd", "self.odd");
  assert.match(refuse(join(out, "self.odd")).stderr, /✗ self\.odd: inherits from itself: self\.odd → self\.odd/);
  chain("one.odd", "two.odd");
  chain("two.odd", "one.odd");
  assert.match(refuse(join(out, "one.odd")).stderr, /✗ one\.odd: inherits from itself: one\.odd → two\.odd → one\.odd/);
});

// Saxon HE 12 as build.sh finds it: the jar and its xmlresolver libraries.
const saxonHome = process.env.SAXON_HOME;
function saxon(...args) {
  const jar = readdirSync(saxonHome).find((f) => /^saxon-he-12.*\.jar$/.test(f) && !/test|xqj/.test(f));
  const libs = readdirSync(join(saxonHome, "lib")).filter((f) => f.startsWith("xmlresolver-")).map((f) => join(saxonHome, "lib", f));
  execFileSync("java", ["-cp", [join(saxonHome, jar), ...libs].join(delimiter), "net.sf.saxon.Transform", ...args], { stdio: "pipe" });
}

const GENERATORS = {
  "odd-to-xslt.mjs": (dir) =>
    execFileSync(process.execPath, ["odd-to-xslt.mjs", "--odd", odd, "--out", dir], { cwd: pocDir }),
  "odd-to-xsl.xsl": (dir) =>
    saxon(`-s:${odd}`, `-xsl:${resolve(pocDir, "../compiler-xslt/generate/odd-to-xsl.xsl")}`, `-o:${join(dir, "edition.xsl")}`),
};

test("the XSLT compiler refuses an ODD it cannot read, naming each problem", { skip: !saxonHome && "needs Saxon HE 12 at $SAXON_HOME" }, () => {
  const xsl = resolve(pocDir, "../compiler-xslt/generate/odd-to-xsl.xsl");
  assert.throws(() => saxon(`-s:${join(fixtures, "invalid.odd")}`, `-xsl:${xsl}`, `-o:${join(out, "invalid.xsl")}`), (/** @type {any} */ e) => {
    for (const [, p] of PROBLEMS) assert.ok(e.stderr.toString().includes(`invalid.odd: ${p}`), p);
    return true;
  });
});

test("the XSLT compiler refuses an ODD that inherits from itself", { skip: !saxonHome && "needs Saxon HE 12 at $SAXON_HOME" }, () => {
  const xsl = resolve(pocDir, "../compiler-xslt/generate/odd-to-xsl.xsl");
  const chain = (name, source) => writeFileSync(join(out, name), `<TEI xmlns="http://www.tei-c.org/ns/1.0"><schemaSpec source="${source}"><elementSpec ident="p"><model behaviour="block"/></elementSpec></schemaSpec></TEI>`);
  chain("one.odd", "two.odd");
  chain("two.odd", "one.odd");
  assert.throws(() => saxon(`-s:${join(out, "one.odd")}`, `-xsl:${xsl}`, `-o:${join(out, "cycle.xsl")}`), (/** @type {any} */ e) => {
    assert.match(e.stderr.toString(), /one\.odd: inherits from itself: one\.odd .+ two\.odd .+ one\.odd/);
    return true;
  });
});

test("the XSLT compiler keeps the whitespace of a quoted CSS string", { skip: !saxonHome && "needs Saxon HE 12 at $SAXON_HOME" }, () => {
  const odd = join(out, "quoted.odd");
  writeFileSync(odd, QUOTED_ODD);
  saxon(`-s:${odd}`, `-xsl:${resolve(pocDir, "../compiler-xslt/generate/odd-to-css.xsl")}`, `-o:${join(out, "quoted.css")}`, "tokens=");
  for (const css of QUOTED_CSS) assert.ok(readFileSync(join(out, "quoted.css"), "utf8").includes(css), css);
});

/** The fixtures' ODD with every TEI element prefixed: it must read, and render, the same. */
function prefixedOdd() {
  const file = join(out, "prefixed.odd");
  const xml = readFileSync(odd, "utf8").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(\/?)(?![\w.-]+:|[?!/])/g, "<$1tei:")
    .replace(`xmlns="http://www.tei-c.org/ns/1.0"`, `xmlns:tei="http://www.tei-c.org/ns/1.0"`);
  writeFileSync(file, xml);
  return file;
}

test("the JS compiler reads an ODD by its namespaces, however they are spelled", async () => {
  const dir = join(out, "prefixed-unified");
  execFileSync(process.execPath, ["odd-to-unified.mjs", "--odd", prefixedOdd(), "--out", dir, "--strict"], { cwd: pocDir });
  const teiToHast = await loadHandlers(join(dir, "tei-handlers.mjs"));
  for (const name of cases) {
    const tei = readFileSync(join(fixtures, "tei", `${name}.xml`), "utf8");
    for (const output of OUTPUTS) check(name, output, toHtml(teiToHast(parseXmlToXast(tei), { output }).hast));
  }
  writeFileSync(join(out, "undeclared.odd"), `<TEI xmlns="http://www.tei-c.org/ns/1.0"><x:model behaviour="block"/></TEI>`);
  const refused = spawnSync(process.execPath, ["odd-to-unified.mjs", "--odd", join(out, "undeclared.odd"), "--out", dir], { cwd: pocDir, encoding: "utf8" });
  assert.match(refused.stderr, /✗ undeclared\.odd: the namespace prefix of x:model is not declared/);
});

test("a document outside the TEI namespace takes no model, and findings says so", () => {
  const tei = join(out, "plain.xml");
  writeFileSync(tei, "<TEI><text><p>x</p></text></TEI>");
  execFileSync(process.execPath, ["findings.mjs", "--odd", odd, "--tei", tei, "--out", join(out, "plain-findings")], { cwd: pocDir });
  const { documents } = JSON.parse(readFileSync(join(out, "plain-findings", "findings.json"), "utf8"));
  assert.deepEqual(documents["plain.xml"], ["Root element not in the TEI namespace, so no model applies: <{}TEI>"]);
});

test("the stylesheet from a prefixed ODD renders the fixtures", { skip: !saxonHome && "needs Saxon HE 12 at $SAXON_HOME" }, () => {
  const dir = join(out, "prefixed-xsl");
  saxon(`-s:${prefixedOdd()}`, `-xsl:${resolve(pocDir, "../compiler-xslt/generate/odd-to-xsl.xsl")}`, `-o:${join(dir, "edition.xsl")}`);
  mkdirSync(join(dir, "web"), { recursive: true });
  saxon(`-s:${join(fixtures, "tei")}`, `-xsl:${join(dir, "edition.xsl")}`, `-o:${join(dir, "web")}`);
  for (const name of cases) check(name, "web", readFileSync(join(dir, "web", `${name}.xml`), "utf8"));
});

for (const [generator, generate] of Object.entries(GENERATORS)) {
  test(`the stylesheet from ${generator} renders the fixtures`, { skip: !saxonHome && "needs Saxon HE 12 at $SAXON_HOME" }, () => {
    const dir = join(out, generator);
    generate(dir);
    for (const output of OUTPUTS) {
      mkdirSync(join(dir, output), { recursive: true });
      saxon(`-s:${join(fixtures, "tei")}`, `-xsl:${join(dir, "edition.xsl")}`, `-o:${join(dir, output)}`, `output=${output}`);
      for (const name of cases) check(name, output, readFileSync(join(dir, output, `${name}.xml`), "utf8"));
    }
  });
}
