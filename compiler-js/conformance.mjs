#!/usr/bin/env node

/**
 * Run the conformance suite against any implementation of the Processing Model.
 * A suite is a directory like test/fixtures/: pm.odd, tei/<case>.xml, and the
 * expected render of each case, <case>.html for the web output and
 * <case>.<output>.html for another. See docs/conformance-suite.md.
 *
 * --run is a shell command that renders one case for one output. {odd}, {tei},
 * {case}, {output} and {out} are filled in, and the command leaves the render at
 * {out}/{case}.html: the page a renderer here writes, or `… > {out}/{case}.html`.
 *
 * --level strict compares as the byte-identity gate does, up to attribute order
 * and the whitespace next to a block's tags. --level structure compares only tags and text, inside the
 * edition: without attributes, the edition's wrapper and the view switches,
 * which are this compiler's conventions, so an implementation with conventions
 * of its own can be compared on the rest.
 *
 * Usage:   node conformance.mjs --run <command> [--suite <dir>] [--level strict|structure]
 * Output:  a line per case and output, ✓ or ✗ with where the two first differ;
 *          exit 1 if any case fails
 * Read by: whoever maintains the implementation under test
 */

import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";
import { normaliseRenderedBody } from "./byte-identity.mjs";
import { parseArgs } from "./cli.mjs";

const cli = parseArgs();
const command = cli.get("--run");
const suite = resolve(cli.get("--suite") || fileURLToPath(new URL("test/fixtures", import.meta.url)));
const level = cli.get("--level") || "strict";

if (!command || !["strict", "structure"].includes(level)) {
  console.error("Usage: node conformance.mjs --run <command> [--suite <dir>] [--level strict|structure]");
  process.exit(2);
}

/** The edition as tags and text: no attributes, no wrapper, no view switches. */
const structure = (body) =>
  body
    .replace(/^<div class="tei-edition"[^>]*>([\s\S]*)<\/div>$/, "$1")
    .replace(/<form class="tei-views">[\s\S]*?<\/form>/g, "")
    .replace(/<([A-Za-z][\w-]*)[^>]*>/g, "<$1>");
const canonical = (html) => (level === "strict" ? normaliseRenderedBody(html) : structure(normaliseRenderedBody(html)));

/** Why a render fails, or "" where it conforms. */
function verdict(name, output) {
  const out = mkdtempSync(join(tmpdir(), "conformance-"));
  try {
    const fields = { odd: join(suite, "pm.odd"), tei: join(suite, "tei", `${name}.xml`), case: name, output, out };
    const run = spawnSync(command.replace(/\{(odd|tei|case|output|out)\}/g, (_, k) => fields[k]), { shell: true, encoding: "utf8" });
    if (run.status !== 0) return `the command failed (${run.status}): ${(run.stderr || run.stdout).trim().split("\n").at(-1)}`;
    const file = join(out, `${name}.html`);
    if (!existsSync(file)) return `the command wrote no ${name}.html`;
    const want = canonical(readFileSync(join(suite, output === "web" ? `${name}.html` : `${name}.${output}.html`), "utf8"));
    const got = canonical(readFileSync(file, "utf8"));
    let i = 0;
    while (i < want.length && want[i] === got[i]) i++;
    const around = (s) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
    return want === got ? "" : `differs at ${i}\n    expected ${around(want)}\n    rendered ${around(got)}`;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

let failed = 0;
for (const name of readdirSync(join(suite, "tei")).filter((f) => f.endsWith(".xml")).map((f) => basename(f, ".xml"))) {
  for (const output of ["web", ...readdirSync(suite).map((f) => f.match(new RegExp(`^${name}\\.([\\w-]+)\\.html$`))?.[1]).filter(Boolean)]) {
    if (output === "web" && !existsSync(join(suite, `${name}.html`))) continue;
    const why = verdict(name, output);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} ${name} (${output})${why ? `: ${why}` : ""}`);
  }
}
console.log(failed ? `${failed} failed (${level})` : `all conform (${level})`);
process.exit(failed ? 1 : 0);
