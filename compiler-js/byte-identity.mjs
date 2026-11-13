#!/usr/bin/env node
/**
 * byte-identity.mjs — the equivalence gate between the renders.
 *
 * The renders of the same ODD must have the same <body> as an HTML parser reads
 * it, so how a serialiser spelled it does not count: attribute order, entities,
 * `<br/>` or `<br>`, comments. Of what the parser keeps, only two things are
 * dropped: whitespace between blocks or at their edges, and the banner naming
 * the path. That whitespace is kept inside a `pre` or `textarea`, or below an
 * inline style that sets `white-space: pre…`; whitespace a stylesheet preserves
 * cannot be seen from the HTML, so it is still dropped there. A space between
 * inline elements, in text or in an attribute value, counts. So the comparison
 * holds whichever engine wrote each file.
 *
 *   normaliseRenderedBody(html) → canonical string
 *   firstDifference(htmlA, htmlB) → null, or { kind, where, a, b }; kind is structure, text or attribute
 *   CLI:  node byte-identity.mjs <a.html> <b.html>   (exit 0 = equivalent)
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";

/** Whitespace is not rendered next to these, or at their edges. */
const BLOCK = new Set("article aside blockquote body div figcaption figure form h1 h2 h3 h4 h5 h6 li nav p section table td tr ul".split(" "));
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));

/** Whitespace is rendered as written inside these, and below an inline white-space: pre…. */
const PRESERVE = new Set(["pre", "textarea", "listing", "plaintext"]);
const preserves = (n) => PRESERVE.has(n.nodeName) || n.attrs.some((a) => a.name === "style" && /white-space\s*:\s*(pre|break-spaces)/i.test(a.value));

const isBlank = (n) => n.nodeName === "#text" && !/[^ \t\n\r\f]/.test(n.value);
const isBanner = (n) => n.tagName === "div" && n.attrs.some((a) => a.name === "class" && a.value === "render-info");

/** A parsed element as { tag, attrs, children }, a child such an element or its text as a string. */
function canonical(el, inPre = false) {
  const keep = inPre || preserves(el);
  const kept = el.childNodes.filter((n) => n.nodeName !== "#comment" && !isBanner(n));
  const blockAt = (n, edge) => (n ? BLOCK.has(n.nodeName) : edge);
  const edge = BLOCK.has(el.nodeName);
  const children = kept
    .filter((n, i) => keep || !isBlank(n) || !(blockAt(kept[i - 1], edge) || blockAt(kept[i + 1], edge)))
    .map((n) => (n.nodeName === "#text" ? n.value : canonical(n, keep)));
  const attrs = el.attrs.map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1));
  return { tag: el.tagName, attrs, children };
}

/** @param {string} html */
const bodyOf = (html) => {
  const root = /** @type {any} */ (parse(html).childNodes.find((n) => n.nodeName === "html"));
  return canonical(root.childNodes.find((n) => n.nodeName === "body"));
};

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function serialise(n) {
  if (typeof n === "string") return escapeText(n);
  const attrs = n.attrs.map(([k, v]) => ` ${k}="${escapeText(v).replace(/"/g, "&quot;")}"`).join("");
  return VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${n.children.map(serialise).join("")}</${n.tag}>`;
}

/** Canonical form of a rendered page's body, ignoring serialisation noise. */
export const normaliseRenderedBody = (html) => bodyOf(html).children.map(serialise).join("").trim();

const shown = (n) => (typeof n === "string" ? JSON.stringify(n.slice(0, 80)) : n ? `<${n.tag}>` : "nothing");

function differ(a, b, where) {
  if (typeof a === "string" && typeof b === "string") return a === b ? null : { kind: "text", where, a, b };
  if (typeof a !== typeof b || !a || !b || a.tag !== b.tag) return { kind: "structure", where, a: shown(a), b: shown(b) };
  const [x, y] = [JSON.stringify(a.attrs), JSON.stringify(b.attrs)];
  if (x !== y) return { kind: "attribute", where, a: x, b: y };
  for (let i = 0; i < Math.max(a.children.length, b.children.length); i++) {
    const child = a.children[i];
    const name = typeof child === "object" && child ? `${child.tag}${child.attrs.filter(([k]) => k === "class").map(([, v]) => `.${v.split(/\s+/)[0]}`).join("")}` : "text";
    const found = differ(a.children[i], b.children[i], `${where} > ${name}[${i}]`);
    if (found) return found;
  }
  return null;
}

/** Where two rendered pages first differ, or null where they are equivalent. */
export const firstDifference = (htmlA, htmlB) => differ(bodyOf(htmlA), bodyOf(htmlB), "body");

// --- CLI ---
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [, , pathA, pathB] = process.argv;
  if (!pathA || !pathB) {
    console.error("usage: node byte-identity.mjs <a.html> <b.html>");
    process.exit(2);
  }
  const found = firstDifference(readFileSync(pathA, "utf8"), readFileSync(pathB, "utf8"));
  if (!found) {
    console.log("✓ renders are equivalent");
    process.exit(0);
  }
  console.error(`✗ renders differ in ${found.kind} at ${found.where}`);
  console.error(`  A: ${found.a}`);
  console.error(`  B: ${found.b}`);
  process.exit(1);
}
