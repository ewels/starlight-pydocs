---
name: starlight-pydocs
description: Set up, configure or publish Python API reference docs with starlight-pydocs in an Astro or Starlight site. Use when adding the plugin to a site, choosing how Griffe runs in CI, deciding which parts of a package to document, or checking a build before deploying.
---

# Setting up starlight-pydocs

A short checklist for adding starlight-pydocs to a site. It links to the full
documentation rather than repeating it, so read the linked page before you
change anything it covers.

## 1. Install and wire it up

- Install `starlight-pydocs` and add it as a Starlight plugin. Put
  `pydocsSidebarGroup` where the API reference belongs in the sidebar.
  [Getting started](https://ewels.github.io/starlight-pydocs/guides/getting-started/)
- A plain Astro site with no Starlight uses `starlight-pydocs/astro` instead.
  [Vanilla Astro](https://ewels.github.io/starlight-pydocs/guides/vanilla-astro/)
- `search` points at the _parent_ of the package directory (`../src` for
  `../src/mypkg`), relative to the Astro project root.

## 2. Make Griffe runnable wherever the site builds

The build runs Griffe unless the package has a pre-generated `source`. The
plugin tries `uvx` first, then `python -m griffe`. So a CI or deploy job
(GitHub Pages included) needs one of these:

- `uv` on `PATH`, for example `astral-sh/setup-uv` before the build step;
- Python with `griffe` installed; or
- a dump written by the Python project and read with `source.file` or
  `source.url`, which needs no Python at all.
  [Pre-generated dumps](https://ewels.github.io/starlight-pydocs/guides/pregenerated-dumps/)

Version annotations also need the full git history in CI (`fetch-depth: 0`).
[Version annotations](https://ewels.github.io/starlight-pydocs/guides/version-annotations/)

## 3. Decide what the public API is

Griffe documents every name without a leading underscore, so helpers and
internals end up in the reference unless you say otherwise. Pick one:

- declare `__all__` in each module (it wins, as in mkdocstrings);
- or use `members.include` / `members.exclude` globs in the package config.

If only part of the documented surface is stable, say so on a page of your
own. [Configuration → Member selection](https://ewels.github.io/starlight-pydocs/guides/configuration/#member-selection)

## 4. Match the docstrings and links

- Set `docstringStyle` (`google`, `numpy`, `sphinx` or `auto`).
  [Docstring styles](https://ewels.github.io/starlight-pydocs/guides/docstring-styles/)
- Add Sphinx inventories so annotations link to Python and to other projects.
  [Cross-references](https://ewels.github.io/starlight-pydocs/guides/cross-references/)
- Add source links to the repository.
  [Source links](https://ewels.github.io/starlight-pydocs/guides/source-links/)

## 5. Check a built site, not only the dev server

Run `astro build` and read the `[starlight-pydocs]` lines in the log. Warnings
passed through from Griffe (`griffe: WARNING …`) point at docstrings worth
fixing. Any other warning usually means something is missing from the output,
such as uncoloured signatures. Then open a generated page from `astro preview`
and check that signatures are coloured and annotation links resolve.
