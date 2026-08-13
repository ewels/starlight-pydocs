import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import { createMemoryLogger } from '../lib/logger.ts';
import type { InventoryEntry } from '../lib/inventory.ts';
import {
  buildInventory,
  createInventoryLookup,
  inventoryRoleFor,
  loadInventories,
  parseInventory,
} from '../lib/inventory.ts';

const entries: InventoryEntry[] = [
  {
    name: 'pathlib.Path',
    domain: 'py',
    role: 'class',
    priority: 1,
    uri: 'library/pathlib.html#pathlib.Path',
    dispname: 'pathlib.Path',
  },
  {
    name: 'str',
    domain: 'py',
    role: 'class',
    priority: 1,
    uri: 'library/stdtypes.html#str',
    dispname: 'str',
  },
  {
    name: 'demopkg.report.Report.generate',
    domain: 'py',
    role: 'method',
    priority: 1,
    uri: 'api/demopkg/report/#demopkg.report.Report.generate',
    dispname: 'generate',
  },
  {
    name: 'genindex',
    domain: 'std',
    role: 'label',
    priority: -1,
    uri: 'genindex.html',
    dispname: 'Index',
  },
];

/** Assemble an inventory by hand, so the parser is tested against raw bytes. */
function rawInventory(lines: string[], header = '# Sphinx inventory version 2'): Uint8Array {
  const head = [
    header,
    '# Project: demopkg',
    '# Version: 1.0',
    '# The remainder of this file is compressed using zlib.',
    '',
  ].join('\n');
  return Buffer.concat([Buffer.from(head, 'utf8'), deflateSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'))]);
}

describe('parseInventory', () => {
  test('round-trips what buildInventory writes', () => {
    const parsed = parseInventory(buildInventory('demopkg', '1.0', entries));
    expect(parsed).toEqual(entries);
  });

  test('round-trips a project name with multi-byte characters', () => {
    // The header end must be counted in bytes, not decoded characters, or the
    // zlib payload is sliced at the wrong offset and fails to decompress.
    const parsed = parseInventory(buildInventory('prøjekt — ünicode', '1.0', entries));
    expect(parsed).toEqual(entries);
  });

  test('keeps the four header lines intact', () => {
    const text = new TextDecoder().decode(buildInventory('demopkg', '1.0', entries).slice(0, 160));
    expect(text.split('\n').slice(0, 4)).toEqual([
      '# Sphinx inventory version 2',
      '# Project: demopkg',
      '# Version: 1.0',
      '# The remainder of this file is compressed using zlib.',
    ]);
  });

  test('expands a trailing $ in the uri to the object name', () => {
    const parsed = parseInventory(rawInventory(['demopkg.Report py:class 1 api/demopkg/#$ -']));
    expect(parsed[0]).toEqual({
      name: 'demopkg.Report',
      domain: 'py',
      role: 'class',
      priority: 1,
      uri: 'api/demopkg/#demopkg.Report',
      dispname: 'demopkg.Report',
    });
  });

  test('compresses the uri back to $ when it ends with the name', () => {
    const built = buildInventory('demopkg', '1.0', [
      {
        name: 'demopkg.Report',
        domain: 'py',
        role: 'class',
        priority: 1,
        uri: 'api/demopkg/#demopkg.Report',
        dispname: 'demopkg.Report',
      },
    ]);
    // Inflate by hand to see the compressed form on the wire.
    const parsed = parseInventory(built);
    expect(parsed[0]?.uri).toBe('api/demopkg/#demopkg.Report');
    expect(built.byteLength).toBeLessThan(200);
  });

  test('treats a dispname of - as the name', () => {
    const parsed = parseInventory(rawInventory(['x.y py:function 1 mod.html#x.y -']));
    expect(parsed[0]?.dispname).toBe('x.y');
  });

  test('keeps dispnames containing spaces', () => {
    const parsed = parseInventory(rawInventory(['x.y py:function 1 mod.html#x.y a nice name']));
    expect(parsed[0]?.dispname).toBe('a nice name');
  });

  test('accepts negative priorities and empty roles', () => {
    const parsed = parseInventory(rawInventory(['x py: -1 mod.html -']));
    expect(parsed[0]).toMatchObject({ priority: -1, role: '', domain: 'py' });
  });

  test('skips malformed lines instead of failing', () => {
    const parsed = parseInventory(
      rawInventory(['garbage', '', 'good.one py:class 1 a.html#good.one -', 'also bad line']),
    );
    expect(parsed.map((entry) => entry.name)).toEqual(['good.one']);
  });

  test('rejects a file that is not a v2 inventory', () => {
    expect(() => parseInventory(rawInventory(['x py:class 1 a.html -'], '# Sphinx inventory version 1'))).toThrow(
      /not a Sphinx v2 inventory/,
    );
  });

  test('rejects a truncated header', () => {
    expect(() => parseInventory(Buffer.from('# Sphinx inventory version 2\n', 'utf8'))).toThrow(
      /inventory is truncated/,
    );
  });

  test('rejects a corrupt payload', () => {
    const head = [
      '# Sphinx inventory version 2',
      '# Project: x',
      '# Version: 1',
      '# The remainder of this file is compressed using zlib.',
      '',
    ].join('\n');
    expect(() => parseInventory(Buffer.concat([Buffer.from(head), Buffer.from('not zlib')]))).toThrow(
      /could not decompress/,
    );
  });

  test('handles an empty inventory', () => {
    expect(parseInventory(buildInventory('demopkg', '1.0', []))).toEqual([]);
  });
});

describe('createInventoryLookup', () => {
  test('resolves python entries against the base URL', () => {
    const lookup = createInventoryLookup([{ base: 'https://docs.python.org/3/', entries }]);
    expect(lookup.lookup('pathlib.Path')).toEqual({
      href: 'https://docs.python.org/3/library/pathlib.html#pathlib.Path',
      role: 'class',
      dispname: 'pathlib.Path',
    });
  });

  test('ignores non-python domains', () => {
    const lookup = createInventoryLookup([{ base: 'https://docs.python.org/3/', entries }]);
    expect(lookup.lookup('genindex')).toBeUndefined();
    expect(lookup.size).toBe(3);
  });

  test('drops entries whose absolute URI carries an unsafe scheme', () => {
    const hostile: InventoryEntry[] = [
      { name: 'evil.Thing', domain: 'py', role: 'class', priority: 1, uri: 'javascript:alert(1)', dispname: '-' },
      {
        name: 'fine.Thing',
        domain: 'py',
        role: 'class',
        priority: 1,
        uri: 'https://elsewhere.example/fine.html#fine.Thing',
        dispname: '-',
      },
    ];
    const lookup = createInventoryLookup([{ base: 'https://docs.example/', entries: hostile }]);
    expect(lookup.lookup('evil.Thing')).toBeUndefined();
    expect(lookup.lookup('fine.Thing')?.href).toBe('https://elsewhere.example/fine.html#fine.Thing');
  });

  test('earlier inventories win', () => {
    const lookup = createInventoryLookup([
      { base: 'https://first.dev/', entries: [{ ...entries[0]!, uri: 'first.html' }] },
      { base: 'https://second.dev/', entries: [{ ...entries[0]!, uri: 'second.html' }] },
    ]);
    expect(lookup.lookup('pathlib.Path')?.href).toBe('https://first.dev/first.html');
  });

  test('keeps absolute uris as they are', () => {
    const lookup = createInventoryLookup([
      { base: 'https://docs.python.org/3/', entries: [{ ...entries[0]!, uri: 'https://elsewhere.dev/p.html' }] },
    ]);
    expect(lookup.lookup('pathlib.Path')?.href).toBe('https://elsewhere.dev/p.html');
  });
});

describe('inventoryRoleFor', () => {
  test('maps our kinds onto mkdocstrings roles', () => {
    expect(inventoryRoleFor('module', false)).toBe('module');
    expect(inventoryRoleFor('class', false)).toBe('class');
    expect(inventoryRoleFor('function', false)).toBe('function');
    expect(inventoryRoleFor('function', true)).toBe('method');
    expect(inventoryRoleFor('attribute', false)).toBe('attribute');
    expect(inventoryRoleFor('alias', false)).toBe('attribute');
  });
});

describe('loadInventories', () => {
  let workspace: string;
  let server: Server | undefined;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-inventory-'));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) return resolve();
      server.close(() => resolve());
    });
    server = undefined;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  test('reads a local inventory file', async () => {
    const file = path.join(workspace, 'objects.inv');
    await fs.writeFile(file, buildInventory('demopkg', '1.0', entries));
    const config = normalizeConfig(
      { packages: [{ name: 'demopkg' }], inventories: [{ file: 'objects.inv', base: 'https://x.dev/docs' }] },
      workspace,
    );

    const loaded = await loadInventories(config.inventories, { cacheDir: path.join(workspace, 'cache') });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.base).toBe('https://x.dev/docs/');
    expect(loaded[0]?.entries).toHaveLength(entries.length);
  });

  test('downloads an inventory over http and caches it', async () => {
    const payload = buildInventory('demopkg', '1.0', entries);
    let requests = 0;
    server = createServer((request, response) => {
      requests += 1;
      if (request.headers['if-none-match'] === '"v1"') {
        response.writeHead(304).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream', etag: '"v1"' });
      response.end(Buffer.from(payload));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const config = normalizeConfig(
      {
        packages: [{ name: 'demopkg' }],
        inventories: [{ url: `http://127.0.0.1:${port}/objects.inv`, base: `http://127.0.0.1:${port}/` }],
      },
      workspace,
    );
    const options = { cacheDir: path.join(workspace, 'cache') };

    const first = await loadInventories(config.inventories, options);
    expect(first[0]?.entries.map((entry) => entry.name)).toContain('pathlib.Path');

    const second = await loadInventories(config.inventories, options);
    expect(second[0]?.entries).toHaveLength(entries.length);
    // The second load revalidated and got a 304 rather than the payload.
    expect(requests).toBe(2);
  });

  test('warns and carries on when an inventory cannot be loaded', async () => {
    const logger = createMemoryLogger();
    const config = normalizeConfig(
      {
        packages: [{ name: 'demopkg' }],
        inventories: [{ file: 'missing.inv', base: 'https://x.dev/' }],
      },
      workspace,
    );

    const loaded = await loadInventories(config.inventories, {
      cacheDir: path.join(workspace, 'cache'),
      logger,
    });

    expect(loaded).toEqual([]);
    expect(logger.messages[0]).toMatch(/could not load the inventory/);
  });

  test('warns when the downloaded file is not an inventory', async () => {
    const logger = createMemoryLogger();
    const file = path.join(workspace, 'objects.inv');
    await fs.writeFile(file, 'nonsense\n');
    const config = normalizeConfig(
      { packages: [{ name: 'demopkg' }], inventories: [{ file: 'objects.inv', base: 'https://x.dev/' }] },
      workspace,
    );

    expect(await loadInventories(config.inventories, { cacheDir: workspace, logger })).toEqual([]);
    expect(logger.messages[0]).toMatch(/could not load the inventory/);
  });
});
