import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightPydocs, { pydocsSidebarGroup } from 'starlight-pydocs';

// https://astro.build/config
export default defineConfig({
  site: 'https://ewels.github.io',
  base: '/starlight-pydocs',
  integrations: [
    starlight({
      title: 'Starlight Pydocs',
      description: 'Python API reference documentation for Astro and Starlight, extracted with Griffe.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ewels/starlight-pydocs' }],
      plugins: [
        starlightPydocs({
          packages: [{ name: 'demopkg' }],
        }),
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ label: 'Introduction', link: '/' }],
        },
        {
          label: 'API reference',
          items: [pydocsSidebarGroup],
        },
      ],
    }),
  ],
});
