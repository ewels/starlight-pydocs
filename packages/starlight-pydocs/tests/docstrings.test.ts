import { describe, expect, test } from 'vitest';

import type { DocstringMarkdownItem } from '../lib/docstrings.ts';
import {
  assembleRenderedDocstrings,
  collectDocstringMarkdown,
  findUnparsedSections,
  mergeInitDocstrings,
  renderedDeprecation,
  renderedSectionBlock,
  renderedSectionBody,
  renderedSectionEntry,
} from '../lib/docstrings.ts';
import type { GriffeDump } from '../lib/types.ts';
import { loadFixtureDump } from './helpers.ts';

function itemsFor(items: DocstringMarkdownItem[], objectPath: string): DocstringMarkdownItem[] {
  return items.filter((item) => item.objectPath === objectPath);
}

describe('collectDocstringMarkdown', () => {
  test('collects every prose string of the fixture package', async () => {
    const items = collectDocstringMarkdown(await loadFixtureDump('demopkg'));
    expect(items.length).toBeGreaterThan(20);
    // Private members are in the dump too: `<Autodoc>` may name anything, so
    // collection is deliberately unfiltered.
    expect(items.some((item) => item.objectPath.startsWith('demopkg._internal'))).toBe(true);
  });

  test('collects the text body of a section', async () => {
    const items = collectDocstringMarkdown(await loadFixtureDump('demopkg'));
    const body = itemsFor(items, 'demopkg.report.Report.generate').find((item) => item.slot === 'body');
    expect(body?.markdown).toContain('Render the report');
  });

  test('collects parameter descriptions as entries, indexed in order', async () => {
    const items = collectDocstringMarkdown(await loadFixtureDump('demopkg'));
    const entries = itemsFor(items, 'demopkg.report.generate_report').filter((item) => item.slot === 'entry');
    expect(entries.length).toBeGreaterThanOrEqual(4);
    // Indices are per section, so `parameters` numbers its own entries 0, 1, 2.
    const parameters = entries.filter((entry) => entry.sectionIndex === entries[0]?.sectionIndex);
    expect(parameters.map((entry) => entry.index)).toEqual([...parameters.keys()]);
  });

  test('fences doctest example blocks and leaves prose pairs alone', async () => {
    const items = collectDocstringMarkdown(await loadFixtureDump('demopkg'));
    const blocks = itemsFor(items, 'demopkg').filter((item) => item.slot === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((block) => block.markdown.startsWith('```python\n>>>'))).toBe(true);
    expect(blocks.some((block) => !block.markdown.startsWith('```'))).toBe(true);
  });

  test('routes a Deprecated admonition to the deprecation slot', async () => {
    const items = collectDocstringMarkdown(await loadFixtureDump('demopkg'));
    const deprecated = itemsFor(items, 'demopkg.report.old_generate').filter((item) => item.slot === 'deprecated');
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]?.sectionIndex).toBe(-1);
    expect(deprecated[0]?.markdown).toContain('Since 0.3');
  });

  test('keeps admonition prose as a body', async () => {
    const items = collectDocstringMarkdown(await loadFixtureDump('demopkg'));
    const note = itemsFor(items, 'demopkg.report.Report.generate').filter((item) => item.slot === 'body');
    expect(note.length).toBeGreaterThan(1);
  });

  test('skips blank strings', () => {
    const dump: GriffeDump = {
      pkg: {
        kind: 'module',
        name: 'pkg',
        path: 'pkg',
        docstring: { value: '', parsed: [{ kind: 'text', value: '   ' }] },
      },
    };
    expect(collectDocstringMarkdown(dump)).toEqual([]);
  });

  test('visits each object once', () => {
    const dump: GriffeDump = {
      pkg: {
        kind: 'module',
        name: 'pkg',
        path: 'pkg',
        docstring: { value: 'x', parsed: [{ kind: 'text', value: 'one' }] },
        members: {
          child: {
            kind: 'attribute',
            name: 'child',
            path: 'pkg.child',
            docstring: { value: 'y', parsed: [{ kind: 'text', value: 'two' }] },
          },
        },
      },
      'pkg.child': {
        kind: 'attribute',
        name: 'child',
        path: 'pkg.child',
        docstring: { value: 'y', parsed: [{ kind: 'text', value: 'two' }] },
      },
    };
    expect(collectDocstringMarkdown(dump)).toHaveLength(2);
  });
});

