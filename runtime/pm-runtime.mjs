/**
 * The runtime of the generated tei-handlers.mjs: renders a TEI xast tree to hast
 * by the models the generator took from the ODD. It ships beside the handlers,
 * with xpath.mjs, which evaluates their predicates and params. The CETEIcean
 * pages inline both, and choose models by createResolver in the browser.
 *
 * Each element takes the first model of the output being rendered whose
 * predicate holds, else the first such model without @output; with none, its
 * content passes through. A sequence renders each of its parts whose predicate
 * holds; the element's id goes on the first.
 */

import { xpath, bool, str, seq, isPos } from "./xpath.mjs";

/**
 * @typedef {import("./xpath.mjs").XastNode} XastNode
 * @typedef {import("./xpath.mjs").Expression} Expression
 */
/**
 * HTML as hast, what the handlers render.
 * @typedef {{ type: "element", tagName: string, properties: Record<string, any>, children: HastNode[] }} HastElement
 * @typedef {{ type: "text", value: string }} HastText
 * @typedef {HastElement | HastText} HastNode
 */
/**
 * A model as the handlers hold it, its XPath compiled: a behaviour with the HTML
 * element and flow behaviour-map.json gives it; a sequence, or a compound, with
 * its parts. A template's text is a string, its elements { name, attributes, children }.
 * @typedef {{ id?: string, behaviour: string, tag?: string, flow: string, output?: string, predicate?: Expression,
 *   params: Record<string, Expression>, classes: string[], source: boolean,
 *   template?: TemplateNode[], parts?: Model[] }} Model
 * @typedef {string | { name: string, attributes: Record<string, string>, children: TemplateNode[] }} TemplateNode
 * @typedef {{ output: string, label: string }} View  an output laid over the page
 */
/**
 * An element as it rendered. Its outcome: "rendered"; "omitted", as its model says;
 * "empty", its model ran and gave nothing; or "passed-through", no model applied, so
 * its content renders in its place. A sequence names the parts that ran.
 * @typedef {{ element: string, model: string | null, behaviour: string | null, classes: string[], params?: Record<string, string[]>,
 *   parts?: string[], outcome: "rendered" | "omitted" | "empty" | "passed-through", children: (PmRecord | string)[] }} PmRecord
 */

/** @type {(tagName: string, properties?: Record<string, any>, children?: HastNode[]) => HastElement} */
export const h = (tagName, properties = {}, children = []) => ({ type: "element", tagName, properties, children });
/** @type {(value: string) => HastText} */
export const text = (value) => ({ type: "text", value });

const isElement = (n) => n?.type === "element";
const isText = (n) => n?.type === "text";
const localName = (name) => name.replace(/^\{.*\}/, "");
const textOf = (n) => (isText(n) ? n.value : (n.children ?? []).map(textOf).join(""));
/** XML whitespace, as XPath counts it (not the no-break space). */
const blank = (s) => !/[^ \t\n\r]/.test(s);
const collapse = (s) => s.replace(/[ \t\n\r]+/g, " ");

/** HTML elements whose content must be phrasing: a block inside becomes a span. */
const PHRASING = new Set(["p", "span", "a", "h1", "h2", "h3", "h4", "h5", "h6"]);
/** Note places that get a numbered marker in the text and go to the footnotes. */
const NUMBERED = ["end", "foot"];
/** A param named in a template, `[[name]]`. */
const PLACEHOLDER = /\[\[([^[\]]*)\]\]/g;
const FIRST = xpath("*[1]");
const SECOND = xpath("*[2]");

/** A node's element and text children as positions, each with its index; built once per node. */
const childPositions = new WeakMap();
function children({ node, up }) {
  if (!childPositions.has(node)) {
    const path = [...up, node];
    childPositions.set(node, (node.children ?? []).filter((c) => isElement(c) || isText(c)).map((c, i) => ({ node: c, up: path, i })));
  }
  return childPositions.get(node);
}
const parentOf = ({ up }) => ({ node: up.at(-1), up: up.slice(0, -1) });
const indexOf = (pos) => pos.i ?? children(parentOf(pos)).findIndex((s) => s.node === pos.node);

