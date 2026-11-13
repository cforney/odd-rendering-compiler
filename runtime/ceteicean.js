/*
 * ceteicean.js — the runtime of a generated tei-ceteicean-behaviours.js, the
 * CETEIcean tier. Both CETEIcean generators copy it in after xpath.mjs (as
 * `teiXpath`) and pm-runtime.mjs (as `teiPm`), followed by the ODD's models as
 * `teiModels`, with predicates and params as XPath, and its views as `teiViews`.
 *
 * Before CETEIcean turns the TEI into custom elements, each element's model is
 * chosen as the unified handlers choose it, by the same resolver and XPath,
 * with what the views lay over it, and marked on the element (`data-pm`); each
 * text is set as it renders. The behaviours then reshape every custom element
 * into the HTML the other renderers emit, with the same classes, so edition.css
 * styles it alike; the notes are collected after the text, as they collect
 * them, and a switch for each view goes before it. Once reshaped, a custom element
 * is only a wrapper. It would split text the other renderers keep in one piece,
 * and so place its glyphs a little differently, so teiUnwrap removes it.
 */

const TEI_PHRASING = ["p", "span", "a", "h1", "h2", "h3", "h4", "h5", "h6"];
const TEI_NUMBERED = ["end", "foot"];
const TEI_PLACEHOLDER = /\[\[([^[\]]*)\]\]/g;

/** The models with their XPath compiled. */
function teiCompile(models) {
  const compile = (m) => ({
    ...m,
    predicate: m.predicate ? teiXpath.xpath(m.predicate, m.at) : undefined,
    params: Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, teiXpath.xpath(v, m.at)])),
    parts: m.parts && m.parts.map(compile),
  });
  return Object.fromEntries(Object.entries(models).map(([ident, ms]) => [ident, ms.map(compile)]));
}

/** An XML DOM node as xast, which the XPath reads; each xast node keeps its DOM node. */
function teiXast(n) {
  if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) return { type: "text", value: n.nodeValue, dom: n };
  if (n.nodeType !== Node.ELEMENT_NODE) return null;
  const declared = (a) => a.name === "xmlns" || a.prefix === "xmlns";
  const key = (a) => (a.namespaceURI && a.prefix !== "xml" ? `{${a.namespaceURI}}${a.localName}` : a.name);
  const attributes = Object.fromEntries(Array.from(n.attributes).filter((a) => !declared(a)).map((a) => [key(a), a.value]));
  return { type: "element", name: teiXpath.nameOf(n.namespaceURI ?? "", n.localName), attributes, children: Array.from(n.childNodes, teiXast).filter(Boolean), dom: n };
}

