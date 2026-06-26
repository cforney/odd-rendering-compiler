<?xml version="1.0" encoding="UTF-8"?>
<!-- render-saxonjs.xsl — interactive SaxonJS (client-side) driver.

     Reuses every element template from the generated edition.xsl (imported), so
     the body is rendered by the SAME XSLT 3.0 stylesheet that Saxon runs at build
     time — here compiled to a SEF (with xslt3) and executed in the browser by
     SaxonJS. This is what completes the template-matching axis on the client side:
     one stylesheet, two entry points (Saxon HE at build, SaxonJS in the browser).

     Interactivity comes from IXSL event templates (mode="ixsl:onclick"), the
     SaxonJS-native counterpart of the build path's ~12-line enhancement script —
     no hand-written JavaScript. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:ixsl="http://saxonica.com/ns/interactiveXSLT"
                xmlns:tei="http://www.tei-c.org/ns/1.0"
                xmlns:local="urn:x-poc:odd"
                extension-element-prefixes="ixsl"
                exclude-result-prefixes="tei local"
                version="3.0">

  <!-- The build-time stylesheet: all the TEI element templates. -->
  <xsl:import href="../output/edition.xsl"/>

  <!-- Render the interactive (inline-note) variant of every behaviour. Overrides
       the imported default 'false' by import precedence. -->
  <xsl:param name="interactive" select="'true'"/>
  <!-- TEI document to load, relative to the hosting page. -->
  <xsl:param name="tei-uri" select="'simler-poem.xml'"/>

  <!-- On load: fetch the TEI and render its <text> into the page container. -->
  <xsl:template name="main">
    <xsl:result-document href="#tei-content" method="ixsl:replace-content">
      <xsl:apply-templates select="doc($tei-uri)//tei:text"/>
    </xsl:result-document>
  </xsl:template>

  <!-- Click a note marker → toggle its body open/closed. -->
  <xsl:template match="*[contains-token(@class, 'tei-note-ref')]" mode="ixsl:onclick">
    <xsl:for-each select="ancestor::*[contains-token(@class, 'tei-note-interactive')][1]">
      <ixsl:set-attribute name="class"
        select="if (contains-token(@class, 'open'))
                then string-join(tokenize(normalize-space(@class), ' ')[. ne 'open'], ' ')
                else normalize-space(@class || ' open')"/>
    </xsl:for-each>
  </xsl:template>

  <!-- Click an apparatus reading → swap default and alternate. -->
  <xsl:template match="*[contains-token(@class, 'tei-alternate')]" mode="ixsl:onclick">
    <xsl:for-each select="descendant-or-self::*[contains-token(@class, 'tei-alternate-default')
                                             or contains-token(@class, 'tei-alternate-alt')]">
      <xsl:choose>
        <xsl:when test="exists(@hidden)"><ixsl:remove-attribute name="hidden"/></xsl:when>
        <xsl:otherwise><ixsl:set-attribute name="hidden" select="'hidden'"/></xsl:otherwise>
      </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <!-- Click the facsimile button → hide/show the page-break thumbnails.
       Page elements live in the XHTML namespace, so match on @id / local-name()
       rather than the bare element name (as the class-based handlers above do). -->
  <xsl:template match="*[@id = 'facs-toggle-btn']" mode="ixsl:onclick">
    <xsl:variable name="body" select="ixsl:page()//*[local-name() = 'body']"/>
    <xsl:variable name="hidden" select="contains-token($body/@class, 'facs-hidden')"/>
    <xsl:for-each select="$body">
      <ixsl:set-attribute name="class"
        select="if ($hidden)
                then string-join(tokenize(normalize-space(@class), ' ')[. ne 'facs-hidden'], ' ')
                else normalize-space(string-join((@class, 'facs-hidden'), ' '))"/>
    </xsl:for-each>
    <xsl:result-document href="#facs-toggle-btn" method="ixsl:replace-content">
      <xsl:value-of select="if ($hidden) then 'Hide facsimiles' else 'Show facsimiles'"/>
    </xsl:result-document>
  </xsl:template>

</xsl:stylesheet>
