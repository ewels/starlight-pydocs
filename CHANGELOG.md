# Changelog

All notable changes to `starlight-pydocs` are recorded here. New work is added under **Unreleased** and rolled into a dated version section when a release is cut.

## Unreleased

- ✨ Hover cards on type links show the project's logo before the source line, as cards in code blocks do: Python, NumPy or Click, for example. The logos come from Simple Icons, plus logos traced from 12 Python projects that it lacks, such as Click, attrs, xarray and rich-click.
- ✨ Sphinx roles in docstring prose, such as ``:class:`Report` `` and ``:meth:`~Report.generate` ``, render as code and link to their target, resolved in the scope of the object the docstring belongs to. Prose roles that name nothing linkable, such as `:ref:`, keep their text, and other roles, such as `:file:`, render as code. Summaries in member tables, search and `objects.inv` show the role's text without the role, and `llms.txt` shows it as code.
- ✨ A build warning when docstrings hold sections in another style than `docstringStyle`, such as `:param name:` fields under the google parser. These sections render as plain text, so before this the only sign was a page with no parameter table.
- ✨ reStructuredText directives and hyperlinks in docstring prose render. `.. note::`, `.. warning::` and the other admonition directives become asides, `.. deprecated::` adds the deprecation badge and notice, `.. versionadded::`, `.. versionchanged::` and `.. versionremoved::` become a line in Sphinx's wording, and `.. code-block::` becomes a fenced code block. `` `text <url>`_ `` becomes a link.
- 🐛 Pressing Enter in symbol search before choosing a result with the arrow keys now opens the first result, instead of doing nothing.
- 🐛 A class's `__init__` docstring now shows under the class, after the class's own docstring, as mkdocstrings' `merge_init_into_class` does. The default filters hide `__init__`, so before this its `Args:` section never rendered. A deprecation in `__init__` stays on `__init__`, because it usually deprecates an argument, not the class.
- 🐛 On Starlight sites, docstring admonitions and deprecation notices now use Starlight's own aside markup, so they look exactly like Starlight's asides, icons included, and follow themes that restyle them. Sites without Starlight keep the plain `.pyd-aside`.
- 🐛 Fixed raw `{:py}` suffixes on inline code in docstrings after you remove starlight-codeblocks from the config of a running `astro dev`. pydocs now uses the starlight-codeblocks registry only when the plugin is in the current config.
- 🐛 Fixed names that a package re-exports without `__all__`, such as `click.command` after `import rich_click as click`, not linking from code blocks. The member filters leave these re-exports off the pages (`imported: false`), but they now link to the page of the object they name.
- 🐛 Fixed parameter tables pushing the description column out of view. Inline code in a description now wraps, so the table fits more often. When a table must scroll, a shadow at the edge shows that it does, and on Starlight sites the table scrolls inside its own box.

## v0.3.0 (2026-10-05)

- ✨ An agent skill with a setup checklist, shipped in the package at `skills/starlight-pydocs/SKILL.md` and shown on the docs site.
- ✨ Works with [starlight-codeblocks](https://github.com/ewels/starlight-codeblocks) when a site installs it, with no configuration. Names in Python code blocks anywhere on the site link to their API reference pages (docstring examples to the pages of their own version), type links in signatures and parameter tables get the same hover card as code (what the type is, where it comes from, and where the link goes), long docstring examples collapse behind an expand button, and inline code in docstrings is highlighted as Python when the site has inline highlighting on. The symbols are published for other plugins at `globalThis[Symbol.for('starlight-pydocs')]`.
- 🐛 Fixed signatures rendering without syntax colours on sites that don't install `@astrojs/markdown-remark` (the Astro 7.2+ default). Shiki is now a direct dependency. If your site added `@astrojs/markdown-remark` only for signature colours, you can remove it.

## v0.2.1 (2026-08-14)

Metadata-only release: no code changes.

- 🛠️ Reworked the npm keywords. `astro-integration` is gone: the default export is a Starlight plugin, so `astro add starlight-pydocs` would have wired up the wrong thing.
- 🛠️ Published with npm provenance.

## v0.2.0 (2026-08-14)

- ✨ Syntax-highlighted signatures, in your `markdown.shikiConfig` themes. Cross-references stay links.
- ✨ Long attribute values laid out across lines, folding behind a "Show more" toggle.
- ✨ Annotation links to another site open in a new tab; links to your own objects show the target's summary on hover.
- ✨ Version labels linking to the matching GitHub, GitLab or Bitbucket release.
- ✨ Every generated page served as Markdown at `<path>.md` too, for "Copy Markdown" buttons and agents. `pageMarkdown: false` turns it off.
- ✨ `listPydocsPages()` from `starlight-pydocs/pages`, for share cards or an index of the generated pages.
- 🛠️ Generated pages carry their own description, from the module's docstring.
- 🛠️ "Added in" is plain text beside the source link, not a badge.
- 🐛 Fixed spacing throughout the generated pages on Starlight sites, and object names that looked like inline code.

## v0.1.0 (2026-08-14)

First release. Python API reference documentation for Astro and Starlight sites, extracted with [Griffe](https://mkdocstrings.github.io/griffe/).

- One reference page per Python module, on injected routes, with a sidebar tree, prev/next links, a table of contents and anchors that match mkdocstrings.
- No Python needed on the docs host: griffe runs through `uvx`, or a pre-generated dump is read from a file or a URL.
- Every docstring section griffe parses, in google, numpy, sphinx or auto style, rendered through the host site's own markdown processor.
- Type annotations linked to this site's pages, to Python's own documentation, or to any configured Sphinx inventory. `[title][dotted.path]` cross-references in prose resolve the same way.
- Member selection that follows mkdocstrings: `__all__`, then griffe's visibility flags, refined by include/exclude globs and filters. Inherited members are merged and badged with their origin.
- Symbol search, plus `symbols.json`, `objects.inv` and `llms.txt` published per package.
- `<Autodoc name="mypkg.Thing" />` to document a single object inside a hand-written page, and a Content Layer loader for the whole surface.
- Source links to GitHub, GitLab, Bitbucket or a URL template.
- "Added in" badges, generated by extracting a list of git refs and comparing them with the current source.
- Usable as a Starlight plugin or as a plain Astro integration, with component overrides, `--pyd-*` theme tokens and translations for thirteen languages.
