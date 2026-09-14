/*
 * ceteicean.js — the runtime of a generated tei-ceteicean-behaviours.js, the
 * CETEIcean tier. Both CETEIcean generators copy it in after xpath.mjs (as
 * `teiXpath`) and pm-runtime.mjs (as `teiPm`), followed by the ODD's models as
 * `teiModels`, with predicates and params as XPath.
 *
 * Before CETEIcean turns the TEI into custom elements, each element's model is
 * chosen as the unified handlers choose it, by the same resolver and XPath, and
 * marked on the element (`data-pm`); each text is set as it renders. The
 * behaviours then reshape every custom element into the HTML the other
 * renderers emit, with the same classes, so edition.css styles it alike; the
 * notes are collected after the text, as they collect them.
 */

const TEI_PHRASING = ["p", "span", "a", "h1", "h2", "h3", "h4", "h5", "h6"];
const TEI_NUMBERED = ["end", "foot"];

/** The models with their XPath compiled. */
function teiCompile(models) {
  const compile = (m) => ({
    ...m,
    predicate: m.predicate ? teiXpath.xpath(m.predicate) : undefined,
    params: Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, teiXpath.xpath(v)])),
    parts: m.parts && m.parts.map(compile),
  });
  return Object.fromEntries(Object.entries(models).map(([ident, ms]) => [ident, ms.map(compile)]));
}

/** An XML DOM node as xast, which the XPath reads; each xast node keeps its DOM node. */
function teiXast(n) {
  if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) return { type: "text", value: n.nodeValue, dom: n };
  if (n.nodeType !== Node.ELEMENT_NODE) return null;
  const attributes = Object.fromEntries(Array.from(n.attributes, (a) => [a.name, a.value]));
  return { type: "element", name: n.nodeName, attributes, children: Array.from(n.childNodes, teiXast).filter(Boolean), dom: n };
}

