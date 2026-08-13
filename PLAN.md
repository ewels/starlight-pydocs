# starlight-pydocs — architecture plan

`starlight-pydocs` generates Python API reference documentation for Astro and Starlight
sites. It extracts the API surface with [Griffe](https://mkdocstrings.github.io/griffe/)
(`griffe dump -f -d <style>`) and renders it with Astro components on injected routes.
This document records the architecture decisions, the reasoning behind each, and the
alternatives rejected. `ROADMAP.md` sequences the work; `CLAUDE.md` documents working
conventions; `HANDOFF.md` is the running log.

## Reference implementations studied

- `ewels/starlight-quiz` — repo conventions mirrored here: pnpm workspace, no build step
  (ships `.ts`/`.astro` source), Vitest + Playwright, prek hooks, strictest TS,
  `@layer`-wrapped CSS, optional `@astrojs/starlight` peer dependency, changelog and
  OIDC release workflow.
- `HiDeoo/starlight-openapi` — the route-injection reference. Confirmed mechanism: the
  Starlight plugin's `config:setup` hook adds an Astro integration which calls
  `injectRoute` with a `[...slug]` catch-all; the route component renders
  `@astrojs/starlight/components/StarlightPage.astro`, passing `frontmatter` and a
  `headings` array as props, which feeds the table of contents. Sidebar entries are
  produced by exporting a placeholder group from the plugin and swapping it for real
  links inside a route middleware (`addRouteMiddleware` + `defineRouteMiddleware`)
  which mutates `context.locals.starlightRoute.sidebar`. Data reaches the route
  through Vite virtual modules.
- `HiDeoo/starlight-typedoc` — the file-generating alternative. It writes Markdown
  into `src/content/docs` at `config:setup` time. Rejected as the primary mechanism;
  see decision 1.
- `delucis/starlight-llms-txt` — iterates the `docs` content collection only, so
  injected routes are invisible to it. Shapes decision 10.
- `HiDeoo/starlight-versions` — snapshots `src/content/docs` into per-version
  directories. Injected routes are not snapshotted. Shapes decision 11.

## Verified groundwork (checked in this environment, not assumed)

- `uvx --from griffe griffe dump -f -d google --search src mypkg -o api.json` runs in
  0.8 s cold here with nothing preinstalled. `python -m griffe` also works.
- The dump's `members` maps are keyed by member name. `--full` adds `path`,
  `filepath`, `relative_filepath`, `is_public`, `is_exported`, `is_imported`,
  `is_deprecated`, `is_private`, `is_special`, `lineno`/`endlineno`, `labels` and
  `analysis` on every object.
- Docstrings parse into structured sections (`text`, `parameters`, `returns`,
  `raises`, `examples`, `attributes`, admonitions, `deprecated`, …) only when both
  `-f` and `-d` are passed. All four styles work: `google`, `numpy`, `sphinx`, `auto`.
- Type annotations serialise as expression trees (`ExprSubscript`, `ExprName`,
  `ExprBinOp`, `ExprTuple`, …). `ExprName` nodes carry a bare `name`, not a canonical
  path, so name resolution is our job (decision 6).
- `griffe dump -e griffe_pydantic` works statically via
  `uvx --with griffe-pydantic --from griffe …`: the pydantic fixture gains the
  `pydantic-model` label without pydantic being importable.
- `griffe check` outputs oneline/verbose/markdown/github/azdo only — no JSON. The
  version-annotations stretch feature therefore diffs full dumps between refs
  instead of parsing `griffe check` output (decision 12).
- The dump JSON schema is published at
  `mkdocstrings/griffe/docs/schema.json`; a copy is vendored under
  `packages/starlight-pydocs/tests/fixtures/` for reference.

## Decisions

### 1. Render from injected routes, not generated Markdown

Pages are created by injecting a catch-all route per configured package and rendering
Astro components straight from the Griffe model. No Markdown or MDX is written into
`src/content/docs`.

Reasoning: Markdown is a lossy intermediate representation. It forecloses cross-linked
type annotations (angle brackets, pipes and braces in `dict[str, float] | None` need
escaping everywhere), symbol-level search metadata, collapsible member groups and
badges. Route injection gives direct control of heading IDs (we emit the dotted object
path, `mypkg.Report.generate`, as the anchor — matching mkdocstrings' anchor scheme so
Sphinx inventories interoperate) instead of fighting `github-slugger`. It also avoids
starlight-typedoc's mtime games: nothing pollutes the user's content directory, and
`dev` reflects changes without re-writing files.

The load-bearing assumption — that an injected route can populate the table of
contents and be indexed by Pagefind — is proven by starlight-openapi in production:
`StarlightPage` accepts a `headings` prop and renders the standard page shell,
including the `data-pagefind-body` content container. **Spike outcome (ROADMAP
item 2, verified in-repo 2026-08-12): confirmed on all counts.** An injected
`[...pydocsSlug]` route rendered `StarlightPage` with dotted-path heading IDs
(`demopkg.spike.generate`); the built HTML contains those IDs verbatim in the ToC
links (no slugger mangling), the page carries `data-pagefind-body`, the Pagefind
fragment index contains the page text, and the middleware sidebar swap renders the
generated group. Astro 7.0.3, Starlight 0.41.1.

Rejected alternative: generating `.md`/`.mdx` files (starlight-typedoc's approach).
Simpler to implement and it composes with every content-collection consumer for free,
but the lossy-representation costs above are permanent, and two 1.0 requirements
(linked annotations inside signatures, symbol search metadata) are impractical in it.
The compat costs of route injection (llms-txt, versions) are handled explicitly in
decisions 10 and 11 instead.

### 2. One package, Starlight plugin as root export, vanilla Astro first-class

Following starlight-quiz: a single published package with `@astrojs/starlight` as an
optional peer dependency. Subpath exports:

| Export                                                     | Contents                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `starlight-pydocs`                                         | Starlight plugin (default export), `pydocsSidebarGroup`, `createStarlightPydocs()` for multi-instance |
| `starlight-pydocs/astro`                                   | vanilla Astro integration (no Starlight imports anywhere in its module graph)                         |
| `starlight-pydocs/loader`                                  | Astro Content Layer loader emitting one entry per documented object                                   |
| `starlight-pydocs/components`                              | `<Autodoc>` and the presentational component set                                                      |
| `starlight-pydocs/styles`                                  | theme CSS                                                                                             |
| `starlight-pydocs/middleware`, `starlight-pydocs/routes/*` | internal entrypoints referenced by string from the plugin/integration                                 |

Hard rule inherited from starlight-quiz: `lib/` never imports `astro` or
`@astrojs/starlight`. Components never import `@astrojs/starlight` either (unlike
starlight-openapi, whose components use Starlight's `AnchorHeading`); we render our
own anchor headings so every component works in vanilla Astro. Starlight-specific
glue lives only in `index.ts`, `libs/starlight.ts`, `middleware.ts` and
`routes/starlight/`.

The vanilla integration injects the same routes with a built-in minimal layout
(overridable via a `layout` option pointing at the user's own layout component).
The Starlight plugin wraps the vanilla integration and adds: `StarlightPage`
rendering, sidebar placeholder substitution, translation injection, style injection.

### 3. Extraction: subprocess `griffe dump`, no Python code shipped

`lib/runner.ts` resolves an extraction strategy in this order:

1. `runner.command` — explicit argv array supplied by the user.
2. A pre-generated dump: `source: { file }` or `source: { url }` per package. This is
   how a Python project's CI can publish the artefact so the docs site needs no
   Python at all, and how versioned API docs pin old surfaces.
3. `uvx --from griffe [--with <extension-pkg>…] griffe` if `uv` is on PATH.
4. `python -m griffe` (then `python3`, `py`) if the interpreter has griffe importable
   (probed with `python -c "import griffe"`).

Failure produces one actionable error listing what was probed and the three ways to
fix it (install uv, pip install griffe, or point at a pre-generated dump).

Griffe does static analysis, so the documented package is never imported and needs no
installation; `--search` paths point at source directories. Runtime analysis
(pydantic, wrapping decorators, C extensions) is opt-in via `forceInspection` and
`extensions` passthrough (`-e`, with `extraRequirements` feeding `uvx --with`).

### 4. Cache the dump, never ship it to the browser

Dumps are large (griffe's own package: 5.2 MB, 2 441 objects). The runner writes to
`<cacheDir>/starlight-pydocs/<instance-hash>/dump.json`, default cache dir
`node_modules/.astro`. The cache key hashes: the resolved griffe argv, docstring
style/options, extensions, and the (path, mtime, size) list of every `.py`/`.pyi`
file under the search paths. URL sources are cached with `ETag`/`Last-Modified`
revalidation and a `cache: 'force'|'revalidate'|'bypass'` knob.

The dump never enters a Vite virtual module. starlight-openapi inlines its parsed
schemas as `JSON.stringify` inside `virtual:` modules; at 5 MB that would make
esbuild parse megabyte string literals on every dev restart. Instead the virtual
module `virtual:starlight-pydocs/context` carries only the validated config and the
dump file paths; `lib/data.ts` reads and indexes the JSON lazily, once per process,
server-side only. Prerendered output contains plain HTML; the only JSON a browser can
fetch is the deliberately small symbol-search index. SSR mode works wherever the
adapter has filesystem access to the cache; the docs recommend prerendering API pages
regardless (the openapi plugin's `prerender` split shows how both are supported).

Dev ergonomics: the integration watches the search paths from `astro:server:setup`;
a `.py` change re-runs extraction (cheap; cache makes no-op rebuilds instant),
invalidates the context module and triggers a full reload.

### 5. Model layer: normalise once, render dumb

`lib/model.ts` turns the raw dump into a normalised model the components can render
without logic:

- **Alias resolution.** Imported members appear as aliases with a `target_path`.
  We resolve aliases within the loaded package set, tracking re-export provenance
  (`mypkg.Report` documented at the top level but defined in `mypkg._report`).
- **Member filtering.** Default policy mirrors mkdocstrings: if a module defines
  `__all__`, that is the public surface; otherwise `is_public` (no leading
  underscore, not imported). Overridable per package with `members`
  include/exclude glob patterns and `filters: { special, private, imported }`.
- **Inheritance.** The dump contains declared bases as expression trees. We resolve
  bases that live inside the loaded packages and merge their public members into the
  class view, marked with provenance (`inherited from mypkg.Base`), stopping at
  unresolvable externals. MRO is approximated with C3 over the resolvable graph.
- **Overloads.** Griffe emits `overloads` on functions; the model keeps each overload
  signature plus the implementation docstring, rendered as stacked signatures.
- **Symbol index.** A flat map of canonical path → { kind, page slug, anchor, brief }
  built once and reused by: cross-linking, the search index endpoint, the objects.inv
  publisher, the loader, and `<Autodoc>` name resolution.
- **Page plan.** One page per module (packages and subpackages become nested index
  pages), mirroring mkdocstrings' mental model. Sidebar tree mirrors the module tree.
  `<Autodoc>` covers bespoke layouts, so no page-per-symbol mode in 1.0.

### 6. Annotations: expression trees rendered as linked HTML

`lib/expr.ts` walks the serialised expression trees. Each `ExprName` resolves through,
in order: the enclosing scope chain of the owning object (module members, then parent
package, following aliases), the builtins table, then configured Sphinx inventories.
Resolution results in an internal link (same-site page + `#dotted.path` anchor), an
external link (inventory base URL + object URI), or plain text. Unknown expression
node types degrade to their string form — the dump keeps a plain-string fallback for
every annotation, so rendering can never hard-fail on an exotic annotation.

### 7. Docstring prose: the host's configured processor, pre-rendered at config time

The only Markdown work this package does is rendering docstring prose: Griffe hands
us Markdown strings inside the JSON, and everything structural (anchors, heading
IDs, cross-references, the ToC, member layout) is set directly in components under
the route-injection design. That is a render call, not a processor plugin — the
package registers no remark, rehype, mdast or hast plugin anywhere.

The render call goes through **whatever processor the host project has configured**,
and the package depends on neither engine. Verified against current releases
(2026-08-13): Astro 7.2.1 defaults `markdown.processor` to `satteri()` from
`@astrojs/markdown-satteri` and no longer depends on `@astrojs/markdown-remark`;
`@astrojs/markdown-remark@7.2.2` exports the `unified()` factory for sites that
must stay on the unified pipeline (mermaid, `starlight-links-validator`); Starlight
supports both, with `@astrojs/markdown-remark` as an optional peer. Hardcoding
either engine halves the addressable audience. The `MarkdownProcessor` interface
(`name`, `options`, `createRenderer(shared) → { render }`) is processor-agnostic by
design, so the resolved `astroConfig.markdown.processor` is all we need; the
detection helpers Starlight uses (`isSatteriProcessor`/`isUnifiedProcessor`) are
unnecessary for a pure render call.

Mechanics, and the constraint that shapes them: the live processor instance exists
only in the config-time process, while routes and components execute in Vite's SSR
module graph — module state does not cross that boundary and a processor cannot be
serialised into a virtual module. So docstring prose is rendered **eagerly at
`astro:config:done`**, which runs after every integration's `astro:config:setup`
has finished mutating `processor.options` (Starlight's asides, a site's mermaid
plugin and anything else are registered by then, so docstrings render through the
same final pipeline as the site's own content). The rendered HTML is written to a
sidecar JSON beside the cached dump; `lib/data.ts` loads it like the dump and
components consume pre-rendered HTML strings. The dev watcher re-renders after
re-extraction. Doctest `>>>` blocks are fenced as `python` before rendering (plain
string manipulation; `pycon` is not in Sätteri's bundled Shiki set). Griffe
admonition sections render as our own aside markup in components, not through
directives.

Astro 7.0.x, where `markdown.processor` does not exist: fall back to
`@astrojs/markdown-remark`'s `createMarkdownProcessor(astroConfig.markdown)`,
loaded via a top-level `import(…).catch(() => null)` exactly as Starlight does
(late dynamic imports from config-loaded modules hit the closed module runner),
with `@astrojs/markdown-remark` declared as an optional peer, mirroring Starlight.
On 7.0.x astro itself depends on markdown-remark, so the import resolves precisely
where the fallback is needed.

Deprecated surface avoided everywhere, including docs and fixtures: top-level
`markdown.remarkPlugins`, `rehypePlugins`, `remarkRehype`, `gfm` and `smartypants`
are all scheduled for removal; engine behaviour is configured through the processor
factories, and heading IDs, directives and math come from Sätteri's native
`features` when a site wants them, never from plugins we add.

Rejected alternatives. Pinning `@astrojs/markdown-remark` (this plan's first
draft): forces a non-default extra dependency and the slow path on every Astro 7
site. Pinning `@astrojs/markdown-satteri` (briefly implemented mid-build, then
unwound): breaks unified-locked sites. Rendering lazily at request time via a
`globalThis` bridge from the Vite plugin into the SSR graph: works in dev and
static builds but leans on process-sharing internals and dies on deployed SSR;
config-done pre-rendering uses only public hooks. Note the earlier "remark plugins
don't run when appended from `astro:config:setup`" gotcha argued against relying on
the host pipeline for _our own transforms_; it says nothing against calling the
host's renderer on strings, which is all we do now.

Test coverage: the docs site runs the Astro 7 default (Sätteri); the vanilla
example site pins `markdown: { processor: unified() }`, so CI exercises both
engines end to end.

### 8. Search: Pagefind for prose, a symbol index for symbols

Generated pages are indexed by Pagefind automatically because `StarlightPage` renders
the standard shell (spike verifies). On top, symbol-level search: an injected endpoint
route serves `<base>/symbols.json` (name, kind, path, url, brief — small, built from
the symbol index), and a `<PydocsSearch>` custom element does client-side substring +
CamelCase/dot-segment matching, grouped by kind, keyboard accessible. The plugin puts
it on generated package index pages; users can place it anywhere via
`starlight-pydocs/components`. Vanilla sites get the same component; nothing in it
touches Starlight. Implemented as promised: both page routes render `<SymbolSearch>`
above the module documentation on the page whose object is a package root module,
which keeps it out of `<Autodoc>` blocks and off every deeper module page.

### 9. Sphinx inventories, both directions

- **Consume:** `inventories: [{ url | file, base }]` parses `objects.inv` (Sphinx v2
  format: four header lines then zlib-compressed `name domain:role priority uri
dispname` lines) with `node:zlib`. Parsed entries feed annotation resolution
  (decision 6) so `pandas.DataFrame` links out to pandas' docs. Fetched inventories
  cache to the cache dir (this sandbox cannot reach docs.python.org, so tests use
  checked-in fixtures and a local server; a `python` preset ships the stdlib base
  URL).
- **Publish:** an injected endpoint route serves `<base>/objects.inv`, generated from
  the symbol index with mkdocstrings-compatible roles (`py:module`, `py:class`,
  `py:function`, `py:attribute`, `py:method`) and `$`-compressed URIs, so mkdocstrings
  and Sphinx sites can cross-reference this site.

### 10. llms-txt: emit our own structured text output

starlight-llms-txt walks the `docs` content collection, which cannot see injected
routes. Instead of patching that, the package renders its own plain-Markdown
rendition of the whole API surface (shared renderer in `lib/markdown-doc.ts`, also
reused by unit tests as a golden-output format) and serves it from an injected
endpoint at `<base>/llms.txt` (configurable). The docs describe one-line integration
via starlight-llms-txt's `optionalLinks`. This doubles as a standalone feature for
any LLM consumer, with no dependency on the other plugin.

### 11. Versioned docs: multi-instance + pre-generated dumps

starlight-versions snapshots content files, not routes. The supported pattern:
one plugin instance per documented version, each with its own `base`
(`api/`, `1.x/api/`, …) and a pinned `source` dump generated at the matching git tag
(the pre-generated dump path exists precisely for this). `createStarlightPydocs()`
returns an isolated plugin + sidebar-group pair per instance (mirroring
starlight-openapi's `createOpenAPISidebarGroup`), so versioned sidebars slot each
group under the right version. Documented with a full recipe and covered by an e2e
fixture running two instances of the same package at different bases.

**Status (verified 2026-08-13): multi-instance is not supported, and the recipe is
per-version builds instead.** Only `createPydocsSidebarGroup()` shipped, and one
plugin instance rejects two entries with the same package name. Registering the
plugin twice fails: both instances resolve the same
`virtual:starlight-pydocs/context` module id (the first one wins, so the second
instance's packages do not exist at render time) and both inject the same
`[...pydocsSlug]` catch-all, which Astro reports as a route conflict — a build
against `examples/vanilla` ends in `no configured package serves
/api/v1/numpkg/llms.txt`. Making it work needs a per-instance virtual module
namespace and a per-instance route pattern, which is a feature, not a fix.
`docs/src/content/docs/guides/versioned-docs.mdx` documents what does work: pin a
version's dump, build the site once per version and deploy each under its own base,
with starlight-versions handling the prose.

### 12. Stretch: version annotations by diffing dumps across refs

`griffe check` has no machine-readable output, so annotations come from data we
already know how to produce: for each configured `{ ref, label }` the runner
materialises the package source at that ref (`git worktree add` into the cache dir,
keyed by the ref's commit SHA, so re-runs are free) and dumps it. Comparing object
paths across successive dumps yields "added in <label>" for each object's first
appearance; `is_deprecated` and docstring `deprecated` sections yield deprecation
badges with the deprecating version. Rendered as Starlight-style badges next to the
symbol heading. Ships only if the core lands first (ROADMAP item 9).

### 13. Everything else follows starlight-quiz conventions

pnpm workspace (`packages/starlight-pydocs` + `docs` + `examples/vanilla`), Node

> = 22.12, pnpm 10.33, no build step, `astro/tsconfigs/strictest` +
> `verbatimModuleSyntax` + `allowImportingTsExtensions` (Node-executed files import
> with `.ts` extensions), Vitest for `lib/`, Playwright e2e against the built docs
> site and the vanilla example (Playwright `webServer` array serves both), prek
> running prettier → eslint → typecheck, CI = prek + unit + e2e + zizmor, docs deploy
> to GitHub Pages, release via manual changelog + tag + OIDC trusted publishing.
> `styles.css` is wrapped in `@layer starlight-pydocs`; theme tokens are
> `--pydocs-*` custom properties that default to Starlight's `--sl-*` tokens with
> static fallbacks for vanilla sites. Starlight colour tokens are contrast tokens that
> flip between modes, so mappings follow the LinkButton pattern
> (`background: var(--sl-color-text-accent)`, `color: var(--sl-color-black)`), never
> `--sl-color-white` as "white". i18n mirrors quiz: `lib/strings.ts` holds English
> defaults, `translations.ts` holds locale tables injected via `i18n:setup`, and every
> component accepts label props as the vanilla override.

## Configuration surface (1.0)

```ts
starlightPydocs({
  packages: [
    {
      name: 'demopkg',                     // import name, required
      base: 'api/demopkg',                 // URL base, default `api/<name>`
      search: ['../py/src'],               // griffe --search, relative to project root
      docstringStyle: 'google',            // google | numpy | sphinx | auto
      docstringOptions: {},                // griffe -D passthrough
      extensions: ['griffe_pydantic'],     // griffe -e passthrough (string or {name, options})
      extraRequirements: ['griffe-pydantic'], // uvx --with / documented pip extras
      forceInspection: false,              // griffe -x
      source: { file: './api.json' },      // or { url }, skips extraction
      members: { include: [], exclude: [] },// glob patterns on dotted paths
      filters: { special: false, private: false, imported: false, inherited: true },
      sourceLink: {                        // preset or template
        template: 'https://github.com/o/r/blob/{ref}/{path}#L{start}-L{end}',
        ref: 'main',
      },
      sidebar: { label: 'demopkg', collapsed: false },
      versions: [{ ref: 'v1.0.0', label: '1.0' }],  // stretch feature
    },
  ],
  runner: { command: undefined, python: undefined },   // explicit overrides
  inventories: [{ url: 'https://docs.python.org/3/objects.inv', base: 'https://docs.python.org/3/' }],
  publishInventory: true,
  symbolSearch: true,
  llmsTxt: true,
  components: { ClassDoc: './src/components/MyClassDoc.astro' },  // overrides
  injectStyles: true,
  cacheDir: undefined,                     // default node_modules/.astro
})
```

Component overrides resolve through `virtual:starlight-pydocs/components`, a virtual
module that re-exports either the default component or the user's entrypoint; the
dispatching components import from it so overrides apply everywhere, including
`<Autodoc>`.

## Data flow, end to end

```
astro config load
  └─ plugin config:setup (Starlight) or integration astro:config:setup (vanilla)
       ├─ validate config (lib/config.ts)
       ├─ extract or load dumps (lib/runner.ts → cacheDir)      [subprocess/fetch]
       ├─ inject routes: [...slug] pages, symbols.json, objects.inv, llms.txt
       ├─ register virtual modules: context (config + dump paths), components
       └─ Starlight only: route middleware for sidebar, i18n, customCss
route render (per page, prerender or SSR)
  └─ lib/data.ts loads dump once per process → model (lib/model.ts)
       ├─ page plan → this page's object subtree
       ├─ components render signatures, annotations (lib/expr.ts), docstrings
       │    (lib/markdown.ts), members, source links, badges
       └─ StarlightPage gets { frontmatter, headings } (Starlight) or layout (vanilla)
```

## Risks and mitigations

| Risk                                                                    | Mitigation                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| StarlightPage headings/Pagefind assumption breaks in a future Starlight | Spike proves it now; e2e asserts ToC entries and search hits so regressions surface in CI                                                                                                                          |
| Griffe dump format drift                                                | Loader validates the handful of fields we consume and fails with the griffe version in the message; schema copy vendored; unit tests run against checked-in dumps plus a live-regeneration test when uv is present |
| Huge packages slow builds                                               | Dump cached by content key; model built once per process; pages render from shared indexes                                                                                                                         |
| No Python on docs host                                                  | Pre-generated dump file/URL path is first-class and CI-documented                                                                                                                                                  |
| Windows                                                                 | No shell-string exec (argv arrays), `node:path` throughout, no symlink tricks                                                                                                                                      |
| Sandbox cannot reach external doc sites                                 | Inventory tests use fixtures + local HTTP server; live URLs only in user builds                                                                                                                                    |
