import { describe, expect, test } from 'vitest';

import { createCrossReferenceResolver, resolveCrossReferences, resolveSphinxRoles } from '../lib/crossrefs.ts';
import { fixtureModel } from './helpers.ts';

/** Resolves the two paths the tests use, and nothing else. */
const resolve = (target: string): string | undefined =>
  target === 'demopkg.report.Report'
    ? '/api/demopkg/report/#demopkg.report.Report'
    : target === 'pathlib.Path'
      ? 'https://docs.python.org/3/library/pathlib.html#pathlib.Path'
      : undefined;

describe('resolveCrossReferences', () => {
  test('rewrites a titled reference as a Markdown link', () => {
    expect(resolveCrossReferences('See [the report][demopkg.report.Report] for more.', resolve)).toBe(
      'See [the report](/api/demopkg/report/#demopkg.report.Report) for more.',
    );
  });

  test('rewrites the shorthand, keeping the target as the text', () => {
    expect(resolveCrossReferences('See [demopkg.report.Report][].', resolve)).toBe(
      'See [demopkg.report.Report](/api/demopkg/report/#demopkg.report.Report).',
    );
  });

  test('keeps a code-span title intact', () => {
    expect(resolveCrossReferences('Whether [`Report`][demopkg.report.Report] applies.', resolve)).toBe(
      'Whether [`Report`](/api/demopkg/report/#demopkg.report.Report) applies.',
    );
  });

  test('resolves several references in one string, external ones included', () => {
    const rewritten = resolveCrossReferences(
      'A [Report][demopkg.report.Report] writes to a [pathlib.Path][].',
      resolve,
    );
    expect(rewritten).toBe(
      'A [Report](/api/demopkg/report/#demopkg.report.Report) writes to a ' +
        '[pathlib.Path](https://docs.python.org/3/library/pathlib.html#pathlib.Path).',
    );
  });

  test('leaves an unresolved target exactly as written', () => {
    const source = 'See [Thing][nosuchpkg.Thing] and [nosuchpkg.Other][].';
    expect(resolveCrossReferences(source, resolve)).toBe(source);
  });

  test('returns the input unchanged when it holds no reference at all', () => {
    const source = 'Plain prose with [a link](https://example.com) in it.';
    expect(resolveCrossReferences(source, resolve)).toBe(source);
  });

  test('leaves references inside a fenced code block', () => {
    const source = [
      'Before [Report][demopkg.report.Report].',
      '',
      '```md',
      '[Report][demopkg.report.Report]',
      '```',
    ].join('\n');
    const rewritten = resolveCrossReferences(source, resolve);
    expect(rewritten).toContain('Before [Report](/api/demopkg/report/#demopkg.report.Report).');
    expect(rewritten).toContain('```md\n[Report][demopkg.report.Report]\n```');
  });

  test('leaves references inside a tilde fence, and after an unclosed one', () => {
    const tildes = ['~~~', '[Report][demopkg.report.Report]', '~~~'].join('\n');
    expect(resolveCrossReferences(tildes, resolve)).toBe(tildes);

    const unclosed = ['```python', 'x = "[Report][demopkg.report.Report]"'].join('\n');
    expect(resolveCrossReferences(unclosed, resolve)).toBe(unclosed);
  });

  test('leaves references inside an inline code span', () => {
    const source = 'Write `[Report][demopkg.report.Report]` to link to it.';
    expect(resolveCrossReferences(source, resolve)).toBe(source);
  });

  test('handles a code span that only looks like it opens a reference', () => {
    // The span swallows the first bracket pair, so the second is text.
    const source = 'A ``[Report][demopkg.report.Report]`` literal.';
    expect(resolveCrossReferences(source, resolve)).toBe(source);
  });

  test('rewrites a reference that follows a code span', () => {
    expect(resolveCrossReferences('`code` then [Report][demopkg.report.Report].', resolve)).toBe(
      '`code` then [Report](/api/demopkg/report/#demopkg.report.Report).',
    );
  });

  test('skips a target that has a Markdown reference definition', () => {
    const source = [
      'See [the report][demopkg.report.Report].',
      '',
      '[demopkg.report.Report]: https://example.com/elsewhere',
    ].join('\n');
    expect(resolveCrossReferences(source, resolve)).toBe(source);
  });

  test('a definition inside a fence does not shadow a reference', () => {
    const source = [
      'See [the report][demopkg.report.Report].',
      '',
      '```md',
      '[demopkg.report.Report]: https://example.com/elsewhere',
      '```',
    ].join('\n');
    expect(resolveCrossReferences(source, resolve)).toContain(
      'See [the report](/api/demopkg/report/#demopkg.report.Report).',
    );
  });

  test('skips an escaped opening bracket', () => {
    const source = 'Literally \\[Report][demopkg.report.Report].';
    expect(resolveCrossReferences(source, resolve)).toBe(source);
  });

  test('wraps a URL that would break the link syntax', () => {
    const rewritten = resolveCrossReferences('[Odd][odd]', (target) => (target === 'odd' ? '/api/odd(1)/' : undefined));
    expect(rewritten).toBe('[Odd](</api/odd(1)/>)');
  });

  test('an empty title falls back to the target', () => {
    expect(resolveCrossReferences('[][demopkg.report.Report]', resolve)).toBe(
      '[demopkg.report.Report](/api/demopkg/report/#demopkg.report.Report)',
    );
  });
});

