<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-to-ceteicean.xsl — the "generate" step for the CETEIcean tier, in XSLT.

  Emits tei-ceteicean-behaviours.js (the runtime ../../runtime/ceteicean.js and
  the ODD's models as JSON) and, via xsl:result-document, rendered-ceteicean.html,
  a page that renders the TEI in the browser. The tier is a subset of the
  Processing Model, the same as in odd-to-ceteicean.mjs: models without @output
  and sequences; predicates @a, @a='v', parent::X, ancestor::X as CSS
  selectors; params that are literals, @a, or count(ancestor::X) plus a number.

  Run:  saxon -s:../examples/tei_simler.odd -xsl:generate/odd-to-ceteicean.xsl \
              -o:output/tei-ceteicean-behaviours.js tei=simler-poem.xml
  The `tei` parameter is the TEI file's name, resolved next to the ODD.
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:pm="urn:x-poc:pm"
  exclude-result-prefixes="#all">

  <xsl:include href="odd-model.xsl"/>

  <xsl:output method="text" encoding="UTF-8"/>

  <xsl:param name="tei" select="'simler-poem.xml'"/>

  <!-- A predicate as a CSS selector on the custom element, or () outside the subset. -->
  <xsl:function name="pm:selector" as="xs:string?">
    <xsl:param name="pred" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="matches($pred, '^@[\w\-]+$')"><xsl:sequence select="'[' || substring($pred, 2) || ']'"/></xsl:when>
      <xsl:when test="matches($pred, '^@[\w\-]+\s*=\s*''[^'']*''$')">
        <xsl:sequence select="replace($pred, '^@([\w\-]+)\s*=\s*''([^'']*)''$', '[$1=&quot;$2&quot;]')"/>
      </xsl:when>
      <xsl:when test="matches($pred, '^(parent|ancestor)::[\w\-]+$')">
        <xsl:variable name="name" select="substring-after($pred, '::')"/>
        <xsl:sequence select="':is(tei-' || lower-case($name) || ', .tei-' || $name || ')' || (if (starts-with($pred, 'parent')) then ' > ' else ' ') || '*'"/>
      </xsl:when>
    </xsl:choose>
  </xsl:function>

  <!-- A param as a literal, map { attr } or map { count, plus }, or () outside the subset. -->
  <xsl:function name="pm:param" as="item()?">
    <xsl:param name="value" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="matches($value, '^''[^'']*''$')"><xsl:sequence select="substring($value, 2, string-length($value) - 2)"/></xsl:when>
      <xsl:when test="matches($value, '^\d+$')"><xsl:sequence select="number($value)"/></xsl:when>
      <xsl:when test="matches($value, '^@[\w\-]+$')"><xsl:sequence select="map { 'attr': substring($value, 2) }"/></xsl:when>
      <xsl:when test="matches($value, '^count\(ancestor::[\w\-]+\)(\s*\+\s*\d+)?$')">
        <xsl:analyze-string select="$value" regex="^count\(ancestor::([\w\-]+)\)(\s*\+\s*(\d+))?$">
          <xsl:matching-substring>
            <xsl:sequence select="map { 'count': lower-case(regex-group(1)), 'plus': number((regex-group(3)[.], '0')[1]) }"/>
          </xsl:matching-substring>
        </xsl:analyze-string>
      </xsl:when>
    </xsl:choose>
  </xsl:function>

  <xsl:template match="/">
    <xsl:variable name="models" as="map(*)*">
      <xsl:for-each select="pm:odd(/)/pm:spec">
        <xsl:variable name="ident" select="string(@ident)"/>
        <xsl:variable name="kept" as="map(*)*">
          <xsl:for-each select="pm:model[not(@output)]">
            <xsl:variable name="when" select="@predicate ! pm:selector(.)"/>
            <xsl:choose>
              <xsl:when test="pm:model or (@predicate and empty($when))">
                <xsl:message select="'[odd-to-ceteicean] ⚠ &lt;' || $ident || '&gt;: ' || (if (pm:model) then @behaviour else 'predicate ' || @predicate) || ' is outside the CETEIcean tier, model left out'"/>
              </xsl:when>
              <xsl:otherwise>
                <xsl:variable name="params" as="map(*)*">
                  <xsl:for-each select="pm:param">
                    <xsl:variable name="v" select="pm:param(@value)"/>
                    <xsl:if test="empty($v)">
                      <xsl:message select="'[odd-to-ceteicean] ⚠ &lt;' || $ident || '&gt;: param ' || @name || '=&quot;' || @value || '&quot; is outside the CETEIcean tier, left out'"/>
                    </xsl:if>
                    <xsl:sequence select="$v ! map { string(current()/@name): . }"/>
                  </xsl:for-each>
                </xsl:variable>
                <xsl:sequence select="map:merge((
                  map { 'behaviour': string(@behaviour), 'classes': array { tokenize(@classes) }, 'source': @source = 'true', 'params': map:merge($params) },
                  (@tag[. != ''] ! map { 'tag': string(.) }), ($when ! map { 'when': . })))"/>
              </xsl:otherwise>
            </xsl:choose>
          </xsl:for-each>
        </xsl:variable>
        <xsl:sequence select="if (exists($kept)) then map { $ident: array { $kept } } else ()"/>
      </xsl:for-each>
    </xsl:variable>

    <xsl:variable name="behaviours" select="'/* tei-ceteicean-behaviours.js — generated by odd-to-ceteicean.xsl */&#10;'
      || unparsed-text('../../runtime/ceteicean.js')
      || 'const teiModels = ' || serialize(map:merge($models), map { 'method': 'json', 'indent': true() }) || ';&#10;'"/>
    <xsl:value-of select="$behaviours"/>

    <xsl:variable name="teiUri" select="resolve-uri($tei, base-uri(/))"/>
    <xsl:variable name="teiText" select="if (unparsed-text-available($teiUri)) then replace(unparsed-text($teiUri), '^&lt;\?xml[^>]*\?>\s*', '') else ''"/>
    <xsl:result-document href="rendered-ceteicean.html" method="text">
      <xsl:value-of select="unparsed-text('../../runtime/ceteicean.html')
        => replace('{{behaviours}}', $behaviours, 'q') => replace('{{tei}}', $teiText, 'q')"/>
    </xsl:result-document>
  </xsl:template>

</xsl:stylesheet>
