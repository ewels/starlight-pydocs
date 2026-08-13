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
  the owner then narrowed the requirement — the package must be processor-agnostic
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
- The checked-in dumps were produced by **griffe 2.1.0** (what uv resolved on
  2026-08-12) with `python3` 3.11.15 available as the fallback interpreter.

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
  `type alias` — the last one with a space in it.

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
- Prettier reformats Markdown, which broke the golden snapshots the moment `pnpm format`
  ran: the file no longer matched the renderer byte for byte. `tests/snapshots/**` is now
  in `.prettierignore`, next to the checked-in dumps.
- **A processor-specific markdown module cannot live in the SSR graph.** The first
  implementation of decision 7 built its own Shiki-configured processor and called it
  from components. It worked in Vitest and died in `astro build`: `Theme
'github-light' is not included in this bundle`. Astro tree-shakes Shiki's bundled
  theme and language tables out of the server bundle (`bundledThemes` becomes `[]`), so
  only themes the host's own config asked for exist at render time. Pre-rendering at
  `astro:config:done` sidesteps this entirely — that code runs in the config process,
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
- **`pnpm format` wants to reformat PLAN.md** (`*emphasis*` → `_emphasis_` on one
  line). Left alone deliberately — this agent was told not to touch PLAN.md — so the
  first `prek run --all-files` will show that one-line diff.
- **`<pre>` contents in `.astro` rely on JSX-style whitespace trimming.** Prettier
  reflows the signature markup inside `{...map()}` expressions; Astro drops
  whitespace-only text nodes that contain a newline inside expressions, so the built
  `<pre>` stays clean (verified in the built HTML for the non-overload path). Keep
  `<code>` adjacent to `<pre>` and explicit spaces as `{' '}`. Griffe 2.1.0 does not
  serialise overloads, so the overload `<pre>` has no fixture coverage in the built
  site yet.

## Progress log

- 2026-08-12: planning docs committed; workspace scaffolded (mirrors starlight-quiz;
  `pnpm install`, `lint`, `typecheck`, docs build all green in-sandbox); spike passed
  — injected route + StarlightPage `headings` prop feeds the ToC with dotted-path
  anchors intact, Pagefind indexes the pages, middleware sidebar swap works
  (details in PLAN.md decision 1).
- 2026-08-12: ROADMAP items 3 and 4 landed. Python fixtures (`demopkg`, `numpkg`,
  `sphpkg`) with checked-in dumps regenerated by `pnpm gen:dumps`; extraction pipeline
  (`config`, `runner`, `cache`, `errors`, `logger`, `paths`, `types`); model core
  (`model`, `expr`, `signature`, `inventory`, `data`, `strings`, `markdown-doc`,
  `context`). 253 Vitest tests, including a golden Markdown snapshot of the demopkg
  report page and a uv-guarded live extraction test. Format, lint, typecheck and tests
  all green. Nothing renders yet: components and routes are ROADMAP item 5.
- 2026-08-13: ROADMAP item 5 and item 7's endpoints and loader landed — the pages
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
