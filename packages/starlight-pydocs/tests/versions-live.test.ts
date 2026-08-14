/**
 * Live version-annotation test: builds a throwaway git repository with two
 * tagged commits of a tiny package, runs the whole pipeline (git worktrees, one
 * `griffe dump` per ref, the diff, the model) and checks the badge lands on the
 * function the second commit added. Skipped without `git` or `uv`.
 *
 * The repository is created in a temp directory and deleted afterwards; nothing
 * touches this project's own git state.
 */

import { onlyPackage } from './helpers.ts';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import { clearCaches, loadDump } from '../lib/data.ts';
import { buildModel } from '../lib/model.ts';
import { computeVersionAnnotations, rebaseSearchPaths, resolveRepositoryRoot } from '../lib/ref-extract.ts';
import { resolveExtraction } from '../lib/runner.ts';
import { versionLabelsFrom } from '../lib/versions.ts';

const run = promisify(execFile);

async function canRun(file: string, args: string[]): Promise<boolean> {
  try {
    await run(file, args);
    return true;
  } catch {
    return false;
  }
}

const available = (await canRun('git', ['--version'])) && (await canRun('uv', ['--version']));

const V1 = `"""A tiny package."""


def generate() -> str:
    """Generate something."""
    return 'ok'
`;

const V2 = `"""A tiny package."""


def generate() -> str:
    """Generate something."""
    return 'ok'


def publish() -> str:
    """Publish something, new in 1.1."""
    return 'published'
`;

describe.skipIf(!available)('version annotations from a git repository', () => {
  let repository: string;
  let cacheDir: string;

  beforeAll(async () => {
    repository = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-versions-repo-'));
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-versions-cache-'));

    const git = async (...args: string[]): Promise<void> => {
      await run('git', ['-C', repository, ...args]);
    };
    const module = path.join(repository, 'src', 'tinypkg', '__init__.py');

    await git('init', '--quiet');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    // Signing is inherited from the user's global config otherwise, and a signed
    // tag is an annotated tag, which fails without a message.
    await git('config', 'commit.gpgsign', 'false');
    await git('config', 'tag.gpgsign', 'false');
    await fs.mkdir(path.dirname(module), { recursive: true });

    await fs.writeFile(module, V1);
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'v1');
    await git('tag', 'v1.0.0');

    await fs.writeFile(module, V2);
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'v2');
    await git('tag', 'v1.1.0');
  }, 60_000);

  afterAll(async () => {
    clearCaches();
    await fs.rm(repository, { recursive: true, force: true });
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  function configFor() {
    const config = normalizeConfig(
      {
        packages: [
          {
            name: 'tinypkg',
            search: ['src'],
            versions: {
              refs: [
                { ref: 'v1.0.0', label: '1.0' },
                { ref: 'v1.1.0', label: '1.1' },
              ],
            },
          },
        ],
        cacheDir,
      },
      repository,
    );
    const pkg = onlyPackage(config);
    return { config, pkg };
  }

  test('labels the object the second release added, and nothing older', async () => {
    const { config, pkg } = configFor();
    const context = { cacheDir, cwd: repository };

    const { annotations, refs } = await computeVersionAnnotations(pkg, config, context);
    expect(refs.map((ref) => ref.label)).toEqual(['1.0', '1.1']);
    expect(refs.every((ref) => /^[0-9a-f]{40}$/.test(ref.sha))).toBe(true);
    expect(annotations.addedIn).toEqual({ 'tinypkg.publish': '1.1' });

    // The current source is the newest version, so the model is built from it.
    const extraction = await resolveExtraction(pkg, config, context);
    const model = buildModel(await loadDump(extraction.dumpPath), {
      packageName: pkg.name,
      base: pkg.base,
      members: pkg.members,
      filters: pkg.filters,
      sourceLink: pkg.sourceLink,
      addedIn: versionLabelsFrom(annotations),
    });

    expect(model.objectsByPath.get('tinypkg.publish')?.addedIn).toBe('1.1');
    expect(model.objectsByPath.get('tinypkg.generate')?.addedIn).toBeUndefined();
    expect(model.root.addedIn).toBeUndefined();
  }, 120_000);

  test('a second run reuses the worktrees and the ref dumps', async () => {
    const { config, pkg } = configFor();
    const { refs } = await computeVersionAnnotations(pkg, config, { cacheDir, cwd: repository });
    expect(refs.map((ref) => ref.fromCache)).toEqual([true, true]);
  }, 60_000);

  test('search paths are rebased onto the worktree', async () => {
    const { pkg } = configFor();
    const { root } = await resolveRepositoryRoot(pkg, async (file, args, options) => {
      const { stdout, stderr } = await run(file, args, { cwd: options.cwd });
      return { stdout: String(stdout), stderr: String(stderr) };
    });
    expect(rebaseSearchPaths(pkg, root, '/wt')).toEqual([path.join('/wt', 'src')]);
  });

  test('an unknown ref names itself', async () => {
    const config = normalizeConfig(
      {
        packages: [{ name: 'tinypkg', search: ['src'], versions: { refs: [{ ref: 'v9.9.9', label: '9.9' }] } }],
        cacheDir,
      },
      repository,
    );
    const pkg = onlyPackage(config);

    await expect(computeVersionAnnotations(pkg, config, { cacheDir, cwd: repository })).rejects.toThrow(
      /lists the version ref 'v9\.9\.9', which .* does not have/,
    );
  }, 60_000);

  test('sources outside a git repository say so', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-versions-plain-'));
    try {
      await fs.mkdir(path.join(outside, 'src', 'tinypkg'), { recursive: true });
      await fs.writeFile(path.join(outside, 'src', 'tinypkg', '__init__.py'), V1);

      const config = normalizeConfig(
        {
          packages: [{ name: 'tinypkg', search: ['src'], versions: { refs: [{ ref: 'v1.0.0', label: '1.0' }] } }],
          cacheDir,
        },
        outside,
      );
      const pkg = onlyPackage(config);

      await expect(computeVersionAnnotations(pkg, config, { cacheDir, cwd: outside })).rejects.toThrow(
        /is not inside a git repository/,
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  }, 60_000);
});
