/** URL/slug helpers shared by the plugin, integration, routes and middleware. */

export function stripLeadingAndTrailingSlashes(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Module dotted path → slug segments under a package base (`pkg.sub.mod` → `sub/mod`). */
export function moduleSlug(base: string, modulePath: string): string {
  const segments = modulePath.split('.');
  // The package root page lives at the base itself.
  const rest = segments.slice(1).join('/');
  return rest === '' ? base : `${base}/${rest}`;
}

/** Build a site-absolute href from base path pieces, respecting trailingSlash. */
export function buildHref(siteBase: string, slug: string, trailingSlash: 'always' | 'never' | 'ignore'): string {
  const path = `${siteBase}/${stripLeadingAndTrailingSlashes(slug)}`.replace(/\/{2,}/g, '/');
  if (trailingSlash === 'never') return path;
  return path.endsWith('/') ? path : `${path}/`;
}
