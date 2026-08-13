<div align="center">

# starlight-pydocs

[![npm version](https://img.shields.io/npm/v/starlight-pydocs.svg)](https://www.npmjs.com/package/starlight-pydocs)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/ewels/starlight-pydocs/blob/main/LICENSE)
[![Documentation](https://img.shields.io/badge/docs-ewels.github.io-7c3aed.svg)](https://ewels.github.io/starlight-pydocs)

</div>

Python API reference documentation for [Starlight](https://starlight.astro.build/) and plain
[Astro](https://astro.build/) sites. It reads your package with
[Griffe](https://mkdocstrings.github.io/griffe/) — static analysis, so nothing is imported and nothing needs
installing — and renders the result with Astro components on injected routes, one page per module. It is the Starlight
counterpart of [mkdocstrings-python](https://mkdocstrings.github.io/python/) and follows its conventions where they
make sense: heading anchors are dotted object paths, `__all__` selects the documented surface, `objects.inv` works in
both directions, and `::: name` becomes `<Autodoc name="…" />`.

## Features

- 📄 **A page per module**, with a sidebar tree, a table of contents built from dotted-path anchors, and prev/next links
- 🔗 **Signatures with linked types** — every name in an annotation resolves through the scope chain, the builtins table, then Sphinx inventories
- 📝 **Every docstring section** in google, numpy or sphinx style: parameters, returns, raises, examples, admonitions, deprecations
- ↔️ **Cross-references in prose** — mkdocstrings' `[title][dotted.path]` syntax becomes a real link, or stays literal when nothing resolves it
- 🧬 **Inherited members** merged from resolvable base classes, badged with the class they came from
- 🔍 **Symbol search** on every generated package page, and `<SymbolSearch />` anywhere you want it
- 📚 **`objects.inv` and `llms.txt`** per package, so other documentation sites and language models can consume yours
- 🎯 **`<Autodoc>`** to drop one class or function into a hand-written page
- 🐍 **No Python at build time** when you point at a dump your project's CI published
- 🌐 **Thirteen languages** out of the box, with label props for sites that translate their own way
- 🧩 **Works anywhere** — a Starlight plugin, or an Astro integration with no Starlight in its module graph

## Installation

```sh
npm install starlight-pydocs
```

## Usage

### As a Starlight plugin

Name the package, point `search` at the directory that contains it, and put the sidebar placeholder where the generated
pages belong:

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightPydocs, { pydocsSidebarGroup } from 'starlight-pydocs';

export default defineConfig({
  integrations: [
    starlight({
      title: 'My project',
      plugins: [
        starlightPydocs({
          packages: [{ name: 'mypkg', search: ['../src'] }],
          inventories: ['python'],
        }),
      ],
      sidebar: [{ label: 'API reference', items: [pydocsSidebarGroup] }],
    }),
  ],
});
```

`mypkg` is documented at `/api/mypkg/`, one page per module, alongside `symbols.json`, `objects.inv` and `llms.txt`.

### In any Astro project

`starlight-pydocs/astro` injects the same routes with a minimal built-in layout, overridable with the `layout` option.
Nothing in its module graph imports Starlight:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import pydocs from 'starlight-pydocs/astro';

export default defineConfig({
  integrations: [pydocs({ packages: [{ name: 'mypkg', search: ['../src'] }] })],
});
```

### One object in a hand-written page

`<Autodoc>` is the equivalent of mkdocstrings' `::: mypkg.Thing` directive, and renders exactly what the generated
pages render:

```mdx
import { Autodoc } from 'starlight-pydocs/components';

<Autodoc name="mypkg.Thing" />
<Autodoc name="mypkg.build" headingLevel={3} />
```

## Requirements

- Node ≥ 22.12 and Astro ≥ 7.
- Starlight ≥ 0.41 for the plugin. The Astro integration needs no Starlight at all.
- Python only where extraction runs. [`uv`](https://docs.astral.sh/uv/) on `PATH` is enough (the runner uses
  `uvx --from griffe griffe`), or an interpreter with griffe importable for `python -m griffe`. A pre-generated dump
  (`source: { file }` or `source: { url }`) needs no Python on the docs host.

## Documentation

Full guides, the options reference and a live demo built from three fixture packages are on the
**[documentation site](https://ewels.github.io/starlight-pydocs)**. Start with
[Getting started](https://ewels.github.io/starlight-pydocs/guides/getting-started/), or
[Migrating from mkdocstrings](https://ewels.github.io/starlight-pydocs/guides/migration/) if you are moving an existing
Python project across.

## License

This project is licensed under the [Apache License 2.0](https://github.com/ewels/starlight-pydocs/blob/main/LICENSE).

## Credits

- Created by [Phil Ewels](https://github.com/ewels)
- Built on [Griffe](https://mkdocstrings.github.io/griffe/) by [Timothée Mazzucotelli](https://github.com/pawamoy),
  whose [mkdocstrings-python](https://mkdocstrings.github.io/python/) set the conventions this plugin follows.

> [!TIP]
> **Writing docs with [MkDocs](https://www.mkdocs.org/) instead?**<br>
> Use [**mkdocstrings-python**](https://mkdocstrings.github.io/python/), which documents the same Griffe model for
> MkDocs and [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/).
