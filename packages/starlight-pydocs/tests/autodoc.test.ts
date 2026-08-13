import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { packageForAutodoc } from '../components/context.ts';
import { normalizeConfig } from '../lib/config.ts';
import type { PydocsContext } from '../lib/context.ts';
import { createContext } from '../lib/context.ts';

const root = path.resolve('/project');

function contextWith(packages: { name: string; base?: string; label?: string }[]): PydocsContext {
  const config = normalizeConfig(
    { packages: packages.map((pkg) => ({ ...pkg, source: { file: `./dumps/${pkg.name}.json` } })) },
    root,
  );
  return createContext(config, {
    dumpPaths: new Map(config.packages.map((pkg) => [pkg.base, `${root}/dumps/${pkg.name}.json`])),
    siteBase: undefined,
    trailingSlash: 'always',
    starlight: true,
  });
}

describe('packageForAutodoc', () => {
  test('a dotted path picks the package that owns it, longest name first', () => {
    const context = contextWith([{ name: 'demopkg' }, { name: 'demopkg_extra' }]);
    expect(packageForAutodoc(context, 'demopkg.report.Report', undefined).base).toBe('api/demopkg');
    expect(packageForAutodoc(context, 'demopkg_extra.Thing', undefined).base).toBe('api/demopkg_extra');
  });

  test('the package prop accepts a base or an unambiguous import name', () => {
    const context = contextWith([{ name: 'demopkg' }, { name: 'numpkg' }]);
    expect(packageForAutodoc(context, 'demopkg.Report', 'api/demopkg').base).toBe('api/demopkg');
    expect(packageForAutodoc(context, 'demopkg.Report', 'demopkg').base).toBe('api/demopkg');
  });

  test('a name documented at several bases demands the base, and lists them', () => {
    const context = contextWith([
      { name: 'demopkg' },
      { name: 'demopkg', base: '1x/api/demopkg', label: 'demopkg 1.x' },
    ]);

    expect(() => packageForAutodoc(context, 'demopkg.Report', undefined)).toThrow(
      /<Autodoc name="demopkg.Report"> is ambiguous: 'demopkg' is documented at 2 bases\. /,
    );
    expect(() => packageForAutodoc(context, 'demopkg.Report', undefined)).toThrow(
      /Set the package prop to one of these bases: 'api\/demopkg', '1x\/api\/demopkg'\./,
    );
    expect(() => packageForAutodoc(context, 'demopkg.Report', 'demopkg')).toThrow(/is ambiguous/);

    expect(packageForAutodoc(context, 'demopkg.Report', '1x/api/demopkg').label).toBe('demopkg 1.x');
  });

  test('an unknown name and an unknown base each say what to do', () => {
    const context = contextWith([{ name: 'demopkg' }]);
    expect(() => packageForAutodoc(context, 'nosuch.Thing', undefined)).toThrow(
      /does not start with a configured package name \(configured: demopkg\); pass the package prop/,
    );
    expect(() => packageForAutodoc(context, 'demopkg.Report', 'api/nosuch')).toThrow(
      /package must be a package base \('api\/demopkg'\) or an unambiguous import name/,
    );
  });
});
