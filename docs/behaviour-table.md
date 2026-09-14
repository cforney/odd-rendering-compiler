# Behaviour table

A Processing-Model `@behaviour` says how an element is presented. One shared file,
[`behaviour-map.json`](../behaviour-map.json), gives each behaviour its HTML
element (`tag`, for behaviours that only wrap their content) and its flow (block
or inline). Both compilers read it when they generate. The behaviours themselves
are implemented once per runtime: [`runtime/pm-runtime.mjs`](../runtime/pm-runtime.mjs)
for the unified handlers and [`runtime/pm.xsl`](../runtime/pm.xsl) for the
generated stylesheets, and the two render the same HTML. The CETEIcean tier
chooses models by `pm-runtime.mjs` in the browser and renders the same HTML
with [`runtime/ceteicean.js`](../runtime/ceteicean.js).

| Behaviour | HTML | Flow | Params |
|-----------|------|------|--------|
| document | `<article>` | block | |
| body, block | `<div>` | block | |
| section | `<section>` | block | |
| paragraph | `<p>` | block | |
| heading | `<h1>`–`<h6>` | block | `level` |
| list / listItem | `<ul>` / `<li>` | block | |
| cit | `<blockquote>` | block | |
| table / row / cell | `<table>` / `<tr>` / `<td>` | block | |
| inline, title, glyph | `<span>` | inline | |
| text | the content, no element | block | |
| alternate | `<span>` holding both readings, the second hidden | inline | `default`, `alternate` (else the first and second child element) |
| note | a numbered marker; the body collected at the end | inline | `place` (`end` or `foot` numbered, any other collected without a marker), `range` |
| break | `<br>`, or its label then `<br>` | inline | `type` (a `line` break where a line starts is dropped), `label` |
| anchor | an empty `<span>` with the element's id | inline | |
| link | `<a href>` | inline | `uri` |
| graphic | `<img src>` | inline | `url` |
| index | a table of contents of the headings within | block | |
| metadata, omit | nothing | — | |
| compound | its parts, a `link` part wrapping the others | from the parts | an extension, see below |

**For every behaviour:**

- **Classes:** the element's HTML carries `tei-<ident>`, the model's classes (see
  below), and `r-<id>` for each `@rendition` pointer where the model sets
  `@useSourceRendition`.
- **Params:** `content` replaces the element's content. A param's nodes are
  rendered by their own models (the element itself by its content), anything
  else as text. Params named `data-…` become attributes, and params named with a
  leading `--` become CSS custom properties.
- **Phrasing:** a block inside phrasing content (`p`, `span`, `a`, headings)
  becomes a `<span class="pm-block">`.

**Classes and CSS.** A spec's only model is styled by `.tei-<ident>`. Otherwise
a model group is styled by `.<ident>-group`, and a model by its first
`@cssClass`, or by `<ident>-<n>` (the n-th `<model>` of the spec) without one.
Its `<outputRendition>` becomes that rule in `edition.css`, and `@scope`
becomes `::before`/`::after`.

**Model groups.** A `<modelGrp>` is flattened: its models keep their place in
document order, and take `@output` and `@useSourceRendition` from the group
unless they set their own.

**Sequences.** A `<modelSequence>` renders each of its models whose predicate
holds, and the element's id goes on the first.

**Outputs.** A render renders one output, `web` unless told otherwise
(`--output`, or the stylesheet param `output`). Each element takes the first
model of that output whose predicate holds, else the first model without
`@output`; models of other outputs are skipped. The Simler ODD's views,
`normalized` (the reading text) and `entities`, are outputs in this sense: the
renderers render each as a page of its own, not yet as a switch over one page.

**Joined line ends.** The text is rendered as encoded, with one exception that
lets a `break` model set the hyphen of a word the print divides: at an
`lb break="no"`, a hyphen that ends the line's text and the spaces around the
break are dropped. The line's text is found across inline elements, not across
a block.

**Compound (Boot 2024), an extension.** A `<model>` that holds a
`<modelSequence>` is not TEI. The PoC renders it as its parts, with a `link` part
wrapping the others, for the example in
[`examples/extensions/nested-pb/`](../examples/extensions/nested-pb/).
