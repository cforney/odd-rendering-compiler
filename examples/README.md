# Example inputs

Shared sample inputs for both reference implementations — the JavaScript one in
[`../compiler-js`](../compiler-js) and the XSLT one in [`../compiler-xslt`](../compiler-xslt).

## Files

| File | What it is |
|------|------------|
| `tei_simler.odd` | the ODD of **Simler Digital**, a real diplomatic edition: `schema/tei_simler.odd` of [DHBern/simler_data](https://github.com/DHBern/simler_data) at <!-- sync-odd -->[`3250d0e`](https://github.com/DHBern/simler_data/tree/3250d0ebdf869c20253bc25e61ee187e30603450) (2026-11-08)<!-- /sync-odd -->, unchanged; the primary example. The project's own build (`simler_data/preview`, an interpreter) renders its whole corpus from the same file |
| `simler-tokens.css` | the design tokens the ODD's CSS reads (`preview/assets/tokens.css`, same commit); the CSS generators put them at the top of `edition.css` |
| `simler-psalmen.xml` | *Haubtbegriff des erſten Pſalms*, Psalms I–V: a range note set inside a word, running headers, page numbers and a catchword, a page break inside a stanza, joined line ends |
| `simler-buchstabwechsel.xml` | poem VI of the dedicatory poems: the interleaved two-column page, whose acrostics (JOHANN, WILHELM, SIMMLER) the `l-twocol` params lay out; and named entities (`rs`) |
| `simler-hausswesen.xml` | *Chriſtenliches Haußweſen*: printed Bible notes, which the ODD sets in the margin, with editorial range notes inside them, `choice`, `supplied` and `unclear` in a note, nested `lg` |
| `simler-regenten-kleinodt.xml` | *Regenten Kleinodt*, Psalm 72: printed marginal glosses with joined line ends, a melody line, numbered stanzas |
| `tei_simplePrint.odd` | the TEI's SimplePrint exemplar (a real-world ODD composed via `<specGrpRef>`), a second ODD to test the compilers on |
| `sync-odd.mjs` | vendors the ODD, the tokens and the excerpts at a commit and records it above and in each excerpt: `npm run sync:odd -- <commit>` from `compiler-js/`. It finds an excerpt by its text, as line numbers move |
| `validate.sh` | validates each excerpt against the schema and the Schematron compiled from the ODD; CI runs it |
| `extensions/nested-pb/` | **an extension**: the Simler ODD with Boot's (2024) nested page-break model, a facsimile thumbnail linking to the full scan; with its own ODD-language customisation (`poc_odds.odd`) to validate it. See its [README](extensions/nested-pb/README.md) |

## The excerpts

Each `simler-*.xml` is an excerpt of a source file of Simler Digital, *Teutsche
Gedichte* (C, 1663):

- **Verbatim:** its lines are copied unchanged. Added around them are only a
  header comment, a minimal `teiHeader` with the IIIF manifest
  (`idno[@type='URLIIIF']`, which the page breaks' `@facs` resolve against), the
  start tags of the enclosing elements, and the closing tags.
- **Sourced:** the header comment names the source file, the line range and the
  commit.
- **Valid:** each excerpt passes the schema compiled from `tei_simler.odd` and its
  Schematron rules. Where the source itself draws a warning, the header comment
  says which.

Three excerpts come from `C_1663_dok.xml`. The Buchstabwächsel comes from
`C_1663_Teil-0.xml`, an earlier transcription stage of the same edition, because
at the pinned commit `C_1663_dok.xml` sets that page as plain lines. It is also
the only excerpt with `rs`, so the ODD's `entities` output has something to show.

## Validate

```bash
SAXON_HOME=…/SaxonHE12 JING=…/jing.jar TEI_XSL=…/tei-xsl/xml/tei/stylesheet \
SCHXSLT=…/schxslt2/transpile.xsl bash validate.sh
```

It compiles `tei_simler.odd` with the TEI Stylesheets (`odd2odd` against TEI
4.12.0, then `odd2relax` and `extract-isosch`), transpiles the Schematron with
SchXslt2, and validates every excerpt with jing and the transpiled rules. It lists
the Schematron warnings and fails on an invalid excerpt or a Schematron error.

## Sources & credits

The sample texts are reused, by permission, as illustrative examples; each file's
header records its exact source. **Please credit the originating projects when
reusing these files.**

- **Simler Digital** — <https://www.simler.unibe.ch/> — Johann Wilhelm Simler,
  *Teutsche Gedichte* (1663). The ODD, the design tokens and the excerpts come
  from the project's repository, [DHBern/simler_data](https://github.com/DHBern/simler_data).
  The transcriptions and the ODD, with the schema and rendering generated from it, are
  the Simler Project Team's under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  as the ODD's `availability` states and each excerpt's header repeats. The facsimiles
  come from e-rara (<https://www.e-rara.ch/>), on the terms e-rara states for each image. The tests and the
  demo's check use `compiler-js/test/fixtures/iiif/e-rara-4049159.json`, e-rara's
  IIIF manifest of the book cut down to the pages of the excerpts.
- **TEI Consortium** — `tei_simplePrint.odd` is the TEI's SimplePrint exemplar
  (<https://github.com/TEIC/TEI>), under CC BY-SA 3.0 as its header states,
  redistributed here for testing.

## Licensing

The **code** in this repository is under BSD-2-Clause (see the repository
`LICENSE`). The **example texts above are not covered by that licence**: they
remain under their originating projects' terms (the Simler transcriptions and ODD
CC BY 4.0, the TEI's SimplePrint CC BY-SA 3.0, e-rara's facsimiles e-rara's terms per
image) and are included here only as illustrative input.
