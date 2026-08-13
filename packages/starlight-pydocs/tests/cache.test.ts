import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  collectPythonFiles,
  computeCacheKey,
  computeExtractionKey,
  dumpCacheLocation,
  fetchToCache,
  fileExists,
  remoteCacheDirectory,
  renderedSidecarPath,
  writeAtomic,
} from '../lib/cache.ts';
import { normalizeConfig } from '../lib/config.ts';
import { createMemoryLogger } from '../lib/logger.ts';
import { onlyPackage } from './helpers.ts';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-cache-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

const baseInput = {
  argv: ['uvx', '--from', 'griffe', 'griffe', 'dump'],
  docstringStyle: 'google',
  docstringOptions: {},
  extensions: [],
  files: [{ relativePath: 'demopkg/__init__.py', mtimeMs: 1000, size: 42 }],
};

describe('computeCacheKey', () => {
  test('is stable across calls and key order', () => {
    const first = computeCacheKey(baseInput);
    const second = computeCacheKey({
      files: baseInput.files,
      extensions: [],
      docstringOptions: {},
      docstringStyle: 'google',
      argv: [...baseInput.argv],
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test('ignores the order files are discovered in', () => {
    const files = [
      { relativePath: 'b.py', mtimeMs: 2, size: 2 },
      { relativePath: 'a.py', mtimeMs: 1, size: 1 },
    ];
    expect(computeCacheKey({ ...baseInput, files })).toBe(
      computeCacheKey({ ...baseInput, files: [...files].reverse() }),
    );
  });

  test('changes when a file mtime changes', () => {
    expect(
      computeCacheKey({ ...baseInput, files: [{ relativePath: 'demopkg/__init__.py', mtimeMs: 2000, size: 42 }] }),
    ).not.toBe(computeCacheKey(baseInput));
  });

  test('changes when a file size changes', () => {
    expect(
      computeCacheKey({ ...baseInput, files: [{ relativePath: 'demopkg/__init__.py', mtimeMs: 1000, size: 43 }] }),
    ).not.toBe(computeCacheKey(baseInput));
  });

  test('changes when a file is added', () => {
    expect(
      computeCacheKey({ ...baseInput, files: [...baseInput.files, { relativePath: 'x.py', mtimeMs: 1, size: 1 }] }),
    ).not.toBe(computeCacheKey(baseInput));
  });

  test.each([
    ['argv', { argv: ['python', '-m', 'griffe', 'dump'] }],
    ['docstringStyle', { docstringStyle: 'numpy' }],
    ['docstringOptions', { docstringOptions: { warnings: false } }],
    ['extensions', { extensions: [{ name: 'griffe_pydantic', options: undefined }] }],
  ])('changes when %s changes', (_name, override) => {
    expect(computeCacheKey({ ...baseInput, ...override })).not.toBe(computeCacheKey(baseInput));
  });
});

describe('collectPythonFiles', () => {
  test('finds .py and .pyi files and skips noise', async () => {
    await fs.mkdir(path.join(workspace, 'pkg', '__pycache__'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'pkg', '.hidden'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'pkg', 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'pkg', 'sub'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'pkg', '__init__.py'), '');
    await fs.writeFile(path.join(workspace, 'pkg', 'types.pyi'), '');
    await fs.writeFile(path.join(workspace, 'pkg', 'README.md'), '');
    await fs.writeFile(path.join(workspace, 'pkg', 'sub', 'mod.py'), '');
    await fs.writeFile(path.join(workspace, 'pkg', '__pycache__', 'mod.cpython-312.pyc'), '');
    await fs.writeFile(path.join(workspace, 'pkg', '__pycache__', 'mod.py'), '');
    await fs.writeFile(path.join(workspace, 'pkg', '.hidden', 'mod.py'), '');
    await fs.writeFile(path.join(workspace, 'pkg', 'node_modules', 'mod.py'), '');

    const files = await collectPythonFiles([workspace]);
    expect(files.map((file) => file.relativePath).sort()).toEqual([
      'pkg/__init__.py',
      'pkg/sub/mod.py',
      'pkg/types.pyi',
    ]);
    expect(files.every((file) => file.mtimeMs > 0)).toBe(true);
  });

  test('warns about a search path that does not exist', async () => {
    const logger = createMemoryLogger();
    const files = await collectPythonFiles([path.join(workspace, 'nope')], logger);
    expect(files).toEqual([]);
    expect(logger.messages[0]).toMatch(/search path does not exist/);
  });

  test('computeExtractionKey hashes the files under the configured search paths', async () => {
    await fs.mkdir(path.join(workspace, 'src', 'demopkg'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'demopkg', '__init__.py'), '');
    const pkg = onlyPackage(normalizeConfig({ packages: [{ name: 'demopkg', search: ['src'] }] }, workspace));

    const before = await computeExtractionKey(pkg, ['uvx']);
    await fs.writeFile(path.join(workspace, 'src', 'demopkg', 'extra.py'), 'x = 1\n');
    const after = await computeExtractionKey(pkg, ['uvx']);

    expect(before).not.toBe(after);
    expect(await computeExtractionKey(pkg, ['uvx'])).toBe(after);
  });
});

describe('dumpCacheLocation', () => {
  test('namespaces by package name and a short hash', () => {
    const location = dumpCacheLocation('/cache', 'demopkg', 'abcdef0123456789');
    expect(location.directory).toBe(path.join('/cache', 'starlight-pydocs', 'demopkg-abcdef012345'));
    expect(location.dumpPath).toBe(path.join(location.directory, 'dump.json'));
  });
});

describe('renderedSidecarPath', () => {
  test('sits beside a dump of ours, keyed on the base as well as the dump', () => {
    const dump = path.join('/cache', 'starlight-pydocs', 'demopkg-abcdef012345', 'dump.json');
    const current = renderedSidecarPath('/cache', 'api/demopkg', dump);
    const pinned = renderedSidecarPath('/cache', '1x/api/demopkg', dump);

    expect(path.dirname(current)).toBe(path.dirname(dump));
    expect(current).not.toBe(pinned);
  });

  test('goes under the cache directory for a dump the user owns', () => {
    const dump = path.join('/project', 'dumps', 'demopkg.json');
    const sidecar = renderedSidecarPath('/cache', '1x/api/demopkg', dump);

    expect(sidecar.startsWith(path.join('/cache', 'starlight-pydocs', 'rendered', '1x-api-demopkg-'))).toBe(true);
    expect(path.basename(sidecar)).toBe('rendered.json');
    // Two entries may pin the same dump file; their prose differs, because
    // cross-reference hrefs point inside their own base.
    expect(renderedSidecarPath('/cache', 'api/demopkg', dump)).not.toBe(sidecar);
  });
});

describe('writeAtomic', () => {
  test('creates parent directories and leaves no temp file behind', async () => {
    const target = path.join(workspace, 'nested', 'deep', 'dump.json');
    await writeAtomic(target, '{"a":1}');
    expect(await fs.readFile(target, 'utf8')).toBe('{"a":1}');
    expect(await fs.readdir(path.dirname(target))).toEqual(['dump.json']);
    expect(await fileExists(target)).toBe(true);
  });
});

describe('fetchToCache', () => {
  const url = 'https://example.dev/objects.inv';

  test('stores the body and the validators, then revalidates with them', async () => {
    const directory = remoteCacheDirectory(workspace, url);
    const seen: Headers[] = [];
    const fetchImpl = async (_input: unknown, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers));
      if (seen.length === 1) {
        return new Response('payload', { headers: { etag: '"v1"', 'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT' } });
      }
      return new Response(null, { status: 304 });
    };

    const first = await fetchToCache({
      url,
      directory,
      filename: 'objects.inv',
      cache: 'revalidate',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first.fromCache).toBe(false);
    expect(await fs.readFile(first.path, 'utf8')).toBe('payload');

    const second = await fetchToCache({
      url,
      directory,
      filename: 'objects.inv',
      cache: 'revalidate',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second.fromCache).toBe(true);
    expect(seen[1]?.get('if-none-match')).toBe('"v1"');
    expect(seen[1]?.get('if-modified-since')).toBe('Wed, 21 Oct 2015 07:28:00 GMT');
  });

  test("cache: 'force' never touches the network", async () => {
    const directory = remoteCacheDirectory(workspace, url);
    await writeAtomic(path.join(directory, 'objects.inv'), 'cached');

    const result = await fetchToCache({
      url,
      directory,
      filename: 'objects.inv',
      cache: 'force',
      fetchImpl: (() => {
        throw new Error('should not fetch');
      }) as unknown as typeof fetch,
    });

    expect(result).toEqual({ path: path.join(directory, 'objects.inv'), fromCache: true });
  });

  test("cache: 'bypass' sends no validators", async () => {
    const directory = remoteCacheDirectory(workspace, url);
    await writeAtomic(path.join(directory, 'objects.inv'), 'cached');
    let headers = new Headers();
    const fetchImpl = async (_input: unknown, init?: RequestInit): Promise<Response> => {
      headers = new Headers(init?.headers);
      return new Response('fresh');
    };

    const result = await fetchToCache({
      url,
      directory,
      filename: 'objects.inv',
      cache: 'bypass',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.fromCache).toBe(false);
    expect(headers.get('if-none-match')).toBeNull();
    expect(await fs.readFile(result.path, 'utf8')).toBe('fresh');
  });

  test('warns and uses the cached copy when the network fails', async () => {
    const directory = remoteCacheDirectory(workspace, url);
    await writeAtomic(path.join(directory, 'objects.inv'), 'cached');
    const logger = createMemoryLogger();

    const result = await fetchToCache({
      url,
      directory,
      filename: 'objects.inv',
      cache: 'revalidate',
      logger,
      fetchImpl: (async () => {
        throw new Error('ENOTFOUND');
      }) as unknown as typeof fetch,
    });

    expect(result.fromCache).toBe(true);
    expect(logger.messages[0]).toMatch(/could not reach https:\/\/example.dev\/objects.inv \(ENOTFOUND\)/);
  });

  test('fails when the network fails and nothing is cached', async () => {
    await expect(
      fetchToCache({
        url,
        directory: remoteCacheDirectory(workspace, url),
        filename: 'objects.inv',
        cache: 'revalidate',
        fetchImpl: (async () => {
          throw new Error('ENOTFOUND');
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/failed to download https:\/\/example.dev\/objects.inv: ENOTFOUND/);
  });

  test('falls back to the cached copy on an HTTP error', async () => {
    const directory = remoteCacheDirectory(workspace, url);
    await writeAtomic(path.join(directory, 'objects.inv'), 'cached');
    const logger = createMemoryLogger();

    const result = await fetchToCache({
      url,
      directory,
      filename: 'objects.inv',
      cache: 'revalidate',
      logger,
      fetchImpl: (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch,
    });

    expect(result.fromCache).toBe(true);
    expect(logger.messages[0]).toMatch(/returned HTTP 503/);
  });

  test('fails on an HTTP error with nothing cached', async () => {
    await expect(
      fetchToCache({
        url,
        directory: remoteCacheDirectory(workspace, url),
        filename: 'objects.inv',
        cache: 'revalidate',
        fetchImpl: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
