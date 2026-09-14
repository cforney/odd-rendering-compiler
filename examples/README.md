# Example inputs

Shared sample inputs for both reference implementations — the JavaScript one in
[`../compiler-js`](../compiler-js) and the XSLT one in [`../compiler-xslt`](../compiler-xslt).

## Files

| File | What it is |
|------|------------|
| `tei_simler.odd` | the ODD of **Simler Digital**, a real diplomatic edition (authored Processing-Model layer), as of June 2026; the primary example. Its `pb` renders with the standard `break` behaviour, as in the project's own ODD |
| `simler-poem.xml` | a Simler poem (Psalm 117); its `<pb facs>` carry e-rara IIIF image URLs, which the page breaks carry as `data-page` |
| `simler-buchstabwechsel.xml` | Simler poem VI — the interleaved-column / acrostic layout showcase |
| `tei_simplePrint.odd` | the TEI's SimplePrint exemplar (a real-world ODD composed via `<specGrpRef>`), a second ODD to test the compilers on |
| `extensions/nested-pb/` | **an extension, not TEI**: the Simler ODD with Boot's (2024) nested page-break model, a facsimile thumbnail linking to the full scan; with its own ODD-language customisation (`poc_odds.odd`) to validate it. See its [README](extensions/nested-pb/README.md) |

## Sources & credits

The sample texts are reused, by permission, as illustrative examples; each file's
header records its exact source. **Please credit the originating projects when
reusing these files.**

- **Simler Digital** — <https://www.simler.unibe.ch/> — Johann Wilhelm Simler,
  *Teutsche Gedichte* (1663). Source files from the project's data; facsimiles from e-rara (<https://www.e-rara.ch/>),
  CC BY-SA. Provides `simler-poem.xml` and `simler-buchstabwechsel.xml`.
- **TEI Consortium** — `tei_simplePrint.odd` is the TEI's SimplePrint exemplar
  (<https://github.com/TEIC/TEI>), redistributed here for testing.

## Licensing

The **code** in this repository is under BSD-2-Clause (see the repository
`LICENSE`). The **example texts above are not covered by that licence**: they
remain under their originating projects' terms (e.g. e-rara facsimiles are
CC BY-SA) and are included here only as illustrative input.
