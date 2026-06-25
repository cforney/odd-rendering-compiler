/**
 * Shared ODD extraction library used by every generator. Wraps
 * @rgrove/parse-xml and exposes the parsers (createOddParser, parseXmlToXast,
 * parseXmlToPreserveOrder), the spec finders (findElementSpecs, findClassSpecs),
 * the model/attribute extractors (extractModels, extractAttDefs,
 * extractRenditions), and small helpers (arr, textContent, extractTeiTitle).
 */

import { parseXml } from "@rgrove/parse-xml";

// ---------------------------------------------------------------------------
// XML Parser factory
// ---------------------------------------------------------------------------
// parse-xml returns a clean, ordered node tree. createOddParser() adapts it to
// the object shape the extractors expect; parseXmlToXast()/
// parseXmlToPreserveOrder() expose the two tree shapes the renderers consume.

const DEFAULT_ARRAY_TAGS = [
  "elementSpec", "model", "modelSequence", "modelGrp",
  "outputRendition", "param", "attDef", "valItem",
  "remarks", "exemplum", "specGrp", "specGrpRef",
  "elementRef", "classRef", "classSpec", "moduleRef",
  "constraintSpec", "egXML", "p", "desc", "rendition",
];

/**
 * Adapt a parse-xml element to the object shape the extractors expect:
 *   - attributes become `@_<name>` string properties;
 *   - direct text segments are each trimmed, then concatenated into `#text`;
 *   - a text-only, attribute-less element collapses to that string;
 *   - children are keyed by name (array when in `arrayTags` or repeated),
 *     in document order, followed by `#text`, then `@_` attributes.
 */
function buildValue(el, arrayTags) {
  const childEls = [];
  let text = "";
  for (const n of el.children) {
    if (n.type === "element") childEls.push(n);
    else if (n.type === "text" || n.type === "cdata") text += (n.text || "").trim();
  }
  const attrNames = Object.keys(el.attributes || {});
  if (childEls.length === 0 && attrNames.length === 0) return text;

  const obj = {};
  for (const child of childEls) {
    const name = child.name;
    const val = buildValue(child, arrayTags);
    if (arrayTags.has(name)) {
      (obj[name] ||= []).push(val);
    } else if (Object.prototype.hasOwnProperty.call(obj, name)) {
      if (!Array.isArray(obj[name])) obj[name] = [obj[name]];
      obj[name].push(val);
    } else {
      obj[name] = val;
    }
  }
  if (text !== "") obj["#text"] = text;
  for (const k of attrNames) obj["@_" + k] = el.attributes[k];
  return obj;
}

/**
 * Resolve `<specGrpRef target="#id"/>` indirection within a single document.
 *
 * Many ODDs keep reusable specs in `<specGrp xml:id="…">` blocks and pull them
 * into the schema with `<specGrpRef target="#id"/>` rather than inlining every
 * `<elementSpec>` (the TEI's own tei_simplePrint uses seven references). This
 * expands each reference in place, in reference order, so the extractors see the
 * composed schema.
 *
 * Single-document scope, not full odd2odd flattening:
 *   - external `@source` modules are not fetched;
 *   - an addressable `<specGrp xml:id>` contributes only where referenced (an
 *     unreferenced group is skipped, not merged);
 *   - a `<specGrp>` without `xml:id` is an inline grouping, kept in place;
 *   - a missing target is dropped with a warning;
 *   - cycles are broken by a visited-set guard;
 *   - a group referenced more than once is expanded each time.
 *
 * Returns a rewritten copy of the root, or the original tree unchanged when the
 * document has no `<specGrpRef>`.
 *
 * @param {object} root — a parse-xml element node (the document root)
 * @param {(msg:string)=>void} [warn] — sink for unresolved/cyclic warnings
 */
