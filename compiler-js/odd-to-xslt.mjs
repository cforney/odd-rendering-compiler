#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to an XSLT 1.0 stylesheet. XSLT expresses
 * every PM behaviour natively, including the ones that reshape the tree
 * (alternate, note, link, graphic), and XPath predicates pass through verbatim.
 *
 * Source appearance (the source element's own @rendition) is carried as r-<id>
 * classes — the same mechanism odd-to-unified.mjs and odd-to-xsl.xsl use, with
 * the matching .r-<id> rules supplied by odd-to-css. See tei-rendition-classes.
 *
 * Usage:  node odd-to-xslt.mjs --odd <path> [--out <dir>]
 * Output: <dir>/edition.xsl
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import {
  createOddParser, findElementSpecs, extractModels,
} from "./odd-parser.mjs";
import { BEHAVIOURS } from "./behaviour-map.mjs";
import { parseArgs, createLogger, writeOut, escapeXml as escXml, generatedStamp } from "./cli.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const cli = parseArgs();
const log = createLogger("odd-to-xslt");

const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-xslt.mjs --odd <path> [--out <dir>]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse ODD
// ---------------------------------------------------------------------------
const parser = createOddParser();
log(`Parsing ODD: ${oddPath}`);
const oddXml = readFileSync(resolve(oddPath), "utf-8");
const oddDoc = parser.parse(oddXml);

const elementSpecs = findElementSpecs(oddDoc);
const elements = elementSpecs.map((spec) => ({
  ident: spec["@_ident"],
  mode: spec["@_mode"] || "add",
  models: extractModels(spec),
}));

log(`Found ${elements.length} elementSpec(s)`);
log(`  With PM: ${elements.filter(e => e.models.length > 0).length}`);

// ---------------------------------------------------------------------------
// XSLT generation
// ---------------------------------------------------------------------------

/**
 * Simple element behaviours: a wrapper element (tag from behaviour-map.mjs)
 * around <xsl:apply-templates/>. The per-pipeline variations live here:
 * `pseudo` adds ::before/::after spans (inline/block); `className` overrides
 * the default `tei-<ident>` class.
 */
const SIMPLE_XSLT = {
  inline:    { pseudo: true },
  block:     { pseudo: true },
  paragraph: {},
  section:   {},
  document:  {},
  body:      { className: "tei-body" },
  cit:       {},
  table:     {},
  row:       {},
  cell:      {},
  list:      {},
  listItem:  {},
  title:     { className: "tei-title" },
};

/**
 * Map a PM behaviour + params to an XSLT template body.
 * Returns an array of XSLT lines (indented content inside xsl:template).
 */
function behaviourToXSLT(model, ident) {
  const b = model.behaviour;
  const params = Object.fromEntries(model.params.map(p => [p.name, p.value]));
  const cssFragments = model.css.filter(c => !c.scope).map(c => c.css.trim());
  const beforeCSS = model.css.filter(c => c.scope === "before").map(c => c.css.trim());
  const afterCSS = model.css.filter(c => c.scope === "after").map(c => c.css.trim());

  const styleAttr = cssFragments.length > 0
    ? ` style="${escXml(cssFragments.join(" "))}"`
    : "";

  // Source appearance (the source element's own @rendition) is carried via
  // r-<id> classes on the wrapper, not merged into an inline style — see the
  // shared tei-rendition-classes template.

  const beforePseudo = beforeCSS.length > 0
    ? [`      <span style="${escXml(beforeCSS.join(" "))}">`, `      </span>`]
    : [];
  const afterPseudo = afterCSS.length > 0
    ? [`      <span style="${escXml(afterCSS.join(" "))}">`, `      </span>`]
    : [];

  // Simple wrapper behaviours: the HTML element comes from the shared
  // behaviour map; only the XSLT-specific framing (pseudo spans, class
  // override) is decided here.
  const simple = SIMPLE_XSLT[b];
  if (simple && BEHAVIOURS[b]?.tag) {
    const tag = BEHAVIOURS[b].tag;
    const cls = simple.className || `tei-${ident}`;
    return [
      `    <${tag}${styleAttr}>`,
      `      <xsl:attribute name="class">${cls}<xsl:call-template name="tei-rendition-classes"/></xsl:attribute>`,
      ...(simple.pseudo ? beforePseudo : []),
      `      <xsl:apply-templates/>`,
      ...(simple.pseudo ? afterPseudo : []),
      `    </${tag}>`,
    ];
  }

  switch (b) {
    case "heading": {
      const level = params.level || "1";
      // If level is an XPath expression (e.g. count(ancestor::div)), use xsl:element
      if (/[^0-9]/.test(level)) {
        return [
          `    <xsl:variable name="hlevel">`,
          `      <xsl:variable name="raw"><xsl:value-of select="${escXml(level)}"/></xsl:variable>`,
          `      <xsl:choose>`,
          `        <xsl:when test="$raw &gt; 6">6</xsl:when>`,
          `        <xsl:when test="$raw &lt; 1">1</xsl:when>`,
          `        <xsl:otherwise><xsl:value-of select="$raw"/></xsl:otherwise>`,
          `      </xsl:choose>`,
          `    </xsl:variable>`,
          `    <xsl:element name="h{$hlevel}">`,
          `      <xsl:attribute name="class">tei-${ident}</xsl:attribute>`,
          `      <xsl:apply-templates/>`,
          `    </xsl:element>`,
        ];
      }
      const tag = `h${Math.min(6, Math.max(1, parseInt(level, 10) || 1))}`;
      return [
        `    <${tag} class="tei-${ident}"${styleAttr}>`,
        `      <xsl:apply-templates/>`,
        `    </${tag}>`,
      ];
    }

    case "note": {
      const place = params.place || "'foot'";
      return [
        `    <xsl:variable name="noteId" select="generate-id(.)"/>`,
        `    <!-- note behaviour: inline marker + end content -->`,
        `    <a class="tei-note-ref" href="#note-{$noteId}">`,
        `      <xsl:number level="any" count="tei:note"/>`,
        `    </a>`,
        `    <!-- The note body is collected at document end via a named template -->`,
      ];
    }

    case "link": {
      const uri = params.uri || "@target";
      return [
        `    <a class="tei-${ident}">`,
        `      <xsl:attribute name="href">`,
        `        <xsl:value-of select="${escXml(uri)}"/>`,
        `      </xsl:attribute>`,
        `      <xsl:apply-templates/>`,
        `    </a>`,
      ];
    }

    case "alternate": {
      const def = params.default || "*[1]";
      const alt = params.alternate || "*[2]";
      return [
        `    <span class="tei-alternate tei-${ident}">`,
        `      <span class="tei-alternate-default">`,
        `        <xsl:apply-templates select="${escXml(def)}"/>`,
        `      </span>`,
        `      <span class="tei-alternate-alt" hidden="hidden">`,
        `        <xsl:apply-templates select="${escXml(alt)}"/>`,
        `      </span>`,
        `    </span>`,
      ];
    }

    case "graphic": {
      const url = params.url || "@url";
      return [
        `    <figure class="tei-${ident}">`,
        `      <img>`,
        `        <xsl:attribute name="src">`,
        `          <xsl:value-of select="${escXml(url)}"/>`,
        `        </xsl:attribute>`,
        `        <xsl:if test="tei:desc">`,
        `          <xsl:attribute name="alt"><xsl:value-of select="tei:desc"/></xsl:attribute>`,
        `        </xsl:if>`,
        `      </img>`,
        `    </figure>`,
      ];
    }

    case "anchor":
      return [
        `    <a class="tei-${ident}">`,
        `      <xsl:attribute name="id"><xsl:value-of select="@xml:id"/></xsl:attribute>`,
        `    </a>`,
      ];

    case "break":
      return [`    <br class="tei-${ident}"/>`];

    case "glyph": {
      const uri = params.uri || "''";
      return [
        `    <span class="tei-glyph" data-glyph="{${escXml(uri)}}">`,
        `      <xsl:apply-templates/>`,
        `    </span>`,
      ];
    }

    case "metadata":
    case "omit":
      return [`    <!-- omitted: ${ident} -->`];

    case "index":
      return [
        `    <span class="tei-index" data-index="{@indexName}">`,
        `      <xsl:apply-templates/>`,
        `    </span>`,
      ];

    case "text":
      return [`    <xsl:apply-templates/>`];

    default:
      return [
        `    <!-- unknown behaviour: ${escXml(b)} -->`,
        `    <span class="tei-${ident}">`,
        `      <xsl:apply-templates/>`,
        `    </span>`,
      ];
  }
}

/**
 * Assemble a compound / sequence behaviour into XSLT. Sub-behaviours are emitted
 * in order, except that a `link` sub-model *wraps* the rest — so a `<pb>` declared
 * as link + graphic renders as one clickable thumbnail
 * (`<a href="…full"><figure><img …></figure></a>`), matching odd-to-xsl.xsl and the
 * unified path, instead of an empty link beside a detached image.
 */
function compoundToXSLT(subModels, ident) {
  const link = subModels.find((sm) => sm.behaviour === "link");
  if (link) {
    const uri = Object.fromEntries(link.params.map((p) => [p.name, p.value])).uri || "@target";
    const rest = subModels.filter((sm) => sm !== link);
    return [
      `    <a class="tei-${ident}">`,
      `      <xsl:attribute name="href">`,
      `        <xsl:value-of select="${escXml(uri)}"/>`,
      `      </xsl:attribute>`,
      ...rest.flatMap((sm) => behaviourToXSLT(sm, ident)),
      `    </a>`,
    ];
  }
  return subModels.flatMap((sm) => behaviourToXSLT(sm, ident));
}

/**
 * Generate a complete XSLT 1.0 stylesheet from the parsed element models.
 */
function generateXSLT(elements) {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!--`,
    `  XSLT 1.0 stylesheet generated from TEI ODD Processing Model`,
    `  Source: ${basename(oddPath)}`,
    ...(stamp ? [`  Generated: ${stamp}`] : []),
    ``,
    `  Unlike the CSS output, this stylesheet can express ALL 25 PM behaviours`,
    `  including note, link, alternate, and graphic. XPath predicates are`,
    `  preserved verbatim — no translation gap.`,
    `-->`,
    `<xsl:stylesheet version="1.0"`,
    `  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"`,
    `  xmlns:tei="http://www.tei-c.org/ns/1.0"`,
    `  exclude-result-prefixes="tei">`,
    ``,
    `  <xsl:output method="html" encoding="UTF-8" indent="yes"/>`,
    ``,
    `  <!-- ============================================================ -->`,
    `  <!-- Root template: HTML wrapper                                   -->`,
    `  <!-- ============================================================ -->`,
    `  <xsl:template match="/">`,
    `    <html>`,
    `      <head>`,
    `        <meta charset="UTF-8"/>`,
    `        <title><xsl:value-of select="//tei:titleStmt/tei:title[1]"/></title>`,
    `        <link rel="stylesheet" href="edition.css"/>`,
    `      </head>`,
    `      <body class="tei-edition">`,
    `        <xsl:apply-templates select="//tei:text"/>`,
    `        <!-- Collected footnotes -->`,
    `        <xsl:if test="//tei:note">`,
    `          <section class="tei-footnotes">`,
    `            <hr/>`,
    `            <xsl:for-each select="//tei:note">`,
    `              <div class="tei-footnote" id="note-{generate-id(.)}">`,
    `                <span class="tei-note-num"><xsl:number level="any" count="tei:note"/>.</span>`,
    `                <xsl:text> </xsl:text>`,
    `                <xsl:apply-templates/>`,
    `              </div>`,
    `            </xsl:for-each>`,
    `          </section>`,
    `        </xsl:if>`,
    `      </body>`,
    `    </html>`,
    `  </xsl:template>`,
    ``,
    `  <!-- Suppress teiHeader by default -->`,
    `  <xsl:template match="tei:teiHeader"/>`,
    ``,
    `  <!-- Source appearance: turn an element's @rendition pointer list (e.g.`,
    `       "#aq #c") into space-prefixed r-<id> classes that edition.css (from`,
    `       <tagsDecl>) styles. XSLT 1.0 has no tokenize(), so recurse over the`,
    `       space-separated list; a token's leading # is stripped if present. -->`,
    `  <xsl:template name="tei-rendition-classes">`,
    `    <xsl:param name="tokens" select="normalize-space(@rendition)"/>`,
    `    <xsl:if test="$tokens != ''">`,
    `      <xsl:variable name="tok">`,
    `        <xsl:choose>`,
    `          <xsl:when test="contains($tokens, ' ')"><xsl:value-of select="substring-before($tokens, ' ')"/></xsl:when>`,
    `          <xsl:otherwise><xsl:value-of select="$tokens"/></xsl:otherwise>`,
    `        </xsl:choose>`,
    `      </xsl:variable>`,
    `      <xsl:text> r-</xsl:text>`,
    `      <xsl:choose>`,
    `        <xsl:when test="starts-with($tok, '#')"><xsl:value-of select="substring-after($tok, '#')"/></xsl:when>`,
    `        <xsl:otherwise><xsl:value-of select="$tok"/></xsl:otherwise>`,
    `      </xsl:choose>`,
    `      <xsl:if test="contains($tokens, ' ')">`,
    `        <xsl:call-template name="tei-rendition-classes">`,
    `          <xsl:with-param name="tokens" select="normalize-space(substring-after($tokens, ' '))"/>`,
    `        </xsl:call-template>`,
    `      </xsl:if>`,
    `    </xsl:if>`,
    `  </xsl:template>`,
    ``,
  ];

  let templateCount = 0;

  for (const el of elements) {
    if (el.models.length === 0) continue;

    lines.push(`  <!-- *** <${el.ident}> *** -->`);

    // Collect all flat models (expand sequences and nested compounds)
    const flatModels = [];
    for (const m of el.models) {
      if (m.type === "sequence") {
        // For sequences, combine the sub-models into a single template
        flatModels.push({
          ...m,
          behaviour: "__sequence__",
          subModels: m.models || [],
        });
      } else if (m.nested) {
        // Boot's nested-model extension: compound behaviour wrapping sub-models
        flatModels.push({
          ...m,
          behaviour: "__compound__",
          subModels: m.nested,
        });
      } else {
        flatModels.push(m);
      }
    }

    // If there's only one model without a predicate, emit a simple template
    if (flatModels.length === 1 && !flatModels[0].predicate) {
      const m = flatModels[0];
      lines.push(`  <xsl:template match="tei:${el.ident}">`);
      if (m.behaviour === "__sequence__" || m.behaviour === "__compound__") {
        lines.push(...compoundToXSLT(m.subModels, el.ident));
      } else {
        lines.push(...behaviourToXSLT(m, el.ident));
      }
      lines.push(`  </xsl:template>`);
      templateCount++;
      lines.push(``);
      continue;
    }

    // Multiple models or models with predicates → use xsl:choose or separate templates
    // Strategy: emit separate templates with match predicates where possible,
    // or a single template with xsl:choose for complex cases
    const withPredicate = flatModels.filter(m => m.predicate);
    const withoutPredicate = flatModels.filter(m => !m.predicate);

    if (withPredicate.length > 0) {
      // Emit individual templates with XPath match predicates
      for (const m of withPredicate) {
        const matchExpr = `tei:${el.ident}[${m.predicate}]`;
        lines.push(`  <xsl:template match="${escXml(matchExpr)}">`);
        if (m.behaviour === "__sequence__" || m.behaviour === "__compound__") {
          lines.push(...compoundToXSLT(m.subModels, el.ident));
        } else {
          lines.push(...behaviourToXSLT(m, el.ident));
        }
        lines.push(`  </xsl:template>`);
        templateCount++;
      }
    }

    // Default (no predicate) — lowest priority
    if (withoutPredicate.length > 0) {
      const m = withoutPredicate[0]; // Take the first unpredicated model as fallback
      lines.push(`  <xsl:template match="tei:${el.ident}">`);
      if (m.behaviour === "__sequence__" || m.behaviour === "__compound__") {
        lines.push(...compoundToXSLT(m.subModels, el.ident));
      } else {
        lines.push(...behaviourToXSLT(m, el.ident));
      }
      lines.push(`  </xsl:template>`);
      templateCount++;
    }

    lines.push(``);
  }

  // Fallback: pass-through for unmatched TEI elements
  lines.push(`  <!-- Fallback: pass through unmatched elements -->`);
  lines.push(`  <xsl:template match="tei:*">`);
  lines.push(`    <xsl:apply-templates/>`);
  lines.push(`  </xsl:template>`);
  lines.push(``);
  lines.push(`</xsl:stylesheet>`);

  return { xslt: lines.join("\n"), stats: { templateCount } };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { xslt, stats } = generateXSLT(elements);
const xslPath = writeOut(outDir, "edition.xsl", xslt);

log(`✓ XSLT written to ${xslPath} (${stats.templateCount} templates)`);
log(`All 25 PM behaviours supported — no CSS translation gap`);
