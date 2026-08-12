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
import type { GriffeDump, GriffeModule } from '../lib/types.ts';
import { loadFixtureDump, repoRoot } from './helpers.ts';

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

function memberNamesOf(dump: GriffeDump, pkgName: string): string[] {
  const root = dump[pkgName];
  if (root === undefined || root.kind !== 'module') throw new Error(`no module ${pkgName} in dump`);
  return Object.keys((root as GriffeModule).members ?? {}).sort();
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
    const pkg = config.packages[0];
    if (pkg === undefined) throw new Error('no package');

    const result = await resolveExtraction(pkg, config, { cacheDir: workspace, cwd: repoRoot });
    expect(result.strategy).toBe('uvx');
    expect(result.fromCache).toBe(false);

    const fresh = JSON.parse(await fs.readFile(result.dumpPath, 'utf8')) as GriffeDump;
    const checkedIn = await loadFixtureDump('numpkg');

    expect(memberNamesOf(fresh, 'numpkg')).toEqual(memberNamesOf(checkedIn, 'numpkg'));

    const freshGrid = (fresh['numpkg'] as GriffeModule).members?.['Grid'];
    const storedGrid = (checkedIn['numpkg'] as GriffeModule).members?.['Grid'];
    expect(Object.keys((freshGrid as GriffeModule).members ?? {}).sort()).toEqual(
      Object.keys((storedGrid as GriffeModule).members ?? {}).sort(),
    );

    // The docstring parser still produces the sections the renderers rely on.
    const resample = (fresh['numpkg'] as GriffeModule).members?.['resample'];
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
    const pkg = config.packages[0];
    if (pkg === undefined) throw new Error('no package');

    const result = await resolveExtraction(pkg, config, { cacheDir: workspace, cwd: repoRoot });
    expect(result.fromCache).toBe(true);
  }, 60_000);
});
