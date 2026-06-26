/**
 * Byte-identity gate: the JS and XSLT compilers must render the same ODD into an
 * equivalent static body (compared via byte-identity.mjs, which normalises
 * attribute order, generated note IDs and whitespace).
 *
 * Needs both renders on disk; CI builds them first. Locally it SKIPS unless:
 *   (compiler-js)   npm run build:xslt && npm run render:xslt
 *   (compiler-xslt) bash build.sh        # Java + Saxon HE 12
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseRenderedBody } from "../byte-identity.mjs";

const pocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JS_RENDER = resolve(pocDir, "output/rendered-xslt.html");
const XSLT_RENDER = resolve(pocDir, "../compiler-xslt/output/rendered-xslt.html");

test("JS and XSLT renders are equivalent (normalised byte-identity)", (t) => {
  if (!existsSync(JS_RENDER) || !existsSync(XSLT_RENDER)) {
    t.skip(
      "needs both renders — run `npm run build:xslt && npm run render:xslt` " +
      "and `compiler-xslt/build.sh` (Saxon) first",
    );
    return;
  }
  const js = normaliseRenderedBody(readFileSync(JS_RENDER, "utf8"));
  const xslt = normaliseRenderedBody(readFileSync(XSLT_RENDER, "utf8"));
  assert.equal(
    js, xslt,
    "JS-emitted and XSLT-emitted renders differ after normalising attribute " +
    "order, generated note IDs and whitespace",
  );
});
