#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to CSS. Each <model> behaviour +
 * <outputRendition> becomes a rule, and each <tagsDecl> rendition an .r-<id>
 * rule. XPath predicates CSS can express become selectors; the rest are left as
 * comments for the HTML and JS tiers to handle.
 *
 * Usage:  node odd-to-css.mjs --odd <path> [--out <dir>]
 * Output: <dir>/edition.css
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import {
  createOddParser, findElementSpecs, extractModels, extractRenditions,
} from "./odd-parser.mjs";
import { behaviourBaseCss, BEHAVIOURS } from "./behaviour-map.mjs";
import { parseArgs, createLogger, writeOut, teiClass } from "./cli.mjs";

// ---------------------------------------------------------------------------
// CLI + parse
// ---------------------------------------------------------------------------
const cli = parseArgs();
const log = createLogger("odd-to-css");

const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";

if (!oddPath) {
  console.error("Usage: node odd-to-css.mjs --odd <path> [--out <dir>]");
  process.exit(1);
}

const parser = createOddParser();
log(`Parsing ODD: ${oddPath}`);
const oddDoc = parser.parse(readFileSync(resolve(oddPath), "utf-8"));

const elements = findElementSpecs(oddDoc).map((spec) => ({
  ident: spec["@_ident"],
  models: extractModels(spec),
}));
const renditions = extractRenditions(oddDoc);

log(`Found ${elements.length} elementSpec(s); ${elements.filter((e) => e.models.length > 0).length} with a Processing Model`);

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------
// The behaviour → base-CSS mapping lives in behaviour-map.mjs (shared with the
// XSLT, unified, and CETEIcean generators); behaviourBaseCss() turns it into a
// CSS declaration string.

/**
 * Translate a simple XPath predicate into a CSS selector for `ident`, using the
 * shared convention (cli.mjs `teiClass`): a TEI element matches on its
 * `tei-<ident>` class, an attribute on a `data-<attr>` selector — so the rules
 * target the DOM the renderers emit. Returns { selector, comment }; `comment` is
 * set when the predicate is too complex for CSS.
 */
function predicateToCSS(pred, ident) {
  const base = `.${teiClass(ident)}`;
  if (!pred) return { selector: base, comment: null };

  // parent::X
  const parentMatch = pred.match(/^parent::(\w+)$/);
  if (parentMatch) {
    return {
      selector: `.${teiClass(parentMatch[1])} > ${base}`,
      comment: null,
    };
  }

  // ancestor::X
  const ancestorMatch = pred.match(/^ancestor::(\w+)$/);
  if (ancestorMatch) {
    return {
      selector: `.${teiClass(ancestorMatch[1])} ${base}`,
      comment: null,
    };
  }

  // @attr='value'  → element class + data-attribute selector
  const attrMatch = pred.match(/^@(\w+)\s*=\s*'([^']+)'$/);
  if (attrMatch) {
    return {
      selector: `${base}[data-${attrMatch[1]}="${attrMatch[2]}"]`,
      comment: null,
    };
  }

  // @attr (existence)
  const attrExist = pred.match(/^@(\w+)$/);
  if (attrExist) {
    return {
      selector: `${base}[data-${attrExist[1]}]`,
      comment: null,
    };
  }

  // Complex: fall back to base with comment
  return {
    selector: base,
    comment: `/* TODO: Complex predicate not translatable to CSS: ${pred} */`,
  };
}

