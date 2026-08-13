/**
 * Server-side data access: read dumps from disk, build models, cache both per
 * process.
 *
 * Route components call `getModel` once per page render; the dump is parsed at
 * most once per process (per file and mtime), and the model at most once per
 * package and option set. Nothing here ever reaches the browser.
 */

import fs from 'node:fs/promises';

import type { PydocsContext, PydocsPackageContext } from './context.ts';
import { packageByBase } from './context.ts';
import type { CrossReferenceResolver } from './crossrefs.ts';
import { createCrossReferenceResolver } from './crossrefs.ts';
import type { RenderedDocstrings } from './docstrings.ts';
import { PydocsError } from './errors.ts';
import type { AnnotationResolver } from './expr.ts';
import type { InventoryLookup } from './inventory.ts';
import { createInventoryLookup, parseInventory } from './inventory.ts';
import type { ModelOptions, PackageModel } from './model.ts';
import { buildAnnotationResolver, buildModel } from './model.ts';
import type { GriffeDump } from './types.ts';
import type { VersionAnnotations } from './versions.ts';
import { versionLabelsFrom } from './versions.ts';

interface CachedJson<T> {
  mtimeMs: number;
  value: T;
}

const dumpCache = new Map<string, CachedJson<GriffeDump>>();
const modelCache = new Map<string, PackageModel>();
const inventoryCache = new Map<string, InventoryLookup>();
const renderedCache = new Map<string, CachedJson<RenderedDocstrings>>();
const versionsCache = new Map<string, Map<string, string>>();

interface LoadJsonOptions<T> {
  /** Per-process cache, keyed by path and invalidated by mtime. */
  cache: Map<string, CachedJson<T>>;
  /** Absolute path of the file to read. */
  path: string;
  /** Message for a file that cannot be stat'ed. */
  unreadable: string;
  /** Message for a file that is not JSON. */
  invalidJson: string;
  /** Turn the parsed JSON into the value to cache, or throw if it is not one. */
  interpret: (parsed: unknown) => T;
}

/**
 * Read a JSON file through a per-process cache, re-reading it only once its
 * mtime has moved.
 *
 * The dumps and their sidecars are the only large files we touch at render time
 * and every page render asks for them, so both go through here.
 *
 * @throws {PydocsError} With the caller's message when the file is unreadable or
 *   is not JSON.
 */
async function loadJson<T>(options: LoadJsonOptions<T>): Promise<T> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(options.path)).mtimeMs;
  } catch (cause) {
    throw new PydocsError(options.unreadable, { cause });
  }

  const cached = options.cache.get(options.path);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(options.path, 'utf8'));
  } catch (cause) {
    throw new PydocsError(options.invalidJson, { cause });
  }

  const value = options.interpret(parsed);
  options.cache.set(options.path, { mtimeMs, value });
  return value;
}

/**
 * Parse a dump, reusing the parsed object while the file is unchanged.
 *
 * @throws {PydocsError} When the file is missing or is not a griffe dump.
 */
export async function loadDump(dumpPath: string): Promise<GriffeDump> {
  if (dumpPath === '') {
    throw new PydocsError('starlight-pydocs: no dump path was recorded for this package (extraction did not run)');
  }

  return loadJson({
    cache: dumpCache,
    path: dumpPath,
    unreadable: `starlight-pydocs: cannot read the griffe dump at ${dumpPath}`,
    invalidJson: `starlight-pydocs: the griffe dump at ${dumpPath} is not valid JSON`,
    interpret: (parsed) => {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new PydocsError(
          `starlight-pydocs: the griffe dump at ${dumpPath} is not an object keyed by package name; ` +
            'regenerate it with `griffe dump -f -d <style>`',
        );
      }
      return parsed as GriffeDump;
    },
  });
}

/**
 * Read the pre-rendered docstring HTML for a package, reusing it while the file
 * is unchanged.
 *
 * @throws {PydocsError} When the sidecar is missing, which means the
 *   `astro:config:done` render did not run for this build.
 */
export async function loadRendered(renderedPath: string): Promise<RenderedDocstrings> {
  if (renderedPath === '') {
    throw new PydocsError(
      'starlight-pydocs: no pre-rendered docstring path was recorded for this package (extraction did not run)',
    );
  }

  return loadJson({
    cache: renderedCache,
    path: renderedPath,
    unreadable:
      `starlight-pydocs: the pre-rendered docstrings at ${renderedPath} are missing; ` +
      'docstring prose is rendered at astro:config:done, so this usually means the integration was not registered',
    invalidJson: `starlight-pydocs: ${renderedPath} is not valid JSON`,
    // A sidecar written by an older release may not have the objects map; an
    // empty one only costs unrendered prose.
    interpret: (parsed) =>
      typeof parsed === 'object' && parsed !== null && 'objects' in parsed
        ? (parsed as RenderedDocstrings)
        : { objects: {} },
  });
}

/**
 * The configured entry with this base.
 *
 * Everything here is keyed by base rather than by import name: a name may be
 * documented at several bases (one per version), and each of those has its own
 * dump, model and pre-rendered prose.
 */
export function requirePackage(context: PydocsContext, base: string): PydocsPackageContext {
  const pkg = packageByBase(context, base);
  if (pkg === undefined) {
    throw new PydocsError(
      `starlight-pydocs: no package is documented at '${base}' (configured: ${context.packages
        .map((entry) => entry.base)
        .join(', ')})`,
    );
  }
  return pkg;
}

