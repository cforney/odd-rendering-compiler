// Source of truth for the comparison demo. Each entry frames one already-rendered
// page in an <iframe>; the shell needs nothing else. Add a path here, rebuild, and
// a new tab appears — the page is never hand-maintained.

// One-line concept shown in the header.
export const concept =
  "ODD → generate → render · one source, many rendering paths, one edition.";

// The renderings, one per builder and interaction, in reading order; a report is what else the build writes.
//   builder      who builds the page: a tab. interaction names how it is enhanced: the control beside it
//   about        what the builder is, in a line, for the comparison
//   dir          compiler output the page came from (copied to site/<dir>/)
//   file         the rendered page, relative to that output; {doc} is the document
//   artefact     the generated file behind the path, linked from the panel
//   hue          accent of the tab and the info box, one per builder's family (unified green, XSLT blue, CETEIcean pink, build grey)
//   needsJs      the page renders in the browser, so it is empty with JavaScript off
//   plain        what the path is for, in a line anyone can read
//   report       not a rendering of the edition: shown apart, and not inspected; label names its tab
//   interactive  readings swap, notes and page images open in place (check-demo.mjs holds it to the pages)
//   server       needs a web server, not only files
//   fetches      what the page downloads besides its linked stylesheets, weighed in the comparison
//   loadsLater   scripts the page loads when they are needed, weighed with its script
const HANDLERS = { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" };
const XSL = { label: "edition.xsl", file: "xslt/edition.xsl" };
const UNIFIED = { builder: "unified/xast", about: "Finished pages, built by Node.", hue: "#16a34a", dir: "js" };
const XSLT = { builder: "XSLT", about: "Finished pages, built by a stylesheet generated from the ODD.", hue: "#0284c7", dir: "xslt" };

export const paths = [
  {
    ...UNIFIED, id: "unified", interaction: "none",
    plain: "A finished page with no JavaScript: the smallest and most robust way to publish.",
    file: "unified/{doc}.html", artefact: HANDLERS,
  },
  {
    ...UNIFIED, id: "unified-script", interaction: "small script", interactive: true,
    plain: "The same finished page, with a small script for readings, notes and page images. The default: nothing to install or load.",
    file: "unified-script/{doc}.html", artefact: HANDLERS,
  },
  {
    ...UNIFIED, id: "unified-islands", interaction: "islands", interactive: true,
    loadsLater: ["js/unified-islands/readings.js", "js/unified-islands/facsimile.js"],
    plain: "The same finished page, where each kind of part a reader can click loads its script when the first comes into view. For pages with several kinds of component, or costly ones.",
    file: "unified-islands/{doc}.html", artefact: { label: "tei-islands.js", file: "js/unified-islands/tei-islands.js" },
  },
  {
    ...UNIFIED, id: "unified-petite-vue", interaction: "petite-vue (example)", interactive: true,
    plain: "An example of using a framework: the same finished page, with directives written at build time and petite-vue from a CDN. The small script does the same with no dependency.",
    file: "unified-petite-vue/{doc}.html", artefact: HANDLERS,
  },
  {
    ...XSLT, id: "xslt", interaction: "none",
    plain: "A finished page with no JavaScript, built by a stylesheet generated from the ODD rather than by Node.",
    file: "xslt/{doc}.html", artefact: XSL,
  },
  {
    ...XSLT, id: "xslt-script", interaction: "small script", interactive: true,
    plain: "The same finished page, with the same small script as the unified path.",
    file: "xslt-script/{doc}.html", artefact: XSL,
  },
  {
    ...XSLT, id: "xslt-islands", interaction: "islands", interactive: true,
    loadsLater: ["xslt/xslt-islands/readings.js", "xslt/xslt-islands/facsimile.js"],
    plain: "The same finished page, with the same islands as the unified path.",
    file: "xslt-islands/{doc}.html", artefact: { label: "tei-islands.js", file: "xslt/xslt-islands/tei-islands.js" },
  },
  {
    ...XSLT, id: "saxonjs", builder: "SaxonJS", about: "That stylesheet, run in the reader's browser.", interaction: "its own (IXSL)", needsJs: true, interactive: true, server: true,
    fetches: "xslt/edition-saxonjs.sef.json",
    plain: "No build for the page: the reader's browser transforms the TEI, at the cost of a large script.",
    file: "saxonjs/{doc}.html", artefact: XSL,
  },
  {
    id: "ceteicean", builder: "CETEIcean", about: "Custom elements, made in the reader's browser.", interaction: "small script", hue: "#db2777", needsJs: true, interactive: true,
    plain: "No build for the page: the reader's browser turns the TEI into custom elements as it loads.",
    dir: "js", file: "ceteicean/{doc}.html",
    artefact: { label: "tei-ceteicean-behaviours.js", file: "js/ceteicean/tei-ceteicean-behaviours.js" },
  },
  {
    id: "findings", label: "findings", hue: "#6b7280", report: true,
    plain: "What the ODD does not foresee in this document's encoding, and what it could not compile.",
    dir: "js", file: "findings/{doc}.html",
    artefact: { label: "findings.json", file: "js/findings/findings.json" },
  },
  {
    id: "plain", label: "plain text", hue: "#6b7280", report: true,
    plain: "The ODD's plain output: the text the search index reads, beside its Pagefind records.",
    dir: "js", file: "plain/{doc}.txt",
    artefact: { label: "the plain text (Pagefind records)", file: "js/plain/records.json" },
  },
  {
    // One index for the whole corpus; its results open in the prebuilt rendering.
    id: "search", label: "search", hue: "#6b7280", report: true, needsJs: true,
    plain: "The plain text as a Pagefind index, in the browser: type a word as we spell it today, and it finds the old spelling.",
    dir: "js", file: "search/search.html",
    artefact: { label: "records.json (Pagefind)", file: "js/plain/records.json" },
  },
  {
    id: "json", label: "records", hue: "#6b7280", report: true,
    plain: "The ODD's decisions as data: every element, naming the model chosen for it.",
    dir: "js", file: "json/{doc}.json",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    // One report for the whole corpus, so every document shows the same page.
    id: "coverage", label: "coverage", hue: "#6b7280", report: true,
    plain: "The ODD read back against all the examples: what it says that never runs, and what they hold that it never handles.",
    dir: "js", file: "coverage/index.html",
    artefact: { label: "coverage.json", file: "js/coverage/coverage.json" },
  },
];

// The shared visual floor every path renders against — shown beside each tab.
export const floor = { label: "edition.css", file: "js/edition.css" };

// What the inspector explains the examples by.
export const inspected = { odd: "examples/tei_simler.odd", handlers: "compiler-js/output/tei-handlers.mjs", tei: "examples/{doc}.xml" };

// Documents on offer: the examples, each rendered by every path (id = file name).
export const docs = [
  { id: "simler-psalmen", label: "Psalms I–XXI (C 1663, pp. 4–7)" },
  { id: "simler-buchstabwechsel", label: "Buchstabwächsel: two columns, acrostics" },
  { id: "simler-todtenklang", label: "Trauriger Todtenklang: commentary, register" },
  { id: "simler-regenten-kleinodt", label: "Regenten Kleinodt: marginalia" },
];
