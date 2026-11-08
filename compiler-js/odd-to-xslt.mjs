#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to an XSLT 3.0 stylesheet, edition.xsl:
 * for each TEI element a template in mode pm:select that gives, for an output,
 * the first of its models whose predicate holds (an xsl:choose in document
 * order) as a map of its behaviour, classes and params; and the views laid over
 * the page, as $pm:views. Predicates and params pass through as XPath, so XSLT
 * evaluates them natively. The behaviours are the runtime ../runtime/pm.xsl,
 * copied in, as compiler-xslt's odd-to-xsl.xsl does too.
 *
 * Usage:   node odd-to-xslt.mjs --odd <path> [--out <dir>]
 * Output:  <dir>/edition.xsl (stylesheet params: output, interactive), with
 *          the scripts of ../runtime that an enhanced page inlines
 * Read by: render-xslt.mjs (--xsl), or any XSLT 3.0 processor
 */

import { readFileSync, copyFileSync } from "fs";
import { basename, join } from "path";
import { parseArgs, loadOdd, createLogger, writeOut, generatedStamp } from "./cli.mjs";
import { escapeXml } from "./html.mjs";

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
const odd = loadOdd(oddPath, "odd-to-xslt");
const specs = odd.specs.filter((s) => s.models.length);
const runtime = readFileSync(new URL("../runtime/pm.xsl", import.meta.url), "utf8")
  .match(/<xsl:stylesheet[^>]*>([\s\S]*)<\/xsl:stylesheet>/)[1];

/** An XPath string literal. */
const q = (s) => `'${s.replace(/'/g, "''")}'`;

/** A model as an XPath map, as pm.xsl renders it: its params evaluated where the element stands, a part's predicate as `live`. */
function map(m, part = false) {
  const params = m.params.map((p) => `${q(p.name)}: (${p.value})`);
  const entries = [
    `'behaviour': ${q(m.behaviour)}`,
    m.tag && `'tag': ${q(m.tag)}`,
    m.flow && `'flow': ${q(m.flow)}`,
    m.classes.length && `'classes': (${m.classes.map(q).join(", ")})`,
    m.source && `'source': true()`,
    m.template && `'template': ${q(m.template)}`,
    params.length && `'params': map { ${params.join(", ")} }`,
    m.parts && `'parts': (${m.parts.map((p) => map(p, true)).join(", ")})`,
    part && `'live': ${m.predicate ? `boolean(${m.predicate})` : "true()"}`,
  ];
  return `map { ${entries.filter(Boolean).join(", ")} }`;
}

/** An element's first model of the output asked for ('' the models without @output) whose predicate holds. */
function template({ key, models }) {
  const test = (m) => [`$output = ${q(m.output ?? "")}`, m.predicate && `(${m.predicate})`].filter(Boolean).join(" and ");
  return [
    `<xsl:template match="${key.startsWith("{") ? `Q${key}` : key}" mode="pm:select">`,
    `  <xsl:param name="output" as="xs:string"/>`,
    `  <xsl:choose>`,
    ...models.map((m) => `    <xsl:when test="${escapeXml(test(m))}"><xsl:sequence select="${escapeXml(map(m))}"/></xsl:when>`),
    `  </xsl:choose>`,
    `</xsl:template>`,
  ];
}

const views = odd.views.map((v) => `map { 'output': ${q(v.output)}, 'label': ${q(v.label)} }`);

const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<!-- edition.xsl — generated from ${basename(oddPath)} by odd-to-xslt.mjs${stamp ? `, ${stamp}` : ""}.
     The runtime part is runtime/pm.xsl; the views and templates at the end are the ODD's models. -->
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map"
  xmlns:tei="http://www.tei-c.org/ns/1.0"
  xmlns:pm="urn:x-poc:pm"
  xpath-default-namespace="http://www.tei-c.org/ns/1.0"
  exclude-result-prefixes="#all">
${runtime}
  <xsl:variable name="pm:views" as="map(*)*" select="${escapeXml(`(${views.join(", ")})`)}"/>
${specs.flatMap(template).map((l) => `  ${l}`).join("\n")}
</xsl:stylesheet>
`;

const xslPath = writeOut(outDir, "edition.xsl", xslt);
for (const script of ["readings.js", "notes.js", "facsimile.js"]) copyFileSync(new URL(`../runtime/${script}`, import.meta.url), join(outDir, script));
log(`✓ ${xslPath} (${specs.length} elements, ${specs.reduce((n, s) => n + s.models.length, 0)} models, ${odd.views.length} views)`);