/** Pre-rendered docstrings for the package documented at `base`. */
export async function getRenderedDocstrings(context: PydocsContext, base: string): Promise<RenderedDocstrings> {
  return loadRendered(requirePackage(context, base).renderedPath);
}

/** Model options for one package, as recorded in the virtual context. */
export function modelOptionsFor(pkg: PydocsPackageContext): ModelOptions {
  return {
    packageName: pkg.name,
    base: pkg.base,
    members: pkg.members,
    filters: pkg.filters,
    sourceLink: pkg.sourceLink,
  };
}

/**
 * The "added in" labels for a package, or an empty map when it has no version
 * refs configured.
 *
 * A missing or broken sidecar is not fatal: the badges disappear and the rest of
 * the page is unaffected.
 */
export async function getVersionLabels(context: PydocsContext, base: string): Promise<Map<string, string>> {
  const pkg = requirePackage(context, base);
  if (pkg.versionsPath === '') return new Map();

  const cached = versionsCache.get(pkg.versionsPath);
  if (cached !== undefined) return cached;

  let labels = new Map<string, string>();
  try {
    labels = versionLabelsFrom(JSON.parse(await fs.readFile(pkg.versionsPath, 'utf8')) as VersionAnnotations);
  } catch {
    // Written at setup; if it is not there, the setup did not run for this build.
  }
  versionsCache.set(pkg.versionsPath, labels);
  return labels;
}

/**
 * Build (or reuse) the normalised model for a package.
 *
 * @param context - The virtual module context.
 * @param base - Base of a configured package entry.
 */
export async function getModel(context: PydocsContext, base: string): Promise<PackageModel> {
  const pkg = requirePackage(context, base);

  const options = modelOptionsFor(pkg);
  // The dump path alone is not a key: two entries may share a dump file (the same
  // pinned dump documented at two bases) and must still get one model each, which
  // is why `options` (and with it the base) is part of it. The version labels are
  // not: they are derived from the package's configuration, so they cannot differ
  // for one base within a process.
  const key = JSON.stringify([pkg.dumpPath, pkg.versionsPath, options]);
  const cached = modelCache.get(key);
  if (cached !== undefined) return cached;

  const [dump, addedIn] = await Promise.all([loadDump(pkg.dumpPath), getVersionLabels(context, base)]);
  const model = buildModel(dump, addedIn.size === 0 ? options : { ...options, addedIn });
  modelCache.set(key, model);
  return model;
}

/** Models for every configured package, keyed by base. */
export async function getAllModels(context: PydocsContext): Promise<Map<string, PackageModel>> {
  const models = new Map<string, PackageModel>();
  for (const pkg of context.packages) {
    models.set(pkg.base, await getModel(context, pkg.base));
  }
  return models;
}

/** Inventory lookup for the whole site, cached per process. */
export async function getInventoryLookup(context: PydocsContext): Promise<InventoryLookup> {
  const key = JSON.stringify(context.inventories);
  const cached = inventoryCache.get(key);
  if (cached !== undefined) return cached;

  // Read them together: they are independent files, and the first render of a
  // page waits for all of them.
  const read = await Promise.all(
    context.inventories.map(async (inventory) => {
      try {
        return { base: inventory.base, entries: parseInventory(await fs.readFile(inventory.path)) };
      } catch {
        // A broken cached inventory must not break a page render; annotations
        // simply stay unlinked. The build-time loader already warned.
        return undefined;
      }
    }),
  );

  // Configuration order decides which site wins a name, so keep it.
  const lookup = createInventoryLookup(read.filter((entry) => entry !== undefined));
  inventoryCache.set(key, lookup);
  return lookup;
}

/** Annotation resolver for a package, wired to the site's inventories. */
export async function getAnnotationResolver(context: PydocsContext, base: string): Promise<AnnotationResolver> {
  const [model, inventories] = await Promise.all([getModel(context, base), getInventoryLookup(context)]);
  return buildAnnotationResolver(model, (dottedPath) => inventories.lookup(dottedPath)?.href);
}

/**
 * Cross-reference resolver for the docstrings of one package.
 *
 * Order: the package's own symbol index, then the index of every configured
 * package with a *different* import name, then the Sphinx inventories. Own
 * entry first means a bare `mypkg.Thing` never resolves to a same-named object
 * documented elsewhere on the site; skipping same-named entries keeps one
 * documented version of `mypkg` from linking into another version's pages, which
 * would silently mix two APIs.
 */
export async function getCrossReferenceResolver(context: PydocsContext, base: string): Promise<CrossReferenceResolver> {
  const own = requirePackage(context, base);
  const [models, inventories] = await Promise.all([getAllModels(context), getInventoryLookup(context)]);

  const ownModel = models.get(own.base);
  const others = context.packages
    .filter((pkg) => pkg.base !== own.base && pkg.name !== own.name)
    .map((pkg) => models.get(pkg.base))
    .filter((model): model is PackageModel => model !== undefined);

  return createCrossReferenceResolver({
    models: ownModel === undefined ? others : [ownModel, ...others],
    siteBase: context.siteBase,
    trailingSlash: context.trailingSlash,
    lookupExternal: (dottedPath) => inventories.lookup(dottedPath)?.href,
  });
}

/** Drop every cached dump, model, inventory and sidecar. */
export function clearCaches(): void {
  dumpCache.clear();
  modelCache.clear();
  inventoryCache.clear();
  renderedCache.clear();
  versionsCache.clear();
}
