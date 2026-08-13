# Changelog

All notable changes to `starlight-pydocs` are recorded here. New work is added under **Unreleased** and rolled into a dated version section when a release is cut.

## Unreleased

First release, still in development.

### Fixes (pre-release)

- A dump's `source_link` and absolute URIs in Sphinx inventories are scheme-checked before becoming links, so a hostile input cannot plant a `javascript:` href on a page.
- Symbol search now gives each result a unique option id, so `aria-activedescendant` follows the highlighted option instead of always naming the first one.
- `objects.inv` parsing finds the end of the header on the raw bytes rather than decoded text, so an inventory whose project name contains multi-byte characters decompresses correctly.
- The generated sidebar rebuilds after a dev-server re-extraction instead of staying stale until restart: the navigation cache is now keyed by each package's dump path.
- The dev watcher re-extracts only when a Python file inside a configured search root changes, instead of on any `.py` change anywhere in the project.

### Features

- Python API reference pages generated from a [Griffe](https://mkdocstrings.github.io/griffe/) dump (`griffe dump -f -d <style>`) and rendered by Astro components on injected routes, one page per module, with a sidebar tree, prev/next pagination and a table of contents whose anchors are dotted object paths (`mypkg.Report.generate`), matching mkdocstrings so Sphinx inventories interoperate without a mapping layer.
- Extraction that needs no Python on the docs host: the runner resolves an explicit `runner.command`, a pre-generated dump (`source: { file }` or `source: { url }`, with `ETag`/`Last-Modified` revalidation), `uvx --from griffe`, then `python -m griffe`. Dumps are cached under `node_modules/.astro` keyed on the resolved argv and the source files' mtimes, and never reach the browser.
- Signatures with linked type annotations: griffe's expression trees are walked and every name resolved through the owning scope chain, the builtins table, then configured Sphinx inventories, so `dict[str, float] | None` and `pandas.DataFrame` both link somewhere useful.
- Every docstring section griffe parses, in google, numpy, sphinx or auto style: parameters, other and type parameters, returns, yields, receives, raises, warns, attributes, examples (doctest transcripts fenced and highlighted), notes, references, admonitions and deprecations. Prose renders through the host project's own markdown processor, so it matches the rest of the site and the package depends on no markdown engine.
- mkdocstrings-style cross-references in docstring prose: `[title][dotted.path]` and `[dotted.path][]` become links to this site's pages or, through an inventory, to another project's documentation. Unresolvable targets, code spans and fenced code are left as written.
- Member selection matching mkdocstrings: `__all__` is the public surface when a module declares one, otherwise griffe's visibility flags, refined by `members` include/exclude globs on dotted paths and `filters` for special, private, imported and inherited members. Inherited members are merged from resolvable base classes over a C3 linearisation and badged with their origin.
- Symbol search: a `symbols.json` index per package and a client-side custom element ranking exact name, name prefix, path prefix and substring matches, placed automatically on each generated package page and available as `<SymbolSearch />` anywhere.
- `objects.inv` published per package with mkdocstrings-compatible roles, and consumed from `inventories: [{ url | file, base }]` or the `'python'` preset, in both directions.
- `llms.txt` per package: the whole API surface as plain Markdown, for language models and for `starlight-llms-txt`'s `optionalLinks`.
- `<Autodoc name="mypkg.Thing" />` for documenting one object inside a hand-written page, plus the whole component set and a Content Layer loader (`starlight-pydocs/loader`) that exposes one entry per documented object.
- Source links from a forge preset (`github`, `gitlab`, `bitbucket`) or a URL template with `{path}`, `{start}`, `{end}` and `{ref}` placeholders, falling back to the commit-pinned link griffe emits.
- Component overrides for nine of the rendering components, theme tokens as `--pyd-*` custom properties that default to Starlight's colours and stand alone without it, and translations for thirteen languages with label props as the per-component override.
- Usable as a Starlight plugin or as a plain Astro integration (`starlight-pydocs/astro`) with a built-in minimal layout, `layout` override, and no Starlight anywhere in its module graph.
- "Added in" badges from `versions: { refs: [{ ref, label }] }`: each ref is checked out into a git worktree under the cache directory, extracted with the same griffe invocation as the current source, and compared by object path, so every object newer than the oldest listed ref is badged with the release it appeared in. Ref dumps are keyed by commit and cached for good.
- Several releases of one package documented side by side: a `packages` entry is identified by its `base`, so the same import name may appear more than once, each entry with its own pinned dump, `label`, sidebar placeholder and endpoints. Links never cross from one documented version into another's pages.
