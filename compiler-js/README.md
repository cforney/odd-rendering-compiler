# ODD Rendering Compiler — JavaScript implementation

Build-time pipelines that compile a TEI ODD Processing Model (PM) into rendering
artefacts for static scholarly editions — CSS, an XSLT stylesheet, unified/xast
handlers, and CETEIcean behaviours — with the renderers that turn TEI into HTML.

## One command

Runs every step below, in order:

```bash
node odd-render.mjs <odd> <tei...> [options]          # --help lists them all
node odd-render.mjs ../examples/tei_simler.odd "../examples/simler-*.xml"   --tokens ../examples/design-tokens.css --out build --reports
```

The pages land in `--out` (default `build/`), what the compiler generated in
`<out>/artefacts/`, and with `--reports` the plain text, the JSON records, the
coverage and the findings in `<out>/reports/`. `--search` adds `search.html` and its
Pagefind index, linked from the index page; the pages themselves stay as they are. `--tier static | script |
islands | petite-vue | ceteicean` picks the rendering tier, `--output` the Processing-Model
output, `--strict` fails on XPath outside the subset instead of degrading it. A
missing ODD, a missing source or a glob that matches nothing is an error before
anything is written.

Each step is the script below, run as its own process, so the command adds no
second implementation of anything.

## Installing, and the library

The package is the repository's root `package.json` (this folder's is for
development, and private): the scripts here, `../runtime/` and the behaviour table.
It is not on npm; install it from the repository or from `npm pack` at its root:

```bash
npm install github:cforney/odd-rendering-compiler   # or: npm install ./odd-rendering-compiler-1.0.0.tgz
npx odd-render <odd> <tei...> [options]
```

A build that renders TEI itself imports the library, [`index.mjs`](index.mjs): it
reads the ODD and renders in memory, writes no files and never exits the process.

```js
import { compileOdd, renderDocument } from "odd-rendering-compiler";
const edition = compileOdd("tei_simler.odd", { tokens });   // { odd, css, unsupported, teiToHast }
const { html, hast, notes, page } = renderDocument(edition, xml);   // page: title, lang, credit, …
```

An ODD it cannot read throws an `OddError`; XPath outside the subset is degraded
and listed in `unsupported`. Pages, the index, enhancers and reports stay with the
command lines. CI installs the packed package in an empty project and runs both.

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
CSS nor a `--…` param defines. It also counts the models the stylesheet alone
cannot render, which the renderers must: a behaviour that is not silent and has no
HTML element of its own in the behaviour table, or a predicate that tests more than
the element's ancestry.

## Renderers (artefacts + TEI → HTML)

| Script | Source artefact | Output (`npm run …`) |
|--------|----------------|--------|
| `render-unified.mjs` | `tei-handlers.mjs` | `unified/`; with `--enhance`, `unified-script/`, `unified-islands/` or `unified-petite-vue/` |
| `render-xslt.mjs` | `edition.xsl`, run by SaxonJS (`xslt3`) | `xslt/` |
| `render-plain.mjs` | `tei-handlers.mjs`, output `plain` | `plain/`: `<basename>.txt` and `records.json`, Pagefind custom records (`render:plain`) |
| `search-index.mjs` | the records of `render-plain.mjs` | `search/`: `search.html` and a Pagefind index, with text and query folded (`render:search`; needs the optional `pagefind` package, and HTTP to use) |
| `render-json.mjs` | the ODD itself | `json/`: `<basename>.json`, the ODD's decisions as records (`render:json`) |
| `findings.mjs` | the ODD itself | `findings/`: a page per source and `findings.json` (`findings`) |
| `coverage.mjs` | the ODD + the JSON records | `coverage/`: `coverage.json` and a page (`coverage`) |
| `conformance.mjs` | a suite (default `test/fixtures/`) + a command that renders a case | a line per case, ✓ or ✗ ([conformance suite](../docs/conformance-suite.md)) |

CETEIcean generate + render happen in one step (`odd-to-ceteicean.mjs`, into
`ceteicean/`). `render-unified.mjs` and `render-xslt.mjs` take `--output <name>`,
the PM output to render (default `web`). The `web` page has the ODD's views laid
over it, each with a switch, and the index shows each page's title, page images
and IIIF manifest as the ODD's model for output `page` gives them (see
[`../docs/behaviour-table.md`](../docs/behaviour-table.md)).

