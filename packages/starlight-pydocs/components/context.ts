/**
 * Loading the virtual context from a component.
 *
 * `<Autodoc>` and `<SymbolSearch>` can be dropped into any page, including one
 * in a project that never registered the plugin or the integration. The import
 * is therefore dynamic and guarded, so the failure is a sentence the author can
 * act on instead of an unresolved-module stack trace.
 *
 * This lives in `components/` rather than `lib/` on purpose: `lib/` is unit
 * tested outside Astro, where the virtual module does not exist.
 */

import type { PydocsContext, PydocsPackageContext } from '../lib/context.ts';
import { PydocsError } from '../lib/errors.ts';

export async function loadPydocsContext(component: string): Promise<PydocsContext> {
  try {
    const module = await import('virtual:starlight-pydocs/context');
    return module.default;
  } catch (cause) {
    throw new PydocsError(
      `starlight-pydocs: <${component}> needs the starlight-pydocs plugin (Starlight) or the ` +
        "'starlight-pydocs/astro' integration (plain Astro) in your Astro config.",
      { cause },
    );
  }
}

/**
 * The package a dotted path belongs to.
 *
 * Longest name first, so `demopkg.sub` wins over `demopkg` when both are
 * configured.
 */
export function packageForDottedPath(context: PydocsContext, dottedPath: string): PydocsPackageContext | undefined {
  return [...context.packages]
    .sort((left, right) => right.name.length - left.name.length)
    .find((pkg) => dottedPath === pkg.name || dottedPath.startsWith(`${pkg.name}.`));
}
