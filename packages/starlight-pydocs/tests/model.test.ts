import fs from 'node:fs/promises';

import { beforeAll, describe, expect, test } from 'vitest';

import { buildModel, documentedPathFor } from '../lib/model.ts';
import type { PackageModel } from '../lib/model.ts';
import type { GriffeDump } from '../lib/types.ts';
import { fixtureModel, memberNames, modelOptions, testFixturePath } from './helpers.ts';

let demopkg: PackageModel;
let syntheticDump: GriffeDump;
let synthetic: PackageModel;

beforeAll(async () => {
  demopkg = await fixtureModel('demopkg');
  syntheticDump = JSON.parse(await fs.readFile(testFixturePath('synthetic.dump.json'), 'utf8')) as GriffeDump;
  synthetic = buildModel(syntheticDump, modelOptions('ovpkg', { base: 'api/ovpkg' }));
});

describe('member filtering', () => {
  test('a module with __all__ documents exactly that surface', () => {
    // `__all__` is ['Report', 'generate_report', 'DEFAULT_TIMEOUT', 'models', 'utils'].
    const nonModules = demopkg.root.members.filter((member) => member.kind !== 'module').map((member) => member.name);
    expect(nonModules).toEqual(['DEFAULT_TIMEOUT', 'Report', 'generate_report']);
    expect(demopkg.root.members.map((member) => member.name)).not.toContain('__all__');
  });

  test('submodules stay navigable even when __all__ omits them', () => {
    const modules = demopkg.root.members.filter((member) => member.kind === 'module').map((member) => member.name);
    expect(modules).toEqual(['compat', 'models', 'report', 'utils']);
  });

  test('private modules are dropped', () => {
    expect(demopkg.root.members.map((member) => member.name)).not.toContain('_internal');
    expect(demopkg.objectsByPath.has('demopkg._internal')).toBe(false);
  });

  test('a module without __all__ falls back to is_public', () => {
    // compat defines LEGACY_LIMIT, legacy_name, _shim and imports Report.
    expect(memberNames(demopkg, 'demopkg.compat')).toEqual(['LEGACY_LIMIT', 'legacy_name']);
  });

  test('private members are dropped from modules and classes', () => {
    expect(memberNames(demopkg, 'demopkg.utils')).toEqual(['describe', 'iter_sections', 'merge_scores']);
    expect(memberNames(demopkg, 'demopkg.models.User')).toEqual(['email', 'name', 'reports']);
  });

  test('special members are dropped unless asked for', async () => {
    expect(memberNames(demopkg, 'demopkg.report.Report')).not.toContain('__init__');
    const withSpecial = await fixtureModel('demopkg', { filters: { special: true } });
    expect(memberNames(withSpecial, 'demopkg.report.Report')).toContain('__init__');
  });

  test('imported members appear only when imported members are enabled', async () => {
    expect(memberNames(demopkg, 'demopkg.compat')).not.toContain('Report');
    const withImports = await fixtureModel('demopkg', { filters: { imported: true } });
    expect(memberNames(withImports, 'demopkg.compat')).toContain('Report');
  });

  test('private members appear when the private filter is enabled', async () => {
    const withPrivate = await fixtureModel('demopkg', { filters: { private: true } });
    expect(memberNames(withPrivate, 'demopkg.utils')).toContain('_private_helper');
    expect(withPrivate.pages.map((page) => page.title)).toContain('demopkg._internal');
  });

  test('include globs restrict the surface but keep the way in', async () => {
    const model = await fixtureModel('demopkg', {
      members: { include: ['demopkg.report.Report.generate', 'demopkg.report.Report'] },
    });
    expect(memberNames(model, 'demopkg.report')).toEqual(['Report']);
    expect(memberNames(model, 'demopkg.report.Report')).toEqual(['generate']);
  });

  test('a single-segment star does not cross dots', async () => {
    const model = await fixtureModel('demopkg', { members: { include: ['demopkg.utils.*'] } });
    expect(memberNames(model, 'demopkg.utils')).toEqual(['describe', 'iter_sections', 'merge_scores']);
    // Only the path towards the included members survives.
    expect(model.pages.map((page) => page.slug)).toEqual(['api/demopkg', 'api/demopkg/utils']);
    expect(model.objectsByPath.has('demopkg.report')).toBe(false);
  });

  test('a double star crosses dots', async () => {
    const model = await fixtureModel('demopkg', { members: { include: ['demopkg.report.**'] } });
    expect(memberNames(model, 'demopkg.report.Report')).toContain('generate');
  });

  test('exclude globs win over includes', async () => {
    const model = await fixtureModel('demopkg', {
      members: { include: ['demopkg.report.**'], exclude: ['demopkg.report.Report.render'] },
    });
    const members = memberNames(model, 'demopkg.report.Report');
    expect(members).toContain('generate');
    expect(members).not.toContain('render');
  });

  test('excluding a class drops its members too', async () => {
    const model = await fixtureModel('demopkg', { members: { exclude: ['demopkg.report.Report'] } });
    expect(memberNames(model, 'demopkg.report')).not.toContain('Report');
    expect(model.objectsByPath.has('demopkg.report.Report.generate')).toBe(false);
  });
});

