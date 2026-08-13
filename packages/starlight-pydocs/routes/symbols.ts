/**
 * `<base>/symbols.json` — the symbol index the search element fetches.
 *
 * Small on purpose: a name, a kind, where it lives and one line of prose. This
 * is the only pydocs JSON a browser ever sees; the dumps stay on disk.
 */

import type { APIRoute } from 'astro';
import context from 'virtual:starlight-pydocs/context';

import { getModel } from '../lib/data.ts';
import { PydocsError } from '../lib/errors.ts';
import { packageForPathname } from '../libs/route.ts';

export const GET: APIRoute = async ({ url }) => {
  const pkg = packageForPathname(context, url.pathname);
  if (pkg === undefined) {
    throw new PydocsError(`starlight-pydocs: no configured package serves ${url.pathname}`);
  }

  const model = await getModel(context, pkg.base);
  const body = {
    package: pkg.name,
    base: pkg.base,
    generated: new Date().toISOString(),
    symbols: model.symbols.map((entry) => ({
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
