# Predicate grammar

A Processing-Model `@predicate` decides *when* a `<model>` applies: an element
takes the first of its models, in document order, whose predicate holds. Params
(`<param value>`) are XPath too. How far each target reads them:

## XSLT — `odd-to-xslt.mjs`, `odd-to-xsl.xsl`

Any XPath 3.1. Both generators copy predicates and params verbatim into the
generated XSLT 3.0 stylesheet, where the XSLT processor evaluates them. The
stylesheet sets `xpath-default-namespace` to TEI's, so the ODD's unprefixed
names are TEI elements. A prefix the ODD binds in the expression's scope is
resolved when the ODD is read: to `Q{uri}local`, or to the unprefixed name for
TEI's namespace. So the generated stylesheet needs no namespace declaration for it.

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
- **Names:** unprefixed or `tei:` for TEI's namespace; `Q{uri}local` for another
  (what a prefix the ODD binds becomes). Outside the subset: a prefix the ODD
  does not bind, `x:*`, `*:name` and `namespace-uri()`.
- **Operators:** `or`, `and`, the general comparisons (`= != < <= > >=`), the
  value comparisons (`eq ne lt le gt ge`), `+ -`, `mod`,
  `if (…) then … else …`, and sequences `(a, b)`.
- **Functions:** `position`, `last`, `count`, `not`, `exists`, `empty`,
  `string`, `concat`, `contains`, `contains-token`, `starts-with`, `ends-with`,
  `matches`, `replace`, `translate`, `normalize-space`, `string-length`,
  `local-name`, `true`, `false`.

What it accepts follows XPath 3.1: a path gives each node once, in document
order; a general comparison is numeric only against a number; a value comparison
with more than one item on a side is an error when evaluated, as is a call with
the wrong number of arguments when compiled. Two known differences: regular
expressions are JavaScript's, and `@n eq 1` compares numerically where XPath
raises a type error.

`odd-to-unified.mjs` and `odd-to-ceteicean.mjs` compile every expression once.
A CETEIcean page compiles them again when it loads.

### Outside the subset: degrade, don't fail

An expression the subset cannot evaluate — an eXist function, an XQuery `let`
chain, a union — is compiled to what a failing evaluation would have returned
anyway: `false()` for a predicate, so the model never fires and the next one
decides, and the empty sequence for a param. Someone else's ODD therefore runs
here, degraded where it has to be, instead of being rejected.

What was degraded is recorded, never silent: each generator writes
`odd-unsupported.json` beside what it generates —

```json
{ "element": "p", "model": "p-1", "where": "predicate", "expression": "@a | @b",
  "reason": "unexpected \"|\"", "odd": "bad.odd", "line": 3 }
```

— prints the count in the build log, and `findings.mjs` lists the entries with
the rest of what the ODD does not foresee.

`--strict` fails the build instead, naming the element, the model and the line.
Our own ODDs are compiled with it (see `package.json`), so a regression in them
stays a build error.

## CSS

The CSS needs no predicates: the renderers put the selected model's classes on
the element, and `edition.css` styles those classes.
