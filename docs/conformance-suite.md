# A shared conformance suite for the Processing Model

**A proposal.** Several implementations now read TEI ODD Processing Models: for
example, TEI Publisher, OPM, and this compiler.
Each answers the questions the Guidelines leave open in its own way, and each
tests only itself. What is missing is not another implementation, but a way to
see where the implementations agree. This compiler's conformance fixtures are
offered as a starting point, because fixtures are cheap to exchange and no
project can agree with the others on its own.

## The suite

A suite is a directory, [`compiler-js/test/fixtures/`](../compiler-js/test/fixtures/)
here:

- `pm.odd`: one ODD, with one or two `elementSpec`s per feature and a comment on
  each saying what it tests;
- `tei/<case>.xml`: a TEI document per case;
- `<case>.html`: the expected render of the `web` output, and
  `<case>.<output>.html` of another output, where the case has one;
- `invalid.odd`: an ODD that should be refused, with each problem in it once.

| Case | What it covers |
|---|---|
| `structure` | a spec's only model; a model group with an inherited `@useSourceRendition`; `@cssClass`; document order (the first model wins, the next predicate is never asked); a `modelSequence` with the id on its first part; a block inside phrasing content |
| `outputs` | `@output`: an output's models take precedence, a view laid over the page (`omit`, added classes, an `alternate`'s readings), a model marked `web` |
| `params` | params as CSS custom properties and attributes; node-valued params, one selecting the element itself; predicates with positions, value comparisons and conditionals; breaks, labels, the hyphen at a joined line end; `link` and `graphic` |
| `notes` | notes numbered in document order, the outer before the inner; a note in the margin, without a marker; a range closed by `@targetEnd`; a note's `xml:id` on its marker, or on its body without one |
| `groups` | a group's first member that holds wins; with none, a model after it is the fallback; a group's `@output`; a sequence in a group |
| `namespaces` | a prefixed TEI source renders as an unprefixed one; a same-named element of another namespace is distinct; `elementSpec/@ns`; prefixes in a predicate |
| `whitespace` | the nearest `xml:space` decides, through alternating `preserve` and `default` |
| `behaviours` | `figure`; TEI Publisher's `pass-through` and `<pb:template>`; engine prefixes on `@output` (`opm-`, `orc-`) |
| `invalid.odd` | no `@behaviour`, `@ident` or param `@name`; an empty `modelSequence`; a base ODD not found |

Which target executes what is in [capabilities.md](capabilities.md).

## Comparing

The expected files carry this compiler's conventions ([conventions.md](conventions.md)):
its classes, its view switches, its notes section. Two levels of comparison
separate those from what the ODD decides:

- **strict:** the body, up to attribute order and the whitespace next to a
  block's tags; any other whitespace counts. This is how the
  compiler's own engines are held to each other.
- **structure:** only tags and text, inside the edition, without attributes, the
  edition's wrapper and the view switches. This is the level at which two
  implementations with different class names can agree.

[`compiler-js/conformance.mjs`](../compiler-js/conformance.mjs) runs a suite
against any implementation that can be called from a shell. The command renders
one case for one output; `{odd}`, `{tei}`, `{case}`, `{output}` and `{out}` are
filled in, and the render is expected at `{out}/{case}.html`:

```bash
node conformance.mjs --level structure \
  --run 'my-renderer "{odd}" "{tei}" --output {output} > "{out}/{case}.html"'
```

It prints a line per case and output, with where a render first differs.

## The open questions it makes concrete

Each is a place where implementations are known to differ, or may. A case turns
the question into a diff.

- **XPath reach.** `params` uses value comparisons, positions and conditionals;
  the preview lacked value comparisons until it ran this case.
- **What `@output` means.** `outputs` lays a view over the page, which OPM and TEI
  Publisher do not; `behaviours` shows how an ODD can carry a model per engine.
- **An element with no model.** Its content passes through here; the preview
  reports it and renders a span.
- **`modelGrp`.** Flattened here, reported to be chosen as a unit by TEI Publisher
  and OPM; `groups` is where that would show.
- **Nested models.** `compound` (Boot 2024) is an extension here and not a case;
  whether it belongs in a shared suite is itself a question.
- **`pb:template`.** In a template of text, TEI Publisher fills in a param's
  string, this compiler its rendered nodes.
