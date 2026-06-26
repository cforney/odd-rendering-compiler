<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-to-xsl.xsl — the "generate" step, done the XSLT way.

  Reads a TEI ODD and generates a rendering stylesheet (edition.xsl) from its
  Processing Model — the XSLT counterpart of odd-to-unified.mjs / odd-to-xslt.mjs,
  showing the generate step can be written in any language, here in XSLT itself.

  Technique: <xsl:namespace-alias>. Elements that must appear as `xsl:*` in the
  generated stylesheet are written in the `axsl:` namespace and aliased to the
  XSLT namespace on output; literal HTML (div, span, h2 …) passes straight
  through. The two evaluation times are the key:
    * xsl:*  runs now, over the ODD    (choose tag, bake class/style, dispatch)
    * axsl:* runs later, over the TEI  (apply-templates, value-of @target, …)

  Run:  saxon  -s:../examples/tei_simler.odd  -xsl:generate/odd-to-xsl.xsl
               -o:output/edition.xsl
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:axsl="urn:x-alias:xsl"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:local="urn:x-poc:odd"
  exclude-result-prefixes="tei xs map local">

  <xsl:output method="xml" indent="yes"/>
  <xsl:namespace-alias stylesheet-prefix="axsl" result-prefix="xsl"/>

  <!-- Resolve <specGrpRef> within one document, returning the elementSpecs in
       reference order. Real ODDs (incl. tei_simplePrint) compose the schema from
       <specGrp xml:id="…"> groups pulled in with <specGrpRef target="#id"/>.
       Single-document scope: no @source fetching, no odd2odd flattening; an
       addressable <specGrp> contributes only where referenced, unreferenced
       groups and dangling references are skipped, and a visited-set guard breaks
       cycles. -->
  <xsl:function name="local:schema-specs" as="element(tei:elementSpec)*">
    <xsl:param name="nodes" as="node()*"/>
    <xsl:param name="seen" as="xs:string*"/>
    <xsl:for-each select="$nodes">
      <xsl:choose>
        <xsl:when test="self::tei:specGrpRef">
          <xsl:variable name="id" select="substring-after(@target, '#')"/>
          <xsl:variable name="grp" select="root(.)//tei:specGrp[@xml:id = $id]"/>
          <xsl:if test="$grp and not($id = $seen)">
            <xsl:sequence select="local:schema-specs($grp/node(), ($seen, $id))"/>
          </xsl:if>
        </xsl:when>
        <xsl:when test="self::tei:elementSpec">
          <xsl:sequence select="."/>
        </xsl:when>
        <xsl:when test="self::tei:specGrp[not(@xml:id)]">
          <xsl:sequence select="local:schema-specs(node(), $seen)"/>
        </xsl:when>
        <!-- addressable <specGrp xml:id> reached directly: a library group, skip -->
      </xsl:choose>
    </xsl:for-each>
  </xsl:function>

  <!-- The elementSpecs that make up the schema. When the ODD uses <specGrpRef>
       the schema is resolved through it (reference order); otherwise every
       elementSpec is taken in document order, exactly as before. -->
  <xsl:variable name="specs" as="element(tei:elementSpec)*"
    select="if (exists(//tei:specGrpRef))
            then local:schema-specs(//tei:schemaSpec/node(), ())[tei:model or tei:modelSequence]
            else //tei:elementSpec[tei:model or tei:modelSequence]"/>

  <!-- Shared behaviour contract: the SAME ../../behaviour-map.json the JS compiler
       reads (single source of truth — the two cannot drift). $tag = behaviour →
       HTML element for the simple wrapper behaviours (those flagged "wrapper"). -->
  <xsl:variable name="behaviour-map" select="json-doc('../../behaviour-map.json')"/>
  <xsl:variable name="tag" as="map(xs:string, xs:string)"
    select="map:merge(
      for $b in map:keys($behaviour-map)[$behaviour-map(.) instance of map(*)]
      return if ($behaviour-map($b)?wrapper = true() and map:contains($behaviour-map($b), 'tag'))
             then map:entry($b, xs:string($behaviour-map($b)?tag))
             else ())"/>

  <!-- Root: emit the edition.xsl skeleton, then a template per elementSpec. -->
  <xsl:template match="/">
    <axsl:stylesheet version="3.0" exclude-result-prefixes="tei local">
      <!-- tei and local must survive onto the generated stylesheet
           (exclude-result-prefixes would otherwise strip them), so declare them
           explicitly. local namespaces the render-time rendition helper below. -->
      <xsl:namespace name="tei" select="'http://www.tei-c.org/ns/1.0'"/>
      <xsl:namespace name="local" select="'urn:x-poc:odd'"/>

      <axsl:output method="html" encoding="UTF-8" indent="yes"/>

      <!-- Tier toggle. interactive='true' (set with `interactive=true` on the
           Saxon command line) produces the progressively-enhanced page; the
           default produces the zero-JS static page with collected footnotes. -->
      <axsl:param name="interactive" select="'false'"/>

      <!-- Render-time helper: turn a TEI element's @rendition pointer list
           (e.g. "#twocol", "#aq #c") into space-prefixed r-<id> classes, which
           edition.css (from <tagsDecl>) styles. This is how source appearance
           and page layout reach the output; the JS spine does the same with its
           renditionClasses(). -->
      <axsl:function name="local:rcls">
        <axsl:param name="n"/>
        <axsl:value-of select="string-join(for $t in tokenize(normalize-space($n/@rendition), ' ')[. ne ''] return ' r-' || replace($t, '^#', ''), '')"/>
      </axsl:function>

      <!-- Root template: the HTML page. -->
      <axsl:template match="/">
        <html>
          <head>
            <meta charset="UTF-8"/>
            <title><axsl:value-of select="//tei:titleStmt/tei:title[1]"/></title>
            <axsl:choose>
              <axsl:when test="$interactive = 'true'">
                <!-- Tier 2 inlines the generated CSS for a self-contained file. -->
                <style id="edition-css"><axsl:value-of select="unparsed-text('edition.css')"/></style>
                <style>
