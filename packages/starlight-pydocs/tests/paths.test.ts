import { describe, expect, test } from 'vitest';

import {
  buildHref,
  isInside,
  matchesDottedGlob,
  moduleSlug,
  objectHref,
  parentPath,
  shortName,
  stripLeadingAndTrailingSlashes,
} from '../lib/paths.ts';

describe('slug helpers', () => {
  test('strips slashes from both ends', () => {
    expect(stripLeadingAndTrailingSlashes('/api/demopkg/')).toBe('api/demopkg');
    expect(stripLeadingAndTrailingSlashes('//a//')).toBe('a');
    expect(stripLeadingAndTrailingSlashes('')).toBe('');
  });

  test('maps module paths onto slugs under the base', () => {
    expect(moduleSlug('api/demopkg', 'demopkg')).toBe('api/demopkg');
    expect(moduleSlug('api/demopkg', 'demopkg.report')).toBe('api/demopkg/report');
    expect(moduleSlug('api/demopkg', 'demopkg.sub.deep')).toBe('api/demopkg/sub/deep');
  });

  test('builds hrefs that honour trailingSlash', () => {
    expect(buildHref('/site', 'api/demopkg', 'always')).toBe('/site/api/demopkg/');
    expect(buildHref('/site', 'api/demopkg', 'never')).toBe('/site/api/demopkg');
    expect(buildHref('', 'api/demopkg', 'ignore')).toBe('/api/demopkg/');
    expect(buildHref('/site/', '/api/demopkg/', 'never')).toBe('/site/api/demopkg');
  });

  test('object hrefs append the dotted anchor', () => {
    expect(objectHref('/site', 'api/demopkg/report', 'demopkg.report.Report', 'always')).toBe(
      '/site/api/demopkg/report/#demopkg.report.Report',
    );
    expect(objectHref('/site', 'api/demopkg/report', '', 'never')).toBe('/site/api/demopkg/report');
    expect(objectHref('', 'api/demopkg', undefined, 'never')).toBe('/api/demopkg');
  });
});

describe('dotted path helpers', () => {
  test('parentPath and shortName split the last segment', () => {
    expect(parentPath('demopkg.report.Report')).toBe('demopkg.report');
    expect(parentPath('demopkg')).toBeUndefined();
    expect(shortName('demopkg.report.Report')).toBe('Report');
    expect(shortName('demopkg')).toBe('demopkg');
  });

  test('isInside covers the path itself and its descendants', () => {
    expect(isInside('demopkg.report', 'demopkg')).toBe(true);
    expect(isInside('demopkg', 'demopkg')).toBe(true);
    expect(isInside('demopkgx.report', 'demopkg')).toBe(false);
  });
});

describe('matchesDottedGlob', () => {
  test('matches literal paths', () => {
    expect(matchesDottedGlob('demopkg.report.Report', 'demopkg.report.Report')).toBe(true);
    expect(matchesDottedGlob('demopkg.report.Report', 'demopkg.report.Reportx')).toBe(false);
  });

  test('a single star stays inside one segment', () => {
    expect(matchesDottedGlob('demopkg.*', 'demopkg.report')).toBe(true);
    expect(matchesDottedGlob('demopkg.*', 'demopkg.report.Report')).toBe(false);
    expect(matchesDottedGlob('demopkg.report.*Error', 'demopkg.report.ReportError')).toBe(true);
  });

  test('a double star crosses segments', () => {
    expect(matchesDottedGlob('demopkg.**', 'demopkg.report.Report.generate')).toBe(true);
    expect(matchesDottedGlob('**.generate', 'demopkg.report.Report.generate')).toBe(true);
  });

  test('a question mark matches one character', () => {
    expect(matchesDottedGlob('demopkg.?eport', 'demopkg.report')).toBe(true);
    expect(matchesDottedGlob('demopkg.?eport', 'demopkg.eport')).toBe(false);
  });

  test('regular expression metacharacters are literal', () => {
    expect(matchesDottedGlob('demopkg.report+', 'demopkg.report+')).toBe(true);
    expect(matchesDottedGlob('demopkg.report+', 'demopkg.reportt')).toBe(false);
    expect(matchesDottedGlob('a.b', 'axb')).toBe(false);
  });
});
