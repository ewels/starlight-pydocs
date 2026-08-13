# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in
this repository.

`starlight-pydocs` is a published npm package (in `packages/starlight-pydocs`) that
generates Python API reference documentation for Astro and Starlight sites. It
extracts the API surface with [Griffe](https://mkdocstrings.github.io/griffe/) as a
subprocess (`griffe dump -f -d <style>`) and renders it with Astro components on
injected routes. It is the Starlight counterpart of mkdocstrings-python and follows
its conventions where sensible (anchor scheme, member filtering, `::: name` becomes
`<Autodoc name="…" />`).

Read `PLAN.md` for architecture decisions and their reasoning, `ROADMAP.md` for the
work sequence, `HANDOFF.md` for the running log of decisions and known rough edges.

## Repository layout

A pnpm workspace:

- `packages/starlight-pydocs`: the published package (the only thing shipped to npm).
- `docs`: a Starlight site (`starlight-pydocs-docs`) that dogfoods the plugin and
  doubles as the fixture for the end-to-end tests. It documents all three fixture
  packages: `demopkg` (extracted through uvx, google docstrings, pydantic,
  deprecations, inheritance, `__all__`), `numpkg` (numpy docstrings) and `sphpkg`
  (sphinx docstrings from a pre-generated dump, so the no-extraction path is built
  too). The Playwright configuration lives here and owns both sites.
- `examples/vanilla`: a plain Astro site proving the no-Starlight path, pinned to the
  unified markdown pipeline so CI renders docstrings through both engines; also an e2e
  fixture.
- `fixtures/`: Python fixture packages plus checked-in `griffe dump` JSON for each
  (so tests never require Python), regenerated with `pnpm gen:dumps` (needs `uv`), and
  `fixtures/inventories/`, a small checked-in `objects.inv` standing in for CPython's,
  written by `pnpm gen:inventory`, so external annotation links are testable offline.

## Commands

Run from the repo root unless noted. Node >= 22.12, pnpm 10.33.

| Task                         | Command                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| Unit tests (Vitest)          | `pnpm test`                                                          |
| A single test file           | `pnpm --filter starlight-pydocs exec vitest run tests/model.test.ts` |
| Watch / coverage             | `pnpm --filter starlight-pydocs test:watch` · `… test:coverage`      |
| End-to-end (Playwright)      | `pnpm test:e2e` (builds + previews docs and vanilla example)         |
| Type-check everything        | `pnpm typecheck`                                                     |
| Lint / format                | `pnpm lint` · `pnpm format`                                          |
| All checks (as CI runs them) | `prek run --all-files`                                               |
| Dev server / build docs      | `pnpm dev` · `pnpm build` · `pnpm preview`                           |
| Regenerate fixture dumps     | `pnpm gen:dumps` (requires `uv` on PATH)                             |
| Regenerate the inventory     | `pnpm gen:inventory`                                                 |

`prek.toml` defines the prettier → eslint → typecheck hooks; `prek install` wires the
git pre-commit hook and CI runs the exact same `prek run --all-files`. There is no
build step for the package: it ships its `.ts`/`.astro` source and is consumed and
transpiled by the host Astro project.

Playwright uses the pre-installed Chromium at `/opt/pw-browsers/chromium` when present
(this environment), else a managed download. `docs/playwright.config.ts` has one
`webServer` entry per site (the docs site on port 4321 under base `/starlight-pydocs`,
the vanilla example on 4322) and one project per site, each running only the specs in
its own `testDir` (`docs/tests/e2e/docs`, `docs/tests/e2e/vanilla`). Both entries set
`ASTRO_PREVIEW_BACKGROUND=1`, which stops `astro preview` daemonising itself when it
detects an agentic environment (Playwright would see the command exit immediately).

## Architecture

### The core idea: Griffe JSON in, injected routes out

`griffe dump -f -d <style>` produces a full JSON model of a Python package without
importing it (static analysis; `--search` points at source dirs). Both flags matter:
without `-f` there are no file paths or visibility flags, without `-d` docstrings stay
as raw text instead of structured sections. The runner (`lib/runner.ts`) resolves, in
order: an explicit `runner.command`, a pre-generated dump (`source.file`/`source.url`),
`uvx --from griffe`, `python -m griffe`. Dumps cache to `node_modules/.astro` keyed on
argv + source file mtimes; they are large (megabytes) and are never sent to the
browser or inlined into virtual modules: `virtual:starlight-pydocs/context` carries
config and dump paths only, and `lib/data.ts` parses lazily server-side.

**A package entry is identified by its `base`, never by its import name.** Bases are
validated unique and non-overlapping, names are not: the same package may be
documented at several bases, one release at each (PLAN.md decision 11). Dump and
sidecar maps, the model cache, route props, endpoint matching and every context
lookup are keyed by base; `name` is only the dump key and what a human types.
`<Autodoc>`/`<SymbolSearch>` resolve their `package` prop as a base first, an import
name second, and refuse an ambiguous name with the candidate bases listed.

Pages are injected routes (`[...slug]` per package), not generated Markdown (see
PLAN.md decision 1). Under Starlight the route renders
`@astrojs/starlight/components/StarlightPage.astro` with `{ frontmatter, headings }`
props (that is what feeds the ToC; Pagefind indexes the standard shell it renders).
The sidebar is a placeholder group (`pydocsSidebarGroup`) swapped for generated links
in route middleware, mirroring starlight-openapi. Vanilla Astro gets the same routes
with a minimal built-in layout.

### Two consumption modes

- **Starlight plugin**: the default export of `index.ts`.
- **Vanilla integration**: `starlight-pydocs/astro`; `<Autodoc>` and the component
  set come from `starlight-pydocs/components` and take label props for i18n.

Hard rule: **`lib/` never imports `astro` or `@astrojs/starlight`**, and
**components never import `@astrojs/starlight`** (they must work in vanilla Astro;
we render our own anchor headings rather than Starlight's `AnchorHeading`).
Starlight glue is isolated in `index.ts`, `libs/starlight.ts`, `middleware.ts` and
`routes/starlight.astro`. `libs/integration.ts`, `libs/vite.ts`,
`libs/docstring-renderer.ts` and `libs/route.ts` are shared by both hosts and may
import Astro types but never Starlight.

### Model layer

`lib/model.ts` normalises the dump once per process: alias resolution (`is_imported`
members with `target_path`), member filtering (`__all__` wins, then `is_public`, then
user include/exclude globs), inheritance merged from resolvable bases with provenance,
overloads, the page plan (one page per module) and the symbol index (canonical path →
page + anchor). Heading anchors are the dotted object path (`mypkg.Report.generate`),
deliberately matching mkdocstrings so Sphinx inventories interoperate both ways.
Annotations are expression trees (`ExprName`/`ExprSubscript`/…), walked by
`lib/expr.ts`; names resolve through the scope chain, then builtins, then configured
Sphinx inventories (`lib/inventory.ts` handles objects.inv in both directions).

### Docstring prose

Rendered through **the host's configured markdown processor**
(`astroConfig.markdown.processor.createRenderer(...)`: Sätteri on current Astro,
`unified()` where the site pins it, with a Starlight-style optional-peer fallback
to `@astrojs/markdown-remark` for Astro 7.0.x). The package depends on neither
engine and registers no remark/rehype/mdast/hast plugin anywhere. Because the live
processor exists only in the config-time process, all docstring Markdown is
pre-rendered at `astro:config:done` (after every integration has mutated
`processor.options`) into a sidecar JSON beside the cached dump; components consume
pre-rendered HTML via `set:html`. See PLAN.md decision 7. Do not build on the
deprecated top-level `markdown.remarkPlugins`/`rehypePlugins`/`remarkRehype`/`gfm`/
`smartypants` options anywhere, including docs and fixtures.

### Version annotations

`versions: { refs: [{ ref, label }] }` per package, oldest first, badges each object
with the release it appeared in (PLAN.md decision 12). The split matters:
`lib/versions.ts` is pure (collect object paths from a dump, first-seen diff over the
snapshots, documented-then-canonical lookup) and `lib/ref-extract.ts` owns the git
work (`git rev-parse --verify <ref>^{commit}`, `git worktree add --detach` into the
cache directory, search paths rebased onto the worktree, the same `griffe dump` through
`resolveGriffeLauncher`/`runGriffe`). Ref dumps are keyed by commit sha and never
re-made; the labels reach render time as a sidecar, like docstring HTML. Objects in the
oldest listed ref and objects in none of the refs are deliberately unbadged.

### Two runtime contexts for `lib/` code

- **Browser**: only the search element (`lib/search-element.ts`) and any component
  `<script>`; bundled by Vite; relative imports omit the extension.
- **Node**: the runner, cache, and everything imported by route/endpoint code and
  scripts executed directly (type-stripping), so their relative imports need explicit
  `.ts` extensions.

### TypeScript

Strictest config (`astro/tsconfigs/strictest`) with `verbatimModuleSyntax` and
`allowImportingTsExtensions`. The package's `tsc --noEmit` type-checks the
framework-free code (`lib/`, `loader.ts`); `.astro` components, plugin and
integration glue are type-checked by `astro check` in the docs site, which imports
them. `pnpm typecheck` runs both.

## Gotchas

- **Griffe dump `members` are objects keyed by name, not arrays.** Iterate with
  `Object.values`. Docstring `parsed` is only present with both `-f` and `-d`.
- **`ExprName` carries a bare `name`, no canonical path.** All resolution is ours
  (`lib/expr.ts`); never assume a dotted path is directly linkable.
- Dumps in `fixtures/*/dump*.json` are checked in; tests run against them. If you
  change a fixture package, run `pnpm gen:dumps` and commit the JSON too. A guarded
  test regenerates live when `uv` is available and diffs the surface, catching drift.
- The docs deploy to GitHub Pages under base `/starlight-pydocs`: keep links and
  Playwright `baseURL` base-path-aware.
- Releases are manual: changelog entries live under `CHANGELOG.md` **Unreleased**;
  releasing moves them into a dated `## **Version X.Y.Z**` section, bumps the package
  version, and publishes a GitHub release tagged `vX.Y.Z`, which triggers
  `.github/workflows/release.yml` (npm trusted publishing via OIDC, no token; the
  workflow guards tag == package version; the very first publish is manual).
- MDX is excluded from Prettier and `*.md` uses `embeddedLanguageFormatting: 'off'`:
  Prettier reflows the Python signatures and directive examples in docs pages.

## Starlight integration gotchas (learned the hard way, some inherited from starlight-quiz)

- **Remark plugins don't run in this Astro 7 / Starlight-MDX pipeline** when appended
  from an integration's `astro:config:setup`. We register no markdown plugins at all;
  we only call the host processor's renderer on docstring strings.
- **Never build a markdown processor that runs in the SSR graph.** Astro tree-shakes
  Shiki's bundled themes and languages out of the server bundle, so a processor
  created at render time cannot resolve a theme the host's own config never asked for
  (`Theme 'github-light' is not included in this bundle`). Rendering happens at
  `astro:config:done`, in the config process, where the full bundle exists.
- **Starlight colour tokens are contrast tokens, not literal colours.**
  `--sl-color-white` flips to dark in light mode. Follow the LinkButton pattern
  (`background: var(--sl-color-text-accent)`, `color: var(--sl-color-black)`); all
  our colours go through `--pyd-*` custom properties with static vanilla fallbacks,
  matching the `.pyd-` class prefix.
- **`styles.css` is wrapped in `@layer starlight-pydocs`** (deliberately low
  priority). Starlight's own unlayered rules beat layered ones; where we must win
  inside Starlight DOM, use inline styles or higher specificity, and note why.
- **StarlightPage props, not `starlightRoute` mutation, set the ToC** for injected
  routes: pass `headings` (and `frontmatter`) as props. Route middleware handles the
  sidebar swap and pagination and runs for every page, so build the tree once per
  process and return early when the route is neither a pydocs page nor holds a
  placeholder.
- **`astro check` in `docs` only sees files inside `docs`** unless
  `docs/tsconfig.json` includes them. It includes the package's `.astro` components,
  routes, layouts and glue on purpose; without that they are compiled but never
  type-checked.
- **Don't add `scroll-margin-top`** to anchor targets; Starlight's `scroll-padding-top`
  on `<html>` already clears the fixed header and doubles up with any custom margin.
- **Custom elements query `this`, never `document`, and self-define idempotently**:
  Astro view transitions create fresh elements per navigation.