/** Render the TEI source with CETEIcean and the models; done(dom) receives the result. */
function teiEdition(ct, source, models, done) {
  const { xpath, seq, str, bool, isPos } = teiXpath;
  const resolver = teiPm.createResolver(teiCompile(models), "web");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const choices = [];      // per element, by its data-pm: its ident, position and evaluated models
  const marks = new Map(); // xast element → its data-pm
  const [FIRST, SECOND] = [xpath("*[1]"), xpath("*[2]")];
  let notes = 0;

  /** A model at an element: its params evaluated, and what its behaviour needs to know there. */
  function evaluate(m, pos) {
    const e = { m, params: Object.fromEntries(Object.entries(m.params).map(([k, f]) => [k, f(pos)])) };
    if (m.behaviour === "alternate") {
      if (!("default" in e.params)) e.params.default = FIRST(pos);
      if (!("alternate" in e.params)) e.params.alternate = SECOND(pos);
    }
    if (m.behaviour === "note" && TEI_NUMBERED.includes("place" in e.params ? str(e.params.place) : "end")) e.n = ++notes;
    if (m.behaviour === "break") e.lineStart = resolver.atLineStart(pos);
    if (m.parts) e.parts = m.parts.map((p) => evaluate(p, pos));
    return e;
  }

  // Choose, in document order, so notes are numbered as the other renderers number them.
  (function walk(pos) {
    const { node } = pos;
    if (node.type === "text") {
      node.dom.nodeValue = resolver.renderedText(pos);
      return;
    }
    const m = resolver.modelOf(pos);
    const live = !m ? [] : m.behaviour === "sequence" ? m.parts.filter((p) => !p.predicate || bool(p.predicate(pos))) : [m];
    marks.set(node, choices.length);
    node.dom.setAttribute("data-pm", choices.length);
    choices.push(m && { ident: node.name.replace(/^.*:/, ""), pos, models: live.map((p) => evaluate(p, pos)) });
    if (m && ["omit", "metadata"].includes(m.behaviour)) return;
    node.children.forEach((c, i) => walk({ node: c, up: [...pos.up, node], i }));
  })({ node: teiXast(doc.documentElement), up: [] });

  /** Reshape a custom element by its choice: the rendered nodes replace its content, and it keeps no box of its own. */
  function apply(el, c) {
    const kids = Array.from(el.childNodes);
    let used = false;
    const content = () => (used ? kids.map((n) => n.cloneNode(true)) : ((used = true), kids));
    const nodes = c.models.flatMap((e, k) => render(el, c, e, k === 0, content));
    el.removeAttribute("id"); // CETEIcean's copy of xml:id; the rendered element carries it
    el.replaceChildren(...nodes);
    el.style.display = "contents";
  }

  /** The section after the text that collects the notes of a place: the numbered ones at "end". */
  const sections = new Map();
  function section(place) {
    if (!sections.has(place)) {
      const s = document.createElement("section");
      s.className = place === "end" ? "tei-footnotes" : "tei-notes";
      if (place !== "end") s.dataset.place = place;
      document.querySelector('[data-pm="0"]').append(s);
      sections.set(place, s);
    }
    return sections.get(place);
  }

  /** A param's value: the nodes it selects rendered by their own models (the element itself by its content), anything else as text. */
  function value(v, c, content) {
    return seq(v).flatMap((item) => {
      if (!isPos(item)) return String(item) ? [document.createTextNode(String(item))] : [];
      if (item.node === c.pos.node) return content();
      if (item.node.type === "text") return [document.createTextNode(item.node.dom.nodeValue)];
      const target = document.querySelector(`[data-pm="${marks.get(item.node)}"]`);
      return target ? [target] : [];
    });
  }

  function render(el, c, e, first, content, inner) {
    const { m, params } = e;
    const make = (tag, children, extra = []) => {
      const n = document.createElement(tag);
      n.className = [`tei-${c.ident}`, ...m.classes, ...(m.source ? teiRenditions(el) : []), ...extra].join(" ");
      const id = first && el.getAttribute("xml:id");
      if (id) n.id = id;
      if (el.getAttribute("xml:lang")) n.lang = el.getAttribute("xml:lang");
      teiParamProps(n, params);
      n.append(...children);
      return n;
    };
    const own = () => ("content" in params ? value(params.content, c, content) : content());
    const wrap = (tag) => (m.flow === "block" && teiPhrasing(el) ? [make("span", own(), ["pm-block"])] : [make(tag, own())]);

    switch (m.behaviour) {
      case "omit":
      case "metadata":
        return [];
      case "text":
        return own();
      case "heading":
        return wrap(`h${Math.min(6, Math.max(1, Math.trunc(Number(str(params.level ?? ""))) || 1))}`);
      case "alternate": {
        const reading = (cls, v, hidden) => {
          const s = document.createElement("span");
          s.className = cls;
          s.hidden = hidden;
          s.append(...value(v, c, content));
          return s;
        };
        return [make("span", [reading("tei-alternate-default", params.default, false), reading("tei-alternate-alt", params.alternate, true)], ["tei-alternate"])];
      }
      case "note": {
        const aside = document.createElement("aside");
        aside.className = "tei-note-body";
        if (e.n) {
          aside.id = `note-${e.n}`;
          const num = aside.appendChild(document.createElement("span"));
          num.className = "tei-note-num";
          num.textContent = `${e.n}.`;
          aside.append(" ");
        }
        aside.append(...own());
        section(e.n ? "end" : str(params.place)).append(aside);
        if (!e.n) return [];
        const ref = make("a", [String(e.n)], ["tei-note-ref"]);
        ref.removeAttribute("id");
        ref.href = `#note-${e.n}`;
        if ("range" in params) ref.dataset.range = str(params.range).replace(/^#/, "");
        return [ref];
      }
      case "break": {
        const line = "type" in params && str(params.type) === "line";
        if (line && e.lineStart) return [];
        if (!("label" in params)) return [make("br", [])];
        const span = make("span", str(params.label) ? [str(params.label)] : []);
        if (!line) return [span];
        const br = make("br", []);
        br.removeAttribute("id");
        return [span, br];
      }
      case "anchor":
        return first && el.getAttribute("xml:id") ? [make("span", [])] : [];
      case "link": {
        const a = make("a", inner ?? own());
        a.href = str(params.uri ?? "");
        return [a];
      }
      case "graphic": {
        const img = make("img", []);
        img.src = str(params.url ?? "");
        img.alt = "";
        return [img];
      }
      case "compound": { // a <model> holding a <modelSequence> (Boot 2024): an extension, not TEI
        const link = e.parts.find((p) => p.m.behaviour === "link");
        const rest = e.parts.filter((p) => p !== link).flatMap((p) => render(el, c, p, p === e.parts[0], content));
        return link ? render(el, c, link, link === e.parts[0], content, rest) : rest;
      }
      case "index": {
        const heads = [];
        (function walk(n) {
          for (const k of n.children) k.localName === "tei-head" ? heads.push(k.textContent.replace(/\s+/g, " ").trim()) : walk(k);
        })(el);
        if (heads.length < 2) return [];
        const nav = document.createElement("nav");
        nav.className = "tei-toc";
        const ul = nav.appendChild(document.createElement("ul"));
        for (const t of heads) ul.appendChild(document.createElement("li")).textContent = t;
        return [nav];
      }
      default:
        return wrap(m.tag || "span");
    }
  }

  ct.addBehaviors({
    namespaces: { tei: "http://www.tei-c.org/ns/1.0" },
    tei: Object.fromEntries(Object.keys(models).map((ident) => [ident, (el) => {
      const c = choices[el.getAttribute("data-pm")];
      if (c) apply(el, c);
    }])),
  });
  ct.domToHTML5(doc, done);
}

/** `@rendition="#a #b"` → r-a r-b */
function teiRenditions(el) {
  return (el.getAttribute("rendition") || "").split(/\s+/).filter(Boolean).map((t) => "r-" + t.replace(/^#/, ""));
}

/** Params named `--…` become CSS custom properties, `data-…` attributes. */
function teiParamProps(n, params) {
  const named = (prefix) => Object.keys(params).filter((k) => k.startsWith(prefix)).sort();
  for (const k of named("data-")) n.setAttribute(k, teiXpath.str(params[k]));
  const style = named("--").map((k) => `${k}: ${teiXpath.str(params[k])}`).join("; ");
  if (style) n.setAttribute("style", style);
}

/** Whether the element sits in phrasing content: its nearest rendered ancestor is a paragraph, a span, a link or a heading. */
function teiPhrasing(el) {
  const host = el.parentElement && el.parentElement.closest(":not([data-pm])");
  return !!host && TEI_PHRASING.includes(host.localName);
}
