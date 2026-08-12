import { fileURLToPath } from 'node:url';

import type { StarlightPlugin } from '@astrojs/starlight/types';

import type { PydocsUserConfig } from './lib/config.ts';
import { normalizeConfig } from './lib/config.ts';
import { createContext } from './lib/context.ts';
import { getDefaultPlaceholderLabel, getSidebarGroupsPlaceholder } from './libs/starlight.ts';
import { vitePluginStarlightPydocs } from './libs/vite.ts';

/**
 * Sidebar placeholder for the generated API reference. Place it anywhere in
 * your Starlight `sidebar` config; the plugin replaces it with the generated
 * module tree at render time.
 */
export const pydocsSidebarGroup = getSidebarGroupsPlaceholder();

export type { PydocsUserConfig as StarlightPydocsOptions };

export default function starlightPydocs(options: PydocsUserConfig): StarlightPlugin {
  return {
    name: 'starlight-pydocs',
    hooks: {
      'config:setup'({ addIntegration, addRouteMiddleware, astroConfig, command }) {
        if (command !== 'build' && command !== 'dev') return;

        const config = normalizeConfig(options, fileURLToPath(astroConfig.root));

        // Spike-level wiring (ROADMAP items 2-3): extraction, inventory loading
        // and the real routes land with the renderer in item 5, which fills in
        // `dumpPaths` and `inventories` here.
        const context = createContext(config, {
          dumpPaths: new Map(),
          siteBase: astroConfig.base,
          trailingSlash: astroConfig.trailingSlash,
          starlight: true,
        });

        addRouteMiddleware({ entrypoint: 'starlight-pydocs/middleware', order: 'post' });

        addIntegration({
          name: 'starlight-pydocs',
          hooks: {
            'astro:config:setup'({ injectRoute, updateConfig: updateAstroConfig }) {
              injectRoute({
                entrypoint: 'starlight-pydocs/routes/starlight',
                pattern: '[...pydocsSlug]',
                prerender: true,
              });
              updateAstroConfig({
                vite: { plugins: [vitePluginStarlightPydocs(context)] },
              });
            },
          },
        });
      },
    },
  };
}

export { getDefaultPlaceholderLabel };
