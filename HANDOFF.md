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
- **Docstring prose renders through the host's configured markdown processor**
  (PLAN.md decision 7, third iteration). History, for anyone reading old commits:
  the plan first pinned `@astrojs/markdown-remark`; the owner then asked for
  `@astrojs/markdown-satteri` (briefly implemented, including the dependency swap);
  the owner then narrowed the requirement: the package must be processor-agnostic
  because Astro 7 defaults to Sätteri while unified-locked sites (mermaid,
  starlight-links-validator) cannot leave remark. The satteri dependency and the
  processor-specific `lib/markdown.ts` were unwound in favour of
  `processor.createRenderer()` at `astro:config:done` with pre-rendered HTML in a
  sidecar file. Neither engine appears in the package's dependencies;
  `@astrojs/markdown-remark` is an optional peer for the Astro 7.0.x fallback only.
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
- **Theme tokens are `--pyd-*`**, not the `--pydocs-*` this file and PLAN.md first
  said; the class prefix is `.pyd-` and having the two agree is worth more than the
  older spelling. CLAUDE.md is updated to match.
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
  what PLAN.md decision 8 promised and the previous session left unimplemented. Both
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
  documentable at several bases (PLAN.md decision 11), and it removes a real collision:
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
- **The vanilla example pins `markdown: { processor: unified() }`.** PLAN.md decision
  7 promises both engines are exercised in CI; the docs site runs Astro's default
  (Sätteri), so the example imports `unified()` from `@astrojs/markdown-remark`. The
  e2e assertions are engine-visible on purpose: expressive-code figures on the docs
  site, `.astro-code` on the vanilla one.

## Environment notes (this sandbox)

- `uvx --from griffe griffe dump` works here (~0.8 s cold) and PyPI is reachable
  through the proxy, as is the npm registry. **docs.python.org is not reachable**
  (curl exit 000), so inventory tests use checked-in fixtures and a local HTTP
  server; nothing in the test suite fetches external doc sites.
- `griffe-pydantic` works fully statically (`uvx --with griffe-pydantic --from griffe
griffe dump -e griffe_pydantic …`): the fixture model gets the `pydantic-model`
  label without pydantic importable. Verified 2026-08-12 with griffe resolved by uv.
- Playwright must use the pre-installed Chromium at `/opt/pw-browsers/chromium`
  (config handles the fallback), and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set, so
  don't run `playwright install` here.
