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
import type { RenderScope } from '../lib/render.ts';
import { createRenderScope } from '../lib/render.ts';
import { PydocsError } from '../lib/errors.ts';
import type { PageModel } from '../lib/model.ts';
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
  const routes: PydocsRoute[] = [];
  for (const pkg of context.packages) {
    const model = await getModel(context, pkg.base);
    for (const page of model.pages) {
      routes.push({
        params: { pydocsSlug: page.slug },
        props: { pydocsBase: pkg.base, pydocsSlug: page.slug },
      });
    }
  }
  return routes;
}

/** The page a route's props point at. */
export async function getPydocsPage(context: PydocsContext, props: PydocsRouteProps): Promise<PageModel> {
  const model = await getModel(context, props.pydocsBase);
  const page = model.pagesBySlug.get(props.pydocsSlug);
  if (page === undefined) {
    throw new PydocsError(
      `starlight-pydocs: no generated page for '${props.pydocsSlug}' in '/${props.pydocsBase}'; ` +
        'this usually means a stale build cache, so try removing node_modules/.astro.',
    );
  }
  return page;
}

/**
 * True for the page that documents a package's root module.
 *
 * That page is where the routes place the symbol search box (PLAN.md decision
 * 8): the entry point to a package is where somebody looks for a name, and one
 * box per package keeps it out of the way of every module page.
 */
export function isPackageRootPage(page: PageModel): boolean {
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
  const [scope, page] = await Promise.all([
    createRenderScope(context, props.pydocsBase),
    getPydocsPage(context, props),
  ]);
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
