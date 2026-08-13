/**
 * `<base>/symbols.json`: the symbol index the search element fetches.
 *
 * Small on purpose: a name, a kind, where it lives and one line of prose. This
 * is the only pydocs JSON a browser ever sees; the dumps stay on disk.
 */

import type { APIRoute } from 'astro';
import context from 'virtual:starlight-pydocs/context';

import type { SearchEntry } from '../lib/search-match.ts';
import { packageModelForPathname } from '../libs/route.ts';

export const GET: APIRoute = async ({ url }) => {
  const { pkg, model } = await packageModelForPathname(context, url.pathname);
  const body = {
    package: pkg.name,
    base: pkg.base,
    generated: new Date().toISOString(),
    // Typed as the search element's own entry type, so producer and consumer
    // cannot drift: this is the shape the browser reads back.
    symbols: model.symbols.map((entry): SearchEntry => ({
      path: entry.path,
      kind: entry.kind,
      page: entry.pageSlug,
      anchor: entry.anchor,
      brief: entry.brief,
    })),
  };

  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
