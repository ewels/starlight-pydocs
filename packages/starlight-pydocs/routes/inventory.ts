/**
 * `<base>/objects.inv` — this site's own Sphinx inventory.
 *
 * With it, mkdocstrings and Sphinx projects can `:py:class:` straight into these
 * pages. Roles and anchors match mkdocstrings' choices, which is the whole point
 * of using dotted object paths as heading ids.
 */

import type { APIRoute } from 'astro';
import context from 'virtual:starlight-pydocs/context';

import { getModel } from '../lib/data.ts';
import { PydocsError } from '../lib/errors.ts';
import type { InventoryEntry } from '../lib/inventory.ts';
import { buildInventory, inventoryRoleFor } from '../lib/inventory.ts';
import { packageForPathname } from '../libs/route.ts';

export const GET: APIRoute = async ({ url }) => {
  const pkg = packageForPathname(context, url.pathname);
  if (pkg === undefined) {
    throw new PydocsError(`starlight-pydocs: no configured package serves ${url.pathname}`);
  }

  const model = await getModel(context, pkg.base);

  const entries: InventoryEntry[] = model.symbols.map((entry) => {
    const object = model.objectsByPath.get(entry.path);
    const isMethod = object?.parentKind === 'class';
    // URIs are relative to the inventory's own directory, which is the
    // package's base, so strip that prefix and keep the page's trailing slash.
    const relativePage = entry.pageSlug === pkg.base ? '' : `${entry.pageSlug.slice(pkg.base.length + 1)}/`;
    return {
      name: entry.path,
      domain: 'py',
      role: inventoryRoleFor(entry.kind, isMethod),
      priority: 1,
      uri: entry.anchor === '' ? relativePage : `${relativePage}#${entry.anchor}`,
      dispname: entry.path,
    };
  });

  return new Response(buildInventory(pkg.label, '', entries), {
    headers: { 'content-type': 'application/octet-stream' },
  });
};
