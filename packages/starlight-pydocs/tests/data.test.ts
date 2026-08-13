import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import type { PydocsContext } from '../lib/context.ts';
import { createContext, packageByName, packageForSlug } from '../lib/context.ts';
import {
  clearCaches,
  getAllModels,
  getAnnotationResolver,
  getInventoryLookup,
  getModel,
  loadDump,
  modelOptionsFor,
} from '../lib/data.ts';
import { buildInventory } from '../lib/inventory.ts';
import { fixturePath } from './helpers.ts';

let workspace: string;

beforeEach(async () => {
  clearCaches();
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-data-'));
});

afterEach(async () => {
  clearCaches();
  await fs.rm(workspace, { recursive: true, force: true });
});

async function contextFor(options: { inventory?: boolean } = {}): Promise<PydocsContext> {
  const dump = path.join(workspace, 'demopkg.json');
  await fs.copyFile(fixturePath('demopkg', 'dump.json'), dump);

  const inventories = [];
  if (options.inventory === true) {
    const file = path.join(workspace, 'objects.inv');
    await fs.writeFile(
      file,
      buildInventory('python', '3', [
        {
          name: 'pathlib.Path',
          domain: 'py',
          role: 'class',
          priority: 1,
          uri: 'library/pathlib.html#pathlib.Path',
          dispname: 'pathlib.Path',
        },
      ]),
    );
    inventories.push({ base: 'https://docs.python.org/3/', path: file });
  }

  const config = normalizeConfig({ packages: [{ name: 'demopkg', base: 'api/demopkg' }] }, workspace);
  return createContext(config, {
    dumpPaths: new Map([['demopkg', dump]]),
    siteBase: '/starlight-pydocs',
    trailingSlash: 'always',
    starlight: true,
    inventories,
  });
}

describe('createContext', () => {
  test('carries the config subset the renderers need and nothing more', async () => {
    const context = await contextFor();
    expect(Object.keys(context).sort()).toEqual([
      'cacheDir',
      'inventories',
      'llmsTxt',
      'packages',
      'publishInventory',
      'siteBase',
      'starlight',
      'symbolSearch',
      'trailingSlash',
    ]);
    expect(Object.keys(context.packages[0] ?? {}).sort()).toEqual([
      'base',
      'docstringStyle',
      'dumpPath',
      'filters',
      'members',
      'name',
      'renderedPath',
      'sidebar',
      'sourceLink',
    ]);
  });

  test('normalises the site base', async () => {
    expect((await contextFor()).siteBase).toBe('/starlight-pydocs');
    const config = normalizeConfig({ packages: [{ name: 'demopkg' }] }, workspace);
    expect(
      createContext(config, {
        dumpPaths: new Map(),
        siteBase: undefined,
        trailingSlash: 'ignore',
        starlight: false,
      }).siteBase,
    ).toBe('');
  });

  test('survives JSON serialisation, since it travels through a virtual module', async () => {
    const context = await contextFor({ inventory: true });
    expect(JSON.parse(JSON.stringify(context))).toEqual(context);
  });

  test('finds the package that owns a slug', async () => {
    const context = await contextFor();
    expect(packageForSlug(context, 'api/demopkg')?.name).toBe('demopkg');
    expect(packageForSlug(context, '/api/demopkg/report/')?.name).toBe('demopkg');
    expect(packageForSlug(context, 'api/demopkgx')).toBeUndefined();
    expect(packageForSlug(context, 'guides/intro')).toBeUndefined();
    expect(packageByName(context, 'demopkg')?.base).toBe('api/demopkg');
    expect(packageByName(context, 'other')).toBeUndefined();
  });
});

