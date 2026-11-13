/**
 * The equivalence gate: each example rendered by the unified handlers, by the
 * stylesheet from odd-to-xslt.mjs (run by SaxonJS) and by the one from
 * compiler-xslt's odd-to-xsl.xsl (run by Saxon HE) must have an equivalent static
 * body, as byte-identity.mjs reads it. A render older than what it is built from
 * fails: it says nothing of the code as it is now.
 *
 * Needs the renders on disk; CI builds them first. Locally each example SKIPS unless:
 *   (compiler-js)   npm run build && npm run build:unified && npm run render:unified
 *                   npm run build:xslt && npm run render:xslt
 *   (compiler-xslt) bash build.sh        # Java + Saxon HE 12
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseRenderedBody, firstDifference } from "../byte-identity.mjs";

const pocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examples = readdirSync(resolve(pocDir, "../examples")).filter((f) => /^simler-.*\.xml$/.test(f)).map((f) => f.slice(0, -4));
const RENDERS = {
  unified: (doc) => resolve(pocDir, `output/unified/${doc}.html`),
  "odd-to-xslt.mjs": (doc) => resolve(pocDir, `output/xslt/${doc}.html`),
  "odd-to-xsl.xsl": (doc) => resolve(pocDir, `../compiler-xslt/output/xslt/${doc}.html`),
};

/** The files a render is built from, whichever way. */
const SOURCES = [
  resolve(pocDir, "../behaviour-map.json"),
  ...["../runtime", "../compiler-xslt/generate"].flatMap((dir) => readdirSync(resolve(pocDir, dir)).map((f) => resolve(pocDir, dir, f))),
  ...readdirSync(pocDir).filter((f) => /^(odd-|render-|cli\.|unsupported\.)/.test(f)).map((f) => resolve(pocDir, f)),
];
const newest = (files) => Math.max(...files.map((f) => statSync(f).mtimeMs));

test("the comparison ignores serialisation, not what renders", () => {
  const same = (a, b) => normaliseRenderedBody(a) === normaliseRenderedBody(b);
  assert.ok(same(`<p b="2" a="1">x</p>`, `<p a="1" b="2">x</p>`), "attribute order");
  assert.ok(same(`<div>\n  <p>x</p>\n</div>\n`, `<div><p>x</p></div>`), "indentation between blocks");
  assert.ok(same("<p>a&nbsp;&#x17F;<br/>b<!-- c --></p>", "<p>a\u00a0ſ<br>b</p>"), "entities, void elements, comments");
  assert.ok(same(`<input checked><i HIDDEN="">x</i>`, `<input checked=""><i hidden>x</i>`), "how a boolean attribute is spelled");
  assert.ok(same(`<div class="render-info"><div>one</div></div><p>x</p>`, "<p>x</p>"), "the banner, with what it holds");
  assert.ok(!same("<p>a<!-- c --> b</p>", "<p>ab</p>"), "a space beside a comment");
  assert.ok(!same("<p><i>a</i></p>", "<p><b>a</b></p>"), "an element");
  assert.ok(!same(`<p class="a b">x</p>`, `<p class="b a">x</p>`), "the order of classes, which an attribute value keeps");
  assert.ok(!same("<p><span>a</span> <span>b</span></p>", "<p><span>a</span><span>b</span></p>"), "a word separator");
  assert.ok(!same("<pre>a  b</pre>", "<pre>a b</pre>"), "a preserved space");
  assert.ok(!same(`<div style="white-space:pre"> <span>x</span> </div>`, `<div style="white-space:pre"><span>x</span></div>`), "spaces at a block's edges that an inline style preserves");
  assert.ok(!same("<pre> <span>x</span> </pre>", "<pre><span>x</span></pre>"), "spaces at the edges of a pre");
  assert.ok(!same(`<a href="#a  b">x</a>`, `<a href="#a b">x</a>`), "an attribute value");
  assert.ok(!same(`<a href="#a">x</a>`, `<a href="#b">x</a>`), "a link");

  const page = (body) => `<div class="tei-edition"><p>one</p><p>${body}</p></div>`;
  assert.equal(firstDifference(page("<i>x</i>"), page("<i>x</i>")), null);
  assert.deepEqual(firstDifference(page("a"), page("b")), { kind: "text", where: "body > div.tei-edition[0] > p[1] > text[0]", a: "a", b: "b" });
  assert.equal(firstDifference(page("<i>x</i>"), page("<b>x</b>")).kind, "structure");
  assert.equal(firstDifference(page(`<i id="a"></i>`), page(`<i id="b"></i>`)).kind, "attribute");
});

for (const doc of examples) {
  test(`${doc}: the unified and XSLT renders are equivalent`, (t) => {
    const files = Object.entries(RENDERS).map(([name, file]) => [name, file(doc)]);
    const missing = files.filter(([, file]) => !existsSync(file)).map(([, file]) => file);
    if (missing.length) {
      t.skip(`needs the renders — missing ${missing.join(", ")}`);
      return;
    }
    const built = newest([...SOURCES, resolve(pocDir, "../examples/tei_simler.odd"), resolve(pocDir, `../examples/${doc}.xml`)]);
    for (const [name, file] of files) assert.ok(statSync(file).mtimeMs >= built, `${name} is older than what it is built from: rebuild it (${file})`);
    const [[firstName, firstFile], ...rest] = files;
    const html = (file) => readFileSync(file, "utf8");
    for (const [name, file] of rest) {
      const found = firstDifference(html(firstFile), html(file));
      assert.equal(found, null, found && `${name} differs from ${firstName} in ${found.kind} at ${found.where}: ${found.b}, not ${found.a}`);
    }
  });
}

// An enhancer adds scripts: the XSLT path's pages hold the edition of its static page.
test("the XSLT path's enhancers leave the edition as it is", (t) => {
  const dir = resolve(pocDir, "../compiler-xslt/output");
  const edition = (html) => { const from = html.indexOf('<div class="tei-edition"'); return html.slice(from, from + html.slice(from).search(/<script|<\/body>/)); };
  const pages = (name) => readdirSync(resolve(dir, name)).filter((f) => f.startsWith("simler-") && f.endsWith(".html"));
  if (!existsSync(resolve(dir, "xslt-islands"))) return t.skip("needs the XSLT build");
  for (const enhanced of ["xslt-script", "xslt-islands"]) {
    for (const page of pages("xslt")) {
      assert.equal(edition(readFileSync(resolve(dir, enhanced, page), "utf8")), edition(readFileSync(resolve(dir, "xslt", page), "utf8")), `${enhanced}/${page}`);
    }
  }
});

test("an enhancer adds the same scripts on either compiler's page", (t) => {
  const scripts = (dir) => {
    const html = readFileSync(resolve(dir, "simler-psalmen.html"), "utf8");
    const on = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => attrs.match(/src="([^"]+)"/)?.[1] ?? body.trim());
    return { on: on.sort(), beside: readdirSync(dir).filter((f) => f.endsWith(".js")).sort() };
  };
  if (!existsSync(resolve(pocDir, "../compiler-xslt/output/xslt-islands"))) return t.skip("needs the XSLT build");
  for (const enhance of ["script", "islands"]) {
    assert.deepEqual(scripts(resolve(pocDir, "../compiler-xslt/output", `xslt-${enhance}`)), scripts(resolve(pocDir, "output", `unified-${enhance}`)), enhance);
  }
});