function generateCSS(elements, renditions = []) {
  const lines = [
    "/* ============================================================ */",
    "/* CSS generated from TEI ODD Processing Model                  */",
    `/* Source: ${basename(oddPath)}                                  */`,
    `/* Generated: ${new Date().toISOString()}                        */`,
    "/* ============================================================ */",
    "",
    "/* Convention: each TEI element is rendered as a semantic HTML tag that  */",
    "/* carries a `tei-<name>` class (e.g. <span class=\"tei-persName\">), and   */",
    "/* TEI attributes are mirrored as data-* (@type -> data-type). The rules  */",
    "/* below layer the Processing-Model styling on top of the tag's own       */",
    "/* display, so no universal display reset is emitted (that would override */",
    "/* the semantic tags the renderer chooses).                              */",
    "",
  ];

  let pmCount = 0;
  let flaggedCount = 0;

  for (const el of elements) {
    if (el.models.length === 0) continue;

    lines.push(`/* --- <${el.ident}> --- */`);

    for (const model of el.models) {
      // Handle modelSequence
      if (model.type === "sequence") {
        if (model.predicate) {
          lines.push(`/* Sequence predicate: ${model.predicate} */`);
        }
        for (const m of model.models || []) {
          emitModelCSS(el.ident, m, lines);
          pmCount++;
        }
        continue;
      }
      // Boot's nested-model extension: compound behaviour with sub-models
      if (model.nested) {
        lines.push(`/* compound (nested-model) behaviour: ${model.behaviour} */`);
        for (const nm of model.nested) {
          emitModelCSS(el.ident, nm, lines);
          pmCount++;
        }
        continue;
      }
      emitModelCSS(el.ident, model, lines);
      pmCount++;
    }
    lines.push("");
  }

  function emitModelCSS(ident, model, lines) {
    const { selector, comment } = predicateToCSS(model.predicate, ident);
    const baseBehaviour = behaviourBaseCss(model.behaviour);
    const needsJS = BEHAVIOURS[model.behaviour]?.requiresJS === true;

    if (comment) lines.push(comment);
    if (needsJS) {
      lines.push(`/* ⚠ behaviour "${model.behaviour}" requires JavaScript enhancement */`);
      flaggedCount++;
    }

    // Collect CSS properties
    const props = [];
    if (baseBehaviour && !baseBehaviour.startsWith("/*")) {
      props.push(baseBehaviour);
    }
    for (const or of model.css) {
      if (!or.scope && or.css) {
        props.push(or.css.trim().replace(/;?\s*$/, ";"));
      }
    }

    if (props.length > 0) {
      lines.push(`${selector} {`);
      for (const p of props) lines.push(`  ${p}`);
      lines.push(`}`);
    }

    // ::before and ::after pseudo-elements
    for (const or of model.css) {
      if (or.scope === "before" && or.css) {
        lines.push(`${selector}::before {`);
        lines.push(`  ${or.css.trim().replace(/;?\s*$/, ";")}`);
        lines.push(`}`);
      }
      if (or.scope === "after" && or.css) {
        lines.push(`${selector}::after {`);
        lines.push(`  ${or.css.trim().replace(/;?\s*$/, ";")}`);
        lines.push(`}`);
      }
    }
  }

  // Source renditions from <tagsDecl>: presentational CSS the editors already
  // maintain in the header, addressed via @rendition. The renderers emit one
  // `r-<id>` class per @rendition token, so these rules style the very DOM the
  // renderers produce. Emitted only when the ODD actually declares renditions,
  // so ODDs without a <tagsDecl> are unaffected.
  const cssRenditions = renditions.filter((r) => r.scheme === "css" && r.css);
  if (cssRenditions.length > 0) {
    lines.push("/* --- Source renditions (from <tagsDecl>, via @rendition) --- */");
    for (const r of cssRenditions) {
      const decl = r.css.replace(/;?\s*$/, ";");
      lines.push(`.r-${r.id} { ${decl} }`);
    }
    lines.push("");
  }

  return {
    css: lines.join("\n"),
    stats: {
      totalRules: pmCount,
      flaggedForJS: flaggedCount,
      renditions: cssRenditions.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const { css, stats } = generateCSS(elements, renditions);
const cssPath = writeOut(outDir, "edition.css", css);
log(`✓ CSS written to ${cssPath} (${stats.totalRules} rules, ${stats.flaggedForJS} flagged for JS)`);
if (stats.renditions > 0) {
  log(`✓ ${stats.renditions} source rendition(s) compiled from <tagsDecl> (.r-* rules)`);
}
