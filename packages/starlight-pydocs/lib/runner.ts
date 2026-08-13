/**
 * Extraction: turn a configured package into a griffe dump on disk.
 *
 * Strategies are tried in a fixed order (explicit command, pre-generated file,
 * pre-generated URL, `uvx --from griffe`, `python -m griffe`) so a project can
 * always opt out of needing Python at build time. Commands are built as argv
 * arrays and run with `execFile`: no shell, so no quoting rules and no
 * Windows-specific escaping.
 */

import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { PydocsConfig, PydocsPackageConfig } from './config.ts';
import type { DumpCacheLocation } from './cache.ts';
import {
  computeExtractionKey,
  dumpCacheLocation,
  fetchToCache,
  fileExists,
  remoteCacheDirectory,
  temporaryDumpPath,
} from './cache.ts';
import { PydocsError, processOutput } from './errors.ts';
import type { PydocsLogger } from './logger.ts';
import { silentLogger } from './logger.ts';

const execFile = promisify(execFileCallback);

/** Injectable process runner, so unit tests never spawn anything. */
export type ExecFileImpl = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface ExtractionContext {
  /** Where cached dumps are written. Usually `config.cacheDir`. */
  cacheDir: string;
  /** Working directory for the extraction process. Usually `config.projectRoot`. */
  cwd: string;
  logger?: PydocsLogger | undefined;
  execFileImpl?: ExecFileImpl | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export type ExtractionStrategy = 'command' | 'file' | 'url' | 'uvx' | 'python';

/** A resolved way to run griffe: the executable and how to pass it arguments. */
export interface GriffeLauncher {
  strategy: 'command' | 'uvx' | 'python';
  argv: (griffeArgs: string[]) => { file: string; args: string[] };
}

export interface ExtractionResult {
  /** Absolute path of the dump JSON. */
  dumpPath: string;
  strategy: ExtractionStrategy;
  /** True when nothing was extracted or downloaded because a cached copy was current. */
  fromCache: boolean;
}

/**
 * Build the `griffe` sub-command arguments for a package.
 *
 * `-f` (full) and `-d <style>` (docstring parser) are both mandatory for our
 * purposes: without `-f` there are no file paths or visibility flags, without
 * `-d` docstrings stay unparsed text.
 *
 * @param pkg - Normalised package configuration.
 * @param outFile - Where griffe should write the dump. Omitted in tests, in
 *   which case griffe would write to stdout.
 */
export function buildGriffeArgs(pkg: PydocsPackageConfig, outFile?: string): string[] {
  const args = ['dump', '-f', '-d', pkg.docstringStyle];

  if (Object.keys(pkg.docstringOptions).length > 0) {
    args.push('-D', JSON.stringify(pkg.docstringOptions));
  }

  for (const extension of pkg.extensions) {
    args.push(
      '-e',
      extension.options === undefined ? extension.name : JSON.stringify({ [extension.name]: extension.options }),
    );
  }

  for (const searchPath of pkg.search) {
    args.push('-s', searchPath);
  }

  if (pkg.forceInspection) args.push('-x');
  if (outFile !== undefined) args.push('-o', outFile);

  args.push(pkg.name);
  return args;
}

/** `uvx --from griffe --with <extra>… griffe <args>` */
function uvxArgv(pkg: PydocsPackageConfig, griffeArgs: string[]): { file: string; args: string[] } {
  const args = ['--from', 'griffe'];
  for (const requirement of pkg.extraRequirements) args.push('--with', requirement);
  args.push('griffe', ...griffeArgs);
  return { file: 'uvx', args };
}

async function canRun(
  execFileImpl: ExecFileImpl,
  cwd: string,
  file: string,
  args: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await execFileImpl(file, args, { cwd });
    return { ok: true };
  } catch (cause) {
    if ((cause as { code?: string | number }).code === 'ENOENT') return { ok: false, reason: 'not found on PATH' };
    const detail = processOutput(cause).split('\n').at(-1);
    return { ok: false, reason: detail === undefined || detail === '' ? 'failed to run' : detail };
  }
}

/**
 * Pick an extraction strategy, run it if needed, and return the dump path.
 *
 * Nothing is re-extracted when the cache key still matches, so repeated builds
 * and dev-server restarts are effectively free.
 */
export async function resolveExtraction(
  pkg: PydocsPackageConfig,
  config: PydocsConfig,
  context: ExtractionContext,
): Promise<ExtractionResult> {
  const logger = context.logger ?? silentLogger;

  // A dump generated elsewhere, so the docs host needs no Python at all. An
  // explicit `runner.command` still wins over it: the user knows their
  // environment best, which is why the launcher is resolved first.
  if (config.runner.command === undefined && pkg.source !== undefined) {
    if (pkg.source.kind === 'file') {
      if (!(await fileExists(pkg.source.path))) {
        throw new PydocsError(
          `starlight-pydocs: the dump configured for '${pkg.name}' does not exist: ${pkg.source.path}`,
        );
      }
      return { dumpPath: pkg.source.path, strategy: 'file', fromCache: true };
    }

    const result = await fetchToCache({
      url: pkg.source.url,
      directory: remoteCacheDirectory(context.cacheDir, pkg.source.url),
      filename: 'dump.json',
      cache: pkg.source.cache,
      fetchImpl: context.fetchImpl,
      logger,
    });
    return { dumpPath: result.path, strategy: 'url', fromCache: result.fromCache };
  }

  const launcher = await resolveGriffeLauncher(pkg, config, context);
  const keyed = launcher.argv(buildGriffeArgs(pkg));
  const hash = await computeExtractionKey(pkg, [keyed.file, ...keyed.args], logger);

  const result = await runGriffe({
    pkg,
    launcher,
    location: dumpCacheLocation(context.cacheDir, pkg.name, hash),
    describe: `'${pkg.name}'`,
    context,
  });
  return { ...result, strategy: launcher.strategy };
}

