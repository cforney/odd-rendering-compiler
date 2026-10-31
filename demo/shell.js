// Demo shell: builds the path tabs, the document picker, the JS on/off toggle, the
// side panel and the inspector from the manifest embedded by build-demo.mjs. No
// framework — the page that argues for static-first is itself static-first.

const data = JSON.parse(document.getElementById("demo-data").textContent);
const byId = (id) => document.getElementById(id);
const make = (parent, tag, text, className) => {
  const el = parent.appendChild(document.createElement(tag));
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};

// State: the document, the rendering path, whether the page may run JavaScript, the
// views laid over it, and the inspector: whether it is on, and what it has picked.
// All but inspecting is in the URL, so a state can be shared and survives a reload.
const asked = new URLSearchParams(location.hash.slice(1));
const state = {
  doc: data.docs.find((d) => d.id === asked.get("doc"))?.id ?? data.docs[0].id,
  path: data.paths.find((p) => p.id === asked.get("path")) ?? data.paths[0],
  js: asked.get("js") !== "off",
  views: new Set((asked.get("views") ?? "").split(",").filter((v) => data.views.some((w) => w.output === v))),
  inspecting: false,
  picked: asked.has("pick") ? Number(asked.get("pick")) : null,
};

function remember() {
  const hash = new URLSearchParams({ doc: state.doc, path: state.path.id });
  if (state.views.size) hash.set("views", [...state.views].join(","));
  if (!state.js) hash.set("js", "off");
  if (state.picked !== null) hash.set("pick", state.picked);
  history.replaceState(null, "", `#${hash}`);
}

function render() {
  const page = state.path.pages[state.doc];
  // A page runs JS only when "allow-scripts" is in its sandbox; toggling it and
  // reassigning src reloads the frame — a genuine progressive-enhancement proof.
  const frame = byId("page");
  frame.setAttribute("sandbox", state.js ? "allow-scripts allow-same-origin" : "allow-same-origin");
  frame.src = page ? page.url : "about:blank";

  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.id === state.path.id));
  byId("about-box").style.setProperty("--hue", state.path.hue);
  byId("about-title").textContent = `${state.path.family} · ${state.path.label}`;
  byId("about-purpose").textContent = state.path.plain;
  byId("how").hidden = !state.path.how;
  byId("how-text").innerHTML = state.path.how ?? ""; // the compilers' own banner
  byId("notice").hidden = state.js || !state.path.needsJs;
  const ext = page?.jsExternal.length ? ` + ${cdnNames(page)} (CDN)` : "";
  const also = state.path.fetchesKB ? ` + ${state.path.fetchesKB} KB compiled stylesheet` : "";
  byId("metrics").textContent = !page ? "No page for this document."
    : state.path.report ? `${page.pageKB} KB` : `Page ${page.pageKB} KB${also} · client JS ${page.jsKB} KB${ext}`;
  byId("inspect").hidden = !data.inspect || Boolean(state.path.report);
  byId("views").hidden = !data.views.length || Boolean(state.path.report);
  byId("floor").hidden = Boolean(state.path.report);
  // A report is the same with or without JavaScript, so the switch would say nothing.
  const jsOn = byId("js-on");
  jsOn.disabled = Boolean(state.path.report);
  jsOn.parentElement.title = jsOn.disabled ? "Reports are plain files: JavaScript makes no difference" : "Reload this rendering with or without JavaScript";
  markCompared();
  remember();
  const link = byId("artefact-link");
  link.textContent = state.path.artefact.label;
  link.href = state.path.artefact.url;
}

// --- The inspector ----------------------------------------------------------
// The build recorded, for one document, what decided each rendered element, in
// document order (see build-demo.mjs). The paths render the same elements, so the
// n-th one here is the n-th there, whichever path shows it; its class confirms it.
const NOT_ELEMENTS = new Set(data.notElements);
const isRendered = (el) => el.classList[0]?.startsWith("tei-") && !NOT_ELEMENTS.has(el.classList[0]);
const renderedIn = (doc) => [...(doc.querySelector(".tei-edition")?.querySelectorAll("[class]") ?? [])].filter(isRendered);
function renderedAt(node) {
  for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
    if (el.classList.contains("tei-edition")) return null;
    if (isRendered(el)) return el;
  }
  return null;
}

const records = new Map(); // document → its records, as fetched
const recordsOf = (doc) => {
  if (!records.has(doc)) records.set(doc, fetch(`inspect/${doc}.json`).then((r) => r.json()));
  return records.get(doc);
};

// --- What the check found (check-demo.mjs) -------------------------------------
let verified = null;
fetch("verified.json").then((r) => (r.ok ? r.json() : null)).then((v) => { verified = v; renderCompared(); }).catch(() => {});

// --- The comparison of the renderings ---------------------------------------
const pageKB = (p, page) => Number(page.pageKB) + Number(p.fetchesKB ?? 0);
const scriptKB = (page) => Number(page.jsKB) + page.jsExternal.reduce((sum, e) => sum + Number(e.kb ?? 0), 0);
const cdnNames = (page) => page.jsExternal.map((e) => (e.kb ? `${e.name}, ${e.kb} KB` : e.name)).join(" + ");

