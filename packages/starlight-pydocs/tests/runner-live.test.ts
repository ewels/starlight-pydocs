/**
 * Live extraction test: actually runs `uvx --from griffe griffe dump` against the
 * numpkg fixture and compares the surface with the checked-in dump, so griffe
 * version drift shows up as a test failure rather than as a surprise in a docs
 * build. Skipped where `uv` is not installed.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import { resolveExtraction } from '../lib/runner.ts';
import type { GriffeDump, GriffeModule, GriffeObject } from '../lib/types.ts';
import { hasMembers } from '../lib/types.ts';
import { loadFixtureDump, onlyPackage, repoRoot } from './helpers.ts';

const run = promisify(execFile);

async function hasUv(): Promise<boolean> {
  try {
    await run('uv', ['--version']);
    return true;
  } catch {
    return false;
  }
}

const uvAvailable = await hasUv();

function moduleIn(dump: GriffeDump, pkgName: string): GriffeModule {
  const root = dump[pkgName];
  if (root === undefined || root.kind !== 'module') throw new Error(`no module ${pkgName} in dump`);
  return root;
}

/** Member names of a module or class, sorted so declaration order cannot matter. */
function memberNamesOf(object: GriffeObject | undefined): string[] {
  if (object === undefined || !hasMembers(object)) throw new Error('expected a dump object with members');
  return Object.keys(object.members ?? {}).sort();
}

describe.skipIf(!uvAvailable)('live extraction with uv', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-live-'));
  });

  afterAll(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  test('extracts numpkg and matches the checked-in surface', async () => {
    const config = normalizeConfig(
      {
        packages: [{ name: 'numpkg', search: ['fixtures/numpkg/src'], docstringStyle: 'numpy' }],
        cacheDir: workspace,
      },
      repoRoot,
    );

    const result = await resolveExtraction(onlyPackage(config), config, { cacheDir: workspace, cwd: repoRoot });
    expect(result.strategy).toBe('uvx');
    expect(result.fromCache).toBe(false);

    const fresh = moduleIn(JSON.parse(await fs.readFile(result.dumpPath, 'utf8')) as GriffeDump, 'numpkg');
    const checkedIn = moduleIn(await loadFixtureDump('numpkg'), 'numpkg');

    expect(memberNamesOf(fresh)).toEqual(memberNamesOf(checkedIn));
    expect(memberNamesOf(fresh.members?.['Grid'])).toEqual(memberNamesOf(checkedIn.members?.['Grid']));

    // The docstring parser still produces the sections the renderers rely on.
    const resample = fresh.members?.['resample'];
    expect((resample?.docstring?.parsed ?? []).map((section) => section.kind)).toEqual([
      'text',
      'parameters',
      'returns',
      'raises',
      'examples',
    ]);
  }, 60_000);

  test('the second run reuses the cache', async () => {
    const config = normalizeConfig(
      {
        packages: [{ name: 'numpkg', search: ['fixtures/numpkg/src'], docstringStyle: 'numpy' }],
        cacheDir: workspace,
      },
      repoRoot,
    );

    const result = await resolveExtraction(onlyPackage(config), config, { cacheDir: workspace, cwd: repoRoot });
    expect(result.fromCache).toBe(true);
  }, 60_000);
});
