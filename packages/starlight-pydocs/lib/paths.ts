/** URL/slug helpers shared by the plugin, integration, routes and middleware. */

export function stripLeadingAndTrailingSlashes(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Module dotted path → slug segments under a package base (`pkg.sub.mod` → `base/sub/mod`). */
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

/**
 * Href of a documented object: the page it lives on plus its anchor. Anchors are
 * the dotted object path, matching mkdocstrings so inventories interoperate.
 */
export function objectHref(
  siteBase: string,
  pageSlug: string,
  anchor: string | undefined,
  trailingSlash: 'always' | 'never' | 'ignore',
): string {
  const page = buildHref(siteBase, pageSlug, trailingSlash);
  return anchor === undefined || anchor === '' ? page : `${page}#${anchor}`;
}

/**
 * Href of a file served next to a package's pages (`symbols.json`,
 * `objects.inv`, `llms.txt`). Unlike {@link buildHref} this never appends a
 * trailing slash: these are files, not pages.
 */
export function assetHref(siteBase: string, base: string, filename: string): string {
  return `${siteBase}/${stripLeadingAndTrailingSlashes(base)}/${filename}`.replace(/\/{2,}/g, '/');
}

/** Dotted path of the module a member belongs to, or undefined for a package root. */
export function parentPath(dottedPath: string): string | undefined {
  const index = dottedPath.lastIndexOf('.');
  return index === -1 ? undefined : dottedPath.slice(0, index);
}

/** Last segment of a dotted path (`demopkg.report.Report` → `Report`). */
export function shortName(dottedPath: string): string {
  const index = dottedPath.lastIndexOf('.');
  return index === -1 ? dottedPath : dottedPath.slice(index + 1);
}

/** True when `candidate` is `ancestor` itself or nested inside it. */
export function isInside(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}.`);
}

/**
 * Match a dotted path against a tiny glob dialect: `*` matches within one dotted
 * segment, `**` matches across segments. No other metacharacters are supported,
 * which keeps patterns readable and needs no dependency.
 */
export function matchesDottedGlob(pattern: string, dottedPath: string): boolean {
  return globToRegExp(pattern).test(dottedPath);
}

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) return cached;

  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*') {
      if (pattern.charAt(index + 1) === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^.]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^.]';
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const regExp = new RegExp(`^${source}$`);
  globCache.set(pattern, regExp);
  return regExp;
}
