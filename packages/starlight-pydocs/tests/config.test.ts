import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { formatSourceLink, normalizeConfig } from '../lib/config.ts';
import { PydocsError } from '../lib/errors.ts';

const root = path.resolve('/project');

describe('normalizeConfig defaults', () => {
  test('fills in every default for a minimal configuration', () => {
    const config = normalizeConfig({ packages: [{ name: 'demopkg' }] }, root);
    const pkg = config.packages[0];

    expect(pkg).toMatchObject({
      name: 'demopkg',
      base: 'api/demopkg',
      docstringStyle: 'google',
      docstringOptions: {},
      extensions: [],
      extraRequirements: [],
      forceInspection: false,
      source: undefined,
      members: { include: [], exclude: [] },
      filters: { special: false, private: false, imported: false, inherited: true },
      sourceLink: undefined,
      sidebar: { label: 'demopkg', collapsed: false },
      versions: [],
    });
    expect(pkg?.search).toEqual([root]);
    expect(config).toMatchObject({
      publishInventory: true,
      symbolSearch: true,
      llmsTxt: true,
      injectStyles: true,
      components: {},
      inventories: [],
      projectRoot: root,
    });
    expect(config.cacheDir).toBe(path.join(root, 'node_modules', '.astro'));
    expect(config.runner).toEqual({ command: undefined, python: undefined });
  });

  test('resolves relative paths against the project root and trims the base', () => {
    const config = normalizeConfig(
      {
        packages: [{ name: 'demopkg', base: '/api/py/', search: ['../py/src', 'src'] }],
        cacheDir: '.cache',
      },
      root,
    );

    expect(config.packages[0]?.base).toBe('api/py');
    expect(config.packages[0]?.search).toEqual([path.resolve(root, '../py/src'), path.join(root, 'src')]);
    expect(config.cacheDir).toBe(path.join(root, '.cache'));
  });

  test('normalises extensions, filters and sources', () => {
    const config = normalizeConfig(
      {
        packages: [
          {
            name: 'demopkg',
            extensions: ['griffe_pydantic', { name: 'my_ext', options: { deep: true } }],
            extraRequirements: ['griffe-pydantic'],
            filters: { private: true },
            members: { include: ['demopkg.*'], exclude: ['demopkg._*'] },
            source: { file: './api.json' },
            forceInspection: true,
            docstringOptions: { warn_unknown_params: false },
          },
        ],
      },
      root,
    );
    const pkg = config.packages[0];

    expect(pkg?.extensions).toEqual([
      { name: 'griffe_pydantic', options: undefined },
      { name: 'my_ext', options: { deep: true } },
    ]);
    expect(pkg?.filters).toEqual({ special: false, private: true, imported: false, inherited: true });
    expect(pkg?.members).toEqual({ include: ['demopkg.*'], exclude: ['demopkg._*'] });
    expect(pkg?.source).toEqual({ kind: 'file', path: path.join(root, 'api.json') });
    expect(pkg?.forceInspection).toBe(true);
    expect(pkg?.docstringOptions).toEqual({ warn_unknown_params: false });
  });

  test('url sources default to revalidation', () => {
    const config = normalizeConfig(
      { packages: [{ name: 'demopkg', source: { url: 'https://example.com/api.json' } }] },
      root,
    );
    expect(config.packages[0]?.source).toEqual({
      kind: 'url',
      url: 'https://example.com/api.json',
      cache: 'revalidate',
    });
  });
});

