/**
 * The setup both hosts share.
 *
 * The Starlight plugin and the vanilla integration need exactly the same work
 * done: validate the options, extract the dumps, load the inventories, inject
 * the routes and endpoints, register the virtual modules, watch the Python
 * sources in dev. They differ only in which route entrypoint renders the pages
 * and whether Starlight's own hooks are used. That difference is two arguments,
 * so the work lives here once.
 *
 * This file may import Astro types (it builds an `AstroIntegration`); it must
 * never import `@astrojs/starlight`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration, AstroIntegrationLogger } from 'astro';

import { renderedSidecarPath, versionsSidecarPath, writeAtomic } from '../lib/cache.ts';
import type { PydocsConfig, PydocsUserConfig } from '../lib/config.ts';
import { normalizeConfig } from '../lib/config.ts';
import type { PydocsContext, PydocsInventoryContext } from '../lib/context.ts';
import { createContext } from '../lib/context.ts';
import { clearCaches, getCrossReferenceResolver } from '../lib/data.ts';
import { errorMessage } from '../lib/errors.ts';
import { loadInventories } from '../lib/inventory.ts';
import type { PydocsLogger } from '../lib/logger.ts';
import { computeVersionAnnotations } from '../lib/ref-extract.ts';
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
  /** Astro's logger, which already satisfies the {@link PydocsLogger} seam. */
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
interface PydocsSetup {
  config: PydocsConfig;
  context: PydocsContext;
}

/** Dump path per package base. */
async function extract(config: PydocsConfig, logger: PydocsLogger): Promise<Map<string, string>> {
  const results = await resolveAllExtractions(config, {
    cacheDir: config.cacheDir,
    cwd: config.projectRoot,
    logger,
  });
  const paths = new Map<string, string>();
  for (const [base, result] of results) {
    paths.set(base, result.dumpPath);
    logger.debug(`'${base}': ${result.strategy}${result.fromCache ? ' (cached)' : ''} → ${result.dumpPath}`);
  }
  return paths;
}

async function inventories(config: PydocsConfig, logger: PydocsLogger): Promise<PydocsInventoryContext[]> {
  const loaded = await loadInventories(config.inventories, { cacheDir: config.cacheDir, logger });
  // An inventory that failed to load has no path; `flatMap` drops it and narrows
  // the rest, where a filter would leave `path` still optional.
  return loaded.flatMap((inventory) =>
    inventory.path === undefined ? [] : [{ base: inventory.base, path: inventory.path }],
  );
}

/** Sidecar path per package base, derived from where each dump ended up. */
function renderedPathsFor(config: PydocsConfig, dumpPaths: Map<string, string>): Map<string, string> {
  const paths = new Map<string, string>();
  for (const [base, dumpPath] of dumpPaths) {
    paths.set(base, renderedSidecarPath(config.cacheDir, base, dumpPath));
  }
  return paths;
}

/**
 * Extract every configured version ref and write each package's "added in"
 * labels beside its dump.
 *
 * Ref dumps are keyed by commit sha, so this is a git checkout plus a griffe run
 * on the first build and nothing at all afterwards.
 */
async function versionPathsFor(
  config: PydocsConfig,
  dumpPaths: Map<string, string>,
  logger: PydocsLogger,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();

  for (const pkg of config.packages) {
    if (pkg.versions.refs.length === 0) continue;
    const dumpPath = dumpPaths.get(pkg.base);
    if (dumpPath === undefined) continue;

    const { annotations, refs } = await computeVersionAnnotations(pkg, config, {
      cacheDir: config.cacheDir,
      cwd: config.projectRoot,
      logger,
    });
    const target = versionsSidecarPath(config.cacheDir, pkg.base, dumpPath);
    await writeAtomic(target, `${JSON.stringify(annotations)}\n`);
    paths.set(pkg.base, target);

    logger.debug(
      `'${pkg.base}': ${String(Object.keys(annotations.addedIn).length)} objects labelled from ` +
        `${refs.map((ref) => `${ref.label} (${ref.sha.slice(0, 12)})`).join(', ')}`,
    );
  }

  return paths;
}

/** Validate the options, extract every dump, load every inventory. */
async function preparePydocs(options: PydocsSetupOptions): Promise<PydocsSetup> {
  const { logger } = options;
  const config = normalizeConfig(options.options, fileURLToPath(options.root));

  const dumpPaths = await extract(config, logger);
  // Version-ref extraction (git plus griffe) and inventory downloads are
  // independent, so they run together.
  const [versionsPaths, loadedInventories] = await Promise.all([
    versionPathsFor(config, dumpPaths, logger),
    inventories(config, logger),
  ]);

  const context = createContext(config, {
    dumpPaths,
    renderedPaths: renderedPathsFor(config, dumpPaths),
    versionsPaths,
    siteBase: options.base,
    trailingSlash: options.trailingSlash,
    starlight: options.starlight,
    inventories: loadedInventories,
  });

  for (const pkg of config.packages) {
    logger.debug(`'${pkg.label}' (${pkg.name}) documented at /${pkg.base}`);
  }

  return { config, context };
}

