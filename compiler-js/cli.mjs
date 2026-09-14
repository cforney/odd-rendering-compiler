/**
 * cli.mjs
 *
 * Shared command-line and output helpers used by every generator and renderer:
 * argument parsing, `[name] …` console logging, file writing, escaping, the
 * hast serialiser, and the multi-file `--tei` input resolver.
 */

import {
  writeFileSync, mkdirSync, readdirSync, statSync, existsSync,
} from "fs";
import {
  resolve, join, basename, extname,
} from "path";
import { pathToFileURL } from "url";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

/**
 * Parse `--flag value` style arguments.
 * @param {string[]} [argv] — defaults to the current process arguments.
 * @returns {{ get(name, fallback?): string|null, has(name): boolean, raw: string[] }}
 */
export function parseArgs(argv = process.argv.slice(2)) {
  return {
    get(name, fallback = null) {
      const idx = argv.indexOf(name);
      return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : fallback;
    },
    /** Every value of a flag that may be repeated, e.g. `--tei a.xml --tei b.xml`. */
    getAll(name) {
      const out = [];
      for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === name) out.push(argv[i + 1]);
      }
      return out;
    },
    has: (name) => argv.includes(name),
    raw: argv,
  };
}

// ---------------------------------------------------------------------------
// Input resolution (single file · directory · glob · repeated/comma-separated)
// ---------------------------------------------------------------------------

/** Translate one glob path segment (`*`, `?` wildcards) into an anchored RegExp. */
function segmentToRegExp(seg) {
  let re = "";
  for (const ch of seg) {
    if (ch === "*") re += "[^/\\\\]*";
    else if (ch === "?") re += "[^/\\\\]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

/** Every descendant directory of `dir` (for `**` matching). */
function allSubdirs(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      const full = dir === "." ? e.name : join(dir, e.name);
      out.push(full, ...allSubdirs(full));
    }
  }
  return out;
}

/**
 * Minimal, dependency-free file globber supporting `*`, `?`, and `**` (the
 * patterns a TEI corpus actually needs: `dir/*.xml`, `**​/*.xml`). Returns the
 * matched *files* only.
 */
function globFiles(pattern) {
  const segs = pattern.replace(/\\/g, "/").split("/").filter(Boolean);
  let dirs = ["."];
  const results = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    if (seg === "**") {
      dirs = [...new Set(dirs.flatMap((d) => [d, ...allSubdirs(d)]))];
      continue;
    }
    if (seg === "." || seg === "..") {
      // a relative-path segment (e.g. `../examples/*.xml`): step, don't match
      dirs = seg === "." ? dirs : dirs.map((d) => join(d, ".."));
      continue;
    }
    const re = segmentToRegExp(seg);
    const next = [];
    for (const d of dirs) {
      let entries;
      try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!re.test(e.name)) continue;
        const full = d === "." ? e.name : join(d, e.name);
        if (last) { if (e.isFile()) results.push(full); }
        else if (e.isDirectory()) next.push(full);
      }
    }
    if (!last) dirs = next;
  }
  return results;
}

/**
 * Resolve a `--tei` argument into a sorted, de-duplicated list of input files.
 * Each spec (a string, or an array of strings from a repeated flag) may itself
 * be comma-separated, and each part may be:
 *   - a single file        — `../examples/simler-psalmen.xml`
 *   - a directory          — `../examples`        (→ every `*.xml` inside)
 *   - a glob (`* ? **`)    — `"../examples/*.xml"`
 * A plain path that does not exist is still returned (so the caller can emit a
 * clear "file not found" message).
 * @param {string|string[]} specs
 * @param {string} [ext] extension used to expand a directory (default `.xml`)
 * @returns {string[]}
 */
export function resolveInputFiles(specs, ext = ".xml") {
  const parts = (Array.isArray(specs) ? specs : [specs])
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const files = new Set();
  for (const spec of parts) {
    if (/[*?]/.test(spec)) {
      for (const f of globFiles(spec)) files.add(f);
    } else if (existsSync(spec) && statSync(spec).isDirectory()) {
      for (const name of readdirSync(spec)) {
        if (name.toLowerCase().endsWith(ext.toLowerCase())) files.add(join(spec, name));
      }
    } else {
      files.add(spec);
    }
  }
  return [...files].sort();
}

/** Output HTML filename for one TEI source, e.g. `letters/L12.xml` → `L12.html`. */
export function htmlPageName(teiFile) {
  return basename(teiFile, extname(teiFile)) + ".html";
}

/**
 * Build a small, self-contained index page linking the per-source editions
 * produced in multi-file mode. `entries` is `[{ href, title, meta? }]`.
 */
export function buildIndexPage({ title = "Edition", subtitle = "", entries = [] }) {
  const items = entries.map((e) => `      <li>
        <a href="${escapeXml(e.href)}">${escapeXml(e.title)}</a>${e.meta ? `
        <span class="meta">${escapeXml(e.meta)}</span>` : ""}
      </li>`).join("\n");
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
  </style>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escapeXml(subtitle)}</p>` : ""}
  <ul>
${items}
  </ul>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Create a `[scope]`-prefixed logger, e.g. createLogger("odd-to-xslt").
 * @param {string} scope
 * @returns {(...parts: unknown[]) => void}
 */
export function createLogger(scope) {
  const prefix = `[${scope}]`;
  return (...parts) => console.log(prefix, ...parts);
}

/**
 * Timestamp for a generated file's header, or null when the date should be
 * omitted for reproducible output. Pass `--no-timestamp`, or set
 * SOURCE_DATE_EPOCH (Unix seconds) to pin it.
 */
export function generatedStamp(cli) {
  if (cli?.has?.("--no-timestamp")) return null;
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

/**
 * Ensure `outDir` exists, write `content` to `outDir/filename`, return the
 * (un-resolved) path for logging.
 * @returns {string}
 */
export function writeOut(outDir, filename, content) {
  mkdirSync(resolve(outDir), { recursive: true });
  const outPath = join(outDir, filename);
  writeFileSync(resolve(outPath), content, "utf-8");
  return outPath;
}

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

/** Import a generated handler module (tei-handlers.mjs) and return its teiToHast. */
export async function loadHandlers(path) {
  const { teiToHast } = await import(pathToFileURL(resolve(path)).href);
  if (!teiToHast) throw new Error(`${path} exports no teiToHast`);
  return teiToHast;
}