describe('assembleRenderedDocstrings', () => {
  const items: DocstringMarkdownItem[] = [
    { objectPath: 'pkg.f', sectionIndex: 0, slot: 'body', index: 0, markdown: 'a' },
    { objectPath: 'pkg.f', sectionIndex: 1, slot: 'entry', index: 0, markdown: 'b' },
    { objectPath: 'pkg.f', sectionIndex: 1, slot: 'entry', index: 2, markdown: 'c' },
    { objectPath: 'pkg.f', sectionIndex: 2, slot: 'block', index: 1, markdown: 'd' },
    { objectPath: 'pkg.f', sectionIndex: -1, slot: 'deprecated', index: 0, markdown: 'e' },
  ];
  const rendered = assembleRenderedDocstrings(items, ['<p>a</p>', '<p>b</p>', '<p>c</p>', '<pre>d</pre>', '<p>e</p>']);

  test('puts each piece where the accessors look for it', () => {
    expect(renderedSectionBody(rendered, 'pkg.f', 0)).toBe('<p>a</p>');
    expect(renderedSectionEntry(rendered, 'pkg.f', 1, 0)).toBe('<p>b</p>');
    expect(renderedSectionEntry(rendered, 'pkg.f', 1, 2)).toBe('<p>c</p>');
    expect(renderedSectionBlock(rendered, 'pkg.f', 2, 1)).toBe('<pre>d</pre>');
    expect(renderedDeprecation(rendered, 'pkg.f')).toBe('<p>e</p>');
  });

  test('missing pieces read as empty strings', () => {
    expect(renderedSectionBody(rendered, 'pkg.f', 9)).toBe('');
    expect(renderedSectionEntry(rendered, 'pkg.f', 1, 5)).toBe('');
    expect(renderedSectionBlock(rendered, 'pkg.missing', 0, 0)).toBe('');
    expect(renderedDeprecation(rendered, 'pkg.missing')).toBe('');
  });

  test('drops empty renders instead of storing them', () => {
    const sparse = assembleRenderedDocstrings(items, ['', '<p>b</p>']);
    expect(renderedSectionBody(sparse, 'pkg.f', 0)).toBe('');
    expect(renderedSectionEntry(sparse, 'pkg.f', 1, 0)).toBe('<p>b</p>');
  });

  test('survives a round trip through JSON', () => {
    const parsed = JSON.parse(JSON.stringify(rendered)) as typeof rendered;
    expect(renderedSectionEntry(parsed, 'pkg.f', 1, 2)).toBe('<p>c</p>');
  });
});

