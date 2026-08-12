# HANDOFF

Running log for humans picking this repo up: decisions taken, things that needed
working around, and anything worth double-checking. Newest entries at the bottom of
each section. See PLAN.md for the full architecture rationale and ROADMAP.md for
sequencing.

## Decisions taken

- **Route injection over generated Markdown**, per PLAN.md decision 1. The mechanism
  is lifted from starlight-openapi (verified in its source, commit cloned 2026-08-12):
  injected `[...slug]` route → `StarlightPage` with a `headings` prop → ToC; sidebar
  placeholder swapped in route middleware; Pagefind indexes the standard shell.
- **`@astrojs/markdown-remark` pinned as a direct dependency** for docstring prose
  instead of the host pipeline. starlight-openapi has moved to
  `@astrojs/markdown-satteri` on its main branch; astro 7.0.x still depends on
  `@astrojs/markdown-remark@7.x`, which is what we target. Worth revisiting when the
  Astro markdown package rename settles.
- **Dumps stay on disk**; virtual modules carry config + paths only. starlight-openapi
  inlines parsed schemas into virtual modules, which would be megabytes here.
- **Anchors are dotted object paths** (`mypkg.Report.generate`), matching mkdocstrings,
  so published/consumed Sphinx inventories interoperate without a mapping layer.
- **`griffe check` has no JSON output** (verified: oneline/verbose/markdown/github/azdo
  only), so the stretch version-annotations feature diffs full dumps between git refs
  rather than parsing `griffe check`.

## Environment notes (this sandbox)

- `uvx --from griffe griffe dump` works here (~0.8 s cold) and PyPI is reachable
  through the proxy, as is the npm registry. **docs.python.org is not reachable**
  (curl exit 000), so inventory tests use checked-in fixtures and a local HTTP
  server; nothing in the test suite fetches external doc sites.
- `griffe-pydantic` works fully statically (`uvx --with griffe-pydantic --from griffe
griffe dump -e griffe_pydantic …`) — the fixture model gets the `pydantic-model`
  label without pydantic importable. Verified 2026-08-12 with griffe resolved by uv.
- Playwright must use the pre-installed Chromium at `/opt/pw-browsers/chromium`
  (config handles the fallback), and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set —
  don't run `playwright install` here.

## Things to double-check before release (human review requested)

- The npm trusted publisher (OIDC) must be configured on npmjs.com after the first
  manual publish; the release workflow assumes it exists. Nothing has been published
  from this session (per instructions: no npm publish, no GitHub release).
- Peer range for `@astrojs/starlight` is set to `>=0.41.0` matching what the code
  actually uses (`StarlightPage`, `route-data` middleware, `i18n:setup`); if you
  target older Starlight, the middleware import path differs.
- griffe version drift: dumps were generated with the griffe version uv resolved on
  2026-08-12. `pnpm gen:dumps` regenerates; the `runner-live` test guards drift but
  only runs where uv is available.

## Stuck points and workarounds

- eslint's `astro/no-prerender-export-outside-pages` rejects
  `export const prerender = true` in injected-route `.astro` files (they live in the
  package, not `src/pages`). The `prerender: true` flag on `injectRoute` is
  sufficient — verified the built output prerenders — so the export is omitted.

## Progress log

- 2026-08-12: planning docs committed; workspace scaffolded (mirrors starlight-quiz;
  `pnpm install`, `lint`, `typecheck`, docs build all green in-sandbox); spike passed
  — injected route + StarlightPage `headings` prop feeds the ToC with dotted-path
  anchors intact, Pagefind indexes the pages, middleware sidebar swap works
  (details in PLAN.md decision 1).
