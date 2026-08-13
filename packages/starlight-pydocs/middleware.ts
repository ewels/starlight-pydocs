import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import context from 'virtual:starlight-pydocs/context';

import { getTranslate, resolveString } from './lib/i18n.ts';
import { stripLeadingAndTrailingSlashes } from './lib/paths.ts';
import { packageForPathname } from './libs/route.ts';
import {
  getDefaultPlaceholderLabel,
  getPydocsNavigation,
  getPydocsPagination,
  replaceSidebarPlaceholders,
  sidebarGroupsFor,
  sidebarHasPlaceholder,
} from './libs/starlight.ts';

/**
 * Every label a placeholder group can carry: the shared default plus the ones
 * packages asked for. Built once, because the context cannot change within a
 * process and this middleware runs for every page of the site.
 */
const placeholderLabels = new Set<string>([
  getDefaultPlaceholderLabel(),
  ...context.packages.map((pkg) => pkg.sidebar.group).filter((group): group is string => group !== undefined),
]);

/**
 * Swaps the sidebar placeholders for the generated API tree, and gives the
 * generated pages prev/next links.
 *
 * Starlight route middleware runs for every page of the site, so the expensive
 * part (walking each package's page plan) is built once per process and cached
 * (`getPydocsNavigation`); only `isCurrent` is per request. Pages that are
 * neither pydocs pages nor contain a placeholder return immediately.
 */
export const onRequest = defineRouteMiddleware(async (astroContext) => {
  const { starlightRoute } = astroContext.locals;
  // `pathname` keeps the site base: it is compared against generated hrefs,
  // which are site-absolute. The package lookup strips the base itself.
  const pathname = stripLeadingAndTrailingSlashes(astroContext.url.pathname);
  const isPydocsPage = packageForPathname(context, astroContext.url.pathname) !== undefined;
  const hasPlaceholder = sidebarHasPlaceholder(starlightRoute.sidebar, placeholderLabels);

  if (!isPydocsPage && !hasPlaceholder) return;

  const navigation = await getPydocsNavigation(context);

  if (hasPlaceholder) {
    const overviewLabel = resolveString('overview', undefined, getTranslate(astroContext.locals));
    starlightRoute.sidebar = replaceSidebarPlaceholders(
      starlightRoute.sidebar,
      sidebarGroupsFor(navigation, pathname, overviewLabel),
    );
  }

  if (isPydocsPage) {
    const pagination = getPydocsPagination(navigation, pathname);
    if (pagination !== undefined) starlightRoute.pagination = pagination;
  }
});
