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

import type { PackageMatch, PydocsContext, PydocsPackageContext } from '../lib/context.ts';
import { matchPackageForDottedPath, matchPackageReference } from '../lib/context.ts';
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
 * The package an `<Autodoc name>` documents, given its optional `package` prop.
 *
 * With one entry per import name a bare name is enough. When the same package is
 * documented at several bases (one per version) the name no longer identifies
 * anything, so the `package` prop must name the base, and the error says so.
 *
 * @throws {PydocsError} When nothing matches, or when a name is ambiguous.
 */
export function packageForAutodoc(
  context: PydocsContext,
  name: string,
  reference: string | undefined,
): PydocsPackageContext {
  const match: PackageMatch =
    reference === undefined ? matchPackageForDottedPath(context, name) : matchPackageReference(context, reference);

  if (match.kind === 'match') return match.pkg;

  if (match.kind === 'ambiguous') {
    throw new PydocsError(
      `starlight-pydocs: <Autodoc name="${name}"> is ambiguous: '${match.name}' is documented at ` +
        `${String(match.bases.length)} bases. Set the package prop to one of these bases: ` +
        `${match.bases.map((base) => `'${base}'`).join(', ')}.`,
    );
  }

  if (reference !== undefined) {
    throw new PydocsError(
      `starlight-pydocs: <Autodoc name="${name}" package="${reference}"> names no configured package; ` +
        `package must be a package base (${context.packages.map((pkg) => `'${pkg.base}'`).join(', ')}) ` +
        'or an unambiguous import name.',
    );
  }

  throw new PydocsError(
    `starlight-pydocs: <Autodoc name="${name}"> does not start with a configured package name ` +
      `(configured: ${[...new Set(context.packages.map((pkg) => pkg.name))].join(', ')}); ` +
      'pass the package prop to disambiguate.',
  );
}