/** A size in its cell: the words, and a bar on the one scale of all the table's bars. */
function sizeCell(row, text, value, max) {
  const cell = make(row, "td", text);
  const track = make(cell, "span", undefined, "size-bar");
  make(track, "span").style.width = value ? `max(1px, ${(value / max) * 100}%)` : "0";
}

function renderCompared() {
  const body = byId("compare-rows");
  body.replaceChildren();
  const rendering = data.paths.filter((q) => !q.report);
  const max = Math.max(...rendering.flatMap((p) => (p.pages[state.doc] ? [pageKB(p, p.pages[state.doc]), scriptKB(p.pages[state.doc])] : [0])));
  byId("compare-checked").textContent = verified ? `Compared in ${verified.browser.split("/")[0]} on ${verified.checked}, on all ${verified.examples} examples.` : "";
  for (const p of rendering) {
    const page = p.pages[state.doc];
    const row = make(body, "tr");
    row.dataset.id = p.id;
    const name = make(row, "th");
    const open = make(name, "button", `${p.family} · ${p.label}`);
    open.onclick = () => { state.path = p; byId("compare").close(); render(); };
    make(name, "span", p.plain, "muted small");
    if (page) {
      sizeCell(row, `${page.pageKB} KB${p.fetchesKB ? ` + ${p.fetchesKB} KB stylesheet` : ""}`, pageKB(p, page), max);
      sizeCell(row, `${page.jsKB} KB${page.jsExternal.length ? ` + ${cdnNames(page)} (CDN)` : ""}`, scriptKB(page), max);
    } else {
      make(row, "td", "–");
      make(row, "td", "–");
    }
    make(row, "td", p.needsJs ? "No: empty" : "Yes");
    make(row, "td", p.server ? "Yes" : "No");
    make(row, "td", p.interactive ? "Yes" : "No: notes at the end");
    const differs = verified?.results[p.id] ?? [];
    make(row, "td", verified ? (differs.length ? "Differs" : "✓ Same") : "Not checked").title = differs.join("\n");
  }
  markCompared();
}
const markCompared = () => document.querySelectorAll("#compare-rows tr").forEach((r) => r.classList.toggle("current", r.dataset.id === state.path.id));
byId("compare-open").onclick = () => { renderCompared(); byId("compare").showModal(); };
byId("compare-close").onclick = () => byId("compare").close();

/** Put `name` on the frame's one element that should have it, or on none. */
function mark(frameDoc, name, el) {
  frameDoc.querySelector(`.${name}`)?.classList.remove(name);
  el?.classList.add(name);
}

async function pick(frameDoc, el) {
  const list = await recordsOf(state.doc);
  const index = renderedIn(frameDoc).indexOf(el);
  const record = list[index];
  mark(frameDoc, "demo-picked", el);
  state.picked = record?.cls === el.classList[0] ? index : null;
  show(state.picked === null ? null : record);
  remember();
}

function show(record) {
  const out = byId("inspected");
  out.replaceChildren();
  byId("inspect-hint").hidden = Boolean(record);
  if (!record) {
    byId("inspect-hint").textContent = state.inspecting ? "Click any part of the text." : "See which rule of the ODD produced any part of the text.";
    return;
  }
  make(out, "h4", "In the TEI");
  make(out, "pre", record.tei, "code");
  make(out, "h4", `The ODD's rule for <${record.element}>`);
  const model = make(out, "p");
  make(model, "strong", record.behaviour);
  model.append(record.predicate ? " because " : ", with no condition");
  if (record.predicate) make(model, "code", record.predicate);
  if (record.source) make(out, "pre", record.source, "code");
  make(out, "p", `${record.odd}, line ${record.line}`, "muted small");
  const params = Object.entries(record.params);
  if (params.length) {
    make(out, "h4", "Its params, here");
    const list = make(out, "dl", undefined, "params");
    for (const [name, value] of params) {
      make(list, "dt", name);
      make(list, "dd", value);
    }
  }
  if (record.candidates.length > 1) {
    make(out, "h4", "How it was chosen");
    make(out, "p", "The first model whose condition holds wins.", "muted small");
    const list = make(out, "ol", undefined, "candidates");
    for (const c of record.candidates) {
      const item = make(list, "li", undefined, c.chosen ? "chosen" : "");
      item.append(`${c.behaviour}${c.output ? ` (output ${c.output})` : ""}: `);
      if (c.predicate) make(item, "code", c.predicate);
      else item.append("no condition");
    }
  }
}

function setInspecting(on) {
  state.inspecting = on;
  const button = byId("inspect-toggle");
  button.setAttribute("aria-pressed", String(on));
  button.textContent = on ? "Stop inspecting" : "Inspect the text";
  const frameDoc = byId("page").contentDocument;
  if (frameDoc?.documentElement) {
    frameDoc.documentElement.toggleAttribute("data-demo-inspecting", on);
    if (!on) {
      mark(frameDoc, "demo-picked", null);
      mark(frameDoc, "demo-hover", null);
    }
  }
  if (!on) state.picked = null;
  show(null);
  if (on) restorePicked();
  remember();
}

