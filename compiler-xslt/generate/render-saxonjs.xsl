<?xml version="1.0" encoding="UTF-8"?>
<!-- render-saxonjs.xsl — interactive SaxonJS (client-side) driver.

     Reuses every element template from the generated edition.xsl (imported), so
     the body is rendered by the SAME XSLT 3.0 stylesheet that Saxon runs at build
     time — here compiled to a SEF (with xslt3) and executed in the browser by
     SaxonJS. This is what completes the template-matching axis on the client side:
     one stylesheet, two entry points (Saxon HE at build, SaxonJS in the browser).

     Interactivity comes from IXSL event templates (mode="ixsl:onclick"), the
     SaxonJS-native counterpart of the build path's ~12-line enhancement script —
     no hand-written JavaScript: note markers open their notes, apparatus
     readings swap. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:ixsl="http://saxonica.com/ns/interactiveXSLT"
                xmlns:tei="http://www.tei-c.org/ns/1.0"
                xmlns:pm="urn:x-poc:pm"
                extension-element-prefixes="ixsl"
                exclude-result-prefixes="tei pm"
                version="3.0">

  <!-- The build-time stylesheet: all the TEI element templates. -->
  <xsl:import href="../output/edition.xsl"/>

  <!-- Render the interactive (inline-note) variant of every behaviour. Overrides
       the imported default 'false' by import precedence. -->
  <xsl:param name="interactive" select="'true'"/>
  <!-- TEI document to load, relative to the hosting page. -->
  <xsl:param name="tei-uri" select="'simler-psalmen.xml'"/>

  <!-- On load: fetch the TEI and render the edition into the page container. -->
  <xsl:template name="main">
    <xsl:result-document href="#tei-content" method="ixsl:replace-content">
      <xsl:call-template name="pm:edition">
        <xsl:with-param name="doc" select="doc($tei-uri)"/>
      </xsl:call-template>
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

</xsl:stylesheet>
