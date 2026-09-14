<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-to-xsl.xsl — the "generate" step, done the XSLT way.

  Reads a TEI ODD and generates the rendering stylesheet edition.xsl from its
  Processing Model: for each TEI element one template that takes the first of
  its models whose output and predicate fit (an xsl:choose in document order,
  the output's own models first) and calls pm:model with the model's
  behaviour, classes and params. The behaviours are the runtime
  ../../runtime/pm.xsl, copied in. The XSLT counterpart of
  compiler-js/odd-to-xslt.mjs, which generates the same stylesheet.

  Technique: <xsl:namespace-alias>. Elements that must appear as `xsl:*` in the
  generated stylesheet are written in the `axsl:` namespace and aliased to the
  XSLT namespace on output. The two evaluation times are the key:
    * xsl:*  runs now, over the ODD
    * axsl:* runs later, over the TEI (predicates and params stay XPath)

  Run:  saxon  -s:../examples/tei_simler.odd  -xsl:generate/odd-to-xsl.xsl
               -o:output/edition.xsl
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
    <axsl:stylesheet version="3.0" xpath-default-namespace="http://www.tei-c.org/ns/1.0" exclude-result-prefixes="#all">
      <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
      <xsl:namespace name="map" select="'http://www.w3.org/2005/xpath-functions/map'"/>
      <xsl:namespace name="tei" select="'http://www.tei-c.org/ns/1.0'"/>
      <xsl:namespace name="pm" select="'urn:x-poc:pm'"/>
      <xsl:comment> The runtime part is runtime/pm.xsl; the templates at the end are the ODD's models. </xsl:comment>
      <xsl:copy-of select="doc('../../runtime/pm.xsl')/*/node()"/>
      <xsl:apply-templates select="pm:odd(/)/pm:spec[pm:model]" mode="templates"/>
    </axsl:stylesheet>
  </xsl:template>

  <!-- One element: the template choosing its model, and the one telling its flow. -->
  <xsl:template match="pm:spec" mode="templates">
    <xsl:variable name="ordered" select="pm:model[@output], pm:model[not(@output)]"/>
    <xsl:comment> &lt;<xsl:value-of select="@ident"/>&gt; </xsl:comment>
    <axsl:template match="{@ident}">
      <axsl:choose>
        <xsl:for-each select="$ordered">
          <axsl:when test="{pm:test(.)}">
            <xsl:apply-templates select="." mode="body"/>
          </axsl:when>
        </xsl:for-each>
        <axsl:otherwise><axsl:apply-templates/></axsl:otherwise>
      </axsl:choose>
    </axsl:template>
    <axsl:template match="{@ident}" mode="pm:flow">
      <axsl:choose>
        <xsl:for-each select="$ordered">
          <axsl:when test="{pm:test(.)}"><axsl:sequence select="{pm:q(@flow)}"/></axsl:when>
        </xsl:for-each>
      </axsl:choose>
    </axsl:template>
  </xsl:template>

  <xsl:function name="pm:test" as="xs:string">
    <xsl:param name="m" as="element(pm:model)"/>
    <xsl:variable name="tests" select="($m/@output ! ('$output = ' || pm:q(.)), $m/@predicate ! ('(' || . || ')'))"/>
    <xsl:sequence select="if (exists($tests)) then string-join($tests, ' and ') else 'true()'"/>
  </xsl:function>

  <!-- A sequence renders each part whose predicate holds; the element's id goes on the first. -->
  <xsl:template match="pm:model[@behaviour = 'sequence']" mode="body">
    <xsl:for-each select="pm:model">
      <xsl:variable name="earlier" select="preceding-sibling::pm:model"/>
      <xsl:variable name="first" select="if (empty($earlier)) then 'true()'
        else if (every $e in $earlier satisfies $e/@predicate) then string-join($earlier ! ('not(' || @predicate || ')'), ' and ')
        else 'false()'"/>
      <xsl:choose>
        <xsl:when test="@predicate">
          <axsl:if test="{@predicate}">
            <xsl:call-template name="call"><xsl:with-param name="first" select="$first"/></xsl:call-template>
          </axsl:if>
        </xsl:when>
        <xsl:otherwise>
          <xsl:call-template name="call"><xsl:with-param name="first" select="$first"/></xsl:call-template>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <!-- A compound (Boot's nested-model proposal): a link part wraps the other parts. -->
  <xsl:template match="pm:model[@behaviour = 'compound']" mode="body">
    <xsl:variable name="parts" select="pm:model"/>
    <xsl:variable name="link" select="$parts[@behaviour = 'link'][1]"/>
    <xsl:variable name="rest" as="node()*">
      <xsl:for-each select="$parts except $link">
        <xsl:call-template name="call">
          <xsl:with-param name="first" select="if (. is $parts[1]) then 'true()' else 'false()'"/>
        </xsl:call-template>
      </xsl:for-each>
    </xsl:variable>
    <xsl:choose>
      <xsl:when test="$link">
        <xsl:for-each select="$link">
          <xsl:call-template name="call">
            <xsl:with-param name="first" select="if (. is $parts[1]) then 'true()' else 'false()'"/>
            <xsl:with-param name="inner" select="$rest"/>
          </xsl:call-template>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise><xsl:sequence select="$rest"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="pm:model" mode="body">
    <xsl:call-template name="call"/>
  </xsl:template>

  <!-- The call of pm:model for the context model. -->
  <xsl:template name="call">
    <xsl:param name="first" as="xs:string" select="'true()'"/>
    <xsl:param name="inner" as="node()*" select="()"/>
    <axsl:call-template name="pm:model">
      <axsl:with-param name="behaviour" select="{pm:q(@behaviour)}"/>
      <xsl:if test="@tag != ''"><axsl:with-param name="tag" select="{pm:q(@tag)}"/></xsl:if>
      <xsl:if test="@flow != ''"><axsl:with-param name="flow" select="{pm:q(@flow)}"/></xsl:if>
      <xsl:if test="@classes != ''">
        <axsl:with-param name="classes" select="({string-join(tokenize(@classes) ! pm:q(.), ', ')})"/>
      </xsl:if>
      <xsl:if test="@source = 'true'"><axsl:with-param name="source" select="true()"/></xsl:if>
      <xsl:if test="pm:param">
        <xsl:variable name="map" select="'map { ' || string-join(pm:param ! (pm:q(@name) || ': (' || @value || ')'), ', ') || ' }'"/>
        <axsl:with-param name="params" select="{$map}"/>
      </xsl:if>
      <xsl:if test="$first != 'true()'"><axsl:with-param name="first" select="{$first}"/></xsl:if>
      <xsl:if test="exists($inner)">
        <axsl:with-param name="inner" as="node()*"><xsl:sequence select="$inner"/></axsl:with-param>
      </xsl:if>
    </axsl:call-template>
  </xsl:template>

</xsl:stylesheet>