**JSON records.** `render-json.mjs` writes the render itself, as data, from the
runtime's trace: a tree in which every element reached names the model that won —
`{ element, model, behaviour, classes, params, parts, outcome, children }`, a child a
record or the text as it renders — and a side table giving each model that ran its
predicate, its `<desc>` and the ODD it was written in. So an element a `content`
param leaves out has no record, and one it selects twice has two. `parts` names the
parts of a sequence that ran. `outcome` is one of:

- `rendered`;
- `omitted`, as the model says;
- `empty`: the model ran and gave nothing;
- `passed-through`: no model applied, so the content renders in its place
  (`model: null`).

Other toolchains read the ODD's decisions here without re-implementing them.

**Findings.** `findings.mjs` reports, and prints in the build log, what the ODD
does not foresee: in each source's text, attribute values outside the ODD's
value lists, renditions it does not declare, elements without a model, note
ranges without their start and anchors no range starts at, and page images
without a IIIF manifest; in the ODD, custom properties defined nowhere (with
`--tokens`, as `odd-to-css.mjs` reports them) and the XPath the handlers cannot
evaluate.

**Coverage.** `coverage.mjs` rolls the records up over the corpus and reads them
back against the ODD. Because the records are the render, it counts what ran, not
what the source holds. It answers an ODD author's two questions, per output:

- *What did I write that never runs?* Models and sequence parts no document ran,
  models that can never run because an earlier model of the same output has no
  predicate, and elements with models that no document rendered.
- *What is in my documents that I never handled?* Elements with no model at all,
  and the silent case: elements whose models all failed to apply, so their content
  passes through without a warning.

What renders nothing (omitted, or empty) is listed apart, and so are models a
chained ODD wrote. Unhandled elements below an `alternate` are not reported:
leaving a reading unrendered is a decision.

**Unrunnable XPath degrades.** A predicate or param outside the XPath subset is
not a build error: it compiles to what a failing evaluation returns — `false()`
for a predicate, nothing for a param — and lands in `odd-unsupported.json`
beside the generated artefacts, with its element, model, ODD and line. Someone
else's ODD therefore runs here, with a report of what was dropped. `--strict`
fails the build instead, and every script that compiles *our* ODDs passes it.
See [`../docs/predicate-grammar.md`](../docs/predicate-grammar.md).

