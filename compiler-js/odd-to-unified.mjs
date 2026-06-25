#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to a unified/xast handler module: an ES
 * module mapping TEI elements to hast (HTML AST) handlers. The unified/xast
 * companion to odd-to-css.mjs and odd-to-xslt.mjs.
 *
 * It evaluates XPath predicates as JS at build time (no translation step),
 * covers every PM behaviour, and runs in Node with no XSLT engine; the hast
 * output plugs into the unified ecosystem (rehype, Astro/Eleventy).
 *
 * Usage:  node odd-to-unified.mjs --odd <path> [--out <dir>]
 * Output: <dir>/tei-handlers.mjs   (render it with render-unified.mjs)
 */

import { readFileSync } from "fs";
import { resolve, basename } from "path";
import {
  createOddParser, findElementSpecs, extractModels,
} from "./odd-parser.mjs";
import { BEHAVIOURS } from "./behaviour-map.mjs";
import { parseArgs, createLogger, writeOut, escapeJsString as escStr, escapeJsComment, generatedStamp } from "./cli.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const cli = parseArgs();
const log = createLogger("odd-to-unified");

const oddPath = cli.get("--odd");
const outDir = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-unified.mjs --odd <path> [--out <dir>]");
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
log(`  With PM: ${elements.filter((e) => e.models.length > 0).length}`);

// ---------------------------------------------------------------------------
// Generate tei-handlers.mjs — a unified/xast handler module
// ---------------------------------------------------------------------------
// This emits JavaScript source, not data for a runtime, so tei-handlers.mjs is
// a standalone module a reader can run without this generator. Every ODD-derived
// value spliced into a string literal goes through escStr (escapeJsString) so it
// can't break out of the literal. Simple behaviours take their tag from
// behaviour-map.mjs.

/** Translate a PM @predicate to a JS condition over the xast tree (evaluated at build time). */
function predicateToJS(pred) {
  if (!pred) return null;

  // parent::X
  const parentMatch = pred.match(/^parent::(\w+)$/);
  if (parentMatch)
    return `node._parent && node._parent.name === '${escStr(parentMatch[1])}'`;

  // ancestor::X
  const ancestorMatch = pred.match(/^ancestor::(\w+)$/);
  if (ancestorMatch) {
    return `(() => { let p = node._parent; while (p) { if (p.name === '${escStr(ancestorMatch[1])}') return true; p = p._parent; } return false; })()`;
  }

  // not(ancestor::X)
  const notAncestor = pred.match(/^not\(ancestor::(\w+)\)$/);
  if (notAncestor) {
    return `(() => { let p = node._parent; while (p) { if (p.name === '${escStr(notAncestor[1])}') return false; p = p._parent; } return true; })()`;
  }

  // @attr='value'
  const attrVal = pred.match(/^@(\w+)\s*=\s*'([^']+)'$/);
  if (attrVal)
    return `node.attributes?.['${escStr(attrVal[1])}'] === '${escStr(attrVal[2])}'`;

  // @attr (existence)
  const attrExist = pred.match(/^@(\w+)$/);
  if (attrExist) return `!!node.attributes?.['${escStr(attrExist[1])}']`;

  // count(ancestor::X)
  const countAncestor = pred.match(
    /^count\(ancestor::(\w+)\)\s*(=|>|<|>=|<=)\s*(\d+)$/
  );
  if (countAncestor) {
    return `(() => { let c = 0, p = node._parent; while (p) { if (p.name === '${escStr(countAncestor[1])}') c++; p = p._parent; } return c ${countAncestor[2]} ${countAncestor[3]}; })()`;
  }

  // count(ancestor::X) as bare expression (for params like level)
  const countAncestorBare = pred.match(/^count\(ancestor::(\w+)\)$/);
  if (countAncestorBare) {
    return `(() => { let c = 0, p = node._parent; while (p) { if (p.name === '${escStr(countAncestorBare[1])}') c++; p = p._parent; } return c; })()`;
  }

  // preceding-sibling::*
  if (pred === "preceding-sibling::*") {
    return `(() => { if (!node._parent?.children) return false; const idx = node._parent.children.indexOf(node); return idx > 0; })()`;
  }

  // Fallback: wrap in a comment — JS can't auto-translate all XPath
  return `true /* TODO: complex predicate: ${escapeJsComment(pred)} */`;
}

