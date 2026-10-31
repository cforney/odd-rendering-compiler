/**
 * Byte-identity gate: each example rendered by the unified handlers, by the
 * stylesheet from odd-to-xslt.mjs (run by SaxonJS) and by the one from
 * compiler-xslt's odd-to-xsl.xsl (run by Saxon HE) must have an equivalent
 * static body (compared via byte-identity.mjs, which normalises attribute order
 * and the whitespace next to a block's tags).
 *
 * Needs the renders on disk; CI builds them first. Locally each example SKIPS unless:
 *   (compiler-js)   npm run build && npm run build:unified && npm run render:unified
 *                   npm run build:xslt && npm run render:xslt
 *   (compiler-xslt) bash build.sh        # Java + Saxon HE 12
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseRenderedBody } from "../byte-identity.mjs";

const pocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examples = readdirSync(resolve(pocDir, "../examples")).filter((f) => /^simler-.*\.xml$/.test(f)).map((f) => f.slice(0, -4));
const RENDERS = {
  unified: (doc) => resolve(pocDir, `output/unified/${doc}.html`),
  "odd-to-xslt.mjs": (doc) => resolve(pocDir, `output/xslt/${doc}.html`),
  "odd-to-xsl.xsl": (doc) => resolve(pocDir, `../compiler-xslt/output/xslt/${doc}.html`),
};

test("the comparison ignores serialisation, not what renders", () => {
  const same = (a, b) => normaliseRenderedBody(a) === normaliseRenderedBody(b);
  assert.ok(same(`<p b="2" a="1">x</p>`, `<p a="1" b="2">x</p>`), "attribute order");
  assert.ok(same(`<div>\n  <p>x</p>\n</div>\n`, `<div><p>x</p></div>`), "indentation between blocks");
  assert.ok(!same("<p><span>a</span> <span>b</span></p>", "<p><span>a</span><span>b</span></p>"), "a word separator");
  assert.ok(!same("<pre>a  b</pre>", "<pre>a b</pre>"), "a preserved space");
  assert.ok(!same(`<a href="#a  b">x</a>`, `<a href="#a b">x</a>`), "an attribute value");
  assert.ok(!same(`<a href="#a">x</a>`, `<a href="#b">x</a>`), "a link");
});

for (const doc of examples) {
  test(`${doc}: the unified and XSLT renders are equivalent (normalised byte-identity)`, (t) => {
    const files = Object.entries(RENDERS).map(([name, file]) => [name, file(doc)]);
    const missing = files.filter(([, file]) => !existsSync(file)).map(([, file]) => file);
    if (missing.length) {
      t.skip(`needs the renders — missing ${missing.join(", ")}`);
      return;
    }
    const [first, ...rest] = files.map(([name, file]) => [name, normaliseRenderedBody(readFileSync(file, "utf8"))]);
    for (const [name, body] of rest) assert.equal(body, first[1], `${name} differs from ${first[0]}`);
  });
}