describe('createCrossReferenceResolver', () => {
  test('resolves a documented path to the href the components build', async () => {
    const model = await fixtureModel('demopkg');
    const resolver = createCrossReferenceResolver({
      models: [model],
      siteBase: '/docs',
      trailingSlash: 'always',
    });

    expect(resolver('demopkg.report.Report')).toBe('/docs/api/demopkg/report/#demopkg.report.Report');
    // A module is a page of its own, so it has no anchor.
    expect(resolver('demopkg.report')).toBe('/docs/api/demopkg/report/');
    expect(resolver('demopkg.nothing')).toBeUndefined();
  });

  test('follows a canonical path to the shortest documented one', async () => {
    const model = await fixtureModel('demopkg');
    const resolver = createCrossReferenceResolver({ models: [model], siteBase: '', trailingSlash: 'always' });
    // `demopkg.Report` is the re-export, documented on the package root page.
    expect(resolver('demopkg.Report')).toBe('/api/demopkg/#demopkg.Report');
  });

  test('searches the other packages, then the inventories', async () => {
    const [demopkg, numpkg] = await Promise.all([fixtureModel('demopkg'), fixtureModel('numpkg')]);
    const resolver = createCrossReferenceResolver({
      models: [demopkg, numpkg],
      siteBase: '',
      trailingSlash: 'never',
      lookupExternal: (path) => (path === 'pathlib.Path' ? 'https://docs.python.org/3/pathlib.html' : undefined),
    });

    expect(resolver('numpkg.Grid.area')).toBe('/api/numpkg#numpkg.Grid.area');
    expect(resolver('pathlib.Path')).toBe('https://docs.python.org/3/pathlib.html');
    expect(resolver('nosuchpkg.Thing')).toBeUndefined();
  });

  test('ignores surrounding whitespace and an empty target', async () => {
    const model = await fixtureModel('demopkg');
    const resolver = createCrossReferenceResolver({ models: [model], siteBase: '', trailingSlash: 'always' });
    expect(resolver('  demopkg.report.Report  ')).toBe('/api/demopkg/report/#demopkg.report.Report');
    expect(resolver('   ')).toBeUndefined();
  });

  test('resolves a bare name in the scope of the object that holds the docstring', async () => {
    const model = await fixtureModel('demopkg');
    const resolver = createCrossReferenceResolver({
      models: [model],
      siteBase: '',
      trailingSlash: 'always',
      scopes: model.scopes,
      lookupExternal: (path) => (path === 'pathlib.Path' ? 'https://docs.python.org/3/pathlib.html' : undefined),
    });

    expect(resolver('Report', 'demopkg.report.generate_report')).toBe('/api/demopkg/report/#demopkg.report.Report');
    // `pathlib` is imported in that module, so `pathlib.Path` goes through the inventory.
    expect(resolver('pathlib.Path', 'demopkg.report.generate_report')).toBe('https://docs.python.org/3/pathlib.html');
    // Without a scope, a bare name means nothing.
    expect(resolver('Report')).toBeUndefined();
  });

  test('falls back to builtins in scope, as annotations do', async () => {
    const model = await fixtureModel('demopkg');
    const resolver = createCrossReferenceResolver({
      models: [model],
      siteBase: '',
      trailingSlash: 'always',
      scopes: model.scopes,
      lookupExternal: (path) => (path === 'builtins.ValueError' ? 'https://docs.python.org/3/exc.html' : undefined),
    });
    expect(resolver('ValueError', 'demopkg.report.generate_report')).toBe('https://docs.python.org/3/exc.html');
  });

  test('links a builtin without an inventory, in scope or not', async () => {
    const model = await fixtureModel('demopkg');
    const resolver = createCrossReferenceResolver({
      models: [model],
      siteBase: '',
      trailingSlash: 'always',
      scopes: model.scopes,
    });
    expect(resolver('bool')).toBe('https://docs.python.org/3/builtins/functions.html#bool');
    expect(resolver('None', 'demopkg.report.generate_report')).toBe(
      'https://docs.python.org/3/builtins/constants.html#None',
    );
  });
});

