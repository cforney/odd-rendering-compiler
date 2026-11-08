#!/usr/bin/env node
/**
 * Vendor the Simler ODD, the design tokens its CSS uses, and the excerpts, from
 * DHBern/simler_data at a commit, and record the commit in README.md and in each
 * excerpt's header comment. An excerpt is found by its text, not its line numbers,
 * which move: its lines are copied verbatim, and the start tags of what encloses
 * them and the closing tags follow from the source. An excerpt keeps its teiHeader
 * and the rest of its comment.
 *
 * Usage:  node sync-odd.mjs <commit>
 */
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "DHBern/simler_data";
const SOURCES = "webdav/data/sources/tei/";
const here = new URL(".", import.meta.url);
const commit = process.argv[2];
if (!commit) {
  console.error("usage: node sync-odd.mjs <commit>");
  process.exit(2);
}

/** Each excerpt's source: the line it starts at, and those that lead to its last line, each after the one before; a line matches by its start. */
const EXCERPTS = {
  "simler-psalmen.xml": { file: "C_1663_dok.xml", from: '<pb facs="4049203" n="4"/>', to: ["<l>auf Gottes hülff und gnad/ gelobet ihn zu ehren.</l>", "</div>"] },
  "simler-buchstabwechsel.xml": { file: "C_1663_Teil-0.xml", from: '<pb n="[A vii r]" facs="4049188"/>', to: ["</closer>", "</div>"] },
  "simler-hausswesen.xml": { file: "C_1663_dok.xml", from: '<fw place="bottom" type="catch">Chriſten-</fw>', to: ['<note place="bottom" type="bibl" rendition="#smaller #et">Ephe', "</lg>"] },
  "simler-regenten-kleinodt.xml": { file: "C_1663_dok.xml", from: '<pb facs="4049548" n="349"/>', to: ['<l rendition="#et">gantz vertilket werden.</l>', "</lg>"] },
};

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

const { sha, commit: { committer } } = await (await get(`https://api.github.com/repos/${REPO}/commits/${commit}`)).json();
const raw = async (path) => (await get(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`)).text();
const short = sha.slice(0, 7);
const date = committer.date.slice(0, 10);

/** The elements left open by `lines` over those already open, each { name, tag }. */
function openAfter(lines, open = []) {
  const stack = [...open];
  for (const m of lines.join("\n").matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (!m[2] || m[3]) continue;
    if (m[1]) stack.pop();
    else stack.push({ name: m[2], tag: m[0] });
  }
  return stack;
}

function excerpt(source, { from, to }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const at = (i, start) => {
    const found = lines.findIndex((l, k) => k >= i && l.trim().startsWith(start));
    if (found < 0) throw new Error(`not in the source: ${start}`);
    return found;
  };
  const start = at(0, from);
  const end = to.reduce(at, start);
  // The root is the excerpt's own.
  const open = openAfter(lines.slice(0, start)).filter((e) => e.name !== "TEI");
  const piece = lines.slice(start, end + 1);
  return { open, piece, closing: openAfter(piece, open).reverse() };
}

writeFileSync(new URL("tei_simler.odd", here), await raw("schema/tei_simler.odd"));
writeFileSync(new URL("simler-tokens.css", here),
  `/* Simler Digital's design tokens: ${REPO}, preview/assets/tokens.css at ${short}. */\n` +
  await raw("preview/assets/tokens.css"));

for (const [name, spec] of Object.entries(EXCERPTS)) {
  const { open, piece, closing } = excerpt(await raw(SOURCES + spec.file), spec);
  const url = new URL(name, here);
  const current = readFileSync(url, "utf8").replace(/\r\n/g, "\n");
  const header = current.slice(0, current.indexOf("</teiHeader>") + "</teiHeader>".length).replace(/Source: [^\n]*\n/, `Source: ${REPO} at ${short}.\n`);
  writeFileSync(url, [header, ...open.map((e) => `  ${e.tag}`), ...piece, ...closing.map((e) => `  </${e.name}>`), "</TEI>", ""].join("\n"));
}

const readme = new URL("README.md", here);
const pin = `[\`${short}\`](https://github.com/${REPO}/tree/${sha}) (${date})`;
writeFileSync(readme, readFileSync(readme, "utf8")
  .replace(/(<!-- sync-odd -->).*?(<!-- \/sync-odd -->)/gs, `$1${pin}$2`));

console.log(`✓ tei_simler.odd, simler-tokens.css and ${Object.keys(EXCERPTS).length} excerpts from ${REPO} at ${short} (${date})`);
