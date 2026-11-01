/**
 * Reads a TEI ODD into the Processing Model every generator works from, and
 * parses TEI for the renderers, with the page metadata the ODD declares.
 *
 * readOdd(path) → Odd, the shapes in the typedefs below. An ODD it cannot read
 * throws an OddError naming each problem and its line: XML that is not
 * well-formed, a base ODD not found or inheriting from itself, no <model> at all,
 * a missing @ident, @behaviour or param @name, or a <modelSequence> with no <model>.
 *
 * Names resolve by namespace, however the ODD spells them: only TEI's elements
 * are its structure, and an XPath prefix the ODD binds becomes Q{uri}local (bound
 * to TEI's namespace, the unprefixed name), so the expression means the same
 * wherever it is carried. A spec with @ns has a `key`, nameOf that namespace and
 * its ident, by which it is matched; otherwise its key is its ident.
 *
 * `models` are the element's models in document order, model groups flattened.
 * `id` names the model, `<ident>-<n>` by its place among the spec's models, and
 * `odd`/`line` say where it (and, on each param, where that param) was written —
 * what the JSON records and the report of degraded XPath name it by.
 * A <modelSequence> is behaviour "sequence" with its models as `parts`; a
 * <model> holding a <modelSequence> (Boot's nested-model proposal) keeps its
 * behaviour and gets `parts` too. A model takes @output and
 * @useSourceRendition (`source`) from its sequence or group. `template` is its
 * <pb:template>, a TEI Publisher extension, as XML (see templateOf).
 *
 * `rules` are the CSS of the <outputRendition>s. A spec's only model styles
 * `.tei-<ident>`; otherwise a group styles `.<ident>-group`, and a model its
 * first @cssClass, or `<ident>-<n>` (the n-th <model> of the spec) without one.
 * The CSS of a model with @output applies where that output is on (see `on`).
 *
 * `values` are the attribute values the spec's value lists foresee. `views` are
 * the outputs laid over the page, labelled by a model's <desc>: all but the
 * CHANNELS, which render on their own, and another engine's.
 *
 * `sources` are the ODDs of the chain, base first, with their hashes. `diagnostics`
 * are what the ODD can be read despite, each with a stable `code` and a `severity`.
 *
 * An @output may carry an engine's prefix (docs/conventions.md): `orc-` names
 * this compiler's own output, so `orc-web` is `web` here and unknown elsewhere;
 * `opm-` is OPM's, an output never rendered here.
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseXml, XmlError } from "@rgrove/parse-xml";
import { xpath, bool, seq, str, nameOf, TEI_NS } from "../runtime/xpath.mjs";

/**
 * An entry of behaviour-map.json: the HTML element of a behaviour that does no
 * more than wrap its content, and whether it renders as a block or inline.
 * @typedef {{ tag?: string, flow?: "block" | "inline" }} Behaviour
 */
/**
 * The ODD as every generator reads it; `odd` and `line` say where a model or param was written.
 * @typedef {{ name: string, value: string, odd: string, line: number }} Param
 * @typedef {{ id: string, behaviour: string, tag?: string, flow: string, predicate: string | null,
 *   output: string | null, group?: number, params: Param[], classes: string[], source: boolean, template?: string,
 *   label?: string, parts?: OddModel[], odd: string, line: number }} OddModel
 * @typedef {{ selector: string, css: string }} Rule
 * @typedef {{ ident: string, key: string, ns?: string, mode: string, models: OddModel[], rules: Rule[], values: Record<string, string[]> }} Spec
 * @typedef {{ code: string, severity: "error" | "warning" | "info", message: string, odd?: string, line?: number, element?: string, model?: string }} Diagnostic
 * @typedef {{ specs: Spec[], renditions: { id: string, css: string }[], views: import("../runtime/pm-runtime.mjs").View[],
 *   sources: { odd: string, sha256: string }[], diagnostics: Diagnostic[] }} Odd
 */

/** An ODD the compiler cannot read; its message has a line per problem. */
export class OddError extends Error {}

/** @type {Record<string, Behaviour>} */
const BEHAVIOURS = JSON.parse(readFileSync(new URL("../behaviour-map.json", import.meta.url), "utf8"));

const elements = (el, name) =>
  (el?.children ?? []).filter((c) => c.type === "element" && (!name || c.name === name));
const textOf = (n) => (n.type === "element" ? n.children.map(textOf).join("") : n.text ?? "");
const normalize = (s) => s.replace(/\s+/g, " ").trim();
/** CSS with its whitespace collapsed, but for that of its quoted strings. */
const cssOf = (el) => textOf(el).replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|[ \t\r\n]+/gs, (_, quoted) => quoted ?? " ").trim();
const localName = (name) => name.replace(/^\{.*\}|^[^:]*:/, "");

