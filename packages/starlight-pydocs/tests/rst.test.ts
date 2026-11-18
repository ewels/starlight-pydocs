import { describe, expect, test } from 'vitest';

import { rstLinksToMarkdown, splitRstDirectives, splitSection } from '../lib/rst.ts';
import type { GriffeDump } from '../lib/types.ts';

const text = (value: string) => ({ kind: 'text', value });

describe('splitSection', () => {
  test('turns an admonition directive into an admonition section between the text around it', () => {
    const source = 'Before.\n\n.. warning::\n   Mind the gap.\n\n   Second paragraph.\n\nAfter.';
    expect(splitSection(text(source))).toEqual([
      text('Before.'),
      {
        kind: 'admonition',
        title: null,
        value: { annotation: 'warning', description: 'Mind the gap.\n\nSecond paragraph.' },
      },
      text('After.'),
    ]);
  });

  test('keeps text on the directive line, titles seealso, and reads a generic admonition title', () => {
    expect(splitSection(text('.. note:: Short note.'))).toEqual([
      { kind: 'admonition', title: null, value: { annotation: 'note', description: 'Short note.' } },
    ]);
    expect(splitSection(text('.. seealso:: The guide.'))).toEqual([
      { kind: 'admonition', title: 'See also', value: { annotation: 'seealso', description: 'The guide.' } },
    ]);
    expect(splitSection(text('.. admonition:: Before you start\n\n   Install uv.'))).toEqual([
      { kind: 'admonition', title: 'Before you start', value: { annotation: 'note', description: 'Install uv.' } },
    ]);
  });

  test('turns deprecated into a deprecation section with its version', () => {
    expect(splitSection(text('Old.\n\n.. deprecated:: 1.9 Use new() instead.'))).toEqual([
      text('Old.'),
      { kind: 'deprecated', value: { version: '1.9', description: 'Use new() instead.' } },
    ]);
  });

  test('writes version notes in place, in Sphinx wording', () => {
    const source = 'Body.\n\n.. versionadded:: 2.0\n\n.. versionchanged:: 2.1\n   Takes a path.';
    expect(splitSection(text(source))).toEqual([
      text('Body.\n\n*Added in version 2.0.*\n\n*Changed in version 2.1:* Takes a path.'),
    ]);
  });

  test('turns a code-block directive into a fence, without its options', () => {
    const source = 'Run:\n\n.. code-block:: python\n   :linenos:\n\n   import mypkg\n   mypkg.run()\n\nDone.';
    expect(splitSection(text(source))).toEqual([text('Run:\n\n```python\nimport mypkg\nmypkg.run()\n```\n\nDone.')]);
  });

  test('leaves unknown directives, directives in fences and other sections alone', () => {
    const unknown = text('.. image:: diagram.png\n   :alt: A diagram');
    expect(splitSection(unknown)).toEqual([unknown]);
    const fenced = text('```rst\n.. note::\n   Not a note.\n```');
    expect(splitSection(fenced)).toEqual([fenced]);
    const params = { kind: 'parameters', value: [] };
    expect(splitSection(params)).toEqual([params]);
  });
});

describe('splitRstDirectives', () => {
  test('rewrites the parsed sections of nested members in place', () => {
    const dump = {
      pkg: {
        kind: 'module',
        name: 'pkg',
        path: 'pkg',
        members: {
          f: {
            kind: 'function',
            name: 'f',
            path: 'pkg.f',
            docstring: { value: '', parsed: [text('Do it.\n\n.. tip:: Faster with uv.')] },
          },
        },
      },
    } as unknown as GriffeDump;
    splitRstDirectives(dump);
    expect(dump['pkg']?.members?.['f']?.docstring?.parsed).toEqual([
      text('Do it.'),
      { kind: 'admonition', title: null, value: { annotation: 'tip', description: 'Faster with uv.' } },
    ]);
  });
});

describe('rstLinksToMarkdown', () => {
  test('rewrites named and anonymous links, and a link with no text', () => {
    expect(rstLinksToMarkdown('See `asyncclick <https://github.com/python-trio/asyncclick>`_ now.')).toBe(
      'See [asyncclick](https://github.com/python-trio/asyncclick) now.',
    );
    expect(rstLinksToMarkdown('`docs <https://example.com/a>`__ and `<https://example.com/b>`_')).toBe(
      '[docs](https://example.com/a) and [https://example.com/b](https://example.com/b)',
    );
  });

  test('leaves links in code alone', () => {
    const source = '```rst\n`docs <https://example.com>`_\n```';
    expect(rstLinksToMarkdown(source)).toBe(source);
    const span = 'Write ``x `docs <https://example.com>`_`` like this.';
    expect(rstLinksToMarkdown(span)).toBe(span);
  });
});

test('splitSection leaves a directive inside a longer fence alone', () => {
  const value = '````text\n```\n.. note:: Not a note.\n````';
  expect(splitSection({ kind: 'text', value })).toEqual([{ kind: 'text', value }]);
});
