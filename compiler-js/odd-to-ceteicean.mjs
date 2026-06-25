#!/usr/bin/env node

/**
 * Compile a TEI ODD Processing Model to CETEIcean behaviours plus a
 * self-contained HTML page that renders the TEI in the browser.
 *
 * CETEIcean (https://github.com/TEIC/CETEIcean) registers TEI elements as
 * `tei-` custom elements and applies "behaviours" — functions that reshape each
 * element's DOM. PM predicates that map to CSS attribute selectors become
 * CETEIcean predicate arrays; tree-context predicates (parent::, ancestor::) are
 * evaluated in JS inside the behaviour.
 *
 * Usage:   node odd-to-ceteicean.mjs --odd <path> --tei <path> [--out <dir>]
 * Outputs: <dir>/tei-ceteicean-behaviours.js, <dir>/rendered-ceteicean.html
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
const log = createLogger("odd-to-ceteicean");

const oddPath = cli.get("--odd");
const teiPath = cli.get("--tei") || "../examples/simler-poem.xml";
const outDir  = cli.get("--out") || "output";
const stamp = generatedStamp(cli);

if (!oddPath) {
  console.error("Usage: node odd-to-ceteicean.mjs --odd <path> --tei <path> [--out <dir>]");
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
// Predicate translation: XPath → CETEIcean CSS selector (where possible)
// ---------------------------------------------------------------------------
// Like odd-to-unified, this emits JavaScript (CETEIcean behaviour bodies) so the
// resulting file runs directly in the browser; ODD-derived values go through
// escStr (escapeJsString). Display-only behaviours take their value from
// behaviour-map.mjs.

/**
 * Try to convert an XPath predicate to a CETEIcean-compatible CSS selector.
 * Returns { type: 'css', selector } or { type: 'js', code }.
 */
function predicateToCETEI(pred) {
  if (!pred) return null;

  // @attr='value' → [attr='value']
  const attrValMatch = pred.match(/^@(\w+)\s*=\s*'([^']+)'$/);
  if (attrValMatch) {
    return { type: "css", selector: `[${attrValMatch[1]}='${attrValMatch[2]}']` };
  }

  // @attr → [attr]
  const attrMatch = pred.match(/^@(\w+)$/);
  if (attrMatch) {
    return { type: "css", selector: `[${attrMatch[1]}]` };
  }

  // parent::X → JavaScript check
  const parentMatch = pred.match(/^parent::(\w+)$/);
  if (parentMatch) {
    return {
      type: "js",
      code: `el.parentElement && el.parentElement.localName === 'tei-${parentMatch[1]}'`,
    };
  }

  // ancestor::X → JavaScript check
  const ancestorMatch = pred.match(/^ancestor::(\w+)$/);
  if (ancestorMatch) {
    return {
      type: "js",
      code: `el.closest('tei-${ancestorMatch[1]}') !== null`,
    };
  }

  // Fallback: JavaScript with comment
  return { type: "js", code: `true /* TODO: ${escapeJsComment(pred)} */` };
}

// ---------------------------------------------------------------------------
// Map PM behaviours → CETEIcean behaviour function bodies
// ---------------------------------------------------------------------------

function cssPropStr(model) {
  const main = model.css.filter(c => !c.scope).map(c => c.css.trim());
  return main.join(" ").replace(/;?\s*$/, "");
}

/**
 * Behaviours whose CETEIcean handling is just "set this CSS display value".
 * The display value comes from the shared behaviour map. (`document` keeps its
 * own case below because the CSS path deliberately emits no display rule for
 * it, so it carries no `display` in the table.)
 */
const CETEI_DISPLAY = new Set([
  "block", "paragraph", "section", "body", "break", "cit", "table", "row", "cell",
]);

/**
 * Generate a CETEIcean behaviour function body for a PM model.
 * Returns a string of JavaScript code to execute inside function(el) { ... }.
 *
 * CETEIcean behaviours receive the custom element (e.g. <tei-head>) as `el`.
 * The original TEI content is in el.innerHTML.  Behaviours can reshape it.
 */
