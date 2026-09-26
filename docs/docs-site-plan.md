# Soapay docs site: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a comprehensive, user-facing documentation site for Soapay at `https://soapay.up.railway.app/docs/`, built with Astro Starlight inside the monorepo, and link it from the landing page.

**Architecture:** A new workspace app `apps/docs` (`@soapay/docs`) builds a static Starlight site with `base: "/docs"`. The existing one-origin web service (`scripts/serve-demo.mjs`, built by `scripts/build-demo.sh` inside `scripts/web.Dockerfile`) gains a third mount at `/docs/`, so the docs deploy through the existing Railway workflow with no new service. The company app's landing page points its "Docs" links at `VITE_DOCS_URL` (default `/docs/`). Content is written from the repo's own sources (README, PRD, `docs/*.md`, app READMEs, SDK and contract source) and organised as: Start here, Concepts, Company app, Employee app, Developers, Reference.

**Tech Stack:** Astro 7.3, `@astrojs/starlight` 0.42, `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` 5.3 (self-hosted, like `packages/ui`), Pagefind search (bundled with Starlight), Node 24, pnpm 9, turbo 2.

**Spec:** the approved in-chat design (2026-09-26): Starlight at `/docs/` on the same origin, content map of seven sections, landing links updated, PR to `main`. Threat model and engineering rules in `CLAUDE.md` bind the content.

## Global constraints

- Node `>=24`, pnpm `9.15.0`, turbo `^2.11.4` (root `package.json`). No new root dependencies.
- `@astrojs/check` is NOT used: it needs TypeScript `^5 || ^6` and the repo pins `^7.0.2`. The docs app has no `typecheck` script.
- Content links inside Markdown/MDX are written with the base: `/docs/concepts/threat-model/` (trailing slash, directory format). Starlight prefixes its own generated links (sidebar, header) automatically, but not links inside content.
- Links to the apps stay root-relative: company app `/`, employee app `/app/`, demo `/?demo=1`. The link checker allows exactly these.
- Never use an em dash (U+2014) in any file this plan creates or edits. Use a comma, colon, parentheses or a period. No `--` or en dash as a stand-in.
- Content must not contradict `CLAUDE.md` (threat model, D-52 testnet rules, D-53: no Convert screen in the web employee app). Where an older doc or screenshot conflicts with `CLAUDE.md`, `CLAUDE.md` wins and the page says nothing about the stale feature.
- Every fact on a page comes from a repo source. No invented addresses, amounts, flags or endpoints. If a source is unclear, leave the detail out rather than guess.
- Do not touch `docs/*.md` engineering notes, the pitch, or the recipient app. Surgical changes only in `apps/sender`, `scripts/`, root `README.md`, `CLAUDE.md`, `docs/decision-log.md`.
- Screenshots come only from the committed `docs/demo-screens/*.png`. Do not use the Convert screenshots (`r16`, `r17`, `r18`): D-53 removed that screen.
- Do not include `docs/diagrams/*` (untracked, owner-owned in the main checkout).

## Review focus

1. A docs URL without a trailing slash (`/docs/concepts/threat-model`) must serve the page, not the company app's `index.html`. Pinned by the curl checks in Task 2.
2. An unknown docs URL (`/docs/nope/`) must return Starlight's `404.html` with status 404, not the company app. Pinned in Task 2.
3. A content link written without the base (`/concepts/threat-model/`) would leak users to the company app. Pinned by `scripts/check-links.mjs` in Task 1, which fails the build on any root-relative link outside the allowlist.
4. `VITE_DOCS_URL` unset must still produce a working same-origin link (`/docs/`); set to an absolute URL it must be used verbatim. Pinned in Task 3 (`config.test.ts`).
5. The landing page must have the Docs link in the top bar, the hero and the footer, and none of them may still point at `PRD.md` on GitHub. Pinned in Task 3 (`landing.test.tsx`).

---

## File structure

```
apps/docs/
  package.json                 @soapay/docs: dev/build/preview/test/clean; turbo package config (test dependsOn build)
  astro.config.mjs             site + base "/docs", starlight() options: logo, fonts, sidebar, editLink, social
  tsconfig.json                extends astro/tsconfigs/strict (editor support only)
  README.md                    how to run, where content lives, link rules
  public/favicon.svg           copy of apps/sender/public/favicon.svg
  scripts/check-links.mjs      post-build link checker (internal hrefs resolve; no base-less root links)
  src/content.config.ts        docs collection (docsLoader + docsSchema)
  src/styles/soapay.css        Ledger tokens mapped onto Starlight variables
  src/assets/lockup-navy.svg   logo for light mode (from packages/ui/src/logo/Logo.tsx paths)
  src/assets/lockup-light.svg  logo for dark mode
  src/assets/screens/*.png     copies of selected docs/demo-screens/*.png
  src/content/docs/            one .mdx per page (list in Tasks 4 to 7)
scripts/serve-demo.mjs         + /docs/ mount, directory index, 404.html fallback
scripts/build-demo.sh          + docs build with SITE_ORIGIN
scripts/web.Dockerfile         + docs in the install filter and COPY of apps/docs/dist
apps/sender/src/config.ts      + docsUrl (VITE_DOCS_URL, default "/docs/")
apps/sender/src/App.tsx        passes docsUrl to Landing
apps/sender/src/pages/Landing.tsx  nav "Docs", hero "Read the docs", footer "Docs" use docsUrl
apps/sender/.env.example, apps/sender/README.md   document VITE_DOCS_URL
apps/sender/test/config.test.ts, landing.test.tsx, landingSections.test.tsx   tests
README.md, CLAUDE.md, docs/decision-log.md        docs link, layout row, decision entry
```

