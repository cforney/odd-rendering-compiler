/**
 * Reads a TEI ODD into the Processing Model every generator works from, and
 * parses TEI for the renderers, with the page metadata the ODD declares.
 *
 * readOdd(path) → { specs: [{ ident, models, rules, values }], renditions: [{ id, css }],
 *                   views: [{ output, label }] }
 *
 * `models` are the element's models in document order, model groups flattened:
 *   { behaviour, tag, flow, predicate, output, params: [{ name, value }],
 *     classes, source, parts }
 * A <modelSequence> is behaviour "sequence" with its models as `parts`; a
 * <model> holding a <modelSequence> (Boot's nested-model proposal) keeps its
 * behaviour and gets `parts` too. A model takes @output and
 * @useSourceRendition (`source`) from its sequence or group.
 *
 * `rules` are the CSS of the <outputRendition>s. A spec's only model styles
 * `.tei-<ident>`; otherwise a group styles `.<ident>-group`, and a model its
 * first @cssClass, or `<ident>-<n>` (the n-th <model> of the spec) without one.
 * The CSS of a model with @output applies where that output is on (see `on`).
 *
 * `values` are the attribute values the spec's value lists foresee. `views` are
 * the outputs laid over the page, labelled by a model's <desc>: all but those in
 * ALONE, which render on their own.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseXml } from "@rgrove/parse-xml";
import { xpath, bool, seq, str } from "../runtime/xpath.mjs";

const BEHAVIOURS = JSON.parse(readFileSync(new URL("../behaviour-map.json", import.meta.url), "utf8"));

const elements = (el, name) =>
  (el?.children ?? []).filter((c) => c.type === "element" && (!name || c.name === name));
const textOf = (n) => (n.type === "element" ? n.children.map(textOf).join("") : n.text ?? "");
const normalize = (s) => s.replace(/\s+/g, " ").trim();

/** Outputs not laid over the page: the page itself, what it shows around the text, the search text. */
const ALONE = ["web", "page", "plain"];

/** Where an output is on: the edition renders it, or its view switch is checked. */
export const on = (output) => `:is([data-${output}='on'], :root:has(#view-${output}:checked))`;

