/**
 * A Content Layer loader emitting one entry per documented object.
 *
 * For sites that want the API surface as data (a custom search page, a cheat
 * sheet, a table of every deprecated function) rather than as generated pages.
 * It runs the same extraction and model as the plugin, so a project can use both
 * and they agree.
 *
 * ```ts
 * // src/content.config.ts
 * import { defineCollection } from 'astro:content';
 * import { pydocsLoader } from 'starlight-pydocs/loader';
 *
 * export const collections = {
 *   api: defineCollection({ loader: pydocsLoader({ name: 'demopkg', search: ['../py/src'] }) }),
 * };
 * ```
 */

import { fileURLToPath } from 'node:url';

import type { Loader, LoaderContext } from 'astro/loaders';
import { z } from 'astro/zod';

import type { PydocsPackageInput, PydocsRunnerInput } from './lib/config.ts';
import { normalizeConfig } from './lib/config.ts';
import { PydocsError } from './lib/errors.ts';
import { loadDump } from './lib/data.ts';
import { buildModel } from './lib/model.ts';
import { computeVersionAnnotations } from './lib/ref-extract.ts';
import { resolveExtraction } from './lib/runner.ts';
import { signatureText } from './lib/signature.ts';
import { versionLabelsFrom } from './lib/versions.ts';

export interface PydocsLoaderOptions extends PydocsPackageInput {
  /** Extraction overrides, as on the plugin. */
  runner?: PydocsRunnerInput | undefined;
  /** Cache directory. Default `node_modules/.astro`. */
  cacheDir?: string | undefined;
  /**
   * Absolute path every relative path is resolved against. Defaults to the
   * Astro project root.
   */
  projectRoot?: string | undefined;
}

/** The shape of every collection entry, for type-safe `getCollection` calls. */
export const pydocsEntrySchema = z.object({
  /** Dotted path the object is documented at; also its heading anchor. */
  path: z.string(),
  /** Dotted path griffe found the definition at. */
  canonicalPath: z.string(),
  name: z.string(),
  kind: z.enum(['module', 'class', 'function', 'attribute', 'alias']),
  /** Griffe labels: `property`, `classmethod`, `pydantic-model`, … */
  labels: z.array(z.string()),
  /** First line of the docstring, markdown stripped. */
  brief: z.string(),
  /** The full docstring text, unparsed. */
  docstring: z.string(),
  /** Plain-text signature; empty for modules. */
  signature: z.string(),
  /** Slug of the generated page the object appears on. */
  page: z.string(),
  /** Heading anchor on that page; empty for a module. */
  anchor: z.string(),
  deprecated: z.boolean(),
  /** Version the object appeared in, when the package configures `versions.refs`. */
  addedIn: z.string().optional(),
});

export type PydocsEntry = z.infer<typeof pydocsEntrySchema>;

export function pydocsLoader(options: PydocsLoaderOptions): Loader {
  return {
    name: 'starlight-pydocs',
    schema: pydocsEntrySchema,
    async load(context: LoaderContext) {
      // Astro's loader logger already satisfies the `PydocsLogger` seam.
      const { config, logger, store } = context;
      const projectRoot = options.projectRoot ?? fileURLToPath(config.root);

      const { runner, cacheDir, projectRoot: _root, ...packageInput } = options;
      const normalised = normalizeConfig(
        { packages: [packageInput], runner, cacheDir, symbolSearch: false, publishInventory: false, llmsTxt: false },
        projectRoot,
      );
      const pkg = normalised.packages[0];
      if (pkg === undefined) throw new PydocsError('starlight-pydocs: the loader needs a package to document');

      const extractionContext = { cacheDir: normalised.cacheDir, cwd: projectRoot, logger };
      const extraction = await resolveExtraction(pkg, normalised, extractionContext);
      // No refs configured means no git work at all, so this is free by default.
      const { annotations } = await computeVersionAnnotations(pkg, normalised, extractionContext);
      const model = buildModel(await loadDump(extraction.dumpPath), {
        packageName: pkg.name,
        base: pkg.base,
        members: pkg.members,
        filters: pkg.filters,
        sourceLink: pkg.sourceLink,
        addedIn: versionLabelsFrom(annotations),
      });

      for (const warning of model.warnings) logger.warn(warning);

      // The dump is content-keyed, so a rebuild either produces identical
      // entries or a wholly different surface: clearing and re-setting is both
      // correct and simpler than diffing.
      store.clear();

      for (const symbol of model.symbols) {
        const object = model.objectsByPath.get(symbol.path);
        if (object === undefined) continue;
        const data: PydocsEntry = {
          path: object.path,
          canonicalPath: object.canonicalPath,
          name: object.name,
          kind: object.kind,
          labels: object.labels,
          brief: symbol.brief,
          docstring: object.docstring?.value ?? '',
          signature: object.kind === 'module' ? '' : signatureText(object),
          page: symbol.pageSlug,
          anchor: symbol.anchor,
          deprecated: object.deprecated !== undefined,
          ...(object.addedIn === undefined ? {} : { addedIn: object.addedIn }),
        };
        const parsed = await context.parseData({ id: object.path, data });
        store.set({ id: object.path, data: parsed, digest: context.generateDigest(parsed) });
      }

      logger.info(`loaded ${String(model.symbols.length)} objects from '${pkg.name}'`);
    },
  };
}