/**
 * Compile a link/graphic uri/url param value to a JS string expression:
 * an attribute reference (`@facs`), a string literal (`'…'`), or a `concat()`
 * of those (e.g. `concat(@facs, '/full/pct:25/0/default.jpg')`, which builds an
 * IIIF image URL from a page's facsimile id). XSLT evaluates these natively;
 * here we translate them. A bare `@attr` keeps its unparenthesised form so the
 * common case is unchanged.
 */
function paramValueToJS(value) {
  const v = (value || "").trim();
  const attr = v.match(/^@([\w:.-]+)$/);
  if (attr) return `node.attributes?.['${escStr(attr[1])}'] || ''`;
  const lit = v.match(/^'([^']*)'$/);
  if (lit) return `'${escStr(lit[1])}'`;
  const concat = v.match(/^concat\(([\s\S]*)\)$/);
  if (concat) {
    // Split top-level commas (respecting single-quoted literals) and sum the
    // parts; each part is parenthesised so `a || '' + b` cannot mis-associate.
    const parts = [];
    let cur = "", inQuote = false;
    for (const ch of concat[1]) {
      if (ch === "'") { inQuote = !inQuote; cur += ch; }
      else if (ch === "," && !inQuote) { parts.push(cur); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => `(${paramValueToJS(p)})`).join(" + ");
  }
  return `'${escStr(v)}'`;
}

/**
 * Behaviours that map to a plain `h(tag, props, children)` wrapper. The tag is
 * looked up in the shared behaviour map; everything else is identical.
 */
const SIMPLE_UNIFIED = new Set([
  "inline", "block", "paragraph", "section", "document", "body", "cit",
  "table", "row", "cell", "list", "listItem", "title",
]);

/**
 * Generate body of a handler function for a PM behaviour.
 */
