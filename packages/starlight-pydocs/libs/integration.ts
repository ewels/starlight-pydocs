/**
 * The setup both hosts share.
 *
 * The Starlight plugin and the vanilla integration need exactly the same work
 * done — validate the options, extract the dumps, load the inventories, inject
 * the routes and endpoints, register the virtual modules, watch the Python
 * sources in dev — and differ only in which route entrypoint renders the pages
 * and whether Starlight's own hooks are used. That difference is two arguments,
 * so the work lives here once.
 *
 * This file may import Astro types (it builds an `AstroIntegration`); it must
 * never import `@astrojs/starlight`.
 */

import { fileURLToPath } from 'node:url';

import type { AstroIntegration, AstroIntegrationLogger } from 'astro';

import { renderedSidecarPath } from '../lib/cache.ts';
import type { PydocsConfig, PydocsUserConfig } from '../lib/config.ts';
import { normalizeConfig } from '../lib/config.ts';
import type { PydocsContext, PydocsInventoryContext } from '../lib/context.ts';
import { createContext } from '../lib/context.ts';
import { clearCaches } from '../lib/data.ts';
import { loadInventories } from '../lib/inventory.ts';
import type { PydocsLogger } from '../lib/logger.ts';
import { resolveAllExtractions, watchPaths } from '../lib/runner.ts';
import type { DocstringRenderer } from './docstring-renderer.ts';
import { renderDocstringsForDump, resolveDocstringRenderer } from './docstring-renderer.ts';
import { vitePluginStarlightPydocs, PYDOCS_CONTEXT_MODULE, resolveVirtualModuleId } from './vite.ts';

/** Everything the hosts hand over about their Astro configuration. */
export interface PydocsSetupOptions {
  /** The user's options, unvalidated. */
  options: PydocsUserConfig;
  /** Astro's `config.root`. */
  root: URL;
  /** Astro's `config.base`. */
  base: string | undefined;
  trailingSlash: 'always' | 'never' | 'ignore';
  /** True when the host is Starlight. */
  starlight: boolean;
  logger: AstroIntegrationLogger;
  /** Component specifier for the vanilla layout. Ignored under Starlight. */
  layout?: string | undefined;
}

/**
 * Mutable holder for the render-time context.
 *
 * The virtual module reads through this, so a dev-server re-extraction can
 * publish new dump paths by replacing `context`.
 */
export interface PydocsSetup {
  config: PydocsConfig;
  context: PydocsContext;
}

function asPydocsLogger(logger: AstroIntegrationLogger): PydocsLogger {
  return {
    info: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
    debug: (message) => logger.debug(message),
  };
}

async function extract(config: PydocsConfig, logger: PydocsLogger): Promise<Map<string, string>> {
  const results = await resolveAllExtractions(config, {
    cacheDir: config.cacheDir,
    cwd: config.projectRoot,
    logger,
  });
  const paths = new Map<string, string>();
  for (const [name, result] of results) {
    paths.set(name, result.dumpPath);
    logger.debug(`'${name}': ${result.strategy}${result.fromCache ? ' (cached)' : ''} → ${result.dumpPath}`);
  }
  return paths;
}

async function inventories(config: PydocsConfig, logger: PydocsLogger): Promise<PydocsInventoryContext[]> {
  const loaded = await loadInventories(config.inventories, { cacheDir: config.cacheDir, logger });
  return loaded
    .filter((inventory) => inventory.path !== undefined)
    .map((inventory) => ({ base: inventory.base, path: inventory.path ?? '' }));
}

/** Sidecar path per package, derived from where each dump ended up. */
function renderedPathsFor(config: PydocsConfig, dumpPaths: Map<string, string>): Map<string, string> {
  const paths = new Map<string, string>();
  for (const [name, dumpPath] of dumpPaths) {
    paths.set(name, renderedSidecarPath(config.cacheDir, name, dumpPath));
  }
  return paths;
}

/** Validate the options, extract every dump, load every inventory. */
export async function preparePydocs(options: PydocsSetupOptions): Promise<PydocsSetup> {
  const logger = asPydocsLogger(options.logger);
  const config = normalizeConfig(options.options, fileURLToPath(options.root));

  const dumpPaths = await extract(config, logger);
  const context = createContext(config, {
    dumpPaths,
    renderedPaths: renderedPathsFor(config, dumpPaths),
    siteBase: options.base,
    trailingSlash: options.trailingSlash,
    starlight: options.starlight,
    inventories: await inventories(config, logger),
  });

  for (const pkg of config.packages) {
    logger.debug(`'${pkg.name}' documented at /${pkg.base}`);
  }

  return { config, context };
}

