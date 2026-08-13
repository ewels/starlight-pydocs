import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

import { OVERRIDABLE_COMPONENTS } from '../lib/config.ts';

/**
 * `virtual.d.ts` hand-writes one export per overridable component because a
 * mapped type cannot express `.astro` default exports. This pins the two lists
 * together so they cannot drift silently.
 */
describe('virtual.d.ts', () => {
  test('declares exactly the overridable components', async () => {
    const declarations = await readFile(new URL('../virtual.d.ts', import.meta.url), 'utf8');
    const block = declarations.split("declare module 'virtual:starlight-pydocs/components'")[1]?.split('}')[0] ?? '';
    const declared = [...block.matchAll(/export const (\w+):/g)].map((match) => match[1]);

    expect(declared.toSorted()).toEqual([...OVERRIDABLE_COMPONENTS].toSorted());
  });
});
