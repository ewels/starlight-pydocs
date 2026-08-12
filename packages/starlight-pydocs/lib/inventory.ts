/**
 * Sphinx `objects.inv` support, in both directions.
 *
 * Format (version 2): four plain-text header lines, then a zlib stream of one
 * line per object:
 *
 * ```
 * # Sphinx inventory version 2
 * # Project: demopkg
 * # Version: 1.0
 * # The remainder of this file is compressed using zlib.
 * <name> <domain>:<role> <priority> <uri> <dispname>
 * ```
 *
 * `$` at the end of a URI stands for the object name, and a `dispname` of `-`
 * means "same as the name"; both are size optimisations that we expand on read
 * and reapply on write.
 */

import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

import type { CacheMode, NormalisedInventory } from './config.ts';
import { fetchToCache, remoteCacheDirectory } from './cache.ts';
import { PydocsError } from './errors.ts';
import type { PydocsLogger } from './logger.ts';
import { silentLogger } from './logger.ts';

export interface InventoryEntry {
  /** Dotted object path, e.g. `pathlib.Path`. */
  name: string;
  /** Sphinx domain, `py` for Python objects. */
  domain: string;
  /** Role within the domain: `class`, `function`, `method`, `attribute`, `module`. */
  role: string;
  priority: number;
  /** URI relative to the documentation base, anchor included. */
  uri: string;
  /** Display name; equal to `name` unless the inventory overrode it. */
  dispname: string;
}

const HEADER_LINE = '# Sphinx inventory version 2';

/** One object line. `dispname` may contain spaces, so it is matched last. */
const ENTRY_PATTERN = /^(.+?)\s+(\S+):(\S*)\s+(-?\d+)\s+(\S*)\s+(.*)$/;

/**
 * Parse an `objects.inv`.
 *
 * Malformed lines are skipped rather than fatal: inventories in the wild contain
 * odd entries, and one bad line should not cost every link.
 */
export function parseInventory(buffer: Uint8Array): InventoryEntry[] {
  const text = new TextDecoder().decode(buffer);
  const headerEnd = findHeaderEnd(text);
  const header = text.slice(0, headerEnd).split('\n');

  if (header[0]?.trim() !== HEADER_LINE) {
    throw new PydocsError(`starlight-pydocs: not a Sphinx v2 inventory (first line was '${header[0]?.trim() ?? ''}')`);
  }

  const compressed = buffer.subarray(headerEnd);
  let body: string;
  try {
    body = inflateSync(compressed).toString('utf8');
  } catch (cause) {
    throw new PydocsError('starlight-pydocs: could not decompress the inventory payload', { cause });
  }

  const entries: InventoryEntry[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.trim() === '') continue;
    const match = ENTRY_PATTERN.exec(trimmed);
    if (match === null) continue;

    const [, name, domain, role, priority, uri, dispname] = match;
    if (name === undefined || domain === undefined || uri === undefined) continue;

    entries.push({
      name,
      domain,
      role: role ?? '',
      priority: Number.parseInt(priority ?? '1', 10),
      uri: uri.endsWith('$') ? `${uri.slice(0, -1)}${name}` : uri,
      dispname: dispname === undefined || dispname === '-' || dispname === '' ? name : dispname,
    });
  }

  return entries;
}

/** Byte offset just past the four header lines. */
function findHeaderEnd(text: string): number {
  let offset = 0;
  for (let line = 0; line < 4; line += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) throw new PydocsError('starlight-pydocs: inventory is truncated (fewer than four header lines)');
    offset = next + 1;
  }
  return offset;
}

