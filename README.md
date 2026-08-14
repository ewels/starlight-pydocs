<div align="center">

<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="https://raw.githubusercontent.com/ewels/starlight-pydocs/main/docs/src/assets/logotype-dark.svg"
  />
  <img
    src="https://raw.githubusercontent.com/ewels/starlight-pydocs/main/docs/src/assets/logotype-light.svg"
    alt="starlight-pydocs"
    width="800"
  />
</picture>

[![npm version](https://img.shields.io/npm/v/starlight-pydocs.svg)](https://www.npmjs.com/package/starlight-pydocs)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/ewels/starlight-pydocs/blob/main/LICENSE)
[![Documentation](https://img.shields.io/badge/docs-ewels.github.io-7c3aed.svg)](https://ewels.github.io/starlight-pydocs)

</div>

Python API reference documentation for [Starlight](https://starlight.astro.build/) and plain
[Astro](https://astro.build/) sites. It reads your package with
[Griffe](https://mkdocstrings.github.io/griffe/) and renders the result with Astro components on injected routes, one
page per module. Extraction is static analysis, so nothing is imported and nothing needs installing.

It is the Starlight
counterpart of [mkdocstrings-python](https://mkdocstrings.github.io/python/) and follows its conventions where possible.

## Features

- 📄 **Generated pages** — one page per module, injected into the site's routes, with a sidebar tree and prev/next links
  that mirror the package layout
- 🎯 **Autodoc component** — `<Autodoc name="mypkg.Report" />` renders a single class or function into a hand-written
  MDX page
- 🔍 **Symbol search** — search the API surface by object path, on top of the site's existing prose search
- 📝 **Docstring sections** — google, numpy or sphinx style: parameters, returns, raises, examples, admonitions and
  deprecations, rendered by your site's own Markdown pipeline
- 🐍 **No Python at build time** — point the plugin at a dump your CI published and the site builds without an
  interpreter
- 🔗 **Linked signatures** — names in an annotation link to their definition on your own pages or, through a Sphinx
  inventory, to another project's documentation
- 🧬 **Inherited members** — merged from resolvable base classes and labelled with the class they came from
- 📚 **Inventory and llms.txt** — `objects.inv` and `llms.txt` per package, so other documentation sites and language
  models can consume yours

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

The **[documentation site](https://ewels.github.io/starlight-pydocs)** documents three example Python packages with the
plugin, so every API page on it is also a live demo of the output.

- [Getting started](https://ewels.github.io/starlight-pydocs/guides/getting-started/) — install, configure, build
- [Examples](https://ewels.github.io/starlight-pydocs/examples/) — one package per docstring style, rendered end to end
- [Configuration](https://ewels.github.io/starlight-pydocs/guides/configuration/) — every option, with defaults
- [Migrating from mkdocstrings](https://ewels.github.io/starlight-pydocs/guides/migration/) — for an existing Python
  project
- [llms.txt](https://ewels.github.io/starlight-pydocs/llms.txt) — the whole site as Markdown, for language models

## License

This project is licensed under the [MIT License](https://github.com/ewels/starlight-pydocs/blob/main/LICENSE).

## Credits

- Created by [Phil Ewels](https://github.com/ewels)
- Built on [Griffe](https://mkdocstrings.github.io/griffe/) by [Timothée Mazzucotelli](https://github.com/pawamoy),
  whose [mkdocstrings-python](https://mkdocstrings.github.io/python/) set the conventions this plugin follows.
- Logotype set in [Michroma](https://fonts.google.com/specimen/Michroma) (SIL Open Font License).

> [!TIP]
> **Writing docs with [MkDocs](https://www.mkdocs.org/) instead?**<br>
> Use [**mkdocstrings-python**](https://mkdocstrings.github.io/python/), which documents the same Griffe model for
> MkDocs and [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/).
