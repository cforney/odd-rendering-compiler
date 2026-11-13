# Capabilities

What this compiler does with an ODD, by target. Compiling is not rendering
faithfully, so each row keeps three things apart:

- **accepted:** read without an error;
- **implemented:** it has the stated effect;
- **executed:** a test runs it on that target, in CI.

Targets: **JS** is `odd-parser.mjs` with the unified handlers. **XSLT** is
`odd-model.xsl` with `pm.xsl`, as both XSLT generators' stylesheets run it.
**CETEIcean** shares JS's resolver and XPath, with its own behaviours in the
browser; the tests inspect what it generates but run no browser, so nothing on
that target counts as executed end to end.

✓ implemented and executed · ◐ implemented, partly executed or with the limit
noted · ✗ accepted but without effect, or refused where said

## Model structure and selection

| Feature | JS | XSLT | CETEIcean | Executed by |
|---|---|---|---|---|
| First model whose predicate holds, in document order | ✓ | ✓ | ◐ | `structure` |
| `modelSequence`, id on its first part | ✓ | ✓ | ◐ | `structure` |
| `modelGrp`: flattened, its boundary kept as the model's `group` | ✓ | ✓ | ◐ | `groups` |
| `@output`, its model first, then those without | ✓ | ✓ | ◐ | `outputs`, `groups` |
| Views laid over the page | ✓ | ✓ | ◐ | `outputs` |
| Engine prefixes `orc-`, `opm-` | ✓ | ✓ | ◐ | `behaviours` |
| Nested models (`compound`), an extension | ✓ | ◐ not compared | ◐ | smoke test, JS |
| `pb:template`, `pass-through`, TEI Publisher's | ✓ | ✓ | ◐ | `behaviours` |

## Namespaces and XPath

| Feature | JS | XSLT | CETEIcean | Executed by |
|---|---|---|---|---|
| Prefixed or default TEI, ODD and source | ✓ | ✓ | ◐ stubbed DOM | `namespaces`, prefixed-ODD test |
| The nearest `xml:space` decides | ✓ | ✓ | ◐ | `whitespace` |
| Foreign elements distinct; content passes through | ✓ | ✓ | ◐ | `namespaces` |
| `elementSpec/@ns` | ✓ | ✓ | ✗ warns | `namespaces` |
| Prefixes the ODD binds, in XPath | ✓ | ✓ | ◐ | `namespaces` |
| SVG and MathML markup copied through | ✗ | ✗ | ✗ | not implemented |
| XPath | ◐ a [subset](predicate-grammar.md) | ✓ 3.1, native | ◐ the subset | `xpath.test.mjs`, `params` |
| Arbitrary external functions | ✗ degraded, reported | ✗ static error | ✗ degraded, reported | smoke test |

## Behaviours and params

The behaviours and their params are in [behaviour-table.md](behaviour-table.md),
executed by `params`, `notes` and `behaviours`.
JS and XSLT are held to the same body by the fixtures; CETEIcean implements them
separately on the DOM and is not compared.

## ODD resolution

The compiler reads a chain of Processing Models. It does not process schemas:
for those, and for full customization, use TEI's tools. A normalized ODD they
produce reads like any other.

| Feature | Read as | JS | XSLT |
|---|---|---|---|
| `schemaSpec/@source`, a local file | a chain, relative to the ODD and any `@xml:base`; a cycle is refused | ✓ | ✓ |
| `@source` elsewhere (`https:`, `tei:`) | refused: keep a copy beside the ODD | ✓ | ✓ |
| `@mode` in a chain | `delete` removes the spec. Otherwise a spec with models replaces the base's models whatever its mode, and one without keeps them | ✓ | ✓ |
| `@mode` without a chain | no effect | ✗ | ✗ |
| `specGrp`, `specGrpRef` | expanded in reference order; a dangling or cyclic one is skipped and diagnosed | ✓ | ✓ |
| Several `schemaSpec`s | the `elementSpec`s of all, a `@source` of the first; diagnosed in JS | ✓ | ◐ no diagnostic |
| Inherited classes and attributes, `classSpec`, `moduleRef` | not read | ✗ | ✗ |
| Chain hashes, `--lock` | checked against a file the first run writes | ✓ | ✗ |

A **schema-only ODD** holds no Processing Model, so it is refused rather than
rendered by an invented default; a schema says what is valid, not how an edition
looks. The message names the explicit way to a default rendering: chain one, with
`<schemaSpec source="tei_simplePrint.odd">`, and copy that ODD beside yours.

`tei_simplePrint.odd` references `#simplechanges`, a `specGrp` it does not hold.
Nothing is lost by skipping it: all 119 specs are read. The ODD is left as vendored;
this is its only warning.

## Diagnostics

| Feature | JS | XSLT |
|---|---|---|
| A code, severity and place for each problem in an ODD that can still be read | ✓ | ◐ code in the message, no place |
| `diagnostics.json`, `--fail-on` | ✓ | ✗ |
| An error while rendering names its expression, model and document | ✓ | ◐ Saxon's message, at the line of the generated stylesheet |

| Code | Severity | Meaning |
|---|---|---|
| `behaviour-unknown` | warning | rendered inline |
| `spec-group-unresolved` | warning | a `specGrpRef` skipped |
| `schema-spec-several` | warning | see above |
| `view-unrealized` | warning | a view's model that cannot be laid over the page |
| `xpath-unsupported` | warning | degraded; an error under `--strict` |
| `group-fallback` | info | a model after a group, which applies only because groups are flattened |

An ODD that cannot be read at all raises an error instead, with each problem and
its line. `findings.mjs` reports what the ODD does not foresee in a document, and
`coverage.mjs` reports elements no model takes. Both are intended fallbacks,
not diagnostics.
