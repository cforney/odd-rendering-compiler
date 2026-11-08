/**
 * cli.mjs
 *
 * Shared command-line and output helpers used by every generator and renderer:
 * argument parsing, `[name] …` console logging, reading the ODD and the sources,
 * file writing, and the multi-file `--tei` input resolver. HTML as strings is in
 * html.mjs.
 */

import {
  writeFileSync, mkdirSync, readdirSync, readFileSync, statSync, existsSync,
} from "fs";
import {
  resolve, join, basename, extname,
} from "path";
import { pathToFileURL } from "url";
import { readOdd, parseXmlToXast, OddError } from "./odd-parser.mjs";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

/**
 * Parse `--flag value` style arguments, by default the current process's.
 * @param {string[]} [argv]
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
  const path = pattern.replace(/\\/g, "/");
  const root = path.match(/^(\/|[A-Za-z]:\/)/)?.[1];          // an absolute pattern walks from its root
  const segs = path.slice(root?.length ?? 0).split("/").filter(Boolean);
  let dirs = [root ?? "."];
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
  // The same file under two spellings is one source.
  return [...new Map([...files].map((f) => [resolve(f), f])).values()].sort();
}

/**
 * The TEI sources of a script. Sources that would write the same page, or the
 * index of several sources, end the process before anything is written.
 * @param {string|string[]} specs
 * @returns {string[]}
 */
export function resolveTeiFiles(specs) {
  const files = resolveInputFiles(specs);
  const pages = new Map();
  for (const f of files) pages.set(htmlPageName(f).toLowerCase(), [...(pages.get(htmlPageName(f).toLowerCase()) ?? []), f]);
  const clashes = [...pages].filter(([page, from]) => from.length > 1 || (page === "index.html" && files.length > 1));
  for (const [page, from] of clashes) console.error(`✗ ${from.join(", ")} would write ${page}, ${from.length > 1 ? "the same page" : "the index of several sources"}`);
  if (clashes.length) process.exit(1);
  return files;
}

/** Output HTML filename for one TEI source, e.g. `letters/L12.xml` → `L12.html`. */
export function htmlPageName(teiFile) {
  return basename(teiFile, extname(teiFile)) + ".html";
}

// ---------------------------------------------------------------------------
// Reading the ODD
// ---------------------------------------------------------------------------

/**
 * Read the ODD at `path` for a script; one it cannot read ends the process, with
 * a line for each problem, prefixed `[scope]`. Its warnings are printed, unless
 * ORC_QUIET says another step does. With `--lock <file>` the chain must match
 * the hashes in that file, which the first run writes.
 * @param {string} path
 * @param {string} scope
 */
export function loadOdd(path, scope) {
  try {
    const odd = readOdd(resolve(path));
    if (!process.env.ORC_QUIET) {
      for (const d of odd.diagnostics.filter((d) => d.severity !== "info")) console.warn(`[${scope}] ⚠ ${d.code} ${d.odd}:${d.line}: ${d.message}`);
    }
    const lock = parseArgs().get("--lock");
    if (lock) {
      const hashes = JSON.stringify(odd.sources, null, 2) + "\n";
      if (!existsSync(lock)) writeFileSync(lock, hashes);
      else if (readFileSync(lock, "utf8").replace(/\r\n/g, "\n") !== hashes) {
        console.error(`[${scope}] ✗ the ODD chain does not match ${lock}`);
        process.exit(1);
      }
    }
    return odd;
  } catch (e) {
    if (!(e instanceof OddError)) throw e;
    for (const line of e.message.split("\n")) console.error(`[${scope}] ✗ ${line}`);
    process.exit(1);
  }
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
// Reading the sources and the handlers
// ---------------------------------------------------------------------------

/** A TEI source as xast, which remembers its file for what goes wrong in rendering it. */
export function readTei(file) {
  return { ...parseXmlToXast(readFileSync(resolve(file), "utf8")), file };
}

/** Import a generated handler module (tei-handlers.mjs) and return its teiToHast; an error names the document. */
export async function loadHandlers(path) {
  const { teiToHast } = await import(pathToFileURL(resolve(path)).href);
  if (!teiToHast) throw new Error(`${path} exports no teiToHast`);
  return (tree, options) => {
    try {
      return teiToHast(tree, options);
    } catch (e) {
      throw new Error(tree.file ? `${tree.file}: ${e.message}` : e.message, { cause: e });
    }
  };
}
