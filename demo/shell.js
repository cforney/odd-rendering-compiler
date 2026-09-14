// Demo shell: builds the path tabs, the document picker, the JS on/off toggle and
// the side panel from the manifest embedded by build-demo.mjs. No framework — the
// page that argues for static-first is itself static-first.

const data = JSON.parse(document.getElementById("demo-data").textContent);
const byId = (id) => document.getElementById(id);

// State: the document, the rendering path, and whether the page may run JavaScript.
const state = { doc: data.docs[0].id, path: data.paths[0], js: true };

function render() {
  const page = state.path.pages[state.doc];
  // A page runs JS only when "allow-scripts" is in its sandbox; toggling it and
  // reassigning src reloads the frame — a genuine progressive-enhancement proof.
  const frame = byId("page");
  frame.setAttribute("sandbox", state.js ? "allow-scripts allow-same-origin" : "allow-same-origin");
  frame.src = page ? page.url : "about:blank";

  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.id === state.path.id));
  byId("path-label").textContent = `${state.path.family} · ${state.path.label}`;
  const ext = page?.jsExternal.length ? ` + ${page.jsExternal.join(", ")} (CDN)` : "";
  byId("metrics").textContent = page ? `Page ${page.pageKB} KB · client JS ${page.jsKB} KB${ext}` : "No page for this document.";
  const link = byId("artefact-link");
  link.textContent = state.path.artefact.label;
  link.href = state.path.artefact.url;
  byId("artefact-code").textContent = state.path.artefact.snippet;
}

// --- Build the controls from the manifest -----------------------------------
const nav = byId("paths");
for (const family of new Set(data.paths.map((p) => p.family))) {
  const group = nav.appendChild(document.createElement("div"));
  group.className = "family";
  const name = group.appendChild(document.createElement("span"));
  name.className = "family-name";
  name.textContent = family;
  for (const p of data.paths.filter((q) => q.family === family)) {
    const tab = group.appendChild(document.createElement("button"));
    tab.className = "tab";
    tab.dataset.id = p.id;
    tab.textContent = p.label;
    tab.style.setProperty("--hue", p.hue);
    tab.onclick = () => { state.path = p; render(); };
  }
}

const doc = byId("doc");
for (const d of data.docs) doc.add(new Option(d.label, d.id));
doc.disabled = data.docs.length < 2;
doc.onchange = () => { state.doc = doc.value; render(); };

byId("js-on").onchange = (e) => { state.js = e.target.checked; render(); };

const floorLink = byId("floor-link");
floorLink.textContent = data.floor.label;
floorLink.href = data.floor.url;
byId("floor-size").textContent = `${data.floor.sizeKB} KB`;
byId("floor-code").textContent = data.floor.snippet;

render();
