import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightPageActions from 'starlight-page-actions';
import starlightPydocs, { createPydocsSidebarGroup, pydocsSidebarGroup } from 'starlight-pydocs';

const ORIGIN = 'https://ewels.github.io';
const BASE = '/starlight-pydocs';
const SITE = `${ORIGIN}${BASE}`;

// `sphpkg` lives in its own part of the sidebar, so it gets its own placeholder
// instead of joining the shared `pydocsSidebarGroup`.
const sphinxSidebarGroup = createPydocsSidebarGroup();

// The archived 1.x pages of `demopkg` get a placeholder of their own too, which
// is how a starlight-versions site puts each version's API under its own
// section.
const legacySidebarGroup = createPydocsSidebarGroup();

// https://astro.build/config
export default defineConfig({
  site: ORIGIN,
  base: BASE,
  markdown: {
    // Shared (non-deprecated) options, so docstring prose and the site's own
    // content are highlighted identically, in both colour schemes. The processor
    // itself is Astro's default, Sätteri.
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
  },
  integrations: [
    starlight({
      title: 'Starlight Pydocs',
      description: 'Python API reference documentation for Astro and Starlight, extracted with Griffe.',
      // The logotype carries the name, so the title is hidden in the header. Text is
      // outlined (Michroma), not live, because an <img>-embedded SVG cannot load a font.
      logo: {
        light: './src/assets/logotype-light.svg',
        dark: './src/assets/logotype-dark.svg',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      // Adds the `og:image` tags for the generated share cards.
      components: { Head: './src/components/Head.astro' },
      customCss: ['./src/styles/fonts.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ewels/starlight-pydocs' }],
      plugins: [
        starlightPydocs({
          packages: [
            {
              name: 'demopkg',
              // The fixture package lives outside the docs site, so griffe gets
              // its source directory rather than the project root.
              search: ['../fixtures/demopkg/src'],
              extensions: ['griffe_pydantic'],
              extraRequirements: ['griffe-pydantic'],
              // `root` is the repository root: griffe reports paths relative to
              // this site, which is one level below it.
              sourceLink: { host: 'github', repo: 'ewels/starlight-pydocs', ref: 'main', root: '..' },
            },
            {
              name: 'numpkg',
              base: 'api/numpkg',
              search: ['../fixtures/numpkg/src'],
              docstringStyle: 'numpy',
              // Explicit, so the links do not depend on griffe's git detection
              // (present in a checkout, absent in a git-archive build).
              sourceLink: { host: 'github', repo: 'ewels/starlight-pydocs', ref: 'main', root: '..' },
            },
            {
              // The same package name again, at its own base, demonstrating how a
              // site documents one release per entry. The dump is regenerated from
              // the current fixture source, so this tree matches the extracted one
              // rather than being an older API; only the mechanism is on show.
              name: 'demopkg',
              base: '1x/api/demopkg',
              label: 'demopkg 1.x',
              source: { file: '../fixtures/demopkg/dump.json' },
              sidebar: { group: legacySidebarGroup },
            },
            {
              // No extraction at all: a dump the Python project's CI could have
              // published. A site configured this way needs no Python.
              name: 'sphpkg',
              base: 'api/sphpkg',
              source: { file: '../fixtures/sphpkg/dump.json' },
              docstringStyle: 'sphinx',
              sidebar: { group: sphinxSidebarGroup },
            },
          ],
          // A local stand-in for CPython's objects.inv (see
          // `pnpm gen:inventory`), so `pathlib.Path` links to the real Python
          // documentation without the build reaching the network.
          inventories: [{ file: '../fixtures/inventories/python-stdlib.inv', base: 'https://docs.python.org/3/' }],
        }),
        // Site-wide llms.txt for the prose guides. The generated API pages are
        // injected routes rather than content collection entries, so this plugin
        // cannot see them; `optionalLinks` advertises the per-package llms.txt
        // endpoints instead, which is the pattern `/guides/llms-txt/` documents.
        starlightLlmsTxt({
          description:
            'starlight-pydocs generates Python API reference documentation for Astro and Starlight sites. It extracts the API surface with Griffe and renders it with Astro components on injected routes.',
          details: [
            'Notes for reading this documentation:',
            '',
            '- The plugin is the Starlight counterpart of mkdocstrings-python and follows its conventions: the same heading anchor scheme, the same member filtering rules, and `::: name` becomes `<Autodoc name="…" />`.',
            '- Extraction is static. Griffe never imports the documented package, so no runtime dependency of that package has to be installable.',
            '- A site can skip Python entirely by pointing the plugin at a pre-generated `griffe dump` JSON file.',
          ].join('\n'),
          // The archived 1.x pages are deliberately absent: a model answering a
          // question about the package should not be pointed at an old release.
          optionalLinks: [
            {
              label: 'demopkg API reference (Markdown)',
              url: `${SITE}/api/demopkg/llms.txt`,
              description:
                'The example package, rendered by this site: google-style docstrings, pydantic models, deprecations, inheritance and `__all__` filtering.',
            },
            {
              label: 'numpkg API reference (Markdown)',
              url: `${SITE}/api/numpkg/llms.txt`,
              description: 'The same output for a package documented with numpy-style docstrings.',
            },
            {
              label: 'sphpkg API reference (Markdown)',
              url: `${SITE}/api/sphpkg/llms.txt`,
              description:
                'The same output for sphinx-style docstrings, built from a pre-generated dump with no Python involved.',
            },
          ],
        }),
        // "Copy Markdown" and "Open in…" under the page title. The buttons
        // fetch `<pathname>.md`: this plugin writes those for the pages in
        // `src/content/docs`, and starlight-pydocs serves them for the
        // generated ones, so the buttons work on every page of the site.
        starlightPageActions({
          // Deliberately no `baseUrl`: setting it makes this plugin write its
          // own `llms.txt` over the one starlight-llms-txt generates above.
          // Unset, it owns the `.md` routes and the buttons, nothing else.
          position: 'page-title',
          // ChatGPT, Claude and "View in Markdown" are on by default; these two
          // are not. The rest (t3chat, v0, perplexity) stay off: each one is
          // another row in the dropdown that helps only its own users.
          actions: { cursor: true, githubCopilot: true },
          prompt: [
            'Read {url}, from the documentation for starlight-pydocs: an Astro and Starlight',
            'plugin that generates Python API reference pages from a Griffe dump.',
            'I want to ask questions about it.',
          ].join(' '),
        }),
        // Runs on `astro build`, which CI does on every pull request through the
        // end-to-end test job, and again on deploy. Broken internal links fail
        // the build.
        starlightLinksValidator({
          // The generated API pages are injected routes, which the validator
          // cannot enumerate (it only sees routes Astro reports as belonging to
          // the project). Every documented package base has to be skipped, or
          // every link into the examples reads as broken.
          exclude: [`${BASE}/api/**`, `${BASE}/1x/**`],
        }),
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Home', link: '/' },
            { label: 'Getting started', link: '/guides/getting-started/' },
            { label: 'Vanilla Astro', link: '/guides/vanilla-astro/' },
            { label: 'Autodoc', link: '/guides/autodoc/' },
          ],
        },
        {
          label: 'Documenting your package',
          items: [
            { label: 'Configuration', link: '/guides/configuration/' },
            { label: 'Docstring styles', link: '/guides/docstring-styles/' },
            { label: 'Cross-references', link: '/guides/cross-references/' },
            { label: 'Source links', link: '/guides/source-links/' },
            { label: 'Multiple packages', link: '/guides/multiple-packages/' },
            { label: 'Pre-generated dumps', link: '/guides/pregenerated-dumps/' },
            { label: 'Version annotations', link: '/guides/version-annotations/' },
          ],
        },
        {
          label: 'Customising the output',
          items: [
            { label: 'Theming', link: '/guides/theming/' },
            { label: 'Component overrides', link: '/guides/component-overrides/' },
            { label: 'Internationalisation', link: '/guides/i18n/' },
            { label: 'Search', link: '/guides/search/' },
            { label: 'llms.txt', link: '/guides/llms-txt/' },
            { label: 'Versioned docs', link: '/guides/versioned-docs/' },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'Migrating from mkdocstrings', link: '/guides/migration/' },
            { label: 'Contributing', link: '/guides/contributing/' },
            { label: 'Changelog', link: '/changelog/' },
          ],
        },
        {
          // The generated pages for all three fixture packages, each under the
          // section its placeholder was put in.
          label: 'Examples',
          items: [
            // Not "Overview": every generated package group already has an
            // entry by that name, and the sidebar becomes unreadable.
            { label: 'All examples', link: '/examples/' },
            {
              label: 'API reference',
              collapsed: true,
              items: [pydocsSidebarGroup],
            },
            {
              label: 'v1.x',
              collapsed: true,
              items: [legacySidebarGroup],
            },
            {
              label: 'Sphinx demo',
              collapsed: true,
              items: [sphinxSidebarGroup],
            },
          ],
        },
      ],
    }),
  ],
});
