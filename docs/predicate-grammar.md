# Predicate grammar

A Processing-Model `@predicate` decides *when* a `<model>` applies: an element
takes the first of its models, in document order, whose predicate holds. Params
(`<param value>`) are XPath too. How far each target reads them:

## XSLT — `odd-to-xslt.mjs`, `odd-to-xsl.xsl`

Any XPath 3.1. Both generators copy predicates and params verbatim into the
generated XSLT 3.0 stylesheet, where the XSLT processor evaluates them. The
stylesheet sets `xpath-default-namespace` to TEI's, so the ODD's unprefixed
names are TEI elements.

## unified / xast and CETEIcean — `odd-to-unified.mjs`, `odd-to-ceteicean.mjs`, `odd-to-ceteicean.xsl`

A subset of XPath, implemented in [`runtime/xpath.mjs`](../runtime/xpath.mjs).
It ships beside the generated handlers, which evaluate predicates and params
with it, and is inlined in the CETEIcean pages, which evaluate them in the
browser:

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

`odd-to-unified.mjs` compiles every expression once. XPath outside the subset
fails the build and names the element and the model, e.g. `<p>, model 2: XPath
"@a | @b": unexpected "|"`. A CETEIcean page compiles them when it loads.

## CSS

The CSS needs no predicates: the renderers put the selected model's classes on
the element, and `edition.css` styles those classes.
