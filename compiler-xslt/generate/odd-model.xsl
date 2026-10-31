<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-model.xsl — reads a TEI ODD into the Processing Model the XSLT generators
  work from; included by odd-to-xsl.xsl, odd-to-css.xsl and odd-to-ceteicean.xsl.
  The XSLT counterpart of compiler-js/odd-parser.mjs, with the same result:

    pm:odd(/) →
      <pm:odd>
        <pm:rendition id css/>…                         the source renditions of <tagsDecl>
        <pm:spec ident key ns? mode>
          <pm:rule selector css/>                        a model group's CSS
          <pm:model behaviour tag flow predicate? output? label? template? classes source>
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
  of a model with @output applies where that output is on (see pm:on). A
  model's <pb:template>, a TEI Publisher extension, is kept as XML (see
  pm:template). The views are all outputs but those rendering alone and another
  engine's, each labelled by the first <desc> of its models. An @output prefixed
  orc-, this compiler's own, names the output itself; one prefixed opm-, OPM's,
  is never rendered here (docs/conventions.md).

  An XPath prefix the ODD binds becomes Q{uri}local (see pm:xpath). A spec with
  @ns has it, and a key of {ns}ident, by which it is matched; otherwise its key
  is its ident.

  An ODD it cannot read raises the error pm:odd, naming each problem as
  odd-parser.mjs names it, but without the line (see pm:problems).
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

  <!-- The ODD, or the error pm:odd naming each problem that keeps it from being read. -->
  <xsl:function name="pm:odd" as="element(pm:odd)">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:variable name="odd" select="pm:chain($doc, ())"/>
    <xsl:sequence select="if (empty($odd//pm:model))
      then error(xs:QName('pm:odd'), pm:name($doc) || ': holds no &lt;model&gt;, so there is no Processing Model to compile')
      else $odd"/>
  </xsl:function>

  <!-- The problems of one ODD, in document order. -->
  <xsl:function name="pm:problems" as="xs:string*">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:variable name="source" select="($doc//tei:schemaSpec)[1]/@source"/>
    <xsl:for-each select="$source[not(doc-available(resolve-uri(., base-uri($doc))))]/.. | $doc//tei:elementSpec[not(@ident)]
      | $doc//tei:elementSpec//(tei:model[not(@behaviour)] | tei:modelSequence[not(tei:model)] | tei:param[not(@name)])">
      <xsl:variable name="in" select="' in &lt;elementSpec ident=&quot;' || ancestor::tei:elementSpec/@ident || '&quot;&gt;'"/>
      <xsl:sequence select="pm:name($doc) || ': ' || (
        if (self::tei:schemaSpec) then '&lt;schemaSpec source=&quot;' || $source || '&quot;&gt;: not found'
        else if (self::tei:elementSpec) then '&lt;elementSpec&gt; has no @ident'
        else if (self::tei:model) then '&lt;model&gt;' || $in || ' has no @behaviour'
        else if (self::tei:modelSequence) then '&lt;modelSequence&gt;' || $in || ' holds no &lt;model&gt;'
        else '&lt;param&gt;' || $in || ' has no @name')"/>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="pm:name" as="xs:string">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:sequence select="tokenize(base-uri($doc), '/')[last()]"/>
  </xsl:function>

  <!-- One ODD of a chain, with its base; $seen are the ODDs that inherit from it. -->
  <xsl:function name="pm:chain" as="element(pm:odd)">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:param name="seen" as="xs:string*"/>
    <xsl:variable name="uri" select="string(base-uri($doc))"/>
    <xsl:sequence select="if ($uri = $seen) then error(xs:QName('pm:odd'), pm:name($doc) || ': inherits from itself: '
      || string-join(($seen, $uri) ! tokenize(., '/')[last()], ' → ')) else ()"/>
    <xsl:variable name="problems" select="pm:problems($doc)"/>
    <xsl:sequence select="if (exists($problems)) then error(xs:QName('pm:odd'), string-join($problems, '&#10;')) else ()"/>
    <xsl:variable name="specs" as="element(pm:spec)*">
      <xsl:apply-templates mode="pm:spec"
        select="if (exists($doc//tei:specGrpRef)) then pm:schema-specs($doc//tei:schemaSpec/node(), ()) else $doc//tei:elementSpec"/>
    </xsl:variable>
    <xsl:variable name="renditions" as="element(pm:rendition)*">
      <xsl:for-each select="$doc//tei:tagsDecl/tei:rendition[@xml:id]">
        <pm:rendition id="{@xml:id}" css="{pm:css(.)}"/>
      </xsl:for-each>
    </xsl:variable>
    <xsl:variable name="source" select="($doc//tei:schemaSpec)[1]/@source"/>
    <xsl:variable name="all" as="element()*">
      <xsl:choose>
        <!-- A chain: the base ODD's specs; this one's replace their models, delete, or add. -->
        <xsl:when test="$source">
          <xsl:variable name="base" select="pm:chain(doc(resolve-uri($source, base-uri($doc))), ($seen, $uri))"/>
          <xsl:sequence select="$base/pm:rendition, $renditions"/>
          <xsl:for-each select="$base/pm:spec">
            <xsl:variable name="own" select="$specs[@key = current()/@key][last()]"/>
            <xsl:if test="not($own/@mode = 'delete')">
              <xsl:sequence select="if ($own/pm:model) then $own else ."/>
            </xsl:if>
          </xsl:for-each>
          <xsl:sequence select="$specs[not(@mode = 'delete') and not(@key = $base/pm:spec/@key)]"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:sequence select="$renditions, $specs"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <pm:odd>
      <xsl:sequence select="$all"/>
      <xsl:for-each select="distinct-values($all//pm:model/@output)[not(. = $pm:alone or starts-with(., 'opm-'))]">
        <pm:view output="{.}" label="{($all//pm:model[@output = current()]/@label, .)[1]}"/>
      </xsl:for-each>
    </pm:odd>
  </xsl:function>

  <!-- An @output with this compiler's prefix names the output itself. -->
  <xsl:function name="pm:output" as="xs:string?">
    <xsl:param name="output" as="attribute()?"/>
    <xsl:sequence select="$output ! replace(., '^orc-', '')"/>
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
    <xsl:variable name="ns" select="@ns[. ne 'http://www.tei-c.org/ns/1.0']"/>
    <pm:spec ident="{@ident}" key="{if ($ns) then '{' || $ns || '}' || @ident else @ident}" mode="{(@mode, 'add')[1]}">
      <xsl:if test="$ns"><xsl:attribute name="ns" select="$ns"/></xsl:if>
      <xsl:for-each select="$entries">
        <xsl:choose>
          <xsl:when test="self::tei:modelGrp">
            <xsl:variable name="n" select="count(preceding-sibling::tei:modelGrp) + 1"/>
            <xsl:variable name="groupClass" select="if (count($entries) = 1) then '' else ../@ident || '-group' || (if ($n gt 1) then $n else '')"/>
            <xsl:call-template name="pm:rules">
              <xsl:with-param name="el" select="."/>
              <xsl:with-param name="selector" select="if ($groupClass) then '.' || $groupClass else '.tei-' || ../@ident"/>
              <xsl:with-param name="output" select="pm:output(@output)"/>
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
      <pm:rule selector="{$output ! (pm:on(.) || ' ')}{$selector}{if (@scope) then '::' || @scope else ''}" css="{pm:css(.)}"/>
    </xsl:for-each>
  </xsl:template>

  <!-- CSS with its whitespace collapsed, but for that of its quoted strings. -->
  <xsl:function name="pm:css" as="xs:string">
    <xsl:param name="css" as="xs:string"/>
    <xsl:variable name="parts" as="xs:string*">
      <xsl:analyze-string select="$css" regex="&quot;([^&quot;\\]|\\.)*&quot;|'([^'\\]|\\.)*'" flags="s">
        <xsl:matching-substring><xsl:sequence select="."/></xsl:matching-substring>
        <xsl:non-matching-substring><xsl:sequence select="replace(., '\s+', ' ')"/></xsl:non-matching-substring>
      </xsl:analyze-string>
    </xsl:variable>
    <xsl:sequence select="replace(string-join($parts), '^ | $', '')"/>
  </xsl:function>

  <!-- One model or sequence, the context; `outer` is the model or sequence it is a part of. -->
  <xsl:template name="pm:read">
    <xsl:param name="group" as="element()?" select="()"/>
    <xsl:param name="groupClass" as="xs:string" select="''"/>
    <xsl:param name="outer" as="element()?" select="()"/>
    <xsl:variable name="spec" select="ancestor::tei:elementSpec[1]"/>
    <xsl:variable name="ident" select="string($spec/@ident)"/>
    <xsl:variable name="output" select="pm:output((@output, $outer/@output, $group/@output)[1])"/>
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
      <xsl:if test="@predicate"><xsl:attribute name="predicate" select="pm:xpath(@predicate, .)"/></xsl:if>
      <xsl:if test="$output"><xsl:attribute name="output" select="$output"/></xsl:if>
      <xsl:if test="tei:desc"><xsl:attribute name="label" select="normalize-space(tei:desc[1])"/></xsl:if>
      <xsl:if test="*:template"><xsl:attribute name="template" select="pm:template(*:template[1])"/></xsl:if>
      <xsl:if test="$styled">
        <xsl:call-template name="pm:rules">
          <xsl:with-param name="el" select="."/>
          <xsl:with-param name="selector" select="if ($cls) then '.' || $cls else '.tei-' || $ident"/>
          <xsl:with-param name="output" select="$output"/>
        </xsl:call-template>
      </xsl:if>
      <!-- A repeated param counts once, with its last value. -->
      <xsl:for-each-group select="tei:param" group-by="@name">
        <pm:param name="{@name}" value="{pm:xpath((current-group()[last()]/@value, '''''')[1], current-group()[last()])}"/>
      </xsl:for-each-group>
      <xsl:sequence select="$parts"/>
    </pm:model>
  </xsl:template>

  <!-- An expression with the prefixes the ODD binds resolved, to Q{uri}local or, for TEI's
       namespace, the unprefixed name; string literals and xml: stay as they are. -->
  <xsl:function name="pm:xpath" as="xs:string">
    <xsl:param name="expr" as="xs:string"/>
    <xsl:param name="at" as="element()"/>
    <xsl:variable name="parts" as="xs:string*">
      <xsl:analyze-string select="$expr" regex="'[^']*'|&quot;[^&quot;]*&quot;|(@?)([A-Za-z_][\w.\-]*):([A-Za-z_][\w.\-]*)">
        <xsl:matching-substring>
          <xsl:variable name="uri" select="if (regex-group(2) and regex-group(2) ne 'xml') then namespace-uri-for-prefix(regex-group(2), $at) else ()"/>
          <xsl:sequence select="if (empty($uri)) then .
            else if (not(regex-group(1)) and $uri = 'http://www.tei-c.org/ns/1.0') then regex-group(3)
            else regex-group(1) || 'Q{' || $uri || '}' || regex-group(3)"/>
        </xsl:matching-substring>
        <xsl:non-matching-substring><xsl:sequence select="."/></xsl:non-matching-substring>
      </xsl:analyze-string>
    </xsl:variable>
    <xsl:sequence select="string-join($parts)"/>
  </xsl:function>

  <!-- A <pb:template> as XML without namespaces, as TEI Publisher reads it:
       its elements, or with none its text, each line's leading whitespace dropped. -->
  <xsl:function name="pm:template" as="xs:string">
    <xsl:param name="t" as="element()"/>
    <xsl:variable name="local" as="element()*"><xsl:apply-templates select="$t/*" mode="pm:local"/></xsl:variable>
    <xsl:sequence select="if ($t/*) then string-join($local ! serialize(.)) else serialize(replace(string($t), '^\s+', '', 'm'))"/>
  </xsl:function>

  <xsl:mode name="pm:local" on-no-match="shallow-copy"/>
  <xsl:template match="*" mode="pm:local">
    <xsl:element name="{local-name()}">
      <xsl:for-each select="@*"><xsl:attribute name="{local-name()}" select="."/></xsl:for-each>
      <xsl:apply-templates mode="pm:local"/>
    </xsl:element>
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
