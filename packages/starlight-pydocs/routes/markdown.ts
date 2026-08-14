/**
 * `<page>.md` and `<page>.md.txt`: one generated page as plain Markdown.
 *
 * Both patterns are this one entrypoint. `.md.txt` is the same bytes under an
 * extension every host maps to `text/plain`, for the browsers and viewers that
 * download a `.md` rather than showing it.
 *
 * Same content as the page's slice of `<base>/llms.txt`, addressed per page.
 * `<path>.md` is the convention the Starlight page-action plugins fetch for
 * their "Copy Markdown" and "View as Markdown" buttons, and what an agent
 * handed a single page URL can guess. The whole-package file stays the right
 * answer for ingesting an API in one request; this is the right answer for one
 * page.
 *
 * The route is a catch-all over the same static paths as the page route, so a
 * `.md` exists for exactly the pages that exist.
 */

import type { APIRoute } from 'astro';
import context from 'virtual:starlight-pydocs/context';

import { renderPageMarkdown } from '../lib/markdown-doc.ts';
import type { PydocsRouteProps } from '../libs/route.ts';
import { getPydocsStaticPaths, resolvePydocsPage } from '../libs/route.ts';

export async function getStaticPaths() {
  return getPydocsStaticPaths(context);
}

/**
 * Rendered Markdown per slug, for the build only. The two patterns are two
 * routes over the same pages, so without this every page is rendered twice for
 * byte-identical output. Not used in dev: editing a `.py` file rebuilds the
 * model, and a cached string would outlive it.
 */
const rendered = new Map<string, string>();

export const GET: APIRoute = async ({ props, url }) => {
  const { pydocsSlug } = props as PydocsRouteProps;
  let markdown = import.meta.env.DEV ? undefined : rendered.get(pydocsSlug);
  if (markdown === undefined) {
    const { page } = await resolvePydocsPage(context, props as PydocsRouteProps);
    markdown = renderPageMarkdown(page, { includeSource: true });
    rendered.set(pydocsSlug, markdown);
  }
  // The `.md.txt` alias exists to be plain text, so say so. A static host
  // answers by extension and ignores this; an SSR host sends what we set.
  const type = url.pathname.endsWith('.txt') ? 'text/plain' : 'text/markdown';

  return new Response(markdown, {
    headers: { 'content-type': `${type}; charset=utf-8` },
  });
};