/** The namespaces in scope on an element, by prefix ("" the default). */
const scopeOf = (attributes, outer) => {
  const own = Object.entries(attributes).filter(([k]) => /^xmlns(:|$)/.test(k)).map(([k, v]) => [k.slice(6), v]);
  return own.length ? { ...outer, ...Object.fromEntries(own) } : outer;
};
const uriOf = (qname, scope) => {
  const prefix = qname.includes(":") ? qname.slice(0, qname.indexOf(":")) : "";
  if (prefix && scope[prefix] === undefined) throw new OddError(`the namespace prefix of ${qname} is not declared`);
  return scope[prefix] ?? "";
};
/** The ODD's elements named by namespace, each with the prefixes in scope. */
function qualify(el, outer, bases = []) {
  el.scope = scopeOf(el.attributes, outer);
  el.bases = el.attributes["xml:base"] ? [...bases, el.attributes["xml:base"]] : bases;
  el.name = nameOf(uriOf(el.name, el.scope), localName(el.name));
  for (const c of elements(el)) qualify(c, el.scope, el.bases);
  return el;
}
/** Where a model or param was written, as an error names it. */
export const writtenAt = (id, { odd, line }) => `${id}, ${odd}:${line}`;

/** An expression with the prefixes the ODD binds resolved; string literals and xml: stay as they are. */
const qualifyXPath = (expr, scope) =>
  expr.replace(/'[^']*'|"[^"]*"|(@?)([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)/g, (m, at, prefix, local) => {
    const uri = prefix === "xml" ? undefined : scope[prefix];
    if (uri === undefined) return m;
    return !at && uri === TEI_NS ? local : `${at}Q{${uri}}${local}`;
  });
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Outputs not laid over the page: the page itself, what it shows around the text, the search text, and other media. */
const CHANNELS = ["web", "page", "plain", "plaintext", "print", "fo", "latex", "epub", "pdf"];
/** An @output with this compiler's prefix names the output itself. */
const outputName = (output) => output?.replace(/^orc-/, "") ?? null;

/** Where an output is on: the edition renders it, or its view switch is checked. */
export const on = (output) => `:is([data-${output}='on'], .tei-edition:has(> .tei-views input[data-view='${output}']:checked))`;