/** The route entrypoints, by host. */
export const PAGE_ROUTE_ENTRYPOINTS = {
  starlight: 'starlight-pydocs/routes/starlight',
  vanilla: 'starlight-pydocs/routes/vanilla',
} as const;

/**
 * Build the Astro integration that injects the routes, registers the virtual
 * modules and keeps dev in sync with the Python sources.
 */
export function pydocsIntegration(setup: PydocsSetup, options: PydocsSetupOptions): AstroIntegration {
  const entrypoint = options.starlight ? PAGE_ROUTE_ENTRYPOINTS.starlight : PAGE_ROUTE_ENTRYPOINTS.vanilla;

  // Created at `astro:config:done` and kept for the dev watcher: the host's
  // processor only exists in this process, so re-renders must reuse it.
  let renderer: DocstringRenderer | undefined;

  const renderDocstrings = async (logger: AstroIntegrationLogger): Promise<void> => {
    if (renderer === undefined) return;
    const pydocsLogger = asPydocsLogger(logger);
    for (const pkg of setup.context.packages) {
      const { count } = await renderDocstringsForDump({
        dumpPath: pkg.dumpPath,
        renderedPath: pkg.renderedPath,
        renderer,
        logger: pydocsLogger,
      });
      logger.debug(`rendered ${String(count)} docstring strings of '${pkg.name}' with ${renderer.name}`);
    }
  };

  return {
    name: 'starlight-pydocs',
    hooks: {
      'astro:config:setup': ({ injectRoute, updateConfig }) => {
        // One catch-all page route for every package; the route filters the
        // slugs it owns through `getStaticPaths`.
        injectRoute({ entrypoint, pattern: '[...pydocsSlug]', prerender: true });

        for (const pkg of setup.config.packages) {
          if (setup.config.symbolSearch) {
            injectRoute({
              entrypoint: 'starlight-pydocs/routes/symbols',
              pattern: `${pkg.base}/symbols.json`,
              prerender: true,
            });
          }
          if (setup.config.publishInventory) {
            injectRoute({
              entrypoint: 'starlight-pydocs/routes/inventory',
              pattern: `${pkg.base}/objects.inv`,
              prerender: true,
            });
          }
          if (setup.config.llmsTxt) {
            injectRoute({
              entrypoint: 'starlight-pydocs/routes/llms',
              pattern: `${pkg.base}/llms.txt`,
              prerender: true,
            });
          }
        }

        updateConfig({
          vite: {
            plugins: [
              vitePluginStarlightPydocs({
                getContext: () => setup.context,
                components: setup.config.components,
                projectRoot: setup.config.projectRoot,
                vanillaLayout: options.starlight ? undefined : options.layout,
              }),
            ],
          },
        });
      },

      // Every integration has finished mutating `markdown.processor.options` by
      // now, so docstrings render through the same final pipeline as the site's
      // own content (PLAN.md decision 7).
      'astro:config:done': async ({ config, logger }) => {
        renderer = await resolveDocstringRenderer(config.markdown);
        await renderDocstrings(logger);
      },

      'astro:server:setup': ({ server, logger }) => {
        const pydocsLogger = asPydocsLogger(logger);
        const directories = watchPaths(setup.config);
        if (directories.length === 0) return;
        for (const directory of directories) server.watcher.add(directory);

        let running = false;
        const reextract = async (file: string): Promise<void> => {
          if (!/\.pyi?$/.test(file) || running) return;
          running = true;
          try {
            const dumpPaths = await extract(setup.config, pydocsLogger);
            setup.context = createContext(setup.config, {
              dumpPaths,
              renderedPaths: renderedPathsFor(setup.config, dumpPaths),
              siteBase: options.base,
              trailingSlash: options.trailingSlash,
              starlight: options.starlight,
              inventories: setup.context.inventories,
            });
            // Models are keyed by dump path, which is content-hashed, so a new
            // dump is a new key; clearing keeps memory flat rather than being
            // required for correctness.
            clearCaches();
            // Prose has to be re-rendered for the new dump, with the renderer
            // built at config:done: nothing in the SSR graph can make one.
            await renderDocstrings(logger);

            const module = server.moduleGraph.getModuleById(resolveVirtualModuleId(PYDOCS_CONTEXT_MODULE));
            if (module !== undefined) server.moduleGraph.invalidateModule(module);
            server.hot.send({ type: 'full-reload' });
            logger.info(`re-extracted the API after ${file} changed`);
          } catch (cause) {
            logger.warn(`could not re-extract after ${file} changed: ${describe(cause)}`);
          } finally {
            running = false;
          }
        };

        server.watcher.on('add', (file) => void reextract(file));
        server.watcher.on('change', (file) => void reextract(file));
        server.watcher.on('unlink', (file) => void reextract(file));
      },
    },
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