describe('alias resolution', () => {
  test('re-exports resolve to the target and record where it lives', () => {
    const report = demopkg.objectsByPath.get('demopkg.Report');
    expect(report?.kind).toBe('class');
    expect(report?.canonicalPath).toBe('demopkg.report.Report');
    expect(report?.reexportedFrom).toBe('demopkg.report');
    expect(report?.members.map((member) => member.name)).toContain('generate');
  });

  test('re-exported functions keep their own documented path', () => {
    const generate = demopkg.objectsByPath.get('demopkg.generate_report');
    expect(generate?.kind).toBe('function');
    expect(generate?.path).toBe('demopkg.generate_report');
    expect(generate?.canonicalPath).toBe('demopkg.report.generate_report');
  });

  test('the definition is documented at its own path as well', () => {
    expect(demopkg.objectsByPath.get('demopkg.report.Report')?.reexportedFrom).toBeUndefined();
    expect(documentedPathFor(demopkg, 'demopkg.report.Report')).toBe('demopkg.report.Report');
  });

  test('unresolvable aliases keep the external target for display', () => {
    const model = buildModel(syntheticDump, modelOptions('ovpkg', { base: 'api/ovpkg', filters: { imported: true } }));
    const outside = model.objectsByPath.get('ovpkg.outside');
    expect(outside?.kind).toBe('alias');
    expect(outside?.externalTargetPath).toBe('third_party.helper');
    expect(outside?.reexportedFrom).toBeUndefined();
  });
});

describe('inheritance', () => {
  test('resolves bases inside the package', () => {
    const report = demopkg.objectsByPath.get('demopkg.report.Report');
    expect(report?.bases?.map((base) => base.path)).toEqual(['demopkg.report.BaseReport']);
    expect(report?.unresolvedBases).toEqual([]);
    expect(report?.mro).toEqual(['demopkg.report.Report', 'demopkg.report.BaseReport']);
  });

  test('records external bases as unresolved', () => {
    const error = demopkg.objectsByPath.get('demopkg.report.ReportError');
    expect(error?.bases?.map((base) => base.text)).toEqual(['Exception']);
    expect(error?.bases?.[0]?.path).toBeUndefined();
    expect(error?.unresolvedBases).toEqual(['Exception']);
    expect(error?.mro).toEqual(['demopkg.report.ReportError']);
  });

  test('merges inherited members with provenance, after the class own members', () => {
    const members = demopkg.objectsByPath.get('demopkg.report.Report')?.members ?? [];
    const inherited = members.filter((member) => member.inheritedFrom !== undefined);
    expect(inherited.map((member) => member.name)).toEqual(['format', 'is_valid', 'save', 'validate']);
    expect(new Set(inherited.map((member) => member.inheritedFrom))).toEqual(new Set(['demopkg.report.BaseReport']));
    // Own members keep their own provenance and come first.
    expect(members.findIndex((member) => member.name === 'generate')).toBeLessThan(
      members.findIndex((member) => member.name === 'save'),
    );
  });

  test('inherited members are documented under the subclass', () => {
    const save = demopkg.objectsByPath.get('demopkg.report.Report.save');
    expect(save?.canonicalPath).toBe('demopkg.report.BaseReport.save');
    expect(save?.pageSlug).toBe('api/demopkg/report');
  });

  test('inherited members can be turned off', async () => {
    const model = await fixtureModel('demopkg', { filters: { inherited: false } });
    expect(memberNames(model, 'demopkg.report.Report')).not.toContain('save');
    // Bases are still reported, only the merge is skipped.
    expect(model.objectsByPath.get('demopkg.report.Report')?.bases?.[0]?.path).toBe('demopkg.report.BaseReport');
  });

  test('C3 linearises a diamond', () => {
    expect(synthetic.objectsByPath.get('ovpkg.A')?.mro).toEqual(['ovpkg.A', 'ovpkg.B', 'ovpkg.C', 'ovpkg.D']);
  });

  test('the nearest override in the MRO wins', () => {
    const members = synthetic.objectsByPath.get('ovpkg.A')?.members ?? [];
    expect(members.map((member) => member.name)).toEqual(['own', 'from_b', 'from_c', 'from_d']);
    expect(members.find((member) => member.name === 'from_d')?.inheritedFrom).toBe('ovpkg.C');
    expect(members.find((member) => member.name === 'from_d')?.canonicalPath).toBe('ovpkg.C.from_d');
  });

  test('an unresolvable dotted base stops the walk', () => {
    const external = synthetic.objectsByPath.get('ovpkg.External');
    expect(external?.unresolvedBases).toEqual(['other.Base']);
    expect(external?.mro).toEqual(['ovpkg.External']);
  });
});

