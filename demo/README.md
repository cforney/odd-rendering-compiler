# Comparison demo

One static page that frames the outputs both compilers already build, so a visitor
can pick an example, switch rendering paths, turn JavaScript off, and see the
generated artefact and its cost next to each result. The frame shows the edition
alone: `build-demo` moves the banner each renderer puts on its page into *How it
works* in the side panel, under a line saying what the path is for. *Inspect the
text* picks any rendered element, on any path, and shows its TEI, the ODD's model
that produced it, its params and the models it was chosen among. The build records
this from the handlers' own trace (`inspect/<example>.json`); the renderings have
the same elements in the same order, which is how a record is found, and the
element's class must agree. The reports in the second row show what
else the build writes for the example: its findings, what the ODD does not
foresee in the encoding (the XPath it degraded included), its plain text with
the Pagefind records beside it, its JSON records, every element naming the
model the ODD chose for it, and the corpus coverage those records give — one
report for all the examples, so the tab shows the same page whichever is picked; and a Pagefind search over the
plain text, whose results open in the prebuilt rendering. On the interactive paths a
click on a page break opens that page's image.
Nothing is re-rendered here: apart from the banner, the page only frames existing files.

## Build it

Build each compiler's outputs first, then assemble:

```bash
# 1 · the unified + CETEIcean pages and their artefacts, the plain text, the findings
cd compiler-js
npm install
npm run build:all && npm run render:unified && npm run render:script && npm run render:islands && npm run render:petite-vue
npm run render:plain && npm run render:search && npm run render:json && npm run coverage && npm run findings

# 2 · the XSLT pages (static, progressively enhanced, in-browser SaxonJS)
cd ../compiler-xslt
bash build.sh            # needs Java + Saxon HE 12 (SAXON_HOME)

# 3 · assemble demo/site/
cd ../compiler-js
npm run build:demo       # or: node ../demo/build-demo.mjs
```

Every path renders every example into a directory of its own, one `<example>.html`
each. `build-demo` skips any path whose pages are missing, and any example no path
rendered, so a JS-only build still produces a (smaller) demo.

## Serve it

```bash
npx http-server demo/site      # then open the printed URL
```

Serve over HTTP, not `file://` — the in-browser SaxonJS tab fetches its stylesheet
and source at view time.

## Check it

```bash
cd compiler-js
npm run check:demo       # needs Chrome (CHROME names it) and network for the CDN scripts
```

`check-demo.mjs` opens every rendering of every example in headless Chrome, as it
opens, with the views on, and without JavaScript. The visible text and each text
run's place, font and colour must equal the first rendering's, and the pixels
nearly so. It also holds the manifest's claims to the pages (`interactive`,
`needsJs`) and the inspector's records to the elements rendered, opens a page image
on each path against a stored copy of the IIIF manifest, and runs the search. It writes
`site/verified.json`, which the comparison table reads, and exits 1 on a difference.
CI runs it; a demo built without it says "Not checked" there.

The table's bars share one scale, so a page and a script can be compared. `build-demo`
fetches each CDN script to weigh it; without network it stays a name, and out of the bar.

## Using it

The tabs choose who builds the page; *Interaction* chooses how a prebuilt page is
enhanced, and stays chosen across tabs. Each combination has its own entry in the URL,
in `verified.json` and in the comparison table, which nests them by builder, and whose sizes count a linked stylesheet
as part of the page, as an inlined one is. The URL holds the document, rendering, views, JavaScript setting and picked element,
so a state can be shared. The views are switched from the panel for every rendering
at once: the pages' own switches are hidden here, and work as ever elsewhere. A link
to another site (a dictionary, an authority file) opens in a new tab, as most such
sites refuse to be framed; on the pages themselves it is an ordinary link.

## Files

| File | Role |
|------|------|
| `manifest.mjs` | the rendering paths and the examples the demo frames — the source of truth |
| `build-demo.mjs` | copies both outputs, measures metrics, writes `site/index.html` |
| `check-demo.mjs` | checks in a browser that the renderings show the same edition |
| `shell.css` · `shell.js` | the static, framework-free demo chrome |
| `site/inspect/` | what decided each element, per example, for the inspector |
| `site/` | the assembled site (gitignored; published by CI) |

Add a path or an example to `manifest.mjs` and rebuild — a new tab or a new
entry in the document list appears, no other change.

## Publishing

`.github/workflows/pages.yml` builds both compilers, runs `build-demo`, and deploys
`site/` to GitHub Pages on every push to `main`. Enable Pages once in the
repository settings (Settings → Pages → Source: GitHub Actions).
