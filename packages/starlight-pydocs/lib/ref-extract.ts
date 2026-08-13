/**
 * Extracting a package as it was at a git ref, for the "added in" badges.
 *
 * The shape of the work: resolve each configured ref to a commit sha, check that
 * commit out into a detached worktree under the cache directory, rebase the
 * package's search paths onto it, and run the same `griffe dump` the current
 * source gets. A commit is immutable, so a dump keyed by sha and extraction
 * options is cached for good and a ref is never dumped twice.
 *
 * Worktrees rather than clones: `git worktree add --detach` shares the object
 * database with the repository, so materialising an old tag costs a checkout, not
 * a copy of the history. Everything runs through argv arrays, never a shell
 * string, exactly as the main runner does.
 *
 * The diff itself is pure and lives in `lib/versions.ts`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { computeCacheKey, fileExists, versionDumpCacheLocation, worktreeDirectory } from './cache.ts';
import type { PydocsConfig, PydocsPackageConfig, PydocsVersionRefInput } from './config.ts';
import { loadDump } from './data.ts';
import { PydocsError, processOutput } from './errors.ts';
import type { PydocsLogger } from './logger.ts';
import { silentLogger } from './logger.ts';
import type { ExecFileImpl, ExtractionContext, GriffeLauncher } from './runner.ts';
import { defaultExecFile, resolveGriffeLauncher, runGriffe } from './runner.ts';
import type { VersionAnnotations, VersionSnapshot } from './versions.ts';
import { collectDumpPaths, firstSeenLabels, toVersionAnnotations } from './versions.ts';

/** One ref, extracted. */
export interface VersionRefDump {
  ref: string;
  label: string;
  /** Full commit sha the ref resolved to. */
  sha: string;
  /** Absolute path of the dump for that commit. */
  dumpPath: string;
  /** True when the dump was already cached, which it always is after the first build. */
  fromCache: boolean;
}

/** Run `git` in a directory and return its trimmed stdout. */
async function git(execFileImpl: ExecFileImpl, cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileImpl('git', args, { cwd });
  return stdout.trim();
}

function gitMessage(cause: unknown): string {
  return processOutput(cause, 'no output').split('\n').at(-1) ?? '';
}

/**
 * The repository the package's sources live in.
 *
 * The first search path decides, because that is where the package is; a
 * monorepo docs site and its Python sources are then in the same repository by
 * construction.
 */
export async function resolveRepositoryRoot(
  pkg: PydocsPackageConfig,
  execFileImpl: ExecFileImpl,
): Promise<{ root: string; searchPath: string }> {
  const searchPath = pkg.search[0];
  if (searchPath === undefined) {
    throw new PydocsError(`starlight-pydocs: '${pkg.name}' has versions configured but no search path to look in`);
  }
  try {
    const root = await git(execFileImpl, searchPath, ['rev-parse', '--show-toplevel']);
    if (root === '') throw new Error('empty toplevel');
    return { root, searchPath };
  } catch (cause) {
    throw new PydocsError(
      `starlight-pydocs: '${pkg.name}' has versions configured, but ${searchPath} is not inside a git repository ` +
        '(version annotations are computed by extracting the package at git refs, so the sources must be a checkout ' +
        'with history)',
      { cause },
    );
  }
}

