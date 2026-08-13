/**
 * Symbol search matching, shared by the browser element and its unit tests.
 *
 * This module is bundled for the browser, so it stays free of node builtins and
 * its relative imports omit the extension. The index it works on is exactly
 * what the `symbols.json` endpoint serves.
 */

import { objectHref } from './paths';

/** One entry of the `symbols.json` payload. */
export interface SearchEntry {
  /** Dotted object path, also the heading anchor. */
  path: string;
  kind: string;
  /** Page slug the object is documented on. */
  page: string;
  /** Heading anchor, empty for a module's own page. */
  anchor: string;
  brief: string;
}

export interface SearchMatch {
  entry: SearchEntry;
  /** Higher is better; only meaningful for ordering. */
  score: number;
  /** Short name of the matched object, for display. */
  name: string;
}

/** Last segment of a dotted path. */
export function shortSymbolName(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Score one entry against a lowercased query.
 *
 * The ranking is deliberately simple and explainable: an exact short-name hit
 * beats a short-name prefix, which beats a path prefix, which beats any
 * substring. Nothing fuzzy, so typing `report` never surfaces `rport`.
 */
function scoreEntry(entry: SearchEntry, query: string): number {
  const path = entry.path.toLowerCase();
  const name = shortSymbolName(path);

  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (path.startsWith(query)) return 60;
  if (name.includes(query)) return 40;
  if (path.includes(query)) return 20;
  return 0;
}

export interface MatchOptions {
  /** Maximum number of matches returned. Default 25. */
  limit?: number | undefined;
}

/**
 * Match entries against a query, best first.
 *
 * Ties break on the shorter path (so `demopkg.Report` wins over
 * `demopkg.report.Report`), then alphabetically, which keeps the result order
 * stable between requests.
 */
export function matchSymbols(entries: SearchEntry[], query: string, options: MatchOptions = {}): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const matches: SearchMatch[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, needle);
    if (score === 0) continue;
    matches.push({ entry, score, name: shortSymbolName(entry.path) });
  }

  matches.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    if (left.entry.path.length !== right.entry.path.length) return left.entry.path.length - right.entry.path.length;
    return left.entry.path < right.entry.path ? -1 : left.entry.path > right.entry.path ? 1 : 0;
  });

  return matches.slice(0, options.limit ?? 25);
}

export interface SearchGroup {
  kind: string;
  matches: SearchMatch[];
}

/** Bucket matches by kind, keeping the best-scoring kind first. */
export function groupMatchesByKind(matches: SearchMatch[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const match of matches) {
    const existing = groups.find((group) => group.kind === match.entry.kind);
    if (existing === undefined) groups.push({ kind: match.entry.kind, matches: [match] });
    else existing.matches.push(match);
  }
  return groups;
}

export interface SearchLinkOptions {
  /** The site's base path, normalised ('' or '/prefix'). */
  siteBase: string;
  trailingSlash: 'always' | 'never' | 'ignore';
}

/** Href of a match: its page plus the dotted-path anchor. */
export function matchHref(match: SearchMatch, options: SearchLinkOptions): string {
  return objectHref(options.siteBase, match.entry.page, match.entry.anchor, options.trailingSlash);
}
