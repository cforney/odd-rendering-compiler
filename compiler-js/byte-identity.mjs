#!/usr/bin/env node
/**
 * byte-identity.mjs — the JS↔XSLT equivalence gate.
 *
 * Both compilers render the same ODD; the <body> is identical modulo
 * serialisation (attribute order, generated note IDs, whitespace).
 * normaliseRenderedBody() strips exactly that, so the comparison holds whichever
 * engine (Saxon HE, SaxonJS, xslt-processor) produced each file.
 *
 *   normaliseRenderedBody(html) → canonical string
 *   CLI:  node byte-identity.mjs <a.html> <b.html>   (exit 0 = equivalent)
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Canonical form of a rendered page's body, ignoring serialisation noise. */
export function normaliseRenderedBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let b = m ? m[1] : html;

  // Drop the render-info banner (preview chrome, differs per path).
  b = b.replace(/<div class="render-info">[\s\S]*?<\/div>\s*/, "");

  // Re-key engine-generated note IDs by first-appearance order.
  const order = new Map();
  b = b.replace(/note-([A-Za-z0-9_.-]+)/g, (_, tok) => {
    if (!order.has(tok)) order.set(tok, `N${order.size + 1}`);
    return "note-" + order.get(tok);
  });

  // Sort each start tag's attributes (order is not significant).
  b = b.replace(/<([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*>/g, (_, tag, attrs) => {
    const sorted = (attrs.match(/[\w:-]+="[^"]*"/g) || []).sort();
    return "<" + tag + sorted.map((a) => " " + a).join("") + ">";
  });

  b = b.replace(/>\s+</g, "><");        // drop inter-tag whitespace
  return b.replace(/\s+/g, " ").trim(); // collapse the rest
}

/** Compare two rendered files; returns { equal, index, a, b }. */
export function compareRenders(pathA, pathB) {
  const a = normaliseRenderedBody(readFileSync(pathA, "utf8"));
  const b = normaliseRenderedBody(readFileSync(pathB, "utf8"));
  if (a === b) return { equal: true };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { equal: false, index: i, a, b };
}

// --- CLI ---
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [, , pathA, pathB] = process.argv;
  if (!pathA || !pathB) {
    console.error("usage: node byte-identity.mjs <a.html> <b.html>");
    process.exit(2);
  }
  const r = compareRenders(pathA, pathB);
  if (r.equal) {
    console.log("✓ renders are equivalent (normalised body byte-identical)");
    process.exit(0);
  }
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, r.index - 80), r.index + 80));
  console.error("✗ renders differ at normalised offset " + r.index);
  console.error("  A: " + ctx(r.a));
  console.error("  B: " + ctx(r.b));
  process.exit(1);
}