describe('normalizeConfig source links', () => {
  test('expands the github preset', () => {
    const config = normalizeConfig(
      { packages: [{ name: 'demopkg', sourceLink: { host: 'github', repo: 'ewels/starlight-pydocs' } }] },
      root,
    );
    expect(config.packages[0]?.sourceLink).toEqual({
      template: 'https://github.com/ewels/starlight-pydocs/blob/{ref}/{path}#L{start}-L{end}',
      ref: 'main',
    });
  });

  test.each(['gitlab', 'bitbucket'] as const)('expands the %s preset', (host) => {
    const config = normalizeConfig(
      { packages: [{ name: 'demopkg', sourceLink: { host, repo: 'o/r', ref: 'v1' } }] },
      root,
    );
    expect(config.packages[0]?.sourceLink?.template).toContain('o/r');
    expect(config.packages[0]?.sourceLink?.ref).toBe('v1');
  });

  test('keeps an explicit template', () => {
    const config = normalizeConfig(
      {
        packages: [{ name: 'demopkg', sourceLink: { template: 'https://host/{ref}/{path}#{start}', ref: 'dev' } }],
      },
      root,
    );
    expect(config.packages[0]?.sourceLink).toEqual({ template: 'https://host/{ref}/{path}#{start}', ref: 'dev' });
  });

  test('formatSourceLink substitutes every placeholder', () => {
    expect(
      formatSourceLink(
        { template: 'https://github.com/o/r/blob/{ref}/{path}#L{start}-L{end}', ref: 'main' },
        path.join('src', 'demopkg', 'report.py'),
        10,
        20,
      ),
    ).toBe('https://github.com/o/r/blob/main/src/demopkg/report.py#L10-L20');
  });
});

describe('normalizeConfig inventories', () => {
  test('expands the python preset', () => {
    const config = normalizeConfig({ packages: [{ name: 'demopkg' }], inventories: ['python'] }, root);
    expect(config.inventories[0]).toEqual({
      url: 'https://docs.python.org/3/objects.inv',
      file: undefined,
      base: 'https://docs.python.org/3/',
      cache: 'revalidate',
    });
  });

  test('derives the base from the inventory URL', () => {
    const config = normalizeConfig(
      { packages: [{ name: 'demopkg' }], inventories: [{ url: 'https://x.dev/docs/objects.inv' }] },
      root,
    );
    expect(config.inventories[0]?.base).toBe('https://x.dev/docs/');
  });

  test('resolves a local inventory file and requires a base', () => {
    const config = normalizeConfig(
      {
        packages: [{ name: 'demopkg' }],
        inventories: [{ file: 'inv/objects.inv', base: 'https://x.dev/docs' }],
      },
      root,
    );
    expect(config.inventories[0]).toEqual({
      url: undefined,
      file: path.join(root, 'inv', 'objects.inv'),
      base: 'https://x.dev/docs/',
      cache: 'revalidate',
    });
  });
});

