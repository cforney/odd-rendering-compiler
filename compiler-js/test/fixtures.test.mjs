/**
 * Conformance fixtures: fixtures/tei/<case>.xml rendered by fixtures/pm.odd must
 * give fixtures/<case>.html, and for the plain output fixtures/<case>.plain.html
 * where one exists, compared as byte-identity.mjs compares renders. Every case
 * goes through the unified handlers; with Saxon HE 12 at $SAXON_HOME also
 * through the stylesheets of both XSLT generators.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
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