/** The page route entrypoints, by host. */
const PAGE_ROUTE_ENTRYPOINTS = {
  starlight: 'starlight-pydocs/routes/starlight',
  vanilla: 'starlight-pydocs/routes/vanilla',
} as const;

/**
 * The files served next to a package's pages, each with the setting that turns it
 * on. One table rather than three near-identical `injectRoute` blocks.
 */
function packageEndpoints(config: PydocsConfig): { filename: string; entrypoint: string }[] {
  return [
    { enabled: config.symbolSearch, filename: 'symbols.json', entrypoint: 'starlight-pydocs/routes/symbols' },
    { enabled: config.publishInventory, filename: 'objects.inv', entrypoint: 'starlight-pydocs/routes/inventory' },
    { enabled: config.llmsTxt, filename: 'llms.txt', entrypoint: 'starlight-pydocs/routes/llms' },
  ].filter((endpoint) => endpoint.enabled);
}

/** What a host needs back: the integration to add, and the settings it must act on itself. */
export interface PreparedPydocs {
  /** The validated configuration, for host-specific decisions like `injectStyles`. */
  config: PydocsConfig;
  /** The integration to hand to Astro. */
  integration: AstroIntegration;
}

/**
 * Do the whole shared setup: validate, extract, and build the integration.
 *
 * One call rather than two, because both halves have to see the same options and
 * the same setup; neither host has any business holding them apart.
 */
export async function preparePydocsIntegration(options: PydocsSetupOptions): Promise<PreparedPydocs> {
  const setup = await preparePydocs(options);
  return { config: setup.config, integration: pydocsIntegration(setup, options) };
}

/**
 * Build the Astro integration that injects the routes, registers the virtual
 * modules and keeps dev in sync with the Python sources.
 */
function pydocsIntegration(setup: PydocsSetup, options: PydocsSetupOptions): AstroIntegration {
  const entrypoint = options.starlight ? PAGE_ROUTE_ENTRYPOINTS.starlight : PAGE_ROUTE_ENTRYPOINTS.vanilla;

  // Created at `astro:config:done` and kept for the dev watcher: the host's
  // processor only exists in this process, so re-renders must reuse it.
  let renderer: DocstringRenderer | undefined;

  const renderDocstrings = async (logger: AstroIntegrationLogger): Promise<void> => {
    if (renderer === undefined) return;
    for (const pkg of setup.context.packages) {
      const { count } = await renderDocstringsForDump({
        dumpPath: pkg.dumpPath,
        renderedPath: pkg.renderedPath,
        renderer,
        crossReferences: await getCrossReferenceResolver(setup.context, pkg.base),
        sanitize: setup.config.sanitizeDocstrings,
        logger,
      });
      logger.debug(`rendered ${String(count)} docstring strings of '/${pkg.base}' with ${renderer.name}`);
    }
  };

  return {
    name: 'starlight-pydocs',
    hooks: {
      'astro:config:setup': ({ injectRoute, updateConfig }) => {
        // One catch-all page route for every package; the route filters the
        // slugs it owns through `getStaticPaths`.
        injectRoute({ entrypoint, pattern: '[...pydocsSlug]', prerender: true });

        const endpoints = packageEndpoints(setup.config);
        for (const pkg of setup.config.packages) {
          for (const endpoint of endpoints) {
            injectRoute({
              entrypoint: endpoint.entrypoint,
              pattern: `${pkg.base}/${endpoint.filename}`,
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
      // own content (ARCHITECTURE.md decision 7).
      'astro:config:done': async ({ config, logger }) => {
        renderer = await resolveDocstringRenderer(config.markdown);
        await renderDocstrings(logger);
      },

      'astro:server:setup': ({ server, logger }) => {
        const directories = watchPaths(setup.config);
        if (directories.length === 0) return;
        for (const directory of directories) server.watcher.add(directory);

        // The dev server watches the whole project; only Python files inside
        // the configured search roots concern us. Without this filter any
        // `.py` change anywhere re-extracted and force-reloaded the site.
        const roots = directories.map((directory) => path.resolve(directory) + path.sep);

        let running = false;
        const reextract = async (file: string): Promise<void> => {
          if (!/\.pyi?$/.test(file) || running) return;
          if (!roots.some((root) => path.resolve(file).startsWith(root))) return;
          running = true;
          try {
            const dumpPaths = await extract(setup.config, logger);
            setup.context = createContext(setup.config, {
              dumpPaths,
              renderedPaths: renderedPathsFor(setup.config, dumpPaths),
              // Version refs are immutable commits: editing a `.py` file cannot
              // change what an old release contained, so the labels are reused.
              versionsPaths: await versionPathsFor(setup.config, dumpPaths, logger),
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
            logger.warn(`could not re-extract after ${file} changed: ${errorMessage(cause)}`);
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
