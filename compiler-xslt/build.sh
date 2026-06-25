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

echo "② render    rendered-xslt.html  ← $TEI (static, zero-JS)"
saxon -s:"$TEI" -xsl:output/edition.xsl -o:output/rendered-xslt.html

echo "② render    rendered-xslt-interactive.html  ← $TEI (progressively enhanced)"
saxon -s:"$TEI" -xsl:output/edition.xsl -o:output/rendered-xslt-interactive.html interactive=true

echo "done — output/{edition.xsl, edition.css, rendered-xslt.html, rendered-xslt-interactive.html}"
