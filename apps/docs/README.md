# @soapay/docs

The public documentation site, built with [Astro Starlight](https://starlight.astro.build/). It is served at
`<origin>/docs/` next to the company app (`/`) and the employee app (`/app/`) by `scripts/serve-demo.mjs`,
built by `scripts/build-demo.sh` inside `scripts/web.Dockerfile`, and deployed by the existing Railway workflow.
Live: [soapay.up.railway.app/docs/](https://soapay.up.railway.app/docs/).

## Commands

```bash
pnpm --filter @soapay/docs dev      # http://localhost:5175/docs/
pnpm --filter @soapay/docs build    # static site in dist/
pnpm --filter @soapay/docs test     # link checker over dist/ (turbo builds first)
```

`pnpm build` and `pnpm test` at the repo root include this package through turbo.

## Writing pages

- One `.mdx` per page under `src/content/docs/<section>/<slug>.mdx`. The sidebar groups autogenerate from the
  section folders (`astro.config.mjs`); each page sets `sidebar: { order: N }` in its frontmatter.
- Every fact comes from a repo source (README, PRD, `docs/*.md`, app READMEs, SDK and contract source). No guesses.
- Internal links include the base and a trailing slash: `/docs/concepts/threat-model/`. Starlight prefixes the
  links it generates itself, not the ones inside content. Links to the apps stay root-relative: `/`, `/app/`,
  `/?demo=1`. `scripts/check-links.mjs` fails the build on a broken link or a root link without the base.
- Screenshots live in `src/assets/screens/` (copied from `docs/demo-screens/`) and are embedded with relative
  paths, so Astro optimises them.
- No em dashes anywhere. Use a comma, colon, parentheses or a period.

## Theming

`src/styles/soapay.css` maps the Direction A Ledger tokens (`packages/ui/src/styles.css`: navy `#1E3A5F`, IBM Plex,
2px radius) onto Starlight's variables. IBM Plex is self-hosted through `@fontsource`, like the apps. The logo is
the `packages/ui` lockup as two SVGs (`src/assets/lockup-navy.svg` for light mode, `lockup-light.svg` for dark).

## Type checking

There is no `typecheck` script: `@astrojs/check` needs TypeScript 5 or 6 and the repo pins TypeScript 7. The
build itself validates the content schema.