.tei-note-interactive .tei-note-body { display: none; }
.tei-note-interactive.open .tei-note-body { display: inline; background: #fffde7; border: 1px solid #e0e0e0; padding: 0.15em 0.4em; border-radius: 4px; }
.tei-note-ref { cursor: pointer; color: #2563eb; text-decoration: none; }
.tei-alternate { cursor: pointer; border-bottom: 1px dotted #999; }
.facs-toggle { display: none; margin: 0 0 1.2em; font-family: system-ui, sans-serif; }
html.js .facs-toggle { display: block; }
.facs-toggle button { font: inherit; font-size: 0.85em; cursor: pointer; padding: 0.3em 0.8em; border: 1px solid #c7c7c7; border-radius: 4px; background: #f3f3f3; }
body.facs-hidden a.tei-pb { display: none; }
</style>
              </axsl:when>
              <axsl:otherwise>
                <link rel="stylesheet" href="edition.css"/>
              </axsl:otherwise>
            </axsl:choose>
            <!-- Page chrome: centre the edition column (matching the JS output)
                 and lay out the facsimile thumbnails (pb compound) as their own
                 centred block that stacks vertically between the text; reset the
                 colliding .tei-pb rules that also land on this <a>/<figure> (the
                 page-break fallback's height:0 would otherwise collapse the box
                 so the image overflows onto the text). -->
            <style>
body.tei-edition { max-width: 42em; margin: 2em auto; padding: 0 1em; font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; line-height: 1.7; color: #222; background: #fefefe; }
/* Preview chrome: the banner naming the pipeline, not part of the edition. */
.render-info { font-family: system-ui, sans-serif; background: #e0f2fe; border: 1px solid #38bdf8; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
.render-info h3 { margin: 0 0 0.5em; color: #0284c7; }
.render-info code { background: #f0f9ff; padding: 0.1em 0.3em; border-radius: 3px; }
a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px; margin: 1.2em auto; padding: 4px; border: 1px solid #ccc; background: #fafafa; line-height: 0; }
a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none; margin: 0; border: 0; }
a.tei-pb img { display: block; width: 100%; height: auto; }
</style>
          </head>
          <body class="tei-edition">
            <div class="render-info">
              <axsl:choose>
                <axsl:when test="$interactive = 'true'">
                  <h3>Interactive XSLT Rendering Path (progressive enhancement)</h3>
                  <p><strong>Pipeline:</strong> ODD &#8594; <code>odd-to-xsl.xsl</code> &#8594; <code>edition.xsl</code> &#8594; (TEI) &#8594; HTML + ~12 lines of vanilla JS (Saxon, build time)</p>
                  <p>Every Processing-Model behaviour is compiled into an XSLT template and <code>edition.css</code> is inlined for a self-contained file. A framework-free script toggles notes, apparatus readings and facsimiles; with JavaScript off the page degrades to the static floor.</p>
                </axsl:when>
                <axsl:otherwise>
                  <h3>XSLT Rendering Path (static, zero-JS)</h3>
                  <p><strong>Pipeline:</strong> ODD &#8594; <code>odd-to-xsl.xsl</code> &#8594; <code>edition.xsl</code> &#8594; (TEI) &#8594; HTML (Saxon, build time)</p>
                  <p>Every Processing-Model behaviour is compiled into an XSLT template; XPath predicates stay native XSLT match patterns, so there is no translation gap. Footnotes are collected at the document end.</p>
                </axsl:otherwise>
              </axsl:choose>
            </div>
            <axsl:if test="$interactive = 'true'">
              <div class="facs-toggle"><button type="button" data-facs-toggle="">Hide facsimiles</button></div>
            </axsl:if>
            <axsl:apply-templates select="//tei:text"/>
            <!-- Tier 1: collect footnotes at the end. (Tier 2 shows them inline.) -->
            <axsl:if test="$interactive != 'true' and //tei:note">
              <section class="tei-footnotes">
                <hr/>
                <axsl:for-each select="//tei:note">
                  <div class="tei-footnote">
                    <axsl:attribute name="id">note-<axsl:value-of select="generate-id(.)"/></axsl:attribute>
                    <span class="tei-note-num"><axsl:number level="any" count="tei:note"/>.</span>
                    <axsl:text xml:space="preserve"> </axsl:text>
                    <axsl:apply-templates/>
                  </div>
                </axsl:for-each>
              </section>
            </axsl:if>
            <!-- Tier 2: a tiny framework-free enhancement. petite-vue's @click /
                 :aria directive attributes are not valid XML names, so a standards
                 XSLT generator cannot emit them; data/class hooks + ~12 lines of
                 vanilla JS reach the same result and degrade to the floor. -->
            <axsl:if test="$interactive = 'true'">
              <script>
document.documentElement.classList.add('js');
document.addEventListener('click', function (e) {
  var ref = e.target.closest('.tei-note-ref');
  if (ref) { e.preventDefault(); ref.parentNode.classList.toggle('open'); return; }
  var alt = e.target.closest('.tei-alternate');
  if (alt) {
    var d = alt.querySelector('.tei-alternate-default');
    var v = alt.querySelector('.tei-alternate-alt');
    if (d) { d.hidden = !d.hidden; }
    if (v) { v.hidden = !v.hidden; }
    return;
  }
  var ft = e.target.closest('[data-facs-toggle]');
  if (ft) {
    var hidden = document.body.classList.toggle('facs-hidden');
    ft.textContent = hidden ? 'Show facsimiles' : 'Hide facsimiles';
  }
});
</script>
              <noscript>
                <style>.tei-note-interactive .tei-note-body { display: inline !important; }</style>
              </noscript>
            </axsl:if>
          </body>
        </html>
      </axsl:template>

      <!-- Suppress the header (metadata behaviour). -->
      <axsl:template match="tei:teiHeader"/>

      <!-- Generated per-element templates -->
      <xsl:apply-templates select="$specs" mode="spec"/>

      <!-- Fallback: pass through any unmatched TEI element. -->
      <axsl:template match="tei:*">
        <axsl:apply-templates/>
      </axsl:template>

    </axsl:stylesheet>
  </xsl:template>

  <!-- One elementSpec → one or more <xsl:template>s. -->
  <xsl:template match="tei:elementSpec" mode="spec">
    <xsl:variable name="ident" select="@ident"/>
    <xsl:variable name="models" select="tei:model"/>
    <xsl:variable name="predicated" select="$models[@predicate]"/>
    <xsl:variable name="plain" select="$models[not(@predicate)]"/>

    <xsl:text>&#10;</xsl:text>
    <xsl:comment> *** &lt;<xsl:value-of select="$ident"/>&gt; *** </xsl:comment>

    <!-- predicated models → a template each, matched by the XPath predicate -->
    <xsl:for-each select="$predicated">
      <axsl:template match="tei:{$ident}[{@predicate}]">
        <xsl:call-template name="emit-body">
          <xsl:with-param name="model" select="."/>
          <xsl:with-param name="ident" select="$ident"/>
        </xsl:call-template>
      </axsl:template>
    </xsl:for-each>

    <!-- the first un-predicated model → the default template -->
    <xsl:if test="$plain">
      <axsl:template match="tei:{$ident}">
        <xsl:call-template name="emit-body">
          <xsl:with-param name="model" select="$plain[1]"/>
          <xsl:with-param name="ident" select="$ident"/>
        </xsl:call-template>
      </axsl:template>
    </xsl:if>
  </xsl:template>

  <!-- Emit the body of one template for a given <model>. -->
  <xsl:template name="emit-body">
    <xsl:param name="model" as="element(tei:model)"/>
    <xsl:param name="ident" as="xs:string"/>

    <xsl:variable name="b" select="string($model/@behaviour)"/>
    <!-- non-scoped outputRendition fragments → one style string -->
    <xsl:variable name="css"
      select="normalize-space(string-join($model/tei:outputRendition[not(@scope)], ' '))"/>
    <xsl:variable name="beforeCss"
      select="normalize-space(string-join($model/tei:outputRendition[@scope='before'], ' '))"/>
    <xsl:variable name="afterCss"
      select="normalize-space(string-join($model/tei:outputRendition[@scope='after'], ' '))"/>
    <!-- params as a map for easy lookup -->
    <xsl:variable name="p" as="map(xs:string, xs:string)">
      <xsl:map>
        <xsl:for-each select="$model/tei:param">
          <xsl:map-entry key="string(@name)" select="string(@value)"/>
        </xsl:for-each>
      </xsl:map>
    </xsl:variable>

    <xsl:choose>
      <!-- compound (Boot nested model): emit each sub-model body in sequence,
           except that a `link` sub-model WRAPS the rest, so a <pb> declared as
           link + graphic becomes one clickable thumbnail (an <a> around the
           <figure><img>) rather than an empty link beside a detached image. -->
      <xsl:when test="$model/tei:modelSequence">
        <xsl:variable name="subs" select="$model/tei:modelSequence/tei:model"/>
        <xsl:variable name="link" select="$subs[@behaviour = 'link'][1]"/>
        <xsl:choose>
          <xsl:when test="$link">
            <xsl:variable name="uri" select="if ($link/tei:param[@name='uri'])
              then string($link/tei:param[@name='uri']/@value) else '@target'"/>
            <a class="tei-{$ident}">
              <axsl:attribute name="href"><axsl:value-of select="{$uri}"/></axsl:attribute>
              <xsl:for-each select="$subs except $link">
                <xsl:call-template name="emit-body">
                  <xsl:with-param name="model" select="."/>
                  <xsl:with-param name="ident" select="$ident"/>
                </xsl:call-template>
              </xsl:for-each>
            </a>
          </xsl:when>
          <xsl:otherwise>
            <xsl:for-each select="$subs">
              <xsl:call-template name="emit-body">
                <xsl:with-param name="model" select="."/>
                <xsl:with-param name="ident" select="$ident"/>
              </xsl:call-template>
            </xsl:for-each>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:when>

      <!-- simple wrapper behaviours from the tag map -->
      <xsl:when test="map:contains($tag, $b)">
        <xsl:element name="{$tag($b)}">
          <!-- class baked at generate time + r-<id> tokens appended at render
               time from @rendition (source appearance / page layout). -->
          <axsl:attribute name="class"><xsl:value-of select="if ($b='body') then 'tei-body' else 'tei-' || $ident"/><axsl:value-of select="local:rcls(.)"/></axsl:attribute>
          <xsl:if test="$css ne ''"><axsl:attribute name="style"><xsl:value-of select="$css"/></axsl:attribute></xsl:if>
          <!-- before/after pseudo-content: set style via a non-AVT attribute so a
               literal "{" in the CSS (e.g. simplePrint's sp/stage content:'{') is
               not mis-parsed as an attribute value template in the generated XSL. -->
          <xsl:if test="$beforeCss ne ''"><span><axsl:attribute name="style"><xsl:value-of select="$beforeCss"/></axsl:attribute></span></xsl:if>
          <axsl:apply-templates/>
          <xsl:if test="$afterCss ne ''"><span><axsl:attribute name="style"><xsl:value-of select="$afterCss"/></axsl:attribute></span></xsl:if>
        </xsl:element>
      </xsl:when>

      <!-- heading: numeric level → h1..h6; XPath level → computed element -->
      <xsl:when test="$b = 'heading'">
        <xsl:variable name="level" select="if (map:contains($p,'level')) then $p('level') else '1'"/>
        <xsl:choose>
          <xsl:when test="$level castable as xs:integer">
            <xsl:element name="h{min((6, max((1, xs:integer($level)))))}">
              <xsl:attribute name="class" select="'tei-' || $ident"/>
              <xsl:if test="$css ne ''"><xsl:attribute name="style" select="$css"/></xsl:if>
              <axsl:apply-templates/>
            </xsl:element>
          </xsl:when>
          <xsl:otherwise>
            <!-- XPath level (e.g. count(ancestor::div)) → element name computed
                 at render time. (Like the JS path, the dynamic branch does not
                 bake a style attribute; the heading rule lives in edition.css.) -->
            <axsl:variable name="raw" select="{$level}"/>
            <axsl:variable name="hlevel"
              select="if ($raw &gt; 6) then 6 else if ($raw &lt; 1) then 1 else $raw"/>
            <axsl:element name="h{{$hlevel}}">
              <axsl:attribute name="class">tei-<xsl:value-of select="$ident"/></axsl:attribute>
              <axsl:apply-templates/>
            </axsl:element>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:when>

      <!-- note: Tier 1 → numbered ref (body collected at document end);
                 Tier 2 → inline toggle carrying its own body. -->
      <xsl:when test="$b = 'note'">
        <axsl:choose>
          <axsl:when test="$interactive = 'true'">
            <span class="tei-note-interactive">
              <a class="tei-note-ref" href="#" role="doc-noteref">
                <sup><axsl:number level="any" count="tei:note"/></sup>
              </a>
              <span class="tei-note-body" role="doc-footnote">
                <axsl:apply-templates/>
              </span>
            </span>
          </axsl:when>
          <axsl:otherwise>
            <a class="tei-note-ref">
              <axsl:attribute name="href">#note-<axsl:value-of select="generate-id(.)"/></axsl:attribute>
              <axsl:number level="any" count="tei:note"/>
            </a>
          </axsl:otherwise>
        </axsl:choose>
      </xsl:when>

      <!-- link: anchor with @href from the uri param. (Like the JS path, the
           link's outputRendition is realised in edition.css, not baked here.) -->
      <xsl:when test="$b = 'link'">
        <xsl:variable name="uri" select="if (map:contains($p,'uri')) then $p('uri') else '@target'"/>
        <a class="tei-{$ident}">
          <axsl:attribute name="href"><axsl:value-of select="{$uri}"/></axsl:attribute>
          <axsl:apply-templates/>
        </a>
      </xsl:when>

      <!-- alternate (apparatus): default reading shown, alternate hidden -->
      <xsl:when test="$b = 'alternate'">
        <!-- Defaults must not select self ('.'), or the apply-templates would
             re-enter this template and loop; first/second child element is the
             sensible fallback for sic/corr, abbr/expan, … -->
        <xsl:variable name="def" select="if (map:contains($p,'default')) then $p('default') else '*[1]'"/>
        <xsl:variable name="alt" select="if (map:contains($p,'alternate')) then $p('alternate') else '*[2]'"/>
        <span class="tei-alternate tei-{$ident}">
          <span class="tei-alternate-default">
            <axsl:apply-templates select="{$def}"/>
          </span>
          <span class="tei-alternate-alt" hidden="hidden">
            <axsl:apply-templates select="{$alt}"/>
          </span>
        </span>
      </xsl:when>

      <!-- graphic: img with @src from the url param -->
      <xsl:when test="$b = 'graphic'">
        <xsl:variable name="url" select="if (map:contains($p,'url')) then $p('url') else '@url'"/>
        <figure class="tei-{$ident}">
          <img>
            <axsl:attribute name="src"><axsl:value-of select="{$url}"/></axsl:attribute>
            <axsl:if test="tei:desc">
              <axsl:attribute name="alt"><axsl:value-of select="tei:desc"/></axsl:attribute>
            </axsl:if>
          </img>
        </figure>
      </xsl:when>

      <!-- anchor: empty <a id="…"> -->
      <xsl:when test="$b = 'anchor'">
        <a class="tei-{$ident}">
          <axsl:attribute name="id"><axsl:value-of select="@xml:id"/></axsl:attribute>
        </a>
      </xsl:when>

      <!-- break: <br>. (Matches the JS path, which renders break as a bare <br>;
           any scope=before/after rendition is realised in edition.css, not here.) -->
      <xsl:when test="$b = 'break'">
        <br class="tei-{$ident}"/>
      </xsl:when>

      <!-- metadata / omit: render nothing -->
      <xsl:when test="$b = ('metadata','omit')"/>

      <!-- text: transparent pass-through -->
      <xsl:when test="$b = 'text'">
        <axsl:apply-templates/>
      </xsl:when>

      <!-- index / toc: a navigation list of the document's headings (not a copy
           of the body). Suppressed for trivial (<2-heading) documents. This is
           the first arm of tei_simplePrint's body modelSequence [index + block];
           the block arm renders the body itself, so emitting children here too
           would duplicate the whole document. -->
      <xsl:when test="$b = 'index'">
        <axsl:if test="count(descendant::tei:head) ge 2">
          <nav class="tei-toc">
            <p class="tei-toc-label">Contents</p>
            <ul>
              <axsl:for-each select="descendant::tei:head">
                <li class="tei-toc-entry"><axsl:value-of select="normalize-space(.)"/></li>
              </axsl:for-each>
            </ul>
          </nav>
        </axsl:if>
      </xsl:when>

      <!-- default: a generic span wrapper -->
      <xsl:otherwise>
        <span class="tei-{$ident}">
          <xsl:if test="$css ne ''"><xsl:attribute name="style" select="$css"/></xsl:if>
          <axsl:apply-templates/>
        </span>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

</xsl:stylesheet>
