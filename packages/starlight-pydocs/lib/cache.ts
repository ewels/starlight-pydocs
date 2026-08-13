/**
 * Content-keyed cache for griffe dumps and downloaded inventories.
 *
 * A cached dump lives at
 * `<cacheDir>/starlight-pydocs/<pkgname>-<hash12>/dump.json`, where the hash
 * covers everything that can change the dump: the griffe argv, the docstring
 * style and options, the extensions, and the size and mtime of every Python
 * file under the search paths. Change any of those and the key changes, so a
 * stale dump is never reused and no explicit invalidation is needed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CacheMode, NormalisedExtension, PydocsPackageConfig } from './config.ts';
import { PydocsError } from './errors.ts';
import type { PydocsLogger } from './logger.ts';
import { silentLogger } from './logger.ts';
import { slugifyBase } from './paths.ts';

/** Namespace inside the host project's cache directory. */
const CACHE_NAMESPACE = 'starlight-pydocs';

/** Directories that never contain source we care about. */
const IGNORED_DIRECTORIES = new Set(['__pycache__', 'node_modules', '.git', '.venv', 'venv', '.tox', '.mypy_cache']);

const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);

export interface PythonFileStat {
  /** Path relative to the search root it was found under, with forward slashes. */
  relativePath: string;
  mtimeMs: number;
  size: number;
}

export interface CacheKeyInput {
  argv: string[];
  docstringStyle: string;
  docstringOptions: Record<string, unknown>;
  extensions: NormalisedExtension[];
  files: PythonFileStat[];
}

export interface DumpCacheLocation {
  /** Directory holding this key's artefacts. */
  directory: string;
  /** Absolute path of the cached dump. */
  dumpPath: string;
  /** The full hash; the directory name uses the first 12 characters. */
  hash: string;
}

/** Stable JSON: object keys sorted so key order cannot perturb the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash of everything that can change a dump's contents. */
export function computeCacheKey(input: CacheKeyInput): string {
  const files = [...input.files].sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  return sha256(
    stableStringify({
      argv: input.argv,
      docstringStyle: input.docstringStyle,
      docstringOptions: input.docstringOptions,
      extensions: input.extensions,
      files,
    }),
  );
}

/** Where the dump for a given package and key lives. */
export function dumpCacheLocation(cacheDir: string, packageName: string, hash: string): DumpCacheLocation {
  const directory = path.join(cacheDir, CACHE_NAMESPACE, `${packageName}-${hash.slice(0, 12)}`);
  return { directory, dumpPath: path.join(directory, 'dump.json'), hash };
}

/**
 * List every `.py`/`.pyi` file under `roots`, skipping `__pycache__`, hidden
 * directories, virtualenvs and `node_modules`. Missing roots are reported rather
 * than silently ignored: a typo in `search` would otherwise look like an empty
 * package.
 */
export async function collectPythonFiles(
  roots: string[],
  logger: PydocsLogger = silentLogger,
): Promise<PythonFileStat[]> {
  const files: PythonFileStat[] = [];

  for (const root of roots) {
    let rootExists = true;
    try {
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) rootExists = false;
    } catch {
      rootExists = false;
    }
    if (!rootExists) {
      logger.warn(`search path does not exist or is not a directory: ${root}`);
      continue;
    }
    await walk(root, root, files);
  }

  return files;
}

async function walk(root: string, directory: string, out: PythonFileStat[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, out);
      continue;
    }
    if (!entry.isFile() || !PYTHON_EXTENSIONS.has(path.extname(entry.name))) continue;
    const stats = await fs.stat(absolute);
    out.push({
      relativePath: path.relative(root, absolute).split(path.sep).join('/'),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
  }
}

/** Cache key for one package's extraction, given the argv it will run. */
export async function computeExtractionKey(
  pkg: PydocsPackageConfig,
  argv: string[],
  logger: PydocsLogger = silentLogger,
): Promise<string> {
  const files = await collectPythonFiles(pkg.search, logger);
  return computeCacheKey({
    argv,
    docstringStyle: pkg.docstringStyle,
    docstringOptions: pkg.docstringOptions,
    extensions: pkg.extensions,
    files,
  });
}

export async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a file without ever leaving a half-written one behind: write to a
 * sibling temp file, then rename (atomic on the same filesystem).
 */
export async function writeAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid.toString(36)}${Date.now().toString(36)}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, target);
}

