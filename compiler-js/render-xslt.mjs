#!/usr/bin/env node

/**
 * Render TEI XML to HTML with the edition.xsl stylesheet from odd-to-xslt.mjs,
 * run by SaxonJS through the xslt3 CLI (fetched by npx if not installed). The
 * stylesheet is XSLT 3.0: its predicates and params are XPath 3.1.
 *
 * --tei takes a file, a directory, a glob, a comma-separated list, or repeated
 * flags. Each source gives <basename>.html; several also an index.html. The
 * pages link edition.css, which --css copies beside them. --output names the
 * PM output to render (default web).
 *
 * Usage:  node render-xslt.mjs --xsl <path> --tei <path|dir|glob> [--css <path>] [--out <dir>] [--output <name>]
 */

import { execSync } from "child_process";
import { readFileSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { parseXmlToXast, extractTeiTitle } from "./odd-parser.mjs";
import {
  parseArgs, createLogger, writeOut,
  resolveInputFiles, htmlPageName, buildIndexPage,
} from "./cli.mjs";

const cli = parseArgs();
const log = createLogger("render-xslt");

const xslPath = cli.get("--xsl") || "output/edition.xsl";
const teiArg  = cli.getAll("--tei");
const cssPath = cli.get("--css") || "output/edition.css";
const outDir  = cli.get("--out") || "output";
const output  = cli.get("--output") || "web";

const teiFiles = resolveInputFiles(teiArg.length ? teiArg : "../examples/simler-*.xml");
const multi = teiFiles.length > 1;

mkdirSync(resolve(outDir), { recursive: true });
if (resolve(cssPath) !== resolve(outDir, "edition.css")) copyFileSync(resolve(cssPath), resolve(outDir, "edition.css"));

// The CLI runs in a temp directory holding edition.xsl, so no path reaches the
// shell; each document is written there as source.xml in turn.
const tempDir = join(tmpdir(), `odd-xslt-render-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
copyFileSync(resolve(xslPath), join(tempDir, "edition.xsl"));

function transform(teiFile) {
  copyFileSync(resolve(teiFile), join(tempDir, "source.xml"));
  execSync(
    `npx --yes xslt3 -xsl:edition.xsl -s:source.xml -o:result.html output=${JSON.stringify(output)}`,
    { cwd: tempDir, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
  );
  return readFileSync(join(tempDir, "result.html"), "utf-8");
}

const indexEntries = [];
try {
  for (const teiFile of teiFiles) {
    const pageName = htmlPageName(teiFile);
    const outFile = writeOut(outDir, pageName, transform(teiFile));
    log(`✓ ${teiFile} → ${outFile}`);
    const title = extractTeiTitle(parseXmlToXast(readFileSync(resolve(teiFile), "utf-8")));
    indexEntries.push({ href: pageName, title: title || pageName, meta: "XSLT (SaxonJS)" });
  }
} catch (e) {
  console.error(`[render-xslt] ✗ SaxonJS (xslt3) failed: ${e.stderr?.toString() || e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (multi && !process.exitCode) {
  const indexFile = writeOut(outDir, "index.html", buildIndexPage({
    title: "TEI Edition — XSLT",
    subtitle: `${teiFiles.length} documents · generated stylesheet, server-free`,
    entries: indexEntries,
  }));
  log(`✓ Index written to ${indexFile}`);
}