export function resolveSpecGrpRefs(root, warn = (m) => console.error(m)) {
  let hasRef = false;
  const byId = new Map();
  (function scan(el) {
    if (!el || el.type !== "element") return;
    if (el.name === "specGrpRef") hasRef = true;
    if (el.name === "specGrp" && el.attributes?.["xml:id"]) {
      byId.set(el.attributes["xml:id"], el);
    }
    for (const c of el.children || []) scan(c);
  })(root);

  if (!hasRef) return root; // no indirection → unchanged (back-compatible)

  const expand = (target, seen) => {
    const id = (target || "").replace(/^#/, "");
    if (!id) return [];
    if (!byId.has(id)) {
      warn(`[odd-parser] specGrpRef target not found in document: #${id} (skipped)`);
      return [];
    }
    if (seen.has(id)) {
      warn(`[odd-parser] cyclic specGrpRef ignored: #${id}`);
      return [];
    }
    return rewrite(byId.get(id).children || [], new Set(seen).add(id));
  };

  // Rebuild element nodes explicitly rather than spreading: parse-xml exposes
  // `type` as a prototype getter, which object spread would drop.
  const cloneEl = (el, children) => ({
    type: "element", name: el.name, attributes: el.attributes, children,
  });

  function rewrite(children, seen) {
    const out = [];
    for (const c of children) {
      if (c.type === "element" && c.name === "specGrpRef") {
        out.push(...expand(c.attributes?.target, seen));
      } else if (c.type === "element" && c.name === "specGrp" && c.attributes?.["xml:id"]) {
        // addressable library group — included only via its references
      } else if (c.type === "element") {
        out.push(cloneEl(c, rewrite(c.children || [], seen)));
      } else {
        out.push(c); // text / cdata / comment — left as-is
      }
    }
    return out;
  }

  return cloneEl(root, rewrite(root.children || [], new Set()));
}

/**
 * Create an ODD parser whose `.parse(xml)` returns the extractor-friendly object
 * tree. `<specGrpRef>` indirection is resolved first (see resolveSpecGrpRefs),
 * so the extractors see a self-contained schema.
 * @param {string[]} [extraArrayTags] — additional tag names to force as arrays
 */
export function createOddParser(extraArrayTags = []) {
  const arrayTags = new Set([...DEFAULT_ARRAY_TAGS, ...extraArrayTags]);
  return {
    parse(xml) {
      const doc = parseXml(xml);
      const root = doc.children.find((n) => n.type === "element");
      if (!root) return {};
      const resolved = resolveSpecGrpRefs(root);
      return { [resolved.name]: buildValue(resolved, arrayTags) };
    },
  };
}

/**
 * Parse TEI/XML into an xast-compatible tree ({ type:'element', name,
 * attributes, children } / { type:'text', value }), wrapped in a root node —
 * the shape the generated unified handlers consume.
 */
export function parseXmlToXast(xml) {
  const toXast = (n) => {
    if (n.type === "text" || n.type === "cdata") return { type: "text", value: n.text || "" };
    if (n.type === "element") {
      return {
        type: "element",
        name: n.name,
        attributes: { ...n.attributes },
        children: n.children.map(toXast).filter(Boolean),
      };
    }
    return null;
  };
  const doc = parseXml(xml);
  return { type: "root", children: doc.children.map(toXast).filter(Boolean) };
}

/**
 * Parse TEI/XML into the preserveOrder array shape (`{ tag: [children] }`,
 * `{ '#text': value }`, attributes under `:@`). The leading XML declaration is
 * reproduced as a `?xml` node. Used by the preserveOrder-based renderer.
 */
export function parseXmlToPreserveOrder(xml) {
  const toPO = (n) => {
    if (n.type === "text" || n.type === "cdata") return { "#text": n.text || "" };
    if (n.type === "element") {
      const o = { [n.name]: n.children.map(toPO).filter(Boolean) };
      const ak = Object.keys(n.attributes || {});
      if (ak.length) o[":@"] = Object.fromEntries(ak.map((k) => ["@_" + k, n.attributes[k]]));
      return o;
    }
    return null;
  };
  const doc = parseXml(xml);
  const nodes = doc.children.map(toPO).filter(Boolean);
  const decl = xml.match(/^﻿?\s*<\?xml\s+([^?]*?)\s*\?>/);
  if (decl) {
    const attrs = {};
    for (const m of decl[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs["@_" + m[1]] = m[2];
    nodes.unshift(Object.keys(attrs).length ? { "?xml": [], ":@": attrs } : { "?xml": [] });
  }
  return nodes;
}

/**
 * Find the first `<title>` text in a parsed xast tree (from parseXmlToXast),
 * i.e. the document's titleStmt/title — used to label index entries in
 * multi-file rendering. Returns "" if none is found.
 */
export function extractTeiTitle(xastTree) {
  let found = "";
  const textOf = (node) => {
    if (node.type === "text") return node.value || "";
    if (node.type === "element" || node.type === "root") {
      return (node.children || []).map(textOf).join("");
    }
    return "";
  };
  const walk = (node) => {
    if (found || !node) return;
    if (node.type === "element" && node.name === "title") {
      found = textOf(node).replace(/\s+/g, " ").trim();
      return;
    }
    for (const c of node.children || []) walk(c);
  };
  walk(xastTree);
  return found;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce to array. */
export function arr(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

/** Get text content from a possibly nested parsed node. */
export function textContent(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node["#text"]) return String(node["#text"]);
  if (Array.isArray(node)) return node.map(textContent).filter(Boolean).join(" ");
  const parts = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_")) continue;
    parts.push(textContent(node[key]));
  }
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Spec finders
// ---------------------------------------------------------------------------

/** Recursively find all elementSpec nodes in a parsed ODD document. */
export function findElementSpecs(obj, specs = []) {
  if (!obj || typeof obj !== "object") return specs;
  if (Array.isArray(obj)) {
    for (const item of obj) findElementSpecs(item, specs);
    return specs;
  }
  if (obj.elementSpec) {
    const items = Array.isArray(obj.elementSpec) ? obj.elementSpec : [obj.elementSpec];
    specs.push(...items);
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_") || key === "#text") continue;
    findElementSpecs(obj[key], specs);
  }
  return specs;
}

/** Recursively find all classSpec nodes in a parsed ODD document. */
export function findClassSpecs(obj, specs = []) {
  if (!obj || typeof obj !== "object") return specs;
  if (Array.isArray(obj)) {
    for (const item of obj) findClassSpecs(item, specs);
    return specs;
  }
  if (obj.classSpec) {
    const items = Array.isArray(obj.classSpec) ? obj.classSpec : [obj.classSpec];
    specs.push(...items);
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_") || key === "#text") continue;
    findClassSpecs(obj[key], specs);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Model & attribute extraction
// ---------------------------------------------------------------------------

/** Extract a single model record from a parsed <model> element. */
function parseModel(m) {
  const base = {
    behaviour: m["@_behaviour"] || "unknown",
    predicate: m["@_predicate"] || null,
    output: m["@_output"] || null,
    useSourceRendition: m["@_useSourceRendition"] === "true",
    css: arr(m.outputRendition).map((or) => ({
      scope: or?.["@_scope"] || null,
      css: textContent(or),
    })),
    params: arr(m.param).map((p) => ({
      name: p["@_name"],
      value: p["@_value"],
    })),
  };

  // Boot's nested-model extension: a <model> containing a <modelSequence>
  // with child <model> elements expresses a compound behaviour — the element
  // produces multiple simultaneous outputs (e.g. link + graphic).
  const nestedSeqs = arr(m.modelSequence);
  if (nestedSeqs.length > 0) {
    base.nested = [];
    for (const ns of nestedSeqs) {
      base.nested.push(...arr(ns.model).map(parseModel));
    }
  }

  return base;
}

/**
 * Extract model information from an elementSpec.
 * Returns an array of flat models and { type:"sequence", models:[] } objects.
 */
export function extractModels(spec) {
  const models = [];
  for (const m of arr(spec.model)) {
    models.push(parseModel(m));
  }
  for (const ms of arr(spec.modelSequence)) {
    const seqModels = arr(ms.model).map(parseModel);
    models.push({
      type: "sequence",
      predicate: ms["@_predicate"] || null,
      models: seqModels,
    });
  }
  return models;
}

/** Extract attribute definitions from an elementSpec. */
export function extractAttDefs(spec) {
  const attList = spec.attList;
  if (!attList) return [];
  const defs = [];
  for (const ad of arr(attList.attDef)) {
    const valItems = [];
    if (ad.valList) {
      for (const vi of arr(ad.valList.valItem)) {
        valItems.push({
          ident: vi["@_ident"],
          desc: textContent(vi.desc),
        });
      }
    }
    defs.push({
      ident: ad["@_ident"],
      mode: ad["@_mode"] || null,
      usage: ad["@_usage"] || null,
      desc: textContent(ad.desc),
      valListType: ad.valList?.["@_type"] || null,
      values: valItems,
    });
  }
  return defs;
}

/**
 * Extract source-appearance renditions from <tagsDecl>. Following the
 * tei_simplePrint convention, how a passage looks in the source is recorded as
 * <rendition xml:id="…" scheme="css">…</rendition> in the header and pointed to
 * from @rendition — presentational CSS the editors maintain alongside the PM's
 * <outputRendition>. Returns { id, scheme, css } records.
 */
export function extractRenditions(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const item of obj) extractRenditions(item, out);
    return out;
  }
  if (obj.rendition) {
    for (const r of arr(obj.rendition)) {
      const id = r["@_xml:id"];
      if (!id) continue;
      out.push({
        id,
        scheme: r["@_scheme"] || "css",
        css: textContent(r).trim(),
      });
    }
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_") || key === "#text" || key === "rendition") continue;
    extractRenditions(obj[key], out);
  }
  return out;
}
