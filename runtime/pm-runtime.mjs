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

export const h = (tagName, properties = {}, children = []) => ({ type: "element", tagName, properties, children });
export const text = (value) => ({ type: "text", value });

const isElement = (n) => n?.type === "element";
const isText = (n) => n?.type === "text";
const localName = (qname) => qname.slice(qname.indexOf(":") + 1);
const textOf = (n) => (isText(n) ? n.value : (n.children ?? []).map(textOf).join(""));
/** XML whitespace, as XPath counts it (not the no-break space). */
const blank = (s) => !/[^ \t\n\r]/.test(s);
const collapse = (s) => s.replace(/[ \t\n\r]+/g, " ");

/** HTML elements whose content must be phrasing: a block inside becomes a span. */
const PHRASING = new Set(["p", "span", "a", "h1", "h2", "h3", "h4", "h5", "h6"]);
/** Note places that get a numbered marker in the text and go to the footnotes. */
const NUMBERED = ["end", "foot"];
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
 * element takes, whether it starts a line, and its text as rendered. teiToHast
 * renders by it; the CETEIcean tier chooses models by it in the browser.
 */
export function createResolver(models, output) {
  const select = (ms, pos, out) => ms.find((m) => (m.output ?? null) === out && (!m.predicate || bool(m.predicate(pos))));
  const modelOf = (pos) => {
    const ms = models[localName(pos.node.name)] ?? [];
    return select(ms, pos, output) ?? select(ms, pos, null);
  };
  const flow = (pos) => (isElement(pos.node) && modelOf(pos)?.flow) || "";

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
   * What a walk along the printed line meets from list[i] on (step 1 forward, -1
   * back): "join" at a joined line end (lb break="no"), "stop" at text, another
   * line end or a block, "" where it passes whitespace and inline elements.
   */
  function along(list, i, step) {
    for (; i >= 0 && i < list.length; i += step) {
      const { node } = list[i];
      const met = isText(node) ? (blank(node.value) ? "" : "stop")
        : localName(node.name) === "lb" ? (node.attributes.break === "no" ? "join" : "stop")
        : flow(list[i]) === "block" ? "stop"
        : along(children(list[i]), step > 0 ? 0 : children(list[i]).length - 1, step);
      if (met) return met;
    }
    return "";
  }

  /** Whether a text node's line joins the next (step 1) or the previous one (-1); the walk leaves inline elements. */
  function joined(pos, step) {
    if (!pos.up.length) return false;
    const parent = parentOf(pos);
    const siblings = children(parent);
    const met = along(siblings, indexOf(pos) + step, step);
    return met ? met === "join" : flow(parent) !== "block" && joined(parent, step);
  }

  /**
   * A text node as it renders ("" drops it): whitespace collapsed; at a joined
   * line end the lb's model sets the hyphen, so the encoded one goes, and so do
   * the spaces around the break.
   */
  function renderedText(pos) {
    const { node, up } = pos;
    if (up.some((a) => a.attributes["xml:space"] === "preserve")) return node.value;
    const [before, after] = [joined(pos, -1), joined(pos, 1)];
    if (blank(node.value)) return before || after || indentation(pos) ? "" : " ";
    let value = collapse(node.value);
    if (before) value = value.replace(/^ /, "");
    if (after) value = value.replace(/ ?[-\u00AD¬\u2010\u2011\u2E17]? ?$/, "");
    return value;
  }

  return { modelOf, atLineStart, renderedText };
}

export function createRenderer(models) {
  return function teiToHast(tree, { output = "web" } = {}) {
    const notes = [];
    const { modelOf, atLineStart, renderedText } = createResolver(models, output);

    function render(pos, phrasing) {
      const { node } = pos;
      if (isText(node)) {
        const value = renderedText(pos);
        return value ? [text(value)] : [];
      }
      const model = modelOf(pos);
      if (!model) return children(pos).flatMap((c) => render(c, phrasing));
      if (model.behaviour === "sequence") {
        const live = model.parts.filter((p) => !p.predicate || bool(p.predicate(pos)));
        return live.flatMap((p, k) => apply(p, pos, phrasing, k === 0));
      }
      return apply(model, pos, phrasing, true);
    }

    function apply(m, pos, phrasing, first, inner) {
      const { node } = pos;
      const params = Object.fromEntries(Object.entries(m.params).map(([k, f]) => [k, f(pos)]));
      const props = {
        className: [`tei-${localName(node.name)}`, ...m.classes, ...(m.source ? renditions(node) : [])],
        id: first ? node.attributes["xml:id"] : undefined,
        lang: node.attributes["xml:lang"],
        ...paramProps(params),
      };
      const kids = (ph) => children(pos).flatMap((c) => render(c, ph));
      /** A param's value: the nodes it selects rendered by their own models (the element itself by its content), anything else as text. */
      const value = (v, ph) =>
        seq(v).flatMap((item) =>
          !isPos(item) ? (String(item) ? [text(String(item))] : []) : item.node === node ? kids(ph) : render(item, ph),
        );
      const content = (ph) => ("content" in params ? value(params.content, ph) : kids(ph));
      const wrap = (tag) =>
        m.flow === "block" && phrasing
          ? [h("span", { ...props, className: [...props.className, "pm-block"] }, content(true))]
          : [h(tag, props, content(PHRASING.has(tag)))];

      switch (m.behaviour) {
        case "omit":
        case "metadata":
          return [];
        case "text":
          return content(phrasing);
        case "heading": {
          const level = Math.min(6, Math.max(1, Math.trunc(Number(str(params.level ?? ""))) || 1));
          return wrap(`h${level}`);
        }
        case "alternate":
          return [h("span", { ...props, className: [...props.className, "tei-alternate"] }, [
            h("span", { className: ["tei-alternate-default"] }, value("default" in params ? params.default : FIRST(pos), true)),
            h("span", { className: ["tei-alternate-alt"], hidden: true }, value("alternate" in params ? params.alternate : SECOND(pos), true)),
          ])];
        case "note": {
          const place = "place" in params ? str(params.place) : "end";
          const note = { place: NUMBERED.includes(place) ? "end" : place };
          notes.push(note);
          if (note.place === "end") note.n = notes.filter((x) => x.place === "end").length;
          note.body = content(false);
          if (note.place !== "end") return [];
          const range = "range" in params ? str(params.range).replace(/^#/, "") : undefined;
          return [h("a", { ...props, id: undefined, className: [...props.className, "tei-note-ref"], href: `#note-${note.n}`, "data-range": range }, [text(String(note.n))])];
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
          (function walk(n) {
            for (const c of (n.children ?? []).filter(isElement)) localName(c.name) === "head" ? heads.push(textOf(c)) : walk(c);
          })(node);
          if (heads.length < 2) return [];
          return [h("nav", { className: ["tei-toc"] }, [h("ul", {}, heads.map((t) => h("li", {}, [text(collapse(t).trim())])))])];
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
          notes.filter((n) => n.place === place).map((n) => h("aside", { className: ["tei-note-body"] }, n.body))));

    return { hast: h("div", { className: ["tei-edition"] }, [...body, ...sections]), notes: ends };
  };
}