---

### Task 1: Scaffold `apps/docs` with Starlight, theme and link checker

**Files:**
- Create: `apps/docs/package.json`, `apps/docs/astro.config.mjs`, `apps/docs/tsconfig.json`, `apps/docs/README.md`, `apps/docs/public/favicon.svg`, `apps/docs/scripts/check-links.mjs`, `apps/docs/src/content.config.ts`, `apps/docs/src/styles/soapay.css`, `apps/docs/src/assets/lockup-navy.svg`, `apps/docs/src/assets/lockup-light.svg`, `apps/docs/src/content/docs/index.mdx`, `apps/docs/src/content/docs/introduction.mdx` (stub, filled in Task 4)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Produces: `pnpm --filter @soapay/docs build` writes `apps/docs/dist/` with `index.html`, `404.html`, `pagefind/`. `pnpm --filter @soapay/docs test` runs the link checker against `dist/`. Later tasks add pages under `src/content/docs/<section>/<slug>.mdx`; the sidebar autogenerates from directories.

- [ ] **Step 1: package.json**

```json
{
  "name": "@soapay/docs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev --port 5175",
    "build": "astro build",
    "preview": "astro preview --port 5175",
    "test": "node scripts/check-links.mjs",
    "clean": "rm -rf dist .astro .turbo"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.42.4",
    "@fontsource/ibm-plex-mono": "^5.3.0",
    "@fontsource/ibm-plex-sans": "^5.3.0",
    "astro": "^7.3.5",
    "sharp": "^0.35.4"
  },
  "turbo": {
    "extends": ["//"],
    "tasks": {
      "test": { "dependsOn": ["build"] }
    }
  }
}
```

`sharp` is Astro's optional image dependency; listing it makes PNG screenshots build deterministically. The turbo package config makes `test` wait for this package's own `build`, because the link checker reads `dist/`.

- [ ] **Step 2: astro.config.mjs**

```js
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// The docs are served at <origin>/docs/ by scripts/serve-demo.mjs, next to the company app (/)
// and the employee app (/app/). build-demo.sh passes the public origin as SITE_ORIGIN.
const site = process.env.SITE_ORIGIN?.replace(/\/$/, "") || "https://soapay.up.railway.app";
const GITHUB = "https://github.com/easonchai/soapay";

export default defineConfig({
  site,
  base: "/docs",
  integrations: [
    starlight({
      title: "Soapay Docs",
      description: "Stealth-address payroll on Base: one name per person, every salary on a fresh address only they can open.",
      logo: { light: "./src/assets/lockup-navy.svg", dark: "./src/assets/lockup-light.svg", replacesTitle: true },
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource/ibm-plex-sans/400.css",
        "@fontsource/ibm-plex-sans/500.css",
        "@fontsource/ibm-plex-sans/600.css",
        "@fontsource/ibm-plex-mono/400.css",
        "./src/styles/soapay.css",
      ],
      social: [{ icon: "github", label: "GitHub", href: GITHUB }],
      editLink: { baseUrl: `${GITHUB}/edit/main/apps/docs/` },
      lastUpdated: true,
      head: [{ tag: "meta", attrs: { name: "theme-color", content: "#1E3A5F" } }],
      sidebar: [
        {
          label: "Start here",
          items: ["introduction", { label: "Getting started", items: [{ autogenerate: { directory: "getting-started" } }] }],
        },
        { label: "Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Company app", items: [{ autogenerate: { directory: "company-app" } }] },
        { label: "Employee app", items: [{ autogenerate: { directory: "employee-app" } }] },
        { label: "Developers", items: [{ autogenerate: { directory: "developers" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
      ],
    }),
  ],
});
```

Autogenerated groups order pages by the `sidebar.order` frontmatter field; every content page sets it.

- [ ] **Step 3: tsconfig.json, content.config.ts**

`apps/docs/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

`apps/docs/src/content.config.ts`:

```ts
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

- [ ] **Step 4: theme CSS**

`apps/docs/src/styles/soapay.css` maps the Direction A Ledger tokens (`packages/ui/src/styles.css`) onto Starlight's variables. Dark values first (Starlight's `:root` is the dark theme), light under `[data-theme='light']`:

