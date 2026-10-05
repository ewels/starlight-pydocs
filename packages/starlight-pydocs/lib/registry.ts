/**
 * The symbol registry other plugins read from `globalThis[Symbol.for('starlight-pydocs')]`.
 *
 * starlight-codeblocks links names in Python code blocks to these pages through
 * it. The shape is a contract shared with that package: change it only together
 * with a new `version`.
 */

import type { PydocsContext } from './context.ts';
import { getAllModels } from './data.ts';
import type { PackageModel } from './model.ts';
import { objectHref } from './paths.ts';
import { truncate } from './render.ts';
import { defaultSignatureText } from './signature.ts';

export interface PydocsRegistrySymbol {
  /** Root-relative, without Astro's `base`. */
  href: string;
  kind: 'module' | 'class' | 'function' | 'method' | 'attribute';
  signature?: string;
  summary?: string;
}

export interface PydocsRegistry {
  version: 1;
  /** In configuration order: for a path documented twice, the first package wins. */
  packages: { name: string; base: string; symbols: Map<string, PydocsRegistrySymbol> }[];
}

const KEY = Symbol.for('starlight-pydocs');

/**
 * Every documented path of a model, re-exports included, as registry entries,
 * plus the definition path of each object documented only at a re-export.
 */
export function registrySymbols(
  model: PackageModel,
  trailingSlash: PydocsContext['trailingSlash'],
): Map<string, PydocsRegistrySymbol> {
  const symbols = new Map<string, PydocsRegistrySymbol>();
  for (const entry of model.symbols) {
    const doc = model.objectsByPath.get(entry.path);
    // Aliases to objects outside the package have no page of their own.
    if (doc === undefined || doc.kind === 'alias') continue;
    const kind = doc.kind === 'function' && doc.parentKind === 'class' ? 'method' : doc.kind;
    const symbol: PydocsRegistrySymbol = { href: objectHref('', entry.pageSlug, entry.anchor, trailingSlash), kind };
    if (doc.kind !== 'module') symbol.signature = defaultSignatureText(doc);
    if (entry.brief !== '') symbol.summary = truncate(entry.brief);
    symbols.set(entry.path, symbol);
  }
  for (const [canonical, documented] of model.documentedByCanonicalPath) {
    const symbol = symbols.get(documented);
    if (symbol !== undefined && !symbols.has(canonical)) symbols.set(canonical, symbol);
  }
  return symbols;
}

/** Publish the registry, replacing any earlier one. Runs at setup and after each dev re-extraction. */
export async function publishRegistry(context: PydocsContext): Promise<void> {
  const models = await getAllModels(context);
  const packages = context.packages.flatMap((pkg) => {
    const model = models.get(pkg.base);
    return model === undefined
      ? []
      : [{ name: pkg.name, base: pkg.base, symbols: registrySymbols(model, context.trailingSlash) }];
  });
  (globalThis as { [KEY]?: PydocsRegistry })[KEY] = { version: 1, packages };
}
