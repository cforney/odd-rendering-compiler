#!/usr/bin/env bash
# Build the XSLT reference implementation end to end with Saxon.
#
#   GENERATE (the XSLT way):  ODD --odd-to-xsl.xsl--> edition.xsl
#                             ODD --odd-to-css.xsl--> edition.css
#   RENDER:                   edition.xsl(TEI)     --> one HTML page per TEI file
#
#   bash build.sh [ODD [TEI…]]
# With no arguments, the Simler ODD and every ../examples/simler-*.xml. TOKENS
# names the design tokens for edition.css, relative to the ODD (default
# simler-tokens.css; set it empty for none).
#
# Saxon HE 12 is located via $SAXON_HOME — point it at your unpacked SaxonHE12
# directory (containing saxon-he-12*.jar and lib/xmlresolver-*.jar). Download it
# from https://www.saxonica.com/download/java.xml (or Maven Central):
#   SAXON_HOME=/path/to/SaxonHE12-9J bash build.sh
# With no SAXON_HOME set, ./vendor/SaxonHE12-9J is tried.
set -euo pipefail
cd "$(dirname "$0")"

# Java classpath separator: ';' on Windows (incl. git-bash, which calls the
# native java.exe), ':' on Linux/macOS.
case "$(uname -s)" in
  CYGWIN*|MINGW*|MSYS*) SEP=';' ;;
  *) SEP=':' ;;
esac

SAXON_HOME="${SAXON_HOME:-./vendor/SaxonHE12-9J}"
SAXON_JAR="$(ls "$SAXON_HOME"/saxon-he-12*.jar 2>/dev/null | grep -v test | grep -v xqj | head -1 || true)"
RESOLVER="$(ls "$SAXON_HOME"/lib/xmlresolver-*.jar 2>/dev/null | tr '\n' "$SEP" || true)"
[ -n "$SAXON_JAR" ] || {
  echo "Saxon HE 12 not found under SAXON_HOME=$SAXON_HOME" >&2
  echo "  Set SAXON_HOME to your unpacked SaxonHE12 dir, e.g.:" >&2
  echo "    SAXON_HOME=/path/to/SaxonHE12-9J bash build.sh" >&2
  echo "  Download: https://www.saxonica.com/download/java.xml" >&2
  exit 1
}
CP="$SAXON_JAR$SEP$RESOLVER"
saxon() { java -cp "$CP" net.sf.saxon.Transform "$@"; }

ODD="${1:-../examples/tei_simler-render.odd}"
[ $# -gt 0 ] && shift
shopt -s nullglob
TEIS=("$@")
[ ${#TEIS[@]} -gt 0 ] || TEIS=(../examples/simler-*.xml)
TOKENS="${TOKENS-simler-tokens.css}"
NAMES=()
for f in "${TEIS[@]}"; do NAMES+=("$(basename "$f")"); done
mkdir -p output/xslt output/xslt-script output/xslt-islands output/ceteicean

echo "① generate  edition.xsl  ← $ODD"
saxon -s:"$ODD" -xsl:generate/odd-to-xsl.xsl -o:output/edition.xsl
cp ../runtime/readings.js ../runtime/notes.js ../runtime/facsimile.js output/   # which an enhanced page inlines

echo "① generate  edition.css  ← $ODD${TOKENS:+ + $TOKENS}"
saxon -s:"$ODD" -xsl:generate/odd-to-css.xsl -o:output/edition.css ${TOKENS:+tokens="$TOKENS"}
for dir in xslt xslt-script xslt-islands; do cp output/edition.css "output/$dir/"; done
cp ../runtime/tei-islands.js ../runtime/readings.js ../runtime/facsimile.js output/xslt-islands/
cp output/edition.css output/ceteicean/

echo "① generate  ceteicean/ (behaviours + a page per TEI file)  ← $ODD"
saxon -s:"$ODD" -xsl:generate/odd-to-ceteicean.xsl -o:output/ceteicean/tei-ceteicean-behaviours.js tei="${NAMES[*]}"

# Each TEI file: a static page (zero-JS) and the same page with each enhancer, plus
# an index of the enhanced pages, as the JS renderers write them.
echo "② render    xslt/, xslt-script/, xslt-islands/  ← ${#TEIS[@]} TEI file(s)"
for f in "${TEIS[@]}"; do
  base="$(basename "$f" .xml)"
  saxon -s:"$f" -xsl:output/edition.xsl -o:"output/xslt/$base.html"
  saxon -s:"$f" -xsl:output/edition.xsl -o:"output/xslt-script/$base.html" enhance=script
  saxon -s:"$f" -xsl:output/edition.xsl -o:"output/xslt-islands/$base.html" enhance=islands
done
for enhancer in script islands; do
  saxon -s:"${TEIS[0]}" -xsl:generate/generate-index.xsl -o:"output/xslt-$enhancer/index.html" \
    files="$(IFS='|'; echo "${NAMES[*]}")" \
    title="TEI Edition — XSLT + $enhancer" \
    subtitle="${#TEIS[@]} documents · prebuilt HTML, degrades to zero-JS"
done

# ③ SaxonJS (client side): the SAME edition.xsl, compiled to a Stylesheet Export
#    File (SEF) and run in the browser — completing the template-matching axis on
#    the client. The SEF compiler is xslt3 (SaxonJS, Node): Saxon HE cannot emit a
#    SaxonJS-runnable SEF, and only xslt3 understands the IXSL toggle templates.
#    render-saxonjs.xsl imports edition.xsl and adds the IXSL handlers; the runtime
#    is self-hosted next to the pages so the demo works offline.
if command -v npx >/dev/null 2>&1; then
  echo "③ saxonjs   edition-saxonjs.sef.json (IXSL) + saxonjs/  ← edition.xsl"
  npx --yes xslt3 -xsl:generate/render-saxonjs.xsl -export:output/edition-saxonjs.sef.json -nogo
  [ -s output/edition-saxonjs.sef.json ] || { echo "SEF was not produced" >&2; exit 1; }
  mkdir -p output/saxonjs
  for f in "${TEIS[@]}"; do
    base="$(basename "$f" .xml)"
    cp "$f" output/saxonjs/   # each page fetches its TEI at view time
    saxon -s:"$ODD" -xsl:generate/generate-saxonjs-page.xsl -o:"output/saxonjs/$base.html" \
      tei="$base.xml" sef=../edition-saxonjs.sef.json runtime=../SaxonJS2.rt.js css=../edition.css notes=../notes.js facsimile=../facsimile.js
  done
  RT="output/SaxonJS2.rt.js"              # SaxonJS 2 runtime, matching xslt3 2.7
  if [ ! -f "$RT" ]; then
    curl -fsSL "https://www.saxonica.com/saxon-js/documentation2/SaxonJS/SaxonJS2.rt.js" -o "$RT" \
      || echo "  ⚠ could not fetch SaxonJS2.rt.js — drop it into output/ to view the saxonjs/ pages"
  fi
else
  echo "③ saxonjs   skipped (Node/npx not found — needed to compile the SEF with xslt3)"
fi

echo "done — output/{edition.xsl, edition.css, xslt/, xslt-script/, xslt-islands/, ceteicean/, saxonjs/ + edition-saxonjs.sef.json}"