```css
/* Soapay docs: Direction A Ledger tokens (packages/ui/src/styles.css) on Starlight's variables. */
:root {
  --sl-font: "IBM Plex Sans", system-ui, sans-serif;
  --sl-font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  /* dark palette */
  --sl-color-accent-low: #1f3552;
  --sl-color-accent: #8fb3e3;
  --sl-color-accent-high: #c9daf0;
  --sl-color-white: #e6eaf0;
  --sl-color-gray-1: #e6eaf0;
  --sl-color-gray-2: #9aa5b4;
  --sl-color-gray-3: #5c6879;
  --sl-color-gray-4: #3a4656;
  --sl-color-gray-5: #263040;
  --sl-color-gray-6: #12181f;
  --sl-color-black: #0b0f14;
}
:root[data-theme="light"] {
  /* light palette: navy accent on a white canvas */
  --sl-color-accent-low: #e4eefa;
  --sl-color-accent: #1e3a5f;
  --sl-color-accent-high: #162c49;
  --sl-color-white: #0f1720;
  --sl-color-gray-1: #0f1720;
  --sl-color-gray-2: #4a5563;
  --sl-color-gray-3: #8a94a3;
  --sl-color-gray-4: #b8c0cb;
  --sl-color-gray-5: #d5dae1;
  --sl-color-gray-6: #eef0f3;
  --sl-color-gray-7: #f4f5f7;
  --sl-color-black: #ffffff;
}
/* 2px radius everywhere, like the apps. */
:root {
  --sl-border-radius: 2px;
}
.sl-markdown-content :is(code, pre, img, .card, .starlight-aside) {
  border-radius: 2px;
}
.site-title img {
  height: 1.5rem;
}
```

- [ ] **Step 5: logo assets and favicon**

Copy `apps/sender/public/favicon.svg` to `apps/docs/public/favicon.svg` unchanged.

`apps/docs/src/assets/lockup-navy.svg` is the `Lockup` from `packages/ui/src/logo/Logo.tsx` with `currentColor` replaced by `#1E3A5F`; `lockup-light.svg` is the same file with `#E6EAF0`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 552 146" role="img" aria-label="Soapay">
  <g transform="translate(-8,-36) scale(4.875)" fill="#1E3A5F">
    <path d="M3 12 a5 5 0 0 1 5 -5 h9 v18 h-9 a5 5 0 0 1 -5 -5 z"/>
    <rect x="19.5" y="8" width="4" height="4" rx="1.4"/>
    <rect x="19.5" y="14" width="4" height="4" rx="1.4"/>
    <rect x="19.5" y="20" width="4" height="4" rx="1.4"/>
    <rect x="25.5" y="11" width="2.5" height="2.5" rx="0.9"/>
    <rect x="25.5" y="18.5" width="2.5" height="2.5" rx="0.9"/>
    <rect x="29.5" y="15" width="1.5" height="1.5" rx="0.55"/>
  </g>
  <g transform="translate(158,0)">
    <g fill="none" stroke="#1E3A5F" stroke-width="12" stroke-linecap="butt" stroke-linejoin="miter">
      <path d="M50 14 C42 4 10 4 10 24 C10 44 50 42 50 62 C50 82 14 84 4 70"/>
      <circle cx="92" cy="52" r="22"/>
      <path d="M150 30 H172 V74 H150 A22 22 0 0 1 150 30 Z"/>
      <path d="M192 30 V112"/>
      <path d="M192 30 H214 A22 22 0 0 1 214 74 H192"/>
      <path d="M278 30 H300 V74 H278 A22 22 0 0 1 278 30 Z"/>
      <path d="M320 30 L342 74"/>
      <path d="M366 30 L336 88"/>
    </g>
    <g fill="#1E3A5F">
      <rect x="328.8" y="91.6" width="7" height="7" transform="rotate(27 332.3 95.1)"/>
      <rect x="324.55" y="102.15" width="5.5" height="5.5" transform="rotate(27 327.3 104.9)"/>
      <rect x="320.7" y="111.8" width="4" height="4" transform="rotate(27 322.7 113.8)"/>
      <rect x="317.1" y="120.2" width="3" height="3" transform="rotate(27 318.6 121.7)"/>
      <rect x="313.9" y="127.8" width="2" height="2" transform="rotate(27 314.9 128.8)"/>
    </g>
  </g>
</svg>
```

- [ ] **Step 6: splash page and a stub**

`apps/docs/src/content/docs/index.mdx`:

```mdx
---
title: Soapay Docs
description: Stealth-address payroll on Base. One name per person, every salary on a fresh address only they can open.
template: splash
hero:
  title: Pay a team without publishing its payroll
  tagline: Soapay pays USDC on Base to fresh stealth addresses. One name per person, one signature per run, nothing a coworker can read back.
  actions:
    - text: Get started
      link: /docs/getting-started/companies/
      icon: right-arrow
    - text: Open the company app
      link: /
      icon: external
      variant: minimal
---

import { Card, CardGrid } from "@astrojs/starlight/components";

<CardGrid stagger>
  <Card title="Companies" icon="seti:csv">
    Paste names and amounts, sign once. [Getting started for companies](/docs/getting-started/companies/).
  </Card>
  <Card title="Employees" icon="open-book">
    Save a recovery kit, claim your name, see every payment. [Getting started for employees](/docs/getting-started/employees/).
  </Card>
  <Card title="Concepts" icon="information">
    Stealth addresses, the coworker threat model and what the chain sees. [Concepts](/docs/concepts/stealth-addresses/).
  </Card>
  <Card title="Developers" icon="setting">
    SDK, CLI, MCP server, API and contracts. [Developer overview](/docs/developers/overview/).
  </Card>
