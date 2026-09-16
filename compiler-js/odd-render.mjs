#!/usr/bin/env node

/**
 * odd-render — the whole pipeline as one command, to point at your own ODD.
 *
 * It composes the steps the npm scripts run, in the order they depend on each
 * other: edition.css and the unified handlers out of the ODD, then one
 * rendering tier over the TEI sources. The pages are self-contained; what the
 * compiler generated stays beside them in artefacts/, and --reports adds the
 * build reports. Every step is the same script the repository tests, run as its
 * own process, so the command adds no second implementation of anything.
 *
 * Usage:  odd-render <odd> <tei…> [options]      (odd-render --help for the options)
 */

import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs, resolveInputFiles } from "./cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));

/** The renderer of each tier. The CETEIcean one compiles and renders in one step. */
const TIERS = {
  static: "render-unified.mjs",
  interactive: "render-unified-interactive.mjs",
  islands: "render-unified-islands.mjs",
  ceteicean: "odd-to-ceteicean.mjs",
};
/** Options that take a value, so what follows them is not a positional argument. */
const VALUED = ["--out", "--tokens", "--output", "--tier", "--lang"];

const USAGE = `odd-render ${version} — compile a TEI ODD's Processing Model, and render an edition with it.

  odd-render <odd> <tei…> [options]

  <odd>             the ODD to compile
  <tei…>            TEI sources: files, directories, globs (quote them), or a comma-separated list

  --out <dir>       where to write (default: build)
  --tokens <css>    design tokens, prepended to edition.css
  --output <name>   the Processing-Model output to render (default: web; needs --tier static)
  --tier <name>     ${Object.keys(TIERS).join(" | ")} (default: static)
  --lang <code>     the language of the search records, with --reports
  --reports         also write the findings, the plain text, the JSON records and the coverage
  --strict          fail on XPath the subset cannot evaluate, instead of degrading it
  --no-timestamp    leave the date out of the generated headers
  -h, --help        this text
  -v, --version
`;

const cli = parseArgs();
const fail = (message) => {
  console.error(`odd-render: ${message}`);
  process.exit(1);
};

if (!cli.raw.length) {
  console.error(USAGE);
  process.exit(1);
}
if (cli.has("-h") || cli.has("--help")) {
  console.log(USAGE);
  process.exit(0);
}
if (cli.has("-v") || cli.has("--version")) {
  console.log(version);
  process.exit(0);
}

const [oddPath, ...teiPaths] = cli.raw.filter((arg, i) => !arg.startsWith("-") && !VALUED.includes(cli.raw[i - 1]));
const tier = cli.get("--tier", "static");
const output = cli.get("--output", "web");
const outDir = cli.get("--out", "build");
const tokens = cli.get("--tokens");
const lang = cli.get("--lang");
const stamp = cli.has("--no-timestamp") && "--no-timestamp";
const strict = cli.has("--strict") && "--strict";

if (!oddPath || !teiPaths.length) fail(`give an ODD and at least one TEI source\n\n${USAGE}`);
if (!(tier in TIERS)) fail(`unknown tier "${tier}" — one of ${Object.keys(TIERS).join(", ")}`);
if (output !== "web" && tier !== "static") fail(`--output ${output} needs --tier static; the other tiers render the page`);
if (!existsSync(oddPath)) fail(`ODD not found: ${oddPath}`);

// Resolve the sources here, so a typo or an empty glob is an error, not an empty build.
const sources = resolveInputFiles(teiPaths);
const missing = sources.filter((path) => !existsSync(path));
if (missing.length) fail(`TEI source not found: ${missing.join(", ")}`);
if (!sources.length) fail(`no TEI source matched ${teiPaths.join(", ")}`);

/** Run one step of the pipeline; its failure is the command's. Falsy arguments drop out. */
function step(script, ...args) {
  const done = spawnSync(process.execPath, [join(HERE, script), ...args.flat(2).filter(Boolean)], { stdio: "inherit" });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

const artefacts = join(outDir, "artefacts");
const reports = join(outDir, "reports");
const css = join(artefacts, "edition.css");
const handlers = join(artefacts, "tei-handlers.mjs");
const tei = sources.map((path) => ["--tei", path]);

step("odd-to-css.mjs", "--odd", oddPath, tokens && ["--tokens", tokens], "--out", artefacts, stamp);
step("odd-to-unified.mjs", "--odd", oddPath, "--out", artefacts, stamp, strict);
if (tier === "ceteicean") {
  step(TIERS[tier], "--odd", oddPath, tei, "--css", css, "--out", outDir, stamp, strict);
} else {
  step(TIERS[tier], "--handlers", handlers, tei, "--css", css, "--out", outDir, "--output", output);
}

if (cli.has("--reports")) {
  step("render-plain.mjs", "--handlers", handlers, tei, lang && ["--lang", lang], "--out", join(reports, "plain"));
  step("render-json.mjs", "--odd", oddPath, tei, "--output", output, "--out", join(reports, "json"), strict);
  step("coverage.mjs", "--odd", oddPath, "--records", join(reports, "json"), "--out", join(reports, "coverage"));
  step("findings.mjs", "--odd", oddPath, tei, tokens && ["--tokens", tokens], "--out", join(reports, "findings"));
}

const pages = readdirSync(resolve(outDir)).filter((f) => f.endsWith(".html")).length;
const where = [`artefacts in ${outDir}/artefacts`, cli.has("--reports") && `reports in ${outDir}/reports`].filter(Boolean);
console.log(`[odd-render] ✓ ${pages} page(s) in ${outDir} — the ${tier} tier of ${basename(oddPath)}; ${where.join(", ")}`);
