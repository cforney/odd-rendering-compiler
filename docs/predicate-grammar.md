# Predicate grammar

A Processing-Model `@predicate` decides *when* a `<model>` applies: an element
takes the first of its models, in document order, whose predicate holds. Params
(`<param value>`) are XPath too. How far each target reads them:

## XSLT — `odd-to-xslt.mjs`, `odd-to-xsl.xsl`

Any XPath 3.1. Both generators copy predicates and params verbatim into the
generated XSLT 3.0 stylesheet, where the XSLT processor evaluates them. The
stylesheet sets `xpath-default-namespace` to TEI's, so the ODD's unprefixed
names are TEI elements.

## unified / xast — `odd-to-unified.mjs`

A subset of XPath, implemented in [`compiler-js/xpath.mjs`](../compiler-js/xpath.mjs)
and shipped beside the generated handlers, which evaluate predicates and params
with it:

- **Paths:** `.`, `..`, `@name`, `name`, `*`, `node()`, `text()`, `/`, `//`,
  absolute paths, and `[predicate]` (a number is a position).
- **Axes:** `self`, `child`, `parent`, `ancestor`, `ancestor-or-self`,
  `descendant`, `descendant-or-self`, `preceding-sibling`, `following-sibling`,
  `preceding`, `following`.
- **Operators:** `or`, `and`, the general comparisons (`= != < <= > >=`), the
  value comparisons (`eq ne lt le gt ge`), `+ -`, `mod`,
  `if (…) then … else …`, and sequences `(a, b)`.
- **Functions:** `position`, `last`, `count`, `not`, `exists`, `empty`,
  `string`, `concat`, `contains`, `contains-token`, `starts-with`, `ends-with`,
  `matches`, `replace`, `translate`, `normalize-space`, `string-length`,
  `local-name`, `true`, `false`.

The generator compiles every expression once. XPath outside the subset fails
the build and names the element and the model, e.g. `<p>, model 2: XPath
"@a | @b": unexpected "|"`.

## CETEIcean — `odd-to-ceteicean.mjs`, `odd-to-ceteicean.xsl`

The CETEIcean tier is a subset of the Processing Model, checked in the browser
on custom elements. It supports:

- **Predicates**, as CSS selectors on the custom element (`el.matches()`):
  `@a` → `[a]`, `@a='v'` → `[a="v"]`, `parent::X` → `:is(tei-x, .tei-X) > *`,
  `ancestor::X` → `:is(tei-x, .tei-X) *`.
- **Params:** a literal, `@a`, or `count(ancestor::X)` plus a number.

A model outside this subset is left out, with a build-time warning; so are
models with `@output` and sequences.

## CSS

The CSS needs no predicates: the renderers put the selected model's classes on
the element, and `edition.css` styles those classes.
