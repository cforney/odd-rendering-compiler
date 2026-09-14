// Demo shell: builds the tabs, the side-by-side compare, the JS on/off toggle and
// the artefact panel from the manifest embedded by build-demo.mjs. No framework —
// the page that argues for static-first is itself static-first.

const data = JSON.parse(document.getElementById("demo-data").textContent);
const byId = (id) => document.getElementById(id);
const pathById = (id) => data.paths.find((p) => p.id === id);

// State: the document, which path each pane shows, whether iframes run JS, and compare mode.
const state = { doc: data.docs[0].id, a: data.paths[0].id, b: data.paths[1]?.id || data.paths[0].id, js: true, compare: false };
const pageOf = (id) => pathById(id).pages[state.doc];

// A page runs JS only when "allow-scripts" is in its sandbox; toggling it and
// reassigning src reloads the frame — a genuine progressive-enhancement proof.
function load(pane) {
  const frame = document.querySelector(`iframe[data-pane="${pane}"]`);
  const page = pageOf(state[pane]);
  frame.setAttribute("sandbox", state.js ? "allow-scripts allow-same-origin" : "allow-same-origin");
  frame.src = page ? page.url : "about:blank";
}

// The artefact panel always follows pane A (the primary path).
function showArtefact() {
  const p = pathById(state.a);
  byId("artefact-title").textContent = p.artefact.label;
  byId("artefact-code").textContent = p.artefact.snippet;
  const page = pageOf(state.a);
  const ext = page?.jsExternal.length ? ` + ${page.jsExternal.join(", ")} (CDN)` : "";
  byId("metrics").textContent = page ? `Page ${page.pageKB} KB · client JS ${page.jsKB} KB${ext}` : "No page for this document.";
}

function render() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.id === state.a));
  document.querySelector('.pane-label[data-pane="a"]').textContent = pathById(state.a).label;
  document.querySelector('select.pane-pick[data-pane="b"]').value = state.b;
  document.querySelector('.pane[data-pane="b"]').hidden = !state.compare;
  document.getElementById("stage").classList.toggle("compare", state.compare);
  load("a");
  if (state.compare) load("b");
  showArtefact();
}

// --- Build the controls from the manifest -----------------------------------
const tabs = byId("tabs");
for (const p of data.paths) {
  const tab = document.createElement("button");
  tab.className = "tab"; tab.dataset.id = p.id; tab.textContent = p.label;
  tab.style.setProperty("--hue", p.hue);
  tab.onclick = () => { state.a = p.id; render(); };
  tabs.append(tab);
}

const pickB = document.querySelector('select.pane-pick[data-pane="b"]');
for (const p of data.paths) pickB.add(new Option(p.label, p.id));
pickB.onchange = () => { state.b = pickB.value; render(); };

const doc = byId("doc");
for (const d of data.docs) doc.add(new Option(d.label, d.id));
doc.disabled = data.docs.length < 2;
doc.onchange = () => { state.doc = doc.value; render(); };

byId("js-on").onchange = (e) => { state.js = e.target.checked; render(); };
byId("side-by-side").onchange = (e) => { state.compare = e.target.checked; render(); };
byId("swap").onclick = () => { [state.a, state.b] = [state.b, state.a]; render(); };

const floorLink = byId("floor-link");
floorLink.textContent = data.floor.label; floorLink.href = data.floor.url;
byId("floor-size").textContent = `${data.floor.sizeKB} KB`;
byId("floor-code").textContent = data.floor.snippet;

render();
