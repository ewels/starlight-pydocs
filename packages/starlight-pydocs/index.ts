import type { StarlightPlugin } from '@astrojs/starlight/types';

import type { PydocsContext } from './lib/context.ts';
import { stripLeadingAndTrailingSlashes } from './lib/paths.ts';
import { getDefaultPlaceholderLabel, getSidebarGroupsPlaceholder } from './libs/starlight.ts';
import { vitePluginStarlightPydocs } from './libs/vite.ts';

/**
 * Sidebar placeholder for the generated API reference. Place it anywhere in
 * your Starlight `sidebar` config; the plugin replaces it with the generated
 * module tree at render time.
 */
export const pydocsSidebarGroup = getSidebarGroupsPlaceholder();

export interface StarlightPydocsPackageOptions {
  /** Python import name of the package to document. */
  name: string;
  /** URL base for the generated pages. Defaults to `api/<name>`. */
  base?: string;
}

export interface StarlightPydocsOptions {
  packages: StarlightPydocsPackageOptions[];
}

export default function starlightPydocs(options: StarlightPydocsOptions): StarlightPlugin {
  return {
    name: 'starlight-pydocs',
    hooks: {
      'config:setup'({ addIntegration, addRouteMiddleware, astroConfig, command }) {
        if (command !== 'build' && command !== 'dev') return;

        const context: PydocsContext = {
          packages: options.packages.map((pkg) => ({
            name: pkg.name,
            base: stripLeadingAndTrailingSlashes(pkg.base ?? `api/${pkg.name}`),
            dumpPath: '',
          })),
          siteBase: stripLeadingAndTrailingSlashes(astroConfig.base ?? '')
            ? `/${stripLeadingAndTrailingSlashes(astroConfig.base ?? '')}`
            : '',
          starlight: true,
          trailingSlash: astroConfig.trailingSlash,
        };

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
