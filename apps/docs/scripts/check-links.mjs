#!/usr/bin/env node
// Post-build link check for the docs (base: /docs). Fails when an internal href does not resolve to a
// built file, or when a content link is root-relative without the base (it would leave the docs and
// land on the company app). Allowed root links: the two apps and the demo door.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const BASE = "/docs";
const DIST = new URL("../dist/", import.meta.url).pathname;
const ALLOW_ROOT = new Set(["/", "/app/", "/?demo=1"]);

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

/** True when a /docs/... href maps to a built file (directory index, plain file or .html). */
function resolves(href) {
  const path = href.slice(BASE.length).split(/[?#]/)[0];
  const candidates = path.endsWith("/")
    ? [join(DIST, path, "index.html")]
    : [join(DIST, path), join(DIST, path, "index.html"), join(DIST, `${path}.html`)];
  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

if (!existsSync(DIST)) {
  console.error("check-links: no dist/, run `astro build` first");
  process.exit(1);
}
const problems = [];
let checked = 0;
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (!href.startsWith("/")) continue; // external, relative or anchor
    const bare = href.split(/[?#]/)[0] || "/";
    if (href.startsWith(`${BASE}/`) || href === BASE) {
      checked++;
      if (!resolves(href)) problems.push(`${relative(DIST, file)}: broken ${href}`);
    } else if (!ALLOW_ROOT.has(href) && !ALLOW_ROOT.has(bare)) {
      problems.push(`${relative(DIST, file)}: root link without base ${href}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`check-links: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check-links: ${checked} internal links ok`);
