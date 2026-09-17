<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-to-xsl.xsl — the "generate" step, done the XSLT way.

  Reads a TEI ODD and generates the rendering stylesheet edition.xsl from its
  Processing Model: for each TEI element a template in mode pm:select that
  gives, for an output, the first of its models whose predicate holds (an
  xsl:choose in document order) as a map of its behaviour, classes and params;
  and the views laid over the page, as $pm:views. The behaviours are the runtime
  ../../runtime/pm.xsl, copied in. The XSLT counterpart of
  compiler-js/odd-to-xslt.mjs, which generates the same stylesheet.

  Technique: <xsl:namespace-alias>. Elements that must appear as `xsl:*` in the
  generated stylesheet are written in the `axsl:` namespace and aliased to the
  XSLT namespace on output. The two evaluation times are the key:
    * xsl:*  runs now, over the ODD
    * axsl:* runs later, over the TEI (predicates and params stay XPath)

  Run:  saxon  -s:../examples/tei_simler.odd  -xsl:generate/odd-to-xsl.xsl
               -o:output/edition.xsl
  Output:  edition.xsl (stylesheet params: output, interactive)
  Read by: build.sh, which renders every TEI file with it, and xslt3 for SaxonJS
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:axsl="urn:x-alias:xsl"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:pm="urn:x-poc:pm"
  exclude-result-prefixes="#all">

  <xsl:include href="odd-model.xsl"/>

  <xsl:output method="xml" indent="yes"/>
  <xsl:namespace-alias stylesheet-prefix="axsl" result-prefix="xsl"/>

  <xsl:template match="/">
    <xsl:variable name="odd" select="pm:odd(/)"/>
    <xsl:variable name="views" select="$odd/pm:view ! ('map { ''output'': ' || pm:q(@output) || ', ''label'': ' || pm:q(@label) || ' }')"/>
    <axsl:stylesheet version="3.0" xpath-default-namespace="http://www.tei-c.org/ns/1.0" exclude-result-prefixes="#all">
      <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
      <xsl:namespace name="map" select="'http://www.w3.org/2005/xpath-functions/map'"/>
      <xsl:namespace name="tei" select="'http://www.tei-c.org/ns/1.0'"/>
      <xsl:namespace name="pm" select="'urn:x-poc:pm'"/>
      <xsl:comment> The runtime part is runtime/pm.xsl; the views and templates at the end are the ODD's models. </xsl:comment>
      <xsl:copy-of select="doc('../../runtime/pm.xsl')/*/node()"/>
      <axsl:variable name="pm:views" as="map(*)*" select="({string-join($views, ', ')})"/>
      <xsl:apply-templates select="$odd/pm:spec[pm:model]"/>
    </axsl:stylesheet>
  </xsl:template>

  <!-- An element's first model of the output asked for ('' the models without @output) whose predicate holds. -->
  <xsl:template match="pm:spec">
    <axsl:template match="{@ident}" mode="pm:select">
      <axsl:param name="output" as="xs:string"/>
      <axsl:choose>
        <xsl:for-each select="pm:model">
          <axsl:when test="{string-join(('$output = ' || pm:q(@output), @predicate ! ('(' || . || ')')), ' and ')}">
            <axsl:sequence select="{pm:map(.)}"/>
          </axsl:when>
        </xsl:for-each>
      </axsl:choose>
    </axsl:template>
  </xsl:template>

  <!-- A model as an XPath map, as pm.xsl renders it: its params evaluated where the element stands, a part's predicate as 'live'. -->
  <xsl:function name="pm:map" as="xs:string">
    <xsl:param name="m" as="element(pm:model)"/>
    <xsl:variable name="entries" select="
      '''behaviour'': ' || pm:q($m/@behaviour),
      $m/@tag[. != ''] ! ('''tag'': ' || pm:q(.)),
      $m/@flow[. != ''] ! ('''flow'': ' || pm:q(.)),
      $m/@classes[. != ''] ! ('''classes'': (' || string-join(tokenize(.) ! pm:q(.), ', ') || ')'),
      $m/@source[. = 'true'] ! '''source'': true()',
      $m/@template ! ('''template'': ' || pm:q(.)),
      $m[pm:param] ! ('''params'': map { ' || string-join(pm:param ! (pm:q(@name) || ': (' || @value || ')'), ', ') || ' }'),
      $m[pm:model] ! ('''parts'': (' || string-join(pm:model ! pm:map(.), ', ') || ')'),
      $m[parent::pm:model] ! ('''live'': ' || (if (@predicate) then 'boolean(' || @predicate || ')' else 'true()'))"/>
    <xsl:sequence select="'map { ' || string-join($entries, ', ') || ' }'"/>
  </xsl:function>

</xsl:stylesheet>