- **`astro preview` daemonises itself when it detects an agentic environment**
  (`am-i-vibing` sees `CLAUDECODE`), so Playwright's `webServer` saw the command exit
  immediately and gave up with "Process from config.webServer exited early". Setting
  `ASTRO_PREVIEW_BACKGROUND=1` opts out of the detection and keeps the server in the
  foreground, which is why both `webServer` entries pass it in `env`. Counter-intuitive
  name, correct behaviour (astro's `dist/cli/preview/index.js`), and a no-op wherever
  no agent is detected, CI included. Related: `pnpm --filter … preview -- --port N`
  does **not** work: astro reads the extra `--` as a subcommand and exits with
  "Unknown command"; pass `--port N` with no `--`.
- The checked-in dumps were produced by **griffe 2.1.0** (what uv resolved on
  2026-08-12) with `python3` 3.11.15 available as the fallback interpreter.
- `git` 2.43 is available, and `git worktree add --detach` works here, which is what
  the version-annotation live test exercises. It builds its own repository in a temp
  directory; nothing in the suite touches this repository's git state.

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
- **Adding `versions.refs` to the docs site would need `fetch-depth: 0` in the Pages
  deploy workflow.** The docs site does not use the option (the fixture packages have no
  release history), so the workflow is untouched; anybody enabling it on a real site has
  to deepen the checkout, which `guides/version-annotations.mdx` says.
- **Without `sourceLink.root`, a `title` on the source link can leak an absolute
  path.** Griffe's `relative_filepath` is relative to its working directory, so when
  the sources sit outside the Astro project (the vanilla example's `../../fixtures`)
  it is an absolute path, and `SourceLink` puts it in the link's `title`. The href is
  fine (griffe's own commit-pinned `source_link` is used when no template is
  configured). Setting `sourceLink.root` fixes both; the docs site does, the vanilla
  example deliberately does not, so the griffe fallback keeps its coverage.
- **Multi-instance registration still does not work, and now does not need to.** Two
  plugin instances share one `virtual:starlight-pydocs/context` id and both inject
  `[...pydocsSlug]`, so the second instance's packages are invisible at render time (a
  build against `examples/vanilla` died with `no configured package serves
/api/v1/numpkg/llms.txt`). Rather than namespacing the virtual modules and the route
  pattern per instance, one instance now covers the versioned-docs use case: one entry per
  version, keyed by base. If multi-instance is ever wanted for another reason, the
  namespacing is the work, and nothing in the base re-key makes it harder.

## Stuck points and workarounds

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
- **A processor-specific markdown module cannot live in the SSR graph.** The first
  implementation of decision 7 built its own Shiki-configured processor and called it
  from components. It worked in Vitest and died in `astro build`: `Theme
'github-light' is not included in this bundle`. Astro tree-shakes Shiki's bundled
  theme and language tables out of the server bundle (`bundledThemes` becomes `[]`), so
  only themes the host's own config asked for exist at render time. Pre-rendering at
  `astro:config:done` sidesteps this entirely: that code runs in the config process,
  where the untrimmed Shiki bundle is available.
- **Under Starlight, docstring code fences come out as expressive-code**, not
  `.astro-code`: Starlight registers expressive-code on the processor, and we render
  through the host's processor, so docstring code blocks match the rest of the site for
  free. Two consequences: our `.astro-code` rules only bite in plain Astro, and EC
  emits its `<link>`/`<script>` tags inline in the body for these blocks rather than
  hoisting them to `<head>` (harmless, deduplicated by URL, but visible in the HTML).
- **`astro check` only type-checks files inside its own project.** The package's
  `.astro` components live in `packages/starlight-pydocs`, so the docs site compiled
  them without ever type-checking them. `docs/tsconfig.json` now includes the
  package's `components/`, `layouts/`, `routes/`, `libs/` and root `.ts` files; that
  raised the check from 4 files to 46 and caught two real type errors (`Response` will
  not take a `Uint8Array<ArrayBufferLike>`, so `buildInventory` now returns
  `Uint8Array<ArrayBuffer>`; and `exactOptionalPropertyTypes` needs one commented cast
  on the Astro 7.0.x `createMarkdownProcessor` fallback).
- **`pnpm format` once wanted to reformat PLAN.md** (`*emphasis*` → `_emphasis_` on one
  line). Since resolved: the file was run through prettier, and `pnpm format:check` is
  clean across the repository.
- **Three bugs fell out of building the two fixture sites, all fixed.** (1)
  `loadInventories` read local `objects.inv` files through
  `await import('node:fs/promises')`, and it runs from `config:setup`, whose module
  runner Vite has already closed: every file inventory was dropped with a warning and
  annotations quietly lost their external links. The builtin is imported statically
  now. (2) The vanilla integration forwarded only `astro:config:setup` and
  `astro:server:setup` to the shared integration, so `astro:config:done` never ran and
  no plain-Astro build could render a page ("the pre-rendered docstrings … are
  missing"). Every hook of the shared integration must be forwarded. (3)
  `import 'starlight-pydocs/styles'` failed `astro check` in a consumer project
  (ts(2882), `noUncheckedSideEffectImports` from `astro/tsconfigs/strictest`); the
  subpath now resolves to an empty `styles.d.ts` under the `types` condition.
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

## Progress log

- 2026-08-12: planning docs committed; workspace scaffolded (mirrors starlight-quiz;
  `pnpm install`, `lint`, `typecheck`, docs build all green in-sandbox); spike passed:
  injected route + StarlightPage `headings` prop feeds the ToC with dotted-path
  anchors intact, Pagefind indexes the pages, middleware sidebar swap works
  (details in PLAN.md decision 1).
- 2026-08-12: ROADMAP items 3 and 4 landed. Python fixtures (`demopkg`, `numpkg`,
  `sphpkg`) with checked-in dumps regenerated by `pnpm gen:dumps`; extraction pipeline
  (`config`, `runner`, `cache`, `errors`, `logger`, `paths`, `types`); model core
  (`model`, `expr`, `signature`, `inventory`, `data`, `strings`, `markdown-doc`,
  `context`). 253 Vitest tests, including a golden Markdown snapshot of the demopkg
  report page and a uv-guarded live extraction test. Format, lint, typecheck and tests
  all green. Nothing renders yet: components and routes are ROADMAP item 5.
- 2026-08-13: ROADMAP item 5 and item 7's endpoints and loader landed, so the pages
  exist. Docstring prose renders through the host's processor into a sidecar
  (`lib/docstrings.ts`, `libs/docstring-renderer.ts`), the component set renders
  modules, classes, functions, attributes, signatures with linked annotations, every
  docstring section, badges, provenance, source links, member summaries, collapsible
  inherited members and a client-side symbol search; the Starlight route, the vanilla
  route with its built-in layout, and the `symbols.json`, `objects.inv` and `llms.txt`
  endpoints are injected by one shared setup used by both the plugin and the vanilla
  integration; the middleware builds the real sidebar tree and pagination; a Content
  Layer loader exposes the same model as data. 320 Vitest tests. The docs site
  documents `demopkg` from the fixture source through `uvx --with griffe-pydantic`,
  and `pnpm build` produces the five pages plus all three endpoint files. Verified in
  the built HTML of `/api/demopkg/report/`: the `__init__`-merged `class Report(name:
str, scores: dict[str, float] | None = None)` signature, six distinct internal
  annotation links, the parameter tables, 21 dotted-path anchors matching the ToC,
  deprecation and kind badges, inherited-from provenance, source links, asides and
  `data-pagefind-body`. `examples/vanilla` and the Playwright suite are next
  (ROADMAP item 6); nothing here has been exercised without Starlight yet beyond
  type-checking.
- 2026-08-13: ROADMAP item 6 landed: both fixture sites and the end-to-end suite.
  The docs site grew to three packages (`demopkg`, `numpkg`, `sphpkg`) plus the local
  inventory fixture and four content pages (introduction, getting started, vanilla
  Astro, autodoc; `autodoc-demo.mdx` is gone, the slug is `/guides/autodoc/`).
  `examples/vanilla` is a plain Astro site on the unified markdown pipeline with the
  integration, a hand-written `<Autodoc>`/`<SymbolSearch>` page and a Content Layer
  loader page. `docs/playwright.config.ts` builds and previews both and runs seven
  spec files, 34 tests, all passing in about 28 s end to end including both builds
  (uvx cache warm). Three package bugs surfaced and were fixed (see "Stuck points"):
  the inventory dynamic import, the missing `astro:config:done` forward in the vanilla
  integration, and the untyped `styles` export. Unit tests stayed at 321. Two gaps are
  recorded rather than papered over: symbol search is not auto-placed on generated
  pages, and mkdocstrings cross-references inside docstring prose are not resolved.
- 2026-08-13: ROADMAP item 8 landed, plus the two gaps above. `lib/crossrefs.ts`
  rewrites `[title][target]` and `[target][]` references into Markdown links during the
  sidecar render pass, resolving against the rendered package's symbol index, the other
  packages' and then the inventories; the routes place `<SymbolSearch>` on package root
  pages. `translations.ts` grew twelve locales (de, es, fr, it, ja, ko, nl, no, pt-BR,
  ru, sv, zh) with `tests/translations.test.ts` guarding them. The repository has a
  README, a CHANGELOG whose **Unreleased** section describes the initial feature set,
  and `docs/scripts/sync-changelog.mjs` generating the (gitignored) `/changelog/` page
  before dev, build and typecheck. Thirteen new documentation pages cover
  configuration, docstring styles, cross-references, source links, search, theming,
  component overrides, i18n, multiple packages, versioned docs, pre-generated dumps,
  llms.txt, migrating from mkdocstrings and contributing, and `vanilla-astro.mdx` grew
  from a stub into the full integration guide. 351 unit tests, 36 e2e tests, 27 built
  pages with no broken internal link and no link missing the `/starlight-pydocs`
  prefix. Three claims were checked against the code rather than the plan and written
  as the code behaves: symbol search ranks by exact/prefix/substring rather than the
  CamelCase matching the plan describes, vanilla generated pages take labels from
  `Astro.locals.t` (the route passes no `labels` prop), and multi-instance versioning
  does not work (see "Things to double-check").
- 2026-08-13: ROADMAP item 9 landed, and with it the honest version story. Package
  entries are now identified by their URL base rather than their import name, so one
  package can be documented at several bases: the docs site documents `demopkg` twice
  (from source at `/api/demopkg/`, from the checked-in dump at `/1x/api/demopkg/`, in
  a `v1.x` sidebar group of its own), which is the shape PLAN.md decision 11 promised
  and multi-instance registration could not deliver. Version annotations shipped as
  `versions: { refs: [{ ref, label }] }`: `lib/ref-extract.ts` materialises each ref
  as a git worktree under the cache directory and dumps it through the same launcher
  the working tree uses, `lib/versions.ts` does the oldest-first diff, and
  `DocObject.addedIn` renders as an "Added in <label>" badge beside the kind badge (and
  in `llms.txt`, and as `addedIn` on loader entries). 385 unit tests, 40 e2e tests, 32
  built pages. The badge rendering was checked in a real build by pointing the docs
  fixture at a throwaway branch with one function removed: `demopkg.report.generate_report`
  came out badged `Added in 0.2` on both its definition page and its re-export, and the
  pinned 1.x entry stayed unbadged. That configuration was not committed: the fixture
  packages have no meaningful release history, so the pipeline's regression coverage is
  the guarded live test against a throwaway repository instead.
- 2026-08-13: final integration pass. Prose swept to the repository's writing rules
  (no em dashes, no bold-led bullets) across the README, the changelog, every docs
  page and the code comments, then across PLAN.md, ROADMAP.md, HANDOFF.md and
  CLAUDE.md; the log-entry and gotcha bullets in HANDOFF.md and CLAUDE.md keep their
  bold lead deliberately, matching starlight-quiz's own convention for these files.
  ROADMAP.md now carries a status line per item (all nine complete). The exact CI
  check (`prek run --all-files`) was run in-sandbox before the final push. Not done
  in this session, by instruction: no npm publish, no GitHub release, no PR. CI has
  not yet run on GitHub (the workflows trigger on pull_request and push to main;
  everything so far lives on the working branch), so the first PR is also the first
  live CI run.
- 2026-08-13: whole-project /simplify pass, four parallel agents in isolated git
  worktrees (data layer, model layer, render surface, glue and sites), each gated
  on format/lint/typecheck/unit tests and verified against byte-identical rendered
  output where it touched rendering. Merged as one commit per section plus a
  coordinator commit for the cross-section consolidations no single agent could
  apply (shared route preamble in `libs/route.ts`, `memberList` adoption,
  navigation cache keyed by dump path, explicit numpkg source links). The pass
  also surfaced three real defects, fixed separately: the inventory header
  byte/character offset bug, non-unique symbol-search option ids breaking
  `aria-activedescendant`, and the dev-server sidebar staying stale after
  re-extraction. Suggestions deliberately deferred for a human decision:
  `lib/data.ts` caches values rather than in-flight promises (concurrent renders
  can duplicate model builds; blocks parallelising the docstring render loop);
  four near-identical error-message helpers could share one home
  (`cache.describeError`, `integration.describe`, `ref-extract.gitMessage`,
  `runner.processOutput`); the dev watcher re-extracts on any `.py` change
  anywhere rather than only under the search roots; `SectionThrown` and
  `SectionValues` are near-duplicates whose merge changes whitespace;
  `parameterKindLabel` is wired and translated in all locales but rendered
  nowhere (render it or delete helper plus keys together); `virtual.d.ts` and
  `OVERRIDABLE_COMPONENTS` list the nine overridable components independently
  and could drift.
