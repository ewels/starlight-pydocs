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

interface CachedDump {
  mtimeMs: number;
  dump: GriffeDump;
}

interface CachedRendered {
  mtimeMs: number;
  rendered: RenderedDocstrings;
}

const dumpCache = new Map<string, CachedDump>();
const modelCache = new Map<string, PackageModel>();
const inventoryCache = new Map<string, InventoryLookup>();
const renderedCache = new Map<string, CachedRendered>();

/**
 * Parse a dump, reusing the parsed object while the file is unchanged.
 *
 * @throws {PydocsError} When the file is missing or is not a griffe dump.
 */
export async function loadDump(dumpPath: string): Promise<GriffeDump> {
  if (dumpPath === '') {
    throw new PydocsError('starlight-pydocs: no dump path was recorded for this package (extraction did not run)');
  }

  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(dumpPath)).mtimeMs;
  } catch (cause) {
    throw new PydocsError(`starlight-pydocs: cannot read the griffe dump at ${dumpPath}`, { cause });
  }

  const cached = dumpCache.get(dumpPath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.dump;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(dumpPath, 'utf8'));
  } catch (cause) {
    throw new PydocsError(`starlight-pydocs: the griffe dump at ${dumpPath} is not valid JSON`, { cause });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PydocsError(
      `starlight-pydocs: the griffe dump at ${dumpPath} is not an object keyed by package name; ` +
        'regenerate it with `griffe dump -f -d <style>`',
    );
  }

  const dump = parsed as GriffeDump;
  dumpCache.set(dumpPath, { mtimeMs, dump });
  return dump;
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

  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(renderedPath)).mtimeMs;
  } catch (cause) {
    throw new PydocsError(
      `starlight-pydocs: the pre-rendered docstrings at ${renderedPath} are missing; ` +
        'docstring prose is rendered at astro:config:done, so this usually means the integration was not registered',
      { cause },
    );
  }

  const cached = renderedCache.get(renderedPath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.rendered;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(renderedPath, 'utf8'));
  } catch (cause) {
    throw new PydocsError(`starlight-pydocs: ${renderedPath} is not valid JSON`, { cause });
  }

  const rendered =
    typeof parsed === 'object' && parsed !== null && 'objects' in parsed
      ? (parsed as RenderedDocstrings)
      : { objects: {} };
  renderedCache.set(renderedPath, { mtimeMs, rendered });
  return rendered;
}

/** Pre-rendered docstrings for a configured package. */
export async function getRenderedDocstrings(context: PydocsContext, pkgName: string): Promise<RenderedDocstrings> {
  const pkg = context.packages.find((entry) => entry.name === pkgName);
  if (pkg === undefined) {
    throw new PydocsError(`starlight-pydocs: '${pkgName}' is not a configured package`);
  }
  return loadRendered(pkg.renderedPath);
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
 * Build (or reuse) the normalised model for a package.
 *
 * @param context - The virtual module context.
 * @param pkgName - Python import name of a configured package.
 */
export async function getModel(context: PydocsContext, pkgName: string): Promise<PackageModel> {
  const pkg = context.packages.find((entry) => entry.name === pkgName);
  if (pkg === undefined) {
    throw new PydocsError(
      `starlight-pydocs: '${pkgName}' is not a configured package (configured: ${context.packages
        .map((entry) => entry.name)
        .join(', ')})`,
    );
  }

  const options = modelOptionsFor(pkg);
  const key = JSON.stringify([pkg.dumpPath, options]);
  const cached = modelCache.get(key);
  if (cached !== undefined) return cached;

  const model = buildModel(await loadDump(pkg.dumpPath), options);
  modelCache.set(key, model);
  return model;
}

/** Models for every configured package, keyed by import name. */
export async function getAllModels(context: PydocsContext): Promise<Map<string, PackageModel>> {
  const models = new Map<string, PackageModel>();
  for (const pkg of context.packages) {
    models.set(pkg.name, await getModel(context, pkg.name));
  }
  return models;
}

/** Inventory lookup for the whole site, cached per process. */
export async function getInventoryLookup(context: PydocsContext): Promise<InventoryLookup> {
  const key = JSON.stringify(context.inventories);
  const cached = inventoryCache.get(key);
  if (cached !== undefined) return cached;

  const parsed: { base: string; entries: ReturnType<typeof parseInventory> }[] = [];
  for (const inventory of context.inventories) {
    try {
      parsed.push({ base: inventory.base, entries: parseInventory(await fs.readFile(inventory.path)) });
    } catch {
      // A broken cached inventory must not break a page render; annotations
      // simply stay unlinked. The build-time loader already warned.
    }
  }

  const lookup = createInventoryLookup(parsed);
  inventoryCache.set(key, lookup);
  return lookup;
}

/** Annotation resolver for a package, wired to the site's inventories. */
export async function getAnnotationResolver(context: PydocsContext, pkgName: string): Promise<AnnotationResolver> {
  const [model, inventories] = await Promise.all([getModel(context, pkgName), getInventoryLookup(context)]);
  return buildAnnotationResolver(model, (dottedPath) => inventories.lookup(dottedPath)?.href);
}

/**
 * Cross-reference resolver for the docstrings of one package.
 *
 * Order: the package's own symbol index, then every other configured package's,
 * then the Sphinx inventories. Own package first means a bare `mypkg.Thing`
 * never resolves to a same-named object documented elsewhere on the site.
 */
export async function getCrossReferenceResolver(
  context: PydocsContext,
  pkgName: string,
): Promise<CrossReferenceResolver> {
  const [models, inventories] = await Promise.all([getAllModels(context), getInventoryLookup(context)]);
  const own = models.get(pkgName);
  const others = [...models.entries()].filter(([name]) => name !== pkgName).map(([, model]) => model);

  return createCrossReferenceResolver({
    models: own === undefined ? others : [own, ...others],
    siteBase: context.siteBase,
    trailingSlash: context.trailingSlash,
    lookupExternal: (dottedPath) => inventories.lookup(dottedPath)?.href,
  });
}

/** Drop every cached dump, model, inventory and rendered sidecar. */
export function clearCaches(): void {
  dumpCache.clear();
  modelCache.clear();
  inventoryCache.clear();
  renderedCache.clear();
}
