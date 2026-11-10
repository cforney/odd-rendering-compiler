# Example inputs

Shared sample inputs for both reference implementations — the JavaScript one in
[`../compiler-js`](../compiler-js) and the XSLT one in [`../compiler-xslt`](../compiler-xslt).

## Files

| File | What it is |
|------|------------|
| `tei_simler.odd` | the ODD of **Simler Digital**, a real diplomatic edition, the primary example: `schema/tei_simler.odd` of [DHBern/simler_data](https://github.com/DHBern/simler_data), copied on 2026-11-08 and slightly adapted (see [below](#what-was-changed)). The project's own build (`simler_data/preview`, an interpreter) renders its whole corpus from the project's file |
| `design-tokens.css` | the custom properties the ODD's CSS reads (fonts, sizes, colours); the CSS generators put them at the top of `edition.css` |
| `simler-buchstabwechsel.xml` | poems VI and VII of the dedicatory poems: two interleaved two-column pages, whose acrostics the `l-twocol` params lay out; the poet's name |
| `simler-psalmen.xml` | *Haubtbegriff des erſten Pſalms*, Psalms I–XXI: running headers, page numbers and catchwords, a page break inside a stanza, joined line ends; a commentary note and two names |
| `simler-todtenklang.xml` | poems 141–144 of the epigrams, a song and three burial poems: two printing errors and their corrections (`choice`); the edition's commentary as range notes, with links to dictionaries, and names (`rs`) whose entries the register holds |
| `tei_simplePrint.odd` | the TEI's SimplePrint exemplar (a real-world ODD composed via `<specGrpRef>`), a second ODD to test the compilers on |
| `validate.sh` | validates each excerpt against the schema and the Schematron compiled from the ODD; CI runs it |
| `extensions/nested-pb/` | **an extension**: the Simler ODD with Boot's (2024) nested page-break model, a facsimile thumbnail linking to the full scan; with its own ODD-language customisation (`poc_odds.odd`) to validate it. See its [README](extensions/nested-pb/README.md) |

## The excerpts

Each `simler-*.xml` is an excerpt of a source file of Simler Digital, *Teutsche
Gedichte* (C, 1663), copied from simler_data on 2026-11-08 and **slightly
adapted**. The project's files are work in progress; the excerpts are not synced
with them, and are meant to stay as they are:

- **Close to the source:** the lines are the source's. What is provisional in it
  was removed, errors against the print corrected (letters, a stanza number not
  printed, where a signature stands), and a few names and commentary notes added
  to show what the edition will have, the notes with a link to the
  *Frühneuhochdeutsches Wörterbuch* (FWB). Around the lines are a
  header comment, a minimal `teiHeader` with the IIIF manifest
  (`idno[@type='URLIIIF']`, which the page breaks' `@facs` resolve against) and the
  enclosing elements.
- **A register:** an excerpt that names persons or places carries a `standOff` with
  their entries, from the project's registers, under the same licence as the
  transcriptions.
- **Valid:** each excerpt passes the schema compiled from `tei_simler.odd` and its
  Schematron rules. Where the source itself draws a warning, the table says which.

| Excerpt | Source file, pages | Schematron warnings, the source's own |
|---|---|---|
| `simler-buchstabwechsel.xml` | `C_1663_dok.xml` (the documentary transcription), fol. A vii r–v | none |
| `simler-psalmen.xml` | `C_1663_dok.xml`, pp. 4–7 | none |
| `simler-todtenklang.xml` | `C_1663_Teil-5.xml` (the reading text, with the commentary), pp. 537–540; the reading `dnrch`, which only the documentary transcription marks, from `C_1663_dok.xml` | [S-HI], [S-HIB] on the headings' `hi`; [S-LB] in the title of poem 141 |

### What was changed

The ODD is the project's, slightly adapted as well: it renders the register (with
a link from each name to its entry, which a page may open as a card), and an
indented line in the two-column layout steps further, and an even page's number
stands at the left, as the print does. A
document without a `standOff` renders as with the project's ODD.

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
header records its source. **Please credit the originating projects when
reusing these files.**

- **Simler Digital** — <https://www.simler.unibe.ch/> — Johann Wilhelm Simler,
  *Teutsche Gedichte* (1663). The ODD, the design tokens and the excerpts come
  from the project's repository, [DHBern/simler_data](https://github.com/DHBern/simler_data).
  The transcriptions, the registers and the ODD, with the schema and rendering generated from it, are
  the Simler Project Team's under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  as the ODD's `availability` states and each excerpt's header repeats; so are the
  design tokens of its proofing preview, `design-tokens.css`. The facsimiles
  come from e-rara (<https://www.e-rara.ch/>), on the terms e-rara states for each image. The tests and the
  demo's check use `compiler-js/test/fixtures/iiif/e-rara-4049159.json`, e-rara's
  IIIF manifest of the book cut down to the pages of the excerpts: e-rara's metadata,
  included only as test input and under e-rara's
  [terms of use](https://www.e-rara.ch/wiki/termsOfUse).
- **TEI Consortium** — `tei_simplePrint.odd` is the TEI's SimplePrint exemplar
  (<https://github.com/TEIC/TEI>), under CC BY-SA 3.0 as its header states,
  redistributed here for testing.

## Licensing

The **code** in this repository is under BSD-2-Clause (see the repository
`LICENSE`). The **example texts above are not covered by that licence**: they
remain under their originating projects' terms (the Simler transcriptions, registers, ODD
and design tokens CC BY 4.0, the TEI's SimplePrint CC BY-SA 3.0, e-rara's facsimiles and
the manifest that describes them e-rara's terms) and are included here only as
illustrative input.
