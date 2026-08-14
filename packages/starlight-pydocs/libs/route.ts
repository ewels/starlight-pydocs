/**
 * Static paths and page lookup, shared by the Starlight and vanilla routes.
 *
 * Props stay JSON-light (a package base and a slug) because Astro serialises
 * them per route. The route component re-derives the model from the
 * per-process cache, which is free after the first page.
 */

import type { PydocsContext, PydocsPackageContext } from '../lib/context.ts';
import { packageForSlug } from '../lib/context.ts';
import { getModel } from '../lib/data.ts';
import { listPydocsPages } from './pages.ts';
import type { RenderScope } from '../lib/render.ts';
import { createRenderScope } from '../lib/render.ts';
import { PydocsError } from '../lib/errors.ts';
import type { PackageModel, PageModel } from '../lib/model.ts';
import { stripLeadingAndTrailingSlashes } from '../lib/paths.ts';

export interface PydocsRouteProps {
  /**
   * Base of the package entry this page documents. The base, not the import
   * name: one package may be documented at several bases.
   */
  pydocsBase: string;
  /** Page slug, without leading or trailing slashes. */
  pydocsSlug: string;
}

export interface PydocsRoute {
  params: { pydocsSlug: string };
  props: PydocsRouteProps;
}

/** One route per module page of every configured package. */
export async function getPydocsStaticPaths(context: PydocsContext): Promise<PydocsRoute[]> {
  const pages = await listPydocsPages(context);
  return pages.map((page) => ({
    params: { pydocsSlug: page.slug },
    props: { pydocsBase: page.base, pydocsSlug: page.slug },
  }));
}

/**
 * True for the page that documents a package's root module.
 *
 * That page is where the routes place the symbol search box (ARCHITECTURE.md decision
 * 8): the entry point to a package is where somebody looks for a name, and one
 * box per package keeps it out of the way of every module page.
 */
function isPackageRootPage(page: PageModel): boolean {
  return page.parent === undefined;
}

export interface PydocsPageData {
  scope: RenderScope;
  page: PageModel;
  /** Render the symbol search box: package root pages, when the option is on. */
  withSearch: boolean;
}

/**
 * Everything a page route renders, resolved in one call. Both route
 * entrypoints (Starlight and vanilla) share this preamble; only the shell
 * around it differs.
 */
export async function resolvePydocsPage(context: PydocsContext, props: PydocsRouteProps): Promise<PydocsPageData> {
  // The scope already carries the model, so the page is a lookup, not a load.
  const scope = await createRenderScope(context, props.pydocsBase);
  const page = scope.model.pagesBySlug.get(props.pydocsSlug);
  if (page === undefined) {
    throw new PydocsError(
      `starlight-pydocs: no generated page for '${props.pydocsSlug}' in '/${props.pydocsBase}'; ` +
        'this usually means a stale build cache, so try removing node_modules/.astro.',
    );
  }
  return { scope, page, withSearch: context.symbolSearch && isPackageRootPage(page) };
}

/**
 * The package that owns a request pathname, for the endpoint routes.
 *
 * Endpoints are injected at exact patterns (`api/demopkg/symbols.json`) and so
 * have no params to read; the pathname is the only thing that identifies them.
 */
export function packageForPathname(context: PydocsContext, pathname: string): PydocsPackageContext | undefined {
  const base = context.siteBase;
  const withoutBase = base !== '' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return packageForSlug(context, stripLeadingAndTrailingSlashes(withoutBase));
}

/**
 * The package and model behind an endpoint request, or a clear error naming
 * the pathname when nothing is configured there. The three endpoint routes
 * share this preamble the way the page routes share {@link resolvePydocsPage}.
 */
export async function packageModelForPathname(
  context: PydocsContext,
  pathname: string,
): Promise<{ pkg: PydocsPackageContext; model: PackageModel }> {
  const pkg = packageForPathname(context, pathname);
  if (pkg === undefined) {
    throw new PydocsError(`starlight-pydocs: no configured package serves ${pathname}`);
  }
  return { pkg, model: await getModel(context, pkg.base) };
}
