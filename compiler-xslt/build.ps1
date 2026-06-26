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

# Corpus -> output/edition-interactive/: one interactive page per source plus a
# linking index.html, mirroring the JS render:multi output. The corpus is every
# simler-*.xml next to $Tei.
$teiDir = Split-Path -Parent $Tei
Write-Host "(3) corpus output/edition-interactive/  <- $teiDir/simler-*.xml"
New-Item -ItemType Directory -Force output/edition-interactive | Out-Null
$names = @()
Get-ChildItem "$teiDir/simler-*.xml" | Sort-Object Name | ForEach-Object {
  Invoke-Saxon @("-s:$($_.FullName)", "-xsl:output/edition.xsl", "-o:output/edition-interactive/$($_.BaseName).html", "interactive=true")
  $names += $_.Name
}
$filesParam = $names -join '|'
$subtitle = "$($names.Count) documents · prebuilt HTML, ~12 lines of vanilla JS, degrades to zero-JS"
Invoke-Saxon @("-s:$Odd", "-xsl:generate/generate-index.xsl", "-o:output/edition-interactive/index.html",
  "files=$filesParam", "title=TEI Edition — XSLT (progressively enhanced)", "subtitle=$subtitle")

# (4) SaxonJS (client side): the SAME edition.xsl, compiled to a Stylesheet Export
#     File (SEF) and run in the browser. The SEF compiler is xslt3 (SaxonJS, Node):
#     Saxon HE cannot emit a SaxonJS-runnable SEF, and only xslt3 understands the
#     IXSL toggle templates. The runtime is self-hosted so the demo works offline.
if (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host "(4) saxonjs edition-saxonjs.sef.json (IXSL) + rendered-saxonjs.html  <- edition.xsl"
  & npx --yes xslt3 -xsl:generate/render-saxonjs.xsl -export:output/edition-saxonjs.sef.json -nogo
  if ($LASTEXITCODE -ne 0) { throw "xslt3 failed to compile the SEF" }
  Invoke-Saxon @("-s:$Odd", "-xsl:generate/generate-saxonjs-page.xsl", "-o:output/rendered-saxonjs.html",
    "tei=$([System.IO.Path]::GetFileName($Tei))")
  Copy-Item $Tei "output/$([System.IO.Path]::GetFileName($Tei))" -Force  # fetched at view time
  if (-not (Test-Path output/SaxonJS2.rt.js)) {                          # SaxonJS 2 runtime
    try { Invoke-WebRequest -UseBasicParsing -Uri "https://www.saxonica.com/saxon-js/documentation2/SaxonJS/SaxonJS2.rt.js" -OutFile output/SaxonJS2.rt.js }
    catch { Write-Warning "could not fetch SaxonJS2.rt.js - drop it next to rendered-saxonjs.html to view" }
  }
} else {
  Write-Host "(4) saxonjs skipped (Node/npx not found - needed to compile the SEF with xslt3)"
}
Write-Host "done."
