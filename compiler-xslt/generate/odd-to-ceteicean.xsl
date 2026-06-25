<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-to-ceteicean.xsl — the "generate" step for the CETEIcean target, in XSLT.

  Reads a TEI ODD and emits two text files:
    * tei-ceteicean-behaviours.js  (principal output) — a CETEIcean behaviour
      map derived from the Processing Model;
    * rendered-ceteicean.html      (via xsl:result-document) — a self-contained
      demo page that loads CETEIcean, the behaviours, and the TEI, then renders
      client-side.

  The XSLT counterpart of odd-to-ceteicean.mjs. The emitted JavaScript behaviour
  bodies are the same code the .mjs emits — only the generator language differs.

  Run:  saxon -s:../examples/tei_simler.odd -xsl:generate/odd-to-ceteicean.xsl \
              -o:output/tei-ceteicean-behaviours.js tei=simler-poem.xml
  The `tei` parameter is the TEI file's name, resolved next to the ODD.
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:local="urn:x-poc:odd"
  exclude-result-prefixes="tei xs map local">

  <xsl:output method="text" encoding="UTF-8"/>

  <!-- TEI file name, resolved against the ODD's directory and inlined into the
       demo page so it renders from file:// without a server. -->
  <xsl:param name="tei" select="'simler-poem.xml'"/>

  <!-- A single-quote character, for building JS string literals. -->
  <xsl:variable name="q" select="''''"/>

  <!-- Resolve <specGrpRef> within one document, returning the elementSpecs in
       reference order. Same single-document resolution as the other generators:
       no @source fetching, no odd2odd flattening; addressable <specGrp> groups
       contribute only where referenced, dangling refs skipped, cycles guarded. -->
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
      </xsl:choose>
    </xsl:for-each>
  </xsl:function>

  <xsl:variable name="specs" as="element(tei:elementSpec)*"
    select="if (exists(//tei:specGrpRef))
            then local:schema-specs(//tei:schemaSpec/node(), ())[tei:model or tei:modelSequence]
            else //tei:elementSpec[tei:model or tei:modelSequence]"/>

  <!-- Behaviours whose CETEIcean handling is just "set this CSS display value"
       (display from behaviour-map.mjs). -->
  <xsl:variable name="ceteiDisplay" as="map(xs:string, xs:string)" select="map {
    'block'    : 'block',
    'paragraph': 'block',
    'section'  : 'block',
    'body'     : 'block',
    'break'    : 'block',
    'cit'      : 'block',
    'table'    : 'table',
    'row'      : 'table-row',
    'cell'     : 'table-cell'
  }"/>

  <!-- Escape a string for a single-quoted JS literal (backslash first). -->
  <xsl:function name="local:js" as="xs:string">
    <xsl:param name="s" as="xs:string?"/>
    <xsl:variable name="t1" select="replace(string($s), '\\', '\\\\')"/>
    <xsl:variable name="t2" select="replace($t1, &quot;'&quot;, &quot;\\'&quot;)"/>
    <xsl:variable name="t3" select="replace($t2, '&#10;', '\\n')"/>
    <xsl:sequence select="replace($t3, '&#13;', '\\r')"/>
  </xsl:function>

  <!-- Non-scoped outputRendition fragments → one CSS string, trailing ; stripped. -->
  <xsl:function name="local:cssprop" as="xs:string">
    <xsl:param name="model" as="element(tei:model)"/>
    <xsl:variable name="joined"
      select="normalize-space(string-join($model/tei:outputRendition[not(@scope)], ' '))"/>
    <xsl:sequence select="replace($joined, ';\s*$', '')"/>
  </xsl:function>

  <!-- A PM @predicate → a CETEIcean JS condition (mirrors predicateToCETEI):
       @a='v'/@a become el.matches() selectors; parent::/ancestor:: become tree
       checks; anything else falls back to a TODO-marked true. -->
  <xsl:function name="local:predicate-cond" as="xs:string">
    <xsl:param name="pred" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="matches($pred, '^@\i\c*=''[^'']*''$')">
        <xsl:variable name="sel" select="replace($pred, '^@(\i\c*)=''([^'']*)''$', '[$1=''$2'']')"/>
        <xsl:sequence select="concat('el.matches(', $q, local:js($sel), $q, ')')"/>
      </xsl:when>
      <xsl:when test="matches($pred, '^@\i\c*$')">
        <xsl:sequence select="concat('el.matches(', $q, '[', substring($pred, 2), ']', $q, ')')"/>
      </xsl:when>
      <xsl:when test="matches($pred, '^parent::\i\c*$')">
        <xsl:sequence select="concat('el.parentElement &amp;&amp; el.parentElement.localName === ',
          $q, 'tei-', substring-after($pred, 'parent::'), $q)"/>
      </xsl:when>
      <xsl:when test="matches($pred, '^ancestor::\i\c*$')">
        <xsl:sequence select="concat('el.closest(', $q, 'tei-', substring-after($pred, 'ancestor::'),
          $q, ') !== null')"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:message select="'[odd-to-ceteicean] ⚠ unsupported predicate, left as fallback: ' || $pred"/>
        <xsl:sequence select="concat('true /* TODO: ', replace($pred, '\*/', '* /'), ' */')"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- A link/graphic uri/url param → a JS expression over el (mirrors the JS
       paramValueToCeteiJs): @attr, a 'literal', or concat() of those. -->
  <xsl:function name="local:param-js" as="xs:string">
    <xsl:param name="value" as="xs:string?"/>
    <xsl:variable name="v" select="normalize-space(string($value))"/>
    <xsl:choose>
      <xsl:when test="matches($v, '^@[\w:.\-]+$')">
        <xsl:sequence select="concat('el.getAttribute(', $q, substring($v, 2), $q, ') || ', $q, $q)"/>
      </xsl:when>
      <xsl:when test="matches($v, '^''[^'']*''$')">
        <xsl:sequence select="concat($q, local:js(substring($v, 2, string-length($v) - 2)), $q)"/>
      </xsl:when>
      <xsl:when test="matches($v, '^concat\(.*\)$')">
        <xsl:variable name="inner" select="replace($v, '^concat\((.*)\)$', '$1')"/>
        <xsl:variable name="parts" as="xs:string*"
          select="local:split-args(for $i in 1 to string-length($inner) return substring($inner, $i, 1), '', false())"/>
        <xsl:sequence select="string-join(for $p in $parts return concat('(', local:param-js($p), ')'), ' + ')"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="concat($q, local:js($v), $q)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- Split concat() arguments on top-level commas, respecting '...' literals. -->
  <xsl:function name="local:split-args" as="xs:string*">
    <xsl:param name="chars" as="xs:string*"/>
    <xsl:param name="cur" as="xs:string"/>
    <xsl:param name="inq" as="xs:boolean"/>
    <xsl:choose>
      <xsl:when test="empty($chars)">
        <xsl:if test="normalize-space($cur) ne ''">
          <xsl:sequence select="$cur"/>
        </xsl:if>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="c" select="$chars[1]"/>
        <xsl:variable name="rest" select="subsequence($chars, 2)"/>
        <xsl:choose>
          <xsl:when test="$c eq $q">
            <xsl:sequence select="local:split-args($rest, concat($cur, $c), not($inq))"/>
          </xsl:when>
          <xsl:when test="$c eq ',' and not($inq)">
            <xsl:sequence select="$cur"/>
            <xsl:sequence select="local:split-args($rest, '', $inq)"/>
          </xsl:when>
          <xsl:otherwise>
            <xsl:sequence select="local:split-args($rest, concat($cur, $c), $inq)"/>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- ===================================================================== -->

  <xsl:template match="/">
    <xsl:variable name="behaviours">
      <xsl:text>/* tei-ceteicean-behaviours.js — generated from the TEI ODD Processing Model (odd-to-ceteicean.xsl) */&#10;</xsl:text>
      <xsl:text>window.__teiNoteCounter = 0;&#10;&#10;</xsl:text>
      <xsl:text>const defined = {&#10;  "tei": {&#10;</xsl:text>
      <xsl:apply-templates select="$specs" mode="ceteicean"/>
      <xsl:text>  }&#10;};&#10;&#10;</xsl:text>
      <xsl:text>if (typeof module !== 'undefined') module.exports = defined;&#10;</xsl:text>
      <xsl:text>if (typeof window !== 'undefined') window.defined = defined;&#10;</xsl:text>
    </xsl:variable>

    <!-- principal output: the behaviours JS -->
    <xsl:value-of select="$behaviours"/>

    <!-- the TEI, read once and inlined into the demo page -->
    <xsl:variable name="teiUri" select="resolve-uri($tei, base-uri(/))"/>
    <xsl:variable name="teiText"
      select="if (unparsed-text-available($teiUri)) then unparsed-text($teiUri) else ''"/>

    <xsl:result-document href="rendered-ceteicean.html" method="text">
      <xsl:call-template name="html-page">
        <xsl:with-param name="behaviours" select="$behaviours"/>
        <xsl:with-param name="teiText" select="$teiText"/>
      </xsl:call-template>
    </xsl:result-document>
  </xsl:template>

  <!-- One elementSpec → one "<ident>": function(el) { … } entry. -->
  <xsl:template match="tei:elementSpec" mode="ceteicean">
    <xsl:variable name="ident" select="string(@ident)"/>
    <!-- A unit is a top-level <model> (a nested one stays whole — a compound) or
         a <model> from a top-level <modelSequence>. -->
    <xsl:variable name="units" as="element(tei:model)*"
      select="tei:model, tei:modelSequence/tei:model"/>
    <xsl:if test="exists($units)">
      <xsl:variable name="predicated" select="$units[@predicate]"/>
      <xsl:variable name="plain" select="$units[not(@predicate)]"/>
      <xsl:text>    // &lt;</xsl:text><xsl:value-of select="$ident"/><xsl:text>&gt;&#10;</xsl:text>
      <xsl:choose>
        <!-- single unit, no predicate → a plain function -->
        <xsl:when test="count($units) = 1 and empty($predicated)">
          <xsl:text>    "</xsl:text><xsl:value-of select="$ident"/><xsl:text>": function(el) {&#10;</xsl:text>
          <xsl:call-template name="emit-unit">
            <xsl:with-param name="unit" select="$units[1]"/>
            <xsl:with-param name="ident" select="$ident"/>
          </xsl:call-template>
          <xsl:text>&#10;    },&#10;</xsl:text>
        </xsl:when>
        <!-- otherwise a function dispatching on predicate, then the default -->
        <xsl:otherwise>
          <xsl:text>    "</xsl:text><xsl:value-of select="$ident"/><xsl:text>": function(el) {&#10;</xsl:text>
          <xsl:for-each select="$predicated">
            <xsl:text>      if (</xsl:text>
            <xsl:value-of select="local:predicate-cond(string(@predicate))"/>
            <xsl:text>) {&#10;</xsl:text>
            <xsl:call-template name="emit-unit">
              <xsl:with-param name="unit" select="."/>
              <xsl:with-param name="ident" select="$ident"/>
            </xsl:call-template>
            <xsl:text>&#10;        return;&#10;      }&#10;</xsl:text>
          </xsl:for-each>
          <xsl:if test="exists($plain)">
            <xsl:text>      // default&#10;</xsl:text>
            <xsl:call-template name="emit-unit">
              <xsl:with-param name="unit" select="$plain[1]"/>
              <xsl:with-param name="ident" select="$ident"/>
            </xsl:call-template>
            <xsl:text>&#10;</xsl:text>
          </xsl:if>
          <xsl:text>    },&#10;</xsl:text>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:if>
  </xsl:template>

  <!-- Emit one unit: a compound (nested <modelSequence>) or a plain behaviour. -->
  <xsl:template name="emit-unit">
    <xsl:param name="unit" as="element(tei:model)"/>
    <xsl:param name="ident" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="$unit/tei:modelSequence">
        <xsl:call-template name="emit-compound">
          <xsl:with-param name="subs" select="$unit/tei:modelSequence/tei:model"/>
          <xsl:with-param name="ident" select="$ident"/>
        </xsl:call-template>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="emit-behaviour">
          <xsl:with-param name="model" select="$unit"/>
          <xsl:with-param name="ident" select="$ident"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Compound (Boot nested model): when the sub-models are a link + a graphic,
       the link WRAPS the graphic so a <pb> renders as one clickable thumbnail,
       matching the unified/XSLT output. Other shapes fall back to the first
       sub-model. -->
  <xsl:template name="emit-compound">
    <xsl:param name="subs" as="element(tei:model)*"/>
    <xsl:param name="ident" as="xs:string"/>
    <xsl:variable name="link" select="$subs[@behaviour = 'link'][1]"/>
    <xsl:variable name="graphic" select="$subs[@behaviour = 'graphic'][1]"/>
    <xsl:choose>
      <xsl:when test="$link and $graphic">
        <xsl:variable name="uri"
          select="if ($link/tei:param[@name='uri']) then string($link/tei:param[@name='uri']/@value) else '@target'"/>
        <xsl:variable name="url"
          select="if ($graphic/tei:param[@name='url']) then string($graphic/tei:param[@name='url']/@value) else '@url'"/>
        <xsl:text>      // compound (Boot nested model): link wraps graphic — one clickable thumbnail&#10;</xsl:text>
        <xsl:text>      var href = </xsl:text><xsl:value-of select="local:param-js($uri)"/><xsl:text>;&#10;</xsl:text>
        <xsl:text>      var src = </xsl:text><xsl:value-of select="local:param-js($url)"/><xsl:text>;&#10;</xsl:text>
        <xsl:text>      var a = document.createElement('a');&#10;</xsl:text>
        <xsl:text>      a.className = 'tei-</xsl:text><xsl:value-of select="$ident"/><xsl:text>';&#10;</xsl:text>
        <xsl:text>      a.href = href;&#10;</xsl:text>
        <xsl:text>      var fig = document.createElement('figure');&#10;</xsl:text>
        <xsl:text>      fig.className = 'tei-</xsl:text><xsl:value-of select="$ident"/><xsl:text>';&#10;</xsl:text>
        <xsl:text>      var img = document.createElement('img');&#10;</xsl:text>
        <xsl:text>      img.src = src;&#10;</xsl:text>
        <xsl:text>      img.loading = 'lazy';&#10;</xsl:text>
        <xsl:text>      var desc = el.querySelector('tei-desc');&#10;</xsl:text>
        <xsl:text>      if (desc) { img.alt = desc.textContent; }&#10;</xsl:text>
        <xsl:text>      fig.appendChild(img);&#10;</xsl:text>
        <xsl:text>      a.appendChild(fig);&#10;</xsl:text>
        <xsl:text>      el.innerHTML = '';&#10;</xsl:text>
        <xsl:text>      el.appendChild(a);</xsl:text>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="emit-behaviour">
          <xsl:with-param name="model" select="$subs[1]"/>
          <xsl:with-param name="ident" select="$ident"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- The JS body for one model's behaviour. -->
  <xsl:template name="emit-behaviour">
    <xsl:param name="model" as="element(tei:model)"/>
    <xsl:param name="ident" as="xs:string"/>
    <xsl:variable name="b" select="string($model/@behaviour)"/>
    <xsl:variable name="p" as="map(xs:string, xs:string)">
      <xsl:map>
        <xsl:for-each select="$model/tei:param">
          <xsl:map-entry key="string(@name)" select="string(@value)"/>
        </xsl:for-each>
      </xsl:map>
    </xsl:variable>
    <xsl:variable name="css" select="local:cssprop($model)"/>
    <!-- append (not assign) so a parent behaviour's earlier style survives -->
    <xsl:variable name="styleSet"
      select="if ($css ne '') then concat('&#10;      el.style.cssText += ', $q, local:js($css), $q, ';') else ''"/>

    <xsl:choose>
      <xsl:when test="map:contains($ceteiDisplay, $b)">
        <xsl:text>      el.style.display = </xsl:text>
        <xsl:value-of select="$q"/><xsl:value-of select="$ceteiDisplay($b)"/><xsl:value-of select="$q"/>
        <xsl:text>;</xsl:text><xsl:value-of select="$styleSet"/>
      </xsl:when>

      <xsl:when test="$b = 'inline'">
        <xsl:text>      // inline behaviour</xsl:text>
        <xsl:value-of select="$styleSet"/>
        <xsl:text>&#10;      // Content stays as-is in the custom element</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'document'">
        <xsl:text>      el.style.display = 'block';</xsl:text><xsl:value-of select="$styleSet"/>
      </xsl:when>

      <xsl:when test="$b = ('metadata', 'omit')">
        <xsl:text>      el.style.display = 'none'; // metadata/omit</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'heading'">
        <xsl:variable name="level" select="if (map:contains($p, 'level')) then $p('level') else '1'"/>
        <xsl:choose>
          <xsl:when test="$level = 'count(ancestor::div)'">
            <xsl:text><![CDATA[      // heading: level = number of ancestor tei-div elements
      var level = 0;
      var p = el.parentElement;
      while (p) { if (p.localName === 'tei-div') level++; p = p.parentElement; }
      level = Math.min(6, Math.max(1, level));
      var h = document.createElement('h' + level);
      h.innerHTML = el.innerHTML;
      h.style.cssText = ']]></xsl:text>
            <xsl:value-of select="local:js($css)"/>
            <xsl:text><![CDATA[';
      el.innerHTML = '';
      el.appendChild(h);]]></xsl:text>
          </xsl:when>
          <xsl:otherwise>
            <xsl:variable name="lv"
              select="if ($level castable as xs:integer) then min((6, max((1, xs:integer($level))))) else 1"/>
            <xsl:text><![CDATA[      var h = document.createElement('h]]></xsl:text>
            <xsl:value-of select="$lv"/>
            <xsl:text><![CDATA[');
      h.innerHTML = el.innerHTML;
      h.style.cssText = ']]></xsl:text>
            <xsl:value-of select="local:js($css)"/>
            <xsl:text><![CDATA[';
      el.innerHTML = '';
      el.appendChild(h);]]></xsl:text>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:when>

      <xsl:when test="$b = 'note'">
        <xsl:text><![CDATA[      // note behaviour: inline superscript marker + collapsible body
      var idx = ++window.__teiNoteCounter;
      var noteId = 'note-' + idx;
      var content = el.innerHTML;
      el.innerHTML = '<a class="tei-note-ref" href="#' + noteId + '" role="doc-noteref">' +
        '<sup>' + idx + '</sup></a>' +
        '<span class="tei-note-body" id="' + noteId + '" role="doc-footnote" style="display:none">' +
        content + '</span>';
      el.querySelector('.tei-note-ref').addEventListener('click', function(e) {
        e.preventDefault();
        var body = el.querySelector('.tei-note-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'link'">
        <xsl:variable name="uri" select="if (map:contains($p, 'uri')) then $p('uri') else '@target'"/>
        <xsl:variable name="attr" select="if (starts-with($uri, '@')) then substring($uri, 2) else 'target'"/>
        <xsl:text><![CDATA[      // link behaviour
      var href = el.getAttribute(']]></xsl:text>
        <xsl:value-of select="local:js($attr)"/>
        <xsl:text><![CDATA[') || '';
      var a = document.createElement('a');
      a.href = href;
      a.innerHTML = el.innerHTML;
      a.className = 'tei-link';
      if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      el.innerHTML = '';
      el.appendChild(a);]]></xsl:text>
        <xsl:value-of select="$styleSet"/>
      </xsl:when>

      <xsl:when test="$b = 'alternate'">
        <xsl:text><![CDATA[      // alternate behaviour: toggle between default and alt readings
      var children = Array.from(el.children);
      if (children.length >= 2) {
        var def = children[0];
        var alt = children[1];
        alt.style.display = 'none';
        el.style.cursor = 'pointer';
        el.style.borderBottom = '1px dotted #999';
        el.setAttribute('role', 'switch');
        el.setAttribute('aria-checked', 'false');
        el.setAttribute('tabindex', '0');
        el.title = 'Click to toggle between readings';
        var toggle = function() {
          var showDef = def.style.display !== 'none';
          def.style.display = showDef ? 'none' : '';
          alt.style.display = showDef ? '' : 'none';
          el.setAttribute('aria-checked', String(showDef));
        };
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'graphic'">
        <xsl:variable name="url" select="if (map:contains($p, 'url')) then $p('url') else '@url'"/>
        <xsl:variable name="attr" select="if (starts-with($url, '@')) then substring($url, 2) else 'url'"/>
        <xsl:text><![CDATA[      // graphic behaviour
      var src = el.getAttribute(']]></xsl:text>
        <xsl:value-of select="local:js($attr)"/>
        <xsl:text><![CDATA[') || '';
      var img = document.createElement('img');
      img.src = src;
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      var desc = el.querySelector('tei-desc');
      if (desc) { img.alt = desc.textContent; }
      el.innerHTML = '';
      el.appendChild(img);]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'list'">
        <xsl:text><![CDATA[      // list -> ul
      var ul = document.createElement('ul');
      ul.innerHTML = el.innerHTML;
      ul.style.cssText = ']]></xsl:text>
        <xsl:value-of select="local:js($css)"/>
        <xsl:text><![CDATA[';
      el.innerHTML = '';
      el.appendChild(ul);]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'listItem'">
        <xsl:text><![CDATA[      // listItem -> li
      var li = document.createElement('li');
      li.innerHTML = el.innerHTML;
      li.style.cssText = ']]></xsl:text>
        <xsl:value-of select="local:js($css)"/>
        <xsl:text><![CDATA[';
      el.innerHTML = '';
      el.appendChild(li);]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'anchor'">
        <xsl:text>      el.id = el.getAttribute('xml:id') || '';</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'glyph'">
        <xsl:text><![CDATA[      el.classList.add('tei-glyph-unresolved');
      el.title = 'Glyph: ' + (el.getAttribute('ref') || '');]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'index'">
        <xsl:text>      el.classList.add('tei-index-entry');</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'text'">
        <xsl:text>      // pass through</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'title'">
        <xsl:text>      </xsl:text><xsl:value-of select="$styleSet"/>
      </xsl:when>

      <xsl:otherwise>
        <xsl:text>      // unhandled behaviour: </xsl:text>
        <xsl:value-of select="$b"/><xsl:value-of select="$styleSet"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- The self-contained demo page: CETEIcean + the behaviours + the inlined TEI. -->
  <xsl:template name="html-page">
    <xsl:param name="behaviours" as="xs:string"/>
    <xsl:param name="teiText" as="xs:string"/>
    <xsl:text><![CDATA[<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CETEIcean Rendering — TEI Edition (XSLT-generated behaviours)</title>
  <style>
    body { font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; max-width: 42em; margin: 2em auto; padding: 0 1em; background: #fefefe; color: #222; line-height: 1.7; }
    .render-info { font-family: system-ui, sans-serif; background: #fce7f3; border: 1px solid #f9a8d4; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
    .render-info h3 { margin: 0 0 0.5em; color: #db2777; }
    .render-info code { background: #fdf2f8; padding: 0.1em 0.3em; border-radius: 3px; }
    tei-teiheader { display: none; }
    tei-text, tei-body { display: block; }
    tei-div { display: block; margin-bottom: 1.5em; }
    tei-p { display: block; text-indent: 1em; margin: 0.3em 0; }
    tei-persname { color: #8e44ad; }
    tei-placename { color: #27ae60; }
    tei-lb { display: block; }
    tei-pb { display: block; border-top: 1px dashed #ccc; margin: 1em 0; padding-top: 0.3em; }
    tei-pb::before { content: "[p. " attr(n) "]"; color: #999; font-size: 0.8em; }
    tei-note { display: inline; }
    tei-note .tei-note-ref { color: #2563eb; text-decoration: none; cursor: pointer; }
    tei-note .tei-note-ref sup { font-size: 0.75em; }
    tei-note .tei-note-body { display: block; background: #fffde7; border: 1px solid #e0e0e0; padding: 0.5em 0.75em; margin: 0.25em 0; font-size: 0.9em; border-radius: 4px; }
    tei-choice { border-bottom: 1px dotted #999; cursor: pointer; }
    tei-quote { display: block; margin: 1em 2em; font-style: italic; border-left: 3px solid #bdc3c7; padding-left: 1em; }
    tei-list { display: block; margin-left: 1.5em; }
    tei-item { display: list-item; margin-bottom: 0.2em; }
    tei-ref { color: #2980b9; text-decoration: underline; cursor: pointer; }
    tei-rs[type="person"] { color: #8e44ad; }
    tei-rs[type="place"] { color: #27ae60; }
    tei-rs[type="org"] { color: #2980b9; }
    tei-rs[type="bibl"] { font-style: italic; }
    tei-hi[rend="bold"] { font-weight: bold; }
    tei-hi[rend="italic"] { font-style: italic; }
    tei-hi[rend="sup"] { vertical-align: super; font-size: 0.8em; }
  </style>
</head>
<body>

  <div class="render-info">
    <h3>CETEIcean Rendering Path (XSLT-generated behaviours)</h3>
    <p><strong>Pipeline:</strong> ODD &#8594; <code>odd-to-ceteicean.xsl</code> &#8594; behaviours.js &#8594; CETEIcean (browser) &#8594; HTML</p>
    <p>Click notes to expand; click abbreviations/corrections to toggle readings.</p>
  </div>

  <div id="TEI"></div>

  <script type="application/xml" id="tei-source">]]></xsl:text>
    <xsl:value-of select="$teiText"/>
    <xsl:text><![CDATA[</script>

  <script src="https://github.com/TEIC/CETEIcean/releases/download/v1.9.5/CETEI.js"></script>

  <script>
]]></xsl:text>
    <xsl:value-of select="$behaviours"/>
    <xsl:text><![CDATA[
  </script>

  <script>
    var ct = new CETEI();
    ct.addBehaviors(defined);
    var src = document.getElementById('tei-source').textContent;
    if (src && src.trim()) {
      var doc = new DOMParser().parseFromString(src, 'application/xml');
      ct.domToHTML5(doc, function(data) { document.getElementById('TEI').appendChild(data); });
    } else {
      document.getElementById('TEI').textContent = 'No inline TEI source found.';
    }
  </script>

</body>
</html>
]]></xsl:text>
  </xsl:template>

</xsl:stylesheet>
