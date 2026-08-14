/**
 * The pages that get a share card, keyed by their path within the site.
 *
 * Hand-written pages are content collection entries, keyed by entry id. The API
 * reference pages are injected routes, which no collection knows about, so the
 * plugin is asked for those. `src/pages/og/[...route].ts` draws a card per key
 * and `src/components/Head.astro` points each page at its own, so the keying
 * rule lives here rather than in both.
 *
 * Computed once per process. Both readers run per page, and `getCollection`
 * clones every entry it returns.
 */

import { getCollection } from 'astro:content';
import { listPydocsPages } from 'starlight-pydocs/pages';
import context from 'virtual:starlight-pydocs/context';

/** What a card needs from a page, and all these two sources have in common. */
export interface CardPage {
  title: string;
  description?: string | undefined;
}

/** Pages written as Markdown in `src/content/docs`. */
export const writtenPages = new Map<string, CardPage>(
  (await getCollection('docs')).map((entry) => [entry.id, entry.data]),
);

/** Pages the plugin injects, which are in no collection. */
export const generatedPages = new Map<string, CardPage>(
  (await listPydocsPages(context)).map((page) => [page.slug, page]),
);

/** Every page with a card of its own, in the shape `OGImageRoute` takes. */
export const cardPages: Record<string, CardPage> = Object.fromEntries([...writtenPages, ...generatedPages]);

/**
 * A page's card key, derived from its URL: the path within the site, or
 * `index` for the root. The counterpart of the keys above.
 */
export function cardKey(pathname: string, base: string): string {
  return pathname.slice(base.length).replace(/^\/|\/$/g, '') || 'index';
}

/** Join site-absolute URL pieces without leaving a doubled slash behind. */
export function sitePath(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}
