import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import type { PydocsContext } from '../lib/context.ts';
import {
  createContext,
  matchPackageForDottedPath,
  matchPackageReference,
  packageByBase,
  packageForSlug,
  packagesByName,
} from '../lib/context.ts';
import {
  clearCaches,
  getAllModels,
  getAnnotationResolver,
  getCrossReferenceResolver,
  getInventoryLookup,
  getModel,
  loadDump,
  modelOptionsFor,
} from '../lib/data.ts';
import { buildInventory } from '../lib/inventory.ts';
import { listPydocsPages } from '../libs/pages.ts';
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
    dumpPaths: new Map([['api/demopkg', dump]]),
    siteBase: '/starlight-pydocs',
    trailingSlash: 'always',
    starlight: true,
    inventories,
  });
}

/** The same package documented twice: the current source and a pinned 1.x dump. */
async function twoVersionContext(): Promise<PydocsContext> {
  const current = path.join(workspace, 'demopkg.json');
  const pinned = path.join(workspace, 'demopkg-1x.json');
  await fs.copyFile(fixturePath('demopkg', 'dump.json'), current);
  await fs.copyFile(fixturePath('demopkg', 'dump.json'), pinned);

  const config = normalizeConfig(
    {
      packages: [
        { name: 'demopkg' },
        { name: 'demopkg', base: '1x/api/demopkg', label: 'demopkg 1.x', source: { file: pinned } },
      ],
    },
    workspace,
  );
  return createContext(config, {
    dumpPaths: new Map([
      ['api/demopkg', current],
      ['1x/api/demopkg', pinned],
    ]),
    siteBase: '',
    trailingSlash: 'always',
    starlight: true,
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
      'shikiThemes',
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
      'label',
      'members',
      'name',
      'renderedPath',
      'sidebar',
      'sourceLink',
      'versionReleases',
      'versionsPath',
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
    expect(packageByBase(context, 'api/demopkg')?.name).toBe('demopkg');
    expect(packageByBase(context, '/api/demopkg/')?.name).toBe('demopkg');
    expect(packageByBase(context, 'api/other')).toBeUndefined();
  });

  test('records the dump and sidecar of each entry by base', async () => {
    const context = await twoVersionContext();
    expect(context.packages.map((pkg) => [pkg.base, pkg.label, path.basename(pkg.dumpPath)])).toEqual([
      ['api/demopkg', 'demopkg', 'demopkg.json'],
      ['1x/api/demopkg', 'demopkg 1.x', 'demopkg-1x.json'],
    ]);
  });
});

describe('package lookups', () => {
  test('an import name resolves to its only entry', async () => {
    const context = await contextFor();
    expect(matchPackageReference(context, 'demopkg')).toEqual({ kind: 'match', pkg: context.packages[0] });
    expect(matchPackageForDottedPath(context, 'demopkg.report.Report')).toEqual({
      kind: 'match',
      pkg: context.packages[0],
    });
    expect(matchPackageReference(context, 'nosuch')).toEqual({ kind: 'none' });
    expect(matchPackageForDottedPath(context, 'nosuch.Thing')).toEqual({ kind: 'none' });
  });

  test('a name documented at several bases is ambiguous, a base is not', async () => {
    const context = await twoVersionContext();
    expect(packagesByName(context, 'demopkg').map((pkg) => pkg.base)).toEqual(['api/demopkg', '1x/api/demopkg']);

    const ambiguous = { kind: 'ambiguous', name: 'demopkg', bases: ['api/demopkg', '1x/api/demopkg'] };
    expect(matchPackageReference(context, 'demopkg')).toEqual(ambiguous);
    expect(matchPackageForDottedPath(context, 'demopkg.report.Report')).toEqual(ambiguous);

    expect(matchPackageReference(context, '1x/api/demopkg')).toEqual({ kind: 'match', pkg: context.packages[1] });
  });
});

