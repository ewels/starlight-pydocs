import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightPydocs, { createPydocsSidebarGroup, pydocsSidebarGroup } from 'starlight-pydocs';

// `sphpkg` lives in its own part of the sidebar, so it gets its own placeholder
// instead of joining the shared `pydocsSidebarGroup`.
const sphinxSidebarGroup = createPydocsSidebarGroup();

// The archived 1.x pages of `demopkg` get a placeholder of their own too, which
// is how a starlight-versions site puts each version's API under its own
// section.
const legacySidebarGroup = createPydocsSidebarGroup();

// https://astro.build/config
export default defineConfig({
  site: 'https://ewels.github.io',
  base: '/starlight-pydocs',
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
            },
            {
              // The same package name again, at its own base: the 1.x release,
              // pinned to a dump generated at that version. One instance, one
              // entry per documented version.
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
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', link: '/' },
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
          label: 'API reference',
          items: [pydocsSidebarGroup],
        },
        {
          label: 'v1.x',
          items: [legacySidebarGroup],
        },
        {
          label: 'Sphinx demo',
          items: [sphinxSidebarGroup],
        },
        {
          label: 'Project',
          items: [
            { label: 'Migrating from mkdocstrings', link: '/guides/migration/' },
            { label: 'Contributing', link: '/guides/contributing/' },
            { label: 'Changelog', link: '/changelog/' },
          ],
        },
      ],
    }),
  ],
});