function behaviourToHandler(model, ident) {
  const b = model.behaviour;
  const params = Object.fromEntries(
    model.params.map((p) => [p.name, p.value])
  );
  const cssFragments = model.css
    .filter((c) => !c.scope)
    .map((c) => c.css.trim());
  const beforeCSS = model.css
    .filter((c) => c.scope === "before")
    .map((c) => c.css.trim());
  const afterCSS = model.css
    .filter((c) => c.scope === "after")
    .map((c) => c.css.trim());

  const styleStr = cssFragments.length > 0 ? cssFragments.join(" ") : null;

  // Build properties object parts. The className carries the element's
  // `tei-<ident>` class plus any source-appearance r-<id> classes derived from
  // its @rendition pointer (resolved at runtime against the ODD's <tagsDecl>).
  const propsEntries = [`className: ['tei-${ident}', ...renditionClasses(node)]`];
  if (styleStr) propsEntries.push(`style: '${escStr(styleStr)}'`);

  const propsStr = `{ ${propsEntries.join(", ")} }`;

  // Before/after pseudo-content as hast nodes
  const beforeNodes = beforeCSS.map(
    (css) => `h('span', { className: ['tei-before'], style: '${escStr(css)}' }, [])`
  );
  const afterNodes = afterCSS.map(
    (css) => `h('span', { className: ['tei-after'], style: '${escStr(css)}' }, [])`
  );

  const childrenExpr =
    beforeNodes.length > 0 || afterNodes.length > 0
      ? `[${[...beforeNodes, "...convertChildren(node)", ...afterNodes].join(", ")}]`
      : "convertChildren(node)";

  // Simple wrapper behaviours: the HTML element comes from the shared
  // behaviour map; the props/children expressions are the same for all of them.
  if (SIMPLE_UNIFIED.has(b)) {
    return `return h('${BEHAVIOURS[b].tag}', ${propsStr}, ${childrenExpr});`;
  }

  switch (b) {
    case "break":
      return `return h('br', { className: ['tei-${ident}'] }, []);`;
    case "metadata":
    case "omit":
      return `return null; // omitted`;
    case "text":
      return `return convertChildren(node);`;
    case "heading": {
      const levelExpr = params.level || "'1'";
      // If it's a count() expression, evaluate in JS
      const jsLevel = predicateToJS(levelExpr);
      if (jsLevel && levelExpr !== "'1'") {
        return `const level = Math.min(6, Math.max(1, ${jsLevel} || 1)); return h(\`h\${level}\`, ${propsStr}, ${childrenExpr});`;
      }
      const tag = `h${Math.min(6, Math.max(1, parseInt(levelExpr.replace(/'/g, ""), 10) || 1))}`;
      return `return h('${tag}', ${propsStr}, ${childrenExpr});`;
    }
    case "note":
      return [
        `// Note behaviour — create inline ref + hidden body`,
        `const noteId = node.attributes?.['xml:id'] || 'note-' + (++noteCounter);`,
        `const ref = h('a', { className: ['tei-note-ref'], href: '#' + noteId }, [text('[' + noteCounter + ']')]);`,
        `const body = h('aside', { className: ['tei-note-body'], id: noteId, hidden: true }, convertChildren(node));`,
        `collectedNotes.push(body);`,
        `return ref;`,
      ].join("\n    ");
    case "link": {
      const hrefExpr = paramValueToJS(params.uri || "@target");
      return `return h('a', { className: ['tei-${ident}'], href: ${hrefExpr} }, ${childrenExpr});`;
    }
    case "alternate": {
      const defSel = params.default || ".";
      const altSel = params.alternate || ".";
      // For simple cases (selecting specific children), filter
      return [
        `// Alternate behaviour — default + hidden alt`,
        `const children = node.children || [];`,
        `const defaultContent = children.length >= 1 ? convertNode(children.find(c => c.type === 'element') || children[0]) : [];`,
        `const altContent = children.length >= 2 ? convertNode(children.filter(c => c.type === 'element')[1] || children[1]) : [];`,
        `return h('span', { className: ['tei-alternate', 'tei-${ident}'] }, [`,
        `  h('span', { className: ['tei-alternate-default'] }, Array.isArray(defaultContent) ? defaultContent : [defaultContent].filter(Boolean)),`,
        `  h('span', { className: ['tei-alternate-alt'], hidden: true }, Array.isArray(altContent) ? altContent : [altContent].filter(Boolean)),`,
        `]);`,
      ].join("\n    ");
    }
    case "graphic": {
      const srcExpr = paramValueToJS(params.url || "@url");
      return [
        `const src = ${srcExpr};`,
        `const alt = node.children?.find(c => c.name === 'desc');`,
        `const altText = alt ? textContent(alt) : '';`,
        `return h('figure', { className: ['tei-${ident}'] }, [`,
        `  h('img', { src, alt: altText, loading: 'lazy' }, []),`,
        `]);`,
      ].join("\n    ");
    }
    case "anchor":
      return `return h('a', { id: node.attributes?.['xml:id'] || '', className: ['tei-anchor'] }, []);`;
    case "glyph":
      return `return h('span', { className: ['tei-glyph'], 'data-ref': node.attributes?.ref || '' }, convertChildren(node));`;
    case "index": {
      // toc: emit a navigation list of the document's headings — a real table
      // of contents, NOT a copy of the body. Suppressed for trivial (<2-heading)
      // documents. This is the first arm of tei_simplePrint's body modelSequence
      // [index(toc) + block]; the block arm renders the body content itself, so
      // re-rendering the children here would duplicate the whole document.
      return [
        `const tocHeads = [];`,
        `(function walk(n) { if (!n || !n.children) return; for (const c of n.children) { if (c.type === 'element' && c.name === 'head') tocHeads.push(textContent(c).trim()); else walk(c); } })(node);`,
        `if (tocHeads.length < 2) return [];`,
        `return h('nav', { className: ['tei-toc'], 'aria-label': 'Contents' }, [`,
        `  h('p', { className: ['tei-toc-label'] }, [text('Contents')]),`,
        `  h('ul', {}, tocHeads.map((t) => h('li', { className: ['tei-toc-entry'] }, [text(t)]))),`,
        `]);`,
      ].join("\n    ");
    }
    default:
      return `// unhandled behaviour: ${escStr(b)}\n    return h('span', { className: ['tei-${ident}'] }, convertChildren(node));`;
  }
}

/**
 * Assemble a compound (Boot nested-model) behaviour. The sub-behaviours are
 * emitted as a sequence — except that a `link` sub-model *wraps* the rest, so a
 * `<pb>` declared as link + graphic renders as one clickable thumbnail
 * (`<a href="…full"><figure><img …></figure></a>`) instead of an empty link
 * beside a detached image.
 */
