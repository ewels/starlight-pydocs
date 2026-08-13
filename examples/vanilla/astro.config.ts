import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import pydocs from 'starlight-pydocs/astro';

// https://astro.build/config
export default defineConfig({
  // No `base`: the generated pages live at /api/demopkg/, which is the other
  // half of the path handling the docs site (base '/starlight-pydocs') covers.
  server: { port: 4322 },
  markdown: {
    // Astro 7 defaults to Sätteri, which the docs site uses. This site pins the
    // unified pipeline instead, so both engines render docstring prose in CI —
    // the package must work with whichever one the host has configured.
    processor: unified(),
  },
  integrations: [
    pydocs({
      packages: [
        {
          name: 'demopkg',
          search: ['../../fixtures/demopkg/src'],
          docstringStyle: 'google',
          extensions: ['griffe_pydantic'],
          extraRequirements: ['griffe-pydantic'],
        },
      ],
      symbolSearch: true,
    }),
  ],
});