describe('loadDump', () => {
  test('parses a dump and reuses the parsed object', async () => {
    const context = await contextFor();
    const dumpPath = context.packages[0]?.dumpPath ?? '';
    const first = await loadDump(dumpPath);
    const second = await loadDump(dumpPath);
    expect(second).toBe(first);
    expect(Object.keys(first)).toEqual(['demopkg']);
  });

  test('re-reads when the file changes', async () => {
    const context = await contextFor();
    const dumpPath = context.packages[0]?.dumpPath ?? '';
    const first = await loadDump(dumpPath);

    await fs.writeFile(dumpPath, JSON.stringify({ demopkg: { kind: 'module', name: 'demopkg', path: 'demopkg' } }));
    await fs.utimes(dumpPath, new Date(Date.now() + 2000), new Date(Date.now() + 2000));

    const second = await loadDump(dumpPath);
    expect(second).not.toBe(first);
  });

  test('reports a missing dump path', async () => {
    await expect(loadDump('')).rejects.toThrow(/no dump path was recorded/);
  });

  test('reports an unreadable dump', async () => {
    await expect(loadDump(path.join(workspace, 'nope.json'))).rejects.toThrow(/cannot read the griffe dump/);
  });

  test('reports invalid JSON', async () => {
    const broken = path.join(workspace, 'broken.json');
    await fs.writeFile(broken, '{not json');
    await expect(loadDump(broken)).rejects.toThrow(/is not valid JSON/);
  });

  test('reports a dump that is not keyed by package name', async () => {
    const wrong = path.join(workspace, 'wrong.json');
    await fs.writeFile(wrong, '[]');
    await expect(loadDump(wrong)).rejects.toThrow(/not an object keyed by package name/);
  });
});

describe('getModel', () => {
  test('builds the model once per package and option set', async () => {
    const context = await contextFor();
    const first = await getModel(context, 'demopkg');
    expect(await getModel(context, 'demopkg')).toBe(first);
    expect(first.pages.map((page) => page.slug)).toContain('api/demopkg/report');
  });

  test('rebuilds when the options differ', async () => {
    const context = await contextFor();
    const first = await getModel(context, 'demopkg');
    const other: PydocsContext = {
      ...context,
      packages: context.packages.map((pkg) => ({ ...pkg, filters: { ...pkg.filters, inherited: false } })),
    };
    expect(await getModel(other, 'demopkg')).not.toBe(first);
  });

  test('names the configured packages when asked for an unknown one', async () => {
    const context = await contextFor();
    await expect(getModel(context, 'other')).rejects.toThrow(
      /'other' is not a configured package \(configured: demopkg\)/,
    );
  });

  test('getAllModels covers every configured package', async () => {
    const context = await contextFor();
    const models = await getAllModels(context);
    expect([...models.keys()]).toEqual(['demopkg']);
  });

  test('modelOptionsFor mirrors the package context', async () => {
    const context = await contextFor();
    const pkg = context.packages[0];
    if (pkg === undefined) throw new Error('no package');
    expect(modelOptionsFor(pkg)).toEqual({
      packageName: 'demopkg',
      base: 'api/demopkg',
      members: pkg.members,
      filters: pkg.filters,
      sourceLink: undefined,
    });
  });
});

describe('inventories at render time', () => {
  test('resolves annotations through the cached inventory', async () => {
    const context = await contextFor({ inventory: true });
    const lookup = await getInventoryLookup(context);
    expect(lookup.lookup('pathlib.Path')?.href).toBe('https://docs.python.org/3/library/pathlib.html#pathlib.Path');

    const resolver = await getAnnotationResolver(context, 'demopkg');
    expect(resolver.resolve('pathlib.Path', 'demopkg.report.Report.generate')).toEqual({
      kind: 'external',
      href: 'https://docs.python.org/3/library/pathlib.html#pathlib.Path',
    });
    expect(resolver.resolve('Report', 'demopkg.report.generate_report')).toEqual({
      kind: 'internal',
      path: 'demopkg.report.Report',
    });
  });

  test('is reused across calls', async () => {
    const context = await contextFor({ inventory: true });
    expect(await getInventoryLookup(context)).toBe(await getInventoryLookup(context));
  });

  test('a broken inventory leaves annotations unlinked instead of failing', async () => {
    const context = await contextFor();
    const broken = path.join(workspace, 'broken.inv');
    await fs.writeFile(broken, 'not an inventory');
    const lookup = await getInventoryLookup({
      ...context,
      inventories: [{ base: 'https://x.dev/', path: broken }],
    });
    expect(lookup.size).toBe(0);
  });

  test('no inventories means an empty lookup', async () => {
    const lookup = await getInventoryLookup(await contextFor());
    expect(lookup.lookup('pathlib.Path')).toBeUndefined();
  });
});