describe('cross-reference resolution across entries', () => {
  test('an entry resolves against itself, never against another version of itself', async () => {
    const context = await twoVersionContext();

    const current = await getCrossReferenceResolver(context, 'api/demopkg');
    const pinned = await getCrossReferenceResolver(context, '1x/api/demopkg');

    expect(current('demopkg.report.Report')).toBe('/api/demopkg/report/#demopkg.report.Report');
    expect(pinned('demopkg.report.Report')).toBe('/1x/api/demopkg/report/#demopkg.report.Report');
  });

  test('a differently named package is still resolved, in configuration order', async () => {
    const context = await twoVersionContext();
    const numpkg = path.join(workspace, 'numpkg.json');
    await fs.copyFile(fixturePath('numpkg', 'dump.json'), numpkg);

    const config = normalizeConfig(
      {
        packages: [
          { name: 'demopkg' },
          { name: 'demopkg', base: '1x/api/demopkg', source: { file: path.join(workspace, 'demopkg-1x.json') } },
          { name: 'numpkg', source: { file: numpkg } },
        ],
      },
      workspace,
    );
    const withNumpkg = createContext(config, {
      dumpPaths: new Map([...context.packages.map((pkg): [string, string] => [pkg.base, pkg.dumpPath])]).set(
        'api/numpkg',
        numpkg,
      ),
      siteBase: '',
      trailingSlash: 'always',
      starlight: true,
    });

    const fromNumpkg = await getCrossReferenceResolver(withNumpkg, 'api/numpkg');
    expect(fromNumpkg('demopkg.report.Report')).toBe('/api/demopkg/report/#demopkg.report.Report');

    const fromPinned = await getCrossReferenceResolver(withNumpkg, '1x/api/demopkg');
    expect(fromPinned('numpkg.Grid')).toBe('/api/numpkg/#numpkg.Grid');
    expect(fromPinned('demopkg.report.Report')).toBe('/1x/api/demopkg/report/#demopkg.report.Report');
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
    const first = await getModel(context, 'api/demopkg');
    expect(await getModel(context, 'api/demopkg')).toBe(first);
    expect(first.pages.map((page) => page.slug)).toContain('api/demopkg/report');
  });

  test('rebuilds when the options differ', async () => {
    const context = await contextFor();
    const first = await getModel(context, 'api/demopkg');
    const other: PydocsContext = {
      ...context,
      packages: context.packages.map((pkg) => ({ ...pkg, filters: { ...pkg.filters, inherited: false } })),
    };
    expect(await getModel(other, 'api/demopkg')).not.toBe(first);
  });

  test('names the configured bases when asked for an unknown one', async () => {
    const context = await contextFor();
    await expect(getModel(context, 'demopkg')).rejects.toThrow(
      /no package is documented at 'demopkg' \(configured: api\/demopkg\)/,
    );
  });

  test('one package at two bases gets one model per base, each with its own pages', async () => {
    const context = await twoVersionContext();
    const current = await getModel(context, 'api/demopkg');
    const pinned = await getModel(context, '1x/api/demopkg');

    expect(current).not.toBe(pinned);
    expect(current.pages.map((page) => page.slug)).toContain('api/demopkg/report');
    expect(pinned.pages.map((page) => page.slug)).toContain('1x/api/demopkg/report');
    // Every page of an entry lives under that entry's base, so no link can cross
    // from one documented version into the other.
    expect(pinned.pages.every((page) => page.slug.startsWith('1x/api/demopkg'))).toBe(true);
    expect(pinned.symbols.every((symbol) => symbol.pageSlug.startsWith('1x/api/demopkg'))).toBe(true);
  });

  test('getAllModels covers every configured package', async () => {
    const context = await contextFor();
    const models = await getAllModels(context);
    expect([...models.keys()]).toEqual(['api/demopkg']);
    expect([...(await getAllModels(await twoVersionContext())).keys()]).toEqual(['api/demopkg', '1x/api/demopkg']);
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

    const resolver = await getAnnotationResolver(context, 'api/demopkg');
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

describe('version release links', () => {
  test('pairs each label with its tag on the configured forge', () => {
    const config = normalizeConfig(
      {
        packages: [
          {
            name: 'demopkg',
            sourceLink: { host: 'github', repo: 'ewels/demopkg' },
            versions: {
              refs: [
                { ref: 'v1.6.0', label: '1.6' },
                { ref: 'v1.9.0', label: '1.9' },
              ],
            },
          },
        ],
      },
      workspace,
    );
    const context = createContext(config, {
      dumpPaths: new Map(),
      siteBase: '',
      trailingSlash: 'ignore',
      starlight: true,
    });
    expect(context.packages[0]?.versionReleases).toEqual({
      '1.6': 'https://github.com/ewels/demopkg/releases/tag/v1.6.0',
      '1.9': 'https://github.com/ewels/demopkg/releases/tag/v1.9.0',
    });
  });

  test('has no release links without a forge preset', () => {
    const config = normalizeConfig(
      {
        packages: [
          {
            name: 'demopkg',
            sourceLink: { template: 'https://example.dev/{path}' },
            versions: { refs: [{ ref: 'v1.9.0', label: '1.9' }] },
          },
        ],
      },
      workspace,
    );
    const context = createContext(config, {
      dumpPaths: new Map(),
      siteBase: '',
      trailingSlash: 'ignore',
      starlight: true,
    });
    expect(context.packages[0]?.versionReleases).toEqual({});
  });
});

describe('listPydocsPages', () => {
  test('lists every generated page with its site path and module summary', async () => {
    const context = await contextFor();
    const pages = await listPydocsPages(context);

    expect(pages.map((page) => page.slug)).toEqual([
      'api/demopkg',
      'api/demopkg/compat',
      'api/demopkg/models',
      'api/demopkg/report',
      'api/demopkg/utils',
    ]);
    // The slug is what a route builds a URL from, so it carries the base; the
    // description is the module's first docstring line, for meta tags and cards.
    expect(pages.find((page) => page.slug === 'api/demopkg/report')).toEqual({
      base: 'api/demopkg',
      slug: 'api/demopkg/report',
      title: 'demopkg.report',
      description: 'Report classes and the functions that build them.',
    });
  });
});
