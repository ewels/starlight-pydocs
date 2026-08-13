import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import context from 'virtual:starlight-pydocs/context';

import { getTranslate, resolveString } from './lib/i18n.ts';
import { stripLeadingAndTrailingSlashes } from './lib/paths.ts';
import { packageForPathname } from './libs/route.ts';
import {
  getDefaultPlaceholderLabel,
  getPydocsNavigation,
  getPydocsPagination,
  replaceSidebarPlaceholder,
  toSidebarGroup,
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
  const overviewLabel = resolveString('overview', undefined, getTranslate(astroContext.locals));

  if (hasPlaceholder) {
    let sidebar = starlightRoute.sidebar;
    for (const [placeholder, groups] of navigation.groupsByPlaceholder) {
      sidebar = replaceSidebarPlaceholder(
        sidebar,
        placeholder,
        groups.map((group) => toSidebarGroup(group, pathname, overviewLabel)),
      );
    }
    starlightRoute.sidebar = sidebar;
  }

  if (isPydocsPage) {
    const pagination = getPydocsPagination(navigation, pathname);
    if (pagination !== undefined) starlightRoute.pagination = pagination;
  }
});

/** Cheap scan for a placeholder group anywhere in the sidebar. */
function sidebarHasPlaceholder(sidebar: Parameters<typeof replaceSidebarPlaceholder>[0], labels: Set<string>): boolean {
  return sidebar.some((entry) => {
    if (entry.type !== 'group') return false;
    return labels.has(entry.label) || sidebarHasPlaceholder(entry.entries, labels);
  });
}