/** `@rendition="#a #b"` → `r-a r-b`. */
const renditions = (node) =>
  (node.attributes.rendition ?? "").split(/\s+/).filter(Boolean).map((t) => "r-" + t.replace(/^#/, ""));

/** Params named `--…` become CSS custom properties, `data-…` attributes. */
function paramProps(params) {
  const named = (prefix) => Object.keys(params).filter((k) => k.startsWith(prefix)).sort();
  const style = named("--").map((k) => `${k}: ${str(params[k])}`).join("; ");
  return { ...Object.fromEntries(named("data-").map((k) => [k, str(params[k])])), ...(style && { style }) };
}

/**
 * Model choice and the printed line, for one render of one output: the model an
 * element takes, what the views lay over it, whether it starts a line, and its
 * text as rendered. teiToHast renders by it; the CETEIcean tier chooses models by
 * it in the browser.
 * @template {Model} M
 * @param {Record<string, M[]>} models  by element name, as nameOf spells it
 * @param {string} output
 * @param {View[]} [views]
 */
export function createResolver(models, output, views = []) {
  /** The first model of exactly `out` (null: the base models) whose predicate holds. */
  const select = (pos, out) =>
    (models[pos.node.name] ?? []).find((m) => (m.output ?? null) === out && (!m.predicate || bool(m.predicate(pos))));
  const modelOf = (pos) => select(pos, output) ?? select(pos, null);
  const flow = (pos) => (isElement(pos.node) && modelOf(pos)?.flow) || "";

  /**
   * What the views lay over the k-th part `m` of an element's model: a view's
   * omit or, for the same behaviour, its classes and model (a view's sequence
   * overlays part by part).
   */
  function overlay(pos, m, k) {
    const classes = [];
    const laid = {};
    for (const { output: v } of views) {
      const vm = select(pos, v);
      const part = vm?.behaviour === "sequence" ? vm.parts[k] : vm;
      if (part?.behaviour === "omit") classes.push(`${v}-omit`);
      else if (part?.behaviour === m.behaviour) {
        classes.push(...part.classes);
        laid[v] = part;
      }
    }
    return { classes, laid };
  }

  /** An alternate's two readings, each marked, per view laid over it, as that view's default or alternate. */
  function readings(pos, params, laid) {
    const both = ["default" in params ? params.default : FIRST(pos), "alternate" in params ? params.alternate : SECOND(pos)];
    const same = (a, b) => (isPos(a) && isPos(b) ? a.node === b.node : a === b);
    const marks = both.map((r) => Object.entries(laid).map(([v, vm]) => {
      const d = "default" in vm.params ? vm.params.default(pos) : FIRST(pos);
      return `${v}-${seq(d).some((x) => seq(r).some((y) => same(x, y))) ? "default" : "alternate"}`;
    }));
    return { both, marks };
  }

  /** Whitespace-only text at the edge of a block, or next to one, is indentation. */
  function indentation(pos) {
    if (!pos.up.length) return true;
    const parent = parentOf(pos);
    if (flow(parent) === "inline") return false;
    const siblings = children(parent);
    const i = indexOf(pos);
    const [before, after] = [siblings[i - 1], siblings[i + 1]];
    return !before || !after || flow(before) === "block" || flow(after) === "block";
  }

  /** Nothing but whitespace, or a block, before this node in its parent. */
  function atLineStart(pos) {
    if (!pos.up.length) return true;
    const siblings = children(parentOf(pos));
    for (let i = indexOf(pos) - 1; i >= 0; i--) {
      const s = siblings[i];
      if (isElement(s.node)) return flow(s) === "block";
      if (!blank(s.node.value)) return false;
    }
    return true;
  }

  /**
   * What an element's model says of the printed line: "join:<characters>" where its
   * param `join` says the line joins the next, "stop" where it breaks the line
   * (`type` "line"), undefined otherwise. A sequence says it in a part.
   */
  function lineEnd(pos) {
    const m = modelOf(pos);
    const said = m ? [m, ...(m.parts ?? [])] : [];
    const join = said.find((x) => "join" in x.params);
    if (join) return `join:${str(join.params.join(pos))}`;
    return said.some((x) => "type" in x.params && str(x.params.type(pos)) === "line") ? "stop" : undefined;
  }

  /**
   * What a walk along the printed line meets from list[i] on (step 1 forward, -1
   * back): "join:<characters>" at a joined line end, "stop" at text, another line
   * end or a block, "" where it passes whitespace and inline elements.
   */
  function along(list, i, step) {
    for (; i >= 0 && i < list.length; i += step) {
      const { node } = list[i];
      const met = isText(node) ? (blank(node.value) ? "" : "stop")
        : lineEnd(list[i]) ?? (flow(list[i]) === "block" ? "stop" : along(children(list[i]), step > 0 ? 0 : children(list[i]).length - 1, step));
      if (met) return met;
    }
    return "";
  }

  /** "join:<characters>" where a text node's line joins the next (step 1) or the previous one (-1), else ""; the walk leaves inline elements. */
  function joined(pos, step) {
    if (!pos.up.length) return "";
    const parent = parentOf(pos);
    const siblings = children(parent);
    const met = along(siblings, indexOf(pos) + step, step);
    if (met) return met === "stop" ? "" : met;
    return flow(parent) !== "block" ? joined(parent, step) : "";
  }

  /**
   * A text node as it renders ("" drops it): whitespace collapsed; at a joined
   * line end the spaces around the break go, and a last character the model's
   * `join` names, as the model sets its own hyphen.
   */
  function renderedText(pos) {
    const { node, up } = pos;
    // The nearest xml:space decides.
    if (up.findLast((a) => a.attributes["xml:space"])?.attributes["xml:space"] === "preserve") return node.value;
    const [before, after] = [joined(pos, -1), joined(pos, 1)];
    if (blank(node.value)) return before || after || indentation(pos) ? "" : " ";
    let value = collapse(node.value);
    if (before) value = value.replace(/^ /, "");
    if (after) {
      value = value.replace(/ $/, "");
      if (value && after.slice(5).includes(value.at(-1))) value = value.slice(0, -1).replace(/ $/, "");
    }
    return value;
  }

  return { select, modelOf, overlay, readings, atLineStart, renderedText };
}

/** Behaviours that render nothing, by what the model says. */
export const SILENT = ["omit", "metadata"];

/** A param's value as strings, one per item. */
const strings = (v) => seq(v).map((item) => str([item]));

/**
 * teiToHast(tree, { output, trace }) → { hast, notes, page, sources, record }. The page,
 * output "web", has the views laid over it and a switch for each; another output
 * renders alone. `page` holds the params of the root's model for output "page", as
 * strings; its `manifest`, for the facsimile, goes on the edition too, and its `credit`
 * closes the page. With `trace`, `sources` maps each element rendered to the position and
 * the model that gave it, and `record` is the render itself as data: a record for
 * each element it reached, as often as it reached it, whose children are the
 * records and the text it rendered inside; see Record.
 * @param {Record<string, Model[]>} models  by element name
 * @param {View[]} [views]
 */
export function createRenderer(models, views = []) {
  /**
   * @param {XastNode} tree
   * @param {{ output?: string, trace?: boolean }} [options]
   * @returns {{ hast: HastElement, notes: HastElement[], page: Record<string, string[]>, sources: Map<HastNode, { pos: any, model: Model }>, record?: PmRecord }}
   */
  return function teiToHast(tree, { output = "web", trace = false } = {}) {
    const notes = [];
    const sources = new Map();
    const open = [{ children: [] }]; // the records being written, innermost last
    /** Text the page shows, as a node. */
    const shown = (value) => {
      if (trace) open.at(-1).children.push(value);
      return [text(value)];
    };
    const laidViews = output === "web" ? views : [];
    const { select, modelOf, overlay, readings, atLineStart, renderedText } = createResolver(models, output, laidViews);

    function render(pos, phrasing) {
      const { node } = pos;
      if (isText(node)) {
        const value = renderedText(pos);
        return value ? shown(value) : [];
      }
      const model = modelOf(pos);
      if (!trace) return renderBy(model, pos, phrasing);
      const params = Object.entries(model?.params ?? {}).map(([name, f]) => [name, strings(f(pos))]);
      const record = {
        element: node.name, model: model?.id ?? null, behaviour: model?.behaviour ?? null,
        classes: [`tei-${localName(node.name)}`, ...(model?.classes ?? [])],
        ...(params.length && { params: Object.fromEntries(params) }),
        outcome: "rendered", children: [],
      };
      open.at(-1).children.push(record);
      open.push(record);
      const rendered = renderBy(model, pos, phrasing);
      open.pop();
      if (!model) record.outcome = "passed-through";
      else if (SILENT.includes(model.behaviour)) record.outcome = "omitted";
      else if (!rendered.length) record.outcome = "empty";
      return rendered;
    }

    function renderBy(model, pos, phrasing) {
      if (!model) return children(pos).flatMap((c) => render(c, phrasing));
      if (model.behaviour !== "sequence") return apply(model, pos, phrasing, true);
      const running = model.parts.filter((p) => !p.predicate || bool(p.predicate(pos)));
      if (trace) open.at(-1).parts = running.map((p) => p.id);
      return running.flatMap((p) => apply(p, pos, phrasing, p === running[0], undefined, model.parts.indexOf(p)));
    }

    function apply(m, pos, phrasing, first, inner, k = 0) {
      const rendered = applyModel(m, pos, phrasing, first, inner, k);
      if (trace) for (const el of rendered) if (!sources.has(el)) sources.set(el, { pos, model: m });
      return rendered;
    }

    function applyModel(m, pos, phrasing, first, inner, k) {
      const { node } = pos;
      const params = Object.fromEntries(Object.entries(m.params).map(([name, f]) => [name, f(pos)]));
      const { classes: viewClasses, laid } = overlay(pos, m, k);
      const props = {
        className: [`tei-${localName(node.name)}`, ...m.classes, ...viewClasses, ...(m.source ? renditions(node) : [])],
        id: first ? node.attributes["xml:id"] : undefined,
        lang: node.attributes["xml:lang"],
        ...paramProps(params),
      };
      const kids = (ph) => children(pos).flatMap((c) => render(c, ph));
      /** A param's value: the nodes it selects rendered by their own models (the element itself by its content), anything else as text. */
      const value = (v, ph) =>
        seq(v).flatMap((item) =>
          !isPos(item) ? (String(item) ? shown(String(item)) : []) : item.node === node ? kids(ph) : render(item, ph),
        );
      /** A template filled in: each `[[name]]` the value of that param, in an attribute its strings. */
      const fill = (nodes, ph) =>
        nodes.flatMap((n) => typeof n === "string"
          ? n.split(PLACEHOLDER).flatMap((s, i) => (i % 2 ? (s in params ? value(params[s], ph) : []) : s ? shown(s) : []))
          : [h(n.name,
            Object.fromEntries(Object.entries(n.attributes).map(([k, v]) =>
              [k === "class" ? "className" : k, v.replace(PLACEHOLDER, (_, s) => strings(params[s] ?? []).join(" "))])),
            fill(n.children, ph || PHRASING.has(n.name)))]);
      const content = (ph) => (m.template ? fill(m.template, ph) : "content" in params ? value(params.content, ph) : kids(ph));
      const wrap = (tag) =>
        m.flow === "block" && phrasing
          ? [h("span", { ...props, className: [...props.className, "pm-block"] }, content(true))]
          : [h(tag, props, content(PHRASING.has(tag)))];

      switch (m.behaviour) {
        case "omit":
        case "metadata":
          return [];
        case "text":
        case "pass-through": // a TEI Publisher extension
          return content(phrasing);
        case "heading": {
          const level = Math.min(6, Math.max(1, Math.trunc(Number(str(params.level ?? ""))) || 1));
          return wrap(`h${level}`);
        }
        case "figure": {
          const [figure] = wrap("figure");
          const title = "title" in params ? value(params.title, phrasing) : [];
          if (title.length) figure.children.push(h(phrasing ? "span" : "figcaption", {}, title));
          return [figure];
        }
        case "alternate": {
          const { both, marks } = readings(pos, params, laid);
          return [h("span", { ...props, className: [...props.className, "tei-alternate"] }, [
            h("span", { className: ["tei-alternate-default", ...marks[0]] }, value(both[0], true)),
            h("span", { className: ["tei-alternate-alt", ...marks[1]], hidden: true }, value(both[1], true)),
          ])];
        }
        case "note": {
          const place = "place" in params ? str(params.place) : "end";
          const note = { place: NUMBERED.includes(place) ? "end" : place, id: props.id };
          notes.push(note);
          if (note.place === "end") note.n = notes.filter((x) => x.place === "end").length;
          note.body = content(false);
          if (note.place !== "end") return [];
          const range = "range" in params ? str(params.range).replace(/^#/, "") : undefined;
          return [h("a", { ...props, className: [...props.className, "tei-note-ref"], href: `#note-${note.n}`, "data-range": range }, [text(String(note.n))])];
        }
        case "break": {
          const line = "type" in params && str(params.type) === "line";
          if (line && atLineStart(pos)) return [];
          if (!("label" in params)) return [h("br", props)];
          const label = str(params.label);
          const span = h("span", props, label ? [text(label)] : []);
          return line ? [span, h("br", { ...props, id: undefined })] : [span];
        }
        case "anchor":
          return props.id ? [h("span", props)] : [];
        case "link":
          return [h("a", { ...props, href: str(params.uri ?? "") }, inner ?? content(true))];
        case "graphic":
          return [h("img", { ...props, src: str(params.url ?? ""), alt: "" })];
        case "compound": { // a <model> holding a <modelSequence> (Boot 2024): an extension
          const link = m.parts.find((p) => p.behaviour === "link");
          const rest = m.parts.filter((p) => p !== link).flatMap((p) => apply(p, pos, phrasing, p === m.parts[0]));
          return link ? apply(link, pos, phrasing, link === m.parts[0], rest) : rest;
        }
        case "index": {
          const heads = [];
          (function walk(p) {
            for (const c of children(p).filter((k) => isElement(k.node))) modelOf(c)?.behaviour === "heading" ? heads.push(textOf(c.node)) : walk(c);
          })(pos);
          if (heads.length < 2) return [];
          return [h("nav", { className: ["tei-toc"] }, [h("ul", {}, heads.map((t) => h("li", {}, shown(collapse(t).trim()))))])];
        }
        default:
          return wrap(m.tag);
      }
    }

    const top = tree.type === "root" ? tree.children.filter(isElement) : [tree];
    const body = top.flatMap((node) => render({ node, up: [] }, false));

    const ends = notes.filter((n) => n.place === "end").map((n) =>
      h("aside", { className: ["tei-note-body"], id: `note-${n.n}` }, [h("span", { className: ["tei-note-num"] }, [text(`${n.n}.`)]), text(" "), ...n.body]));
    const sections = [...new Set(notes.map((n) => n.place))].map((place) =>
      place === "end"
        ? h("section", { className: ["tei-footnotes"] }, ends)
        : h("section", { className: ["tei-notes"], "data-place": place },
          notes.filter((n) => n.place === place).map((n) => h("aside", { className: ["tei-note-body"], id: n.id }, n.body))));

    // A checkbox per view: CSS lays the view over the page while it is checked.
    const switches = laidViews.length
      ? [h("form", { className: ["tei-views"] }, laidViews.map(({ output: v, label }) =>
        h("label", {}, [h("input", { type: "checkbox", "data-view": v }), text(` ${label}`)])))]
      : [];
    const root = top[0] && { node: top[0], up: [] };
    const meta = root && select(root, "page");
    const page = meta ? Object.fromEntries(Object.entries(meta.params).map(([k, f]) => [k, strings(f(root))])) : {};
    const credit = output === "web" && page.credit?.[0] ? [h("footer", { className: ["tei-credit"] }, [text(page.credit[0])])] : [];

    return { hast: h("div", { className: ["tei-edition"], [`data-${output}`]: "on", ...(page.manifest?.[0] && { "data-manifest": page.manifest[0] }) }, [...switches, ...body, ...sections, ...credit]), notes: ends, page, sources, record: open[0].children[0] };
  };
}