> **Enhancers.** `--enhance` adds scripts of `../runtime/` to the finished page, as
> the XSLT path does, and they read only what every renderer writes (see
> [conventions](../docs/conventions.md)). `script` is the default choice: the small
> `readings.js`, inlined. `islands` is `tei-islands.js`, which fetches each kind of
> behaviour when its first region comes into view (`on="load|idle|visible|media()"`,
> mirroring Astro's `client:*`). `petite-vue` is a labelled example of what using a
> framework takes: directives in the hast, and a CDN dependency.

> **SaxonJS.** The *client-side* SaxonJS + IXSL demo lives in
> [`../compiler-xslt/`](../compiler-xslt/).

Every renderer accepts **one file or a whole corpus**: `--tei` may be a single
file, a directory, a `* ? **` glob (quote it), a comma-separated list, or a
repeated flag. Each source gives `<basename>.html`; several also a linking
`index.html`. If two sources would write the same file (also when their names
differ only in case), the build stops before writing anything. The npm scripts
render every example, `../examples/simler-*.xml`.

## Quick start

```bash
npm install
npm run demo               # the Simler examples → static + interactive pages
npm test                   # smoke tests, conformance fixtures, byte-identity gate
npm run typecheck          # tsc over the JSDoc types, no emit; the browser scripts too
npm run build:all          # all four generators from the Simler ODD
npm run render:all         # every renderer on every example, the plain text and the records
npm run findings           # what the Simler ODD does not foresee in the examples
npm run render:json && npm run coverage   # the decisions as data, read back against the corpus
npm run build:extension && npm run render:extension   # the nested page-break extension
```

Individual generators (`build`, `build:xslt`, `build:unified`, `build:ceteicean`)
read `../examples/tei_simler.odd`, and `build` adds its tokens,
`../examples/design-tokens.css`. Individual renderers (`render:unified`,
`render:script`, `render:islands`, `render:petite-vue`, `render:xslt`, `render:ceteicean`,
`render:plain`, `render:json`) render every example.

**Diagnostics.** What an ODD is read despite has a stable code, a severity and a
place. `odd-to-unified.mjs` writes all of it to `diagnostics.json` and prints the
warnings; `--fail-on warning` makes them fail a publication build. `--lock <file>`
holds the ODD chain to the hashes the first run wrote. `odd-render` passes both
on. [`../docs/capabilities.md`](../docs/capabilities.md) lists the codes, and what
each target reads.

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
├── index.mjs             # the library: compileOdd, renderDocument, editionCss
├── odd-parser.mjs        # reads the ODD into models and CSS rules; parses TEI
├── odd-render.mjs        # the one command: every step below, in order
├── cli.mjs               # the command lines' arguments, input files, logging, output files
├── html.mjs              # HTML as strings: escaping, the hast serialiser, the index and report pages
├── odd-to-css.mjs        # edition.css
├── odd-to-unified.mjs    # tei-handlers.mjs
├── odd-to-xslt.mjs       # edition.xsl, with ../runtime/pm.xsl copied in
├── odd-to-ceteicean.mjs  # CETEIcean behaviours: ../runtime/ceteicean.js over pm-runtime.mjs, xpath.mjs
├── render-*.mjs          # the renderers, the plain text (render-plain.mjs) and the records (render-json.mjs)
├── unsupported.mjs       # the XPath check: degrade outside the subset, or --strict
├── findings.mjs          # build-time findings
├── coverage.mjs          # the records read back against the ODD
├── conformance.mjs       # the conformance suite, run against any implementation
├── byte-identity.mjs     # the equivalence check between renders
├── test/                 # smoke tests, fixtures, gate (`npm test`)
├── tsconfig.json         # `npm run typecheck`: tsc over the JSDoc types
├── tsconfig.browser.json # and over the browser scripts of ../runtime/, with the DOM's
└── output/               # generated artefacts (gitignored)
```

Inputs are in [`../examples/`](../examples/), with their sources and credits.

## Architecture

How the pipeline fits together (model selection, views, the shared runtimes,
flow, the tiers) is in [`../docs/concept.md`](../docs/concept.md). The
conventions are in [`../docs/conventions.md`](../docs/conventions.md), the
behaviours in [`../docs/behaviour-table.md`](../docs/behaviour-table.md), and what
is read of an ODD chain in [`../docs/capabilities.md`](../docs/capabilities.md).
What is particular to this implementation:

- **Reading the ODD.** `readOdd(path)` in `odd-parser.mjs` returns, for each
  `elementSpec`, its models in document order (each with its id `<ident>-<n>` and
  where it was written), the CSS of their `<outputRendition>`s, its value lists,
  and the views. `pageOf(specs, tree)` gives what the model for output `page`
  says of one source. The XSLT generators read the ODD into the same model
  (`../compiler-xslt/generate/odd-model.xsl`).
- **Rendering.** `tei-handlers.mjs` is the ODD's models as a table, with
  predicates and params as XPath; `../runtime/pm-runtime.mjs` renders by it.
- **An ODD it cannot read** is refused with an `OddError`, and every script stops
  with a line per problem (`loadOdd` in `cli.mjs`): XML that is not well-formed,
  a base ODD not found, no `<model>` at all, an `elementSpec` without `@ident`, a
  `<model>` without `@behaviour`, a `<param>` without `@name`, or a
  `<modelSequence>` with no `<model>`.

```
[odd-to-unified] ✗ my.odd:8: <model> in <elementSpec ident="p"> has no @behaviour
```

## Dependencies

[`@rgrove/parse-xml`](https://github.com/rgrove/parse-xml) — the only dependency, and the parser unified's
[`xast-util-from-xml`](https://github.com/syntax-tree/xast-util-from-xml) is built on, so build-time and rendering trees share one engine.
`render-xslt.mjs` fetches SaxonJS (`xslt3`) with `npx` when it is not installed.
