// Source of truth for the comparison demo. Each entry frames one already-rendered
// page in an <iframe>; the shell needs nothing else. Add a path here, rebuild, and
// a new tab appears — the page is never hand-maintained.

// One-line concept shown in the header.
export const concept =
  "ODD → generate → render · one source, many rendering paths, one edition.";

// Rendering paths, in reading order.
//   dir       compiler output the page came from (copied to site/<dir>/)
//   file      the rendered page, relative to that output
//   artefact  the generated file behind the path (its snippet + a full-file link)
//   hue       tab accent, grouped by family (unified green, XSLT blue, CETEI pink)
export const paths = [
  {
    id: "unified", label: "unified (static)", hue: "#16a34a",
    dir: "js", file: "rendered-unified.html",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    id: "unified-vue", label: "unified + petite-vue", hue: "#16a34a",
    dir: "js", file: "rendered-unified-interactive.html",
    artefact: { label: "tei-handlers.mjs", file: "js/tei-handlers.mjs" },
  },
  {
    id: "islands", label: "islands (Web Components)", hue: "#059669",
    dir: "js", file: "rendered-unified-islands.html",
    artefact: { label: "tei-islands.js", file: "js/tei-islands.js" },
  },
  {
    id: "xslt", label: "XSLT (static)", hue: "#0284c7",
    dir: "xslt", file: "rendered-xslt.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "xslt-js", label: "XSLT + JS", hue: "#0284c7",
    dir: "xslt", file: "rendered-xslt-interactive.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "saxonjs", label: "XSLT in-browser (SaxonJS)", hue: "#0284c7",
    dir: "xslt", file: "rendered-saxonjs.html",
    artefact: { label: "edition.xsl", file: "xslt/edition.xsl" },
  },
  {
    id: "ceteicean", label: "CETEIcean", hue: "#db2777",
    dir: "js", file: "rendered-ceteicean.html",
    artefact: { label: "tei-ceteicean-behaviours.js", file: "js/tei-ceteicean-behaviours.js" },
  },
];

// The shared visual floor every path renders against — shown beside each tab.
export const floor = { label: "edition.css", file: "js/edition.css" };

// Documents on offer (one for now; per-document outputs would extend this).
export const docs = [{ id: "simler", label: "Simler poem" }];
