#!/usr/bin/env node

/**
 * Render TEI XML to HTML with the edition.xsl stylesheet from odd-to-xslt.mjs.
 * The XSLT engine is probed once and reused: SaxonJS via the xslt3 CLI
 * (`npm install xslt3`) first, then xslt-processor (pure-JS XSLT 1.0) as a
 * fallback.
 *
 * --tei takes a file, a directory, a glob, a comma-separated list, or repeated
 * flags. One input → rendered-xslt.html; several → one <basename>.html per
 * source plus an index.html.
 *
 * Usage:  node render-xslt.mjs --xsl <path> --tei <path|dir|glob> [--out <dir>]
 */

import { execSync } from "child_process";
import {
  readFileSync, mkdirSync, copyFileSync, rmSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut,
  resolveInputFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const cli = parseArgs();
const log = createLogger("render-xslt");

const xslPath = cli.get("--xsl") || "output/edition.xsl";
const teiArg  = cli.getAll("--tei");
const outDir  = cli.get("--out") || "output";

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-poem.xml");
const multi = teiFiles.length > 1;

log(`XSLT stylesheet: ${xslPath}`);
log(`TEI source(s):    ${teiFiles.join(", ")}`);

const xslSrc = readFileSync(resolve(xslPath), "utf-8");

// ---------------------------------------------------------------------------
// Engine setup. The # character in workspace paths breaks shell invocations,
// so SaxonJS runs inside a temp directory holding edition.xsl; each document is
// written there as source.xml in turn.
// ---------------------------------------------------------------------------
const tempDir = join(tmpdir(), `odd-xslt-render-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
copyFileSync(resolve(xslPath), join(tempDir, "edition.xsl"));

/** SaxonJS via the xslt3 CLI (production-grade, XSLT 3.0). */
function saxonTransform(teiFile) {
  copyFileSync(resolve(teiFile), join(tempDir, "source.xml"));
  execSync(
    `npx --yes xslt3 -xsl:edition.xsl -s:source.xml -o:result.html`,
    { cwd: tempDir, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
  );
  return readFileSync(join(tempDir, "result.html"), "utf-8");
}

/** xslt-processor (lightweight pure-JS XSLT 1.0) — loaded and parsed lazily. */
let xsltProcess, xmlParse, xslDoc;
async function xpTransform(teiFile) {
  if (!xsltProcess) {
    ({ xsltProcess, xmlParse } = await import("xslt-processor"));
    xslDoc = xmlParse(xslSrc);
  }
  const xmlDoc = xmlParse(readFileSync(resolve(teiFile), "utf-8"));
  return xsltProcess(xmlDoc, xslDoc);
}

// On the first document, probe SaxonJS then xslt-processor; reuse whichever
// works for the rest of the corpus. Returns null only if neither is available.
let engine = null;
async function transform(teiFile) {
  if (engine === "saxon") return saxonTransform(teiFile);
  if (engine === "xslt-processor") return await xpTransform(teiFile);

  try {
    log(`Trying SaxonJS (xslt3 CLI)…`);
    const html = saxonTransform(teiFile);
    engine = "saxon";
    log(`✓ SaxonJS transformation succeeded — using it for the corpus`);
    return html;
  } catch (e) {
    log(`⚠ xslt3 not available (${e.message?.split("\n")[0]})`);
  }
  try {
    log(`Trying xslt-processor (pure-JS fallback)…`);
    const html = await xpTransform(teiFile);
    engine = "xslt-processor";
    log(`✓ xslt-processor transformation succeeded — using it for the corpus`);
    return html;
  } catch (e) {
    log(`⚠ xslt-processor not available (${e.message?.split("\n")[0]})`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Render each input. If no engine is available, fail loudly rather than fake
// the transformation with a hand-written fallback — only output derived from
// edition.xsl is a faithful render of the ODD.
// ---------------------------------------------------------------------------
const indexEntries = [];
for (const teiFile of teiFiles) {
  const html = await transform(teiFile);
  if (html == null) {
    console.error(
      `[render-xslt] ✗ No XSLT engine available - cannot render ${xslPath}.\n` +
      `  This renderer deliberately has no hand-written fallback: its output must\n` +
      `  come from the generated edition.xsl, not a parallel mapping. Install one of:\n` +
      `    - SaxonJS / xslt3 (XSLT 3.0):  npm install --no-save xslt3\n` +
      `    - xslt-processor (XSLT 1.0):   npm install --no-save xslt-processor\n` +
      `  (The default run uses 'npx xslt3' when network access is available.)`
    );
    try { rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }
    process.exit(1);
  }

  const pageName = multi ? htmlPageName(teiFile) : "rendered-xslt.html";
  const outFile = writeOut(outDir, pageName, html);
  log(`✓ ${teiFile} → ${outFile}`);
  const title = extractTeiTitle(parseXmlToXast(readFileSync(resolve(teiFile), "utf-8")));
  indexEntries.push({ href: pageName, title: title || pageName, meta: `XSLT (${engine})` });
}

if (multi) {
  const indexFile = writeOut(outDir, "index.html", buildIndexPage({
    title: "TEI Edition — XSLT",
    subtitle: `${teiFiles.length} documents · generated stylesheet, server-free`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
try { rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }
log(`  Open in browser to view the rendered edition`);
