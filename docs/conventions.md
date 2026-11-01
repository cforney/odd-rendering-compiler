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
`@output`. These output names are fixed:

| Output | Meaning here | Elsewhere |
|---|---|---|
| `web` | the page | TEI Publisher and OPM render it too |
| `page` | what the page shows around the text: the params of the root's model, such as `title`, `manifest` and `pages` | an unknown output, skipped |
| `plain` | the search text, rendered by `render-plain.mjs` | known to OPM too |
| `plaintext`, `print`, `fo`, `latex`, `epub`, `pdf` | a channel: renders alone, with `--output`, and is never a view | other tools' outputs |

**Views.** Every other output is a view laid over the `web` page, not a render of
its own, so another tool's output with an unlisted name becomes a switch; give it
an engine's prefix to keep it apart. A view gets a checkbox
`<input data-view="<view>">`, labelled by the first
`<desc>` among its models. For each element, the view's first model whose
predicate holds adds to the page: an `omit` becomes the class `<view>-omit`, a
model of the same behaviour adds its classes, and an `alternate`'s readings are
marked `<view>-default` and `<view>-alternate`. The CSS applies the view where
`:is([data-<view>='on'], .tei-edition:has(> .tei-views input[data-view='<view>']:checked))`
holds, so a view switches without JavaScript, and two editions on one page switch
apart. A view can only hide and add classes: a model of another behaviour, or one
changing the content, has no effect on the page, shows when that output renders
alone, and is diagnosed as `view-unrealized`. Views combine; none is exclusive of
another. A tool that does not know views skips these models
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

On page breaks, `data-page` names the page's image, and the root's model for output
`page` may name a `manifest`; see *Page images* below.

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

## What is read, and by which target

[capabilities.md](capabilities.md) has the matrix: model structure, namespaces,
XPath, ODD resolution and diagnostics, by target.

## Rendering choices the Processing Model does not make

- **Notes.** A note whose `place` is `end` or `foot` gets a numbered marker, its
  body collected in a `tei-footnotes` section; a note elsewhere is collected in
  `section.tei-notes[data-place]`, without a marker. A note's `xml:id` goes on its
  marker, or without one on its body, so links into the source keep a target.
- **Line breaks.** A `break` of type `line` where a line already starts renders
  nothing. Where a model has a param `join`, on any element and of any behaviour, the
  line joins: the spaces around it go, and a last character of the line's text that
  `join` names; the model sets the hyphen. Without `join`, no text changes.
- **Page metadata.** The params of the root's model for output `page`: `title` names the
  page, or else its file does, and `manifest` goes on the edition. An `index` lists
  what a model renders as `heading`. Findings read a note's range from a param `range`,
  and an anchor from the behaviour `anchor`.
- **Namespaces.** Names resolve by namespace, not by spelling, in the ODD and in
  the source. A model applies to TEI's element of its `@ident`, or with
  `elementSpec/@ns` to that namespace's, under the same class `tei-<ident>`. Any
  other element, in another namespace or in none, SVG and MathML included, has no
  model: its content passes through, and its markup is not copied. A document
  whose root is outside TEI's namespace takes no models, as in XSLT, and findings
  reports it. The CETEIcean tier applies TEI's models only, and warns of others.
- **Whitespace.** Whitespace-only text at the edge of a block, or next to one, is
  indentation and is dropped. Other whitespace collapses, unless the nearest
  `xml:space` says `preserve`.

- **Page images.** The param `manifest` of the root's model for output `page` goes
  on the edition as `data-manifest`, in every target. On an interactive page, an
  element with `data-page` opens its image, found in that IIIF manifest (Presentation
  2 or 3) by the end of a canvas, image or image service id; with no manifest, a
  `data-page` that is itself a URL is the image. A project with another scheme
  replaces `TeiFacsimile.resolve`. A static page keeps the plain marker.
- **Search.** `search-index.mjs` indexes the `plain` output, with text and query
  folded: compatibility forms and marks removed, `ß` as `ss`, so `selig` finds
  `ſelig`. An excerpt shows the folded text. The result is a document, not a place
  in it.

## What an enhancer may rely on

An enhancer adds scripts to a finished page, whichever renderer wrote it (`runtime/readings.js`,
`notes.js`, `facsimile.js`, `tei-islands.js`). A renderer gets them all by writing:

| Written | Means |
|---|---|
| `.tei-alternate` with `.tei-alternate-default` and `.tei-alternate-alt[hidden]` as children | two readings, the second hidden |
| `a.tei-note-ref[href^="#note-"]`, and the element it links to | a note and its marker |
| `[data-page]`, and `[data-manifest]` around it | a page's image, and where to find it |

## Extensions

Each is labelled as an extension wherever it is used; see
[behaviour-table.md](behaviour-table.md).

- **`compound`:** a `<model>` holding a `<modelSequence>` (Boot 2024). Not TEI,
  and no other tool reads it.
- **`pass-through`** and **`<pb:template>`:** TEI Publisher's, with its semantics
  but for one difference noted in the behaviour table.

## Not a convention, but a difference

A `<modelGrp>` is flattened here: a model after a group is a fallback, and the
conformance case `groups` pins it. TEI Publisher, OPM and the Simler preview are
reported to choose the group as a unit, which has not been run against pinned
versions, so selection stays as it is until it has. The boundary is kept as the
model's `group`, and a model that depends on flattening is diagnosed as
`group-fallback`.
