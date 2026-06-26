# ODD Rendering Compiler

Companion code for the *Code4Lib Journal* article **The TEI ODD as Static-Build
Configuration: Compiling the Processing Model into Edition Rendering** (Christian
Forney, 2026).

A TEI ODD's **Processing Model** already says how each element should be
presented. This project treats that declaration as **build-time configuration**:
a compiler reads the ODD and *generates* the rendering artefacts — CSS, an XSLT
stylesheet, unified/xast handlers, CETEIcean behaviours — which then *render* a
TEI document into static HTML. No server, no runtime ODD interpreter; just a
clean clone that builds.

> **define → generate → render.** The ODD is the single source of truth
> (*define*); a build tool compiles its behaviours into rendering artefacts
> (*generate*); those artefacts turn TEI into a static edition (*render*).

The chain is implemented **twice — in JavaScript and in XSLT** — on purpose: the
*generate* step is generic, not tied to one language, and the two implementations
produce a byte-identical static body. That equivalence is itself part of the
article's argument.

> **Note.** This is an illustrative reference implementation: it exists to make
> the *define → generate → render* idea concrete and reproduce the article, not
> as production code.

## What's here

| Directory | What it is |
|-----------|------------|
| [`compiler-js/`](compiler-js/) | JavaScript reference implementation (generators, renderers, shared ODD parser, smoke tests) |
| [`compiler-xslt/`](compiler-xslt/) | XSLT reference implementation (the same chain, built entirely in XSLT + Saxon) |
| [`examples/`](examples/) | Shared inputs for both compilers — the real **Simler** edition and the TEI's **simplePrint** exemplar — with provenance and credits |

## Quick start — JavaScript

Requires **Node.js ≥ 20**.

```bash
cd compiler-js
npm install
npm run demo    # compile the Simler ODD, then render → static + interactive HTML
npm test        # end-to-end smoke tests
```

Generated artefacts and rendered pages land in `compiler-js/output/`. See
[`compiler-js/README.md`](compiler-js/README.md) for every generator and renderer.

## Quick start — XSLT

Requires **Java** and **Saxon HE 12**. Point `SAXON_HOME` at your unpacked Saxon
HE 12 directory (download it from
<https://www.saxonica.com/download/java.xml>), then:

```bash
cd compiler-xslt
bash build.sh     # default: the Simler edition
# or, on Windows:
./build.ps1
```

Outputs land in `compiler-xslt/output/`. With Node present the build also emits a
**client-side SaxonJS** demo (`rendered-saxonjs.html`): the same `edition.xsl`,
compiled to a SEF and run in the browser with IXSL toggles — serve it over HTTP
(e.g. `npx http-server compiler-xslt/output`). See
[`compiler-xslt/README.md`](compiler-xslt/README.md) for details.

## Examples, licensing, and credits

- The **code** is licensed **BSD-2-Clause** (see [`LICENSE`](LICENSE)).
- The **example texts** in [`examples/`](examples/) are **not** covered by it —
  they keep their originating projects' terms and are included only as
  illustration. See [`examples/README.md`](examples/README.md) for provenance and
  credits (Simler Digital / e-rara, CC BY-SA; the TEI Consortium's simplePrint
  exemplar).

## How to cite

See [`CITATION.cff`](CITATION.cff).
