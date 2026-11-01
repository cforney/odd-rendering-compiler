<?xml version="1.0" encoding="UTF-8"?>
<!--
  generate-index.xsl — a linking index.html for a corpus of rendered editions,
  matching the JS multi-file index (cli.mjs buildIndexPage) so the two builds
  produce the same page. For each TEI source it links the rendered
  <basename>.html, counts the <note>s, and shows what the ODD's model for
  output "page" gives: the title, the number of page images and the IIIF
  manifest. It reads that model through the generated edition.xsl, imported.

  Point -s: at a file in the corpus directory, such as its first TEI file: TEI
  names in `files` resolve against that document's base URI, the same trick
  odd-to-ceteicean.xsl uses.

  Run:  saxon -s:../examples/tei_simler.odd -xsl:generate/generate-index.xsl
              -o:output/xslt-script/index.html
              files="simler-buchstabwechsel.xml|simler-psalmen.xml"
              title="…" subtitle="…"
-->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:local="urn:x-poc:odd"
  xmlns:pm="urn:x-poc:pm"
  exclude-result-prefixes="tei xs local pm">

  <xsl:import href="../output/edition.xsl"/>

  <xsl:output method="text" encoding="UTF-8"/>

  <!-- '|'-separated TEI file names, resolved against the -s: document's directory. -->
  <xsl:param name="files" as="xs:string" select="''"/>
  <xsl:param name="title" as="xs:string" select="'TEI Edition'"/>
  <xsl:param name="subtitle" as="xs:string" select="''"/>

  <!-- method=text emits raw, so escape HTML markup characters ourselves. -->
  <xsl:function name="local:esc" as="xs:string">
    <xsl:param name="s" as="xs:string?"/>
    <xsl:variable name="a" select="replace(string($s), '&amp;', '&amp;amp;')"/>
    <xsl:variable name="b" select="replace($a, '&lt;', '&amp;lt;')"/>
    <xsl:sequence select="replace($b, '>', '&amp;gt;')"/>
  </xsl:function>

  <xsl:template match="/">
    <xsl:variable name="names" select="tokenize($files, '\|')[. ne '']"/>
    <!-- Capture the source document's base URI here (the for-each context is a
         string, where the leading-'/' of base-uri(/) would have no node). -->
    <xsl:variable name="base" select="base-uri(/)"/>
    <xsl:text><![CDATA[<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>]]></xsl:text>
    <xsl:value-of select="local:esc($title)"/>
    <xsl:text><![CDATA[</title>
  <style>
    body {
      font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
      max-width: 42em; margin: 2em auto; padding: 0 1em;
      background: #fefefe; color: #222; line-height: 1.7;
    }
    h1 { font-size: 1.5em; }
    .subtitle { color: #666; font-size: 0.95em; margin-top: -0.5em; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.5em 0; border-bottom: 1px solid #eee; }
    a { color: #2563eb; text-decoration: none; font-size: 1.05em; }
    a:hover { text-decoration: underline; }
    .meta { display: block; color: #888; font-size: 0.8em; font-family: system-ui, sans-serif; }
    .meta a { font-size: inherit; }
  </style>
</head>
<body>
  <h1>]]></xsl:text>
    <xsl:value-of select="local:esc($title)"/>
    <xsl:text><![CDATA[</h1>
  <p class="subtitle">]]></xsl:text>
    <xsl:value-of select="local:esc($subtitle)"/>
    <xsl:text><![CDATA[</p>
  <ul>
]]></xsl:text>
    <xsl:for-each select="$names">
      <xsl:variable name="doc" select="doc(resolve-uri(., $base))"/>
      <xsl:variable name="page" select="pm:select($doc/*, 'page')?params"/>
      <xsl:variable name="t" select="($page?title ! string(), .)[.][1]"/>
      <xsl:variable name="manifest" select="string(head($page?manifest))"/>
      <xsl:variable name="n" select="count($doc//tei:note)"/>
      <xsl:variable name="href" select="replace(., '\.xml$', '.html')"/>
      <xsl:text><![CDATA[      <li>
        <a href="]]></xsl:text>
      <xsl:value-of select="local:esc($href)"/>
      <xsl:text>"&gt;</xsl:text>
      <xsl:value-of select="local:esc($t)"/>
      <xsl:text><![CDATA[</a>
        <span class="meta">]]></xsl:text>
      <xsl:value-of select="string-join(($n || ' note(s) · interactive', $page?pages[1] ! (count($page?pages) || ' page image(s)')), ' · ')"/>
      <xsl:if test="$manifest">
        <xsl:text> · &lt;a href="</xsl:text>
        <xsl:value-of select="local:esc($manifest)"/>
        <xsl:text>"&gt;IIIF manifest&lt;/a&gt;</xsl:text>
      </xsl:if>
      <xsl:text><![CDATA[</span>
      </li>
]]></xsl:text>
    </xsl:for-each>
    <xsl:text><![CDATA[  </ul>
</body>
</html>]]></xsl:text>
  </xsl:template>

</xsl:stylesheet>
