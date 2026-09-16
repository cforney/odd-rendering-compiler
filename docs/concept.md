# How it works

The pipeline is **define → generate → render**.

1. **Define.** A TEI ODD already declares, in its Processing Model, how each
   element should be presented: `<model behaviour="…">`, `<outputRendition>`, a
   `@predicate`, `<param>`s, and source `<rendition>`s in `<tagsDecl>`. That
   declaration is the single source of truth.
2. **Generate.** A build tool reads the ODD and writes rendering *artefacts* — a
   CSS stylesheet, an XSLT stylesheet, unified/xast handlers, or CETEIcean
   behaviours. This is a build step.
3. **Render.** The artefacts turn a TEI document into static HTML.

## Two implementations

The chain is built twice, in JavaScript (`compiler-js/`) and in XSLT
(`compiler-xslt/`), to show the *generate* step is not tied to one language. Both
read the ODD into the same model, the JavaScript in `odd-parser.mjs` and the XSLT
in `generate/odd-model.xsl`. The unified handlers and the stylesheets of both XSLT
generators produce an equivalent static body: identical up to attribute order
and whitespace. `npm test` checks this on the examples and on the conformance
fixtures (`compiler-js/test/fixtures/`).

## The pieces

- **Model selection.** An element takes the first of its models, in document
  order, whose predicate holds. Model groups are flattened; a model takes
  `@output` and `@useSourceRendition` from its group or sequence. A model with
  `@output` belongs to that output and takes precedence there. Models of another
  output are skipped. The renderers render the `web` output unless told
  otherwise.
- **Outputs and views.** `page` holds what the page shows around the text (its
  title, the IIIF manifest, the page images), `plain` the search text. Every
  other output is a view laid over the `web` page, with a switch for each. See
  [behaviour-table.md](behaviour-table.md).
- **Generated code, shared behaviours.** The generated artefact holds what is
  particular to the ODD: for each element its models, predicates and params.
  The behaviours are a runtime shared by every ODD, as in TEI Publisher's
  generated code:
  - `runtime/pm-runtime.mjs` + `xpath.mjs` beside `tei-handlers.mjs`;
  - `runtime/pm.xsl` copied into `edition.xsl`;
  - `runtime/ceteicean.js` in the CETEIcean behaviours, with `pm-runtime.mjs`
    and `xpath.mjs` inlined, so the browser chooses models as the unified
    handlers do.
- **Behaviour table.** Each behaviour's HTML element and flow come from one shared
  file. See [behaviour-table.md](behaviour-table.md).
- **Predicates and params** are XPath: evaluated natively in XSLT, and by a
  shared XPath subset in the unified handlers and the CETEIcean tier. See
  [predicate-grammar.md](predicate-grammar.md).
- **Flow.** Whether an element renders as a block or inline follows from the
  model it takes where it stands. It decides where TEI indentation is dropped and
  where a line break is already implied, so a `break` there renders nothing.
- **Source appearance.** A source element's own `@rendition` pointers become
  `r-<id>` classes where its model sets `@useSourceRendition`, styled by CSS
  compiled from `<tagsDecl>`. So how a passage looked in the source survives.
- **One look.** Every renderer stamps the same classes (`tei-<ident>`, the model's
  classes, `r-<id>`) and shares one `edition.css`, so the unified, XSLT, SaxonJS
  and CETEIcean outputs look the same. Only the render-info banner differs.

## Compiled or interpreted

"Static" depends on *when* the Processing Model is resolved, not on *how*. The
two are independent:

| | **compiled** (artefacts generated from the ODD) | **interpreted** (the ODD read on every run) |
|---|---|---|
| **request time (server)** | TEI Publisher: the ODD compiled into XQuery, which eXist-db runs | — |
| **build time (static)** | this repository: XSLT, unified handlers, CETEIcean behaviours, CSS | Simler Digital's own build (`simler_data/preview`) |
| **in the browser** | this repository, via SaxonJS or CETEIcean | possible, by bundling an interpreter |

The two meet in the middle. This compiler generates the ODD's models as a table
over a shared runtime, which chooses the model as it renders; the Simler build
compiles its XPath and CSS once and interprets only the choice of model. Only
generated artefacts reach another toolchain, the browser or the CSS floor, and
that is where compiling pays off.

## Output tiers

The same ODD feeds three levels, each building on the last:

1. **CSS floor.** `edition.css` over the semantic HTML, with no JavaScript. The
   view switches are checkboxes, and CSS lays a view over the page while its
   box is checked.
2. **Static HTML.** Pages rendered at build time (unified/xast or XSLT), with
   notes and apparatus baked in; readable with JavaScript off.
3. **Interactive.** The static page, progressively enhanced. A note marker opens
   its note as a tooltip, by one script on every interactive page
   (`runtime/notes.js`, styled by `runtime/ui.css` in `edition.css`).
   Apparatus readings toggle by petite-vue or islands in the JS path, a few lines
   of vanilla JS in the XSLT path, and IXSL in SaxonJS.

The CETEIcean tier renders in the browser instead: the same body, and the same
tooltips.

Beside the pages, the same build reports what the ODD does not foresee in the
encoding (`compiler-js/findings.mjs`), writes the `plain` output as text and as
Pagefind records for a search index (`compiler-js/render-plain.mjs`), and writes
the decisions themselves as data — every element naming the model that won
(`compiler-js/render-json.mjs`), the injection point for other toolchains. Read
those records back against the ODD and they answer the ODD author's two
questions — what did I write that never runs, and what is in my documents that I
never handled (`compiler-js/coverage.mjs`).
