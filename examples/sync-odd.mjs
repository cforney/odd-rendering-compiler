#!/usr/bin/env node
/**
 * Vendor the Simler ODD, and the design tokens its CSS uses, from
 * DHBern/simler_data at a commit, and record the commit in README.md.
 *
 * Usage:  node sync-odd.mjs <commit>
 */
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "DHBern/simler_data";
const here = new URL(".", import.meta.url);
const commit = process.argv[2];
if (!commit) {
  console.error("usage: node sync-odd.mjs <commit>");
  process.exit(2);
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

const { sha, commit: { committer } } = await (await get(`https://api.github.com/repos/${REPO}/commits/${commit}`)).json();
const raw = async (path) => (await get(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`)).text();
const short = sha.slice(0, 7);
const date = committer.date.slice(0, 10);

writeFileSync(new URL("tei_simler.odd", here), await raw("schema/tei_simler.odd"));
writeFileSync(new URL("simler-tokens.css", here),
  `/* Simler Digital's design tokens: ${REPO}, preview/assets/tokens.css at ${short}. */\n` +
  await raw("preview/assets/tokens.css"));

const readme = new URL("README.md", here);
const pin = `[\`${short}\`](https://github.com/${REPO}/tree/${sha}) (${date})`;
writeFileSync(readme, readFileSync(readme, "utf8")
  .replace(/(<!-- sync-odd -->).*?(<!-- \/sync-odd -->)/gs, `$1${pin}$2`));

console.log(`✓ tei_simler.odd and simler-tokens.css from ${REPO} at ${short} (${date})`);
