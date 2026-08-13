/**
 * The vanilla Astro integration: `starlight-pydocs/astro`.
 *
 * Same pages, same components, no Starlight anywhere in this module's graph.
 * Pages render through the built-in minimal layout unless `layout` names one of
 * your own.
 *
 * Styles are not injected here, because a plain Astro project has no
 * `customCss` for us to append to. Import them once from your layout (or from
 * the layout you pass as `layout`):
 *
 * ```astro
 * ---
 * import 'starlight-pydocs/styles';
 * ---
 * ```
 */

import type { AstroIntegration } from 'astro';

import type { PydocsUserConfig } from './lib/config.ts';
import type { PydocsSetupOptions } from './libs/integration.ts';
import { pydocsIntegration, preparePydocs } from './libs/integration.ts';

export interface PydocsAstroOptions extends PydocsUserConfig {
  /**
   * Component that wraps every generated page, as an import specifier or a path
   * relative to the project root. It receives `title`, `headings` and
   * `description` props and renders the page body in its default slot.
   */
  layout?: string | undefined;
}

export type { PydocsAstroOptions as PydocsIntegrationOptions };

export default function pydocs(options: PydocsAstroOptions): AstroIntegration {
  // The shared integration is built once `astro:config:setup` has told us about
  // the project; later hooks delegate to it.
  let shared: AstroIntegration | undefined;

  return {
    name: 'starlight-pydocs',
    hooks: {
      'astro:config:setup': async (params) => {
        const { command, config, logger } = params;
        if (command !== 'build' && command !== 'dev') return;

        const setupOptions: PydocsSetupOptions = {
          options,
          root: config.root,
          base: config.base,
          trailingSlash: config.trailingSlash,
          starlight: false,
          logger,
          layout: options.layout,
        };

        shared = pydocsIntegration(await preparePydocs(setupOptions), setupOptions);
        await shared.hooks['astro:config:setup']?.(params);
      },

      'astro:server:setup': async (params) => {
        await shared?.hooks['astro:server:setup']?.(params);
      },
    },
  };
}
