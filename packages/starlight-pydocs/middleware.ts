import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import context from 'virtual:starlight-pydocs/context';

import { buildHref, stripLeadingAndTrailingSlashes } from './lib/paths.ts';
import {
  getDefaultPlaceholderLabel,
  makeSidebarGroup,
  makeSidebarLink,
  replaceSidebarPlaceholder,
} from './libs/starlight.ts';

/**
 * Swaps the sidebar placeholder group for the generated API tree. Runs for
 * every page (Starlight route middleware is global), so it must stay cheap:
 * everything it needs is precomputed context, no dump access.
 */
export const onRequest = defineRouteMiddleware((astroContext) => {
  const { starlightRoute } = astroContext.locals;
  const pathname = stripLeadingAndTrailingSlashes(astroContext.url.pathname);

  const groups = context.packages.map((pkg) => {
    const rootHref = buildHref(context.siteBase, pkg.base, context.trailingSlash);
    const spikeHref = buildHref(context.siteBase, `${pkg.base}/spike`, context.trailingSlash);
    return makeSidebarGroup(
      pkg.name,
      [
        makeSidebarLink(pkg.name, rootHref, pathname === stripLeadingAndTrailingSlashes(rootHref)),
        makeSidebarLink(`${pkg.name}.spike`, spikeHref, pathname === stripLeadingAndTrailingSlashes(spikeHref)),
      ],
      false,
    );
  });

  starlightRoute.sidebar = replaceSidebarPlaceholder(starlightRoute.sidebar, getDefaultPlaceholderLabel(), groups);
});