</CardGrid>
```

`apps/docs/src/content/docs/introduction.mdx` (stub so the sidebar entry resolves; Task 4 replaces the body):

```mdx
---
title: Introduction
description: Why Soapay exists and who it is for.
---

Filled in by the content tasks.
```

- [ ] **Step 7: link checker**

`apps/docs/scripts/check-links.mjs`:

```js
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
```

- [ ] **Step 8: README for the app**

`apps/docs/README.md`: purpose (public docs at `/docs/`), commands (`pnpm --filter @soapay/docs dev` on port 5175, `build`, `test` runs the link checker), where pages live (`src/content/docs/<section>/<slug>.mdx`, `sidebar.order` frontmatter), the link rule (write `/docs/...` with a trailing slash; app links `/`, `/app/`), screenshots (`src/assets/screens/`, copied from `docs/demo-screens/`), theming (`src/styles/soapay.css`), and how it is served (`scripts/serve-demo.mjs`, `scripts/build-demo.sh`, `scripts/web.Dockerfile`).

- [ ] **Step 9: install and build**

Run: `pnpm install` (from the repo root of the worktree)
Expected: lockfile updated, `@soapay/docs` linked, no peer warnings about astro.

Run: `pnpm --filter @soapay/docs build && pnpm --filter @soapay/docs test`
Expected: `dist/index.html`, `dist/404.html`, `dist/introduction/index.html`, `dist/pagefind/` exist; the checker reports broken links for the four not-yet-written targets on the splash page (`getting-started/companies`, `getting-started/employees`, `concepts/stealth-addresses`, `developers/overview`). That is the expected red state until Tasks 4 to 7 land. Confirm the checker's exit code is 1 and the messages name exactly those links.

- [ ] **Step 10: commit**

```bash
git add apps/docs pnpm-lock.yaml
git commit -m "docs: scaffold the Starlight docs app at /docs"
```

---

### Task 2: Serve the docs at `/docs/` in the one-origin web service

**Files:**
- Modify: `scripts/serve-demo.mjs` (MOUNTS, `serveStatic`, `sendFile`)
- Modify: `scripts/build-demo.sh`
- Modify: `scripts/web.Dockerfile`

**Interfaces:**
- Consumes: `apps/docs/dist/` from Task 1.
- Produces: `GET /docs/`, `GET /docs/<page>/`, `GET /docs/<page>` (no slash) serve the docs; unknown docs paths get `404.html` with status 404; `/docs` redirects to `/docs/`.

- [ ] **Step 1: serve-demo.mjs**

Replace `MOUNTS` and adjust `sendFile`/`serveStatic`:

```js
const MOUNTS = [
  // Docs first: the most specific prefix must win over "/".
  { prefix: "/docs/", dir: join(ROOT, "apps/docs/dist"), notFound: "404.html" },
  { prefix: "/app/", dir: join(ROOT, "apps/recipient/dist") },
  { prefix: "/", dir: join(ROOT, "apps/sender/dist") },
];
```

```js
function sendFile(res, path, status = 200) {
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  // Hashed assets can be cached; HTML must not be.
  const cache = path.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable";
  res.writeHead(status, { "content-type": type, "cache-control": cache });
  createReadStream(path).pipe(res);
}
```

In `serveStatic`, after the `/app` redirect add `if (url.pathname === "/docs") return res.writeHead(301, { location: "/docs/" }).end();`, and replace the `try` block with:

```js
  try {
    const st = statSync(candidate);
    if (st.isFile()) return sendFile(res, candidate);
    // Static-site directory (the docs build one folder per page): serve its index.
    if (st.isDirectory()) return sendFile(res, join(candidate, "index.html"));
  } catch {
    /* fall through */
  }
  // A static site has a real 404 page; the SPAs fall back to their entry (hash routing).
  if (mount.notFound) return sendFile(res, join(mount.dir, mount.notFound), 404);
  sendFile(res, join(mount.dir, "index.html"));
```

Update the header comment and the startup log line to mention `docs /docs/`.

- [ ] **Step 2: build-demo.sh**

After the sender build line add:

```bash
SITE_ORIGIN="$ORIGIN" pnpm --filter @soapay/docs exec astro build
echo "built for $ORIGIN (company /, employee /app/, docs /docs/, api /api)"
```

(replace the existing echo). Update the header comment to list the docs mount.

- [ ] **Step 3: web.Dockerfile**

Install filter: `RUN pnpm install --frozen-lockfile --filter "@soapay/recipient..." --filter "@soapay/sender..." --filter "@soapay/docs..."`.
Runtime stage: add `COPY --from=build /repo/apps/docs/dist apps/docs/dist` after the sender COPY. Update the top comment.

- [ ] **Step 4: verify locally**

Run (from the worktree root):

```bash
bash scripts/build-demo.sh http://127.0.0.1:4300
PORT=4300 node scripts/serve-demo.mjs &
sleep 1
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:4300/docs
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/docs/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/docs/introduction/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/docs/introduction
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/docs/nope/
curl -s http://127.0.0.1:4300/docs/nope/ | grep -c "Page not found"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/app/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4300/
kill %1
```

Expected: `301 http://127.0.0.1:4300/docs/`, `200`, `200`, `200`, `404`, `1`, `200`, `200`.