/** Render the TEI source with CETEIcean, the models and the views laid over them; done(dom) receives the result. */
function teiEdition(ct, source, models, views, done) {
  const { seq, str, bool, isPos } = teiXpath;
  const resolver = teiPm.createResolver(teiCompile(models), "web", views);
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const choices = [];      // per element, by its data-pm: its ident, position and evaluated models
  const marks = new Map(); // xast element → its data-pm
  let notes = 0;
  // the source's xml:ids, which a note's generated id must not repeat
  const taken = new Set(Array.from(doc.getElementsByTagName("*"), (n) => n.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id")).filter(Boolean));

  /** The k-th part of an element's model at the element: its params evaluated, what the views lay over it, and what its behaviour needs to know there. */
  function evaluate(m, pos, k = 0) {
    const e = { m, params: Object.fromEntries(Object.entries(m.params).map(([name, f]) => [name, f(pos)])), ...resolver.overlay(pos, m, k) };
    if (m.behaviour === "alternate") Object.assign(e, resolver.readings(pos, e.params, e.laid));
    if (m.behaviour === "note" && TEI_NUMBERED.includes("place" in e.params ? str(e.params.place) : "end")) e.n = ++notes;
    if (m.behaviour === "break") e.lineStart = resolver.atLineStart(pos);
    if (m.parts) e.parts = m.parts.map((p) => evaluate(p, pos));
    return e;
  }

  // Choose, in document order, so notes are numbered as the other renderers number them.
  (/** @param {any} pos */ function walk(pos) {
    const { node } = pos;
    if (node.type === "text") {
      node.dom.nodeValue = resolver.renderedText(pos);
      return;
    }
    const m = resolver.modelOf(pos);
    const parts = !m ? [] : m.behaviour === "sequence" ? m.parts.map((p, k) => [p, k]).filter(([p]) => !p.predicate || bool(p.predicate(pos))) : [[m, 0]];
    marks.set(node, choices.length);
    node.dom.setAttribute("data-pm", choices.length);
    choices.push(m && { ident: node.name, pos, models: parts.map(([p, k]) => evaluate(p, pos, k)) });
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
      n.className = [`tei-${c.ident}`, ...m.classes, ...e.classes, ...(m.source ? teiRenditions(el) : []), ...extra].join(" ");
      const id = first && el.getAttribute("xml:id");
      if (id) n.id = id;
      if (el.getAttribute("xml:lang")) n.lang = el.getAttribute("xml:lang");
      teiParamProps(n, params);
      n.append(...children);
      return n;
    };
    /** A template filled in: each `[[name]]` the value of that param, in an attribute its strings. */
    const fill = (nodes) => Array.from(nodes).flatMap((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        return n.nodeValue.split(TEI_PLACEHOLDER).flatMap((s, i) => (i % 2 ? (s in params ? value(params[s], c, content) : []) : s ? [s] : []));
      }
      const out = document.createElement(n.localName);
      for (const a of n.attributes) out.setAttribute(a.localName, a.value.replace(TEI_PLACEHOLDER, (_, s) => seq(params[s] ?? []).map((x) => str([x])).join(" ")));
      out.append(...fill(n.childNodes));
      return [out];
    });
    const own = () =>
      m.template ? fill(new DOMParser().parseFromString(`<t>${m.template}</t>`, "application/xml").documentElement.childNodes)
      : "content" in params ? value(params.content, c, content) : content();
    const wrap = (tag) => (m.flow === "block" && teiPhrasing(el) ? [make("span", own(), ["pm-block"])] : [make(tag, own())]);

    switch (m.behaviour) {
      case "omit":
      case "metadata":
        return [];
      case "text":
      case "pass-through": // a TEI Publisher extension
        return own();
      case "heading":
        return wrap(`h${Math.min(6, Math.max(1, Math.trunc(Number(str(params.level ?? ""))) || 1))}`);
      case "figure": {
        const [figure] = wrap("figure");
        const title = "title" in params ? value(params.title, c, content) : [];
        if (title.length) {
          const caption = figure.appendChild(document.createElement(figure.localName === "span" ? "span" : "figcaption"));
          caption.append(...title);
        }
        return [figure];
      }
      case "alternate": {
        const reading = (k, cls, hidden) => {
          const s = document.createElement("span");
          s.className = [cls, ...e.marks[k]].join(" ");
          s.hidden = hidden;
          s.append(...value(e.both[k], c, content));
          return s;
        };
        return [make("span", [reading(0, "tei-alternate-default", false), reading(1, "tei-alternate-alt", true)], ["tei-alternate"])];
      }
      case "note": {
        const aside = document.createElement("aside");
        aside.className = "tei-note-body";
        if (e.n) {
          aside.id = teiPm.noteId(e.n, taken);
          const num = aside.appendChild(document.createElement("span"));
          num.className = "tei-note-num";
          num.textContent = `${e.n}.`;
          aside.append(" ");
        }
        aside.append(...own());
        section(e.n ? "end" : str(params.place)).append(aside);
        if (!e.n) {
          if (first && el.getAttribute("xml:id")) aside.id = el.getAttribute("xml:id");
          return [];
        }
        const ref = make("a", [String(e.n)], ["tei-note-ref"]);
        ref.href = `#${teiPm.noteId(e.n, taken)}`;
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
      case "compound": { // a <model> holding a <modelSequence> (Boot 2024): an extension
        const link = e.parts.find((p) => p.m.behaviour === "link");
        const rest = e.parts.filter((p) => p !== link).flatMap((p) => render(el, c, p, p === e.parts[0], content));
        return link ? render(el, c, link, link === e.parts[0], content, rest) : rest;
      }
      case "index": {
        const heads = [];
        (function walk(n) {
          for (const k of n.children) choices[k.getAttribute("data-pm")]?.models[0]?.m.behaviour === "heading" ? heads.push(k.textContent.replace(/\s+/g, " ").trim()) : walk(k);
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
  const root = { node: teiXast(doc.documentElement), up: [] };
  const page = resolver.select(root, "page");
  if (page?.params.title) document.title = str(page.params.title(root));
  const lang = page?.params.lang ? str(page.params.lang(root)) : "";
  if (lang) document.documentElement.lang = lang;
  ct.domToHTML5(doc, (dom) => done(teiRoot(views, dom, ...["manifest", "credit"].map((p) => (page?.params[p] ? str(page.params[p](root)) : "")))));
}

/** Replace each custom element by its content, the innermost first, and join the text that leaves apart. */
function teiUnwrap(root) {
  const wrappers = Array.from(root.querySelectorAll("*")).filter((el) => el.localName.startsWith("tei-"));
  for (const el of wrappers.reverse()) el.replaceWith(...el.childNodes);
  root.normalize();
}

/** The edition's root: a checkbox per view, which CSS lays over the page while it is checked, then the text and the credit. */
function teiRoot(views, dom, manifest, credit) {
  const root = document.createElement("div");
  root.className = "tei-edition";
  root.dataset.web = "on";
  if (manifest) root.dataset.manifest = manifest;
  if (views.length) {
    const form = root.appendChild(document.createElement("form"));
    form.className = "tei-views";
    for (const { output, label } of views) {
      const l = form.appendChild(document.createElement("label"));
      const box = l.appendChild(document.createElement("input"));
      box.type = "checkbox";
      box.dataset.view = output;
      l.append(` ${label}`);
    }
  }
  root.append(dom);
  if (credit) root.append(Object.assign(document.createElement("footer"), { className: "tei-credit", textContent: credit }));
  return root;
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