describe('mergeInitDocstrings', () => {
  const text = (value: string) => ({ kind: 'text', value });
  const params = { kind: 'parameters', value: [{ name: 'name', description: 'Who to greet.' }] };
  const init = (parsed: unknown[]) => ({
    kind: 'function',
    name: '__init__',
    path: 'pkg.A.__init__',
    docstring: { value: 'Make one.', parsed },
  });
  const dumpWith = (classDocstring: unknown, initMember: unknown): GriffeDump =>
    ({
      pkg: {
        kind: 'module',
        name: 'pkg',
        path: 'pkg',
        members: {
          A: { kind: 'class', name: 'A', path: 'pkg.A', docstring: classDocstring, members: { __init__: initMember } },
        },
      },
    }) as unknown as GriffeDump;
  const classOf = (dump: GriffeDump) => dump['pkg']?.members?.['A'];

  test("appends the __init__ sections to the class's own, and keeps them on __init__", () => {
    const dump = mergeInitDocstrings(
      dumpWith({ value: 'A thing.', parsed: [text('A thing.')] }, init([text('Make one.'), params])),
    );
    expect(classOf(dump)?.docstring?.parsed).toEqual([text('A thing.'), text('Make one.'), params]);
    expect(classOf(dump)?.members?.['__init__']?.docstring?.parsed).toEqual([text('Make one.'), params]);
  });

  test('gives a class with no docstring the __init__ docstring', () => {
    const dump = mergeInitDocstrings(dumpWith(undefined, init([params])));
    expect(classOf(dump)?.docstring).toEqual({ value: 'Make one.', parsed: [params] });
  });

  test('changes nothing when __init__ has no parsed docstring', () => {
    const own = { value: 'A thing.', parsed: [text('A thing.')] };
    const dump = mergeInitDocstrings(dumpWith(own, { kind: 'function', name: '__init__', path: 'pkg.A.__init__' }));
    expect(classOf(dump)?.docstring).toEqual(own);
  });
});

describe('findUnparsedSections', () => {
  const body = (objectPath: string, markdown: string): DocstringMarkdownItem => ({
    objectPath,
    sectionIndex: 0,
    slot: 'body',
    index: 0,
    markdown,
  });

  test('finds sections of each other style left in the prose', () => {
    const items = [
      body('pkg.sphinx', 'Greet someone.\n\n:param name: who to greet.\n:returns: the greeting.'),
      body('pkg.numpy', 'Greet someone.\n\nParameters\n----------\nname : str\n    Who to greet.'),
      // Griffe's google parser reads `Args:` as a header and leaves the underline.
      body('pkg.underline', '----\n    name: Who to greet.'),
      body('pkg.plain', 'Greet someone.\n\nIt is 10:30, and `a:b` is not a field list.'),
    ];
    expect(findUnparsedSections(items, 'google')).toEqual([
      { style: 'sphinx', count: 1, examples: ['pkg.sphinx'] },
      { style: 'numpy', count: 2, examples: ['pkg.numpy', 'pkg.underline'] },
    ]);
  });

  test('ignores Markdown headings, indented code and objects the site does not render', () => {
    const items = [
      body('pkg.heading', 'Intro.\n\nNotes\n-----\nSome markdown heading.'),
      body('pkg.indented', 'Intro.\n\n    :param x: indented code block example'),
      body('pkg._vendor.x', ':param x: vendored'),
    ];
    expect(findUnparsedSections(items, 'google', new Set(['pkg.heading', 'pkg.indented']))).toEqual([]);
  });

  test('finds google sections under another style, and skips the configured one', () => {
    const items = [body('pkg.google', 'Greet someone.\n\nArgs:\n    name: Who to greet.')];
    expect(findUnparsedSections(items, 'numpy')).toEqual([{ style: 'google', count: 1, examples: ['pkg.google'] }]);
    expect(findUnparsedSections(items, 'google')).toEqual([]);
  });

  test('counts an object once and lists at most three examples', () => {
    const items = ['a', 'b', 'c', 'd'].flatMap((name) => [
      body(`pkg.${name}`, ':param x: one.'),
      body(`pkg.${name}`, ':param y: two.'),
    ]);
    expect(findUnparsedSections(items, 'google')).toEqual([
      { style: 'sphinx', count: 4, examples: ['pkg.a', 'pkg.b', 'pkg.c'] },
    ]);
  });

  test('ignores markup inside code', () => {
    const items = [body('pkg.f', 'Example:\n\n```rst\n:param x: one.\n```\n\nInline `:param y: two.`')];
    expect(findUnparsedSections(items, 'google')).toEqual([]);
  });

  test('ignores parameter descriptions and other slots', () => {
    const items: DocstringMarkdownItem[] = [{ ...body('pkg.f', ':param x: one.'), slot: 'entry' }];
    expect(findUnparsedSections(items, 'google')).toEqual([]);
  });
});
