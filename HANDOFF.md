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
- `index.ts` and `middleware.ts` are still spike-level. `index.ts` now validates options
  through `normalizeConfig` and builds the context with `createContext`, but it passes an
  empty `dumpPaths` map (so `dumpPath` is `''`) and no inventories: extraction, inventory
  loading and the real routes belong to ROADMAP item 5. `lib/data.ts` throws a clear
  error if anything asks for a model before that wiring exists.

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