/** Resolve a ref to a commit sha. */
async function resolveSha(
  repositoryRoot: string,
  ref: string,
  pkg: PydocsPackageConfig,
  execFileImpl: ExecFileImpl,
): Promise<string> {
  try {
    return await git(execFileImpl, repositoryRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch (cause) {
    throw new PydocsError(
      `starlight-pydocs: '${pkg.name}' lists the version ref '${ref}', which ${repositoryRoot} does not have ` +
        '(a shallow clone has no tags: check out with full history, for example fetch-depth: 0 in GitHub Actions)',
      { cause },
    );
  }
}

/**
 * Check a commit out into the cache directory, reusing an existing worktree.
 *
 * Worktrees are keyed by sha and never removed: they are cheap, immutable and
 * shared with the next build. A directory that is already there is used as it
 * is; a stale registration (the directory deleted behind git's back) is pruned
 * and the checkout retried once.
 */
async function materialiseWorktree(
  repositoryRoot: string,
  sha: string,
  cacheDir: string,
  execFileImpl: ExecFileImpl,
  logger: PydocsLogger,
): Promise<string> {
  const directory = worktreeDirectory(cacheDir, sha);
  if (await fileExists(directory)) {
    logger.debug(`reusing the worktree for ${sha.slice(0, 12)}: ${directory}`);
    return directory;
  }

  await fs.mkdir(path.dirname(directory), { recursive: true });
  const add = async (): Promise<void> => {
    await git(execFileImpl, repositoryRoot, ['worktree', 'add', '--detach', directory, sha]);
  };

  try {
    await add();
  } catch (firstCause) {
    try {
      await git(execFileImpl, repositoryRoot, ['worktree', 'prune']);
      await add();
    } catch (cause) {
      if (await fileExists(directory)) {
        logger.debug(`using the worktree that already exists at ${directory}`);
        return directory;
      }
      throw new PydocsError(
        `starlight-pydocs: could not check out ${sha.slice(0, 12)} into ${directory}: ${gitMessage(cause)} ` +
          `(first attempt: ${gitMessage(firstCause)})`,
        { cause },
      );
    }
  }

  logger.debug(`checked out ${sha.slice(0, 12)} into ${directory}`);
  return directory;
}

/** The package's search paths, as paths inside a worktree. */
export function rebaseSearchPaths(pkg: PydocsPackageConfig, repositoryRoot: string, worktree: string): string[] {
  return pkg.search.map((searchPath) => {
    const relative = path.relative(repositoryRoot, searchPath);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new PydocsError(
        `starlight-pydocs: the search path ${searchPath} of '${pkg.name}' is outside the repository ` +
          `${repositoryRoot}, so it cannot be extracted at a git ref; move it inside the repository or drop the ` +
          'versions option',
      );
    }
    return path.join(worktree, relative);
  });
}

/** Cache key for a ref's dump: the commit plus everything that shapes the dump. */
function versionKey(pkg: PydocsPackageConfig, sha: string, relativeSearch: string[]): string {
  return computeCacheKey({
    // Repository-relative search paths keep the key machine independent.
    argv: ['version', sha, pkg.name, pkg.forceInspection ? '-x' : '', ...relativeSearch],
    docstringStyle: pkg.docstringStyle,
    docstringOptions: pkg.docstringOptions,
    extensions: pkg.extensions,
    files: [],
  });
}

/**
 * Extract every configured ref of a package, oldest first.
 *
 * @throws {PydocsError} When the sources are not in a git repository, a ref does
 *   not exist, a search path lies outside the repository, or griffe fails.
 */
async function resolveVersionExtractions(
  pkg: PydocsPackageConfig,
  config: PydocsConfig,
  context: ExtractionContext,
): Promise<VersionRefDump[]> {
  if (pkg.versions.refs.length === 0) return [];

  const execFileImpl = context.execFileImpl ?? defaultExecFile;
  const { root } = await resolveRepositoryRoot(pkg, execFileImpl);
  const launcher = await resolveGriffeLauncher(pkg, config, context);

  const dumps: VersionRefDump[] = [];
  for (const version of pkg.versions.refs) {
    dumps.push(await extractRef(version, { pkg, config, context, execFileImpl, launcher, repositoryRoot: root }));
  }
  return dumps;
}

interface RefExtractionScope {
  pkg: PydocsPackageConfig;
  config: PydocsConfig;
  context: ExtractionContext;
  execFileImpl: ExecFileImpl;
  launcher: GriffeLauncher;
  repositoryRoot: string;
}

async function extractRef(version: PydocsVersionRefInput, scope: RefExtractionScope): Promise<VersionRefDump> {
  const { context, execFileImpl, pkg, repositoryRoot } = scope;
  const logger = context.logger ?? silentLogger;

  const sha = await resolveSha(repositoryRoot, version.ref, pkg, execFileImpl);
  const relativeSearch = pkg.search.map((searchPath) =>
    path.relative(repositoryRoot, searchPath).split(path.sep).join('/'),
  );
  const location = versionDumpCacheLocation(context.cacheDir, pkg.name, sha, versionKey(pkg, sha, relativeSearch));

  // A commit cannot change, so a dump that exists is the dump for that commit:
  // no worktree is needed at all on later builds.
  if (await fileExists(location.dumpPath)) {
    logger.debug(`reusing the dump of '${pkg.name}' at ${version.ref} (${sha.slice(0, 12)})`);
    return { ref: version.ref, label: version.label, sha, dumpPath: location.dumpPath, fromCache: true };
  }

  const worktree = await materialiseWorktree(repositoryRoot, sha, context.cacheDir, execFileImpl, logger);
  const atRef: PydocsPackageConfig = { ...pkg, search: rebaseSearchPaths(pkg, repositoryRoot, worktree) };

  const result = await runGriffe({
    pkg: atRef,
    launcher: scope.launcher,
    location,
    describe: `'${pkg.name}' at ${version.ref} (${sha.slice(0, 12)})`,
    // Griffe runs in the worktree, so its relative paths are that tree's.
    context: { ...context, cwd: worktree },
  });

  return { ref: version.ref, label: version.label, sha, dumpPath: result.dumpPath, fromCache: result.fromCache };
}

/**
 * The "added in" labels for a package, ready to write beside its dump.
 *
 * @returns The sidecar contents and the refs it came from, so the caller can log
 *   what happened.
 */
export async function computeVersionAnnotations(
  pkg: PydocsPackageConfig,
  config: PydocsConfig,
  context: ExtractionContext,
): Promise<{ annotations: VersionAnnotations; refs: VersionRefDump[] }> {
  const refs = await resolveVersionExtractions(pkg, config, context);
  const snapshots: VersionSnapshot[] = [];
  for (const ref of refs) {
    snapshots.push({ label: ref.label, paths: collectDumpPaths(await loadDump(ref.dumpPath)) });
  }
  return { annotations: toVersionAnnotations(firstSeenLabels(snapshots)), refs };
}
