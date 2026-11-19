# Changelog

All notable changes to `starlight-pydocs` are recorded here. New work is added under **Unreleased** and rolled into a dated version section when a release is cut.

## Unreleased

- ✨ The member a URL fragment points at is highlighted with an amber bar and tinted background, distinct from hover ([#16](https://github.com/ewels/starlight-pydocs/pull/16))

## v0.4.0 (2026-11-18)

No configuration changes are needed. On Starlight sites, docstring asides now use Starlight's `.starlight-aside` classes instead of `.pyd-aside`, so update any custom CSS that targets `.pyd-aside`. Builds may also log a new warning when docstrings don't match `docstringStyle`.

- ✨ reStructuredText directives (`.. note::`, `.. deprecated::`, `.. versionadded::`, `.. code-block::`…) and hyperlinks render in docstring prose ([#7](https://github.com/ewels/starlight-pydocs/pull/7))
- ✨ Sphinx roles such as ``:class:`Report` `` render as code and link to their target ([#6](https://github.com/ewels/starlight-pydocs/pull/6))
- ✨ Build warning when docstring sections don't match `docstringStyle` ([#6](https://github.com/ewels/starlight-pydocs/pull/6))
- ✨ Project logos on type-link hover cards ([#13](https://github.com/ewels/starlight-pydocs/pull/13))
- 🐛 A class's `__init__` docstring now renders under the class, as in mkdocstrings ([#8](https://github.com/ewels/starlight-pydocs/pull/8))
- 🐛 Parameter tables stay readable in narrow content columns ([#11](https://github.com/ewels/starlight-pydocs/pull/11))
- 🐛 Docstring asides use Starlight's own aside markup on Starlight sites ([#9](https://github.com/ewels/starlight-pydocs/pull/9))
- 🐛 Names re-exported without `__all__` now link from code blocks ([#12](https://github.com/ewels/starlight-pydocs/pull/12))
- 🐛 Enter in symbol search opens the first result ([#6](https://github.com/ewels/starlight-pydocs/pull/6))
- 🐛 No more raw `{:py}` on inline code after removing starlight-codeblocks during `astro dev` ([#10](https://github.com/ewels/starlight-pydocs/pull/10))

## v0.3.0 (2026-10-05)

If your site installed `@astrojs/markdown-remark` only for signature colours, you can remove it.

- ✨ Agent skill with a setup checklist, shipped in the package ([#4](https://github.com/ewels/starlight-pydocs/pull/4))
- ✨ Works with [starlight-codeblocks](https://github.com/ewels/starlight-codeblocks) when installed: code blocks link to the API pages, type links get hover cards, long examples collapse ([#5](https://github.com/ewels/starlight-pydocs/pull/5))
- 🐛 Signatures are coloured again on sites without `@astrojs/markdown-remark`, the Astro 7.2+ default ([#4](https://github.com/ewels/starlight-pydocs/pull/4))

## v0.2.1 (2026-08-14)

Metadata-only release: no code changes.

- 🛠️ Reworked the npm keywords and dropped `astro-integration`
- 🛠️ Published with npm provenance

## v0.2.0 (2026-08-14)

Generated pages are now also served as Markdown at `<path>.md`. Set `pageMarkdown: false` to turn this off.

- ✨ Syntax-highlighted signatures in your `markdown.shikiConfig` themes
- ✨ Long attribute values fold behind a "Show more" toggle
- ✨ External annotation links open in a new tab; internal ones show a summary on hover
- ✨ Version labels link to the matching GitHub, GitLab or Bitbucket release
- ✨ Every generated page is also served as Markdown at `<path>.md`
- ✨ `listPydocsPages()` from `starlight-pydocs/pages`
- 🛠️ Generated pages take their description from the module docstring
- 🛠️ "Added in" is plain text beside the source link, not a badge
- 🐛 Fixed spacing on Starlight sites, and object names that looked like inline code

## v0.1.0 (2026-08-14)

First release: Python API reference for Astro and Starlight sites, extracted with [Griffe](https://mkdocstrings.github.io/griffe/) ([#1](https://github.com/ewels/starlight-pydocs/pull/1)).

- One page per module, with sidebar, ToC and mkdocstrings-compatible anchors
- No Python needed on the docs host: `uvx` or a pre-generated dump
- google, numpy, sphinx and auto docstrings, rendered by the site's own markdown processor
- Annotations and cross-references linked to your pages, Python's docs or any Sphinx inventory
- mkdocstrings-style member filtering, with inherited members merged
- Symbol search, plus `symbols.json`, `objects.inv` and `llms.txt` per package
- `<Autodoc>` for single objects, and a Content Layer loader
- Source links to GitHub, GitLab, Bitbucket or a URL template
- "Added in" badges from git refs
- Starlight plugin or plain Astro integration, with overrides, theme tokens and 13 languages
- Docstring HTML is sanitized, and links from dumps and inventories with active schemes such as `javascript:` are rejected ([#3](https://github.com/ewels/starlight-pydocs/pull/3))
