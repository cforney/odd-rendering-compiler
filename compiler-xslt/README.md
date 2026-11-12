# ODD Rendering Compiler — XSLT implementation

An experimental implementation of the **define → generate → render** chain built
entirely in **XSLT**: a TEI ODD's Processing Model is compiled into the rendering
artefacts (an `edition.xsl` stylesheet and an `edition.css`) by XSLT itself, which
then run over a TEI document to produce static HTML — the same HTML the
JavaScript implementation renders.

Run with no arguments, it builds the **Simler** edition from the project's own
ODD, over its three excerpts: Fraktur renditions, notes and commentary, a
register, and a CSS-grid acrostic layout.

```
compiler-xslt/
├── generate/
│   ├── odd-model.xsl         reads the ODD into models and CSS rules (included by the three below)
│   ├── odd-to-xsl.xsl        ODD → edition.xsl   (XSLT generating XSLT)
│   ├── odd-to-css.xsl        ODD → edition.css   (XSLT generating CSS)
│   ├── odd-to-ceteicean.xsl  ODD → CETEIcean behaviours + demo page
│   ├── render-saxonjs.xsl    edition.xsl + IXSL handlers → client-side SaxonJS driver
│   ├── generate-saxonjs-page.xsl  the SaxonJS host page
│   └── generate-index.xsl    the index of the interactive pages, by edition.xsl's page model
├── build.sh / build.ps1 drivers (run generate + render with Saxon)
└── output/              generated artefacts + rendered pages (gitignored)
```

Inputs are in [`../examples/`](../examples/) (the Simler edition + `tei_simplePrint.odd`),
with their sources and credits.

## Run it

Requires **Java** and **Saxon HE 12**. Point `SAXON_HOME` at your unpacked Saxon
directory (the one with `saxon-he-12*.jar` and `lib/xmlresolver-*.jar`);
download it from <https://www.saxonica.com/download/java.xml>. Without `SAXON_HOME`
the scripts try `./vendor/SaxonHE12-9J`, and otherwise fail with instructions.

The optional **SaxonJS** step (below) also needs **Node.js** (for `npx xslt3`); if
Node is absent the build prints a notice and skips it — everything else still runs.

```bash
bash build.sh                                                            # the Simler ODD, every example
bash build.sh ../examples/tei_simler.odd ../examples/simler-psalmen.xml  # one example
```
```powershell
./build.ps1                                                              # Windows / PowerShell
```

Outputs, in `output/`:

- `edition.xsl` and `edition.css`, with the design tokens of `TOKENS` (relative
  to the ODD, by default `design-tokens.css`);