/** Descendant elements by name (or any of several), in document order; examples (egXML) are not the schema. */
function findAll(el, name, out = []) {
  for (const c of elements(el)) {
    if (localName(c.name) === "egXML") continue;
    if (Array.isArray(name) ? name.includes(c.name) : c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/**
 * Resolve `<specGrpRef target="#id"/>` within one document: each reference is
 * replaced by the specs of its `<specGrp xml:id>`, in reference order; a group
 * that is only referenced elsewhere is dropped where it stands. Dangling and
 * cyclic references are skipped, and told to `warn(ref, code, message)`.
 */
export function resolveSpecGrpRefs(root, warn) {
  const byId = new Map(findAll(root, "specGrp").map((g) => [g.attributes["xml:id"], g]));
  if (!findAll(root, "specGrpRef").length) return root;

  const copy = (el, children) => ({ type: "element", name: el.name, attributes: el.attributes, scope: el.scope, bases: el.bases, children, start: el.start });
  const rewrite = (children, seen) =>
    children.flatMap((c) => {
      if (c.type !== "element") return [c];
      if (c.name === "specGrp" && c.attributes["xml:id"]) return [];
      if (c.name !== "specGrpRef") return [copy(c, rewrite(c.children, seen))];
      const id = (c.attributes.target ?? "").replace(/^#/, "");
      if (!byId.has(id) || seen.has(id)) {
        warn(c, "spec-group-unresolved", `<specGrpRef target="#${id}"> ${byId.has(id) ? "is cyclic" : "names no <specGrp>"}: skipped`);
        return [];
      }
      return rewrite(byId.get(id).children, new Set(seen).add(id));
    });
  return copy(root, rewrite(root.children, new Set()));
}

/** A template as the runtime fills it in: its text as strings, its elements as { name, attributes, children }. */
export function templateTree(xml) {
  const node = (n) => (n.type === "element" ? { name: n.name, attributes: n.attributes, children: n.children.map(node) } : n.text);
  return parseXml(`<t>${xml}</t>`).root.children.map(node);
}

/**
 * A model's <pb:template> as XML without namespaces, as TEI Publisher reads it:
 * its elements, or with none its text, each line's leading whitespace dropped.
 */
function templateOf(m) {
  const t = elements(m).find((e) => localName(e.name) === "template");
  if (!t) return undefined;
  const xml = (n) => {
    if (n.type !== "element") return escape(n.text ?? "");
    const name = localName(n.name);
    const attrs = Object.entries(n.attributes).filter(([k]) => !/^xmlns(:|$)/.test(k)).map(([k, v]) => ` ${localName(k)}="${escape(v)}"`);
    return `<${name}${attrs.join("")}>${n.children.map(xml).join("")}</${name}>`;
  };
  return elements(t).length ? elements(t).map(xml).join("") : escape(textOf(t).replace(/^\s+/gm, ""));
}

function known(m, ident, file) {
  const { behaviour } = m.attributes;
  if (behaviour in BEHAVIOURS) return behaviour;
  if (!behaviour) file.problem(m, `<model> in <elementSpec ident="${ident}"> has no @behaviour`);
  else file.warn(m, "behaviour-unknown", `<${ident}>: unknown behaviour "${behaviour}", rendered inline`, { element: ident });
  return "inline";
}

/** Block if any part is, inline if all are; a `text` part is literal content. */
function flowOf(behaviour, parts) {
  if (!parts) return BEHAVIOURS[behaviour].flow ?? "";
  const flows = parts.filter((p) => p.behaviour !== "text").map((p) => p.flow);
  return flows.includes("block") ? "block" : flows.every((f) => f === "inline") ? "inline" : "";
}

function readSpec(spec, file) {
  const ident = spec.attributes.ident;
  const ns = spec.attributes.ns === TEI_NS ? undefined : spec.attributes.ns;
  const key = ns === undefined ? ident : nameOf(ns, ident);
  if (!ident) file.problem(spec, "<elementSpec> has no @ident");
  const entries = elements(spec).filter((e) => /^model(Grp|Sequence)?$/.test(e.name));
  const sole = entries.length === 1;
  const numbered = findAll(spec, "model");
  const identified = findAll(spec, ["model", "modelSequence"]);
  const models = [];
  const rules = [];
  const style = (el, selector, output) => {
    for (const r of elements(el, "outputRendition")) {
      const scope = r.attributes.scope ? `::${r.attributes.scope}` : "";
      rules.push({ selector: (output ? `${on(output)} ` : "") + selector + scope, css: cssOf(r) });
    }
  };

  function read(m, group, groupClass, outer) {
    const inherited = (name) => m.attributes[name] ?? outer?.attributes[name] ?? group?.attributes[name];
    const predicate = m.attributes.predicate === undefined ? null : qualifyXPath(m.attributes.predicate, m.scope);
    const output = outputName(inherited("output"));
    const own = (m.attributes.cssClass ?? "").split(/\s+/).filter(Boolean);
    const styled = m.name === "model" && elements(m, "outputRendition").length > 0;
    const bare = sole && !group && !outer && !predicate && !output;
    const cls = styled && !bare ? own[0] ?? `${ident}-${numbered.indexOf(m) + 1}` : undefined;
    if (styled) style(m, cls ? `.${cls}` : `.tei-${ident}`, output);

    const sequence = m.name === "modelSequence" ? m : elements(m, "modelSequence")[0];
    const behaviour = m.name === "modelSequence" ? "sequence" : known(m, ident, file);
    if (sequence && !elements(sequence, "model").length) file.problem(sequence, `<modelSequence> in <elementSpec ident="${ident}"> holds no <model>`);
    for (const p of elements(m, "param").filter((p) => !p.attributes.name)) file.problem(p, `<param> in <elementSpec ident="${ident}"> has no @name`);
    const parts = sequence && elements(sequence, "model").map((p) => read(p, group, groupClass, m));
    return {
      id: `${key}-${identified.indexOf(m) + 1}`,
      behaviour,
      tag: BEHAVIOURS[behaviour]?.tag,
      flow: flowOf(behaviour, parts),
      predicate,
      output,
      group: group ? entries.filter((e) => e.name === "modelGrp").indexOf(group) + 1 : undefined,
      params: [...new Map(elements(m, "param").map((p) => [p.attributes.name, { name: p.attributes.name, value: qualifyXPath(p.attributes.value ?? "''", p.scope), ...file.at(p.start) }])).values()],
      classes: [...new Set([groupClass, ...own, cls].filter(Boolean))],
      source: inherited("useSourceRendition") === "true",
      template: templateOf(m),
      label: elements(m, "desc").map((d) => normalize(textOf(d)))[0],
      help: elements(m, "desc").map((d) => normalize(textOf(d)))[1],
      parts,
      ...file.at(m.start),
    };
  }

  let groups = 0;
  for (const entry of entries) {
    if (entry.name !== "modelGrp") {
      if (groups) file.warn(entry, "group-fallback", `<${ident}>: a model after a <modelGrp> applies only because groups are flattened here; other engines are reported to choose the group as a unit`, { element: ident }, "info");
      models.push(read(entry));
      continue;
    }
    groups++;
    const groupClass = sole ? undefined : `${ident}-group${groups > 1 ? groups : ""}`;
    style(entry, groupClass ? `.${groupClass}` : `.tei-${ident}`, outputName(entry.attributes.output));
    for (const m of elements(entry).filter((e) => /^model(Sequence)?$/.test(e.name))) {
      models.push(read(m, entry, groupClass));
    }
  }
  const values = elements(elements(spec, "attList")[0], "attDef")
    .map((d) => [d.attributes.ident, findAll(d, "valItem").map((v) => v.attributes.ident)])
    .filter(([, list]) => list.length);
  return { ident, key, ...(ns !== undefined && { ns }), mode: spec.attributes.mode ?? "add", models, rules, values: Object.fromEntries(values) };
}

/** Every model of the specs, the parts of a sequence included, each with the element it belongs to. */
export function allModels(specs) {
  const flatten = (m) => [m, ...(m.parts ?? []).flatMap(flatten)];
  return specs.flatMap((s) => s.models.flatMap(flatten).map((m) => ({ element: s.key, ...m })));
}

/** The outputs laid over the page, in document order, each labelled by the first <desc> of its models, and explained by the second. */
function viewsOf(specs) {
  const models = allModels(specs).filter((m) => m.output);
  return [...new Set(models.map((m) => m.output))]
    .filter((output) => !CHANNELS.includes(output) && !output.startsWith("opm-"))
    .map((output) => {
      const said = models.find((m) => m.output === output && m.label);
      return { output, label: said?.label ?? output, help: said?.help };
    });
}

/** What a view's model cannot lay over the page: only an omit, or classes on the same behaviour, can be. */
function unrealized({ specs, views }) {
  /** @type {Diagnostic[]} */
  const found = [];
  for (const { output } of views) for (const s of specs) for (const m of s.models.filter((m) => m.output === output && m.behaviour !== "omit")) {
    const base = s.models.filter((b) => !b.output || b.output === "web");
    const content = m.template || m.params.some((p) => p.name === "content");
    if (!content && (!base.length || base.some((b) => b.behaviour === m.behaviour))) continue;
    found.push({ code: "view-unrealized", severity: "warning", element: s.key, model: m.id, odd: m.odd, line: m.line,
      message: `<${s.key}>: view "${output}" ${content ? "changes the content" : `is a ${m.behaviour}`}, which a view cannot lay over the page; it shows when output "${output}" renders alone` });
  }
  return found;
}

/**
 * Read an ODD, or throw an OddError. A `<schemaSpec source="…">` naming another
 * ODD, a local file resolved against the ODD and any @xml:base, is read as a
 * chain: the base ODD's specs, where this one's specs with models replace the
 * base spec's models, `mode="delete"` removes a spec, and a new ident is added.
 * Elsewhere than in a chain @mode means nothing, nor do inherited classes or
 * attributes: docs/capabilities.md says what is read.
 * @param {string} path
 * @returns {Odd}
 */
export function readOdd(path) {
  const odd = readChain(resolve(path));
  if (!allModels(odd.specs).length) throw new OddError(`${basename(path)}: holds no <model>, so there is no Processing Model to compile; to start from a default rendering, chain one: <schemaSpec source="tei_simplePrint.odd">`);
  return { ...odd, diagnostics: [...odd.diagnostics, ...unrealized(odd)] };
}

/** One ODD of a chain, with its base; `seen` are the ODDs that inherit from it. @returns {Odd} */
function readChain(path, seen = []) {
  const name = basename(path);
  if (seen.includes(path)) throw new OddError(`${name}: inherits from itself: ${[...seen, path].map((p) => basename(p)).join(" → ")}`);
  if (!existsSync(path)) throw new OddError(`${name}: not found (${path})`);
  const xml = readFileSync(path, "utf8");
  let doc, root;
  try {
    doc = parseXml(xml, { includeOffsets: true });
    root = qualify(doc.children.find((n) => n.type === "element"), {});
  } catch (e) {
    if (e instanceof OddError) throw new OddError(`${name}: ${e.message}`);
    if (!(e instanceof XmlError)) throw e;
    throw new OddError(`${name}:${e.line}: not well-formed XML: ${e.message.replace(/ \(line [\s\S]*/, "")}`);
  }
  /** Where something was written, this ODD and the line of its offset; and the problems found, with their offsets. */
  const problems = [];
  const diagnostics = [];
  const file = {
    at: (start) => ({ odd: name, line: xml.slice(0, start).split("\n").length }),
    warn: (el, code, message, extra = {}, severity = "warning") => diagnostics.push({ code, severity, message, ...extra, ...file.at(el.start) }),
    problem: (el, message) => problems.push({ start: el.start, text: `${name}:${file.at(el.start).line}: ${message}` }),
  };
  const schemas = findAll(root, "schemaSpec");
  if (schemas.length > 1) file.warn(schemas[1], "schema-spec-several", `${schemas.length} <schemaSpec>s: the elementSpecs of all are read, a @source only from the first`);
  root = resolveSpecGrpRefs(root, file.warn);
  const specs = findAll(root, "elementSpec").map((spec) => readSpec(spec, file));
  const renditions = findAll(root, "tagsDecl")
    .flatMap((t) => elements(t, "rendition"))
    .filter((r) => r.attributes["xml:id"])
    .map((r) => ({ id: r.attributes["xml:id"], css: cssOf(r) }));

  const schema = findAll(root, "schemaSpec")[0];
  const source = schema?.attributes.source;
  const target = source && new URL(source, schema.bases.reduce((url, b) => new URL(b, url), pathToFileURL(path)));
  if (target && target.protocol !== "file:") file.problem(schema, `<schemaSpec source="${source}">: not a local file; keep a copy beside the ODD`);
  else if (target && !existsSync(target)) file.problem(schema, `<schemaSpec source="${source}">: not found`);
  if (problems.length) throw new OddError(problems.sort((a, b) => a.start - b.start).map((p) => p.text).join("\n"));
  const self = { odd: name, sha256: createHash("sha256").update(xml).digest("hex") };
  if (!source) return { specs, renditions, views: viewsOf(specs), sources: [self], diagnostics };

  const base = readChain(fileURLToPath(target), [...seen, path]);
  const own = new Map(specs.map((s) => [s.key, s]));
  const chained = base.specs
    .filter((s) => own.get(s.key)?.mode !== "delete")
    .map((s) => (own.get(s.key)?.models.length ? own.get(s.key) : s));
  const added = specs.filter((s) => s.mode !== "delete" && !base.specs.some((b) => b.key === s.key));
  const all = [...chained, ...added];
  return { specs: all, renditions: [...base.renditions, ...renditions], views: viewsOf(all), sources: [...base.sources, self], diagnostics: [...base.diagnostics, ...diagnostics] };
}

/**
 * Parse TEI into an xast tree ({ type: 'element', name, attributes, children } /
 * { type: 'text', value }) under a root node, the shape the renderers consume,
 * with its names resolved (see the typedefs of xpath.mjs). A prefix not declared
 * throws an OddError.
 */
export function parseXmlToXast(xml) {
  const toXast = (n, outer) => {
    if (n.type === "text" || n.type === "cdata") return { type: "text", value: n.text || "" };
    if (n.type === "element") {
      const scope = scopeOf(n.attributes, outer);
      const attributes = Object.entries(n.attributes).filter(([k]) => !/^xmlns(:|$)/.test(k))
        .map(([k, v]) => [k.includes(":") && !k.startsWith("xml:") ? `{${uriOf(k, scope)}}${localName(k)}` : k, v]);
      return { type: "element", name: nameOf(uriOf(n.name, scope), localName(n.name)), attributes: Object.fromEntries(attributes), children: n.children.map((c) => toXast(c, scope)).filter(Boolean) };
    }
    return null;
  };
  return { type: "root", children: parseXml(xml).children.map((c) => toXast(c, {})).filter(Boolean) };
}

/** What the page shows around the text: the params of the root's first model for output "page" whose predicate holds, as strings. */
export function pageOf(specs, tree) {
  const root = { node: tree.children.find((n) => n.type === "element"), up: [] };
  const models = specs.find((s) => s.key === root.node.name)?.models ?? [];
  const page = models.find((m) => m.output === "page" && (!m.predicate || bool(xpath(m.predicate)(root))));
  return Object.fromEntries((page?.params ?? []).map((p) => [p.name, seq(xpath(p.value)(root)).map((item) => str([item]))]));
}
