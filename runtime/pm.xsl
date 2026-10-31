<?xml version="1.0" encoding="UTF-8"?>
<!--
  pm.xsl — the runtime of a generated edition.xsl. Both XSLT generators
  (compiler-js/odd-to-xslt.mjs, compiler-xslt/generate/odd-to-xsl.xsl) copy its
  declarations into the stylesheet they generate. Theirs are the ODD's models:
  per TEI element a template in mode pm:select, which gives the element's first
  model of an output ('' the models without @output) whose predicate holds, as
  a map with its params evaluated there, and $pm:views, the outputs laid over
  the page.

  It renders as pm-runtime.mjs does for the unified/xast handlers,
  so the two produce the same body. The generated stylesheet declares
  xpath-default-namespace="http://www.tei-c.org/ns/1.0", so unprefixed names
  here, as in the ODD's predicates, are TEI elements; *:a is an HTML <a>.
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:pm="urn:x-poc:pm"
  xpath-default-namespace="http://www.tei-c.org/ns/1.0"
  exclude-result-prefixes="#all">

  <xsl:output method="html" encoding="UTF-8" indent="no"/>

  <!-- The PM output to render: its models take precedence, models of another output are skipped. -->
  <xsl:param name="output" as="xs:string" select="'web'"/>
  <!-- 'true' renders the progressively enhanced page: a small script swaps readings, notes.js (beside the stylesheet) opens notes. -->
  <xsl:param name="interactive" as="xs:string" select="'false'"/>

  <!-- HTML elements whose content must be phrasing: a block inside becomes a span. -->
  <xsl:variable name="pm:phrasing" select="('p', 'span', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6')"/>
  <!-- The page, output "web", has the views laid over it and a switch for each; another output renders alone. -->
  <xsl:variable name="pm:laid" as="map(*)*" select="if ($output = 'web') then $pm:views else ()"/>

  <xsl:mode name="pm:select" on-no-match="deep-skip"/>
  <xsl:mode name="pm:page" on-no-match="shallow-copy"/>

  <!-- The page; its title is the one the root's model for output "page" gives. -->
  <xsl:template match="/">
    <html data-mode="light">
      <head>
        <meta charset="UTF-8"/>
        <title><xsl:value-of select="(pm:select(/*, 'page')?params?title ! string(), normalize-space((//title)[1]))[.][1]"/></title>
        <xsl:choose>
          <xsl:when test="$interactive = 'true'">
            <style id="edition-css"><xsl:value-of select="unparsed-text('edition.css')"/></style>
          </xsl:when>
          <xsl:otherwise>
            <link rel="stylesheet" href="edition.css"/>
          </xsl:otherwise>
        </xsl:choose>
        <style>
