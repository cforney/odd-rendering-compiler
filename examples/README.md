# Example inputs

Shared sample inputs for both implementations — the JavaScript one in
[`../compiler-js`](../compiler-js) and the XSLT one in [`../compiler-xslt`](../compiler-xslt).

The TEI files are provisional excerpts, adapted as examples for this repository.
They are not the edition's final TEI, which Simler Digital publishes at
<https://www.simler.unibe.ch/>.

## Files

| File | What it is |
|------|------------|
| `tei_simler.odd` | the ODD of **Simler Digital**, a real diplomatic edition, the primary example: the project's ODD, copied on 2026-11-13 and slightly adapted (see [below](#what-was-changed)) |
| `design-tokens.css` | the custom properties the ODD's CSS reads (fonts, sizes, colours); the CSS generators put them at the top of `edition.css` |
| `simler-buchstabwechsel.xml` | poems VI and VII of the dedicatory poems: two interleaved two-column pages, whose acrostics the `l-twocol` params lay out; the poet's name |
| `simler-psalmen.xml` | *Haubtbegriff des erſten Pſalms*, Psalms I–XXI: running headers, page numbers and catchwords, a page break inside a stanza, joined line ends; commentary notes |
| `simler-todtenklang.xml` | poems 141–144 of the epigrams, a song and three burial poems: two printing errors and their corrections (`choice`); the edition's commentary as range notes, with links to dictionaries, and names (`rs`) whose entries the register holds |
| `tei_simplePrint.odd` | the TEI's SimplePrint exemplar (a real-world ODD composed via `<specGrpRef>`), a second ODD to test the compilers on |
| `validate.sh` | validates each excerpt against the schema and the Schematron compiled from the ODD; CI runs it |
| `extensions/nested-pb/` | **an extension**: the Simler ODD with Boot's (2024) nested page-break model, a facsimile thumbnail linking to the full scan; with its own ODD-language customisation (`poc_odds.odd`) to validate it. See its [README](extensions/nested-pb/README.md) |

## The excerpts

Each `simler-*.xml` is an excerpt of a source file of Simler Digital, *Teutsche
Gedichte* (C, 1663), copied on 2026-11-08 (checked against the project's files on 2026-11-13) and **slightly
adapted**. They are not synced with the project's files, and are meant to stay as
they are.

### What was changed

The ODD renders the register (with a link from each name to its entry, which a
page may open as a card), and its views have English labels for the demo. The
`note/@subtype` of the project's commentary import and its constraint
(`note-commentary`) are left out, and so are two clean-up checks the excerpts
no longer need (`hi-block-rendition`, `hi-spanning-rendition`).

## Validate

```bash
SAXON_HOME=…/SaxonHE12 JING=…/jing.jar TEI_XSL=…/tei-xsl/xml/tei/stylesheet \
SCHXSLT=…/schxslt2/transpile.xsl bash validate.sh
```

It compiles `tei_simler.odd` with the TEI Stylesheets (`odd2odd` against TEI
4.12.0, then `odd2relax` and `extract-isosch`), transpiles the Schematron with
SchXslt2, and validates every excerpt with jing and the transpiled rules. It lists
the Schematron warnings and fails on an invalid excerpt or a Schematron error.

## Sources, credits and licensing

The **code** in this repository is under BSD-2-Clause (see the repository
`LICENSE`); the **example texts are not covered by it**. They are reused, by
permission, as illustrative input and keep their originating projects' terms;
each file's header records its source. **Please credit the originating projects
when reusing these files.**

- **Simler Digital** — <https://www.simler.unibe.ch/> — Johann Wilhelm Simler,
  *Teutsche Gedichte* (1663). The ODD, the design tokens and the excerpts come
  from the project's [data repository](https://github.com/DHBern/simler_data).
  The transcriptions, registers, ODD (with the schema and rendering generated
  from it) and design tokens are the Simler Project Team's, under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see each file's header).
  The facsimiles are not in this repository: the pages load them, and the IIIF
  manifest, from e-rara (<https://www.e-rara.ch/>), on e-rara's terms. The tests and the
  demo's check use a made-up manifest instead, `compiler-js/test/fixtures/iiif/simler-pages.json`,
  which shares only the page ids with e-rara's.
- **TEI Consortium** — `tei_simplePrint.odd` is the TEI's SimplePrint exemplar
  (<https://github.com/TEIC/TEI>), under CC BY-SA 3.0 as its header states,
  redistributed here for testing.
