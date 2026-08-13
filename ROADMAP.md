# Roadmap

Ordered by technical risk: each item retires the biggest open question left, so a
failure forces a re-plan as early as possible. Every item lands green (typecheck,
lint, tests) before the next starts. Status is tracked here as items complete.

## 1. Workspace scaffold: done when `pnpm install`, `pnpm typecheck`, `pnpm lint` pass

Root configs mirrored from starlight-quiz (workspace, tsconfig strictest, prettier,
eslint, prek, CI workflows), empty-but-wired `packages/starlight-pydocs`, `docs` and
`examples/vanilla`. Low intrinsic risk, but everything depends on it and it validates
the toolchain inside this sandbox (registry access, Playwright's preinstalled
Chromium, uv).

## 2. Spike: route injection under Starlight (the load-bearing assumption)

A minimal plugin injecting `[...slug]`, rendering `StarlightPage` with a hardcoded
`headings` prop, plus sidebar placeholder substitution through route middleware.
Build the docs site and assert: page renders inside the Starlight shell, ToC shows
the passed headings, Pagefind index contains the page, sidebar group appears.
If any of that fails: fall back to evaluating Markdown generation à la
starlight-typedoc, record the decision in PLAN.md and HANDOFF.md, and re-plan.
Keep the spike's route/middleware/virtual-module wiring as the real skeleton.

## 3. Extraction pipeline: runner, cache, dumps as data

`lib/runner.ts` (command → source file/URL → uvx → python -m griffe resolution,
argv-array subprocess, clear failure message), `lib/cache.ts` (content-keyed dump
cache, URL revalidation), Python fixture packages under `fixtures/` with checked-in
dumps for every docstring style plus pydantic. Risk retired: subprocess + caching +
Windows-safe path handling, and the exact dump shapes we will render from.

## 4. Model layer: the hard pure-TypeScript core

`lib/types.ts` (dump types for the fields we consume), `lib/model.ts` (alias
resolution, member filtering incl. `__all__`, inheritance with provenance via C3
over resolvable bases, overloads, page plan, symbol index), `lib/expr.ts`
(expression-tree walk + name resolution), `lib/inventory.ts` (objects.inv parse +
build). This is the highest-defect-density code; it is fully unit-tested against the
checked-in dumps before any component consumes it. Risk retired: the data model is
right before rendering starts.

## 5. Rendering: components, routes, styles

`lib/markdown.ts` (docstring prose → HTML), the component tree (Autodoc, ObjectDoc
dispatch, Module/Class/Function/Attribute docs, Signature, Annotation, docstring
sections, member groups, source links, badges, anchor headings), Starlight and
vanilla route entrypoints, `styles.css` (`@layer starlight-pydocs`, `--pydocs-*`
tokens over `--sl-*` with vanilla fallbacks), component-override virtual module.
Risk retired: the pages exist and look right in both hosts.

## 6. Docs site + vanilla example + e2e: the integration proof

The dogfooding Starlight site documents `demopkg` (a fixture package exercising all
three docstring styles, inheritance, overloads, varargs/kw-only/pos-only defaults,
`__all__`, deprecations, pydantic) and doubles as the e2e fixture; `examples/vanilla`
proves the no-Starlight path. Playwright asserts the 1.0 feature list page by page:
ToC, sidebar, anchors, linked annotations, inherited provenance, source links,
search (Pagefind + symbol search), objects.inv bytes, llms.txt content,
multi-instance bases, Autodoc inline usage. Risk retired: the features work
end to end, not just in units.

## 7. Interop endpoints and loader

symbols.json endpoint + `<PydocsSearch>` element, objects.inv publisher endpoint,
llms.txt endpoint, Content Layer loader export, inventory consumption wired into
annotation linking (fixture-served in tests). Mostly assembly on top of items 4–5.

## 8. Breadth: i18n, overrides, docs content, CI polish

Translations (en + 12 locales for generated labels), component override docs +
e2e, options reference page generated from the config types' JSDoc, mkdocstrings
migration page, README, CHANGELOG, contributing guide, pre-generated-dump CI recipe
page, starlight-versions recipe page, deploy workflow. Low technical risk, high
volume.

## 9. Stretch: version annotations across git refs

Dump-at-ref via `git worktree` into the cache (keyed by commit SHA), first-seen
version per object path, "added in <label>" and deprecation badges, docs page.
Only if 1–8 are green.