/**
 * Resolve how griffe will be run: an explicit command, `uvx`, or an interpreter
 * that has griffe importable.
 *
 * @throws {PydocsError} Listing every probe and the three ways to fix it.
 */
export async function resolveGriffeLauncher(
  pkg: PydocsPackageConfig,
  config: PydocsConfig,
  context: ExtractionContext,
): Promise<GriffeLauncher> {
  const execFileImpl = context.execFileImpl ?? defaultExecFile;
  const probes: string[] = [];

  if (config.runner.command !== undefined) {
    const [file, ...rest] = config.runner.command;
    if (file === undefined) throw new PydocsError('runner.command: must contain at least the executable');
    return { strategy: 'command', argv: (griffeArgs) => ({ file, args: [...rest, ...griffeArgs] }) };
  }

  const uv = await canRun(execFileImpl, context.cwd, 'uv', ['--version']);
  if (uv.ok) {
    return { strategy: 'uvx', argv: (griffeArgs) => uvxArgv(pkg, griffeArgs) };
  }
  probes.push(`uv --version (${uv.reason})`);

  const interpreters = config.runner.python === undefined ? ['python3', 'python'] : [config.runner.python];
  for (const interpreter of interpreters) {
    const probe = await canRun(execFileImpl, context.cwd, interpreter, ['-c', 'import griffe']);
    if (probe.ok) {
      return {
        strategy: 'python',
        argv: (griffeArgs) => ({ file: interpreter, args: ['-m', 'griffe', ...griffeArgs] }),
      };
    }
    probes.push(`${interpreter} -c "import griffe" (${probe.reason})`);
  }

  throw new PydocsError(
    [
      `starlight-pydocs: could not extract the API of '${pkg.name}'. Tried:`,
      ...probes.map((probe) => `  - ${probe}`),
      'Fix this in one of three ways:',
      '  1. install uv (https://docs.astral.sh/uv/) so griffe can run without being installed',
      `  2. install griffe${pkg.extraRequirements.length > 0 ? ` and ${pkg.extraRequirements.join(', ')}` : ''} into the interpreter that runs the build (pip install griffe)`,
      `  3. generate the dump elsewhere and point packages[…].source.file or .url at it`,
    ].join('\n'),
  );
}

export interface RunGriffeOptions {
  /** Package to extract. `search` decides which directories griffe reads. */
  pkg: PydocsPackageConfig;
  launcher: GriffeLauncher;
  /** Where the dump goes; an existing dump there is reused as is. */
  location: DumpCacheLocation;
  /** What is being extracted, for log lines and error messages. */
  describe: string;
  context: ExtractionContext;
}

/** Run griffe into a cache location, unless the dump is already there. */
export async function runGriffe(options: RunGriffeOptions): Promise<{ dumpPath: string; fromCache: boolean }> {
  const { context, launcher, location, pkg } = options;
  const logger = context.logger ?? silentLogger;
  const execFileImpl = context.execFileImpl ?? defaultExecFile;

  if (await fileExists(location.dumpPath)) {
    logger.debug(`reusing cached dump for ${options.describe}: ${location.dumpPath}`);
    return { dumpPath: location.dumpPath, fromCache: true };
  }

  await fs.mkdir(location.directory, { recursive: true });
  const temporary = temporaryDumpPath(location);
  const command = launcher.argv(buildGriffeArgs(pkg, temporary));

  logger.debug(`extracting ${options.describe}: ${[command.file, ...command.args].join(' ')}`);
  try {
    const { stderr } = await execFileImpl(command.file, command.args, { cwd: context.cwd });
    // Griffe logs progress and unresolved-name warnings to stderr; surface them
    // without failing the build.
    for (const line of stderr.split('\n')) {
      if (line.trim().startsWith('WARNING')) logger.warn(`griffe: ${line.trim()}`);
    }
  } catch (cause) {
    await fs.rm(temporary, { force: true });
    throw new PydocsError(
      [
        `starlight-pydocs: griffe failed while extracting ${options.describe}.`,
        `  command: ${[command.file, ...command.args].join(' ')}`,
        `  ${processOutput(cause, 'no output')}`,
      ].join('\n'),
      { cause },
    );
  }

  if (!(await fileExists(temporary))) {
    throw new PydocsError(
      `starlight-pydocs: griffe reported success but wrote no dump for ${options.describe} (expected ${temporary})`,
    );
  }
  await fs.rename(temporary, location.dumpPath);
  return { dumpPath: location.dumpPath, fromCache: false };
}

/** The real process runner, exported so sibling modules share one default. */
export const defaultExecFile: ExecFileImpl = async (file, args, options) => {
  const { stdout, stderr } = await execFile(file, args, {
    cwd: options.cwd,
    // Dumps of large packages are megabytes; only stderr flows through here
    // when `-o` is used, but keep the ceiling generous.
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/** Resolve dumps for every configured package, in order, keyed by base. */
export async function resolveAllExtractions(
  config: PydocsConfig,
  context: ExtractionContext,
): Promise<Map<string, ExtractionResult>> {
  const results = new Map<string, ExtractionResult>();
  for (const pkg of config.packages) {
    results.set(pkg.base, await resolveExtraction(pkg, config, context));
  }
  return results;
}

/** Absolute paths worth watching in dev: the search roots of every package. */
export function watchPaths(config: PydocsConfig): string[] {
  const paths = new Set<string>();
  for (const pkg of config.packages) {
    if (pkg.source !== undefined) continue;
    for (const searchPath of pkg.search) paths.add(path.normalize(searchPath));
  }
  return [...paths];
}
