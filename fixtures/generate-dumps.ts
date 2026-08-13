/**
 * Regenerate the checked-in griffe dumps for the Python fixture packages.
 *
 * Run with `pnpm gen:dumps` from the repository root; needs `uv` on PATH (or
 * griffe importable from `python3`). The dumps are committed so the unit tests
 * never need Python.
 *
 * Two things are stripped from griffe's output to keep the files stable across
 * machines and commits: absolute `filepath` values become repository-relative,
 * and `git_info`/`source_link` (which embed the current commit hash) are
 * removed. Nothing in `lib/` reads either of those fields.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { PydocsUserConfig } from '../packages/starlight-pydocs/lib/config.ts';
import { normalizeConfig } from '../packages/starlight-pydocs/lib/config.ts';
import type { PydocsLogger } from '../packages/starlight-pydocs/lib/logger.ts';
import { resolveExtraction } from '../packages/starlight-pydocs/lib/runner.ts';
import { repoRoot, runScript } from './shared.ts';

interface Fixture {
  name: string;
  options: PydocsUserConfig['packages'][number];
}

const fixtures: Fixture[] = [
  {
    name: 'demopkg',
    options: {
      name: 'demopkg',
      search: ['fixtures/demopkg/src'],
      docstringStyle: 'google',
      extensions: ['griffe_pydantic'],
      extraRequirements: ['griffe-pydantic'],
    },
  },
  {
    name: 'numpkg',
    options: { name: 'numpkg', search: ['fixtures/numpkg/src'], docstringStyle: 'numpy' },
  },
  {
    name: 'sphpkg',
    options: { name: 'sphpkg', search: ['fixtures/sphpkg/src'], docstringStyle: 'sphinx' },
  },
];

const logger: PydocsLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
  debug: (message) => console.log(`  ${message}`),
};

/** Absolute paths and git metadata make dumps machine and commit specific. */
function makePortable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(makePortable);
  if (typeof value !== 'object' || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'git_info' || key === 'source_link') continue;
    if (key === 'filepath' && typeof entry === 'string') {
      out[key] = path.relative(repoRoot, entry).split(path.sep).join('/');
      continue;
    }
    out[key] = makePortable(entry);
  }
  return out;
}

async function main(): Promise<void> {
  const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'starlight-pydocs-fixtures');

  for (const fixture of fixtures) {
    const config = normalizeConfig({ packages: [fixture.options] }, repoRoot);
    const pkg = config.packages[0];
    if (pkg === undefined) throw new Error(`fixture ${fixture.name} produced no package config`);

    logger.info(`extracting ${fixture.name} (${pkg.docstringStyle})`);
    const result = await resolveExtraction(pkg, config, { cacheDir, cwd: repoRoot, logger });

    const dump: unknown = JSON.parse(await fs.readFile(result.dumpPath, 'utf8'));
    const target = path.join(repoRoot, 'fixtures', fixture.name, 'dump.json');
    await fs.writeFile(target, `${JSON.stringify(makePortable(dump), null, 2)}\n`);
    logger.info(`  wrote ${path.relative(repoRoot, target)} (${result.strategy}${result.fromCache ? ', cached' : ''})`);
  }
}

await runScript(main);
