#requires -Version 5
# Build the XSLT implementation end to end with Saxon (Windows / PowerShell).
#
#   GENERATE (the XSLT way):  ODD --odd-to-xsl.xsl--> edition.xsl
#                             ODD --odd-to-css.xsl--> edition.css
#   RENDER:                   edition.xsl(TEI)     --> one HTML page per TEI file (static + interactive)
#
#   ./build.ps1 [-Odd <path>] [-Tei <path>,<path>...] [-Tokens <css>]
# With no arguments, the Simler ODD and every ../examples/simler-*.xml. -Tokens
# names the design tokens for edition.css, relative to the ODD ("" for none).
#
# Saxon HE 12 is located via $env:SAXON_HOME - point it at your unpacked SaxonHE12
# directory (download: https://www.saxonica.com/download/java.xml). With none set,
# ./vendor/SaxonHE12-9J is tried.
param(
  [string]$Odd = "../examples/tei_simler.odd",
  [string[]]$Tei = @(),
  [string]$Tokens = "design-tokens.css"
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

$teis = if ($Tei.Count) { Get-Item $Tei } else { Get-ChildItem "../examples/simler-*.xml" | Sort-Object Name }
$names = @($teis | ForEach-Object { $_.Name })
New-Item -ItemType Directory -Force output/xslt, output/xslt-script, output/xslt-islands, output/ceteicean | Out-Null

Write-Host "(1) generate edition.xsl  <- $Odd"
Invoke-Saxon @("-s:$Odd", "-xsl:generate/odd-to-xsl.xsl", "-o:output/edition.xsl")
Copy-Item ../runtime/readings.js, ../runtime/notes.js, ../runtime/facsimile.js output/ -Force   # which an enhanced page inlines
Write-Host "(1) generate edition.css  <- $Odd $Tokens"
Invoke-Saxon (@("-s:$Odd", "-xsl:generate/odd-to-css.xsl", "-o:output/edition.css") + @($(if ($Tokens) { "tokens=$Tokens" })))
foreach ($dir in "output/xslt", "output/xslt-script", "output/xslt-islands", "output/ceteicean") { Copy-Item output/edition.css $dir -Force }
Copy-Item ../runtime/tei-islands.js, ../runtime/readings.js, ../runtime/facsimile.js output/xslt-islands/ -Force
Write-Host "(1) generate ceteicean/ (behaviours + a page per TEI file)  <- $Odd"
Invoke-Saxon @("-s:$Odd", "-xsl:generate/odd-to-ceteicean.xsl", "-o:output/ceteicean/tei-ceteicean-behaviours.js", "tei=$($names -join ' ')")

# Each TEI file: a static page (zero-JS) and the same page with each enhancer, plus
# an index of the enhanced pages, as the JS renderers write them.
Write-Host "(2) render xslt/, xslt-script/, xslt-islands/  <- $($teis.Count) TEI file(s)"
foreach ($f in $teis) {
  Invoke-Saxon @("-s:$($f.FullName)", "-xsl:output/edition.xsl", "-o:output/xslt/$($f.BaseName).html")
  Invoke-Saxon @("-s:$($f.FullName)", "-xsl:output/edition.xsl", "-o:output/xslt-script/$($f.BaseName).html", "enhance=script")
  Invoke-Saxon @("-s:$($f.FullName)", "-xsl:output/edition.xsl", "-o:output/xslt-islands/$($f.BaseName).html", "enhance=islands")
}
$subtitle = "$($names.Count) documents - prebuilt HTML, degrades to zero-JS"
foreach ($enhancer in "script", "islands") {
  Invoke-Saxon @("-s:$($teis[0].FullName)", "-xsl:generate/generate-index.xsl", "-o:output/xslt-$enhancer/index.html",
    "files=$($names -join '|')", "title=TEI Edition - XSLT + $enhancer", "subtitle=$subtitle")
}

# (3) SaxonJS (client side): the SAME edition.xsl, compiled to a Stylesheet Export
#     File (SEF) and run in the browser. The SEF compiler is xslt3 (SaxonJS, Node):
#     Saxon HE cannot emit a SaxonJS-runnable SEF, and only xslt3 understands the
#     IXSL toggle templates. The runtime is self-hosted so the demo works offline.
if (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host "(3) saxonjs edition-saxonjs.sef.json (IXSL) + saxonjs/  <- edition.xsl"
  & npx --yes xslt3 "-xsl:generate/render-saxonjs.xsl" "-export:output/edition-saxonjs.sef.json" -nogo
  if ($LASTEXITCODE -ne 0) { throw "xslt3 failed to compile the SEF" }
  New-Item -ItemType Directory -Force output/saxonjs | Out-Null
  foreach ($f in $teis) {
    Copy-Item $f.FullName output/saxonjs/ -Force                      # fetched at view time
    Invoke-Saxon @("-s:$Odd", "-xsl:generate/generate-saxonjs-page.xsl", "-o:output/saxonjs/$($f.BaseName).html",
      "tei=$($f.Name)", "sef=../edition-saxonjs.sef.json", "runtime=../SaxonJS2.rt.js", "css=../edition.css", "notes=../notes.js", "facsimile=../facsimile.js")
  }
  if (-not (Test-Path output/SaxonJS2.rt.js)) {                          # SaxonJS 2 runtime
    try { Invoke-WebRequest -UseBasicParsing -Uri "https://www.saxonica.com/saxon-js/documentation2/SaxonJS/SaxonJS2.rt.js" -OutFile output/SaxonJS2.rt.js }
    catch { Write-Warning "could not fetch SaxonJS2.rt.js - drop it into output/ to view the saxonjs/ pages" }
  }
} else {
  Write-Host "(3) saxonjs skipped (Node/npx not found - needed to compile the SEF with xslt3)"
}
Write-Host "done."
