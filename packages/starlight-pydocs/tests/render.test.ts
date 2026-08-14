import { describe, expect, test } from 'vitest';

import type { PydocsContext } from '../lib/context.ts';
import { EMPTY_RENDERED_DOCSTRINGS } from '../lib/docstrings.ts';
import {
  admonitionKind,
  admonitionTitle,
  externalSiteName,
  hrefForPath,
  hrefForTarget,
  objectBadges,
  summaryForPath,
  packageAssetHref,
  pageHref,
  splitInherited,
  type RenderScope,
} from '../lib/render.ts';
import { constructorOf, renderedParameterCount, renderedSignatureTokens } from '../lib/signature.ts';
import { fixtureModel } from './helpers.ts';

const context: PydocsContext = {
  packages: [
    {
      name: 'demopkg',
      base: 'api/demopkg',
      label: 'demopkg',
      dumpPath: '',
      renderedPath: '',
      versionsPath: '',
      docstringStyle: 'google',
      members: { include: [], exclude: [] },
      filters: { special: false, private: false, imported: false, inherited: true },
      sourceLink: undefined,
      sidebar: { label: 'demopkg', collapsed: false, group: undefined },
      versionReleases: {},
    },
  ],
  siteBase: '/site',
  trailingSlash: 'always',
  starlight: true,
  symbolSearch: true,
  llmsTxt: true,
  publishInventory: true,
  inventories: [],
  cacheDir: '/tmp',
  shikiThemes: { light: 'github-light', dark: 'github-dark' },
};

async function scope(): Promise<RenderScope> {
  const model = await fixtureModel('demopkg');
  const pkg = context.packages[0];
  if (pkg === undefined) throw new Error('missing fixture package');
  return { context, pkg, model, resolver: { resolve: () => undefined }, rendered: EMPTY_RENDERED_DOCSTRINGS };
}

describe('hrefs', () => {
  test('link a documented object to its page and anchor', async () => {
    const rendered = await scope();
    expect(hrefForPath(rendered, 'demopkg.report.Report.generate')).toBe(
      '/site/api/demopkg/report/#demopkg.report.Report.generate',
    );
  });

  test('a module links to its page with no anchor', async () => {
    const rendered = await scope();
    expect(hrefForPath(rendered, 'demopkg.report')).toBe('/site/api/demopkg/report/');
  });

  test('prefer the shortest documented path for a re-export', async () => {
    const rendered = await scope();
    // `Report` is documented at both `demopkg.Report` and `demopkg.report.Report`.
    expect(hrefForPath(rendered, 'demopkg.report.Report')).toContain('#demopkg.');
  });

  test('undocumented paths have no href', async () => {
    const rendered = await scope();
    expect(hrefForPath(rendered, 'demopkg.nope')).toBeUndefined();
    expect(hrefForTarget(rendered, undefined)).toBeUndefined();
  });

  test('external targets pass their URL through', async () => {
    const rendered = await scope();
    expect(hrefForTarget(rendered, { kind: 'external', href: 'https://docs.python.org/3/x.html' })).toBe(
      'https://docs.python.org/3/x.html',
    );
  });

  test('page and asset hrefs respect the site base', async () => {
    const rendered = await scope();
    expect(pageHref(rendered, 'api/demopkg')).toBe('/site/api/demopkg/');
    expect(packageAssetHref(rendered, 'symbols.json')).toBe('/site/api/demopkg/symbols.json');
  });
});

describe('objectBadges', () => {
  test('name the kind and the griffe labels', async () => {
    const model = await fixtureModel('demopkg');
    const method = model.objectsByPath.get('demopkg.report.Report.from_mapping');
    expect(method).toBeDefined();
    const badges = objectBadges(method!);
    expect(badges[0]).toEqual({ variant: 'kind', key: 'kindMethod', text: undefined });
    expect(badges.some((badge) => badge.key === 'labelClassmethod')).toBe(true);
  });

  test('do not repeat the kind for a property', async () => {
    const model = await fixtureModel('demopkg');
    const property = model.objectsByPath.get('demopkg.report.Report.title');
    expect(property).toBeDefined();
    const badges = objectBadges(property!);
    expect(badges.filter((badge) => badge.key === 'kindProperty')).toHaveLength(1);
  });

  test('add a deprecation badge', async () => {
    const model = await fixtureModel('demopkg');
    const deprecated = model.objectsByPath.get('demopkg.report.old_generate');
    expect(deprecated?.deprecated).toBeDefined();
    expect(objectBadges(deprecated!).some((badge) => badge.variant === 'deprecated')).toBe(true);
  });

  test('leave the version an object appeared in to the provenance row', async () => {
    const model = await fixtureModel('demopkg', { addedIn: new Map([['demopkg.report.Report', '1.1']]) });
    const report = model.objectsByPath.get('demopkg.report.Report');
    expect(report?.addedIn).toBe('1.1');

    const badges = objectBadges(report!);
    expect(badges[0]?.variant).toBe('kind');
    expect(badges.every((badge) => badge.key !== 'addedIn')).toBe(true);
  });
});

