#requires -Version 5
# Build the XSLT reference implementation end to end with Saxon (Windows / PowerShell).
#
#   GENERATE (the XSLT way):  ODD --odd-to-xsl.xsl--> edition.xsl
#                             ODD --odd-to-css.xsl--> edition.css
#   RENDER:                   edition.xsl(TEI)     --> rendered HTML (static + interactive)
#
# Saxon HE 12 is located via $env:SAXON_HOME — point it at your unpacked SaxonHE12
# directory (download: https://www.saxonica.com/download/java.xml). With none set,
# ./vendor/SaxonHE12-9J is tried.
param(
  [string]$Odd = "../examples/tei_simler.odd",
  [string]$Tei = "../examples/simler-poem.xml"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$saxonHome = if ($env:SAXON_HOME) { $env:SAXON_HOME } else { "./vendor/SaxonHE12-9J" }
$saxonJar = Get-ChildItem "$saxonHome\saxon-he-12*.jar" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch 'test|xqj' } | Select-Object -First 1
if (-not $saxonJar) {
  throw "Saxon HE 12 not found under SAXON_HOME=$saxonHome. Set SAXON_HOME to your unpacked SaxonHE12 dir (download: https://www.saxonica.com/download/java.xml)."
}
$resolvers = (Get-ChildItem "$saxonHome\lib\xmlresolver-*.jar" | ForEach-Object { $_.FullName }) -join ';'
$cp = "$($saxonJar.FullName);$resolvers"
function Invoke-Saxon([string[]]$a) { & java -cp $cp net.sf.saxon.Transform @a }

New-Item -ItemType Directory -Force output | Out-Null

Write-Host "(1) generate edition.xsl  <- $Odd"
Invoke-Saxon @("-s:$Odd", "-xsl:generate/odd-to-xsl.xsl", "-o:output/edition.xsl")
Write-Host "(1) generate edition.css  <- $Odd"
Invoke-Saxon @("-s:$Odd", "-xsl:generate/odd-to-css.xsl", "-o:output/edition.css")
Write-Host "(1) generate tei-ceteicean-behaviours.js + rendered-ceteicean.html  <- $Odd"
Invoke-Saxon @("-s:$Odd", "-xsl:generate/odd-to-ceteicean.xsl", "-o:output/tei-ceteicean-behaviours.js", "tei=$([System.IO.Path]::GetFileName($Tei))")
Write-Host "(2) render rendered-xslt.html  <- $Tei (static)"
Invoke-Saxon @("-s:$Tei", "-xsl:output/edition.xsl", "-o:output/rendered-xslt.html")
Write-Host "(2) render rendered-xslt-interactive.html  <- $Tei (progressively enhanced)"
Invoke-Saxon @("-s:$Tei", "-xsl:output/edition.xsl", "-o:output/rendered-xslt-interactive.html", "interactive=true")
Write-Host "done."
