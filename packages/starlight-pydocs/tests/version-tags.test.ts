/**
 * `versions.tags` against a throwaway git repository: which tags match, their
 * labels and their order. Needs only `git`, no griffe. Skipped without it.
 */

import { onlyPackage } from './helpers.ts';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import { resolveVersionTags } from '../lib/ref-extract.ts';

const run = promisify(execFile);

const available = await run('git', ['--version']).then(
  () => true,
  () => false,
);

describe.skipIf(!available)('version refs from git tags', () => {
  let repository: string;

  beforeAll(async () => {
    repository = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-version-tags-'));
    const git = async (date: string, ...args: string[]): Promise<void> => {
      // The committer date is also the tagger date of an annotated tag.
      await run('git', ['-C', repository, ...args], {
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
    };
    const commit = async (date: string, message: string): Promise<void> => {
      await fs.writeFile(path.join(repository, 'src', 'tinypkg', '__init__.py'), `"""${message}"""\n`);
      await git(date, 'add', '.');
      await git(date, 'commit', '--quiet', '-m', message);
    };

    await git('2020-01-01T00:00:00Z', 'init', '--quiet');
    await git('2020-01-01T00:00:00Z', 'config', 'user.email', 'test@example.com');
    await git('2020-01-01T00:00:00Z', 'config', 'user.name', 'Test');
    await git('2020-01-01T00:00:00Z', 'config', 'commit.gpgsign', 'false');
    await git('2020-01-01T00:00:00Z', 'config', 'tag.gpgsign', 'false');
    await fs.mkdir(path.join(repository, 'src', 'tinypkg'), { recursive: true });

    // Name order (v1.10.0 < v1.9.0 < v2.0.0) differs from date order on purpose.
    // A lightweight tag sorts by its commit's date, so rc1 (made later, but
    // lightweight) still comes before the annotated v1.10.0 on the same commit.
    await commit('2020-01-01T00:00:00Z', 'one');
    await git('2020-01-01T00:00:00Z', 'tag', 'v1.9.0');
    await commit('2021-01-01T00:00:00Z', 'two');
    await git('2021-01-02T00:00:00Z', 'tag', '--annotate', '--message', 'v1.10.0', 'v1.10.0');
    await git('2021-01-03T00:00:00Z', 'tag', 'v1.10.0rc1');
    await commit('2022-01-01T00:00:00Z', 'three');
    await git('2022-01-01T00:00:00Z', 'tag', 'v2.0.0');
  }, 60_000);

  afterAll(async () => {
    await fs.rm(repository, { recursive: true, force: true });
  });

  async function refsFor(tags: string | RegExp) {
    const config = normalizeConfig(
      { packages: [{ name: 'tinypkg', search: ['src'], versions: { tags } }] },
      repository,
    );
    return onlyPackage(await resolveVersionTags(config)).versions.refs;
  }

  test('lists matching tags oldest first, labelled with the tag name', async () => {
    expect(await refsFor('^v[\\d.]+$')).toEqual([
      { ref: 'v1.9.0', label: 'v1.9.0' },
      { ref: 'v1.10.0', label: 'v1.10.0' },
      { ref: 'v2.0.0', label: 'v2.0.0' },
    ]);
  });

  test('takes a RegExp, and a capture group does not change the label', async () => {
    expect(await refsFor(/^v1\.(\d+)/)).toEqual([
      { ref: 'v1.9.0', label: 'v1.9.0' },
      { ref: 'v1.10.0rc1', label: 'v1.10.0rc1' },
      { ref: 'v1.10.0', label: 'v1.10.0' },
    ]);
  });

  test('leaves a package without tags untouched', async () => {
    const config = normalizeConfig(
      { packages: [{ name: 'tinypkg', search: ['src'], versions: { refs: [{ ref: 'v2.0.0', label: '2' }] } }] },
      repository,
    );
    expect(await resolveVersionTags(config)).toEqual(config);
  });

  test('a pattern that matches no tag names itself', async () => {
    await expect(refsFor('^release-')).rejects.toThrow(
      /'tinypkg' has versions\.tags \/\^release-\/, which matches no tag/,
    );
  });
});
