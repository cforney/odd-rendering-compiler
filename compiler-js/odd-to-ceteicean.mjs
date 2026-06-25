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
import { parseArgs, createLogger, writeOut, escapeJsString as escStr, escapeJsComment, generatedStamp, warnUnsupportedPredicate } from "./cli.mjs";

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
  warnUnsupportedPredicate(log, pred);
  return { type: "js", code: `true /* TODO: ${escapeJsComment(pred)} */` };
}

// ---------------------------------------------------------------------------
// Map PM behaviours → CETEIcean behaviour function bodies
// ---------------------------------------------------------------------------

/**
 * Behaviours that are just "this element is the styled node": teiStamp puts the
 * tei-<id>/r-<id> classes on the custom element and edition.css does the rest.
 */
const CETEI_DISPLAY = new Set([
  "inline", "block", "paragraph", "section", "body", "cit", "table", "row", "cell", "title",
]);

/**
 * Generate a CETEIcean behaviour function body for a PM model — a string of JS
 * run inside function(el) { ... }, where `el` is the custom element (e.g.
 * <tei-head>). Behaviours build the same DOM the unified/XSLT renderers emit and
 * stamp the same classes; all appearance comes from the shared edition.css.
 */
function behaviourToCode(model, ident) {
  const b = model.behaviour;
  const params = Object.fromEntries(model.params.map(p => [p.name, p.value]));

  if (CETEI_DISPLAY.has(b)) {
    return `      teiStamp(el, '${escStr(ident)}');`;
  }

  switch (b) {
    case "heading": {
      const level = params.level || "'1'";
      if (level === "count(ancestor::div)") {
        return `      var level = 0, p = el.parentElement;
      while (p) { if (p.localName === 'tei-div') level++; p = p.parentElement; }
      teiReshape(el, 'h' + Math.min(6, Math.max(1, level)), '${escStr(ident)}');`;
      }
      const lv = Math.min(6, Math.max(1, parseInt(level.replace(/'/g, ""), 10) || 1));
      return `      teiReshape(el, 'h${lv}', '${escStr(ident)}');`;
    }

    case "document":
      return `      teiStamp(el, '${escStr(ident)}'); el.style.display = 'block';`;

    case "metadata":
    case "omit":
      return `      el.style.display = 'none';`;

    case "note":
      // Inline ref + collapsible body, toggled by the shared page script
      // (click .tei-note-ref → toggle .open on its .tei-note-interactive parent).
      return `      teiData(el);
      var idx = ++window.__teiNoteCounter;
      var content = el.innerHTML;
      el.className = 'tei-note-interactive';
      el.innerHTML = '<a class="tei-note-ref" href="#" role="doc-noteref"><sup>' + idx + '</sup></a>' +
        '<span class="tei-note-body" role="doc-footnote">' + content + '</span>';`;

    case "link": {
      const uri = params.uri || "@target";
      const attrName = uri.startsWith("@") ? uri.slice(1) : "target";
      return `      var a = teiReshape(el, 'a', '${escStr(ident)}');
      var href = el.getAttribute('${escStr(attrName)}') || '';
      a.setAttribute('href', href);
      if (href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }`;
    }

    case "alternate":
      // Default reading shown, alt hidden; toggled by the shared page script.
      return `      teiData(el);
      el.className = 'tei-alternate tei-${escStr(ident)}';
      var kids = [];
      for (var i = 0; i < el.children.length; i++) kids.push(el.children[i]);
      var def = document.createElement('span'); def.className = 'tei-alternate-default';
      var alt = document.createElement('span'); alt.className = 'tei-alternate-alt'; alt.hidden = true;
      if (kids[0]) def.appendChild(kids[0]);
      if (kids[1]) alt.appendChild(kids[1]);
      el.innerHTML = '';
      el.appendChild(def); el.appendChild(alt);`;

    case "graphic": {
      const url = params.url || "@url";
      const attrName = url.startsWith("@") ? url.slice(1) : "url";
      return `      teiData(el); el.style.display = 'contents';
      var fig = document.createElement('figure'); fig.className = 'tei-${escStr(ident)}';
      var img = document.createElement('img');
      img.src = el.getAttribute('${escStr(attrName)}') || '';
      img.loading = 'lazy';
      var desc = el.querySelector('tei-desc'); img.alt = desc ? desc.textContent : '';
      fig.appendChild(img); el.innerHTML = ''; el.appendChild(fig);`;
    }

    case "list":
      return `      teiReshape(el, 'ul', '${escStr(ident)}');`;
    case "listItem":
      return `      teiReshape(el, 'li', '${escStr(ident)}');`;
    case "break":
      return `      teiReshape(el, 'br', '${escStr(ident)}');`;

    case "anchor":
      return `      teiData(el); el.className = 'tei-anchor'; el.id = el.getAttribute('xml:id') || '';`;

    case "glyph":
      return `      teiData(el); el.className = 'tei-glyph';`;

    case "index":
      // Table of contents (headings only), suppressed for short documents —
      // mirrors the unified/XSLT toc.
      return `      var heads = el.querySelectorAll('tei-head');
      if (heads.length >= 2) {
        el.style.display = 'contents';
        var nav = document.createElement('nav'); nav.className = 'tei-toc'; nav.setAttribute('aria-label', 'Contents');
        var lab = document.createElement('p'); lab.className = 'tei-toc-label'; lab.textContent = 'Contents'; nav.appendChild(lab);
        var ul = document.createElement('ul');
        heads.forEach(function (hd) { var li = document.createElement('li'); li.className = 'tei-toc-entry'; li.textContent = hd.textContent.trim(); ul.appendChild(li); });
        nav.appendChild(ul); el.innerHTML = ''; el.appendChild(nav);
      } else { el.style.display = 'none'; }`;

    case "text":
      return `      el.style.display = 'contents';`;

    default:
      return `      teiStamp(el, '${escStr(ident)}'); // ${escStr(b)}`;
  }
}

/**
 * Compile a link/graphic uri/url param to a JS expression over the CETEIcean
 * element: an attribute (`@facs`), a string literal, or a `concat()` of those
 * (the IIIF-URL pattern). Mirrors odd-to-unified's paramValueToJS, but reads via
 * el.getAttribute().
 */
function paramValueToCeteiJs(value) {
  const v = (value || "").trim();
  const attr = v.match(/^@([\w:.-]+)$/);
  if (attr) return `el.getAttribute('${escStr(attr[1])}') || ''`;
  const lit = v.match(/^'([^']*)'$/);
  if (lit) return `'${escStr(lit[1])}'`;
  const concat = v.match(/^concat\(([\s\S]*)\)$/);
  if (concat) {
    const parts = [];
    let cur = "", inQuote = false;
    for (const ch of concat[1]) {
      if (ch === "'") { inQuote = !inQuote; cur += ch; }
      else if (ch === "," && !inQuote) { parts.push(cur); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => `(${paramValueToCeteiJs(p)})`).join(" + ");
  }
  return `'${escStr(v)}'`;
}

/**
 * A compound (Boot nested-model) behaviour. When the sub-models are a link + a
 * graphic, the link WRAPS the graphic so a <pb> renders as one clickable
 * thumbnail (<a href="full"><figure><img src="thumb"></figure></a>) — matching
 * the unified/XSLT output. Other shapes fall back to the first sub-model.
 */
function compoundToCode(subModels, ident) {
  const link = subModels.find((sm) => sm.behaviour === "link");
  const graphic = subModels.find((sm) => sm.behaviour === "graphic");
  if (link && graphic) {
    const lp = Object.fromEntries(link.params.map((p) => [p.name, p.value]));
    const gp = Object.fromEntries(graphic.params.map((p) => [p.name, p.value]));
    const hrefExpr = paramValueToCeteiJs(lp.uri || "@target");
    const srcExpr = paramValueToCeteiJs(gp.url || "@url");
    return `      // compound (Boot nested model): link wraps graphic — one clickable
      // thumbnail (<a><figure><img></figure></a>), identical to unified/XSLT.
      teiData(el); el.style.display = 'contents';
      var a = document.createElement('a'); a.className = 'tei-${escStr(ident)}'; a.href = ${hrefExpr};
      var fig = document.createElement('figure'); fig.className = 'tei-${escStr(ident)}';
      var img = document.createElement('img'); img.src = ${srcExpr}; img.loading = 'lazy';
      var desc = el.querySelector('tei-desc'); img.alt = desc ? desc.textContent : '';
      fig.appendChild(img); a.appendChild(fig); el.innerHTML = ''; el.appendChild(a);`;
  }
  return behaviourToCode(subModels[0], ident);
}

/** Emit one flattened unit: a compound, or a plain behaviour. */
function emitOne(m, ident) {
  return m.isCompound ? compoundToCode(m.subModels, ident) : behaviourToCode(m, ident);
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
    `// ── Shared stamping helpers ──`,
    `// Styling comes from the generated edition.css (the same .tei-<id>/.r-<id>`,
    `// rules the unified and XSLT renderers use), so behaviours only have to put`,
    `// those classes on the right node and mirror @attrs to data-* for the`,
    `// attribute selectors (e.g. .tei-rs[data-type='person']).`,
    `function teiRcls(el) {`,
    `  var r = el.getAttribute('rendition');`,
    `  return r ? r.split(/\\s+/).filter(Boolean).map(function (t) { return ' r-' + t.replace(/^#/, ''); }).join('') : '';`,
    `}`,
    `function teiData(el) {`,
    `  for (var i = el.attributes.length - 1; i >= 0; i--) {`,
    `    var n = el.attributes[i].name;`,
    `    if (n === 'class' || n === 'style' || n.slice(0, 5) === 'data-') continue;`,
    `    el.setAttribute('data-' + n.replace(/[:.]/g, '-'), el.attributes[i].value);`,
    `  }`,
    `}`,
    `// Display behaviours: the custom element itself is the styled node.`,
    `function teiStamp(el, ident) { teiData(el); el.className = 'tei-' + ident + teiRcls(el); }`,
    `// Reshaping behaviours: wrap the content in the real HTML element the other`,
    `// renderers emit and make the custom element disappear from layout, so the`,
    `// result matches exactly. Returns the inner element.`,
    `function teiReshape(el, tag, ident) {`,
    `  teiData(el);`,
    `  var n = document.createElement(tag);`,
    `  n.className = 'tei-' + ident + teiRcls(el);`,
    `  n.innerHTML = el.innerHTML;`,
    `  el.style.display = 'contents';`,
    `  el.innerHTML = '';`,
    `  el.appendChild(n);`,
    `  return n;`,
    `}`,
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
        // Boot's nested-model extension: keep the sub-models together as one
        // compound unit (link wraps graphic) rather than flattening them apart.
        flatModels.push({ isCompound: true, subModels: m.nested, predicate: m.predicate || null });
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
      lines.push(emitOne(m, el.ident));
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
            lines.push(emitOne(m, el.ident));
            lines.push(`      }],`);
          }
        }
        // Default (no predicate)
        const defaults = flatModels.filter(m => !m.predicate);
        if (defaults.length > 0) {
          lines.push(`      function(el) {`);
          lines.push(emitOne(defaults[0], el.ident));
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
            lines.push(`  ${emitOne(m, el.ident)}`);
            lines.push(`        return;`);
            lines.push(`      }`);
          }
        }
        // Default
        const defaults = flatModels.filter(m => !m.predicate);
        if (defaults.length > 0) {
          lines.push(`      // default (no predicate)`);
          lines.push(emitOne(defaults[0], el.ident));
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
  <!-- The ODD-generated stylesheet — the SAME one the unified/XSLT pages use.
       CETEIcean's behaviours stamp the matching tei-*/r-* classes onto the
       custom elements, so this drives the appearance and the output looks
       identical across renderers. -->
  <link rel="stylesheet" href="edition.css">
  <style>
    /* Shared page chrome — identical to the unified/XSLT pages so every renderer
       looks the same; only the render-info banner colour differs (pink). */
    body.tei-edition { max-width: 42em; margin: 2em auto; padding: 0 1em; font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; line-height: 1.7; color: #222; background: #fefefe; }
    /* CETEIcean makes a custom element per TEI element; the structural wrappers
       with no Processing-Model behaviour still need to be block-level. */
    tei-TEI, tei-text, tei-front, tei-body, tei-group { display: block; }
    .render-info { font-family: system-ui, sans-serif; background: #fce7f3; border: 1px solid #f9a8d4; padding: 1em; border-radius: 6px; margin-bottom: 2em; font-size: 0.85em; }
    .render-info h3 { margin: 0 0 0.5em; color: #db2777; }
    .render-info code { background: #fdf2f8; padding: 0.1em 0.3em; border-radius: 3px; }
    /* Facsimile thumbnails (pb compound), resetting the colliding .tei-pb floor rules. */
    a.tei-pb { display: block; clear: both; height: auto; width: auto; max-width: 150px; margin: 1.2em auto; padding: 4px; border: 1px solid #ccc; background: #fafafa; line-height: 0; }
    a.tei-pb figure.tei-pb { display: block; height: auto; max-width: none; margin: 0; border: 0; }
    a.tei-pb img { display: block; width: 100%; height: auto; }
    /* Interactive layer (notes, apparatus, facsimile toggle). */
    .tei-note-interactive .tei-note-body { display: none; }
    .tei-note-interactive.open .tei-note-body { display: inline; background: #fffde7; border: 1px solid #e0e0e0; padding: 0.15em 0.4em; border-radius: 4px; }
    .tei-note-ref { cursor: pointer; color: #2563eb; text-decoration: none; }
    .tei-alternate { cursor: pointer; border-bottom: 1px dotted #999; }
    .facs-toggle { display: none; margin: 0 0 1.2em; font-family: system-ui, sans-serif; }
    html.js .facs-toggle { display: block; }
    .facs-toggle button { font: inherit; font-size: 0.85em; cursor: pointer; padding: 0.3em 0.8em; border: 1px solid #c7c7c7; border-radius: 4px; background: #f3f3f3; }
    body.facs-hidden a.tei-pb { display: none; }
  </style>
</head>
<body class="tei-edition">

  <div class="render-info">
    <h3>CETEIcean Rendering Path</h3>
    <p><strong>Pipeline:</strong> ODD → <code>odd-to-ceteicean.mjs</code> →
      behaviours.js → CETEIcean (browser) → HTML</p>
    <p>CETEIcean registers TEI elements as <code>tei-</code> custom elements, then
      applies ODD-derived behaviours that stamp the same <code>tei-*</code>/<code>r-*</code>
      classes the other renderers use — so the shared <code>edition.css</code>
      produces the same result. Click notes to expand; click corrections to toggle
      readings.</p>
  </div>

  <div class="facs-toggle"><button type="button" data-facs-toggle="">Hide facsimiles</button></div>

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

  <!-- Shared interactive layer — the same framework-free handler the XSLT
       interactive page uses. Event delegation, so it works no matter when
       CETEIcean finishes building the DOM. -->
  <script>
    document.documentElement.classList.add('js');
    document.addEventListener('click', function (e) {
      var ref = e.target.closest('.tei-note-ref');
      if (ref) { e.preventDefault(); ref.parentNode.classList.toggle('open'); return; }
      var alt = e.target.closest('.tei-alternate');
      if (alt) {
        var d = alt.querySelector('.tei-alternate-default');
        var v = alt.querySelector('.tei-alternate-alt');
        if (d) { d.hidden = !d.hidden; }
        if (v) { v.hidden = !v.hidden; }
        return;
      }
      var ft = e.target.closest('[data-facs-toggle]');
      if (ft) {
        var hidden = document.body.classList.toggle('facs-hidden');
        ft.textContent = hidden ? 'Show facsimiles' : 'Hide facsimiles';
      }
    });
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