/** What is picked in the URL, or stays picked from another rendering, in the panel. */
async function restorePicked() {
  if (state.picked === null || state.path.report) return;
  const record = (await recordsOf(state.doc))[state.picked];
  if (record) show(record);
}

/** The views as the page's own CSS reads them: an attribute above the edition, so no script need run in the frame. */
function applyViews(frameDoc) {
  for (const { output } of data.views) {
    if (state.views.has(output)) frameDoc.documentElement.setAttribute(`data-${output}`, "on");
    else frameDoc.documentElement.removeAttribute(`data-${output}`);
  }
}

// A plain file has no page of its own: set it in a column like the edition's.
const PLAIN_FILE = {
  "text/plain": "pre { max-width: 42em; margin: 2em auto; padding: 0 1em; white-space: pre-wrap; font: 16px/1.7 'Palatino Linotype', 'Book Antiqua', Georgia, serif; color: #222; }",
  "application/json": "pre { max-width: 60em; margin: 2em auto; padding: 0 1em; font: 13px/1.5 ui-monospace, 'Cascadia Code', Consolas, monospace; color: #222; }",
};

// While inspecting, a click picks instead of following a note or swapping a reading.
// The listeners belong to this page, so they work in a frame without scripts too.
byId("page").addEventListener("load", async () => {
  const frameDoc = byId("page").contentDocument;
  if (!frameDoc?.head) return;
  if (PLAIN_FILE[frameDoc.contentType]) {
    make(frameDoc.head, "style", PLAIN_FILE[frameDoc.contentType]);
    return;
  }
  applyViews(frameDoc);
  make(frameDoc.head, "style", `
    [data-demo-inspecting] .tei-edition { cursor: crosshair; }
    .demo-hover { outline: 1px dashed #0969da; outline-offset: 1px; }
    .demo-picked { outline: 2px solid #0969da; outline-offset: 1px; background: rgb(9 105 218 / 0.08); }`);
  frameDoc.documentElement.toggleAttribute("data-demo-inspecting", state.inspecting);
  frameDoc.addEventListener("click", (e) => {
    if (!state.inspecting) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = renderedAt(e.target);
    if (el) pick(frameDoc, el);
  }, true);
  frameDoc.addEventListener("mouseover", (e) => mark(frameDoc, "demo-hover", state.inspecting ? renderedAt(e.target) : null));
  frameDoc.addEventListener("mouseleave", () => mark(frameDoc, "demo-hover", null));
  // What is picked stays picked across paths: the same element, in another rendering.
  if (state.picked !== null && !state.path.report) {
    mark(frameDoc, "demo-picked", renderedIn(frameDoc)[state.picked]);
    restorePicked();
  }
});

byId("inspect-toggle").onclick = () => setInspecting(!state.inspecting);

// --- Build the controls from the manifest -----------------------------------
function addTabs(nav, paths, grouped) {
  for (const family of new Set(paths.map((p) => p.family))) {
    const group = make(nav, "div", undefined, "family");
    if (grouped) make(group, "span", family, "family-name");
    for (const p of paths.filter((q) => q.family === family)) {
      const tab = make(group, "button", p.label, "tab");
      tab.dataset.id = p.id;
      tab.title = p.plain;
      tab.style.setProperty("--hue", p.hue);
      tab.onclick = () => { state.path = p; render(); };
    }
  }
}
addTabs(byId("paths"), data.paths.filter((p) => !p.report), true);
addTabs(byId("reports"), data.paths.filter((p) => p.report), false);

// A switch per view, in the panel: the frame shows the edition alone.
for (const view of data.views) {
  const label = make(byId("view-list"), "label");
  const box = make(label, "input");
  box.type = "checkbox";
  box.checked = state.views.has(view.output);
  box.onchange = () => {
    if (box.checked) state.views.add(view.output);
    else state.views.delete(view.output);
    const frameDoc = byId("page").contentDocument;
    if (frameDoc?.documentElement) applyViews(frameDoc);
    remember();
  };
  make(label, "strong", view.label);
  make(label, "span", view.help, "muted small");
}

const doc = byId("doc");
for (const d of data.docs) doc.add(new Option(d.label, d.id));
doc.value = state.doc;
doc.disabled = data.docs.length < 2;
doc.onchange = () => {
  state.doc = doc.value;
  state.picked = null;
  show(null);
  render();
  renderCompared();
};

byId("js-on").checked = state.js;
byId("js-on").onchange = (e) => { state.js = e.target.checked; render(); };

const floorLink = byId("floor-link");
floorLink.textContent = data.floor.label;
floorLink.href = data.floor.url;
byId("floor-size").textContent = `${data.floor.sizeKB} KB`;

show(null);
render();
