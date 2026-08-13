/**
 * `<base>/objects.inv`: this site's own Sphinx inventory.
 *
 * With it, mkdocstrings and Sphinx projects can `:py:class:` straight into these
 * pages. Roles and anchors match mkdocstrings' choices, which is the whole point
 * of using dotted object paths as heading ids.
 */

import type { APIRoute } from 'astro';
import context from 'virtual:starlight-pydocs/context';

import type { InventoryEntry } from '../lib/inventory.ts';
import { buildInventory, inventoryRoleFor } from '../lib/inventory.ts';
import { packageModelForPathname } from '../libs/route.ts';

export const GET: APIRoute = async ({ url }) => {
  const { pkg, model } = await packageModelForPathname(context, url.pathname);

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