body { max-width: 42em; margin: 2em auto; padding: 0 1em; font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; line-height: 1.7; color: #222; background: #fefefe; }
.render-info { font-family: system-ui, sans-serif; background: #e0f2fe; border: 1px solid #38bdf8; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
.render-info h3 { margin: 0 0 0.5em; color: #0284c7; }
.render-info code { background: #f0f9ff; padding: 0.1em 0.3em; border-radius: 3px; }
.js .tei-alternate { border-bottom: 1px dotted #999; cursor: pointer; }
</style>
      </head>
      <body>
        <div class="render-info">
          <xsl:choose>
            <xsl:when test="$interactive = 'true'">
              <h3>Interactive XSLT Rendering Path (progressive enhancement)</h3>
              <p><strong>Pipeline:</strong> ODD &#8594; generator &#8594; <code>edition.xsl</code> &#8594; (TEI) &#8594; HTML + ~12 lines of vanilla JS (Saxon, build time)</p>
              <p>Every model is an XSLT branch with its predicate kept as XPath; <code>edition.css</code> is inlined. A small script swaps apparatus readings, and notes open as tooltips; with JavaScript off the page degrades to the static floor.</p>
            </xsl:when>
            <xsl:otherwise>
              <h3>XSLT Rendering Path (static, zero-JS)</h3>
              <p><strong>Pipeline:</strong> ODD &#8594; generator &#8594; <code>edition.xsl</code> &#8594; (TEI) &#8594; HTML (Saxon, build time)</p>
              <p>Every model is an XSLT branch with its predicate kept as XPath, so there is no translation gap. Notes are collected at the end.</p>
            </xsl:otherwise>
          </xsl:choose>
        </div>
        <xsl:call-template name="pm:edition"/>
        <xsl:if test="$interactive = 'true'">
          <script>
document.documentElement.classList.add('js');
document.addEventListener('click', function (e) {
  var alt = e.target.closest('.tei-alternate');
  if (alt) {
    var d = alt.querySelector('.tei-alternate-default');
    var v = alt.querySelector('.tei-alternate-alt');
    if (d) { d.hidden = !d.hidden; }
    if (v) { v.hidden = !v.hidden; }
  }
});
</script>
          <script><xsl:value-of select="unparsed-text('notes.js')"/></script>
        </xsl:if>
      </body>
    </html>
  </xsl:template>

  <!-- The edition: the text, then its notes grouped by place. -->
  <xsl:template name="pm:edition">
    <xsl:param name="doc" select="/"/>
    <xsl:variable name="text"><xsl:apply-templates select="$doc/*"/></xsl:variable>
    <div class="tei-edition">
      <xsl:attribute name="data-{$output}" select="'on'"/>
      <!-- A checkbox per view: CSS lays the view over the page while it is checked. -->
      <xsl:if test="exists($pm:laid)">
        <form class="tei-views">
          <xsl:for-each select="$pm:laid">
            <label><input type="checkbox" data-view="{?output}"/><xsl:value-of select="' ' || ?label"/></label>
          </xsl:for-each>
        </form>
      </xsl:if>
      <xsl:apply-templates select="$text/node()" mode="pm:page"/>
      <xsl:for-each-group select="$text//pm:note" group-by="@place">
        <xsl:choose>
          <xsl:when test="current-grouping-key() = 'end'">
            <section class="tei-footnotes">
              <xsl:for-each select="current-group()">
                <aside class="tei-note-body" id="note-{pm:number(.)}">
                  <span class="tei-note-num"><xsl:value-of select="pm:number(.)"/>.</span>
                  <xsl:text> </xsl:text>
                  <xsl:apply-templates select="pm:body/node()" mode="pm:page"/>
                </aside>
              </xsl:for-each>
            </section>
          </xsl:when>
          <xsl:otherwise>
            <section class="tei-notes" data-place="{current-grouping-key()}">
              <xsl:for-each select="current-group()">
                <aside class="tei-note-body"><xsl:copy-of select="*:a/@id"/><xsl:apply-templates select="pm:body/node()" mode="pm:page"/></aside>
              </xsl:for-each>
            </section>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:for-each-group>
    </div>
  </xsl:template>

  <!-- A note at the end is numbered in document order, the outer before the inner. -->
  <xsl:function name="pm:number" as="xs:integer">
    <xsl:param name="note" as="element(pm:note)"/>
    <xsl:sequence select="count($note/(preceding::pm:note | ancestor::pm:note)[@place = 'end']) + 1"/>
  </xsl:function>

  <xsl:template match="pm:note[@place = 'end']" mode="pm:page">
    <a href="#note-{pm:number(.)}">
      <xsl:copy-of select="*:a/@*"/>
      <xsl:value-of select="pm:number(.)"/>
    </a>
  </xsl:template>
  <xsl:template match="pm:note" mode="pm:page"/>
  <xsl:template match="*" mode="pm:page">
    <xsl:copy copy-namespaces="no"><xsl:apply-templates select="@*, node()" mode="pm:page"/></xsl:copy>
  </xsl:template>

  <!-- An element renders by its model; with none, its content passes through. A sequence renders
       each of its parts whose predicate holds; the element's id goes on the first. -->
  <xsl:template match="*">
    <xsl:variable name="e" select="."/>
    <xsl:variable name="m" select="pm:choose(.)"/>
    <xsl:choose>
      <xsl:when test="empty($m)"><xsl:apply-templates/></xsl:when>
      <xsl:when test="$m?behaviour = 'sequence'">
        <xsl:variable name="live" select="index-of($m?parts ! ?live, true())"/>
        <xsl:for-each select="$live">
          <xsl:variable name="k" select="."/>
          <xsl:for-each select="$e">
            <xsl:call-template name="pm:model">
              <xsl:with-param name="m" select="$m?parts[$k]"/>
              <xsl:with-param name="k" select="$k"/>
              <xsl:with-param name="first" select="$k = $live[1]"/>
            </xsl:call-template>
          </xsl:for-each>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="pm:model"><xsl:with-param name="m" select="$m"/></xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- The model an element takes: the first of the output being rendered whose predicate holds, else the first such model without @output. -->
  <xsl:function name="pm:choose" as="map(*)?">
    <xsl:param name="e" as="element()"/>
    <xsl:sequence select="(pm:select($e, $output), pm:select($e, ''))[1]"/>
  </xsl:function>

  <!-- The first model of exactly $out ('' the models without @output) whose predicate holds. -->
  <xsl:function name="pm:select" as="map(*)?">
    <xsl:param name="e" as="element()"/>
    <xsl:param name="out" as="xs:string"/>
    <xsl:apply-templates select="$e" mode="pm:select"><xsl:with-param name="output" select="$out"/></xsl:apply-templates>
  </xsl:function>

  <!-- Text: indentation is dropped, other whitespace collapsed. -->
  <!-- At a joined line end the lb's model sets the hyphen: the encoded one goes, and so do the spaces. -->
  <xsl:template match="text()">
    <xsl:choose>
      <!-- The nearest xml:space decides. -->
      <xsl:when test="(ancestor::*/@xml:space)[last()] = 'preserve'"><xsl:value-of select="."/></xsl:when>
      <xsl:when test="normalize-space()">
        <xsl:variable name="collapsed" select="replace(., '[ \t\n\r]+', ' ')"/>
        <xsl:variable name="start" select="if (pm:joined(., -1)) then replace($collapsed, '^ ', '') else $collapsed"/>
        <xsl:value-of select="if (pm:joined(., 1)) then replace($start, '( ?[\-&#xAD;¬&#x2010;&#x2011;&#x2E17;] ?| )$', '') else $start"/>
      </xsl:when>
      <xsl:when test="not(pm:joined(., -1) or pm:joined(., 1) or pm:indentation(.))"><xsl:text> </xsl:text></xsl:when>
    </xsl:choose>
  </xsl:template>

  <!-- What a walk along the printed line meets from $n on ($step 1 forward, -1 back): 'join' at a
       joined line end (lb break="no"), 'stop' at text, another line end or a block, '' where it
       passes whitespace and inline elements. -->
  <xsl:function name="pm:along" as="xs:string">
    <xsl:param name="n" as="node()?"/>
    <xsl:param name="step" as="xs:integer"/>
    <xsl:variable name="met" as="xs:string" select="
      if (empty($n)) then ''
      else if ($n instance of text()) then (if (normalize-space($n)) then 'stop' else '')
      else if ($n/self::lb) then (if ($n/@break = 'no') then 'join' else 'stop')
      else if (pm:flow($n) = 'block') then 'stop'
      else pm:along(if ($step gt 0) then $n/node()[1] else $n/node()[last()], $step)"/>
    <xsl:sequence select="if ($met or empty($n)) then $met
      else pm:along(if ($step gt 0) then $n/following-sibling::node()[1] else $n/preceding-sibling::node()[1], $step)"/>
  </xsl:function>

  <!-- Whether the line of $n joins the next ($step 1) or the previous one (-1); the walk leaves inline elements. -->
  <xsl:function name="pm:joined" as="xs:boolean">
    <xsl:param name="n" as="node()"/>
    <xsl:param name="step" as="xs:integer"/>
    <xsl:variable name="met" select="pm:along(if ($step gt 0) then $n/following-sibling::node()[1] else $n/preceding-sibling::node()[1], $step)"/>
    <xsl:sequence select="if ($met) then $met = 'join' else exists($n/parent::*) and pm:flow($n/..) ne 'block' and pm:joined($n/.., $step)"/>
  </xsl:function>

  <!-- Whitespace-only text at the edge of a block, or next to one, is indentation. -->
  <xsl:function name="pm:indentation" as="xs:boolean">
    <xsl:param name="t" as="node()"/>
    <xsl:variable name="before" select="$t/preceding-sibling::node()[self::* or self::text()][1]"/>
    <xsl:variable name="after" select="$t/following-sibling::node()[self::* or self::text()][1]"/>
    <xsl:sequence select="not($t/parent::*) or pm:flow($t/..) ne 'inline'
      and (empty($before) or empty($after) or pm:flow($before) = 'block' or pm:flow($after) = 'block')"/>
  </xsl:function>

  <!-- Nothing but whitespace, or a block, before this node in its parent. -->
  <xsl:function name="pm:at-line-start" as="xs:boolean">
    <xsl:param name="n" as="node()"/>
    <xsl:variable name="before" select="$n/preceding-sibling::node()[self::* or self::text()[normalize-space()]][1]"/>
    <xsl:sequence select="empty($before) or pm:flow($before) = 'block'"/>
  </xsl:function>

  <!-- Block or inline, by the model an element takes where it stands; '' for anything else. -->
  <xsl:function name="pm:flow" as="xs:string">
    <xsl:param name="n" as="node()"/>
    <xsl:sequence select="if ($n instance of element()) then string(pm:choose($n)?flow) else ''"/>
  </xsl:function>

  <!-- `@rendition="#a #b"` → r-a r-b -->
  <xsl:function name="pm:renditions" as="xs:string*">
    <xsl:param name="e" as="element()"/>
    <xsl:sequence select="tokenize(normalize-space($e/@rendition)) ! ('r-' || replace(., '^#', ''))"/>
  </xsl:function>

  <!-- A param's value: the nodes it selects rendered by their own models (the element itself by its content), anything else as text. -->
  <xsl:template name="pm:value">
    <xsl:param name="value" as="item()*"/>
    <xsl:param name="phrasing" as="xs:boolean"/>
    <xsl:variable name="self" select="."/>
    <xsl:for-each select="$value">
      <xsl:choose>
        <xsl:when test="not(. instance of node())"><xsl:value-of select="."/></xsl:when>
        <xsl:otherwise>
          <xsl:apply-templates select="if (. is $self) then node() else .">
            <xsl:with-param name="phrasing" select="$phrasing" tunnel="yes"/>
          </xsl:apply-templates>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <!-- A model's content: its template filled in, else its content param, else the element's content. -->
  <xsl:template name="pm:content">
    <xsl:param name="m" as="map(*)"/>
    <xsl:param name="params" as="map(*)"/>
    <xsl:param name="phrasing" as="xs:boolean"/>
    <xsl:choose>
      <xsl:when test="exists($m?template)">
        <xsl:apply-templates select="parse-xml-fragment($m?template)/node()" mode="pm:template">
          <xsl:with-param name="pm:element" select="." tunnel="yes"/>
          <xsl:with-param name="pm:params" select="$params" tunnel="yes"/>
          <xsl:with-param name="phrasing" select="$phrasing" tunnel="yes"/>
        </xsl:apply-templates>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="pm:value">
          <xsl:with-param name="value" select="if (map:contains($params, 'content')) then $params?content else node()"/>
          <xsl:with-param name="phrasing" select="$phrasing"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- A template filled in: each [[name]] the value of that param, in an attribute its strings. -->
  <xsl:template match="text()" mode="pm:template">
    <xsl:param name="pm:element" as="element()" tunnel="yes"/>
    <xsl:param name="pm:params" as="map(*)" tunnel="yes"/>
    <xsl:param name="phrasing" as="xs:boolean" tunnel="yes"/>
    <xsl:analyze-string select="." regex="\[\[([^\[\]]*)\]\]">
      <xsl:matching-substring>
        <xsl:variable name="value" select="$pm:params(regex-group(1))"/>
        <xsl:for-each select="$pm:element">
          <xsl:call-template name="pm:value">
            <xsl:with-param name="value" select="$value"/>
            <xsl:with-param name="phrasing" select="$phrasing"/>
          </xsl:call-template>
        </xsl:for-each>
      </xsl:matching-substring>
      <xsl:non-matching-substring><xsl:value-of select="."/></xsl:non-matching-substring>
    </xsl:analyze-string>
  </xsl:template>
  <xsl:template match="*" mode="pm:template">
    <xsl:param name="pm:params" as="map(*)" tunnel="yes"/>
    <xsl:param name="phrasing" as="xs:boolean" tunnel="yes"/>
    <xsl:element name="{local-name()}">
      <xsl:for-each select="@*">
        <xsl:attribute name="{local-name()}" select="string-join(analyze-string(., '\[\[([^\[\]]*)\]\]')/*
          ! (if (self::*:match) then string-join($pm:params(string(*:group)) ! string(), ' ') else string()))"/>
      </xsl:for-each>
      <xsl:apply-templates mode="pm:template">
        <xsl:with-param name="phrasing" select="$phrasing or local-name() = $pm:phrasing" tunnel="yes"/>
      </xsl:apply-templates>
    </xsl:element>
  </xsl:template>

  <!-- An alternate's reading marked, per view laid over it, as that view's default or alternate. -->
  <xsl:function name="pm:marks" as="xs:string*">
    <xsl:param name="e" as="element()"/>
    <xsl:param name="reading" as="item()*"/>
    <xsl:param name="laid" as="map(*)*"/>
    <xsl:for-each select="$laid">
      <xsl:variable name="params" select="(?model?params, map {})[1]"/>
      <xsl:variable name="default" select="if (map:contains($params, 'default')) then $params?default else $e/*[1]"/>
      <xsl:sequence select="?output || (if (some $x in $default, $y in $reading satisfies
        (if ($x instance of node() and $y instance of node()) then $x is $y else deep-equal($x, $y))) then '-default' else '-alternate')"/>
    </xsl:for-each>
  </xsl:function>

  <!-- One model, the k-th part of the element's, applied to the context element. -->
  <xsl:template name="pm:model">
    <xsl:param name="m" as="map(*)"/>
    <xsl:param name="k" as="xs:integer" select="1"/>
    <xsl:param name="first" as="xs:boolean" select="true()"/>
    <xsl:param name="inner" as="node()*" select="()"/>
    <xsl:param name="phrasing" as="xs:boolean" select="false()" tunnel="yes"/>

    <xsl:variable name="behaviour" select="$m?behaviour"/>
    <xsl:variable name="params" select="($m?params, map {})[1]"/>
    <!-- What the views lay over it: a view's omit or, for the same behaviour, its classes and model (a view's sequence overlays part by part). -->
    <xsl:variable name="over" as="map(*)*" select="for $v in $pm:laid?output, $vm in pm:select(., $v)
      return map { 'output': $v, 'model': if ($vm?behaviour = 'sequence') then $vm?parts[$k] else $vm }"/>
    <xsl:variable name="laid" select="$over[?model?behaviour = $behaviour]"/>
    <xsl:variable name="class" select="string-join(('tei-' || local-name(), $m?classes,
      $over ! (if (?model?behaviour = 'omit') then ?output || '-omit' else if (?model?behaviour = $behaviour) then ?model?classes else ()),
      if ($m?source) then pm:renditions(.) else ()), ' ')"/>
    <!-- Params named `data-…` become attributes; params named with a leading double hyphen, CSS custom properties. -->
    <xsl:variable name="attrs" as="attribute()*">
      <xsl:if test="$first and @xml:id"><xsl:attribute name="id" select="@xml:id"/></xsl:if>
      <xsl:if test="@xml:lang"><xsl:attribute name="lang" select="@xml:lang"/></xsl:if>
      <xsl:for-each select="map:keys($params)[starts-with(., 'data-')]">
        <xsl:attribute name="{.}" select="string(head($params(.)))"/>
      </xsl:for-each>
      <xsl:variable name="style" select="string-join(for $k in sort(map:keys($params)[starts-with(., '--')]) return $k || ': ' || string(head($params($k))), '; ')"/>
      <xsl:if test="$style"><xsl:attribute name="style" select="$style"/></xsl:if>
    </xsl:variable>
    <xsl:variable name="level" select="number(string(head($params?level)))"/>
    <xsl:variable name="element" select="if ($behaviour = 'heading') then 'h' || (if ($level ge 1) then min((6, xs:integer(floor($level)))) else 1) else string($m?tag)"/>

    <xsl:choose>
      <xsl:when test="$behaviour = ('omit', 'metadata')"/>
      <!-- pass-through is a TEI Publisher extension. -->
      <xsl:when test="$behaviour = ('text', 'pass-through')">
        <xsl:call-template name="pm:content">
          <xsl:with-param name="m" select="$m"/>
          <xsl:with-param name="params" select="$params"/>
          <xsl:with-param name="phrasing" select="$phrasing"/>
        </xsl:call-template>
      </xsl:when>
      <xsl:when test="$behaviour = 'alternate'">
        <xsl:variable name="default" select="if (map:contains($params, 'default')) then $params?default else *[1]"/>
        <xsl:variable name="alternate" select="if (map:contains($params, 'alternate')) then $params?alternate else *[2]"/>
        <span class="{$class} tei-alternate">
          <xsl:sequence select="$attrs"/>
          <span class="{string-join(('tei-alternate-default', pm:marks(., $default, $laid)), ' ')}">
            <xsl:call-template name="pm:value">
              <xsl:with-param name="value" select="$default"/>
              <xsl:with-param name="phrasing" select="true()"/>
            </xsl:call-template>
          </span>
          <span class="{string-join(('tei-alternate-alt', pm:marks(., $alternate, $laid)), ' ')}" hidden="hidden">
            <xsl:call-template name="pm:value">
              <xsl:with-param name="value" select="$alternate"/>
              <xsl:with-param name="phrasing" select="true()"/>
            </xsl:call-template>
          </span>
        </span>
      </xsl:when>
      <!-- Numbered and collected by pm:edition; a note at the foot counts as one at the end, one elsewhere leaves no marker. -->
      <xsl:when test="$behaviour = 'note'">
        <xsl:variable name="place" select="if (map:contains($params, 'place')) then string(head($params?place)) else 'end'"/>
        <pm:note place="{if ($place = ('end', 'foot')) then 'end' else $place}">
          <a class="{$class} tei-note-ref">
            <xsl:sequence select="$attrs"/>
            <xsl:if test="map:contains($params, 'range')">
              <xsl:attribute name="data-range" select="replace(string(head($params?range)), '^#', '')"/>
            </xsl:if>
          </a>
          <pm:body>
            <xsl:call-template name="pm:content">
              <xsl:with-param name="m" select="$m"/>
              <xsl:with-param name="params" select="$params"/>
              <xsl:with-param name="phrasing" select="false()"/>
            </xsl:call-template>
          </pm:body>
        </pm:note>
      </xsl:when>
      <!-- A line break where a line already starts would be an empty line; a labelled one is its label, then the break. -->
      <xsl:when test="$behaviour = 'break'">
        <xsl:variable name="line" select="string(head($params?type)) = 'line'"/>
        <xsl:if test="not($line and pm:at-line-start(.))">
          <xsl:choose>
            <xsl:when test="not(map:contains($params, 'label'))">
              <br class="{$class}"><xsl:sequence select="$attrs"/></br>
            </xsl:when>
            <xsl:otherwise>
              <span class="{$class}"><xsl:sequence select="$attrs"/><xsl:value-of select="string(head($params?label))"/></span>
              <xsl:if test="$line"><br class="{$class}"><xsl:sequence select="$attrs[not(name() = 'id')]"/></br></xsl:if>
            </xsl:otherwise>
          </xsl:choose>
        </xsl:if>
      </xsl:when>
      <xsl:when test="$behaviour = 'anchor'">
        <xsl:if test="$first and @xml:id"><span class="{$class}"><xsl:sequence select="$attrs"/></span></xsl:if>
      </xsl:when>
      <xsl:when test="$behaviour = 'link'">
        <a class="{$class}" href="{string(head($params?uri))}">
          <xsl:sequence select="$attrs"/>
          <xsl:choose>
            <xsl:when test="exists($inner)"><xsl:sequence select="$inner"/></xsl:when>
            <xsl:otherwise>
              <xsl:call-template name="pm:content">
                <xsl:with-param name="m" select="$m"/>
                <xsl:with-param name="params" select="$params"/>
                <xsl:with-param name="phrasing" select="true()"/>
              </xsl:call-template>
            </xsl:otherwise>
          </xsl:choose>
        </a>
      </xsl:when>
      <xsl:when test="$behaviour = 'graphic'">
        <img class="{$class}" src="{string(head($params?url))}" alt=""><xsl:sequence select="$attrs"/></img>
      </xsl:when>
      <!-- A <model> holding a <modelSequence> (Boot 2024), an extension: a link part wraps the other parts. -->
      <xsl:when test="$behaviour = 'compound'">
        <xsl:variable name="e" select="."/>
        <xsl:variable name="parts" select="$m?parts"/>
        <xsl:variable name="link" select="index-of($parts ! ?behaviour, 'link')[1]"/>
        <xsl:variable name="rest" as="node()*">
          <xsl:for-each select="(1 to count($parts))[not(. = $link)]">
            <xsl:variable name="j" select="."/>
            <xsl:for-each select="$e">
              <xsl:call-template name="pm:model">
                <xsl:with-param name="m" select="$parts[$j]"/>
                <xsl:with-param name="first" select="$j = 1"/>
              </xsl:call-template>
            </xsl:for-each>
          </xsl:for-each>
        </xsl:variable>
        <xsl:choose>
          <xsl:when test="exists($link)">
            <xsl:call-template name="pm:model">
              <xsl:with-param name="m" select="$parts[$link]"/>
              <xsl:with-param name="first" select="$link = 1"/>
              <xsl:with-param name="inner" select="$rest"/>
            </xsl:call-template>
          </xsl:when>
          <xsl:otherwise><xsl:sequence select="$rest"/></xsl:otherwise>
        </xsl:choose>
      </xsl:when>
      <!-- A figure: its content, then its title as the caption. -->
      <xsl:when test="$behaviour = 'figure'">
        <xsl:variable name="caption">
          <xsl:call-template name="pm:value">
            <xsl:with-param name="value" select="$params?title"/>
            <xsl:with-param name="phrasing" select="$phrasing"/>
          </xsl:call-template>
        </xsl:variable>
        <xsl:element name="{if ($phrasing) then 'span' else 'figure'}">
          <xsl:attribute name="class" select="if ($phrasing) then $class || ' pm-block' else $class"/>
          <xsl:sequence select="$attrs"/>
          <xsl:call-template name="pm:content">
            <xsl:with-param name="m" select="$m"/>
            <xsl:with-param name="params" select="$params"/>
            <xsl:with-param name="phrasing" select="$phrasing"/>
          </xsl:call-template>
          <xsl:if test="$caption/node()">
            <xsl:element name="{if ($phrasing) then 'span' else 'figcaption'}"><xsl:sequence select="$caption/node()"/></xsl:element>
          </xsl:if>
        </xsl:element>
      </xsl:when>
      <!-- A table of contents: the headings within, not nested in one another. -->
      <xsl:when test="$behaviour = 'index'">
        <xsl:variable name="heads" select="descendant::head except descendant::head//head"/>
        <xsl:if test="count($heads) ge 2">
          <nav class="tei-toc"><ul><xsl:for-each select="$heads"><li><xsl:value-of select="normalize-space(.)"/></li></xsl:for-each></ul></nav>
        </xsl:if>
      </xsl:when>
      <xsl:when test="$m?flow = 'block' and $phrasing">
        <span class="{$class} pm-block">
          <xsl:sequence select="$attrs"/>
          <xsl:call-template name="pm:content">
            <xsl:with-param name="m" select="$m"/>
            <xsl:with-param name="params" select="$params"/>
            <xsl:with-param name="phrasing" select="true()"/>
          </xsl:call-template>
        </span>
      </xsl:when>
      <xsl:otherwise>
        <xsl:element name="{$element}">
          <xsl:attribute name="class" select="$class"/>
          <xsl:sequence select="$attrs"/>
          <xsl:call-template name="pm:content">
            <xsl:with-param name="m" select="$m"/>
            <xsl:with-param name="params" select="$params"/>
            <xsl:with-param name="phrasing" select="$element = $pm:phrasing"/>
          </xsl:call-template>
        </xsl:element>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

</xsl:stylesheet>
