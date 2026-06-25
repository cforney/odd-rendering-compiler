<?xml version="1.0" encoding="UTF-8"?>
<!--
  odd-to-css.xsl — the "generate" step for the CSS floor, in XSLT.

  Reads a TEI ODD and emits edition.css from the Processing Model: one rule per
  <model> with the behaviour's `display` plus its <outputRendition> declarations.
  Simple `@a='v'` predicates become attribute selectors (.tei-x[data-a="v"]); the
  rest are emitted as comments. The XSLT counterpart of odd-to-css.mjs — same
  selectors and declarations, but not its exact whitespace.

  Run:  saxon -s:../examples/tei_simler.odd -xsl:generate/odd-to-css.xsl
              -o:output/edition.css
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:local="urn:x-poc:odd"
  exclude-result-prefixes="tei xs map local">

  <xsl:output method="text" encoding="UTF-8"/>

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
            then local:schema-specs(//tei:schemaSpec/node(), ())[tei:model]
            else //tei:elementSpec[tei:model]"/>

  <!-- behaviour → CSS display (the visual subset of the Processing Model) -->
  <xsl:variable name="display" as="map(xs:string, xs:string)" select="map {
    'inline'   : 'inline',
    'block'    : 'block',
    'paragraph': 'block',
    'section'  : 'block',
    'heading'  : 'block',
    'body'     : 'block',
    'quote'    : 'block',
    'list'     : 'block',
    'listItem' : 'list-item',
    'cit'      : 'block',
    'table'    : 'table',
    'row'      : 'table-row',
    'cell'     : 'table-cell',
    'metadata' : 'none',
    'omit'     : 'none'
  }"/>

  <!-- behaviours with no static CSS expression (need JS) -->
  <xsl:variable name="jsBehaviours" select="('note','link','alternate','graphic','glyph','anchor','index')"/>

  <xsl:template match="/">
    <xsl:text>/* edition.css — generated from the TEI ODD Processing Model (odd-to-css.xsl).&#10;</xsl:text>
    <xsl:text>   The visual subset of the PM: one rule per &lt;model&gt;, display + outputRendition. */&#10;&#10;</xsl:text>

    <!-- Source renditions declared in <tagsDecl> (the simplePrint @rendition convention) -->
    <xsl:variable name="rends" select="//tei:tagsDecl/tei:rendition[@xml:id]"/>
    <xsl:if test="$rends">
      <xsl:text>/* Source renditions (from &lt;tagsDecl&gt;, via @rendition) */&#10;</xsl:text>
      <xsl:for-each select="$rends">
        <xsl:value-of select="'.r-' || @xml:id || ' { ' || normalize-space(.) || ' }&#10;'"/>
      </xsl:for-each>
      <xsl:text>&#10;</xsl:text>
    </xsl:if>

    <xsl:apply-templates select="$specs" mode="css"/>
  </xsl:template>

  <xsl:template match="tei:elementSpec" mode="css">
    <xsl:variable name="ident" select="string(@ident)"/>
    <xsl:for-each select="tei:model">
      <xsl:variable name="b" select="string(@behaviour)"/>
      <xsl:variable name="decls"
        select="normalize-space(string-join(tei:outputRendition[not(@scope)], ' '))"/>
      <xsl:variable name="disp" select="if (map:contains($display,$b)) then $display($b) else ()"/>

      <!-- selector: base; parent::/ancestor:: combinators; @a='v'/@a attribute
           selectors; or a comment for predicates CSS cannot express. Matches the
           simple shapes the JS odd-to-css translates; compound predicates
           (with or/and/count(…)) fall through to a comment. -->
      <xsl:choose>
        <xsl:when test="$b = $jsBehaviours">
          <xsl:value-of select="'/* .tei-' || $ident || ' — ' || $b || ' behaviour needs JavaScript */&#10;'"/>
        </xsl:when>
        <xsl:when test="@predicate and matches(@predicate, '^parent::\i\c*$')">
          <xsl:call-template name="rule">
            <xsl:with-param name="sel" select="'.tei-' || substring-after(@predicate, 'parent::') || ' > .tei-' || $ident"/>
            <xsl:with-param name="disp" select="$disp"/>
            <xsl:with-param name="decls" select="$decls"/>
          </xsl:call-template>
        </xsl:when>
        <xsl:when test="@predicate and matches(@predicate, '^ancestor::\i\c*$')">
          <xsl:call-template name="rule">
            <xsl:with-param name="sel" select="'.tei-' || substring-after(@predicate, 'ancestor::') || ' .tei-' || $ident"/>
            <xsl:with-param name="disp" select="$disp"/>
            <xsl:with-param name="decls" select="$decls"/>
          </xsl:call-template>
        </xsl:when>
        <xsl:when test="@predicate and matches(@predicate, '^@\i\c*=''[^'']*''$')">
          <xsl:variable name="sel"
            select="replace(@predicate, '^@(\i\c*)=''([^'']*)''$', '.tei-' || $ident || '[data-$1=&quot;$2&quot;]')"/>
          <xsl:call-template name="rule">
            <xsl:with-param name="sel" select="$sel"/>
            <xsl:with-param name="disp" select="$disp"/>
            <xsl:with-param name="decls" select="$decls"/>
          </xsl:call-template>
        </xsl:when>
        <xsl:when test="@predicate and matches(@predicate, '^@\i\c*$')">
          <xsl:call-template name="rule">
            <xsl:with-param name="sel" select="'.tei-' || $ident || '[data-' || substring(@predicate, 2) || ']'"/>
            <xsl:with-param name="disp" select="$disp"/>
            <xsl:with-param name="decls" select="$decls"/>
          </xsl:call-template>
        </xsl:when>
        <xsl:when test="@predicate">
          <xsl:message select="'[odd-to-css] ⚠ unsupported predicate, left as fallback: ' || @predicate"/>
          <xsl:value-of select="'/* .tei-' || $ident || ' — predicate not translatable to CSS: ' || replace(@predicate, '\*/', '* /') || ' */&#10;'"/>
          <!-- still emit the base rule so the element has its display -->
          <xsl:call-template name="rule">
            <xsl:with-param name="sel" select="'.tei-' || $ident"/>
            <xsl:with-param name="disp" select="$disp"/>
            <xsl:with-param name="decls" select="''"/>
          </xsl:call-template>
        </xsl:when>
        <xsl:otherwise>
          <xsl:call-template name="rule">
            <xsl:with-param name="sel" select="'.tei-' || $ident"/>
            <xsl:with-param name="disp" select="$disp"/>
            <xsl:with-param name="decls" select="$decls"/>
          </xsl:call-template>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <xsl:template name="rule">
    <xsl:param name="sel"/>
    <xsl:param name="disp"/>
    <xsl:param name="decls"/>
    <xsl:variable name="body"
      select="normalize-space(string-join((if ($disp) then 'display: ' || $disp || ';' else (), $decls), ' '))"/>
    <xsl:if test="$body ne ''">
      <xsl:value-of select="$sel || ' { ' || $body || ' }&#10;'"/>
    </xsl:if>
  </xsl:template>

</xsl:stylesheet>
