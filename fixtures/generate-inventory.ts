/**
 * Write the checked-in Sphinx inventory fixture.
 *
 * Run with `pnpm gen:inventory` from the repository root. The result,
 * `fixtures/inventories/python-stdlib.inv`, is a tiny stand-in for CPython's own
 * `objects.inv`: the handful of names the fixture packages annotate with, at the
 * URIs docs.python.org really uses. It is committed because this sandbox cannot
 * reach docs.python.org, and because a docs build that downloads an inventory
 * cannot assert its links offline.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { InventoryEntry } from '../packages/starlight-pydocs/lib/inventory.ts';
import { buildInventory } from '../packages/starlight-pydocs/lib/inventory.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `name`, `role` and `uri` as CPython's inventory spells them. */
const OBJECTS: [name: string, role: string, uri: string][] = [
  ['bool', 'class', 'library/functions.html#bool'],
  ['dict', 'class', 'library/stdtypes.html#dict'],
  ['float', 'class', 'library/functions.html#float'],
  ['int', 'class', 'library/functions.html#int'],
  ['list', 'class', 'library/stdtypes.html#list'],
  ['set', 'class', 'library/stdtypes.html#set'],
  ['str', 'class', 'library/stdtypes.html#str'],
  ['tuple', 'class', 'library/stdtypes.html#tuple'],
  ['Exception', 'exception', 'library/exceptions.html#Exception'],
  ['UserWarning', 'exception', 'library/exceptions.html#UserWarning'],
  ['collections.abc.Iterator', 'class', 'library/collections.abc.html#collections.abc.Iterator'],
  ['pathlib.Path', 'class', 'library/pathlib.html#pathlib.Path'],
  ['typing.Any', 'data', 'library/typing.html#typing.Any'],
];

const entries: InventoryEntry[] = OBJECTS.map(([name, role, uri]) => ({
  name,
  domain: 'py',
  role,
  priority: 1,
  uri,
  dispname: name,
}));

async function main(): Promise<void> {
  const target = path.join(repoRoot, 'fixtures', 'inventories', 'python-stdlib.inv');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buildInventory('Python', '3', entries));
  console.log(`wrote ${path.relative(repoRoot, target)} (${String(entries.length)} entries)`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
