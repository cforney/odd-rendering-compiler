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
 * Usage:   odd-render <odd> <tei…> [options]      (odd-render --help for the options)
 * Output:  the pages, what the compiler generated in artefacts/, and with --reports
 *          the build reports in reports/
 * Read by: a browser
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs, resolveTeiFiles } from "./cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")); // the published package

/** The tiers: the static page, each enhancer of render-unified.mjs, and CETEIcean, which compiles and renders in one step. */
const TIERS = ["static", "script", "islands", "petite-vue", "ceteicean"];
/** Options that take a value, so what follows them is not a positional argument. */
const VALUED = ["--out", "--tokens", "--output", "--tier", "--lang", "--fail-on", "--lock"];

const USAGE = `odd-render ${version} — compile a TEI ODD's Processing Model, and render an edition with it.

  odd-render <odd> <tei…> [options]

  <odd>             the ODD to compile
  <tei…>            TEI sources: files, directories, globs (quote them), or a comma-separated list

  --out <dir>       where to write (default: build)
  --tokens <css>    design tokens, prepended to edition.css
  --output <name>   the Processing-Model output to render (default: web; needs --tier static)
  --tier <name>     ${TIERS.join(" | ")} (default: static)
  --lang <code>     the language of the search records, with --reports or --search
  --reports         also write the findings, the plain text, the JSON records and the coverage
  --search          also write a search page over the plain text, search.html, and its
                    Pagefind index; it must be served over HTTP. Needs the pagefind package
  --strict          fail on XPath the subset cannot evaluate, instead of degrading it
  --fail-on <sev>   fail on a diagnostic of this severity or above: error | warning | info;
                    all are written to artefacts/diagnostics.json
  --lock <file>     fail if the ODD chain differs from the hashes in this file; the first run writes it
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
const search = cli.has("--search") && "--search"; // tells the renderers that the index page may link to it

if (!oddPath || !teiPaths.length) fail(`give an ODD and at least one TEI source\n\n${USAGE}`);
if (!TIERS.includes(tier)) fail(`unknown tier "${tier}" — one of ${TIERS.join(", ")}`);
if (output !== "web" && tier !== "static") fail(`--output ${output} needs --tier static; the other tiers render the page`);
if (!existsSync(oddPath)) fail(`ODD not found: ${oddPath}`);

// Resolve the sources here, so a typo or an empty glob is an error, not an empty build.
const sources = resolveTeiFiles(teiPaths);
const missing = sources.filter((path) => !existsSync(path));
if (missing.length) fail(`TEI source not found: ${missing.join(", ")}`);
if (!sources.length) fail(`no TEI source matched ${teiPaths.join(", ")}`);

/** Run one step of the pipeline; its failure is the command's. Falsy arguments drop out. */
function step(script, ...args) {
  const done = spawnSync(process.execPath, [join(HERE, script), ...args.flat(2).filter(Boolean)], {
    stdio: "inherit",
    env: { ...process.env, ...(script !== "odd-to-unified.mjs" && { ORC_QUIET: "1" }) }, // one step prints the warnings
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

const artefacts = join(outDir, "artefacts");
const reports = join(outDir, "reports");
const css = join(artefacts, "edition.css");
const handlers = join(artefacts, "tei-handlers.mjs");
const tei = sources.map((path) => ["--tei", path]);

step("odd-to-css.mjs", "--odd", oddPath, tokens && ["--tokens", tokens], "--out", artefacts, stamp);
const failOn = cli.get("--fail-on");
const lock = cli.get("--lock");
step("odd-to-unified.mjs", "--odd", oddPath, "--out", artefacts, stamp, strict, failOn && ["--fail-on", failOn], lock && ["--lock", lock]);
if (tier === "ceteicean") {
  step("odd-to-ceteicean.mjs", "--odd", oddPath, tei, "--css", css, "--out", outDir, stamp, strict, search);
} else {
  step("render-unified.mjs", tier !== "static" && ["--enhance", tier], "--handlers", handlers, tei, "--css", css, "--out", outDir, "--output", output, search);
}

if (cli.has("--reports") || search) step("render-plain.mjs", "--handlers", handlers, tei, lang && ["--lang", lang], "--out", join(reports, "plain"));
if (search) step("search-index.mjs", "--records", join(reports, "plain", "records.json"), "--out", outDir);
if (cli.has("--reports")) {
  step("render-json.mjs", "--odd", oddPath, tei, "--output", output, "--out", join(reports, "json"), strict);
  step("coverage.mjs", "--odd", oddPath, "--records", join(reports, "json"), "--out", join(reports, "coverage"));
  step("findings.mjs", "--odd", oddPath, tei, tokens && ["--tokens", tokens], "--out", join(reports, "findings"));
}

const where = [`artefacts in ${outDir}/artefacts`, cli.has("--reports") && `reports in ${outDir}/reports`, search && `search in ${outDir}/search.html`].filter(Boolean);
console.log(`[odd-render] ✓ ${sources.length} page(s) in ${outDir} — the ${tier} tier of ${basename(oddPath)}; ${where.join(", ")}`);
