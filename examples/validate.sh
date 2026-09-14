#!/usr/bin/env bash
# Validate the Simler excerpts against tei_simler.odd: the RELAX NG schema and the
# Schematron rules compiled from it (TEI Stylesheets, SchXslt2). Schematron
# warnings are listed; an invalid excerpt or a Schematron error fails.
#
#   SAXON_HOME=…/SaxonHE12 JING=…/jing.jar TEI_XSL=…/tei-xsl/xml/tei/stylesheet \
#   SCHXSLT=…/schxslt2/transpile.xsl bash validate.sh
set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)" in CYGWIN*|MINGW*|MSYS*) SEP=';' ;; *) SEP=':' ;; esac
CP="$(ls "$SAXON_HOME"/saxon-he-12*.jar | head -1)$SEP$(ls "$SAXON_HOME"/lib/xmlresolver-*.jar | tr '\n' "$SEP")"
saxon() { java -cp "$CP" net.sf.saxon.Transform "$@"; }
jing() { java -jar "$JING" "$@"; }
OUT="$(mktemp -d)"

echo "tei_simler.odd → RELAX NG + Schematron"
saxon -s:tei_simler.odd -xsl:"$TEI_XSL/odds/odd2odd.xsl" -o:"$OUT/compiled.odd" defaultTEIVersion=4.12.0
saxon -s:"$OUT/compiled.odd" -xsl:"$TEI_XSL/odds/odd2relax.xsl" -o:"$OUT/tei_simler.rng"
saxon -s:"$OUT/compiled.odd" -xsl:"$TEI_XSL/odds/extract-isosch.xsl" -o:"$OUT/tei_simler.sch"
saxon -s:"$OUT/tei_simler.sch" -xsl:"$SCHXSLT" -o:"$OUT/tei_simler.sch.xsl"

# The Schematron report: every finding, and an error() for those that are not warnings.
REPORT='declare namespace svrl = "http://purl.oclc.org/dsdl/svrl";
let $found := //(svrl:failed-assert | svrl:successful-report)
let $errors := $found[not(@role = ("warning", "nonfatal", "info"))]
return (
  string-join($found ! ("  " || (@role, "error")[1] || ": " || normalize-space(svrl:text)), "&#10;"),
  if ($errors) then error(QName("", "schematron"), count($errors) || " Schematron error(s)") else ()
)'

for f in simler-*.xml; do
  echo "$f"
  jing "$OUT/tei_simler.rng" "$f"
  saxon -s:"$f" -xsl:"$OUT/tei_simler.sch.xsl" -o:"$OUT/report.xml"
  java -cp "$CP" net.sf.saxon.Query -s:"$OUT/report.xml" -qs:"$REPORT" '!method=text'
  echo
done
echo "✓ every excerpt is valid against tei_simler.odd"