- one page per TEI file in `xslt/` (static, no JavaScript), and in `xslt-script/`
  and `xslt-islands/` (enhanced, by the stylesheet's param `enhance`), each with
  an `index.html` from `generate-index.xsl`;
- `ceteicean/`: `tei-ceteicean-behaviours.js` and a page per TEI file that
  renders it in the browser with CETEIcean;
- with Node, the **SaxonJS** path: `edition-saxonjs.sef.json`, a page per TEI
  file in `saxonjs/`, and a self-hosted `SaxonJS2.rt.js` (see below).

## SaxonJS in the browser (SEF + IXSL)

The build-time stylesheet runs *client-side* too. `render-saxonjs.xsl` imports the
generated `edition.xsl` (reusing every TEI template) and adds an IXSL event
template for the apparatus toggle; `xslt3` compiles it to a Stylesheet
Export File (`edition-saxonjs.sef.json`), and the pages in `saxonjs/` run that SEF
in the browser with the SaxonJS runtime. So the **same** template-matching
stylesheet has two entry points — **Saxon HE at build time, SaxonJS in the
browser** — and the reading toggle is *interactive XSLT* (IXSL), the
SaxonJS-native counterpart of the build path's small script. As on every
interactive page, `notes.js` opens notes as tooltips, and `facsimile.js` opens
a page break's image.

Two tool notes: the SEF compiler is **`xslt3`** (the Node SaxonJS compiler), not
Saxon HE — Saxon HE cannot emit a SaxonJS-runnable SEF, and only `xslt3`
understands the `ixsl:` instructions. The browser **runtime** (`SaxonJS2.rt.js`,
matching `xslt3` 2.7) is downloaded next to the page so the demo is self-contained
and works offline. Open it over **HTTP** (e.g. `npx http-server output`), not
`file://`: the page fetches the SEF and the TEI at view time.

## How "generate" works in XSLT

`generate/odd-to-xsl.xsl` reads the ODD and **writes a stylesheet**, using the
idiomatic [`xsl:namespace-alias`](https://www.w3.org/TR/xslt-30/#generating-stylesheets)
technique: elements that must appear as `xsl:*` in the generated `edition.xsl` are
written `axsl:*` and aliased to the XSLT namespace on output; literal HTML passes
straight through. The design turns on two evaluation times:

| prefix | runs… | over… |
|--------|-------|-------|
| `xsl:`  | now (generate) | the **ODD** — for each element, its models in document order, their classes and params |
| `axsl:` | later (render) | the **TEI** — an `xsl:choose` taking the first model of an output whose predicate holds, as a map |

So each TEI element gets one `<xsl:template mode="pm:select">`: given an output
(`''` for the models without `@output`), it returns the element's model as a map
of its behaviour, classes and params, the params evaluated where the element
stands. The ODD's views follow as `$pm:views`. Predicates and params stay XPath,
which XSLT evaluates natively, so there is no translation gap. The behaviours
are not generated: they are the runtime [`../runtime/pm.xsl`](../runtime/pm.xsl),
copied into `edition.xsl`. It asks `pm:select` for the output being rendered and
for each view, and renders the model. JavaScript's `odd-to-xslt.mjs` generates
the same stylesheet from the same runtime.

`generate/odd-model.xsl` reads the ODD for all three generators, as
`compiler-js/odd-parser.mjs` does for the JavaScript ones:

- **Model groups** are flattened, keeping document order.
- **Classes and CSS:** styled models get their classes and CSS rules; a model's
  CSS for an output applies where that output is on.
- **Views:** every output but `web`, `page` and `plain`, labelled by the first
  `<desc>` of its models without `xml:lang`.
- **`<specGrp>`/`<specGrpRef>`** composition is resolved within one document
  (reference order, cycle guard, unreferenced groups skipped); this is not full
  `odd2odd`.
- **Chaining:** `<schemaSpec source="…">` is followed as an ODD chain.

`generate/odd-to-css.xsl` writes the rules to `edition.css`, with those that lay
each view over the page.
`generate/odd-to-ceteicean.xsl` emits a third target: a CETEIcean behaviour map
(the runtime `../runtime/ceteicean.js` and the models as JSON) and a page
that renders in the browser over `pm-runtime.mjs` and `xpath.mjs`. It writes the
same file as the JS `odd-to-ceteicean.mjs`.

## Notes

- **Source appearance & layout** ride on `@rendition`: where a model sets
  `@useSourceRendition`, the element's pointer list becomes `r-<id>` classes that
  `edition.css` (from `<tagsDecl>`) styles. This is how the *Buchstabwächsel*
  reconstructs its interleaved columns: the `#twocol` rendition makes the CSS grid, and the
  `l-twocol` model's params (`--acro`, `--fin`, `--indent`) set each line's
  marginal letters and indent.
- **The enhancers are the unified path's.** `enhance=script|islands` adds the same
  scripts of `../runtime/`, which the build copies beside `edition.xsl`, to the same
  page. The petite-vue example has no XSLT form: its directives (`@click`,
  `:aria-checked`) are not valid XML attribute names, so a standards XSLT generator
  cannot emit them.
- **Fidelity.** The body of each static page in `xslt/` is **equivalent** to the
  unified render and to that of the stylesheet from `odd-to-xslt.mjs`: identical
  up to attribute order and the whitespace next to a block's tags. `compiler-js`'s `npm test` checks this on
  the examples and on the conformance fixtures.
