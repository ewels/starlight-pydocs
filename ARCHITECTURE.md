# Architecture

`starlight-pydocs` generates Python API reference documentation for Astro and Starlight
sites. It extracts the API surface with [Griffe](https://mkdocstrings.github.io/griffe/)
(`griffe dump -f -d <style>`) and renders it with Astro components on injected routes.
This document is the permanent record of the architecture decisions, the reasoning
behind each, the alternatives rejected, and the griffe behaviour the implementation
depends on. `CLAUDE.md` documents day-to-day working conventions; `HANDOFF.md` holds
the pre-release checklist. Decision numbers are stable: code comments cite them as
"ARCHITECTURE.md decision N".

## Reference implementations studied

- `ewels/starlight-quiz`, whose repo conventions are mirrored here: pnpm workspace, no
  build step (ships `.ts`/`.astro` source), Vitest + Playwright, prek hooks, strictest
  TS, `@layer`-wrapped CSS, optional `@astrojs/starlight` peer dependency, changelog and
  OIDC release workflow.
- `HiDeoo/starlight-openapi`, the route-injection reference. Confirmed mechanism: the
  Starlight plugin's `config:setup` hook adds an Astro integration which calls
  `injectRoute` with a `[...slug]` catch-all; the route component renders
  `@astrojs/starlight/components/StarlightPage.astro`, passing `frontmatter` and a
  `headings` array as props, which feeds the table of contents. Sidebar entries are
  produced by exporting a placeholder group from the plugin and swapping it for real
  links inside a route middleware (`addRouteMiddleware` + `defineRouteMiddleware`)
  which mutates `context.locals.starlightRoute.sidebar`. Data reaches the route
  through Vite virtual modules.
- `HiDeoo/starlight-typedoc`, the file-generating alternative. It writes Markdown
  into `src/content/docs` at `config:setup` time. Rejected as the primary mechanism;
  see decision 1.
- `delucis/starlight-llms-txt`: iterates the `docs` content collection only, so
  injected routes are invisible to it. Shapes decision 10.
- `HiDeoo/starlight-versions`: snapshots `src/content/docs` into per-version
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
- `griffe check` outputs oneline/verbose/markdown/github/azdo only, with no JSON. The
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
path, `mypkg.Report.generate`, as the anchor, matching mkdocstrings' anchor scheme so
Sphinx inventories interoperate) instead of fighting `github-slugger`. It also avoids
starlight-typedoc's mtime games: nothing pollutes the user's content directory, and
`dev` reflects changes without re-writing files.

The load-bearing assumption (that an injected route can populate the table of
contents and be indexed by Pagefind) is proven by starlight-openapi in production:
`StarlightPage` accepts a `headings` prop and renders the standard page shell,
including the `data-pagefind-body` content container. **Spike outcome (verified
in-repo, 2026-08-12): confirmed on all counts.** An injected
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

| Export                                                     | Contents                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `starlight-pydocs`                                         | Starlight plugin (default export), `pydocsSidebarGroup`, `createPydocsSidebarGroup()` |
| `starlight-pydocs/astro`                                   | vanilla Astro integration (no Starlight imports anywhere in its module graph)         |
| `starlight-pydocs/loader`                                  | Astro Content Layer loader emitting one entry per documented object                   |
| `starlight-pydocs/components`                              | `<Autodoc>` and the presentational component set                                      |
| `starlight-pydocs/styles`                                  | theme CSS                                                                             |
| `starlight-pydocs/middleware`, `starlight-pydocs/routes/*` | internal entrypoints referenced by string from the plugin/integration                 |

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

1. `runner.command`: explicit argv array supplied by the user.
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
node types degrade to their string form: the dump keeps a plain-string fallback for
every annotation, so rendering can never hard-fail on an exotic annotation.

### 7. Docstring prose: the host's configured processor, pre-rendered at config time

The only Markdown work this package does is rendering docstring prose: Griffe hands
us Markdown strings inside the JSON, and everything structural (anchors, heading
IDs, cross-references, the ToC, member layout) is set directly in components under
the route-injection design. That is a render call, not a processor plugin: the
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
module graph: module state does not cross that boundary and a processor cannot be
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