describe('overloads', () => {
  test('are collected when the dump carries them', () => {
    const render = synthetic.objectsByPath.get('ovpkg.render');
    expect(render?.overloads).toHaveLength(2);
    expect(render?.overloads?.[1]?.parameters?.[0]?.name).toBe('value');
  });

  test('are undefined when the dump has none (griffe 2.1.0 omits them)', () => {
    expect(demopkg.objectsByPath.get('demopkg.report.Report.render')?.overloads).toBeUndefined();
  });
});

describe('page plan', () => {
  test('one page per module, slugs under the base with dots as slashes', () => {
    expect(demopkg.pages.map((page) => page.slug)).toEqual([
      'api/demopkg',
      'api/demopkg/compat',
      'api/demopkg/models',
      'api/demopkg/report',
      'api/demopkg/utils',
    ]);
    expect(demopkg.pages.map((page) => page.title)).toEqual([
      'demopkg',
      'demopkg.compat',
      'demopkg.models',
      'demopkg.report',
      'demopkg.utils',
    ]);
  });

  test('the package root page owns the base itself', () => {
    const root = demopkg.pagesBySlug.get('api/demopkg');
    expect(root?.parent).toBeUndefined();
    expect(root?.children).toEqual(['demopkg.compat', 'demopkg.models', 'demopkg.report', 'demopkg.utils']);
  });

  test('child pages know their parent', () => {
    expect(demopkg.pagesBySlug.get('api/demopkg/report')?.parent).toBe('demopkg');
  });

  test('a custom base changes every slug', async () => {
    const model = await fixtureModel('demopkg', { base: 'reference' });
    expect(model.pages.map((page) => page.slug)).toContain('reference/report');
    expect(model.objectsByPath.get('demopkg.report.Report')?.pageSlug).toBe('reference/report');
  });
});

describe('headings', () => {
  test('anchors are dotted paths, H2 for members and H3 for class members', () => {
    const page = demopkg.pagesBySlug.get('api/demopkg/report');
    expect(page?.headings.slice(0, 6)).toEqual([
      { depth: 2, slug: 'demopkg.report.BaseReport', text: 'BaseReport' },
      { depth: 3, slug: 'demopkg.report.BaseReport.format', text: 'format' },
      { depth: 3, slug: 'demopkg.report.BaseReport.is_valid', text: 'is_valid' },
      { depth: 3, slug: 'demopkg.report.BaseReport.save', text: 'save' },
      { depth: 3, slug: 'demopkg.report.BaseReport.validate', text: 'validate' },
      { depth: 2, slug: 'demopkg.report.Report', text: 'Report' },
    ]);
  });

  test('follow the render order of the member groups', () => {
    const page = demopkg.pagesBySlug.get('api/demopkg/report');
    const reportHeadings = (page?.headings ?? [])
      .filter((heading) => heading.slug.startsWith('demopkg.report.Report.'))
      .map((heading) => heading.text);
    expect(reportHeadings).toEqual([
      // attributes, then properties, then methods (own before inherited).
      'name',
      'scores',
      'format',
      'title',
      'is_valid',
      'from_mapping',
      'generate',
      'render',
      'supported_formats',
      'save',
      'validate',
    ]);
  });

  test('submodules are not headings on the parent page', () => {
    const root = demopkg.pagesBySlug.get('api/demopkg');
    expect(root?.headings.map((heading) => heading.slug)).not.toContain('demopkg.report');
    expect(root?.headings.map((heading) => heading.slug)).toEqual([
      'demopkg.DEFAULT_TIMEOUT',
      'demopkg.Report',
      'demopkg.Report.name',
      'demopkg.Report.scores',
      'demopkg.Report.format',
      'demopkg.Report.title',
      'demopkg.Report.is_valid',
      'demopkg.Report.from_mapping',
      'demopkg.Report.generate',
      'demopkg.Report.render',
      'demopkg.Report.supported_formats',
      'demopkg.Report.save',
      'demopkg.Report.validate',
      'demopkg.generate_report',
    ]);
  });
});

