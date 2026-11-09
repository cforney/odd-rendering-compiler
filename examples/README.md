# Example inputs

Shared sample inputs for both reference implementations — the JavaScript one in
[`../compiler-js`](../compiler-js) and the XSLT one in [`../compiler-xslt`](../compiler-xslt).

## Files

| File | What it is |
|------|------------|
| `tei_simler.odd` | the ODD of **Simler Digital**, a real diplomatic edition, the primary example: `schema/tei_simler.odd` of [DHBern/simler_data](https://github.com/DHBern/simler_data), copied on 2026-11-08 with the register added (see [below](#what-was-changed)). The project's own build (`simler_data/preview`, an interpreter) renders its whole corpus from the project's file |
| `design-tokens.css` | the custom properties the ODD's CSS reads (fonts, sizes, colours); the CSS generators put them at the top of `edition.css` |
| `simler-buchstabwechsel.xml` | poems VI and VII of the dedicatory poems: two interleaved two-column pages, whose acrostics the `l-twocol` params lay out; readings (`choice`) inside the acrostic lines; the poet's name |
| `simler-psalmen.xml` | *Haubtbegriff des erſten Pſalms*, Psalms I–XXI: running headers, page numbers and catchwords, a page break inside a stanza, joined line ends; a commentary note and two names |
| `simler-todtenklang.xml` | poems 143 and 144 of the epigrams, a burial poem and a sonnet: the edition's commentary as range notes, with links to dictionaries, and names (`rs`) whose entries the register holds |
| `tei_simplePrint.odd` | the TEI's SimplePrint exemplar (a real-world ODD composed via `<specGrpRef>`), a second ODD to test the compilers on |
| `validate.sh` | validates each excerpt against the schema and the Schematron compiled from the ODD; CI runs it |
| `extensions/nested-pb/` | **an extension**: the Simler ODD with Boot's (2024) nested page-break model, a facsimile thumbnail linking to the full scan; with its own ODD-language customisation (`poc_odds.odd`) to validate it. See its [README](extensions/nested-pb/README.md) |

## The excerpts

Each `simler-*.xml` is an excerpt of a source file of Simler Digital, *Teutsche
Gedichte* (C, 1663), copied from simler_data on 2026-11-08. The project's files are
work in progress; the excerpts are not synced with them, and are meant to stay as
they are:

- **Close to the source:** the lines are the source's, with only the changes the
  table below lists. A change removes what is provisional in the source, so that
  the example does not keep a working state, or adds what shows a feature the
  edition will have. Around the lines are a header comment, a minimal `teiHeader`
  with the IIIF manifest (`idno[@type='URLIIIF']`, which the page breaks' `@facs`
  resolve against), the enclosing elements, and the register.
- **A register:** each excerpt that names a person or place carries a `standOff`
  with the entries its `rs/@key` refer to, and no others. Name, life dates,
  description and authority identifiers come from the project's registers (its
  Google Sheet), under the same licence as the transcriptions.
- **Valid:** each excerpt passes the schema compiled from `tei_simler.odd` and its
  Schematron rules. Where the source itself draws a warning, the table says which.

| Excerpt | Source file, pages | Changes | Schematron warnings, the source's own |
|---|---|---|---|
| `simler-buchstabwechsel.xml` | `C_1663_dok.xml`, fol. A vii r–v | `rs` on the poet's name, as `C_1663_Teil-0.xml` marks it; **a correction:** a stray `lb` inside the verse line *Lern ſchweigen; und das mau* (poem VII) removed, as the print, `C_1663_Teil-0.xml` and `D_1688.xml` have one line (corrected in simler_data too) | none |
| `simler-psalmen.xml` | `C_1663_dok.xml` (the documentary transcription), pp. 4–7 | `rs` on *David* and *Abſolon* in Psalm III, as the reading text `C_1663_Teil-1.xml` marks them; **a commentary note on *Abſolon* (`k1.1`), written for the example** in the form of the edition's commentary | none |
| `simler-todtenklang.xml` | `C_1663_Teil-5.xml` (the reading text, with the commentary), pp. 539–540 | the page break of p. 539, which falls in the poem before, set before 143; the provisional `label`s (`[215.]`, `[216.]`) and the commentary's `@subtype` removed; a commentary note that was a placeholder for the register ("vgl. Biogramm [Link]") removed with its anchor; a mistyped host in a link corrected (`fwb-online.de`) | [S-HI], [S-HIB] on the two headings' `hi`, which covers the whole `head` |

### What was changed

The ODD is the project's, with the register its examples carry and one change
to the layout, which the project's ODD shares. A document without a `standOff`
renders as with the project's ODD:

- **The register:** `standOff` (module linking) with `listPerson`/`listPlace`,
  `person`/`place`, `placeName`, `birth`, `death` (module namesdates), each with a
  model; `standOff` follows the `text`, and is left out of the search text
  (`plain`). An entry carries `data-card`, which a page may open as a card where
  the name stands ([conventions](../docs/conventions.md#what-an-enhancer-may-rely-on)).
- **Its links:** `rs` for a person or place with one entry links to it
  (`#person_003`), and reads as the text around it; the `entities` view has link
  models to match, so it still highlights the names. `idno` of type
  `GND`, `HLS` or `GeoNames` links to the authority, and `persName` gained a model.
- **The two-column layout:** an indented line in the `twocol` rendition steps 1.2em
  (`--indent-step`, was 0.5em), as the print indents it, so that a name formed by the
  first letters of the flush lines (SJMLER in poem VII) reads down the column; the
  project's ODD has the same change.
- **Its rules:** each `rs/@key` has an entry where the register is present
  ([S-RR]); a note in the register needs no `@type`; a `head` in a list of the
  register is a caption.

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
header records its source, and the table above what was changed. **Please credit the originating projects when
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
