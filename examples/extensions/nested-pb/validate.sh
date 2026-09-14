#!/usr/bin/env bash
# Validate the nested page-break extension: poc_odds.odd is valid TEI; compiled to
# RELAX NG with the TEI Stylesheets it accepts the extension ODD, which the TEI's
# own tei_odds.rng rejects.
#
#   SAXON_HOME=…/SaxonHE12 JING=…/jing.jar TEI_XSL=…/tei-xsl/xml/tei/stylesheet \
#   TEI_ODDS_RNG=…/tei_odds.rng bash validate.sh
set -euo pipefail
cd "$(dirname "$0")"

case "$(uname -s)" in CYGWIN*|MINGW*|MSYS*) SEP=';' ;; *) SEP=':' ;; esac
CP="$(ls "$SAXON_HOME"/saxon-he-12*.jar | head -1)$SEP$(ls "$SAXON_HOME"/lib/xmlresolver-*.jar | tr '\n' "$SEP")"
saxon() { java -cp "$CP" net.sf.saxon.Transform "$@"; }
jing() { java -jar "$JING" "$@"; }
OUT="$(mktemp -d)"

echo "poc_odds.odd is valid TEI"
jing "$TEI_ODDS_RNG" poc_odds.odd

echo "poc_odds.odd → poc_odds.rng"
saxon -s:poc_odds.odd -xsl:"$TEI_XSL/odds/odd2odd.xsl" -o:"$OUT/poc_odds.compiled.odd" defaultTEIVersion=4.12.0
saxon -s:"$OUT/poc_odds.compiled.odd" -xsl:"$TEI_XSL/odds/odd2relax.xsl" -o:"$OUT/poc_odds.rng"

echo "tei_simler-nested-pb.odd is valid against poc_odds.rng"
jing "$OUT/poc_odds.rng" tei_simler-nested-pb.odd

echo "… and not against tei_odds.rng"
if jing "$TEI_ODDS_RNG" tei_simler-nested-pb.odd >/dev/null; then
  echo "tei_odds.rng accepts the nested model" >&2
  exit 1
fi
echo "✓ the nested model is an extension of TEI, valid against poc_odds"