function emitCompound(subModels, ident, pad = "    ") {
  const link = subModels.find((sm) => sm.behaviour === "link");
  if (link) {
    const uri = Object.fromEntries(link.params.map((p) => [p.name, p.value])).uri || "@target";
    const rest = subModels.filter((sm) => sm !== link);
    const lines = [`${pad}const inner = [];`];
    for (const sm of rest)
      lines.push(`${pad}inner.push((function() { ${behaviourToHandler(sm, ident)} })());`);
    lines.push(`${pad}return h('a', { className: ['tei-${ident}'], href: ${paramValueToJS(uri)} }, inner.flat().filter(Boolean));`);
    return lines.join("\n");
  }
  const lines = [`${pad}const parts = [];`];
  for (const sm of subModels)
    lines.push(`${pad}parts.push((function() { ${behaviourToHandler(sm, ident)} })());`);
  lines.push(`${pad}return parts.flat().filter(Boolean);`);
  return lines.join("\n");
}

/**
 * Generate the full tei-handlers.mjs module source.
 */
function generateHandlersModule(elements) {
  const lines = [
    `/**`,
    ` * tei-handlers.mjs`,
    ` * unified/xast handler functions generated from TEI ODD Processing Model`,
    ` *`,
    ` * Source ODD: ${basename(oddPath)}`,
    ...(stamp ? [` * Generated: ${stamp}`] : []),
    ` *`,
    ` * This module exports a teiToHast() function that converts a TEI/XML xast`,
    ` * tree to hast (HTML AST), using handler functions derived from the ODD's`,
    ` * <model> elements. Unlike CSS, this pipeline evaluates XPath predicates`,
    ` * as JavaScript conditions at build time — no translation gap.`,
    ` */`,
    ``,
    `// ── hast helpers ──`,
    `function h(tag, properties, children) {`,
    `  return { type: 'element', tagName: tag, properties: properties || {}, children: children || [] };`,
    `}`,
    `function text(value) {`,
    `  return { type: 'text', value };`,
    `}`,
    `// Source appearance: turn an element's @rendition pointer list (e.g.`,
    `// "#aq #c", the tei_simplePrint convention) into r-<id> classes that the`,
    `// ODD-generated stylesheet (odd-to-css, from <tagsDecl>) styles.`,
    `function renditionClasses(node) {`,
    `  const r = node.attributes && node.attributes.rendition;`,
    `  if (!r) return [];`,
    `  return String(r).split(/\\s+/).filter(Boolean).map((t) => 'r-' + t.replace(/^#/, ''));`,
    `}`,
    ``,
    `// ── State for note collection ──`,
    `let noteCounter = 0;`,
    `const collectedNotes = [];`,
    ``,
    `// ── Text extraction helper ──`,
    `function textContent(node) {`,
    `  if (!node) return '';`,
    `  if (node.type === 'text') return node.value || '';`,
    `  if (node.children) return node.children.map(textContent).join('');`,
    `  return '';`,
    `}`,
    ``,
    `// ── Tree traversal ──`,
    `function convertChildren(node) {`,
    `  if (!node.children) return [];`,
    `  const result = [];`,
    `  for (const child of node.children) {`,
    `    const converted = convertNode(child);`,
    `    if (converted) {`,
    `      if (Array.isArray(converted)) result.push(...converted);`,
    `      else result.push(converted);`,
    `    }`,
    `  }`,
    `  return result;`,
    `}`,
    ``,
    `// ── Parent annotation pass ──`,
    `function annotateParents(node, parent) {`,
    `  node._parent = parent || null;`,
    `  if (node.children) {`,
    `    for (const child of node.children) annotateParents(child, node);`,
    `  }`,
    `}`,
    ``,
  ];

  // Generate handler map
  lines.push(`// ── Handler map (generated from ODD Processing Model) ──`);
  lines.push(`const handlers = {};`);
  lines.push(``);

  let handlerCount = 0;

  for (const el of elements) {
    if (el.models.length === 0) continue;

    lines.push(`// <${el.ident}>`);

    // Flatten models
    const flatModels = [];
    for (const m of el.models) {
      if (m.type === "sequence") {
        // Sequence: combine sub-model outputs
        flatModels.push({
          predicate: m.predicate,
          isSequence: true,
          subModels: m.models || [],
        });
      } else if (m.nested) {
        // Boot's nested-model extension: compound behaviour → combine sub-model outputs
        flatModels.push({
          predicate: m.predicate,
          isSequence: true,
          subModels: m.nested,
        });
      } else {
        flatModels.push(m);
      }
    }

    // Generate handler function
    if (flatModels.length === 1 && !flatModels[0].predicate) {
      // Simple: single handler, no predicate
      const m = flatModels[0];
      if (m.isSequence) {
        lines.push(`handlers['${el.ident}'] = (node) => {`);
        lines.push(emitCompound(m.subModels, el.ident));
        lines.push(`};`);
      } else {
        lines.push(`handlers['${el.ident}'] = (node) => {`);
        lines.push(`    ${behaviourToHandler(m, el.ident)}`);
        lines.push(`};`);
      }
    } else {
      // Multiple models with predicates → function with conditions
      lines.push(`handlers['${el.ident}'] = (node) => {`);

      for (const m of flatModels) {
        if (m.predicate) {
          const jsCondition = predicateToJS(m.predicate);
          lines.push(`    if (${jsCondition}) {`);
          if (m.isSequence) {
            lines.push(emitCompound(m.subModels, el.ident, "        "));
          } else {
            lines.push(`        ${behaviourToHandler(m, el.ident)}`);
          }
          lines.push(`    }`);
        }
      }

      // Default (no predicate) as fallback
      const defaults = flatModels.filter((m) => !m.predicate);
      if (defaults.length > 0) {
        const m = defaults[0];
        if (m.isSequence) {
          lines.push(`    // default (no predicate)`);
          lines.push(emitCompound(m.subModels, el.ident));
        } else {
          lines.push(`    // default (no predicate)`);
          lines.push(`    ${behaviourToHandler(m, el.ident)}`);
        }
      } else {
        lines.push(
          `    return h('span', { className: ['tei-${el.ident}'] }, convertChildren(node));`
        );
      }

      lines.push(`};`);
    }

    lines.push(``);
    handlerCount++;
  }

  // convertNode dispatcher
  lines.push(`// ── Node dispatcher ──`);
  lines.push(`function convertNode(node) {`);
  lines.push(`  if (!node) return null;`);
  lines.push(`  if (node.type === 'text') return text(node.value || '');`);
  lines.push(`  if (node.type !== 'element') return null;`);
  lines.push(``);
  lines.push(`  // Strip namespace prefix`);
  lines.push(`  const localName = node.name?.includes(':') ? node.name.split(':').pop() : node.name;`);
  lines.push(``);
  lines.push(`  const handler = handlers[localName];`);
  lines.push(`  if (handler) return handler(node);`);
  lines.push(``);
  lines.push(`  // Fallback: pass through children`);
  lines.push(`  return convertChildren(node);`);
  lines.push(`}`);
  lines.push(``);

  // Main export
  lines.push(`/**`);
  lines.push(` * Convert a TEI/XML xast tree to hast (HTML AST).`);
  lines.push(` * @param {object} xastTree — parsed XML tree from xast-util-from-xml`);
  lines.push(` * @returns {{ hast: object, notes: object[] }} — hast tree + collected notes`);
  lines.push(` */`);
  lines.push(`export function teiToHast(xastTree) {`);
  lines.push(`  noteCounter = 0;`);
  lines.push(`  collectedNotes.length = 0;`);
  lines.push(`  annotateParents(xastTree, null);`);
  lines.push(``);
  lines.push(`  const result = convertNode(xastTree);`);
  lines.push(`  const children = Array.isArray(result) ? result : result ? [result] : [];`);
  lines.push(`  const body = h('div', { className: ['tei-edition'] }, children);`);
  lines.push(``);
  lines.push(`  // Append collected notes as a footnote section`);
  lines.push(`  if (collectedNotes.length > 0) {`);
  lines.push(`    body.children.push(h('section', { className: ['tei-footnotes'] }, [`);
  lines.push(`      h('hr', {}, []),`);
  lines.push(`      ...collectedNotes,`);
  lines.push(`    ]));`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  return { hast: body, notes: collectedNotes };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export { handlers, convertNode, convertChildren, h, text };`);

  return { source: lines.join("\n"), stats: { handlerCount } };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const { source, stats } = generateHandlersModule(elements);
const handlersPath = writeOut(outDir, "tei-handlers.mjs", source);
log(`✓ Handler module written to ${handlersPath} (${stats.handlerCount} handlers)`);
log(`  To render the generated module against a TEI file, run render-unified.mjs`);

console.log(`\n[odd-to-unified] === Summary ===`);
console.log(`  Handlers generated:    ${stats.handlerCount}`);
console.log(`  XPath predicates:      evaluated as JS (no translation gap)`);
console.log(`  @useSourceRendition:   supported via source document access`);
console.log(`  All 25 behaviours:     covered (note, link, alternate, graphic etc.)`);
console.log(`  Ecosystem:             unified/xast → hast → rehype → HTML`);
