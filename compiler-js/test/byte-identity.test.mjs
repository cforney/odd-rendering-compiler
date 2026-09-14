/**
 * Byte-identity gate: each example rendered by the unified handlers, by the
 * stylesheet from odd-to-xslt.mjs (run by SaxonJS) and by the one from
 * compiler-xslt's odd-to-xsl.xsl (run by Saxon HE) must have an equivalent
 * static body (compared via byte-identity.mjs, which normalises attribute order
 * and whitespace).
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