/**
 * Where the pre-rendered docstring HTML for one documented package lives.
 *
 * Beside the dump when the dump is ours (the directory is content-keyed, so the
 * sidecar cannot outlive the dump it describes), and under the cache directory
 * when the dump is a pre-generated file the user owns and we must not write next
 * to. Either way the file name carries the package's base: the rendered prose
 * contains cross-reference hrefs, which are base-specific, so two entries
 * sharing one dump must not share one sidecar.
 */
export function renderedSidecarPath(cacheDir: string, base: string, dumpPath: string): string {
  const namespaceRoot = path.join(cacheDir, CACHE_NAMESPACE);
  const key = sha256(`${base}\n${path.resolve(dumpPath)}`).slice(0, 12);
  if (path.resolve(dumpPath).startsWith(`${path.resolve(namespaceRoot)}${path.sep}`)) {
    return path.join(path.dirname(dumpPath), `rendered-${key}.json`);
  }
  return path.join(namespaceRoot, 'rendered', `${slugifyBase(base)}-${key}`, 'rendered.json');
}

/** A temporary path griffe can write to inside a cache directory. */
export function temporaryDumpPath(location: DumpCacheLocation): string {
  return path.join(location.directory, `dump.${process.pid.toString(36)}${Date.now().toString(36)}.partial.json`);
}

// -- Remote artefacts ------------------------------------------------------

interface RemoteCacheMeta {
  url: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
}

export interface FetchToCacheOptions {
  url: string;
  /** Directory the artefact and its metadata are stored in. */
  directory: string;
  /** File name inside `directory`. */
  filename: string;
  cache: CacheMode;
  fetchImpl?: typeof fetch | undefined;
  logger?: PydocsLogger | undefined;
}

export interface FetchToCacheResult {
  /** Absolute path of the cached artefact. */
  path: string;
  /** True when the network was not used, or the server answered 304. */
  fromCache: boolean;
}

/**
 * Download `url` into the cache, revalidating with `ETag`/`Last-Modified`.
 *
 * With `cache: 'force'` an existing copy is used without any network access.
 * When the network fails but a cached copy exists, the copy is used and a
 * warning is logged: a docs build should not fail because a CDN blinked.
 */
export async function fetchToCache(options: FetchToCacheOptions): Promise<FetchToCacheResult> {
  const logger = options.logger ?? silentLogger;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const target = path.join(options.directory, options.filename);
  const metaPath = `${target}.meta.json`;
  const meta = await readMeta(metaPath, options.url);
  const cached = await fileExists(target);

  if (options.cache === 'force' && cached) {
    return { path: target, fromCache: true };
  }

  const headers: Record<string, string> = {};
  if (options.cache === 'revalidate' && cached && meta) {
    if (meta.etag !== undefined) headers['if-none-match'] = meta.etag;
    if (meta.lastModified !== undefined) headers['if-modified-since'] = meta.lastModified;
  }

  let response: Response;
  try {
    response = await fetchImpl(options.url, { headers });
  } catch (cause) {
    if (cached) {
      logger.warn(`could not reach ${options.url} (${describeError(cause)}); using the cached copy`);
      return { path: target, fromCache: true };
    }
    throw new PydocsError(`starlight-pydocs: failed to download ${options.url}: ${describeError(cause)}`, {
      cause,
    });
  }

  if (response.status === 304 && cached) {
    return { path: target, fromCache: true };
  }

  if (!response.ok) {
    if (cached) {
      logger.warn(`${options.url} returned HTTP ${response.status}; using the cached copy`);
      return { path: target, fromCache: true };
    }
    throw new PydocsError(`starlight-pydocs: failed to download ${options.url}: HTTP ${response.status}`);
  }

  const body = new Uint8Array(await response.arrayBuffer());
  await writeAtomic(target, body);
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  await writeAtomic(
    metaPath,
    `${JSON.stringify(
      {
        url: options.url,
        ...(etag === null ? {} : { etag }),
        ...(lastModified === null ? {} : { lastModified }),
        fetchedAt: new Date().toISOString(),
      } satisfies RemoteCacheMeta,
      null,
      2,
    )}\n`,
  );
  return { path: target, fromCache: false };
}

async function readMeta(metaPath: string, url: string): Promise<RemoteCacheMeta | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath, 'utf8')) as RemoteCacheMeta;
    return parsed.url === url ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Directory that remote artefacts for a URL are cached in. */
export function remoteCacheDirectory(cacheDir: string, url: string): string {
  return path.join(cacheDir, CACHE_NAMESPACE, 'remote', sha256(url).slice(0, 12));
}
