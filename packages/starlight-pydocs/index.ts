/**
 * The Starlight plugin.
 *
 * Starlight-specific work only: translations, the sidebar placeholder, the route
 * middleware that swaps it, and the stylesheet. Everything else (validation,
 * extraction, inventories, routes, virtual modules, dev watching) is the shared
 * setup in `libs/integration.ts`, which the vanilla integration uses too.
 */

import { randomBytes } from 'node:crypto';

import type { StarlightPlugin } from '@astrojs/starlight/types';

import type { PydocsUserConfig } from './lib/config.ts';
import { pydocsIntegration, preparePydocs } from './libs/integration.ts';
import type { SidebarUserGroup } from './libs/starlight.ts';
import { getDefaultPlaceholderLabel, getSidebarGroupsPlaceholder } from './libs/starlight.ts';
import { Translations } from './translations.ts';

export type { PydocsUserConfig as StarlightPydocsOptions };
export type {
  DocstringStyle,
  OverridableComponentName,
  PydocsInventoryInput,
  PydocsPackageInput,
  PydocsUserConfig,
} from './lib/config.ts';

/**
 * Sidebar placeholder for the generated API reference. Put it anywhere in your
 * Starlight `sidebar`; the route middleware replaces it with the generated
 * module tree of every package that has no placeholder of its own.
 */
export const pydocsSidebarGroup = getSidebarGroupsPlaceholder();

/**
 * A placeholder of its own, for putting one package's pages somewhere else in
 * the sidebar. Pass it to that package as `sidebar: { group }`.
 *
 * ```js
 * const legacyApi = createPydocsSidebarGroup();
 * starlightPydocs({ packages: [{ name: 'mypkg', sidebar: { group: legacyApi } }] });
 * ```
 */
export function createPydocsSidebarGroup(): SidebarUserGroup {
  return getSidebarGroupsPlaceholder(Symbol(randomBytes(24).toString('base64url')));
}

export default function starlightPydocs(options: PydocsUserConfig): StarlightPlugin {
  return {
    name: 'starlight-pydocs',
    hooks: {
      'i18n:setup'({ injectTranslations }) {
        injectTranslations(Translations);
      },

      async 'config:setup'({ addIntegration, addRouteMiddleware, astroConfig, command, config, logger, updateConfig }) {
        // `sync` and `preview` neither build pages nor need extraction.
        if (command !== 'build' && command !== 'dev') return;

        const setupOptions = {
          options,
          root: astroConfig.root,
          base: astroConfig.base,
          trailingSlash: astroConfig.trailingSlash,
          starlight: true,
          logger,
        };
        const setup = await preparePydocs(setupOptions);

        addRouteMiddleware({ entrypoint: 'starlight-pydocs/middleware', order: 'post' });
        addIntegration(pydocsIntegration(setup, setupOptions));

        if (setup.config.injectStyles) {
          updateConfig({ customCss: [...(config.customCss ?? []), 'starlight-pydocs/styles'] });
        }
      },
    },
  };
}

export { getDefaultPlaceholderLabel };
