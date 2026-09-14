# Comparison demo

One static page that frames the outputs both compilers already build, so a visitor
can pick an example, switch rendering paths, turn JavaScript off, and see the
generated artefact and its cost next to each result. Nothing is re-rendered here — the page only frames
existing files.

## Build it

Build each compiler's outputs first, then assemble:

```bash
# 1 · the unified + CETEIcean pages and their artefacts
cd compiler-js
npm install
npm run build:all && npm run render:unified && npm run render:interactive && npm run render:islands

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

## Files

| File | Role |
|------|------|
| `manifest.mjs` | the rendering paths and the examples the demo frames — the source of truth |
| `build-demo.mjs` | copies both outputs, measures metrics, writes `site/index.html` |
| `shell.css` · `shell.js` | the static, framework-free demo chrome |
| `site/` | the assembled site (gitignored; published by CI) |

Add a path or an example to `manifest.mjs` and rebuild — a new tab or a new
entry in the document list appears, no other change.

## Publishing

`.github/workflows/pages.yml` builds both compilers, runs `build-demo`, and deploys
`site/` to GitHub Pages on every push to `main`. Enable Pages once in the
repository settings (Settings → Pages → Source: GitHub Actions).
