#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to an XSLT 3.0 stylesheet, edition.xsl:
 * for each TEI element one template that takes the first of its models whose
 * output and predicate fit (an xsl:choose in document order, the output's own
 * models first) and calls pm:model with the model's behaviour, classes and
 * params. Predicates and params pass through as XPath, so XSLT evaluates them
 * natively. The behaviours are the runtime ../runtime/pm.xsl, copied in, as
 * compiler-xslt's odd-to-xsl.xsl does too.
 *
 * Usage:  node odd-to-xslt.mjs --odd <path> [--out <dir>]
 * Output: <dir>/edition.xsl (stylesheet params: output, interactive)
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { readOdd } from "./odd-parser.mjs";
import { parseArgs, createLogger, writeOut, escapeXml, generatedStamp } from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("odd-to-xslt");
const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-xslt.mjs --odd <path> [--out <dir>]");
  process.exit(1);
}

log(`Parsing ODD: ${oddPath}`);
const specs = readOdd(resolve(oddPath)).specs.filter((s) => s.models.length);
const runtime = readFileSync(new URL("../runtime/pm.xsl", import.meta.url), "utf8")
  .match(/<xsl:stylesheet[^>]*>([\s\S]*)<\/xsl:stylesheet>/)[1];

/** An XPath string literal. */
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const indent = (lines, pad = "  ") => lines.map((l) => pad + l);

/** The call of pm:model for one model. */
function call(m, first = "true()", inner = []) {
  const params = m.params.map((p) => `${q(p.name)}: (${p.value})`).join(", ");
  const param = (name, select) => `  <xsl:with-param name="${name}" select="${escapeXml(select)}"/>`;
  return [
    `<xsl:call-template name="pm:model">`,
    param("behaviour", q(m.behaviour)),
    m.tag && param("tag", q(m.tag)),
    m.flow && param("flow", q(m.flow)),
    m.classes.length && param("classes", `(${m.classes.map(q).join(", ")})`),
    m.source && param("source", "true()"),
    params && param("params", `map { ${params} }`),
    first !== "true()" && param("first", first),
    ...(inner.length ? [`  <xsl:with-param name="inner" as="node()*">`, ...indent(inner, "    "), `  </xsl:with-param>`] : []),
    `</xsl:call-template>`,
  ].filter(Boolean);
}

/** A model's rendering: a sequence renders each part whose predicate holds, a compound's link wraps the other parts. */
function body(m) {
  if (m.behaviour === "sequence") {
    return m.parts.flatMap((p, k) => {
      const earlier = m.parts.slice(0, k);
      const first = !k ? "true()" : earlier.every((e) => e.predicate) ? earlier.map((e) => `not(${e.predicate})`).join(" and ") : "false()";
      return p.predicate ? [`<xsl:if test="${escapeXml(p.predicate)}">`, ...indent(call(p, first)), `</xsl:if>`] : call(p, first);
    });
  }
  if (m.behaviour === "compound") {
    const first = (p) => (p === m.parts[0] ? "true()" : "false()");
    const link = m.parts.find((p) => p.behaviour === "link");
    const rest = m.parts.filter((p) => p !== link).flatMap((p) => call(p, first(p)));
    return link ? call(link, first(link), rest) : rest;
  }
  return call(m);
}

function templates({ ident, models }) {
  const ordered = [...models.filter((m) => m.output), ...models.filter((m) => !m.output)];
  const test = (m) => escapeXml([m.output && `$output = ${q(m.output)}`, m.predicate && `(${m.predicate})`].filter(Boolean).join(" and ") || "true()");
  return [
    `<!-- <${ident}> -->`,
    `<xsl:template match="${ident}">`,
    `  <xsl:choose>`,
    ...ordered.flatMap((m) => [`    <xsl:when test="${test(m)}">`, ...indent(body(m), "      "), `    </xsl:when>`]),
    `    <xsl:otherwise><xsl:apply-templates/></xsl:otherwise>`,
    `  </xsl:choose>`,
    `</xsl:template>`,
    `<xsl:template match="${ident}" mode="pm:flow">`,
    `  <xsl:choose>`,
    ...ordered.map((m) => `    <xsl:when test="${test(m)}"><xsl:sequence select="${q(m.flow)}"/></xsl:when>`),
    `  </xsl:choose>`,
    `</xsl:template>`,
    ``,
  ];
}

const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<!-- edition.xsl — generated from ${basename(oddPath)} by odd-to-xslt.mjs${stamp ? `, ${stamp}` : ""}.
     The runtime part is runtime/pm.xsl; the templates at the end are the ODD's models. -->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:pm="urn:x-poc:pm"
  xpath-default-namespace="http://www.tei-c.org/ns/1.0"
  exclude-result-prefixes="#all">
${runtime}
${indent(specs.flatMap(templates)).join("\n")}
</xsl:stylesheet>
`;

const xslPath = writeOut(outDir, "edition.xsl", xslt);
log(`✓ ${xslPath} (${specs.length} elements, ${specs.reduce((n, s) => n + s.models.length, 0)} models)`);
