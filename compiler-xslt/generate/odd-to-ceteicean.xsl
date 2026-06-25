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

  <!-- Behaviours that are just "this element is the styled node": teiStamp puts
       the tei-<id>/r-<id> classes on the custom element and edition.css does the
       rest. (Mirrors CETEI_DISPLAY in the .mjs.) -->
  <xsl:variable name="ceteiDisplay" as="xs:string*"
    select="('inline', 'block', 'paragraph', 'section', 'body', 'cit', 'table', 'row', 'cell', 'title')"/>

  <!-- Escape a string for a single-quoted JS literal (backslash first). -->
  <xsl:function name="local:js" as="xs:string">
    <xsl:param name="s" as="xs:string?"/>
    <xsl:variable name="t1" select="replace(string($s), '\\', '\\\\')"/>
    <xsl:variable name="t2" select="replace($t1, &quot;'&quot;, &quot;\\'&quot;)"/>
    <xsl:variable name="t3" select="replace($t2, '&#10;', '\\n')"/>
    <xsl:sequence select="replace($t3, '&#13;', '\\r')"/>
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
      <xsl:text><![CDATA[// Shared stamping helpers. Styling comes from the generated edition.css (the
// same .tei-<id>/.r-<id> rules the unified and XSLT renderers use), so a
// behaviour only puts those classes on the right node and mirrors @attrs to
// data-* for the attribute selectors (e.g. .tei-rs[data-type='person']).
function teiRcls(el) {
  var r = el.getAttribute('rendition');
  return r ? r.split(/\s+/).filter(Boolean).map(function (t) { return ' r-' + t.replace(/^#/, ''); }).join('') : '';
}
function teiData(el) {
  for (var i = el.attributes.length - 1; i >= 0; i--) {
    var n = el.attributes[i].name;
    if (n === 'class' || n === 'style' || n.slice(0, 5) === 'data-') continue;
    el.setAttribute('data-' + n.replace(/[:.]/g, '-'), el.attributes[i].value);
  }
}
function teiStamp(el, ident) { teiData(el); el.className = 'tei-' + ident + teiRcls(el); }
function teiReshape(el, tag, ident) {
  teiData(el);
  var n = document.createElement(tag);
  n.className = 'tei-' + ident + teiRcls(el);
  n.innerHTML = el.innerHTML;
  el.style.display = 'contents';
  el.innerHTML = '';
  el.appendChild(n);
  return n;
}
]]>&#10;</xsl:text>
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
        <xsl:text>      // compound (Boot nested model): link wraps graphic — one clickable&#10;</xsl:text>
        <xsl:text>      // thumbnail (&lt;a&gt;&lt;figure&gt;&lt;img&gt;&lt;/figure&gt;&lt;/a&gt;), identical to unified/XSLT.&#10;</xsl:text>
        <xsl:text>      teiData(el); el.style.display = 'contents';&#10;</xsl:text>
        <xsl:text>      var a = document.createElement('a'); a.className = 'tei-</xsl:text><xsl:value-of select="$ident"/><xsl:text>'; a.href = </xsl:text><xsl:value-of select="local:param-js($uri)"/><xsl:text>;&#10;</xsl:text>
        <xsl:text>      var fig = document.createElement('figure'); fig.className = 'tei-</xsl:text><xsl:value-of select="$ident"/><xsl:text>';&#10;</xsl:text>
        <xsl:text>      var img = document.createElement('img'); img.src = </xsl:text><xsl:value-of select="local:param-js($url)"/><xsl:text>; img.loading = 'lazy';&#10;</xsl:text>
        <xsl:text>      var desc = el.querySelector('tei-desc'); img.alt = desc ? desc.textContent : '';&#10;</xsl:text>
        <xsl:text>      fig.appendChild(img); a.appendChild(fig); el.innerHTML = ''; el.appendChild(a);</xsl:text>
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
    <xsl:choose>
      <xsl:when test="$b = $ceteiDisplay">
        <xsl:text>      teiStamp(el, </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>);</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'document'">
        <xsl:text>      teiStamp(el, </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>); el.style.display = 'block';</xsl:text>
      </xsl:when>

      <xsl:when test="$b = ('metadata', 'omit')">
        <xsl:text>      el.style.display = 'none';</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'heading'">
        <xsl:variable name="level" select="if (map:contains($p, 'level')) then $p('level') else '1'"/>
        <xsl:choose>
          <xsl:when test="$level = 'count(ancestor::div)'">
            <xsl:text><![CDATA[      var level = 0, p = el.parentElement;
      while (p) { if (p.localName === 'tei-div') level++; p = p.parentElement; }
      teiReshape(el, 'h' + Math.min(6, Math.max(1, level)), ']]></xsl:text>
            <xsl:value-of select="$ident"/><xsl:text>');</xsl:text>
          </xsl:when>
          <xsl:otherwise>
            <xsl:variable name="lv"
              select="if ($level castable as xs:integer) then min((6, max((1, xs:integer($level))))) else 1"/>
            <xsl:text>      teiReshape(el, 'h</xsl:text><xsl:value-of select="$lv"/><xsl:text>', </xsl:text>
            <xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>);</xsl:text>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:when>

      <xsl:when test="$b = 'note'">
        <xsl:text><![CDATA[      teiData(el);
      var idx = ++window.__teiNoteCounter;
      var content = el.innerHTML;
      el.className = 'tei-note-interactive';
      el.innerHTML = '<a class="tei-note-ref" href="#" role="doc-noteref"><sup>' + idx + '</sup></a>' +
        '<span class="tei-note-body" role="doc-footnote">' + content + '</span>';]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'link'">
        <xsl:variable name="uri" select="if (map:contains($p, 'uri')) then $p('uri') else '@target'"/>
        <xsl:variable name="attr" select="if (starts-with($uri, '@')) then substring($uri, 2) else 'target'"/>
        <xsl:text>      var a = teiReshape(el, 'a', </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>);&#10;</xsl:text>
        <xsl:text>      var href = el.getAttribute(</xsl:text><xsl:value-of select="$q"/><xsl:value-of select="local:js($attr)"/><xsl:value-of select="$q"/><xsl:text>) || '';&#10;</xsl:text>
        <xsl:text><![CDATA[      a.setAttribute('href', href);
      if (href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'alternate'">
        <xsl:text>      teiData(el);&#10;      el.className = 'tei-alternate tei-</xsl:text><xsl:value-of select="$ident"/><xsl:text>';&#10;</xsl:text>
        <xsl:text><![CDATA[      var kids = [];
      for (var i = 0; i < el.children.length; i++) kids.push(el.children[i]);
      var def = document.createElement('span'); def.className = 'tei-alternate-default';
      var alt = document.createElement('span'); alt.className = 'tei-alternate-alt'; alt.hidden = true;
      if (kids[0]) def.appendChild(kids[0]);
      if (kids[1]) alt.appendChild(kids[1]);
      el.innerHTML = '';
      el.appendChild(def); el.appendChild(alt);]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'graphic'">
        <xsl:variable name="url" select="if (map:contains($p, 'url')) then $p('url') else '@url'"/>
        <xsl:variable name="attr" select="if (starts-with($url, '@')) then substring($url, 2) else 'url'"/>
        <xsl:text>      teiData(el); el.style.display = 'contents';&#10;</xsl:text>
        <xsl:text>      var fig = document.createElement('figure'); fig.className = 'tei-</xsl:text><xsl:value-of select="$ident"/><xsl:text>';&#10;</xsl:text>
        <xsl:text>      var img = document.createElement('img');&#10;</xsl:text>
        <xsl:text>      img.src = el.getAttribute(</xsl:text><xsl:value-of select="$q"/><xsl:value-of select="local:js($attr)"/><xsl:value-of select="$q"/><xsl:text>) || '';&#10;</xsl:text>
        <xsl:text><![CDATA[      img.loading = 'lazy';
      var desc = el.querySelector('tei-desc'); img.alt = desc ? desc.textContent : '';
      fig.appendChild(img); el.innerHTML = ''; el.appendChild(fig);]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'list'">
        <xsl:text>      teiReshape(el, 'ul', </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>);</xsl:text>
      </xsl:when>
      <xsl:when test="$b = 'listItem'">
        <xsl:text>      teiReshape(el, 'li', </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>);</xsl:text>
      </xsl:when>
      <xsl:when test="$b = 'break'">
        <xsl:text>      teiReshape(el, 'br', </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>);</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'anchor'">
        <xsl:text>      teiData(el); el.className = 'tei-anchor'; el.id = el.getAttribute('xml:id') || '';</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'glyph'">
        <xsl:text>      teiData(el); el.className = 'tei-glyph';</xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'index'">
        <xsl:text><![CDATA[      var heads = el.querySelectorAll('tei-head');
      if (heads.length >= 2) {
        el.style.display = 'contents';
        var nav = document.createElement('nav'); nav.className = 'tei-toc'; nav.setAttribute('aria-label', 'Contents');
        var lab = document.createElement('p'); lab.className = 'tei-toc-label'; lab.textContent = 'Contents'; nav.appendChild(lab);
        var ul = document.createElement('ul');
        heads.forEach(function (hd) { var li = document.createElement('li'); li.className = 'tei-toc-entry'; li.textContent = hd.textContent.trim(); ul.appendChild(li); });
        nav.appendChild(ul); el.innerHTML = ''; el.appendChild(nav);
      } else { el.style.display = 'none'; }]]></xsl:text>
      </xsl:when>

      <xsl:when test="$b = 'text'">
        <xsl:text>      el.style.display = 'contents';</xsl:text>
      </xsl:when>

      <xsl:otherwise>
        <xsl:text>      teiStamp(el, </xsl:text><xsl:value-of select="$q"/><xsl:value-of select="$ident"/><xsl:value-of select="$q"/><xsl:text>); // </xsl:text><xsl:value-of select="$b"/>
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
  <!-- The ODD-generated stylesheet — the SAME one the unified/XSLT pages use.
       CETEIcean's behaviours stamp the matching tei-*/r-* classes onto the
       custom elements, so this drives the appearance and the output looks
       identical across renderers. -->
  <link rel="stylesheet" href="edition.css">
  <style>
    /* Shared page chrome — identical to the unified/XSLT pages so every renderer
       looks the same; only the render-info banner colour differs (pink). */
    body.tei-edition { max-width: 42em; margin: 2em auto; padding: 0 1em; font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; line-height: 1.7; color: #222; background: #fefefe; }
    /* CETEIcean makes a custom element per TEI element; the structural wrappers
       with no Processing-Model behaviour still need to be block-level. */
    tei-TEI, tei-text, tei-front, tei-body, tei-group { display: block; }
    .render-info { font-family: system-ui, sans-serif; background: #fce7f3; border: 1px solid #f9a8d4; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
    .render-info h3 { margin: 0 0 0.5em; color: #db2777; }
    .render-info code { background: #fdf2f8; padding: 0.1em 0.3em; border-radius: 3px; }
    /* Facsimile thumbnails (pb compound), resetting the colliding .tei-pb floor rules. */
    a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px; margin: 1.2em auto; padding: 4px; border: 1px solid #ccc; background: #fafafa; line-height: 0; }
    a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none; margin: 0; border: 0; }
    a.tei-pb img { display: block; width: 100%; height: auto; }
    /* Interactive layer (notes, apparatus, facsimile toggle). */
    .tei-note-interactive .tei-note-body { display: none; }
    .tei-note-interactive.open .tei-note-body { display: inline; background: #fffde7; border: 1px solid #e0e0e0; padding: 0.15em 0.4em; border-radius: 4px; }
    .tei-note-ref { cursor: pointer; color: #2563eb; text-decoration: none; }
    .tei-alternate { cursor: pointer; border-bottom: 1px dotted #999; }
    .facs-toggle { display: none; margin: 0 0 1.2em; font-family: system-ui, sans-serif; }
    html.js .facs-toggle { display: block; }
    .facs-toggle button { font: inherit; font-size: 0.85em; cursor: pointer; padding: 0.3em 0.8em; border: 1px solid #c7c7c7; border-radius: 4px; background: #f3f3f3; }
    body.facs-hidden a.tei-pb { display: none; }
  </style>
</head>
<body class="tei-edition">

  <div class="render-info">
    <h3>CETEIcean Rendering Path (XSLT-generated behaviours)</h3>
    <p><strong>Pipeline:</strong> ODD &#8594; <code>odd-to-ceteicean.xsl</code> &#8594; behaviours.js &#8594; CETEIcean (browser) &#8594; HTML</p>
    <p>CETEIcean registers TEI elements as <code>tei-</code> custom elements, then
      applies ODD-derived behaviours that stamp the same <code>tei-*</code>/<code>r-*</code>
      classes the other renderers use — so the shared <code>edition.css</code>
      produces the same result. Click notes to expand; click corrections to toggle
      readings.</p>
  </div>

  <div class="facs-toggle"><button type="button" data-facs-toggle="">Hide facsimiles</button></div>

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

  <!-- Shared interactive layer — the same framework-free handler the XSLT
       interactive page uses. Event delegation, so it works no matter when
       CETEIcean finishes building the DOM. -->
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

</body>
</html>
]]></xsl:text>
  </xsl:template>

</xsl:stylesheet>