/** Serialise entries into an `objects.inv` payload. */
export function buildInventory(project: string, version: string, entries: InventoryEntry[]): Uint8Array {
  const header = [
    HEADER_LINE,
    `# Project: ${project}`,
    `# Version: ${version}`,
    '# The remainder of this file is compressed using zlib.',
    '',
  ].join('\n');

  const lines = entries.map((entry) => {
    const uri =
      entry.uri === entry.name
        ? '$'
        : entry.uri.endsWith(entry.name)
          ? `${entry.uri.slice(0, -entry.name.length)}$`
          : entry.uri;
    const dispname = entry.dispname === entry.name ? '-' : entry.dispname;
    return `${entry.name} ${entry.domain}:${entry.role} ${entry.priority} ${uri} ${dispname}`;
  });

  const body = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  const compressed = deflateSync(Buffer.from(body, 'utf8'));
  return Buffer.concat([Buffer.from(header, 'utf8'), compressed]);
}

export interface InventoryLookupEntry {
  href: string;
  role: string;
  dispname: string;
}

export interface InventoryLookup {
  /** Resolve a dotted path to an absolute URL, or undefined. */
  lookup(dottedPath: string): InventoryLookupEntry | undefined;
  /** Total number of entries loaded, for logging. */
  size: number;
}

/** Build a lookup from parsed inventories. Earlier inventories win. */
export function createInventoryLookup(inventories: { base: string; entries: InventoryEntry[] }[]): InventoryLookup {
  const table = new Map<string, InventoryLookupEntry>();

  for (const inventory of inventories) {
    for (const entry of inventory.entries) {
      // Python objects only: other domains (std, c, js) have no meaning in a
      // Python annotation.
      if (entry.domain !== 'py') continue;
      if (table.has(entry.name)) continue;
      table.set(entry.name, {
        href: joinUrl(inventory.base, entry.uri),
        role: entry.role,
        dispname: entry.dispname,
      });
    }
  }

  return {
    lookup: (dottedPath) => table.get(dottedPath),
    size: table.size,
  };
}

function joinUrl(base: string, uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  return `${base.endsWith('/') ? base : `${base}/`}${uri.replace(/^\//, '')}`;
}

export interface LoadInventoriesOptions {
  cacheDir: string;
  fetchImpl?: typeof fetch | undefined;
  logger?: PydocsLogger | undefined;
  /** Reader seam so tests can avoid the filesystem. */
  readFile?: ((filePath: string) => Promise<Uint8Array>) | undefined;
}

export interface LoadedInventory {
  base: string;
  entries: InventoryEntry[];
  /** Absolute path of the cached or local file the entries came from. */
  path: string | undefined;
  cache: CacheMode;
}

/**
 * Fetch or read every configured inventory and parse it.
 *
 * A failing inventory is a warning, not a build failure: cross-links to another
 * site are a nicety, and one unreachable host should not stop a docs build.
 */
export async function loadInventories(
  configs: NormalisedInventory[],
  options: LoadInventoriesOptions,
): Promise<LoadedInventory[]> {
  const logger = options.logger ?? silentLogger;
  const readFile = options.readFile ?? defaultReadFile;
  const loaded: LoadedInventory[] = [];

  for (const config of configs) {
    try {
      let filePath: string;
      if (config.url !== undefined) {
        const result = await fetchToCache({
          url: config.url,
          directory: remoteCacheDirectory(options.cacheDir, config.url),
          filename: 'objects.inv',
          cache: config.cache,
          fetchImpl: options.fetchImpl,
          logger,
        });
        filePath = result.path;
      } else if (config.file !== undefined) {
        filePath = config.file;
      } else {
        continue;
      }

      const entries = parseInventory(await readFile(filePath));
      loaded.push({ base: config.base, entries, path: filePath, cache: config.cache });
      logger.debug(`loaded ${entries.length} inventory entries from ${config.url ?? config.file ?? filePath}`);
    } catch (cause) {
      logger.warn(
        `could not load the inventory ${config.url ?? config.file ?? '(unknown)'}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  return loaded;
}

async function defaultReadFile(filePath: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path.resolve(filePath));
}

/** Sphinx role for one of our object kinds, matching mkdocstrings' choices. */
export function inventoryRoleFor(kind: string, isMethod: boolean): string {
  switch (kind) {
    case 'module':
      return 'module';
    case 'class':
      return 'class';
    case 'function':
      return isMethod ? 'method' : 'function';
    default:
      return 'attribute';
  }
}
