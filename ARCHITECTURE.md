# Architecture

`starlight-pydocs` generates Python API reference documentation for Astro and Starlight
sites. It extracts the API surface with [Griffe](https://mkdocstrings.github.io/griffe/)
(`griffe dump -f -d <style>`) and renders it with Astro components on injected routes.
This document records the architecture decisions, the reasoning behind each, the
alternatives rejected, and the griffe behaviour the implementation depends on.
`AGENTS.md` documents day-to-day working conventions. Decision numbers are stable: code
comments cite them as "ARCHITECTURE.md decision N".

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

The mechanism is starlight-openapi's: the route renders `StarlightPage` with a
`headings` prop, which feeds the table of contents and renders the standard shell
(including `data-pagefind-body`), and a route middleware swaps a placeholder sidebar
group for generated links. Dotted-path heading IDs survive verbatim into the ToC links.

Rejected alternative: generating `.md`/`.mdx` files (starlight-typedoc's approach).
Simpler to implement and it composes with every content-collection consumer for free,
but the lossy-representation costs above are permanent, and linked annotations inside
signatures and symbol search metadata are impractical in it. The compat costs of route
injection (llms-txt, versions) are handled explicitly in decisions 10 and 11 instead.

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
`routes/starlight.astro`.

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
regardless.

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
- **Overloads.** The model keeps each overload signature plus the implementation
  docstring, rendered as stacked signatures (but see the griffe notes: 2.1.0 does not
  serialise them).
- **Symbol index.** A flat map of canonical path → { kind, page slug, anchor, brief }
  built once and reused by: cross-linking, the search index endpoint, the objects.inv
  publisher, the loader, and `<Autodoc>` name resolution.
- **Page plan.** One page per module (packages and subpackages become nested index
  pages), mirroring mkdocstrings' mental model. Sidebar tree mirrors the module tree.
  `<Autodoc>` covers bespoke layouts, so there is no page-per-symbol mode.

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
and the package depends on neither engine. Astro 7.2 defaults `markdown.processor` to
`satteri()`; sites that must stay on the unified pipeline (mermaid,
`starlight-links-validator`) use `unified()` from `@astrojs/markdown-remark`, and
Starlight supports both. Hardcoding either engine halves the addressable audience. The
`MarkdownProcessor` interface (`name`, `options`, `createRenderer(shared) → { render }`)
is processor-agnostic, so the resolved `astroConfig.markdown.processor` is all we need.

The constraint that shapes the mechanics: the live processor instance exists only in
the config-time process, while routes and components execute in Vite's SSR module
graph, and a processor cannot be serialised into a virtual module. So docstring prose
is rendered **eagerly at `astro:config:done`**, which runs after every integration's
`astro:config:setup` has finished mutating `processor.options`, so docstrings render
through the same final pipeline as the site's own content. The rendered HTML is written
to a sidecar JSON beside the cached dump; `lib/data.ts` loads it like the dump and
components consume pre-rendered HTML strings. The dev watcher re-renders after
re-extraction. Doctest `>>>` blocks are fenced as `python` before rendering (`pycon`
is not in Sätteri's bundled Shiki set). Griffe admonition sections render as our own
aside markup in components, not through directives.

Rendered docstring HTML is deliberately **not sanitised**: whatever a docstring says
lands on the page, the same trust model as mkdocstrings. The tool is used almost
exclusively by people documenting their own packages, whose docstrings are as trusted
as the site's own MDX; a sanitize-html allowlist was built and removed as not worth its
fragility and the dependency. The pre-generated-dumps guide states the corollary: a
dump is content for your site. Hrefs the package builds itself from semi-trusted inputs
(a dump's `source_link`, absolute URIs in fetched inventories) are the exception and
pass through `safeHref` in `lib/paths.ts`.

Astro 7.0.x, where `markdown.processor` does not exist: fall back to
`@astrojs/markdown-remark`'s `createMarkdownProcessor(astroConfig.markdown)`,
loaded via a top-level `import(…).catch(() => null)` exactly as Starlight does
(late dynamic imports from config-loaded modules hit the closed module runner),
with `@astrojs/markdown-remark` declared as an optional peer. On 7.0.x astro itself
depends on markdown-remark, so the import resolves precisely where the fallback is
needed.

Deprecated surface avoided everywhere, including docs and fixtures: top-level
`markdown.remarkPlugins`, `rehypePlugins`, `remarkRehype`, `gfm` and `smartypants`
are all scheduled for removal; heading IDs, directives and math come from Sätteri's
native `features` when a site wants them, never from plugins we add.

Rejected alternatives. Pinning `@astrojs/markdown-remark`: forces a non-default extra
dependency on every Astro 7 site. Pinning `@astrojs/markdown-satteri`: breaks
unified-locked sites. Rendering lazily at request time via a `globalThis` bridge into
the SSR graph: works in dev and static builds but leans on process-sharing internals
and dies on deployed SSR.

Test coverage: the docs site runs the Astro 7 default (Sätteri); the vanilla example
site pins `markdown: { processor: unified() }`, so CI exercises both engines end to end.

**Signature colours follow the same rule.** Shiki highlighting of signatures is
produced at `astro:config:done` into a sidecar beside the dump
(`libs/signature-highlighter.ts` writes it, `lib/highlight.ts` reads it). At render
time it cannot work: Astro tree-shakes Shiki's bundled themes out of the server bundle,
so a highlighter in the SSR graph fails with ``Theme `github-light` is not included in
this bundle``, and a Starlight site always asks for such a theme because Expressive
Code owns its prose code. Unit tests run in plain Node with the full bundle and cannot
see this, so `docs/tests/e2e/docs/content.spec.ts` asserts colours on a **built** page.
The sidecar is keyed by signature text, so a signature repeated across pages is
coloured once, and a missing or stale entry costs colours rather than correctness.
Shiki is a direct dependency on the same major as Astro's, not reached through the
optional `@astrojs/markdown-remark` peer, which Sätteri sites do not install.

### 8. Search: Pagefind for prose, a symbol index for symbols

Generated pages are indexed by Pagefind automatically because `StarlightPage` renders
the standard shell. On top, symbol-level search: an injected endpoint route serves
`<base>/symbols.json`, a small payload built from the symbol index (name, kind, path,
url, brief), and a `<PydocsSearch>` custom element does client-side substring +
CamelCase/dot-segment matching, grouped by kind, keyboard accessible. Users can place
it anywhere via `starlight-pydocs/components`; nothing in it touches Starlight.

Both page routes render `<SymbolSearch>` above the module documentation on package
root pages only. It sits in the routes rather than in `ModuleDoc` on purpose: an
`<Autodoc name="mypkg" />` of a package root would otherwise grow a search box in the
middle of a hand-written page.

### 9. Sphinx inventories, both directions

- **Consume:** `inventories: [{ url | file, base }]` parses `objects.inv` (Sphinx v2
  format: four header lines then zlib-compressed `name domain:role priority uri
dispname` lines) with `node:zlib`. Parsed entries feed annotation resolution
  (decision 6) so `pandas.DataFrame` links out to pandas' docs. Lookups are restricted
  to the `py` domain: a `std:label` named `str` would otherwise link a Python
  annotation to a page about something else. Fetched inventories cache to the cache
  dir; a `python` preset ships the stdlib base URL.
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

### 11. Versioned docs: one instance, one entry per version, keyed by base

starlight-versions snapshots content files, not routes. The supported pattern is one
plugin instance with one package entry per documented version, each with its own
`base` (`api/demopkg`, `1x/api/demopkg`, …), a pinned `source` dump generated at the
matching git tag, and its own sidebar placeholder from `createPydocsSidebarGroup()`,
which slots straight into starlight-versions' per-version sidebars.

This works because **a package entry is identified by its `base`, not by its name**.
Bases are validated unique and non-overlapping, so the base is the key for the dump
and sidecar maps, the model cache, the route props, endpoint matching and every
context lookup; the name is only the dump key and griffe's `packageName`. Keying the
sidecar path by base also matters because rendered prose contains base-specific
cross-reference hrefs, so two entries pinned to one dump must not share it.

- A per-package `label` (default `name`) names an entry for humans in the sidebar
  group, the `llms.txt` heading and the published inventory, so `demopkg 1.x` and
  `demopkg` are distinguishable in one site.
- `<Autodoc>` and `<SymbolSearch>` resolve a `package` prop as a base first and an
  import name second. A bare name that several entries answer to is an error naming
  the candidate bases, never a silent pick; `<SymbolSearch>` renders nothing.
- Cross-reference resolution skips entries whose import name matches the rendered
  one, so one documented version never links into another's pages.

Registering the plugin twice is not supported: both instances would resolve the same
`virtual:starlight-pydocs/context` id and inject the same catch-all route. Per-version
_builds_ remain documented as the alternative for wholly separate deployments. The
docs site documents `demopkg` twice as the e2e fixture.

### 12. Version annotations by diffing dumps across refs

`griffe check` has no machine-readable output (oneline/verbose/markdown/github/azdo
only), so annotations come from data we already know how to produce:
`versions: { refs: [{ ref, label }, …] }` per package, oldest first, and a dump per
ref. Comparing object paths across successive dumps yields "added in <label>" for each
object's first appearance.

The split is git on one side and arithmetic on the other. `lib/ref-extract.ts` resolves
each ref with `git rev-parse --verify <ref>^{commit}`, checks it out with
`git worktree add --detach <cacheDir>/starlight-pydocs/worktrees/<sha>`, rebases the
package's search paths onto the worktree and runs the same `griffe dump` through
`resolveGriffeLauncher`/`runGriffe`, so a ref is extracted exactly as the working tree
is. Ref dumps live at `<cacheDir>/starlight-pydocs/versions/<name>-<sha12>-<options12>/dump.json`;
a commit is immutable and the options half is machine independent, so an existing dump
is never re-made and later builds do no git work. `lib/versions.ts` is pure and unit
tested over hand-written dumps: `collectDumpPaths`, `firstSeenLabels` oldest-first, and
`addedInLabel` falling back from the documented path to the canonical one so re-exports
and inherited members inherit their definition's history.

The labels travel as a sidecar (`versions-<key>.json`), like docstring HTML, written
during `preparePydocs` rather than at `astro:config:done` because it needs no markdown
processor. `buildModel` sets `DocObject.addedIn`; it is kept out of the model cache key,
which is safe because a dev re-extraction calls `clearCaches()`.

Deliberate silences: objects in the oldest listed ref get no badge ("added in 1.0" over
most of a package is noise), and objects in none of the refs get none either (the
current source has no version number). `versions` with `source.file`/`source.url` is a
config error, since a pinned dump has no history behind it. There is no e2e coverage:
the fixture packages have no meaningful history, so a git+uv-guarded live test builds a
throwaway two-commit repository instead.

### 13. Everything else follows starlight-quiz conventions

pnpm workspace (`packages/starlight-pydocs` + `docs` + `examples/vanilla`), no build
step, `astro/tsconfigs/strictest`, Vitest for `lib/`, Playwright e2e against the built
docs site and the vanilla example, prek running prettier, eslint and typecheck, CI
running prek, unit, e2e and zizmor jobs, docs on GitHub Pages, releases via manual
changelog plus tag plus OIDC trusted publishing. `styles.css` is wrapped in
`@layer starlight-pydocs`; theme tokens are `--pyd-*` custom properties (matching the
`.pyd-` class prefix) that default to Starlight's `--sl-*` tokens with static fallbacks
for vanilla sites. i18n mirrors quiz: `lib/strings.ts` holds English defaults,
`translations.ts` holds locale tables injected via `i18n:setup`, and every component
accepts label props as the vanilla override.

## Implementation decisions

Finer-grained decisions, each answering a "why is it like this" the code alone does not.

- **`__all__` selects members, not navigation.** When a module defines `__all__`, that
  list is the documented member surface of the module, exactly as mkdocstrings does.
  Submodules are the exception: they get pages whether or not they are exported, filtered
  only by privacy (`_internal` stays hidden) and the user's `members` globs. Otherwise
  `demopkg`'s curated `__init__` surface would hide `demopkg.report` entirely, which is
  not what anyone means by "document my package".
- **Re-exported objects are documented at both paths** (`demopkg.Report` and
  `demopkg.report.Report`), again mirroring mkdocstrings. The model records
  `canonicalPath` and `reexportedFrom` on the re-export, and `documentedPathFor()`
  picks the shortest documented path when a link needs to choose one.
- **Fixture dumps are post-processed for portability.** `fixtures/generate-dumps.ts`
  rewrites absolute `filepath` values to repository-relative ones and drops `git_info`
  and `source_link`, which embed the machine path and the current commit hash, so
  `pnpm gen:dumps` does not produce a diff on every commit.
- **No TypeScript parameter properties (or other non-erasable syntax) anywhere in
  `lib/`**: `fixtures/generate-dumps.ts` runs under `node --experimental-strip-types`,
  which only handles erasable syntax, and any future script may import any lib module.
- **The pre-rendered docstring sidecar is keyed by canonical path and section index.**
  `<cacheDir>/starlight-pydocs/<pkg-hash>/rendered.json` (or, for a user-supplied
  `source.file` dump we must not write next to, `…/rendered/<pkg>-<hash>/rendered.json`)
  maps canonical object path → section index → `{body, entries, blocks}` plus a
  `deprecated` slot. Re-exports and inherited members share the definition's prose, so
  components look up `doc.canonicalPath`, not `doc.path`. The sidecar is rewritten on
  every `astro:config:done`: its content depends on the host's markdown pipeline, which
  can change without the dump changing.
- **`ObjectDoc` owns the member recursion, not the kind-specific bodies.** It recurses
  with `Astro.self` (the same trick Starlight's `SidebarSublist` uses) and dispatches
  only signature-and-docstring bodies to `ClassDoc`/`FunctionDoc`/`AttributeDoc`. That
  keeps the module graph acyclic even though the bodies are imported through
  `virtual:starlight-pydocs/components`, which `ObjectDoc` itself is reachable from.
  Modules never appear as members inside a page (submodules get their own pages), so
  `ModuleDoc → ObjectDoc` is a one-way edge.
- **Attributes get real headings.** `pageHeadings()` lists every class member at depth
  3, so a heading-less attribute would be a dead table-of-contents link. For the same
  reason inherited-member `<details>` blocks are `open` by default: a collapsed one
  hides live anchor targets.
- **`sourceLink.root`** exists because griffe's `relative_filepath` is relative to its
  working directory (the Astro project root), so a docs site with sources one level up
  got absolute paths in public URLs. `root` names the directory `{path}` is computed
  against, from the absolute `filepath`. The docs site uses `root: '..'`.
- **`sidebar.group` on a package config** accepts a placeholder from
  `createPydocsSidebarGroup()` and normalises to its label string, so one site can
  place different packages in different parts of the sidebar (starlight-openapi's
  `createOpenAPISidebarGroup` pattern).
- **The docs site is the e2e fixture.** `demopkg` (uvx + `griffe_pydantic`, google),
  `numpkg` (uvx, numpy), `sphpkg` (no extraction: a checked-in dump, sphinx, its own
  sidebar placeholder) and `demopkg` again at `1x/api/demopkg` (pinned dump, its own
  placeholder under a `v1.x` sidebar section). One build exercises both extraction
  strategies, all three docstring parsers, per-package sidebar placement,
  multi-package endpoints and one package name at two bases.
- **Inventories are tested from a checked-in `objects.inv`.** `pnpm gen:inventory`
  writes the thirteen stdlib names the fixture packages annotate with, at CPython's real
  URIs, and the docs site consumes it with `base: 'https://docs.python.org/3/'`, so
  external annotation links are assertable offline.
- **Cross-references in docstring prose are resolved by rewriting the Markdown**, not
  by a plugin in the host's pipeline (which decision 7 rules out). `lib/crossrefs.ts`
  turns `[title][dotted.path]` and `[dotted.path][]` into ordinary Markdown links
  before the string reaches the processor, and only when the target resolves: fenced
  code, inline code spans, escaped brackets and targets that have a real reference
  definition in the same string are left alone, and an unresolved target keeps its
  brackets. Resolution order is the rendered package's symbol index, then the other
  configured packages', then the Sphinx inventories. Indented (four-space) code blocks
  are not detected as code: telling them from list continuations needs a block parser,
  and griffe hands us dedented prose whose examples arrive fenced.

## Griffe dump field names, as actually emitted (2.1.0)

Verified against generated dumps, not documentation. `lib/types.ts` follows these.

- Both `-f` and `-d <style>` are needed: without `--full` there are no file paths or
  visibility flags (`is_public`, `is_imported`, …), and without `-d` docstrings stay raw
  text instead of structured sections. `members` maps are keyed by member name. The
  dump JSON schema is vendored under `packages/starlight-pydocs/tests/fixtures/`.

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
- Prettier reformats Markdown, so the golden snapshots (which must match the renderer
  byte for byte) are in `.prettierignore` as `tests/snapshots/**`, next to the
  checked-in dumps.
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