describe('member groups', () => {
  test('modules group attributes, classes, functions and modules in that order', () => {
    expect(demopkg.root.groups.map((group) => group.id)).toEqual(['attributes', 'classes', 'functions', 'modules']);
  });

  test('classes group attributes, properties and methods', () => {
    const report = demopkg.objectsByPath.get('demopkg.report.Report');
    expect(report?.groups.map((group) => group.id)).toEqual(['attributes', 'properties', 'methods']);
    expect(report?.groups.find((group) => group.id === 'properties')?.members.map((member) => member.name)).toEqual([
      'title',
      'is_valid',
    ]);
  });

  test('griffe labels survive on the model', () => {
    expect(demopkg.objectsByPath.get('demopkg.report.Report.supported_formats')?.labels).toContain('staticmethod');
    expect(demopkg.objectsByPath.get('demopkg.report.Report.from_mapping')?.labels).toContain('classmethod');
    expect(demopkg.objectsByPath.get('demopkg.models.User')?.labels).toContain('pydantic-model');
    expect(demopkg.objectsByPath.get('demopkg.models.User.name')?.labels).toContain('pydantic-field');
  });

  test('parentKind distinguishes methods from functions', () => {
    expect(demopkg.objectsByPath.get('demopkg.report.Report.generate')?.parentKind).toBe('class');
    expect(demopkg.objectsByPath.get('demopkg.report.generate_report')?.parentKind).toBe('module');
    expect(demopkg.root.parentKind).toBeUndefined();
  });
});

describe('symbol index', () => {
  test('has an entry per documented object with a plain-text brief', () => {
    const entry = demopkg.symbolsByPath.get('demopkg.report.Report.generate');
    expect(entry).toEqual({
      path: 'demopkg.report.Report.generate',
      kind: 'function',
      pageSlug: 'api/demopkg/report',
      anchor: 'demopkg.report.Report.generate',
      brief: 'Render the report and return the path it was written to.',
    });
  });

  test('module entries point at their page with no anchor', () => {
    expect(demopkg.symbolsByPath.get('demopkg.utils')).toEqual({
      path: 'demopkg.utils',
      kind: 'module',
      pageSlug: 'api/demopkg/utils',
      anchor: '',
      brief: 'Helpers that operate on reports.',
    });
  });

  test('strips markdown from the brief', () => {
    // The attribute docstring links with a mkdocstrings-style cross-reference.
    expect(demopkg.symbolsByPath.get('demopkg.report.BaseReport.is_valid')?.brief).toBe('Whether validate passes.');
  });

  test('covers re-exports at both paths', () => {
    expect(demopkg.symbolsByPath.has('demopkg.Report')).toBe(true);
    expect(demopkg.symbolsByPath.has('demopkg.report.Report')).toBe(true);
    expect(demopkg.symbols.length).toBe(demopkg.symbolsByPath.size);
  });

  test('undocumented objects get an empty brief', () => {
    expect(demopkg.symbolsByPath.get('demopkg.report.Report.name')?.brief).toBe('The report name.');
    expect(synthetic.symbolsByPath.get('ovpkg.A.own')?.brief).toBe('');
  });
});

