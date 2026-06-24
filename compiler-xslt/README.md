# ODD Rendering Compiler — XSLT implementation

A reference implementation of the **define → generate → render** chain built
entirely in **XSLT**: a TEI ODD's Processing Model is compiled into the rendering
artefacts (an `edition.xsl` stylesheet and an `edition.css`) by XSLT itself, which
then run over a TEI document to produce static HTML. (The JavaScript implementation
of the same chain is in [`../compiler-js`](../compiler-js).)

Run with no arguments it builds the **Simler** edition — Fraktur renditions,
entities coloured by `@type`, and CSS-grid acrostic layouts — so the page is richly
styled.

```
compiler-xslt/
├── generate/
│   ├── odd-to-xsl.xsl   ODD → edition.xsl   (XSLT generating XSLT)
│   └── odd-to-css.xsl   ODD → edition.css   (XSLT generating CSS)
├── build.sh / build.ps1 drivers (run generate + render with Saxon)
└── output/              generated artefacts + rendered pages (gitignored)
```

Inputs are in [`../examples/`](../examples/) (the Simler edition + `tei_simplePrint.odd`).

## Run it

Requires **Java** and **Saxon HE 12**. Point `SAXON_HOME` at your unpacked Saxon
HE 12 directory (the one with `saxon-he-12*.jar` and `lib/xmlresolver-*.jar`);
download it from <https://www.saxonica.com/download/java.xml>. Without `SAXON_HOME`
the scripts try `./vendor/SaxonHE12-9J`, otherwise failing with instructions.

```bash
bash build.sh                                                                   # default: the Simler edition
bash build.sh ../examples/tei_simler.odd ../examples/simler-buchstabwechsel.xml # the acrostic poem
```
```powershell
./build.ps1                                                                     # Windows / PowerShell
```

Outputs: `edition.xsl`, `edition.css`, `rendered-xslt.html` (Tier 1, zero-JS) and
`rendered-xslt-interactive.html` (Tier 2, progressively enhanced).

## How "generate" works in XSLT

`generate/odd-to-xsl.xsl` reads the ODD and **writes a stylesheet**, using the
idiomatic [`xsl:namespace-alias`](https://www.w3.org/TR/xslt-30/#generating-stylesheets)
technique: elements that must appear as `xsl:*` in the generated `edition.xsl` are
written `axsl:*` and aliased to the XSLT namespace on output; literal HTML passes
straight through. The design turns on two evaluation times:

| prefix | runs… | over… |
|--------|-------|-------|
| `xsl:`  | now (generate) | the **ODD** — pick the HTML element, bake `class`/`style`, dispatch on `@behaviour`, expand `@predicate` into a `match` pattern |
| `axsl:` | later (render) | the **TEI** — `apply-templates`, `value-of`, `xsl:number`, the dynamic heading `xsl:element` |

So a `<model behaviour="inline">` becomes an `<xsl:template>` emitting
`<span class="tei-…">…</span>`, and a `@predicate` becomes an XPath `match`
predicate — XSLT speaks XPath natively, so there is no translation gap.
`generate/odd-to-css.xsl` does the same for the CSS floor (one rule per `<model>`;
CSS-inexpressible predicates become comments).

Both generators resolve `<specGrp>`/`<specGrpRef>` composition within one document
(reference order, cycle guard, unreferenced groups skipped) — the pattern the TEI's
own `tei_simplePrint` uses. It is single-document resolution, not full `odd2odd`.

## Notes

- **Source appearance & layout** ride on `@rendition`: the generated stylesheet
  turns each element's pointer list into `r-<id>` classes that `edition.css` (from
  `<tagsDecl>`) styles. That is how the *Buchstabwechsel* poem reconstructs its
  interleaved columns and marginal acrostic — pure CSS-grid renditions from the ODD.
- **The target language shapes the output.** The interactive page does *not* use
  petite-vue: its directives (`@click`, `:aria-checked`) are not valid XML attribute
  names, so a standards XSLT generator cannot emit them. The same result (note and
  apparatus toggles, graceful degradation) is reached with `data`/`class` hooks plus
  ~12 lines of vanilla JS and a `<noscript>` reveal.
- **Fidelity.** Built over a shared sample ODD, the static `rendered-xslt.html`
  **body is byte-identical** to the JS output (same `tei-*` classes, baked styles,
  footnotes); only two cosmetic `<head>` serialisation details differ.

## Example sources & credits

The Simler texts (**Simler Digital**, <https://www.simler.unibe.ch/>; facsimiles
e-rara, CC BY-SA) and `tei_simplePrint.odd` (**TEI Consortium**) are used as
illustrative examples — see [`../examples/README.md`](../examples/README.md) for
provenance and credits.
