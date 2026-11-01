// Source of truth for the comparison demo. Each entry frames one already-rendered
// page in an <iframe>; the shell needs nothing else. Add a path here, rebuild, and
// a new tab appears — the page is never hand-maintained.

// One-line concept shown in the header.
export const concept =
  "ODD → generate → render · one source, many rendering paths, one edition.";

// Rendering paths, in reading order, grouped by family; a report is what else the build writes.
//   family    the implementation the path belongs to; label names the path within it
//   dir       compiler output the page came from (copied to site/<dir>/)
//   file      the rendered page, relative to that output; {doc} is the document
//   artefact  the generated file behind the path, linked from the panel
//   hue       accent of the tab and the info box, one per family (unified green, XSLT blue, CETEIcean pink, build grey)
//   needsJs   the page renders in the browser, so it is empty with JavaScript off
//   plain     what the path is for, in a line anyone can read (the tab's tooltip too)
//   report    not a rendering of the edition: shown apart, and not inspected
//   interactive  readings swap and notes open in place (check-demo.mjs holds it to the pages)
//   server    needs a web server, not only files
//   fetches   what the page downloads besides, weighed in the comparison
//   loadsLater  a script the page loads when it is needed, weighed with its script
export const paths = [
  {
    id: "unified", family: "unified/xast", label: "prebuilt", hue: "#16a34a",
    plain: "A finished page with no JavaScript: the smallest and most robust way to publish.",
    dir: "js", file: "unified/{doc}.html",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    id: "unified-vue", family: "unified/xast", label: "prebuilt + petite-vue", hue: "#16a34a", interactive: true,
    plain: "The same finished page, with a small library that swaps readings and opens notes in place.",
    dir: "js", file: "unified-interactive/{doc}.html",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    id: "islands", family: "unified/xast", label: "prebuilt + islands", hue: "#16a34a", interactive: true,
    loadsLater: "js/unified-islands/facsimile.js",
    plain: "The same finished page, where only the parts a reader can click load any script, and only when needed.",
    dir: "js", file: "unified-islands/{doc}.html",
    artefact: { label: "tei-islands.js", file: "js/unified-islands/tei-islands.js" },
  },
  {
    id: "xslt", family: "XSLT", label: "prebuilt", hue: "#0284c7",
    plain: "A finished page with no JavaScript, built by a stylesheet generated from the ODD rather than by Node.",
    dir: "xslt", file: "xslt/{doc}.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "xslt-js", family: "XSLT", label: "prebuilt + small script", hue: "#0284c7", interactive: true,
    plain: "The same finished page, with a few lines of plain JavaScript for readings and notes.",
    dir: "xslt", file: "xslt-interactive/{doc}.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "saxonjs", family: "XSLT", label: "in the browser (SaxonJS)", hue: "#0284c7", needsJs: true, interactive: true, server: true,
    fetches: "xslt/edition-saxonjs.sef.json",
    plain: "No build for the page: the reader's browser transforms the TEI, at the cost of a large script.",
    dir: "xslt", file: "saxonjs/{doc}.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "ceteicean", family: "CETEIcean", label: "in the browser", hue: "#db2777", needsJs: true, interactive: true,
    plain: "No build for the page: the reader's browser turns the TEI into custom elements as it loads.",
    dir: "js", file: "ceteicean/{doc}.html",
    artefact: { label: "tei-ceteicean-behaviours.js", file: "js/ceteicean/tei-ceteicean-behaviours.js" },
  },
  {
    id: "findings", family: "Build", label: "findings", hue: "#6b7280", report: true,
    plain: "What the ODD does not foresee in this document's encoding, and what it could not compile.",
    dir: "js", file: "findings/{doc}.html",
    artefact: { label: "findings.json", file: "js/findings/findings.json" },
  },
  {
    id: "plain", family: "Build", label: "plain text", hue: "#6b7280", report: true,
    plain: "The ODD's plain output: the text the search index reads, beside its Pagefind records.",
    dir: "js", file: "plain/{doc}.txt",
    artefact: { label: "the plain text (Pagefind records)", file: "js/plain/records.json" },
  },
  {
    // One index for the whole corpus; its results open in the prebuilt rendering.
    id: "search", family: "Build", label: "search", hue: "#6b7280", report: true, needsJs: true,
    plain: "The plain text as a Pagefind index, in the browser: type a word as we spell it today, and it finds the old spelling.",
    dir: "js", file: "search/search.html",
    artefact: { label: "records.json (Pagefind)", file: "js/plain/records.json" },
  },
  {
    id: "json", family: "Build", label: "records", hue: "#6b7280", report: true,
    plain: "The ODD's decisions as data: every element, naming the model chosen for it.",
    dir: "js", file: "json/{doc}.json",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    // One report for the whole corpus, so every document shows the same page.
    id: "coverage", family: "Build", label: "coverage", hue: "#6b7280", report: true,
    plain: "The ODD read back against all the examples: what it says that never runs, and what they hold that it never handles.",
    dir: "js", file: "coverage/index.html",
    artefact: { label: "coverage.json", file: "js/coverage/coverage.json" },
  },
];

// The shared visual floor every path renders against — shown beside each tab.
export const floor = { label: "edition.css", file: "js/edition.css" };

// The views of the ODD, in words: what its output names leave unsaid.
export const views = {
  normalized: { label: "Normalized text", help: "The corrected readings, with the printed lines run together." },
  entities: { label: "Names", help: "Marks people, places, works and other named things in colour." },
};

// What the inspector explains the examples by.
export const inspected = { odd: "examples/tei_simler.odd", handlers: "compiler-js/output/tei-handlers.mjs", tei: "examples/{doc}.xml" };

// Documents on offer: the examples, each rendered by every path (id = file name).
export const docs = [
  { id: "simler-psalmen", label: "Psalms I–V (C 1663, pp. 4–5)" },
  { id: "simler-buchstabwechsel", label: "Buchstabwächsel: two columns, acrostics" },
  { id: "simler-hausswesen", label: "Chriſtenliches Haußweſen: Bible notes" },
  { id: "simler-regenten-kleinodt", label: "Regenten Kleinodt: marginalia" },
];