- [ ] **Step 5: commit**

```bash
git add scripts/serve-demo.mjs scripts/build-demo.sh scripts/web.Dockerfile
git commit -m "web: serve the docs at /docs/ next to the apps"
```

---

### Task 3: Landing page links to the docs

**Files:**
- Modify: `apps/sender/src/config.ts` (AppConfig, `recipientAppUrls`), `apps/sender/src/App.tsx:314-316`, `apps/sender/src/pages/Landing.tsx`
- Modify: `apps/sender/.env.example`, `apps/sender/README.md`
- Test: `apps/sender/test/config.test.ts`, `apps/sender/test/landing.test.tsx`, `apps/sender/test/landingSections.test.tsx`

**Interfaces:**
- Produces: `AppConfig.docsUrl: string`; `recipientAppUrls(env)` returns `{ recipientUrl, otherAppUrl, docsUrl }`; `LandingProps.docsUrl: string`.

- [ ] **Step 1: failing config test**

Append to the `env names` describe block in `apps/sender/test/config.test.ts`:

```ts
  it("links the docs at /docs/ by default, or VITE_DOCS_URL", () => {
    expect(recipientAppUrls(env({})).docsUrl).toBe("/docs/");
    expect(recipientAppUrls(env({ VITE_DOCS_URL: "https://docs.example/" })).docsUrl).toBe("https://docs.example/");
  });
```

- [ ] **Step 2: failing landing tests**

In `apps/sender/test/landing.test.tsx`, add `docsUrl="/docs/"` to the `mount` helper's `<Landing ...>` and add:

```ts
  it("links the docs from the top bar, the hero and the footer, never to PRD.md", () => {
    mount([{ id: "a", name: "MetaMask", icon: ICON }]);
    const docs = screen.getAllByRole("link", { name: /^(docs|read the docs)$/i });
    expect(docs.length).toBe(3);
    for (const l of docs) expect(l.getAttribute("href")).toBe("/docs/");
    expect(document.querySelector('a[href*="PRD.md"]')).toBeNull();
  });
```

In `apps/sender/test/landingSections.test.tsx`, add `docsUrl="/docs/"` to the `<Landing ...>` render (line 20 area).

Run: `pnpm --filter @soapay/sender exec vitest run test/config.test.ts test/landing.test.tsx test/landingSections.test.tsx`
Expected: FAIL (type error on `docsUrl` and the new assertions).

- [ ] **Step 3: config.ts**

Add to `AppConfig` after `otherAppUrl`:

```ts
  /** Docs site URL for the landing page links (VITE_DOCS_URL). Default: same origin, /docs/. */
  docsUrl: string;
```

Change `recipientAppUrls`:

```ts
export function recipientAppUrls(env: ImportMetaEnv = import.meta.env): { recipientUrl: string; otherAppUrl: string; docsUrl: string } {
  const recipientUrl = envString(env.VITE_RECIPIENT_URL) ?? "http://localhost:5173";
  // The docs are a static site served next to the apps (scripts/serve-demo.mjs), so the default is same-origin.
  return { recipientUrl, otherAppUrl: envString(env.VITE_OTHER_APP_URL) ?? recipientUrl, docsUrl: envString(env.VITE_DOCS_URL) ?? "/docs/" };
}
```

- [ ] **Step 4: App.tsx and Landing.tsx**

`App.tsx`: add `docsUrl={app.docsUrl}` to the `<Landing` element.

`Landing.tsx`:
- `LandingProps` gains `/** The docs site (VITE_DOCS_URL, default /docs/). */ docsUrl: string;` and the function signature destructures it.
- Top bar links: insert before the GitHub link:
  ```tsx
          <a href={docsUrl}>Docs</a>
  ```
- Hero: replace the `Read the docs` anchor with `<a className="btn btn-xl" href={docsUrl}>Read the docs</a>` (same origin, so no `target`/`rel`).
- Footer: replace the `Docs` anchor with `<a href={docsUrl}>Docs</a>`.
- Update the file's JSDoc line for `Landing` to mention the docs link.

- [ ] **Step 5: env docs**

`apps/sender/.env.example`, after the `VITE_OTHER_APP_URL` block:

```
# Docs site for the landing page's "Docs" links. Empty = same origin, /docs/ (scripts/serve-demo.mjs).
VITE_DOCS_URL=
```

`apps/sender/README.md`, in the env paragraph near line 79: add one sentence: "`VITE_DOCS_URL` sets the landing page's Docs links (default `/docs/`, the docs site served next to the apps)."

- [ ] **Step 6: run tests**

Run: `pnpm turbo run test typecheck --filter=@soapay/sender`
Expected: all sender tests pass (184 before, 186 after), typecheck clean.

- [ ] **Step 7: commit**

```bash
git add apps/sender
git commit -m "sender: landing links point at the docs site"
```

---

### Task 4: Content, part A: Start here and Concepts

