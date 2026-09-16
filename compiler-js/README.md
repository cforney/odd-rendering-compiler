# ODD Rendering Compiler — JavaScript implementation

Build-time pipelines that compile a TEI ODD Processing Model (PM) into rendering
artefacts for static scholarly editions — CSS, an XSLT stylesheet, unified/xast
handlers, and CETEIcean behaviours — with the renderers that turn TEI into HTML.

## Generators (ODD → artefacts)

| Module | Output | PM coverage |
|--------|--------|-------------|
| `odd-to-css.mjs` | `edition.css`: the design tokens (`--tokens`), the `<tagsDecl>` renditions, each model's `<outputRendition>` and the rules that lay the views over the page | all |
| `odd-to-unified.mjs` | `tei-handlers.mjs` (ESM), with `../runtime/pm-runtime.mjs` and `xpath.mjs` | all; XPath in a subset, outside it degraded |
| `odd-to-xslt.mjs` | `edition.xsl` (XSLT 3.0) | all; any XPath |
| `odd-to-ceteicean.mjs` | CETEIcean behaviours + a page per source, rendering in the browser | all, as unified |

The ODD's CSS may read design tokens, custom properties such as `--c-muted`.
`odd-to-css.mjs` puts the tokens file given with `--tokens` first in
`edition.css`, and reports any custom property that neither the tokens, the ODD's
CSS nor a `--…` param defines.

## Renderers (artefacts + TEI → HTML)

| Script | Source artefact | Output (`npm run …`) |
|--------|----------------|--------|
| `render-unified.mjs` | `tei-handlers.mjs` | `unified/` |
| `render-unified-interactive.mjs` | `tei-handlers.mjs` + petite-vue | `unified-interactive/` |
| `render-unified-islands.mjs` | `tei-handlers.mjs` + `islands-runtime.js` | `unified-islands/` |
| `render-xslt.mjs` | `edition.xsl`, run by SaxonJS (`xslt3`) | `xslt/` |
| `render-plain.mjs` | `tei-handlers.mjs`, output `plain` | `plain/`: `<basename>.txt` and `records.json`, Pagefind custom records (`render:plain`) |
| `render-json.mjs` | the ODD itself | `json/`: `<basename>.json`, the ODD's decisions as records (`render:json`) |
| `findings.mjs` | the ODD itself | `findings/`: a page per source and `findings.json` (`findings`) |
| `coverage.mjs` | the ODD + the JSON records | `coverage/`: `coverage.json` and a page (`coverage`) |

CETEIcean generate + render happen in one step (`odd-to-ceteicean.mjs`, into
`ceteicean/`). `render-unified.mjs` and `render-xslt.mjs` take `--output <name>`,
the PM output to render (default `web`). The `web` page has the ODD's views laid
over it, each with a switch, and the index shows each page's title, page images
and IIIF manifest as the ODD's model for output `page` gives them (see
[`../docs/behaviour-table.md`](../docs/behaviour-table.md)).

**JSON records.** `render-json.mjs` writes what the Processing Model decided, as
data: a tree in which every element names the model that won — `{ element,
model, behaviour, classes, params, children }`, a child a record or the text as
it renders — and a side table giving each of those models its predicate, its
`<desc>` and the ODD it was written in. An element the ODD has no model for
keeps its record, with `model: null`; what a model omits has no children. It is
the injection point for other toolchains, which read the ODD's decisions without
re-implementing them.

**Findings.** `findings.mjs` reports, and prints in the build log, what the ODD
does not foresee: in each source's text, attribute values outside the ODD's
value lists, renditions it does not declare, elements without a model, note
ranges without their start and anchors no range starts at, and page images
without a IIIF manifest; in the ODD, custom properties defined nowhere (with
`--tokens`, as `odd-to-css.mjs` reports them) and the XPath the handlers cannot
evaluate.

