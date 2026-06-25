# ODD Rendering Compiler — JavaScript implementation

Build-time pipelines that compile a TEI ODD Processing Model (PM) into rendering
artefacts for static scholarly editions — CSS, XSLT, unified/xast handlers, and
CETEIcean behaviours — plus a shared ODD parser and support for Boot's (2024)
nested-model extension. (The XSLT implementation of the same chain is in
[`../compiler-xslt`](../compiler-xslt).)

## Generators (ODD → artefacts)

| Module | Output | PM coverage |
|--------|--------|-------------|
| `odd-to-css.mjs` | CSS (the visual floor) | ~85% (visual) |
| `odd-to-xslt.mjs` | XSLT 1.0 stylesheet | 100% |
| `odd-to-unified.mjs` | unified/xast handler module (ESM) | 100% |
| `odd-to-ceteicean.mjs` | CETEIcean behaviours + rendered HTML | 100% |

Other targets explored earlier — a Web Components generator, an encoding-guide
generator, a JSON interchange mapping, and an ODD diff — are kept out of this
repository to keep the compiler focused on the core pattern.

## Renderers (artefacts + TEI → HTML)

| Script | Source artefact | Output |
|--------|----------------|--------|
| `render-xslt.mjs` | `edition.xsl` | `rendered-xslt.html` |
| `render-unified.mjs` | `tei-handlers.mjs` | `rendered-unified.html` |
| `render-unified-interactive.mjs` | `tei-handlers.mjs` + petite-vue | `rendered-unified-interactive.html` |

CETEIcean generate + render happen in one step (`odd-to-ceteicean.mjs`).

Every renderer accepts **one file or a whole corpus**: `--tei` may be a single
file, a directory, a `* ? **` glob (quote it), a comma-separated list, or a
repeated flag. One input keeps the fixed output name; several write one
`<basename>.html` per source plus a linking `index.html`. Either way the result is
a folder of static flat files — no server.

## Quick start

```bash
npm install
npm run demo               # the Simler edition → static + interactive pages
npm run demo:multi         # both Simler poems → interactive corpus + index
npm test                   # smoke tests
npm run build:all          # all four generators from the Simler ODD
npm run build:simpleprint  # CSS coverage over the full tei_simplePrint customisation
```

Individual generators (`build`, `build:xslt`, `build:unified`, `build:ceteicean`)
default to `../examples/tei_simler.odd`; individual renderers (`render:unified`,
`render:interactive`, `render:xslt`, `render:ceteicean`, `render:multi`) default to
`../examples/simler-poem.xml`.

## Layout

```
compiler-js/
├── odd-parser.mjs        # shared ODD extraction library
├── behaviour-map.mjs     # behaviour → HTML/CSS table (one source of truth)
├── cli.mjs               # shared CLI, file output, escaping, multi-file input
├── odd-to-css.mjs        # CSS from the Processing Model
├── odd-to-xslt.mjs       # XSLT 1.0 generator
├── odd-to-unified.mjs    # unified/xast handler generator
├── odd-to-ceteicean.mjs  # CETEIcean behaviour generator
├── render-*.mjs          # the three renderers (xslt, unified, unified-interactive)
├── test/smoke.test.mjs   # `npm test`
└── output/               # generated artefacts (gitignored)
```

Inputs are in [`../examples/`](../examples/).

## Example ODD

`../examples/tei_simler.odd` is the ODD of **Simler Digital**, a real diplomatic
edition: 56 `elementSpec`s, ~24 with an authored Processing-Model layer, plus 19
source-appearance `<rendition>`s in `<tagsDecl>` (Antiqua-in-Fraktur, centring,
initials, and the CSS-grid layouts that reconstruct the acrostic pages). Its `<pb>`
carries a compound nested model (below). `../examples/tei_simplePrint.odd` is the
TEI's SimplePrint exemplar (119 `elementSpec`s, composed via `<specGrpRef>`), used
to probe how far the CSS floor reaches on a large real-world ODD.

## Dependencies

`@rgrove/parse-xml` — the only dependency, and the parser unified's
`xast-util-from-xml` is built on, so build-time and rendering trees share one engine.

## Architecture

All generators build on three shared modules: **`odd-parser.mjs`** (ODD
extraction — `createOddParser().parse()`, `findElementSpecs()`,
`extractModels()`, …), **`behaviour-map.mjs`** (one table from each PM behaviour
to its HTML element, CSS `display`, and JS-required flag, so retargeting a
behaviour is a one-line edit), and **`cli.mjs`** (args, file output, escaping,
the multi-file `--tei` resolver).

**`<specGrpRef>` resolution.** Real customisations keep reusable specs in
`<specGrp xml:id="…">` blocks pulled in with `<specGrpRef target="#id"/>` (the TEI's
`tei_simplePrint` is composed from seven references). `createOddParser().parse()`
resolves this **within one document**, in reference order: refs expanded in place,
nested refs followed (cycle guard), unreferenced groups skipped, dangling refs
warned. It is *not* full `odd2odd` flattening. A self-contained ODD is returned
untouched.

**Nested-model extension (Boot 2024).** The parser detects `<model>` elements
containing `<modelSequence>` children — compound behaviours (e.g. `<pb>` as a link
*and* a graphic at once). Each generator emits combined output, with a `link`
sub-model wrapping the rest so the result is one clickable element. `tei_simler.odd`
uses this on `<pb>`: a page break renders as a thumbnail linking to the
full-resolution scan, both IIIF image URLs built from `@facs` *inside the ODD*
(`concat(@facs, '/full/pct:25/0/default.jpg')`, …). Link/graphic `uri`/`url` params
accept an `@attr`, a string literal, or a `concat()` of those.

## Example sources & credits

Documented in [`../examples/README.md`](../examples/README.md) — Simler Digital and
the TEI Consortium.