describe('normalizeConfig errors', () => {
  test('rejects an empty package list', () => {
    expect(() => normalizeConfig({ packages: [] }, root)).toThrow(
      /^packages: must be a non-empty array of packages to document$/,
    );
  });

  test('names the offending option with its index', () => {
    expect(() => normalizeConfig({ packages: [{ name: 'ok' }, { name: '' }] }, root)).toThrow(/^packages\[1]\.name:/);
  });

  test('rejects an invalid python import name', () => {
    expect(() => normalizeConfig({ packages: [{ name: '2bad' }] }, root)).toThrow(
      /packages\[0]\.name: '2bad' is not a valid Python import name/,
    );
  });

  test('rejects a base at the site root', () => {
    expect(() => normalizeConfig({ packages: [{ name: 'demopkg', base: '/' }] }, root)).toThrow(
      /packages\[0]\.base: must not be empty or the site root/,
    );
  });

  test('rejects duplicate package names', () => {
    expect(() =>
      normalizeConfig({ packages: [{ name: 'demopkg' }, { name: 'demopkg', base: 'other' }] }, root),
    ).toThrow(/packages\[1]\.name: duplicates packages\[0]\.name/);
  });

  test('rejects identical bases', () => {
    expect(() =>
      normalizeConfig(
        {
          packages: [
            { name: 'a', base: 'api' },
            { name: 'b', base: 'api' },
          ],
        },
        root,
      ),
    ).toThrow(/packages\[1]\.base: 'api' overlaps packages\[0]\.base/);
  });

  test('rejects nested bases', () => {
    expect(() =>
      normalizeConfig(
        {
          packages: [
            { name: 'a', base: 'api' },
            { name: 'b', base: 'api/b' },
          ],
        },
        root,
      ),
    ).toThrow(/packages\[1]\.base: 'api\/b' overlaps packages\[0]\.base \('api'\)/);
  });

  test('accepts sibling bases', () => {
    expect(() =>
      normalizeConfig(
        {
          packages: [
            { name: 'a', base: 'api/a' },
            { name: 'b', base: 'api/b' },
          ],
        },
        root,
      ),
    ).not.toThrow();
  });

  test('rejects an unknown docstring style', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid input
      normalizeConfig({ packages: [{ name: 'demopkg', docstringStyle: 'rst' }] }, root),
    ).toThrow(/packages\[0]\.docstringStyle: must be one of google, numpy, sphinx, auto/);
  });

  test('rejects a source with both file and url', () => {
    expect(() =>
      normalizeConfig(
        // @ts-expect-error deliberately invalid input
        { packages: [{ name: 'demopkg', source: { file: 'a.json', url: 'https://x.dev/a.json' } }] },
        root,
      ),
    ).toThrow(/packages\[0]\.source: set either 'file' or 'url', not both/);
  });

  test('rejects a non-http source url', () => {
    expect(() =>
      normalizeConfig({ packages: [{ name: 'demopkg', source: { url: 'ftp://x.dev/a.json' } }] }, root),
    ).toThrow(/packages\[0]\.source\.url: must be an http\(s\) URL/);
  });

  test('rejects a template without a path placeholder', () => {
    expect(() =>
      normalizeConfig({ packages: [{ name: 'demopkg', sourceLink: { template: 'https://x.dev/' } }] }, root),
    ).toThrow(/packages\[0]\.sourceLink\.template: must contain the '\{path}' placeholder/);
  });

  test('rejects an unknown source link host', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid input
      normalizeConfig({ packages: [{ name: 'demopkg', sourceLink: { host: 'sourcehut', repo: 'o/r' } }] }, root),
    ).toThrow(/packages\[0]\.sourceLink\.host: must be one of github, gitlab, bitbucket/);
  });

  test('rejects a malformed repository slug', () => {
    expect(() =>
      normalizeConfig({ packages: [{ name: 'demopkg', sourceLink: { host: 'github', repo: 'owner' } }] }, root),
    ).toThrow(/packages\[0]\.sourceLink\.repo: must be an 'owner\/name' repository slug/);
  });

  test('rejects a local inventory without a base', () => {
    expect(() =>
      normalizeConfig({ packages: [{ name: 'demopkg' }], inventories: [{ file: 'objects.inv' }] }, root),
    ).toThrow(/inventories\[0]\.base: is required when the inventory is a local 'file'/);
  });

  test('rejects an unknown inventory preset', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid input
      normalizeConfig({ packages: [{ name: 'demopkg' }], inventories: ['pandas'] }, root),
    ).toThrow(/inventories\[0]: unknown preset 'pandas'/);
  });

  test('rejects an empty runner command', () => {
    expect(() => normalizeConfig({ packages: [{ name: 'demopkg' }], runner: { command: [] } }, root)).toThrow(
      /runner\.command: must contain at least the executable/,
    );
  });

  test('rejects a non-boolean flag', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid input
      normalizeConfig({ packages: [{ name: 'demopkg' }], llmsTxt: 'yes' }, root),
    ).toThrow(/llmsTxt: must be a boolean/);
  });

  test('rejects a relative project root', () => {
    expect(() => normalizeConfig({ packages: [{ name: 'demopkg' }] }, 'project')).toThrow(
      /projectRoot must be an absolute path/,
    );
  });

  test('throws PydocsError instances', () => {
    expect(() => normalizeConfig({ packages: [] }, root)).toThrow(PydocsError);
  });
});