**Coverage.** `coverage.mjs` rolls the records up over the corpus and reads them
back against the ODD, which answers the two questions an ODD author has. *What
did I write that never runs?* — models no document made fire, models that can
never fire because an earlier model of the same output has no predicate, and
elements the ODD has models for that no record names. *What is in my documents
that I never handled?* — elements with no model at all, and the silent case:
elements whose spec has models of which none applied, which render nothing and
warn about nothing. Models a chained ODD wrote are reported apart, and unhandled
elements below an `alternate` are not reported, where leaving a reading
unrendered is a decision. Coverage is per output, and a sequence counts as the
one model the records name.

**Unrunnable XPath degrades.** A predicate or param outside the XPath subset is
not a build error: it compiles to what a failing evaluation returns — `false()`
for a predicate, nothing for a param — and lands in `odd-unsupported.json`
beside the generated artefacts, with its element, model, ODD and line. Someone
else's ODD therefore runs here, with a report of what was dropped. `--strict`
fails the build instead, and every script that compiles *our* ODDs passes it.
See [`../docs/predicate-grammar.md`](../docs/predicate-grammar.md).

> **Islands.** `render-unified-islands.mjs` ships the *same* static body, but wraps
> each interactive region in a `<tei-island>` custom element that one tiny generic
> runtime (`islands-runtime.js`) hydrates on demand (`on="load|idle|visible|
> media()"`, mirroring Astro's `client:*`). It is the framework-agnostic
> generalisation of the petite-vue and vanilla-JS tiers — only the enhancement
> differs, and the page still reads with no JavaScript.

> **SaxonJS.** The *client-side* SaxonJS + IXSL demo lives in
> [`../compiler-xslt/`](../compiler-xslt/).

Every renderer accepts **one file or a whole corpus**: `--tei` may be a single
file, a directory, a `* ? **` glob (quote it), a comma-separated list, or a
repeated flag. Each source gives `<basename>.html`; several also a linking
`index.html`. The npm scripts render every example, `../examples/simler-*.xml`.

## Quick start

```bash
npm install
npm run demo               # the Simler examples → static + interactive pages
npm test                   # smoke tests, conformance fixtures, byte-identity gate
npm run build:all          # all four generators from the Simler ODD
npm run render:all         # every renderer on every example, the plain text and the records
npm run findings           # what the Simler ODD does not foresee in the examples
npm run render:json && npm run coverage   # the decisions as data, read back against the corpus
npm run build:extension && npm run render:extension   # the nested page-break extension
npm run sync:odd -- <commit>   # vendor the Simler ODD and tokens at a commit
```

Individual generators (`build`, `build:xslt`, `build:unified`, `build:ceteicean`)
read `../examples/tei_simler.odd`, and `build` adds its tokens,
`../examples/simler-tokens.css`. Individual renderers (`render:unified`,
`render:interactive`, `render:islands`, `render:xslt`, `render:ceteicean`,
`render:plain`, `render:json`) render every example.

**Reproducible output.** Each generator writes a timestamp into its header by
default. Pass `--no-timestamp` to omit it, or set `SOURCE_DATE_EPOCH` (Unix
seconds) to pin it.

**Tests.** `npm test` runs the smoke tests, the conformance fixtures in
`test/fixtures/` and the byte-identity gate. With Saxon HE 12 at `$SAXON_HOME`
the fixtures also go through the stylesheets of both XSLT generators.
Otherwise those tests are skipped, and so is the gate for an example whose renders
are not on disk.

## Layout

```
compiler-js/
├── odd-parser.mjs        # reads the ODD into models and CSS rules; parses TEI
├── cli.mjs               # CLI, file output, escaping, the hast serialiser, multi-file input
├── odd-to-css.mjs        # edition.css
├── odd-to-unified.mjs    # tei-handlers.mjs
├── odd-to-xslt.mjs       # edition.xsl, with ../runtime/pm.xsl copied in
├── odd-to-ceteicean.mjs  # CETEIcean behaviours: ../runtime/ceteicean.js over pm-runtime.mjs, xpath.mjs
├── render-*.mjs          # the renderers, the plain text (render-plain.mjs) and the records (render-json.mjs)
├── unsupported.mjs       # the XPath check: degrade outside the subset, or --strict
├── findings.mjs          # build-time findings
├── coverage.mjs          # the records read back against the ODD
├── islands-runtime.js    # generic <tei-island> hydration runtime
├── byte-identity.mjs     # the equivalence check between renders
├── test/                 # smoke tests, fixtures, gate (`npm test`)
└── output/               # generated artefacts (gitignored)
```

Inputs are in [`../examples/`](../examples/).

## Architecture

**Reading the ODD.** `readOdd(path)` in `odd-parser.mjs` returns, for each
`elementSpec`, its models in document order, the CSS of their
`<outputRendition>`s and the values of its value lists, and the views: the
outputs laid over the page. Each model carries the id the JSON records name it
by, `<ident>-<n>`, and where it was written. The XSLT generators read the ODD the same way
(`../compiler-xslt/generate/odd-model.xsl`). `pageOf(specs, tree)` gives what
the ODD's model for output `page` says of one source.

- **Model groups** are flattened; a model takes `@output` and
  `@useSourceRendition` from its group or sequence.
- **Classes:** a styled model gets its `@cssClass`, or `<ident>-<n>`.
- **Behaviours:** each gets its HTML element and flow from the shared
  [`../behaviour-map.json`](../behaviour-map.json). See
  [`../docs/behaviour-table.md`](../docs/behaviour-table.md).
- **`<specGrpRef>`** is resolved within one document (the TEI's `tei_simplePrint`
  is composed from seven references). This is not full `odd2odd` flattening.
- **ODD chaining:** a `<schemaSpec source="…">` naming another ODD reads it as the
  base. This ODD's specs with models replace the base spec's models,
  `mode="delete"` removes a spec, and a new ident is added.

**Generated code, shared behaviours.** `tei-handlers.mjs` is the ODD's models as
a table, with predicates and params as XPath. `../runtime/pm-runtime.mjs`
renders by it:

- **Models:** each element takes the first model of the output being rendered
  whose predicate holds, else the first such model without `@output`.
- **Views:** on the `web` page, each view's model marks the element: an omit,
  its classes, or which reading of an alternate it reads; a checkbox per view
  heads the edition, and `edition.css` does the rest.
- **Params:** they are XPath; `data-…` and `--…` params become attributes and CSS
  custom properties.
- **Flow:** block or inline decides where TEI indentation is dropped and where a
  line break is already implied.
- **Joined line ends:** at an `lb break="no"` the encoded hyphen and the spaces
  around the break are dropped from the text, so the `lb`'s model sets the one
  hyphen the print shows.
- **Notes** are numbered in document order and collected by place. On the
  interactive pages a marker opens its note as a tooltip, by
  `../runtime/notes.js` (styled by `../runtime/ui.css`, which the CSS
  generators append to `edition.css`).

The generated stylesheet does the same with `../runtime/pm.xsl`, so the unified
and XSLT renders have an equivalent body. A CETEIcean page chooses models by the
same runtime in the browser, and `../runtime/ceteicean.js` reshapes CETEIcean's
custom elements into the same HTML. See
[`../docs/concept.md`](../docs/concept.md).

**The nested model (Boot 2024).** A `<model>` that holds a `<modelSequence>` is
not TEI. The compilers render it, a `link` part wrapping the others, for the
extension example in [`../examples/extensions/nested-pb/`](../examples/extensions/nested-pb/).

## Dependencies

[`@rgrove/parse-xml`](https://github.com/rgrove/parse-xml) — the only dependency, and the parser unified's
[`xast-util-from-xml`](https://github.com/syntax-tree/xast-util-from-xml) is built on, so build-time and rendering trees share one engine.
`render-xslt.mjs` fetches SaxonJS (`xslt3`) with `npx` when it is not installed.

## Example sources & credits

Documented in [`../examples/README.md`](../examples/README.md) — Simler Digital and
the TEI Consortium.