/** Descendant elements by name, in document order; examples (egXML) are not the schema. */
function findAll(el, name, out = []) {
  for (const c of elements(el)) {
    if (c.name === "egXML") continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/**
 * Resolve `<specGrpRef target="#id"/>` within one document: each reference is
 * replaced by the specs of its `<specGrp xml:id>`, in reference order; a group
 * that is only referenced elsewhere is dropped where it stands. Dangling and
 * cyclic references are skipped with a warning.
 */
export function resolveSpecGrpRefs(root, warn = (m) => console.error(m)) {
  const byId = new Map(findAll(root, "specGrp").map((g) => [g.attributes["xml:id"], g]));
  if (!findAll(root, "specGrpRef").length) return root;

  const copy = (el, children) => ({ type: "element", name: el.name, attributes: el.attributes, children });
  const rewrite = (children, seen) =>
    children.flatMap((c) => {
      if (c.type !== "element") return [c];
      if (c.name === "specGrp" && c.attributes["xml:id"]) return [];
      if (c.name !== "specGrpRef") return [copy(c, rewrite(c.children, seen))];
      const id = (c.attributes.target ?? "").replace(/^#/, "");
      if (!byId.has(id) || seen.has(id)) {
        warn(`[odd-parser] specGrpRef #${id} ${byId.has(id) ? "is cyclic" : "not found"} (skipped)`);
        return [];
      }
      return rewrite(byId.get(id).children, new Set(seen).add(id));
    });
  return copy(root, rewrite(root.children, new Set()));
}

function known(behaviour, ident) {
  if (behaviour in BEHAVIOURS) return behaviour;
  console.warn(`[odd-parser] ⚠ <${ident}>: unknown behaviour "${behaviour}", rendered inline`);
  return "inline";
}

/** Block if any part is, inline if all are; a `text` part is literal content. */
function flowOf(behaviour, parts) {
  if (!parts) return BEHAVIOURS[behaviour].flow ?? "";
  const flows = parts.filter((p) => p.behaviour !== "text").map((p) => p.flow);
  return flows.includes("block") ? "block" : flows.every((f) => f === "inline") ? "inline" : "";
}

function readSpec(spec) {
  const ident = spec.attributes.ident;
  const entries = elements(spec).filter((e) => /^model(Grp|Sequence)?$/.test(e.name));
  const sole = entries.length === 1;
  const numbered = findAll(spec, "model");
  const models = [];
  const rules = [];
  const style = (el, selector, output) => {
    for (const r of elements(el, "outputRendition")) {
      const scope = r.attributes.scope ? `::${r.attributes.scope}` : "";
      rules.push({ selector: (output ? `${on(output)} ` : "") + selector + scope, css: normalize(textOf(r)) });
    }
  };

  function read(m, group, groupClass, outer) {
    const inherited = (name) => m.attributes[name] ?? outer?.attributes[name] ?? group?.attributes[name];
    const predicate = m.attributes.predicate ?? null;
    const output = inherited("output") ?? null;
    const own = (m.attributes.cssClass ?? "").split(/\s+/).filter(Boolean);
    const styled = m.name === "model" && elements(m, "outputRendition").length > 0;
    const bare = sole && !group && !outer && !predicate && !output;
    const cls = styled && !bare ? own[0] ?? `${ident}-${numbered.indexOf(m) + 1}` : undefined;
    if (styled) style(m, cls ? `.${cls}` : `.tei-${ident}`, output);

    const sequence = m.name === "modelSequence" ? m : elements(m, "modelSequence")[0];
    const behaviour = m.name === "modelSequence" ? "sequence" : known(m.attributes.behaviour, ident);
    const parts = sequence && elements(sequence, "model").map((p) => read(p, group, groupClass, m));
    return {
      behaviour,
      tag: BEHAVIOURS[behaviour]?.tag,
      flow: flowOf(behaviour, parts),
      predicate,
      output,
      params: [...new Map(elements(m, "param").map((p) => [p.attributes.name, { name: p.attributes.name, value: p.attributes.value ?? "''" }])).values()],
      classes: [...new Set([groupClass, ...own, cls].filter(Boolean))],
      source: inherited("useSourceRendition") === "true",
      label: elements(m, "desc").map((d) => normalize(textOf(d)))[0],
      parts,
    };
  }

  let groups = 0;
  for (const entry of entries) {
    if (entry.name !== "modelGrp") {
      models.push(read(entry));
      continue;
    }
    groups++;
    const groupClass = sole ? undefined : `${ident}-group${groups > 1 ? groups : ""}`;
    style(entry, groupClass ? `.${groupClass}` : `.tei-${ident}`, entry.attributes.output);
    for (const m of elements(entry).filter((e) => /^model(Sequence)?$/.test(e.name))) {
      models.push(read(m, entry, groupClass));
    }
  }
  const values = elements(elements(spec, "attList")[0], "attDef")
    .map((d) => [d.attributes.ident, findAll(d, "valItem").map((v) => v.attributes.ident)])
    .filter(([, list]) => list.length);
  return { ident, mode: spec.attributes.mode ?? "add", models, rules, values: Object.fromEntries(values) };
}

/** The outputs laid over the page, in document order, each labelled by the first <desc> of its models. */
function viewsOf(specs) {
  const models = specs.flatMap((s) => s.models).flatMap((m) => [m, ...(m.parts ?? [])]).filter((m) => m.output);
  return [...new Set(models.map((m) => m.output))]
    .filter((output) => !ALONE.includes(output))
    .map((output) => ({ output, label: models.find((m) => m.output === output && m.label)?.label ?? output }));
}

/**
 * Read an ODD. A `<schemaSpec source="…">` naming another ODD is read as a chain:
 * the base ODD's specs, where this one's specs with models replace the base
 * spec's models, `mode="delete"` removes a spec, and a new ident is added.
 */
export function readOdd(path) {
  const doc = parseXml(readFileSync(path, "utf8"));
  const root = resolveSpecGrpRefs(doc.children.find((n) => n.type === "element"));
  const specs = findAll(root, "elementSpec").map(readSpec);
  const renditions = findAll(root, "tagsDecl")
    .flatMap((t) => elements(t, "rendition"))
    .filter((r) => r.attributes["xml:id"])
    .map((r) => ({ id: r.attributes["xml:id"], css: normalize(textOf(r)) }));

  const source = findAll(root, "schemaSpec")[0]?.attributes.source;
  if (!source) return { specs, renditions, views: viewsOf(specs) };

  const base = readOdd(resolve(dirname(path), source));
  const own = new Map(specs.map((s) => [s.ident, s]));
  const chained = base.specs
    .filter((s) => own.get(s.ident)?.mode !== "delete")
    .map((s) => (own.get(s.ident)?.models.length ? own.get(s.ident) : s));
  const added = specs.filter((s) => s.mode !== "delete" && !base.specs.some((b) => b.ident === s.ident));
  const all = [...chained, ...added];
  return { specs: all, renditions: [...base.renditions, ...renditions], views: viewsOf(all) };
}

/**
 * Parse TEI into an xast tree ({ type: 'element', name, attributes, children } /
 * { type: 'text', value }) under a root node, the shape the renderers consume.
 */
export function parseXmlToXast(xml) {
  const toXast = (n) => {
    if (n.type === "text" || n.type === "cdata") return { type: "text", value: n.text || "" };
    if (n.type === "element") {
      return { type: "element", name: n.name, attributes: { ...n.attributes }, children: n.children.map(toXast).filter(Boolean) };
    }
    return null;
  };
  return { type: "root", children: parseXml(xml).children.map(toXast).filter(Boolean) };
}

/** What the page shows around the text: the params of the root's first model for output "page" whose predicate holds, as strings. */
export function pageOf(specs, tree) {
  const root = { node: tree.children.find((n) => n.type === "element"), up: [] };
  const models = specs.find((s) => s.ident === root.node.name)?.models ?? [];
  const page = models.find((m) => m.output === "page" && (!m.predicate || bool(xpath(m.predicate)(root))));
  return Object.fromEntries((page?.params ?? []).map((p) => [p.name, seq(xpath(p.value)(root)).map((item) => str([item]))]));
}

/** The text of the first `<title>` in an xast tree, for page titles; "" if none. */
export function extractTeiTitle(tree) {
  const find = (n) => (n.name === "title" ? n : (n.children ?? []).map(find).find(Boolean));
  const title = find(tree);
  const textOf = (n) => (n.type === "text" ? n.value : n.children.map(textOf).join(""));
  return title ? normalize(textOf(title)) : "";
}
