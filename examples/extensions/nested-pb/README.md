# Extension: the nested page-break model

> **Not TEI.** This example uses the nested model that Boot (2024) proposes: a
> `<model>` that holds a `<modelSequence>`, so one element has several behaviours
> at once. The TEI's ODD schema (`tei_odds.rng`) rejects it, and only this proof
> of concept renders it. The Simler ODD one level up, the project's own, renders
> `pb` with the standard `break` behaviour.

With a facsimile, a page break renders as a thumbnail of the page that links to
the full scan: a `compound` of a `link` and a `graphic`, the link wrapping the
graphic. Both IIIF image URLs are built in the ODD from `@facs`, which is the
bare image id that Simler Digital encodes, and the IIIF manifest in the header.
Without a facsimile, the page break is its number. The example is the Psalms
excerpt one level up, `../../simler-psalmen.xml`.

## Files

| File | What it is |
|------|------------|
| `tei_simler-nested-pb.odd` | the extension: chains to `../../tei_simler.odd` (`schemaSpec/@source`) and replaces the models of `pb` |
| `poc_odds.odd` | the ODD language (`tei_odds`) with one change: a `<model>` may hold a `<modelSequence>` |
| `validate.sh` | compiles `poc_odds.odd` with the TEI Stylesheets and validates the extension against it |

## Chaining

The compilers read `schemaSpec/@source` as a minimal ODD chain: the specs of the
source ODD, where a spec of this ODD that has models replaces the source spec's
models, `mode="delete"` removes a spec, and a new ident is added.

## Render

```bash
cd compiler-js
npm run build:extension    # edition.css + tei-handlers.mjs → output/nested-pb/
npm run render:extension   # → output/nested-pb/simler-psalmen.html
```

The XSLT generators render it too, from `compiler-xslt/`:

```bash
TOKENS=../../design-tokens.css bash build.sh ../examples/extensions/nested-pb/tei_simler-nested-pb.odd ../examples/simler-psalmen.xml
```

The CETEIcean tier leaves it out.

## Validate

```bash
SAXON_HOME=…/SaxonHE12 JING=…/jing.jar TEI_XSL=…/tei-xsl/xml/tei/stylesheet \
TEI_ODDS_RNG=…/tei_odds.rng bash validate.sh
```

It checks that `poc_odds.odd` is valid TEI, compiles it to RELAX NG (TEI
Stylesheets `odd2odd`, then `odd2relax`), validates the extension against the
result, and checks that `tei_odds.rng` rejects the extension. CI runs it on every
push. So the proposal (Boot 2024, as cited in the article) becomes a precise,
testable customisation.
