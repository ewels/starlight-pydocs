import { describe, expect, test } from 'vitest';

import { registrySymbols } from '../lib/registry.ts';
import { fixtureModel } from './helpers.ts';

describe('registrySymbols', async () => {
  const symbols = registrySymbols(await fixtureModel('demopkg'), 'always');

  test('lists a re-exported class and its methods under the re-export path', () => {
    expect(symbols.get('demopkg.Report')).toMatchObject({
      href: '/api/demopkg/#demopkg.Report',
      kind: 'class',
      signature: 'class Report(BaseReport)',
      summary: 'A named collection of scored sections.',
    });
    expect(symbols.get('demopkg.Report.generate')).toMatchObject({
      href: '/api/demopkg/#demopkg.Report.generate',
      kind: 'method',
    });
  });

  test('still lists the definition path', () => {
    expect(symbols.get('demopkg.report.Report')?.href).toBe('/api/demopkg/report/#demopkg.report.Report');
  });

  test('links a module to its page, with no anchor and no signature', () => {
    expect(symbols.get('demopkg.report')).toEqual({
      href: '/api/demopkg/report/',
      kind: 'module',
      summary: expect.any(String) as string,
    });
  });

  test('uses only the contract kinds', () => {
    const kinds = new Set([...symbols.values()].map((symbol) => symbol.kind));
    expect([...kinds].every((kind) => ['module', 'class', 'function', 'method', 'attribute'].includes(kind))).toBe(
      true,
    );
  });
});