**Files (create, all under `apps/docs/src/content/docs/`):**
- `introduction.mdx` (replace the stub)
- `getting-started/companies.mdx`, `getting-started/employees.mdx`, `getting-started/testnet.mdx`
- `concepts/stealth-addresses.mdx`, `concepts/threat-model.mdx`, `concepts/what-the-chain-sees.mdx`, `concepts/names.mdx`, `concepts/denominated-payouts.mdx`, `concepts/compliant-exit.mdx`, `concepts/key-rotation-and-recovery.mdx`
- Copy screenshots used into `apps/docs/src/assets/screens/` (from `docs/demo-screens/`).

**Sources:** `README.md` (Who sees what you earn, Built for payroll, Not another stealth wallet, Threat model, How it works, ENSv2, World ID, Roadmap, Known gaps), `CLAUDE.md` (threat model, D-52), `PRD.md`, `docs/privacy-model.md`, `docs/mvp-spec.md`, `docs/architecture.md`, `docs/testnet-deployment.md`, `docs/demo-flow.md`, `docs/worldid.md`, `docs/exit-research.md`, `docs/privacy-pools-v2.md`.

**Frontmatter for every page:** `title`, `description` (one sentence), `sidebar: { order: N }` (N = position in its folder, from 1).

**Page outlines:**
- `introduction`: the problem (every wallet address is a public bank statement), what Soapay does in three sentences, who it is for (companies paying a team, anyone paid on chain), "who sees what you earn" as a table (employer, coworker, chain analyst, you), built for payroll and ready for any payout (dividends, grants, bounties), not another stealth wallet (why the sender side matters), where to go next (links to both getting-started pages and Concepts).
- `getting-started/companies`: prerequisites (a wallet on Base Sepolia for the demo: EOA, smart wallet or Safe; browser), 6 to 8 numbered steps from opening the company app to a signed run, each with the exact button text from the app and a screenshot (`s02` to `s11`), the demo door (`/?demo=1`) for a look without a wallet, the welcome drop on Base Sepolia, "what happened on chain" in one paragraph, next steps (Company app guide, Concepts).
- `getting-started/employees`: prerequisites (invite link from the employer, or open `/app/`), steps: recovery kit, lock and passkey, register, claim a name, optional World ID, share, first payment in the ledger (`r00` to `r08`), what to keep safe (the recovery phrase), next steps.
- `getting-started/testnet`: D-52 in plain words: mock USDC (address, "not Circle's"), the one-time welcome drop, sponsored gas for stealth spends and smart-wallet employers, EOAs need a little Base Sepolia ETH, the exit is hidden on testnet and why (CCTP needs Circle USDC), mainnet differences (Circle USDC, Circle paymaster), live URLs. Use an `Aside` for "never change mainnet paths for the demo" style warnings only if they are user-facing.
- `concepts/stealth-addresses`: ERC-5564 and ERC-6538 in plain words, meta-address, ephemeral key, view tag, stealth address, the Announcer, the Registry, how a recipient scans (recompute, check real balances, never trust metadata), why the sender never learns the spending key, links to the EIPs.
- `concepts/threat-model`: the coworker adversary (knows their own line, sees the batch, likely knows colleagues' main wallets), the employer is trusted, ENS is only a reference identifier (meta-address pinned at enrollment, alert on change), out of scope for v1 (chain analysts, RPC/bundler linkage), why the compliant exit is in scope. Exact wording from `CLAUDE.md`.
- `concepts/what-the-chain-sees`: a walk through one pay run as seen on the explorer: the StealthDisperse transaction, the announcements, the metadata layout `viewTag(1) | transfer selector(4) | token(20) | amount(32) | payer(20)` and why the payer is appended, strictly ascending stealth addresses (dedupe and a guard, not a privacy guarantee), multi-tx runs sorted globally (never partitioned by employee), the 350-line cap, the small-team warning, the guarantees list from the landing page.
- `concepts/names`: `<label>.soapay.eth` on ENSv2, how a name is claimed, what the stealth meta-address record is, resolution in the company app, pinning and rotation alerts, agents get names too (MCP), Sepolia specifics.
- `concepts/denominated-payouts`: chunks (company-wide chunk size, 500 USDC mainnet default, 5 on testnet), why identical lines protect salaries, the remainder line, the consolidation guard at spend time (coworker-known wallets identifiable by default), the open issue that consolidating reveals the salary.
- `concepts/compliant-exit`: why a screened exit is needed (a coworker knows your main wallet), Privacy Pools via CCTP, what is live and what is hidden on testnet, fees and minimums as documented in `docs/testnet-deployment.md` and D-48, honest limits.
- `concepts/key-rotation-and-recovery`: rotating the meta-address, MetaRotation attestation and the pinned attester, World ID verified recovery (what World ID proves, what it does not), what the employer sees on rotation.

- [ ] **Step 1: write the pages** from the sources above, with screenshots where listed (`![alt](../../assets/screens/s07-sender-payrun.png)` style paths).
- [ ] **Step 2: build and check links**

Run: `pnpm --filter @soapay/docs build && pnpm --filter @soapay/docs test`
Expected: build ok; the checker may still report the `developers/overview` splash link until Task 6 lands, nothing else.

- [ ] **Step 3: commit**

```bash
git add apps/docs/src
git commit -m "docs: start here and concepts"
```

---

### Task 5: Content, part B: Company app and Employee app guides

**Files (create):**
- `company-app/overview.mdx`, `company-app/recipients-and-invites.mdx`, `company-app/pay-run.mdx`, `company-app/review-and-sign.mdx`, `company-app/history.mdx`, `company-app/settings.mdx`
- `employee-app/overview.mdx`, `employee-app/keys-and-recovery.mdx`, `employee-app/onboarding.mdx`, `employee-app/ledger.mdx`, `employee-app/send.mdx`, `employee-app/exit.mdx`, `employee-app/rotation.mdx`

**Sources:** `apps/sender/README.md`, `apps/sender/src/pages/*.tsx` (labels and flows), `apps/sender/src/lib/csv.ts` (CSV columns), `apps/sender/src/lib/safeExport.ts`, `apps/recipient/README.md`, `apps/recipient/src` screens, `docs/demo-flow.md`, `docs/mvp-spec.md` §7 (invites), `CLAUDE.md` (sender-app invariants, D-53).

**Page outlines:**
- Company app `overview`: login with a wallet (which connectors), the vault gate (what the vault protects and why the passphrase matters), the demo door, top bar (Receive link, company name), the Base Sepolia welcome drop.
- `recipients-and-invites`: adding a recipient by name, invite links (`/#/join?code=...&label=...&org=...`), QR, pinning the meta-address, what a rotation looks like and when approval is needed (attested vs manual), recipient detail.
- `pay-run`: paste or CSV (exact columns and an example), resolving names, denominated lines and the chunk size, warnings (small team, unresolved names), limits (350 lines per tx, global sort).
- `review-and-sign`: the three pay paths and how the app picks one: EOA via `StealthDisperse` (approve then pay, or permit), smart account via an EIP-5792 atomic batch (sponsored on testnet), Safe export (`MultiSendCallOnly`, never `MultiSend`); what "sign for the exact total" means; retries after a reverted chunk; unknown status after a reload.
- `history`: runs, per-line status, the coworker view versus "my view" panel (what a coworker can and cannot see), receipts and explorer links.
- `settings`: chain, StealthDisperse address, RPC URLs (per browser, localStorage, no secrets), company name, chunk size, reset.
- Employee app `overview`: what the app is (`/app/`), what it never does (keys never leave the client, no telemetry), screens at a glance.
- `keys-and-recovery`: recovery phrase as a recovery kit (D-44), passkey unlock, what to do if the phrase leaks (rotate), device loss.
- `onboarding`: welcome, phrase, lock, passkey, register (relayed registration, gas free), name claim, World ID (optional), share.
- `ledger`: scanning announcements, view tags, real balances, statuses (received, ready, spent), labels.
- `send`: guarded Send (the consolidation guard: what blocks, what warns, how to proceed), gas-sponsored spends via 7702 and the paymaster, review and done states.
- `exit`: the compliant exit, hidden on testnet, the plan and done states from screenshots `r12`, `r13`, fees and minimums, when to use it.
- `rotation`: rotate the meta-address, World ID step, what the employer sees, recovery after a stolen phrase.

- [ ] **Step 1: write the pages**, screenshots `s03` to `s13`, `r00` to `r15`, `r19` to `r22` (never `r16` to `r18`).
- [ ] **Step 2: build and check**

Run: `pnpm --filter @soapay/docs build && pnpm --filter @soapay/docs test`
Expected: build ok, no new checker problems.

- [ ] **Step 3: commit**

```bash
git add apps/docs/src
git commit -m "docs: company app and employee app guides"
```

---

### Task 6: Content, part C: Developers

**Files (create):**
- `developers/overview.mdx`, `developers/sdk.mdx`, `developers/cli.mdx`, `developers/mcp.mdx`, `developers/api.mdx`, `developers/contracts.mdx`, `developers/examples.mdx`, `developers/integrate.mdx`

**Sources:** root `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `packages/sdk/README.md` and `packages/sdk/src`, `apps/cli`, `apps/mcp/README.md` and `src`, `apps/api/README.md` and `src`, `contracts/PLAN.md`, `contracts/src/*.sol`, `examples/`, `docs/mvp-spec.md`, `docs/bounty-integrations.md`, `.claude/memory/scopelift-sdk-esm-quirk.md`, `CLAUDE.md` (engineering rules).

**Page outlines:**
- `overview`: what is in the monorepo (table like `CLAUDE.md` Layout), install and commands (`git submodule update --init --recursive`, `pnpm install`, `build`, `test`, `typecheck`, `dev`, ports 5173/5174/8787/5175), env files, the engineering rules that matter to integrators (protocol logic only from the SDK, keys never leave the client, no custom contract holds funds).
- `sdk`: install, the ScopeLift ESM quirk (bundle, inline or tsx), then a reference grouped by module (derivation, registry, announce, scan, spend, names, exit, swap, config) with exact signatures from `packages/sdk/src` and short snippets from the README or tests; constants and default addresses.
- `cli`: `soapay distribute` (CSV format, dry run default, `--execute`, flags, env) and `soapay scan`, with example output.
- `mcp`: what agents get (`<label>.soapay.eth`, ENSIP-26 records), each tool with inputs and outputs, a client configuration snippet (command and env), safety notes.
- `api`: route table (method, path, purpose) then each route with request and response shapes and errors; env vars; deployment (Dockerfile, Railway).
- `contracts`: `StealthDisperse` interface (functions, events, errors), the invariants (pull with transferFrom, canonical Announcer, strictly ascending, holds no funds), `payWithPermit` and ERC-1271 notes, `MockUSDC` (testnet only), addresses per chain, `forge build`/`forge test`, fork tests with `BASE_RPC_URL`.
- `examples`: `dividend-run.ts`, `grant-round.ts`, the pluggable demo (`scripts/demo-pluggable.sh`), how to run each.
- `integrate`: recipes that the code supports today: pay a list of names from your own app (SDK), scan and spend, issue a subname, pay from a Safe. Mark anything not supported as such.

- [ ] **Step 1: write the pages.**
- [ ] **Step 2: build and check**

Run: `pnpm --filter @soapay/docs build && pnpm --filter @soapay/docs test`
Expected: build ok, checker green if Task 4 has landed.

- [ ] **Step 3: commit**

```bash
git add apps/docs/src
git commit -m "docs: developer section"
```

---

### Task 7: Content, part D: Reference

**Files (create):**
- `reference/addresses.mdx`, `reference/environment.mdx`, `reference/architecture.mdx`, `reference/compared.mdx`, `reference/faq.mdx`, `reference/roadmap.mdx`

**Sources:** `README.md` (badges, Compared with Fluidkey, Roadmap, Known gaps, Tests), `docs/testnet-deployment.md`, `docs/architecture.md`, `docs/decision-log.md`, `apps/*/.env.example`, `CLAUDE.md` (open issues).

**Page outlines:**
- `addresses`: tables per chain (Base Sepolia, Base mainnet, Ethereum Sepolia for ENSv2): StealthDisperse, mock USDC, Circle USDC, canonical Registry and Announcer, attester, with explorer links.
- `environment`: one table per app (sender, recipient, api, cli, mcp, docs) from the `.env.example` files: variable, meaning, default.
- `architecture`: components and data flow in prose and a text diagram (no image): company app, employee app, api, SDK, contracts, ENSv2, World ID, Privacy Pools; where trust sits; what runs where (Railway services).
- `compared`: the Fluidkey comparison table from the README, plus one paragraph on why the sender side matters.
- `faq`: 15 to 25 questions grounded in the sources (privacy limits, fees, wallets, Safes, testnet, names, recovery, agents).
- `roadmap`: roadmap items, known gaps, open issues from the PRD review, and a short list of decision IDs (D-31, D-44, D-45, D-52, D-53 and others cited) with one line each, linking to `docs/decision-log.md` on GitHub.

- [ ] **Step 1: write the pages.**
- [ ] **Step 2: build and check**

Run: `pnpm --filter @soapay/docs build && pnpm --filter @soapay/docs test`
Expected: build ok, checker green.

- [ ] **Step 3: commit**

```bash
git add apps/docs/src
git commit -m "docs: reference section"
```

---

### Task 8: Repo docs, full verification, visual check

**Files:**
- Modify: `README.md` (line 13: add the docs URL to the live demo line; Documents list: add "Docs site"), `CLAUDE.md` (Layout row for `apps/docs`; Commands: dev port 5175), `docs/decision-log.md` (new D entry: docs site on Starlight at /docs/, type engineering, decided by owner 2026-09-26, why: one origin, no new service, static)

- [ ] **Step 1: edits above.** Keep each to the minimum lines.
- [ ] **Step 2: full gates**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: all green, including `forge test` and the docs link checker.

- [ ] **Step 3: visual check**

Run: `bash scripts/build-demo.sh http://127.0.0.1:4300 && PORT=4300 node scripts/serve-demo.mjs`
Open `http://127.0.0.1:4300/docs/` and `http://127.0.0.1:4300/` in the browser: splash renders with the lockup, IBM Plex, navy accent; light and dark both readable; search returns pages; sidebar shows the six groups in order; the landing page's three Docs links open the docs.

- [ ] **Step 4: scan for em dashes and stale claims**

Run: `grep -rn $'—' apps/docs/src scripts/serve-demo.mjs scripts/build-demo.sh apps/sender/src/pages/Landing.tsx apps/sender/src/config.ts docs/docs-site-plan.md`
Expected: no output.

Run: `grep -rni "convert\|swap" apps/docs/src/content/docs/employee-app apps/docs/src/content/docs/getting-started`
Expected: no page describes a Convert screen in the web employee app (SDK and MCP swap mentions live only under developers).

- [ ] **Step 5: commit**

```bash
git add README.md CLAUDE.md docs/decision-log.md
git commit -m "docs: link the docs site from the README and CLAUDE.md"
```

---

### Task 9: Pull request

- [ ] Push `marcus/docs-site` and open a PR to `main` with `gh pr create`: summary, what changed per area, how it is served, verification results (test counts), screenshots of the splash page, and a `## TL;DR` section at the end as `CLAUDE.md` requires, followed by the Claude Code footer.