describe('splitInherited', () => {
  test('separates own members from each base class', async () => {
    const model = await fixtureModel('demopkg');
    const report = model.objectsByPath.get('demopkg.report.Report');
    expect(report).toBeDefined();
    const { own, inherited } = splitInherited(report!.members);
    expect(own.map((member) => member.name)).toContain('generate');
    expect(inherited.map((bucket) => bucket.from)).toEqual(['demopkg.report.BaseReport']);
    expect(inherited[0]?.members.map((member) => member.name)).toContain('save');
  });

  test('is all-own for a class with no resolvable bases', async () => {
    const model = await fixtureModel('demopkg');
    const base = model.objectsByPath.get('demopkg.report.BaseReport');
    const { own, inherited } = splitInherited(base?.members ?? []);
    expect(inherited).toEqual([]);
    expect(own.length).toBeGreaterThan(0);
  });
});

describe('admonitions', () => {
  test('map griffe annotations onto the four aside flavours', () => {
    expect(admonitionKind('note')).toBe('note');
    expect(admonitionKind('Warning')).toBe('caution');
    expect(admonitionKind('danger')).toBe('danger');
    expect(admonitionKind('tip')).toBe('tip');
    expect(admonitionKind('hint')).toBe('tip');
    expect(admonitionKind('something-new')).toBe('note');
    expect(admonitionKind(undefined)).toBe('note');
  });

  test('title falls back to the capitalised annotation', () => {
    expect(admonitionTitle('See also', 'seealso')).toBe('See also');
    expect(admonitionTitle(null, 'note')).toBe('Note');
    expect(admonitionTitle('', undefined)).toBe('');
  });
});

describe('class signatures merge __init__', () => {
  test('constructor parameters are shown on the class', async () => {
    const model = await fixtureModel('demopkg');
    const report = model.objectsByPath.get('demopkg.report.Report');
    expect(report).toBeDefined();
    expect(constructorOf(report!)).toBeDefined();
    const text = renderedSignatureTokens(report!)
      .map((token) => token.text)
      .join('');
    expect(text).toBe('class Report(name: str, scores: dict[str, float] | None = None)');
    expect(renderedParameterCount(report!)).toBe(2);
  });

  test('a class without __init__ keeps its base list', async () => {
    const model = await fixtureModel('demopkg');
    const base = model.objectsByPath.get('demopkg.report.BaseReport');
    expect(constructorOf(base!)).toBeUndefined();
    expect(
      renderedSignatureTokens(base!)
        .map((token) => token.text)
        .join(''),
    ).toBe('class BaseReport');
  });

  test('functions are unaffected', async () => {
    const model = await fixtureModel('demopkg');
    const fn = model.objectsByPath.get('demopkg.report.generate_report');
    expect(
      renderedSignatureTokens(fn!)
        .map((token) => token.text)
        .join(''),
    ).toBe("def generate_report(source, /, name: str, *, fmt: str = 'md') -> Report");
    expect(renderedParameterCount(fn!)).toBe(3);
  });
});

describe('link titles', () => {
  test('names the host an external link lands on', () => {
    expect(externalSiteName('https://docs.python.org/3/library/stdtypes.html#str')).toBe('docs.python.org');
    expect(externalSiteName('https://www.example.dev/a')).toBe('example.dev');
    expect(externalSiteName('not a url')).toBeUndefined();
  });

  test('summarises a documented object from its first docstring line', async () => {
    const rendered = await scope();
    expect(summaryForPath(rendered, 'demopkg.report.Report')).toBe(
      rendered.model.symbolsByPath.get('demopkg.report.Report')?.brief,
    );
  });

  test('has no summary for a path nothing documents', async () => {
    const rendered = await scope();
    expect(summaryForPath(rendered, 'demopkg.nope.Missing')).toBeUndefined();
  });

  test('truncates a summary that runs long, on a word boundary', async () => {
    const rendered = await scope();
    const long = 'word '.repeat(60).trim();
    rendered.model.symbolsByPath.set('demopkg.long', {
      path: 'demopkg.long',
      kind: 'class',
      pageSlug: 'x',
      anchor: '',
      brief: long,
    });
    rendered.model.objectsByPath.set('demopkg.long', rendered.model.objectsByPath.get('demopkg.report.Report')!);

    const summary = summaryForPath(rendered, 'demopkg.long');
    expect(summary?.endsWith('…')).toBe(true);
    expect(summary?.length).toBeLessThanOrEqual(141);
    expect(summary?.replace('…', '').endsWith('word')).toBe(true);
  });
});
