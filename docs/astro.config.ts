import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightPydocs, { createPydocsSidebarGroup, pydocsSidebarGroup } from 'starlight-pydocs';

// `sphpkg` lives in its own part of the sidebar, so it gets its own placeholder
// instead of joining the shared `pydocsSidebarGroup`.
const sphinxSidebarGroup = createPydocsSidebarGroup();

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
          label: 'API reference',
          items: [pydocsSidebarGroup],
        },
        {
          label: 'Sphinx demo',
          items: [sphinxSidebarGroup],
        },
      ],
    }),
  ],
});
