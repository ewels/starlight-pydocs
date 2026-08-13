import { describe, expect, test } from 'vitest';

import type { SearchEntry } from '../lib/search-match.ts';
import { groupMatchesByKind, matchHref, matchSymbols } from '../lib/search-match.ts';

const entries: SearchEntry[] = [
  { path: 'demopkg', kind: 'module', page: 'api/demopkg', anchor: '', brief: 'Demo package.' },
  { path: 'demopkg.report', kind: 'module', page: 'api/demopkg/report', anchor: '', brief: 'Report classes.' },
  {
    path: 'demopkg.Report',
    kind: 'class',
    page: 'api/demopkg',
    anchor: 'demopkg.Report',
    brief: 'A named collection.',
  },
  {
    path: 'demopkg.report.Report',
    kind: 'class',
    page: 'api/demopkg/report',
    anchor: 'demopkg.report.Report',
    brief: 'A named collection.',
  },
  {
    path: 'demopkg.report.Report.generate',
    kind: 'function',
    page: 'api/demopkg/report',
    anchor: 'demopkg.report.Report.generate',
    brief: 'Render the report.',
  },
  {
    path: 'demopkg.report.generate_report',
    kind: 'function',
    page: 'api/demopkg/report',
    anchor: 'demopkg.report.generate_report',
    brief: 'Build a report.',
  },
];

describe('matchSymbols', () => {
  test('is empty for a blank query', () => {
    expect(matchSymbols(entries, '   ')).toEqual([]);
  });

  test('ranks an exact short name first, shortest path winning the tie', () => {
    const paths = matchSymbols(entries, 'report').map((match) => match.entry.path);
    expect(paths[0]).toBe('demopkg.Report');
    expect(paths[1]).toBe('demopkg.report');
  });

  test('is case insensitive', () => {
    expect(matchSymbols(entries, 'REPORT').length).toBe(matchSymbols(entries, 'report').length);
  });

  test('ranks a short-name prefix above a path substring', () => {
    const matches = matchSymbols(entries, 'gener');
    expect(matches[0]?.entry.path).toBe('demopkg.report.Report.generate');
    expect(matches.map((match) => match.entry.path)).toContain('demopkg.report.generate_report');
    const [first, second] = matches;
    expect((first?.score ?? 0) >= (second?.score ?? 0)).toBe(true);
  });

  test('matches dotted paths', () => {
    const matches = matchSymbols(entries, 'report.report');
    expect(matches.map((match) => match.entry.path)).toContain('demopkg.report.Report');
  });

  test('honours the limit', () => {
    expect(matchSymbols(entries, 'e', { limit: 2 })).toHaveLength(2);
  });

  test('drops entries that do not match at all', () => {
    expect(matchSymbols(entries, 'zzz')).toEqual([]);
  });
});

describe('groupMatchesByKind', () => {
  test('buckets by kind in first-seen order', () => {
    const groups = groupMatchesByKind(matchSymbols(entries, 'report'));
    expect(groups.map((group) => group.kind)).toEqual(['class', 'module', 'function']);
    expect(groups[0]?.matches.length).toBe(2);
  });
});

describe('matchHref', () => {
  const [match] = matchSymbols(entries, 'generate_report');

  test('appends the dotted anchor to the page href', () => {
    expect(match).toBeDefined();
    expect(matchHref(match!, { siteBase: '/site', trailingSlash: 'always' })).toBe(
      '/site/api/demopkg/report/#demopkg.report.generate_report',
    );
  });

  test('respects trailingSlash never', () => {
    expect(matchHref(match!, { siteBase: '', trailingSlash: 'never' })).toBe(
      '/api/demopkg/report#demopkg.report.generate_report',
    );
  });

  test('omits the anchor for a module page', () => {
    const module = matchSymbols(entries, 'demopkg.report').find((candidate) => candidate.entry.kind === 'module');
    expect(module?.entry.anchor).toBe('');
    expect(matchHref(module!, { siteBase: '', trailingSlash: 'always' })).toBe('/api/demopkg/report/');
  });
});
