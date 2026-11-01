<?xml version="1.0" encoding="UTF-8"?>
<!--
  generate-saxonjs-page.xsl — the host page for the client-side SaxonJS render.

  Emits a small static page that loads the SaxonJS runtime from a CDN, then runs
  the compiled stylesheet (edition-saxonjs.sef.json) in the browser to render the
  TEI named in $tei. IXSL swaps the apparatus readings; notes.js opens the notes,
  as on every interactive page. Point -s: at the ODD (only its title is read).

  Run:  saxon -s:../examples/tei_simler.odd -xsl:generate/generate-saxonjs-page.xsl
              -o:output/saxonjs/simler-psalmen.html  tei=simler-psalmen.xml
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="tei xs">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <!-- TEI document to render, the compiled SEF, edition.css, notes.js, facsimile.js, and the page title; relative to the page. -->
  <xsl:param name="tei" as="xs:string" select="'simler-psalmen.xml'"/>
  <xsl:param name="sef" as="xs:string" select="'edition-saxonjs.sef.json'"/>
  <xsl:param name="css" as="xs:string" select="'edition.css'"/>
  <xsl:param name="notes" as="xs:string" select="'notes.js'"/>
  <xsl:param name="facsimile" as="xs:string" select="'facsimile.js'"/>
  <xsl:param name="title" as="xs:string" select="'TEI Edition — SaxonJS (client-side)'"/>
  <!-- The SaxonJS 2 browser runtime. build.sh self-hosts it next to this page
       (output/SaxonJS2.rt.js, gitignored) so the demo works offline and matches
       the xslt3 2.7 compiler that produced the SEF. -->
  <xsl:param name="runtime" as="xs:string" select="'SaxonJS2.rt.js'"/>

  <xsl:template match="/">
    <html data-mode="light">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="$title"/></title>
        <link rel="stylesheet" href="{$css}"/>
        <style>
body { max-width: 42em; margin: 2em auto; padding: 0 1em; font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; line-height: 1.7; color: #222; background: #fefefe; }
/* Preview chrome: the banner naming the pipeline, not part of the edition. */
.render-info { font-family: system-ui, sans-serif; background: #e0f2fe; border: 1px solid #38bdf8; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
.render-info h3 { margin: 0 0 0.5em; color: #0284c7; }
.render-info code { background: #f0f9ff; padding: 0.1em 0.3em; border-radius: 3px; }
/* Apparatus toggle; notes: edition.css. */
.tei-alternate { cursor: pointer; border-bottom: 1px dotted #999; }
</style>
      </head>
      <body>
        <div class="render-info">
          <h3>SaxonJS Rendering Path (client-side, in the browser)</h3>
          <p><strong>Pipeline:</strong> ODD → <code>odd-to-xsl.xsl</code> → <code>edition.xsl</code> → <code>xslt3&#160;-export</code> → <code>edition-saxonjs.sef.json</code> → SaxonJS + IXSL (in the browser)</p>
          <p>The <em>same</em> XSLT 3.0 stylesheet Saxon runs at build time, here compiled to a Stylesheet Export File (SEF) and executed client-side by SaxonJS. Apparatus readings swap by IXSL (interactive XSLT); notes open as tooltips, by the same small script as on every interactive page. Needs JavaScript and an HTTP server, since it fetches the SEF and the TEI; the build-time pages need neither.</p>
        </div>
        <div id="tei-content">
          <p id="tei-rendering" hidden="hidden">Rendering with SaxonJS…</p>
          <script>document.getElementById('tei-rendering').hidden = false;</script>
          <noscript><p>This page renders in the browser, so it needs JavaScript. The prebuilt pages need none.</p></noscript>
        </div>
        <script src="{$runtime}"></script>
        <script src="{$notes}"></script>
        <script src="{$facsimile}"></script>
        <script>
          window.addEventListener('DOMContentLoaded', function () {
            function fail(msg) {
              var c = document.getElementById('tei-content');
              if (c) { c.innerHTML = '<p class="saxonjs-error" style="color:#b00020">SaxonJS could not render: ' + msg + '</p>'; }
            }
            if (typeof SaxonJS === 'undefined') { fail('runtime not loaded (offline, or the CDN is blocked).'); return; }
            // Resolve the TEI URL against THIS page, not the stylesheet's base URI
            // (SaxonJS resolves doc() relative URIs against the compiled SEF).
            var teiUrl = new URL('<xsl:value-of select="$tei"/>', document.baseURI).href;
            SaxonJS.transform({
              stylesheetLocation: '<xsl:value-of select="$sef"/>',
              initialTemplate: 'main',
              stylesheetParams: { 'tei-uri': teiUrl }
            }, 'async').catch(function (e) { fail((e &amp;&amp; e.message) || String(e)); });
          });
        </script>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
