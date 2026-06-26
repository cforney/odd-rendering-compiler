<?xml version="1.0" encoding="UTF-8"?>
<!--
  generate-saxonjs-page.xsl — the host page for the client-side SaxonJS render.

  Emits a small static page that loads the SaxonJS runtime from a CDN, then runs
  the compiled stylesheet (edition-saxonjs.sef.json) in the browser to render the
  TEI named in $tei. IXSL handles the note / apparatus / facsimile toggles, so no
  hand-written JavaScript is needed. Point -s: at the ODD (only its title is read).

  Run:  saxon -s:../examples/tei_simler.odd -xsl:generate/generate-saxonjs-page.xsl
              -o:output/rendered-saxonjs.html  tei="simler-poem.xml"
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="tei xs">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <!-- TEI document to render, the compiled SEF, and the page title. -->
  <xsl:param name="tei" as="xs:string" select="'simler-poem.xml'"/>
  <xsl:param name="sef" as="xs:string" select="'edition-saxonjs.sef.json'"/>
  <xsl:param name="title" as="xs:string" select="'TEI Edition — SaxonJS (client-side)'"/>
  <!-- The SaxonJS 2 browser runtime. build.sh self-hosts it next to this page
       (output/SaxonJS2.rt.js, gitignored) so the demo works offline and matches
       the xslt3 2.7 compiler that produced the SEF. -->
  <xsl:param name="runtime" as="xs:string" select="'SaxonJS2.rt.js'"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="$title"/></title>
        <link rel="stylesheet" href="edition.css"/>
        <style>
body.tei-edition { max-width: 42em; margin: 2em auto; padding: 0 1em; font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; line-height: 1.7; color: #222; background: #fefefe; }
/* Preview chrome: the banner naming the pipeline, not part of the edition. */
.render-info { font-family: system-ui, sans-serif; background: #e0f2fe; border: 1px solid #38bdf8; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
.render-info h3 { margin: 0 0 0.5em; color: #0284c7; }
.render-info code { background: #f0f9ff; padding: 0.1em 0.3em; border-radius: 3px; }
/* interactive note + apparatus + facsimile (mirrors the edition.xsl interactive tier) */
.tei-note-interactive .tei-note-body { display: none; }
.tei-note-interactive.open .tei-note-body { display: inline; background: #fffde7; border: 1px solid #e0e0e0; padding: 0.15em 0.4em; border-radius: 4px; }
.tei-note-ref { cursor: pointer; color: #2563eb; text-decoration: none; }
.tei-alternate { cursor: pointer; border-bottom: 1px dotted #999; }
.facs-toggle { margin: 0 0 1.2em; font-family: system-ui, sans-serif; }
.facs-toggle button { font: inherit; font-size: 0.85em; cursor: pointer; padding: 0.3em 0.8em; border: 1px solid #c7c7c7; border-radius: 4px; background: #f3f3f3; }
body.facs-hidden a.tei-pb { display: none; }
a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px; margin: 1.2em auto; padding: 4px; border: 1px solid #ccc; background: #fafafa; line-height: 0; }
a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none; margin: 0; border: 0; }
a.tei-pb img { display: block; width: 100%; height: auto; }
</style>
      </head>
      <body class="tei-edition">
        <div class="render-info">
          <h3>SaxonJS Rendering Path (client-side, in the browser)</h3>
          <p><strong>Pipeline:</strong> ODD → <code>odd-to-xsl.xsl</code> → <code>edition.xsl</code> → <code>xslt3&#160;-export</code> → <code>edition-saxonjs.sef.json</code> → SaxonJS + IXSL (in the browser)</p>
          <p>The <em>same</em> XSLT 3.0 stylesheet Saxon runs at build time, here compiled to a Stylesheet Export File (SEF) and executed client-side by SaxonJS. Note, apparatus and facsimile toggles are handled by IXSL (interactive XSLT) — no hand-written JavaScript. Needs JavaScript and an HTTP server, since it fetches the SEF and the TEI; the build-time pages need neither.</p>
        </div>
        <div class="facs-toggle">
          <button id="facs-toggle-btn" type="button">Hide facsimiles</button>
        </div>
        <div id="tei-content">
          <p>Rendering with SaxonJS…</p>
          <noscript>This client-side path needs JavaScript; the build-time pages (<code>rendered-xslt.html</code>) need none.</noscript>
        </div>
        <script src="{$runtime}"></script>
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