Rendered docstring HTML is deliberately **not sanitised**: markdown passes raw HTML
through, components consume the sidecar via `set:html`, and whatever a docstring
says lands on the page — the same trust model as mkdocstrings. The owner chose this
explicitly (2026-08-13) over a default-on sanitize-html allowlist that was built and
then removed (the git log around that date has the working implementation): the tool
is expected to be used almost exclusively by people documenting their own packages,
whose docstrings are as trusted as the site's own MDX, and the allowlist's fragility
plus the package's only runtime dependency were not worth it. The pre-generated-dumps
guide states the corollary: a dump is content for your site. Hrefs the package builds
itself from semi-trusted inputs — a dump's `source_link`, absolute URIs in fetched
inventories — are the exception and pass through `safeHref` in `lib/paths.ts`.

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
route serves `<base>/symbols.json`, a small payload built from the symbol index (name,
kind, path, url, brief), and a `<PydocsSearch>` custom element does client-side
substring + CamelCase/dot-segment matching, grouped by kind, keyboard accessible. The
plugin puts it on generated package index pages; users can place it anywhere via
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

**Status (verified 2026-08-13): multi-instance is not supported.** Registering the
plugin twice fails: both instances resolve the same
`virtual:starlight-pydocs/context` module id (the first one wins, so the second
instance's packages do not exist at render time) and both inject the same
`[...pydocsSlug]` catch-all, which Astro reports as a route conflict. A build
against `examples/vanilla` ends in `no configured package serves
/api/v1/numpkg/llms.txt`. Making it work needs a per-instance virtual module
namespace and a per-instance route pattern, which is a feature, not a fix.

**Resolution (2026-08-13): one instance covers the use case, because a package
entry is identified by its `base`, not by its name.** The duplicate-name
rejection is gone; `base` was already validated unique and non-overlapping, so it
is now the key for the dump and sidecar maps, the model cache, the route props,
endpoint matching and every context lookup. A per-package `label` (default `name`)
names an entry for humans in the sidebar group, the `llms.txt` heading and the
published inventory, so `demopkg 1.x` and `demopkg` are distinguishable in one
site. `<Autodoc>` and `<SymbolSearch>` resolve a `package` prop as a base first
and an import name second, and a bare name that several entries answer to is an
error naming the candidate bases rather than a silent pick. Cross-reference
resolution across entries skips entries whose import name matches the rendered
one, so one documented version never links into another's pages. The supported
recipe is therefore one instance, one entry per version, each with its own pinned
dump and its own sidebar placeholder from `createPydocsSidebarGroup()`, which
slots straight into starlight-versions' per-version sidebars. Per-version _builds_
remain documented as the alternative for sites that want wholly separate
deployments. Covered by an e2e fixture: the docs site documents `demopkg` twice,
at `api/demopkg` from source and at `1x/api/demopkg` from the checked-in dump.

### 12. Version annotations by diffing dumps across refs

`griffe check` has no machine-readable output, so annotations come from data we
already know how to produce: for each configured `{ ref, label }` the runner
materialises the package source at that ref (`git worktree add` into the cache dir,
keyed by the ref's commit SHA, so re-runs are free) and dumps it. Comparing object
paths across successive dumps yields "added in <label>" for each object's first
appearance; `is_deprecated` and docstring `deprecated` sections yield deprecation
badges with the deprecating version. Rendered as Starlight-style badges next to the
symbol heading.

**Shipped (2026-08-13), as `versions: { refs: [{ ref, label }, …] }` per package,
oldest first.** The split is git on one side and arithmetic on the other:
`lib/ref-extract.ts` resolves each ref with `git rev-parse --verify <ref>^{commit}`,
checks it out with `git worktree add --detach <cacheDir>/starlight-pydocs/worktrees/<sha>`
(reusing an existing directory, pruning and retrying once if git disagrees), rebases
the package's search paths onto the worktree and runs the same `griffe dump` through
the launcher the current source uses. `lib/runner.ts` grew `resolveGriffeLauncher`
and a reusable `runGriffe` for that, argv arrays throughout. Ref dumps live at
`<cacheDir>/starlight-pydocs/versions/<name>-<sha12>-<options12>/dump.json`; a commit
is immutable, so an existing dump is never re-made and later builds do no git work.
`lib/versions.ts` is pure and unit tested: `collectDumpPaths` over a dump,
`firstSeenLabels` over the snapshots oldest-first, `addedInLabel` falling back from
the documented path to the canonical one so re-exports and inherited members inherit
their definition's history. The labels are written to a sidecar beside the dump
(`versions-<key>.json`), loaded by `lib/data.ts` and passed into `buildModel`, which
sets `DocObject.addedIn`; `objectBadges` puts it next to the kind badge and the
Markdown renderer emits the same text. Deliberate silences: objects in the oldest
listed ref get no badge (pre-history is noise), and objects in none of the refs get
none either (they exist only in the current source, which has no version number).
`versions` with `source.file`/`source.url` is a config error, since a pinned dump has
no history behind it. Coverage: pure diff tests over synthetic dumps, config
validation, and a git+uv-guarded live test that builds a throwaway two-commit
repository and asserts the badge lands on the function the second commit added. No
e2e: the fixture packages have no meaningful history, and the live test covers the
pipeline end to end.

### 13. Everything else follows starlight-quiz conventions

pnpm workspace (`packages/starlight-pydocs` + `docs` + `examples/vanilla`), Node 22.12
or newer, pnpm 10.33, no build step, `astro/tsconfigs/strictest` with
`verbatimModuleSyntax` and `allowImportingTsExtensions` (Node-executed files import
with `.ts` extensions), Vitest for `lib/`, Playwright e2e against the built docs site
and the vanilla example (one Playwright `webServer` array serves both), prek running
prettier, eslint and typecheck, CI running prek, unit, e2e and zizmor jobs, docs
deploying to GitHub Pages, releases via manual changelog plus tag plus OIDC trusted
publishing. `styles.css` is wrapped in `@layer starlight-pydocs`; theme tokens are
`--pyd-*` custom properties that default to Starlight's `--sl-*` tokens with static
fallbacks for vanilla sites. Starlight colour tokens are contrast tokens that flip
between modes, so mappings follow the LinkButton pattern
(`background: var(--sl-color-text-accent)`, `color: var(--sl-color-black)`), never
`--sl-color-white` as "white". i18n mirrors quiz: `lib/strings.ts` holds English
defaults, `translations.ts` holds locale tables injected via `i18n:setup`, and every
component accepts label props as the vanilla override.

## Configuration surface (1.0)

An at-a-glance sketch. `lib/config.ts` and the configuration guide on the docs site
are the authoritative reference; if this sketch and they disagree, they win.

```ts
starlightPydocs({
  packages: [
    {
      name: 'demopkg',                     // import name, required
      base: 'api/demopkg',                 // URL base, default `api/<name>`; identifies the entry
      label: 'demopkg',                    // display name, default `name`
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
      versions: { refs: [{ ref: 'v1.0.0', label: '1.0' }] },  // 'added in' badges
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

## Standing risks and mitigations

| Risk                                                                    | Mitigation                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| StarlightPage headings/Pagefind assumption breaks in a future Starlight | Proven by the spike; e2e asserts ToC entries and search hits so regressions surface in CI                                                                                                                          |
| Griffe dump format drift                                                | Loader validates the handful of fields we consume and fails with the griffe version in the message; schema copy vendored; unit tests run against checked-in dumps plus a live-regeneration test when uv is present |
| Huge packages slow builds                                               | Dump cached by content key; model built once per process; pages render from shared indexes                                                                                                                         |
| No Python on docs host                                                  | Pre-generated dump file/URL path is first-class and CI-documented                                                                                                                                                  |
| Windows                                                                 | No shell-string exec (argv arrays), `node:path` throughout, no symlink tricks                                                                                                                                      |
| Sandbox cannot reach external doc sites                                 | Inventory tests use fixtures + local HTTP server; live URLs only in user builds                                                                                                                                    |

## Implementation decisions

Finer-grained decisions taken while building, kept because each one answers a "why is
it like this" that the code alone does not.

- **Dumps stay on disk**; virtual modules carry config + paths only. starlight-openapi
  inlines parsed schemas into virtual modules, which would be megabytes here.
- **Anchors are dotted object paths** (`mypkg.Report.generate`), matching mkdocstrings,
  so published/consumed Sphinx inventories interoperate without a mapping layer.
- **`griffe check` has no JSON output** (verified: oneline/verbose/markdown/github/azdo
  only), so the stretch version-annotations feature diffs full dumps between git refs
  rather than parsing `griffe check`.
- **`__all__` selects members, not navigation.** When a module defines `__all__`, that
  list is the documented member surface of the module, exactly as mkdocstrings does.
  Submodules are the exception: they get pages whether or not they are exported, filtered
  only by privacy (`_internal` stays hidden) and the user's `members` globs. Otherwise
  `demopkg`'s curated `__init__` surface would hide `demopkg.report` entirely, which is
  not what anyone means by "document my package". Covered by `tests/model.test.ts`.
- **Re-exported objects are documented at both paths** (`demopkg.Report` and
  `demopkg.report.Report`), again mirroring mkdocstrings. The model records
  `canonicalPath` and `reexportedFrom` on the re-export, and `documentedPathFor()`
  picks the shortest documented path when a link needs to choose one.
- **Fixture dumps are post-processed for portability.** `fixtures/generate-dumps.ts`
  rewrites absolute `filepath` values to repository-relative ones and drops `git_info`
  and `source_link`, which embed the machine path and the current commit hash. Without
  that, `pnpm gen:dumps` produced a diff on every commit. Nothing in `lib/` reads those
  fields; source links come from `relative_filepath` plus the `sourceLink` template.
- **`lib/signature.ts` was added** beyond the planned module list. Both the Markdown
  renderer and the future components need the same signature construction (hiding
  `self`/`cls`, reinserting the `/` and `*` markers, linking annotations), and it did not
  belong in `expr.ts` or `model.ts`.
- **Inventory lookups are restricted to the `py` domain.** A `std:label` named `str`
  would otherwise link a Python annotation to a page about something else.
- **No TypeScript parameter properties (or other non-erasable syntax) anywhere in
  `lib/`**: `fixtures/generate-dumps.ts` runs under `node --experimental-strip-types`,
  which only handles erasable syntax, and any future script may import any lib module.
- **The pre-rendered docstring sidecar is keyed by canonical path and section index.**
  `<cacheDir>/starlight-pydocs/<pkg-hash>/rendered.json` (or, for a user-supplied
  `source.file` dump we must not write next to, `…/rendered/<pkg>-<hash>/rendered.json`)
  maps canonical object path → section index → `{body, entries, blocks}` plus a
  `deprecated` slot. Re-exports and inherited members share the definition's prose, so
  components look up `doc.canonicalPath`, not `doc.path`. The sidecar is rewritten on
  every `astro:config:done`, never reused from a previous run: its content depends on
  the host's markdown pipeline, which can change without the dump changing.
- **`ObjectDoc` owns the member recursion, not the kind-specific bodies.** It recurses
  with `Astro.self` (the same trick Starlight's `SidebarSublist` uses) and dispatches
  only signature-and-docstring bodies to `ClassDoc`/`FunctionDoc`/`AttributeDoc`. That
  keeps the module graph acyclic even though the bodies are imported through
  `virtual:starlight-pydocs/components`, which `ObjectDoc` itself is reachable from.
  Modules never appear as members inside a page (submodules get their own pages), so
  `ModuleDoc → ObjectDoc` is a one-way edge.
- **Attributes get real headings.** The brief suggested rendering attributes and
  properties as compact definition entries, but `pageHeadings()` lists every class
  member at depth 3, so a heading-less attribute is a dead table-of-contents link.
  They render through `ObjectDoc` like every other member, with a compact
  `AttributeDoc` body. For the same reason inherited-member `<details>` blocks are
  `open` by default: a collapsed one hides live anchor targets.
- **Theme tokens are `--pyd-*`**, not the `--pydocs-*` earlier drafts said; the class
  prefix is `.pyd-` and having the two agree is worth more than the older spelling.
- **`sourceLink.root` was added to the config surface.** Griffe's
  `relative_filepath` is relative to its working directory (the Astro project
  root), so a docs site with sources one level up got absolute paths in public
  URLs. `root` names the directory `{path}` is computed against, from the absolute
  `filepath`; unset, behaviour is unchanged. The docs site uses `root: '..'`.
- **`sidebar.group` on a package config** accepts a placeholder from
  `createPydocsSidebarGroup()` and normalises to its label string, so one site can
  place different packages in different parts of the sidebar (starlight-openapi's
  `createOpenAPISidebarGroup` pattern).
- **The docs site documents four package entries, and that is the e2e fixture.**
  `demopkg` (uvx + `griffe_pydantic`, google), `numpkg` (uvx, numpy), `sphpkg` (no
  extraction at all: `source: { file: '../fixtures/sphpkg/dump.json' }`, sphinx, its
  own sidebar placeholder) and `demopkg` again at `1x/api/demopkg` (pinned to
  `../fixtures/demopkg/dump.json`, labelled `demopkg 1.x`, its own placeholder under a
  `v1.x` sidebar section). One build therefore exercises both extraction strategies,
  all three docstring parsers, per-package sidebar placement, multi-package endpoints
  and one package name at two bases. Every generated page in the suite is real output,
  not a fixture render.
- **Inventories are tested from a checked-in `objects.inv`.** The fixture under
  `fixtures/inventories/` is written by `pnpm gen:inventory`
  (`fixtures/generate-inventory.ts`) with the thirteen stdlib names the fixture
  packages annotate with, at CPython's real URIs, and the docs site consumes it with
  `base: 'https://docs.python.org/3/'`. That makes external annotation links
  assertable offline (`pathlib.Path` → `library/pathlib.html#pathlib.Path`), which
  matters because this sandbox cannot reach docs.python.org.
- **One Playwright configuration owns both sites.** `docs/playwright.config.ts` has a
  two-entry `webServer` array (docs on 4321 under `/starlight-pydocs`, the vanilla
  example on 4322) and two projects with matching `baseURL`s and their own `testDir`.
  Root `pnpm test:e2e` still filters to the docs package.
- **Cross-references in docstring prose are resolved by rewriting the Markdown**, not
  by a plugin in the host's pipeline (which decision 7 rules out). `lib/crossrefs.ts`
  turns `[title][dotted.path]` and `[dotted.path][]` into ordinary Markdown links
  before the string reaches the processor, and only when the target resolves: fenced
  code, inline code spans, escaped brackets and targets that have a real reference
  definition in the same string are left alone, and an unresolved target keeps its
  brackets. Resolution order is the rendered package's symbol index, then the other
  configured packages', then the Sphinx inventories, wired in `getCrossReferenceResolver`
  and applied by `renderDocstringsForDump`. This closes the gap the previous session
  left for a human. Indented (four-space) code blocks are not detected as code:
  telling them from list continuations needs a block parser, and griffe hands us
  dedented prose whose examples arrive fenced.
- **The symbol search box is placed on package root pages by the routes**, which is
  what ARCHITECTURE.md decision 8 promised and the previous session left unimplemented. Both
  `routes/starlight.astro` and `routes/vanilla.astro` render `<SymbolSearch>` above
  `<ModuleDoc>` when `isPackageRootPage(page)` and `symbolSearch` is on. It sits in the
  routes rather than in `ModuleDoc` on purpose: an `<Autodoc name="mypkg" />` of a
  package root would otherwise grow a search box in the middle of a hand-written page,
  and no module page below the root needs its own.
- **A package entry is identified by its `base`, not by its name.** The duplicate-name
  rejection in `lib/config.ts` is gone (bases were already validated unique and
  non-overlapping), and everything that used to be keyed by import name is keyed by base:
  the `dumpPaths`/`renderedPaths` maps, `PydocsPackageContext` lookups
  (`packageByBase`/`packagesByName` replace `packageByName`), the `lib/data.ts` model cache,
  the route prop (`pydocsBase`, was `pydocsPackage`), `createRenderScope`, the endpoint
  routes and the docstring sidecar path. The name still names the dump key and the model's
  `packageName`, because that is what griffe emits. This is what makes one package
  documentable at several bases (ARCHITECTURE.md decision 11), and it removes a real collision:
  `renderedSidecarPath` now includes the base, so two entries pinned to one dump file no
  longer overwrite each other's rendered prose (the prose contains base-specific
  cross-reference hrefs).
- **`label` is the human-facing name of an entry**, defaulting to `name`. It labels the
  sidebar group (`sidebar.label` still overrides), the `llms.txt` heading and the published
  inventory's project name, so `demopkg 1.x` reads as itself rather than as a second
  `demopkg`.
- **An import name that several entries answer to is an error, not a guess.**
  `matchPackageReference` / `matchPackageForDottedPath` in `lib/context.ts` return
  `{kind: 'ambiguous', name, bases}`, and `packageForAutodoc` turns that into
  "set the package prop to one of these bases: 'api/demopkg', '1x/api/demopkg'".
  `<SymbolSearch>` renders nothing rather than searching an arbitrary version.
- **Cross-reference resolution skips same-named entries.** `getCrossReferenceResolver`
  orders the models as: the rendered entry, then every entry whose import name differs. Two
  documented versions of one package would otherwise link into each other's pages, silently
  mixing two APIs in one page's prose.
- **Version annotations are two modules on purpose.** `lib/versions.ts` is pure (path
  collection, the oldest-first first-seen diff, the documented-then-canonical lookup), so the
  rules are unit tested over hand-written dumps with no git and no griffe. `lib/ref-extract.ts`
  owns everything that touches the world: `git rev-parse --verify <ref>^{commit}`,
  `git worktree add --detach`, the rebased search paths, the per-commit dump cache. The
  runner was refactored to share that last step: `resolveGriffeLauncher` picks the executable
  and `runGriffe` runs it into a cache location, so a ref is extracted exactly as the working
  tree is (same extensions, same docstring options, same strategy).
- **A ref's dump is cached by commit sha and never revalidated.** `versions/<name>-<sha12>-
<options12>/dump.json`. The options half of the key is machine independent (repository-relative
  search paths), and the sha half cannot change meaning, so after the first build there is no
  git work at all: the worktree is not even created when the dump is already there.
- **The "added in" labels travel as a sidecar, not through the virtual module.** Same
  reasoning as the docstring sidecar: `virtual:starlight-pydocs/context` carries paths, and
  the map (one entry per object newer than the oldest ref) is read from disk server-side. It is
  written during `preparePydocs`, not at `astro:config:done`, because it needs no markdown
  processor. `getModel` passes it to `buildModel` as `ModelOptions.addedIn`; it is kept out of
  the model cache key, which is safe because the labels are derived from the package's
  configuration and a dev re-extraction calls `clearCaches()`.
- **Objects in the oldest ref and objects in none of the refs both get no badge.** The first
  because "added in 1.0" over most of a package is noise and wrong for anything older; the
  second because the current source has no version number to show. Both are documented in
  `guides/version-annotations.mdx` rather than left for a reader to notice.
- **The vanilla example pins `markdown: { processor: unified() }`.** ARCHITECTURE.md decision
  7 promises both engines are exercised in CI; the docs site runs Astro's default
  (Sätteri), so the example imports `unified()` from `@astrojs/markdown-remark`. The
  e2e assertions are engine-visible on purpose: expressive-code figures on the docs
  site, `.astro-code` on the vanilla one.

## Griffe dump field names, as actually emitted (2.1.0)

Verified against generated dumps, not documentation. `lib/types.ts` follows these.

- `__all__` is exposed as **`exports`** (a plain array of names) on module objects, and
  the module also carries **`imports`** (imported name → resolved target path).
- Griffe 2.x adds **`git_info`** (commit hash, remote URL, absolute repository path) and
  a per-object **`source_link`** (a forge blob URL at the current commit). `source_link`
  is a possible future default for source links without any configuration; the model
  already falls back to it when no `sourceLink` template is configured.
- **Properties are attributes**, not functions: `kind: 'attribute'` with
  `labels: ['property', 'writable']`. Grouping and badges depend on this.
- **`overloads` is not serialised.** `Function.as_dict` emits `decorators`,
  `parameters` and `returns` only, so `@typing.overload` variants are dropped from the
  dump and only the implementation survives. The model reads `overloads` when present
  (a later griffe may add it) and the collection path is covered by the hand-written
  `tests/fixtures/synthetic.dump.json`.
- **A google-style `Deprecated:` block parses as an `admonition` section**, not as a
  `deprecated` section: `{kind: 'admonition', title: 'Deprecated', value: {annotation:
'deprecated', description}}`. `deprecationFrom()` therefore accepts the admonition, a
  real `deprecated` section, and the `is_deprecated` flag.
- **`@deprecated(...)` from `typing_extensions` does not set `is_deprecated`** under
  static analysis (tested: the decorator is recorded in `decorators` but the flag stays
  false). The docstring section is the portable signal, which is what the fixture and the
  renderer rely on. A code comment in `fixtures/demopkg/src/demopkg/report.py` says so.
- Expression shapes worth writing down: `ExprAttribute` holds **`values`** (an array of
  segments), not `left`/`right`; `ExprTuple` has `implicit: true` when the source had no
  brackets (`dict[str, float]`); `examples` sections are arrays of **`[kind, value]`
  pairs** where `kind` is `'examples'` for a doctest block and `'text'` for prose;
  `raises`/`warns` entries are `{annotation, description}` with no `name`.
- `relative_filepath` is relative to the **griffe process working directory**, so the
  runner always runs from the project root; `relative_package_filepath` is relative to
  the package's parent directory.
- Parameter kinds are spelled `positional-only`, `positional or keyword`,
  `variadic positional`, `keyword-only`, `variadic keyword` (note the spaces).
- Object kinds are `module`, `class`, `function`, `attribute`, `alias` and
  `type alias`, the last one with a space in it.

## Workarounds worth knowing

- **Version worktrees live under `node_modules/.astro`, which git does not know is
  disposable.** Deleting `node_modules` leaves the registrations behind, so the next
  `git worktree add` fails with "already registered" and `git worktree list` shows
  prunable entries in the meantime. `materialiseWorktree` therefore reuses an existing
  directory, and on failure runs `git worktree prune` and retries once before giving up.
  A human wanting them elsewhere can point `cacheDir` at a directory their CI caches,
  which is the better setup anyway: the ref dumps are then reused across builds.

- eslint's `astro/no-prerender-export-outside-pages` rejects
  `export const prerender = true` in injected-route `.astro` files (they live in the
  package, not `src/pages`). The `prerender: true` flag on `injectRoute` is
  sufficient (verified the built output prerenders), so the export is omitted.
- Prettier reformats Markdown, which broke the golden snapshots the moment `pnpm format`
  ran: the file no longer matched the renderer byte for byte. `tests/snapshots/**` is now
  in `.prettierignore`, next to the checked-in dumps.
- **Under Starlight, docstring code fences come out as expressive-code**, not
  `.astro-code`: Starlight registers expressive-code on the processor, and we render
  through the host's processor, so docstring code blocks match the rest of the site for
  free. Two consequences: our `.astro-code` rules only bite in plain Astro, and EC
  emits its `<link>`/`<script>` tags inline in the body for these blocks rather than
  hoisting them to `<head>` (harmless, deduplicated by URL, but visible in the HTML).
- **Prerendered endpoints are served by file extension, not by their `Response`
  headers.** `llms.txt` sets `text/markdown` in the route, and a static host serves it
  as `text/plain`; the e2e assertion matches the static behaviour, which is what
  everybody deploying these pages will see.
- **`<pre>` contents in `.astro` rely on JSX-style whitespace trimming.** Prettier
  reflows the signature markup inside `{...map()}` expressions; Astro drops
  whitespace-only text nodes that contain a newline inside expressions, so the built
  `<pre>` stays clean (verified in the built HTML for the non-overload path). Keep
  `<code>` adjacent to `<pre>` and explicit spaces as `{' '}`. Griffe 2.1.0 does not
  serialise overloads, so the overload `<pre>` has no fixture coverage in the built
  site yet.
