import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import context from 'virtual:starlight-pydocs/context';

import { packageForSlug } from './lib/context.ts';
import { getTranslate, resolveString } from './lib/i18n.ts';
import { stripLeadingAndTrailingSlashes } from './lib/paths.ts';
import {
  getDefaultPlaceholderLabel,
  getPydocsNavigation,
  getPydocsPagination,
  replaceSidebarPlaceholder,
  toSidebarGroup,
} from './libs/starlight.ts';

/**
 * Swaps the sidebar placeholders for the generated API tree, and gives the
 * generated pages prev/next links.
 *
 * Starlight route middleware runs for every page of the site, so the expensive
 * part — walking each package's page plan — is built once per process and cached
 * (`getPydocsNavigation`); only `isCurrent` is per request. Pages that are
 * neither pydocs pages nor contain a placeholder return immediately.
 */
export const onRequest = defineRouteMiddleware(async (astroContext) => {
  const { starlightRoute } = astroContext.locals;
  const pathname = stripLeadingAndTrailingSlashes(astroContext.url.pathname);

  const withoutBase =
    context.siteBase !== '' && `/${pathname}`.startsWith(context.siteBase)
      ? stripLeadingAndTrailingSlashes(`/${pathname}`.slice(context.siteBase.length))
      : pathname;
  const isPydocsPage = packageForSlug(context, withoutBase) !== undefined;

  const placeholderLabels = new Set<string>([
    getDefaultPlaceholderLabel(),
    ...context.packages.map((pkg) => pkg.sidebar.group).filter((group): group is string => group !== undefined),
  ]);
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
