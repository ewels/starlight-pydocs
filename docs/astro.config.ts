import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightPydocs, { pydocsSidebarGroup } from 'starlight-pydocs';

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
          ],
        }),
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Autodoc demo', link: '/autodoc-demo/' },
          ],
        },
        {
          label: 'API reference',
          items: [pydocsSidebarGroup],
        },
      ],
    }),
  ],
});
