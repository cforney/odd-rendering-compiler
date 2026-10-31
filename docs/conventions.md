# Conventions

The TEI Processing Model leaves some things open: what an `@output` value means,
what becomes of a param no behaviour defines, which classes the HTML carries.
This compiler fills those gaps with the conventions below. None of them is TEI.
They are declared here so that an ODD written for this compiler still reads
correctly to another tool, and so that another tool can adopt them.

Each one says what a tool that does not know it does with the ODD. The ODD stays
valid TEI either way. A tool that knows none of these conventions renders the
models without `@output`, which is why nothing the text needs should be hidden
in a view.

## Outputs

A render renders one output, `web` unless told otherwise. An element takes the
first model of that output whose predicate holds, else the first model without
`@output`. Three output names are fixed:

| Output | Meaning here | Elsewhere |
|---|---|---|
| `web` | the page | TEI Publisher and OPM render it too |
| `page` | what the page shows around the text: the params of the root's model, such as `title`, `manifest` and `pages` | an unknown output, skipped |
| `plain` | the search text, rendered by `render-plain.mjs` | known to OPM too |

**Views.** Every other output is a view laid over the `web` page, not a render of
its own. It gets a checkbox `<input id="view-<view>">`, labelled by the first
`<desc>` among its models. For each element, the view's first model whose
predicate holds adds to the page: an `omit` becomes the class `<view>-omit`, a
model of the same behaviour adds its classes, and an `alternate`'s readings are
marked `<view>-default` and `<view>-alternate`. The CSS applies the view where
`:is([data-<view>='on'], :root:has(#view-<view>:checked))` holds, so a view
switches without JavaScript. A tool that does not know views skips these models
and renders the page without them.

## Engine prefixes on `@output`

One ODD can carry a model for one engine beside a model for the others. The
engine's prefix goes on `@output`, an idea taken from OPM:

- **`orc-`** marks this compiler's own models. `orc-web` is `web` here, and
  `orc-normalized` is the view `normalized`; any other tool sees an output it
  does not know, and skips the model.
- **`opm-`** marks OPM's. Such a model is never rendered here, and its output is
  not a view.

Write the engine's model first: here `orc-web` and `web` are the same output, and
the first model whose predicate holds wins.

```xml
<model output="orc-web" behaviour="inline" cssClass="emph-here"/>  <!-- this compiler -->
<model output="web" behaviour="block"/>                             <!-- TEI Publisher, OPM -->
```

## Params

- **`--name`** becomes the CSS custom property `--name` in the element's `style`:
  `<param name="--indent" value="1"/>` gives `style="--indent: 1"`.
- **`data-name`** becomes the attribute `data-name`.
- **`content`** replaces the element's content, for every behaviour that renders
  content.

The first two are ours: to a behaviour elsewhere, a param it does not define
means nothing.

## Classes

Every renderer stamps the same classes, so one `edition.css` styles every tier:

- `tei-<ident>` on what every element renders;
- the model's classes: its `@cssClass`; for a model with `<outputRendition>`
  and no `@cssClass`, `<ident>-<n>`, the n-th `<model>` of its spec, unless it
  is the spec's only, unconditioned model; and `<ident>-group` (`-group2`, …)
  for the models of a group that is not the spec's only entry;
- `r-<id>` for each `@rendition` pointer, where the model sets
  `@useSourceRendition`;
- `pm-block` on a block that must render as a `<span>` inside phrasing content.

The CSS of `<outputRendition>` is compiled onto the same classes.

## Rendering choices the Processing Model does not make

- **Notes.** A note whose `place` is `end` or `foot` gets a numbered marker, its
  body collected in a `tei-footnotes` section; a note elsewhere is collected in
  `section.tei-notes[data-place]`, without a marker. A note's `xml:id` goes on its
  marker, or without one on its body, so links into the source keep a target.
- **Line breaks.** A `break` of type `line` where a line already starts renders
  nothing. At an `lb break="no"`, the hyphen that ends the line's text and the
  spaces around the break go; the break's model sets the hyphen.
- **Whitespace.** Whitespace-only text at the edge of a block, or next to one, is
  indentation and is dropped. Other whitespace collapses, unless the nearest
  `xml:space` says `preserve`.

## Extensions

Each is labelled as an extension wherever it is used; see
[behaviour-table.md](behaviour-table.md).

- **`compound`:** a `<model>` holding a `<modelSequence>` (Boot 2024). Not TEI,
  and no other tool reads it.
- **`pass-through`** and **`<pb:template>`:** TEI Publisher's, with its semantics
  but for one difference noted in the behaviour table.

## Not a convention, but a difference

A `<modelGrp>` is flattened here: a model after a group is a fallback. TEI
Publisher, OPM and the Simler preview choose the group as a unit. See
[ALIGNMENT.md](../ALIGNMENT.md) D8.
