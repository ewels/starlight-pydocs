import { describe, expect, test } from 'vitest';

import type { DocstringMarkdownItem } from '../lib/docstrings.ts';
import {
  assembleRenderedDocstrings,
  collectDocstringMarkdown,
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
