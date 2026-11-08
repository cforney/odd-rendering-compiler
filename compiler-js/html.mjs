/**
 * html.mjs — HTML as strings, with no files and no command line: escaping, the
 * hast serialiser, and the small pages around the editions (the index of a corpus,
 * a build report). The library and the command lines share it.
 */

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Escape text for HTML/XML content or double-quoted attribute values. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// hast → HTML
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Serialise hast as Saxon's HTML output method does, so the renders compare byte for byte. */
export function toHtml(node) {
  if (node.type === "text") return node.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, "&nbsp;");
  if (node.type === "root") return node.children.map(toHtml).join("");
  const attrs = Object.entries(node.properties ?? {})
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => {
      if (v === true) return ` ${k}`;
      const value = Array.isArray(v) ? v.join(" ") : String(v);
      return ` ${k === "className" ? "class" : k}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\u00a0/g, "&nbsp;")}"`;
    })
    .join("");
  if (VOID_ELEMENTS.has(node.tagName)) return `<${node.tagName}${attrs}>`;
  return `<${node.tagName}${attrs}>${(node.children ?? []).map(toHtml).join("")}</${node.tagName}>`;
}

// ---------------------------------------------------------------------------
// Pages around the editions
// ---------------------------------------------------------------------------

/**
 * Build a small, self-contained index page linking the per-source editions
 * produced in multi-file mode. `entries` is `[{ href, title, meta?, page? }]`;
 * `page`, what the ODD's model for output "page" gives, adds the title, the
 * number of page images and the IIIF manifest. With `search`, the page links to
 * search.html.
 */
export function buildIndexPage({ title = "Edition", subtitle = "", entries = [], search = false }) {
  const items = entries.map(({ href, title, meta, page = {} }) => {
    const line = [
      meta && escapeXml(meta),
      page.pages?.length && `${page.pages.length} page image(s)`,
      page.manifest?.[0] && `<a href="${escapeXml(page.manifest[0])}">IIIF manifest</a>`,
    ].filter(Boolean).join(" · ");
    return `      <li>
        <a href="${escapeXml(href)}">${escapeXml(page.title?.[0] || title)}</a>${line ? `
        <span class="meta">${line}</span>` : ""}
      </li>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(title)}</title>
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
  <h1>${escapeXml(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escapeXml(subtitle)}</p>` : ""}
  ${search ? `<p><a href="search.html">Search the edition</a></p>` : ""}
  <ul>
${items}
  </ul>
</body>
</html>`;
}

/**
 * A small self-contained page for a build report: a lead line, then a list per
 * section, each `{ heading, note?, items }`. Used by findings.mjs and
 * coverage.mjs, so the two look alike.
 */
export function buildReportPage({ title, lead = "", sections = [] }) {
  const list = (items) => (items.length ? `<ul>\n${items.map((i) => `  <li>${escapeXml(i)}</li>`).join("\n")}\n</ul>` : `<p class="none">None.</p>`);
  const body = sections.map(({ heading, note, items }) =>
    `  <h2>${escapeXml(heading)}</h2>${note ? `\n  <p class="none">${escapeXml(note)}</p>` : ""}\n  ${list(items)}`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(title)}</title>
  <style>
    body { max-width: 42em; margin: 2em auto; padding: 0 1em; font: 15px/1.6 system-ui, sans-serif; color: #222; background: #fefefe; }
    h1 { font-size: 1.2rem; } h2 { font-size: 1rem; margin-top: 1.6em; }
    li { margin: 0.3em 0; } .none { color: #666; }
  </style>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${lead ? `<p class="none">${escapeXml(lead)}</p>` : ""}
${body}
</body>
</html>
`;
}
