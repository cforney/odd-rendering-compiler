#!/usr/bin/env bash
# Build the XSLT reference implementation end to end with Saxon.
#
#   GENERATE (the XSLT way):  ODD --odd-to-xsl.xsl--> edition.xsl
#                             ODD --odd-to-css.xsl--> edition.css
#   RENDER:                   edition.xsl(TEI)     --> rendered HTML
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

ODD="${1:-../examples/tei_simler.odd}"
TEI="${2:-../examples/simler-poem.xml}"
mkdir -p output

echo "① generate  edition.xsl  ← $ODD"
saxon -s:"$ODD" -xsl:generate/odd-to-xsl.xsl -o:output/edition.xsl

echo "① generate  edition.css  ← $ODD"
saxon -s:"$ODD" -xsl:generate/odd-to-css.xsl -o:output/edition.css

echo "① generate  tei-ceteicean-behaviours.js + rendered-ceteicean.html  ← $ODD"
saxon -s:"$ODD" -xsl:generate/odd-to-ceteicean.xsl -o:output/tei-ceteicean-behaviours.js tei="$(basename "$TEI")"

echo "② render    rendered-xslt.html  ← $TEI (static, zero-JS)"
saxon -s:"$TEI" -xsl:output/edition.xsl -o:output/rendered-xslt.html

echo "② render    rendered-xslt-interactive.html  ← $TEI (progressively enhanced)"
saxon -s:"$TEI" -xsl:output/edition.xsl -o:output/rendered-xslt-interactive.html interactive=true

# Corpus → output/edition-interactive/: one interactive page per source plus a
# linking index.html, mirroring the JS render:multi output. The corpus is every
# simler-*.xml next to $TEI (the glob expands alphabetically, as the JS glob does).
TEI_DIR="$(dirname "$TEI")"
echo "③ corpus    output/edition-interactive/  ← $TEI_DIR/simler-*.xml"
mkdir -p output/edition-interactive
NAMES=""
COUNT=0
for f in "$TEI_DIR"/simler-*.xml; do
  base="$(basename "$f" .xml)"
  saxon -s:"$f" -xsl:output/edition.xsl -o:"output/edition-interactive/$base.html" interactive=true
  NAMES="${NAMES:+$NAMES|}$(basename "$f")"
  COUNT=$((COUNT + 1))
done
saxon -s:"$ODD" -xsl:generate/generate-index.xsl -o:output/edition-interactive/index.html \
  files="$NAMES" \
  title="TEI Edition — XSLT (progressively enhanced)" \
  subtitle="$COUNT documents · prebuilt HTML, ~12 lines of vanilla JS, degrades to zero-JS"

# ④ SaxonJS (client side): the SAME edition.xsl, compiled to a Stylesheet Export
#    File (SEF) and run in the browser — completing the template-matching axis on
#    the client. The SEF compiler is xslt3 (SaxonJS, Node): Saxon HE cannot emit a
#    SaxonJS-runnable SEF, and only xslt3 understands the IXSL toggle templates.
#    render-saxonjs.xsl imports edition.xsl and adds the IXSL handlers; the runtime
#    is self-hosted next to the page so the demo works offline.
if command -v npx >/dev/null 2>&1; then
  echo "④ saxonjs   edition-saxonjs.sef.json (IXSL) + rendered-saxonjs.html  ← edition.xsl"
  npx --yes xslt3 -xsl:generate/render-saxonjs.xsl -export:output/edition-saxonjs.sef.json -nogo
  saxon -s:"$ODD" -xsl:generate/generate-saxonjs-page.xsl -o:output/rendered-saxonjs.html \
    tei="$(basename "$TEI")"
  cp "$TEI" "output/$(basename "$TEI")"   # the page fetches the TEI at view time
  RT="output/SaxonJS2.rt.js"              # SaxonJS 2 runtime, matching xslt3 2.7
  if [ ! -f "$RT" ]; then
    curl -fsSL "https://www.saxonica.com/saxon-js/documentation2/SaxonJS/SaxonJS2.rt.js" -o "$RT" \
      || echo "  ⚠ could not fetch SaxonJS2.rt.js — drop it next to rendered-saxonjs.html to view"
  fi
  [ -s output/edition-saxonjs.sef.json ] || { echo "SEF was not produced" >&2; exit 1; }
else
  echo "④ saxonjs   skipped (Node/npx not found — needed to compile the SEF with xslt3)"
fi

echo "done — output/{edition.xsl, edition.css, rendered-xslt.html, rendered-xslt-interactive.html, tei-ceteicean-behaviours.js, rendered-ceteicean.html, edition-interactive/, rendered-saxonjs.html + edition-saxonjs.sef.json}"