function behaviourToCode(model, ident) {
  const b = model.behaviour;
  const params = Object.fromEntries(model.params.map(p => [p.name, p.value]));
  const css = cssPropStr(model);
  const beforeCss = model.css.filter(c => c.scope === "before").map(c => c.css.trim()).join(" ");
  const afterCss  = model.css.filter(c => c.scope === "after").map(c => c.css.trim()).join(" ");

  // Append (not assign) so styles set earlier survive: CETEIcean runs a parent's
  // behaviour before its children, so e.g. the <choice> behaviour hides the
  // alternate reading (display:none) before the child <corr>'s inline behaviour
  // runs — assigning cssText here would wipe that hide and show both on load.
  const styleSet = css ? `\n      el.style.cssText += '${escStr(css)}';` : "";

  // Display-only behaviours: the CSS display value comes from the shared map.
  if (CETEI_DISPLAY.has(b)) {
    return `      el.style.display = '${BEHAVIOURS[b].display}';${styleSet}`;
  }

  switch (b) {
    case "inline":
      return `      // inline behaviour${styleSet}
      // Content stays as-is in the custom element`;

    case "heading": {
      const level = params.level || "'1'";
      if (level === "count(ancestor::div)") {
        return `      // heading: level = number of ancestor tei-div elements
      var level = 0;
      var p = el.parentElement;
      while (p) { if (p.localName === 'tei-div') level++; p = p.parentElement; }
      level = Math.min(6, Math.max(1, level));
      var h = document.createElement('h' + level);
      h.innerHTML = el.innerHTML;
      h.style.cssText = '${escStr(css)}';
      el.innerHTML = '';
      el.appendChild(h);`;
      }
      const lv = Math.min(6, Math.max(1, parseInt(level.replace(/'/g, ""), 10) || 1));
      return `      var h = document.createElement('h${lv}');
      h.innerHTML = el.innerHTML;
      h.style.cssText = '${escStr(css)}';
      el.innerHTML = '';
      el.appendChild(h);`;
    }

    case "document":
      return `      el.style.display = 'block';${styleSet}`;

    case "metadata":
    case "omit":
      return `      el.style.display = 'none'; // metadata/omit`;

    case "note": {
      const place = params.place || "'foot'";
      return `      // note behaviour: inline superscript marker + collapsible body
      var idx = ++window.__teiNoteCounter;
      var noteId = 'note-' + idx;
      var content = el.innerHTML;
      el.innerHTML = '<a class="tei-note-ref" href="#' + noteId + '" role="doc-noteref">' +
        '<sup>' + idx + '</sup></a>' +
        '<span class="tei-note-body" id="' + noteId + '" role="doc-footnote" style="display:none">' +
        content + '</span>';
      el.querySelector('.tei-note-ref').addEventListener('click', function(e) {
        e.preventDefault();
        var body = el.querySelector('.tei-note-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });`;
    }

    case "link": {
      const uri = params.uri || "@target";
      const attrName = uri.startsWith("@") ? uri.slice(1) : "target";
      return `      // link behaviour
      var href = el.getAttribute('${escStr(attrName)}') || '';
      var a = document.createElement('a');
      a.href = href;
      a.innerHTML = el.innerHTML;
      a.className = 'tei-link';
      if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      el.innerHTML = '';
      el.appendChild(a);${styleSet}`;
    }

    case "alternate": {
      return `      // alternate behaviour: toggle between default and alt readings
      var children = Array.from(el.children);
      if (children.length >= 2) {
        var def = children[0];
        var alt = children[1];
        alt.style.display = 'none';
        el.style.cursor = 'pointer';
        el.style.borderBottom = '1px dotted #999';
        el.setAttribute('role', 'switch');
        el.setAttribute('aria-checked', 'false');
        el.setAttribute('tabindex', '0');
        el.title = 'Click to toggle between readings';
        var toggle = function() {
          var showDef = def.style.display !== 'none';
          def.style.display = showDef ? 'none' : '';
          alt.style.display = showDef ? '' : 'none';
          el.setAttribute('aria-checked', String(showDef));
        };
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }`;
    }

    case "graphic": {
      const url = params.url || "@url";
      const attrName = url.startsWith("@") ? url.slice(1) : "url";
      return `      // graphic behaviour
      var src = el.getAttribute('${escStr(attrName)}') || '';
      var img = document.createElement('img');
      img.src = src;
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      var desc = el.querySelector('tei-desc');
      if (desc) { img.alt = desc.textContent; }
      el.innerHTML = '';
      el.appendChild(img);`;
    }

    case "list":
      return `      // list → ul
      var ul = document.createElement('ul');
      ul.innerHTML = el.innerHTML;
      ul.style.cssText = '${escStr(css)}';
      el.innerHTML = '';
      el.appendChild(ul);`;

    case "listItem":
      return `      // listItem → li
      var li = document.createElement('li');
      li.innerHTML = el.innerHTML;
      li.style.cssText = '${escStr(css)}';
      el.innerHTML = '';
      el.appendChild(li);`;

    case "anchor":
      return `      el.id = el.getAttribute('xml:id') || '';`;

    case "glyph":
      return `      el.classList.add('tei-glyph-unresolved');
      el.title = 'Glyph: ' + (el.getAttribute('ref') || '');`;

    case "index":
      return `      el.classList.add('tei-index-entry');`;

    case "text":
      return `      // pass through`;

    case "title":
      return `      ${styleSet}`;

    default:
      return `      // unhandled behaviour: ${escStr(b)}${styleSet}`;
  }
}

// ---------------------------------------------------------------------------
// Generate CETEIcean behaviour map
// ---------------------------------------------------------------------------

function generateBehaviours(elements) {
  const lines = [
    `/**`,
    ` * tei-ceteicean-behaviours.js`,
    ` * CETEIcean behaviour definitions generated from TEI ODD Processing Model`,
    ` *`,
    ` * Source ODD: ${basename(oddPath)}`,
    ...(stamp ? [` * Generated: ${stamp}`] : []),
    ` *`,
    ` * CETEIcean (https://github.com/TEIC/CETEIcean) renders TEI XML in the browser`,
    ` * by registering custom elements (tei-head, tei-p, etc.) and applying`,
    ` * behaviours — functions that reshape each element's DOM.`,
    ` *`,
    ` * This module maps ODD Processing Model declarations to CETEIcean behaviours:`,
    ` *   - PM @predicate → CSS attribute selectors (where possible) or JS conditions`,
    ` *   - PM behaviour  → DOM manipulation functions`,
    ` *   - PM outputRendition → inline styles`,
    ` */`,
    ``,
    `// Global note counter (reset when behaviours are applied)`,
    `window.__teiNoteCounter = 0;`,
    ``,
    `const defined = {`,
    `  "tei": {`,
  ];

  let behaviourCount = 0;

  for (const el of elements) {
    if (el.models.length === 0) continue;

    // Flatten models (expand sequences and nested compounds)
    const flatModels = [];
    for (const m of el.models) {
      if (m.type === "sequence") {
        for (const sm of m.models || []) flatModels.push(sm);
      } else if (m.nested) {
        // Boot's nested-model extension: expand compound sub-models
        for (const nm of m.nested) flatModels.push({ ...nm, __compoundPredicate: m.predicate });
      } else {
        flatModels.push(m);
      }
    }

    if (flatModels.length === 0) continue;

    lines.push(`    // <${el.ident}>`);

    if (flatModels.length === 1 && !flatModels[0].predicate) {
      // Single model, no predicate → simple function
      const m = flatModels[0];
      lines.push(`    "${el.ident}": function(el) {`);
      lines.push(behaviourToCode(m, el.ident));
      lines.push(`    },`);
    } else {
      // Multiple models or predicates → array of [selector, handler] or function with conditions
      const hasCSSPredicates = flatModels.some(m => {
        if (!m.predicate) return false;
        const t = predicateToCETEI(m.predicate);
        return t && t.type === "css";
      });
      const hasJSPredicates = flatModels.some(m => {
        if (!m.predicate) return false;
        const t = predicateToCETEI(m.predicate);
        return t && t.type === "js";
      });

      if (!hasJSPredicates && hasCSSPredicates) {
        // All predicates are CSS selectors → use CETEIcean's array format
        lines.push(`    "${el.ident}": [`);
        for (const m of flatModels) {
          if (m.predicate) {
            const pred = predicateToCETEI(m.predicate);
            lines.push(`      ["${escStr(pred.selector)}", function(el) {`);
            lines.push(behaviourToCode(m, el.ident));
            lines.push(`      }],`);
          }
        }
        // Default (no predicate)
        const defaults = flatModels.filter(m => !m.predicate);
        if (defaults.length > 0) {
          lines.push(`      function(el) {`);
          lines.push(behaviourToCode(defaults[0], el.ident));
          lines.push(`      }`);
        }
        lines.push(`    ],`);
      } else {
        // Mixed or JS-only predicates → single function with if-conditions
        lines.push(`    "${el.ident}": function(el) {`);
        for (const m of flatModels) {
          if (m.predicate) {
            const pred = predicateToCETEI(m.predicate);
            const condition = pred.type === "css"
              ? `el.matches('${escStr(pred.selector)}')`
              : pred.code;
            lines.push(`      if (${condition}) {`);
            lines.push(`  ${behaviourToCode(m, el.ident)}`);
            lines.push(`        return;`);
            lines.push(`      }`);
          }
        }
        // Default
        const defaults = flatModels.filter(m => !m.predicate);
        if (defaults.length > 0) {
          lines.push(`      // default (no predicate)`);
          lines.push(behaviourToCode(defaults[0], el.ident));
        }
        lines.push(`    },`);
      }
    }

    lines.push(``);
    behaviourCount++;
  }

  lines.push(`  }`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`// Export for use in HTML page`);
  lines.push(`if (typeof module !== 'undefined') module.exports = defined;`);
  lines.push(`if (typeof window !== 'undefined') window.defined = defined;`);

  return { source: lines.join("\n"), stats: { behaviourCount } };
}

const { source: behavioursSource, stats } = generateBehaviours(elements);

// ---------------------------------------------------------------------------
// Generate rendered-ceteicean.html
// ---------------------------------------------------------------------------

let teiXml = "";
try {
  teiXml = readFileSync(resolve(teiPath), "utf-8");
} catch {
  log(`⚠ TEI file not found: ${teiPath}`);
}

const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CETEIcean Rendering — TEI Edition</title>
  <style>
    body {
      font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
      max-width: 42em; margin: 2em auto; padding: 0 1em;
      background: #fefefe; color: #222; line-height: 1.7;
    }
    .render-info {
      font-family: system-ui, sans-serif;
      background: #fce7f3; border: 1px solid #f9a8d4;
      padding: 1em; border-radius: 6px; margin-bottom: 2em;
      font-size: 0.85em;
    }
    .render-info h3 { margin: 0 0 0.5em; color: #db2777; }
    .render-info code { background: #fdf2f8; padding: 0.1em 0.3em; border-radius: 3px; }

    /* Base styles for CETEIcean custom elements */
    tei-teiheader { display: none; }
    tei-text, tei-body { display: block; }
    tei-div { display: block; margin-bottom: 1.5em; }
    tei-p { display: block; text-indent: 1em; margin: 0.3em 0; }
    tei-persname { color: #8e44ad; }
    tei-placename { color: #27ae60; }
    tei-lb { display: block; }
    tei-pb { display: block; border-top: 1px dashed #ccc; margin: 1em 0; padding-top: 0.3em; }
    tei-pb::before { content: "[p. " attr(n) "]"; color: #999; font-size: 0.8em; }
    tei-note { display: inline; }
    tei-note .tei-note-ref { color: #2563eb; text-decoration: none; cursor: pointer; }
    tei-note .tei-note-ref sup { font-size: 0.75em; }
    tei-note .tei-note-body {
      display: block; background: #fffde7; border: 1px solid #e0e0e0;
      padding: 0.5em 0.75em; margin: 0.25em 0; font-size: 0.9em; border-radius: 4px;
    }
    tei-choice { border-bottom: 1px dotted #999; cursor: pointer; }
    tei-quote {
      display: block; margin: 1em 2em; font-style: italic;
      border-left: 3px solid #bdc3c7; padding-left: 1em;
    }
    tei-list { display: block; margin-left: 1.5em; }
    tei-item { display: list-item; margin-bottom: 0.2em; }
    tei-ref { color: #2980b9; text-decoration: underline; cursor: pointer; }
    tei-abbr { color: #e67e22; }
    tei-sic { color: #c0392b; text-decoration: wavy underline; }
    tei-rs[type="person"] { color: #8e44ad; }
    tei-rs[type="place"] { color: #27ae60; }
    tei-rs[type="org"] { color: #2980b9; }
    tei-rs[type="bibl"] { font-style: italic; }
    tei-hi[rend="bold"] { font-weight: bold; }
    tei-hi[rend="italic"] { font-style: italic; }
    tei-hi[rend="sup"] { vertical-align: super; font-size: 0.8em; }
    tei-q::before { content: "\\201C"; }
    tei-q::after { content: "\\201D"; }
  </style>
</head>
<body>

  <div class="render-info">
    <h3>CETEIcean Rendering Path</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-ceteicean.mjs</code> →
      behaviours.js → CETEIcean (browser) → HTML</p>
    <p>CETEIcean registers TEI elements as custom elements with <code>tei-</code>
      prefix, then applies ODD-derived behaviours to reshape the DOM at runtime.
      CSS attribute selectors handle PM predicates where possible; JavaScript
      conditions handle tree-context predicates (parent::, ancestor::).</p>
    <p>Click notes to expand; click abbreviations/corrections to toggle readings.</p>
  </div>

  <div id="TEI"></div>

  <!-- CETEIcean library -->
  <script src="https://github.com/TEIC/CETEIcean/releases/download/v1.9.5/CETEI.js"></script>

  <!-- Generated behaviour definitions (from ODD Processing Model) -->
  <script>
${behavioursSource}
  </script>

  <script>
    // Initialize CETEIcean with ODD-derived behaviours
    var ct = new CETEI();
    ct.addBehaviors(defined);

    // Load inline TEI or fetch from file
    var teiContent = ${JSON.stringify(teiXml)};

    if (teiContent) {
      // Parse the inline TEI string
      var dp = new DOMParser();
      var doc = dp.parseFromString(teiContent, 'application/xml');
      ct.domToHTML5(doc, function(data) {
        document.getElementById('TEI').appendChild(data);
      });
    } else {
      // Fetch from file
      ct.getHTML5('simler-poem.xml', function(data) {
        document.getElementById('TEI').appendChild(data);
      });
    }
  </script>

</body>
</html>`;

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------
const behavioursPath = writeOut(outDir, "tei-ceteicean-behaviours.js", behavioursSource);
log(`✓ Behaviours written to ${behavioursPath} (${stats.behaviourCount} elements)`);

const htmlPath = writeOut(outDir, "rendered-ceteicean.html", pageHtml);
log(`✓ HTML page written to ${htmlPath}`);

console.log(`\n[odd-to-ceteicean] === Summary ===`);
console.log(`  Elements with behaviours: ${stats.behaviourCount}`);
console.log(`  CETEIcean version:        1.9.0 (loaded from CDN)`);
console.log(`  PM predicates:            CSS selectors where possible, JS fallback`);
console.log(`  Rendering:                client-side (browser)`);
console.log(`  Open ${htmlPath} in a browser to view the rendered edition`);
