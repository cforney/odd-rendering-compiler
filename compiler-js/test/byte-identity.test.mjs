/**
 * Byte-identity gate: the example edition rendered by the unified handlers, by
 * the stylesheet from odd-to-xslt.mjs and by the one from compiler-xslt's
 * odd-to-xsl.xsl must have an equivalent static body (compared via
 * byte-identity.mjs, which normalises attribute order and whitespace).
 *
 * Needs the renders on disk; CI builds them first. Locally it SKIPS unless:
 *   (compiler-js)   npm run build && npm run build:unified && npm run render:unified
 *                   npm run build:xslt && npm run render:xslt
 *   (compiler-xslt) bash build.sh        # Java + Saxon HE 12
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseRenderedBody } from "../byte-identity.mjs";

const pocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RENDERS = {
  unified: resolve(pocDir, "output/rendered-unified.html"),
  "odd-to-xslt.mjs": resolve(pocDir, "output/rendered-xslt.html"),
  "odd-to-xsl.xsl": resolve(pocDir, "../compiler-xslt/output/rendered-xslt.html"),
};

test("the unified and XSLT renders are equivalent (normalised byte-identity)", (t) => {
  const missing = Object.values(RENDERS).filter((f) => !existsSync(f));
  if (missing.length) {
    t.skip(`needs the renders — missing ${missing.join(", ")}`);
    return;
  }
  const [first, ...rest] = Object.entries(RENDERS).map(([name, file]) => [name, normaliseRenderedBody(readFileSync(file, "utf8"))]);
  for (const [name, body] of rest) assert.equal(body, first[1], `${name} differs from ${first[0]}`);
});
