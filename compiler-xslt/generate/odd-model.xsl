<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-model.xsl — reads a TEI ODD into the Processing Model the XSLT generators
  work from; included by odd-to-xsl.xsl, odd-to-css.xsl and odd-to-ceteicean.xsl.
  The XSLT counterpart of compiler-js/odd-parser.mjs, with the same result:

    pm:odd(/) →
      <pm:odd>
        <pm:rendition id css/>…                         the source renditions of <tagsDecl>
        <pm:spec ident mode>
          <pm:rule selector css/>                        a model group's CSS
          <pm:model behaviour tag flow predicate? output? label? classes source>
            <pm:rule selector css/>                      the model's CSS
            <pm:param name value/>…
            <pm:model …/>…                               the parts of a sequence
          </pm:model>…
        </pm:spec>…
        <pm:view output label/>…                         the outputs laid over the page
      </pm:odd>

  Models are in document order, groups flattened; a model takes @output and
  @useSourceRendition from its sequence or group. A spec's only model styles
  .tei-<ident>; otherwise a group styles .<ident>-group, and a model its first
  @cssClass, or <ident>-<n> (the n-th <model> of the spec) without one. The CSS
  of a model with @output applies where that output is on (see pm:on). The
  views are all outputs but those rendering alone, each labelled by the first
  <desc> of its models.
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:pm="urn:x-poc:pm"
  exclude-result-prefixes="#all">

  <!-- The shared behaviour contract, the same file compiler-js reads. -->
  <xsl:variable name="pm:behaviours" select="json-doc('../../behaviour-map.json')"/>

  <xsl:function name="pm:odd" as="element(pm:odd)">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:variable name="specs" as="element(pm:spec)*">
      <xsl:apply-templates mode="pm:spec"
        select="if (exists($doc//tei:specGrpRef)) then pm:schema-specs($doc//tei:schemaSpec/node(), ()) else $doc//tei:elementSpec"/>
    </xsl:variable>
    <xsl:variable name="renditions" as="element(pm:rendition)*">
      <xsl:for-each select="$doc//tei:tagsDecl/tei:rendition[@xml:id]">
        <pm:rendition id="{@xml:id}" css="{normalize-space(.)}"/>
      </xsl:for-each>
    </xsl:variable>
    <xsl:variable name="source" select="($doc//tei:schemaSpec)[1]/@source"/>
    <xsl:variable name="all" as="element()*">
      <xsl:choose>
        <!-- A chain: the base ODD's specs; this one's replace their models, delete, or add. -->
        <xsl:when test="$source">
          <xsl:variable name="base" select="pm:odd(doc(resolve-uri($source, base-uri($doc))))"/>
          <xsl:sequence select="$base/pm:rendition, $renditions"/>
          <xsl:for-each select="$base/pm:spec">
            <xsl:variable name="own" select="$specs[@ident = current()/@ident][last()]"/>
            <xsl:if test="not($own/@mode = 'delete')">
              <xsl:sequence select="if ($own/pm:model) then $own else ."/>
            </xsl:if>
          </xsl:for-each>
          <xsl:sequence select="$specs[not(@mode = 'delete') and not(@ident = $base/pm:spec/@ident)]"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:sequence select="$renditions, $specs"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <pm:odd>
      <xsl:sequence select="$all"/>
      <xsl:for-each select="distinct-values($all//pm:model/@output)[not(. = $pm:alone)]">
        <pm:view output="{.}" label="{($all//pm:model[@output = current()]/@label, .)[1]}"/>
      </xsl:for-each>
    </pm:odd>
  </xsl:function>

  <!-- Outputs not laid over the page: the page itself, what it shows around the text, the search text. -->
  <xsl:variable name="pm:alone" select="('web', 'page', 'plain')"/>

  <!-- Where an output is on: the edition renders it, or its view switch is checked. -->
  <xsl:function name="pm:on" as="xs:string">
    <xsl:param name="output" as="xs:string"/>
    <xsl:sequence select="':is([data-' || $output || '=''on''], :root:has(#view-' || $output || ':checked))'"/>
  </xsl:function>

  <!-- Resolve <specGrpRef> within one document: each reference contributes the specs
       of its <specGrp xml:id>, in reference order; dangling and cyclic ones are skipped. -->
  <xsl:function name="pm:schema-specs" as="element(tei:elementSpec)*">
    <xsl:param name="nodes" as="node()*"/>
    <xsl:param name="seen" as="xs:string*"/>
    <xsl:for-each select="$nodes">
      <xsl:choose>
        <xsl:when test="self::tei:specGrpRef">
          <xsl:variable name="id" select="substring-after(@target, '#')"/>
          <xsl:variable name="grp" select="root(.)//tei:specGrp[@xml:id = $id]"/>
          <xsl:if test="$grp and not($id = $seen)">
            <xsl:sequence select="pm:schema-specs($grp/node(), ($seen, $id))"/>
          </xsl:if>
        </xsl:when>
        <xsl:when test="self::tei:elementSpec"><xsl:sequence select="."/></xsl:when>
        <xsl:when test="self::tei:specGrp[not(@xml:id)]"><xsl:sequence select="pm:schema-specs(node(), $seen)"/></xsl:when>
      </xsl:choose>
    </xsl:for-each>
  </xsl:function>

  <xsl:template match="tei:elementSpec" mode="pm:spec">
    <xsl:variable name="entries" select="tei:model | tei:modelGrp | tei:modelSequence"/>
    <pm:spec ident="{@ident}" mode="{(@mode, 'add')[1]}">
      <xsl:for-each select="$entries">
        <xsl:choose>
          <xsl:when test="self::tei:modelGrp">
            <xsl:variable name="n" select="count(preceding-sibling::tei:modelGrp) + 1"/>
            <xsl:variable name="groupClass" select="if (count($entries) = 1) then '' else ../@ident || '-group' || (if ($n gt 1) then $n else '')"/>
            <xsl:call-template name="pm:rules">
              <xsl:with-param name="el" select="."/>
              <xsl:with-param name="selector" select="if ($groupClass) then '.' || $groupClass else '.tei-' || ../@ident"/>
              <xsl:with-param name="output" select="@output"/>
            </xsl:call-template>
            <xsl:for-each select="tei:model | tei:modelSequence">
              <xsl:call-template name="pm:read">
                <xsl:with-param name="group" select=".."/>
                <xsl:with-param name="groupClass" select="$groupClass"/>
              </xsl:call-template>
            </xsl:for-each>
          </xsl:when>
          <xsl:otherwise><xsl:call-template name="pm:read"/></xsl:otherwise>
        </xsl:choose>
      </xsl:for-each>
    </pm:spec>
  </xsl:template>

  <xsl:template name="pm:rules">
    <xsl:param name="el" as="element()"/>
    <xsl:param name="selector" as="xs:string"/>
    <xsl:param name="output" as="xs:string?"/>
    <xsl:for-each select="$el/tei:outputRendition">
      <pm:rule selector="{$output ! (pm:on(.) || ' ')}{$selector}{if (@scope) then '::' || @scope else ''}" css="{normalize-space(.)}"/>
    </xsl:for-each>
  </xsl:template>

  <!-- One model or sequence, the context; `outer` is the model or sequence it is a part of. -->
  <xsl:template name="pm:read">
    <xsl:param name="group" as="element()?" select="()"/>
    <xsl:param name="groupClass" as="xs:string" select="''"/>
    <xsl:param name="outer" as="element()?" select="()"/>
    <xsl:variable name="spec" select="ancestor::tei:elementSpec[1]"/>
    <xsl:variable name="ident" select="string($spec/@ident)"/>
    <xsl:variable name="output" select="(@output, $outer/@output, $group/@output)[1]"/>
    <xsl:variable name="own" select="tokenize(normalize-space(@cssClass))"/>
    <xsl:variable name="styled" select="exists(self::tei:model/tei:outputRendition)"/>
    <xsl:variable name="bare" select="count($spec/(tei:model | tei:modelGrp | tei:modelSequence)) = 1
      and empty(($group, $outer, @predicate, $output))"/>
    <xsl:variable name="n" select="index-of($spec//tei:model ! generate-id(), generate-id())"/>
    <xsl:variable name="cls" select="if ($styled and not($bare)) then ($own[1], $ident || '-' || $n)[1] else ()"/>
    <xsl:variable name="behaviour" select="if (self::tei:modelSequence) then 'sequence' else pm:known(string(@behaviour), $ident)"/>
    <xsl:variable name="sequence" select="if (self::tei:modelSequence) then . else tei:modelSequence[1]"/>
    <xsl:variable name="m" select="."/>
    <xsl:variable name="parts" as="element(pm:model)*">
      <xsl:for-each select="$sequence/tei:model">
        <xsl:call-template name="pm:read">
          <xsl:with-param name="group" select="$group"/>
          <xsl:with-param name="groupClass" select="$groupClass"/>
          <xsl:with-param name="outer" select="$m"/>
        </xsl:call-template>
      </xsl:for-each>
    </xsl:variable>
    <!-- Block if any part is, inline if all are; a `text` part is literal content. -->
    <xsl:variable name="flows" select="$parts[@behaviour ne 'text']/@flow"/>
    <pm:model behaviour="{$behaviour}"
      tag="{$pm:behaviours($behaviour)?tag}"
      flow="{if (empty($sequence)) then $pm:behaviours($behaviour)?flow
             else if ($flows = 'block') then 'block' else if (every $f in $flows satisfies $f = 'inline') then 'inline' else ''}"
      classes="{distinct-values(($groupClass[.], $own, $cls))}"
      source="{(@useSourceRendition, $outer/@useSourceRendition, $group/@useSourceRendition)[1] = 'true'}">
      <xsl:if test="@predicate"><xsl:attribute name="predicate" select="@predicate"/></xsl:if>
      <xsl:if test="$output"><xsl:attribute name="output" select="$output"/></xsl:if>
      <xsl:if test="tei:desc"><xsl:attribute name="label" select="normalize-space(tei:desc[1])"/></xsl:if>
      <xsl:if test="$styled">
        <xsl:call-template name="pm:rules">
          <xsl:with-param name="el" select="."/>
          <xsl:with-param name="selector" select="if ($cls) then '.' || $cls else '.tei-' || $ident"/>
          <xsl:with-param name="output" select="$output"/>
        </xsl:call-template>
      </xsl:if>
      <!-- A repeated param counts once, with its last value. -->
      <xsl:for-each-group select="tei:param" group-by="@name">
        <pm:param name="{@name}" value="{(current-group()[last()]/@value, '''''')[1]}"/>
      </xsl:for-each-group>
      <xsl:sequence select="$parts"/>
    </pm:model>
  </xsl:template>

  <xsl:function name="pm:known" as="xs:string">
    <xsl:param name="behaviour" as="xs:string"/>
    <xsl:param name="ident" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="map:contains($pm:behaviours, $behaviour)"><xsl:sequence select="$behaviour"/></xsl:when>
      <xsl:otherwise>
        <xsl:message select="'[odd-model] ⚠ &lt;' || $ident || '&gt;: unknown behaviour &quot;' || $behaviour || '&quot;, rendered inline'"/>
        <xsl:sequence select="'inline'"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- An XPath string literal. -->
  <xsl:function name="pm:q" as="xs:string">
    <xsl:param name="s" as="xs:string?"/>
    <xsl:sequence select="'''' || replace(string($s), '''', '''''') || ''''"/>
  </xsl:function>

</xsl:stylesheet>