describe('resolveSphinxRoles', () => {
  const scope = 'demopkg.report.generate_report';
  /** Resolves `Report` in {@link scope} and `pathlib.Path` anywhere. */
  const scoped = (target: string, scopePath?: string): string | undefined =>
    target === 'Report' && scopePath === scope ? '/api/demopkg/report/#demopkg.report.Report' : resolve(target);

  test('links a Python object role in the scope of its docstring', () => {
    expect(resolveSphinxRoles('Returns a :class:`Report`.', scoped, scope)).toBe(
      'Returns a [`Report`](/api/demopkg/report/#demopkg.report.Report).',
    );
  });

  test('accepts the py domain and resolves through the inventories', () => {
    expect(resolveSphinxRoles('Writes a :py:class:`pathlib.Path`.', scoped, scope)).toBe(
      'Writes a [`pathlib.Path`](https://docs.python.org/3/library/pathlib.html#pathlib.Path).',
    );
  });

  test('follows the tilde, explicit-title, bang and leading-dot forms', () => {
    expect(resolveSphinxRoles(':class:`~pathlib.Path`', scoped, scope)).toBe(
      '[`Path`](https://docs.python.org/3/library/pathlib.html#pathlib.Path)',
    );
    expect(resolveSphinxRoles(':class:`a path <pathlib.Path>`', scoped, scope)).toBe(
      '[`a path`](https://docs.python.org/3/library/pathlib.html#pathlib.Path)',
    );
    expect(resolveSphinxRoles(':class:`!pathlib.Path`', scoped, scope)).toBe('`pathlib.Path`');
    expect(resolveSphinxRoles(':class:`.Report`', scoped, scope)).toBe(
      '[`Report`](/api/demopkg/report/#demopkg.report.Report)',
    );
  });

  test('keeps an unresolved Python role as a code span', () => {
    expect(resolveSphinxRoles('Raises :exc:`NoSuchError` or calls :meth:`Context.scope`.', scoped, scope)).toBe(
      'Raises `NoSuchError` or calls `Context.scope`.',
    );
    expect(resolveSphinxRoles('See :func:`echo`.', undefined, scope)).toBe('See `echo`.');
  });

  test('keeps only the text of a prose role, and shows other roles as code', () => {
    expect(resolveSphinxRoles('See :ref:`the guide <guide>` and :doc:`intro`.', scoped, scope)).toBe(
      'See the guide and intro.',
    );
    expect(resolveSphinxRoles('See :ref:`__init__ <init>`.', scoped, scope)).toBe('See \\_\\_init\\_\\_.');
    expect(resolveSphinxRoles('Follows :pep:`8`.', scoped, scope)).toBe('Follows PEP 8.');
    expect(resolveSphinxRoles('A :c:func:`malloc` call in :file:`__init__.py`.', scoped, scope)).toBe(
      'A `malloc` call in `__init__.py`.',
    );
  });

  test('keeps angle brackets in a literal role', () => {
    expect(resolveSphinxRoles('Reads :file:`/etc/<name>` and :code:`Vec<T>`.', scoped, scope)).toBe(
      'Reads `/etc/<name>` and `Vec<T>`.',
    );
  });

  test('resolves a :mod: target exactly, not in scope', () => {
    const scopes: (string | undefined)[] = [];
    resolveSphinxRoles(':mod:`json` and :meth:`json`', (_target, scopePath) => void scopes.push(scopePath), scope);
    expect(scopes).toEqual([undefined, scope]);
  });

  test('keeps a role in link text as code, so links do not nest', () => {
    expect(resolveSphinxRoles('[:class:`Report`](/x) and [:class:`Report`][]', scoped, scope)).toBe(
      '[`Report`](/x) and [`Report`][]',
    );
  });

  test('drops the call parentheses from the target, and reads a role that wraps', () => {
    expect(resolveSphinxRoles(':meth:`~Report.generate()`', (target) => resolve(target), scope)).toBe('`generate()`');
    expect(resolveSphinxRoles(':class:`~pathlib.Path()`', scoped, scope)).toBe(
      '[`Path()`](https://docs.python.org/3/library/pathlib.html#pathlib.Path)',
    );
    expect(resolveSphinxRoles(':class:`the\nreport <Report>`', scoped, scope)).toBe(
      '[`the report`](/api/demopkg/report/#demopkg.report.Report)',
    );
    expect(resolveSphinxRoles(':class:`a\n\nb`', scoped, scope)).toBe(':class:`a\n\nb`');
  });

  test('leaves an escaped role alone, but not one after an escaped backslash', () => {
    expect(resolveSphinxRoles('\\:class:`Report`', scoped, scope)).toBe('\\:class:`Report`');
    expect(resolveSphinxRoles('\\\\:class:`Report`', scoped, scope)).toBe(
      '\\\\[`Report`](/api/demopkg/report/#demopkg.report.Report)',
    );
  });

  test('leaves roles inside code alone', () => {
    const source = ['Use ``:class:`Report` `` to link.', '', '```rst', ':class:`Report`', '```'].join('\n');
    expect(resolveSphinxRoles(source, scoped, scope)).toBe(source);
  });

  test('leaves field lists and other colons alone', () => {
    const source = ':param silent: if set, returns `None`. Time is 10:30 and `a:b` stays.';
    expect(resolveSphinxRoles(source, scoped, scope)).toBe(source);
  });
});
