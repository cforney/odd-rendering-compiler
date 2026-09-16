// Source of truth for the comparison demo. Each entry frames one already-rendered
// page in an <iframe>; the shell needs nothing else. Add a path here, rebuild, and
// a new tab appears — the page is never hand-maintained.

// One-line concept shown in the header.
export const concept =
  "ODD → generate → render · one source, many rendering paths, one edition.";

// Rendering paths, in reading order, grouped by family.
//   family    the implementation the path belongs to; label names the path within it
//   dir       compiler output the page came from (copied to site/<dir>/)
//   file      the rendered page, relative to that output; {doc} is the document
//   artefact  the generated file behind the path (its snippet + a full-file link)
//   hue       tab accent, one per family (unified green, XSLT blue, CETEIcean pink, build grey)
export const paths = [
  {
    id: "unified", family: "unified/xast", label: "static", hue: "#16a34a",
    dir: "js", file: "unified/{doc}.html",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    id: "unified-vue", family: "unified/xast", label: "+ petite-vue", hue: "#16a34a",
    dir: "js", file: "unified-interactive/{doc}.html",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    id: "islands", family: "unified/xast", label: "islands", hue: "#16a34a",
    dir: "js", file: "unified-islands/{doc}.html",
    artefact: { label: "tei-islands.js", file: "js/unified-islands/tei-islands.js" },
  },
  {
    id: "xslt", family: "XSLT", label: "static", hue: "#0284c7",
    dir: "xslt", file: "xslt/{doc}.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "xslt-js", family: "XSLT", label: "+ JS", hue: "#0284c7",
    dir: "xslt", file: "xslt-interactive/{doc}.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "saxonjs", family: "XSLT", label: "SaxonJS, in the browser", hue: "#0284c7",
    dir: "xslt", file: "saxonjs/{doc}.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "ceteicean", family: "CETEIcean", label: "in the browser", hue: "#db2777",
    dir: "js", file: "ceteicean/{doc}.html",
    artefact: { label: "tei-ceteicean-behaviours.js", file: "js/ceteicean/tei-ceteicean-behaviours.js" },
  },
  {
    id: "findings", family: "Build", label: "findings", hue: "#6b7280",
    dir: "js", file: "findings/{doc}.html",
    artefact: { label: "findings.json", file: "js/findings/findings.json" },
  },
  {
    id: "plain", family: "Build", label: "plain text", hue: "#6b7280",
    dir: "js", file: "plain/{doc}.txt",
    artefact: { label: "records.json (Pagefind)", file: "js/plain/records.json" },
  },
  {
    id: "json", family: "Build", label: "records", hue: "#6b7280",
    dir: "js", file: "json/{doc}.json",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
];

// The shared visual floor every path renders against — shown beside each tab.
export const floor = { label: "edition.css", file: "js/edition.css" };

// Documents on offer: the examples, each rendered by every path (id = file name).
export const docs = [
  { id: "simler-psalmen", label: "Psalms I–V (C 1663, pp. 4–5)" },
  { id: "simler-buchstabwechsel", label: "Buchstabwächsel: two columns, acrostics" },
  { id: "simler-hausswesen", label: "Chriſtenliches Haußweſen: Bible notes" },
  { id: "simler-regenten-kleinodt", label: "Regenten Kleinodt: marginalia" },
];