describe('source links', () => {
  test('expands the configured template with the relative path and line range', async () => {
    const model = await fixtureModel('demopkg', {
      sourceLink: { template: 'https://github.com/o/r/blob/{ref}/{path}#L{start}-L{end}', ref: 'v1' },
    });
    const source = model.objectsByPath.get('demopkg.report.Report.generate')?.source;
    expect(source?.file).toBe('fixtures/demopkg/src/demopkg/report.py');
    expect(source?.startLine).toBeGreaterThan(0);
    expect(source?.href).toBe(
      `https://github.com/o/r/blob/v1/fixtures/demopkg/src/demopkg/report.py#L${source?.startLine}-L${source?.endLine}`,
    );
  });

  test('computes the path against sourceLink.root when griffe reported an absolute one', async () => {
    // What griffe emits when the search path lies outside its working directory:
    // `relative_filepath` is the absolute path, which must never reach a URL.
    const dump = {
      pkg: {
        kind: 'module',
        name: 'pkg',
        path: 'pkg',
        filepath: '/repo/py/src/pkg/__init__.py',
        relative_filepath: '/repo/py/src/pkg/__init__.py',
        lineno: 1,
        endlineno: 2,
      },
    } as unknown as Parameters<typeof buildModel>[0];

    const withRoot = buildModel(dump, {
      ...modelOptions('pkg'),
      sourceLink: { template: 'https://example.dev/blob/{ref}/{path}#L{start}', ref: 'main', root: '/repo' },
    });
    expect(withRoot.root.source?.file).toBe('py/src/pkg/__init__.py');
    expect(withRoot.root.source?.href).toBe('https://example.dev/blob/main/py/src/pkg/__init__.py#L1');

    const withoutRoot = buildModel(dump, {
      ...modelOptions('pkg'),
      sourceLink: { template: 'https://example.dev/blob/{ref}/{path}#L{start}', ref: 'main', root: undefined },
    });
    expect(withoutRoot.root.source?.file).toBe('/repo/py/src/pkg/__init__.py');
  });

  test('falls back to griffe source_link when no template is configured', () => {
    expect(synthetic.objectsByPath.get('ovpkg.render')?.source?.href).toBe(
      'https://example.dev/o/r/blob/abc123/src/ovpkg/__init__.py#L10-L14',
    );
  });

  test('leaves the href undefined when neither is available', () => {
    expect(demopkg.objectsByPath.get('demopkg.report.Report.generate')?.source?.href).toBeUndefined();
  });
});

describe('deprecations', () => {
  test('reads the google Deprecated block, which griffe emits as an admonition', () => {
    const old = demopkg.objectsByPath.get('demopkg.report.old_generate');
    expect(old?.deprecated).toEqual({
      version: undefined,
      description: 'Since 0.3. Use [`generate_report`][demopkg.report.generate_report].',
    });
  });

  test('leaves other objects undeprecated', () => {
    expect(demopkg.objectsByPath.get('demopkg.report.generate_report')?.deprecated).toBeUndefined();
  });
});

describe('errors and warnings', () => {
  test('a missing package names what the dump does contain', async () => {
    await expect(fixtureModel('nopkg')).rejects.toThrow();
    const dump = { demopkg: { kind: 'module', name: 'demopkg', path: 'demopkg' } } as unknown as GriffeDump;
    expect(() => buildModel(dump, modelOptions('other'))).toThrow(
      /the dump does not contain 'other'; it contains 'demopkg'/,
    );
  });

  test('a non-module root is rejected', () => {
    const dump = { thing: { kind: 'class', name: 'thing', path: 'thing' } } as unknown as GriffeDump;
    expect(() => buildModel(dump, modelOptions('thing'))).toThrow(/'thing' is a class, expected a module/);
  });

  test('warns about __all__ entries that do not exist', () => {
    const dump = {
      pkg: {
        kind: 'module',
        name: 'pkg',
        path: 'pkg',
        exports: ['Missing'],
        members: {},
      },
    } as unknown as GriffeDump;
    const model = buildModel(dump, modelOptions('pkg'));
    expect(model.warnings).toEqual(["pkg: 'Missing' is listed in __all__ but is not a member of the module"]);
  });

  test('the real fixtures produce no warnings', () => {
    expect(demopkg.warnings).toEqual([]);
  });
});

describe('other docstring styles', () => {
  test('numpy dumps carry parsed sections', async () => {
    const model = await fixtureModel('numpkg');
    const resample = model.objectsByPath.get('numpkg.resample');
    expect((resample?.docstring?.sections ?? []).map((section) => section.kind)).toEqual([
      'text',
      'parameters',
      'returns',
      'raises',
      'examples',
    ]);
  });

  test('sphinx dumps carry parsed sections', async () => {
    const model = await fixtureModel('sphpkg');
    const submit = model.objectsByPath.get('sphpkg.submit');
    expect((submit?.docstring?.sections ?? []).map((section) => section.kind)).toEqual([
      'text',
      'parameters',
      'returns',
      'raises',
    ]);
  });
});
