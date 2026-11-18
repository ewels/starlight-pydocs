import { describe, expect, test } from 'vitest';

import { rstLinksToMarkdown, convertRst, convertSection } from '../lib/rst.ts';
import type { GriffeDump } from '../lib/types.ts';

const text = (value: string) => ({ kind: 'text', value });

describe('convertSection', () => {
  test('turns an admonition directive into an admonition section between the text around it', () => {
    const source = 'Before.\n\n.. warning::\n   Mind the gap.\n\n   Second paragraph.\n\nAfter.';
    expect(convertSection(text(source))).toEqual([
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
    expect(convertSection(text('.. note:: Short note.'))).toEqual([
      { kind: 'admonition', title: null, value: { annotation: 'note', description: 'Short note.' } },
    ]);
    expect(convertSection(text('.. seealso:: The guide.'))).toEqual([
      { kind: 'admonition', title: 'See also', value: { annotation: 'seealso', description: 'The guide.' } },
    ]);
    expect(convertSection(text('.. admonition:: Before you start\n\n   Install uv.'))).toEqual([
      { kind: 'admonition', title: 'Before you start', value: { annotation: 'note', description: 'Install uv.' } },
    ]);
  });

  test('turns deprecated into a deprecation section with its version', () => {
    expect(convertSection(text('Old.\n\n.. deprecated:: 1.9 Use new() instead.'))).toEqual([
      text('Old.'),
      { kind: 'deprecated', value: { version: '1.9', description: 'Use new() instead.' } },
    ]);
  });

  test('writes version notes in place, in Sphinx wording', () => {
    const source = 'Body.\n\n.. versionadded:: 2.0\n\n.. versionchanged:: 2.1\n   Takes a path.';
    expect(convertSection(text(source))).toEqual([
      text('Body.\n\n*Added in version 2.0.*\n\n*Changed in version 2.1:* Takes a path.'),
    ]);
  });

  test('turns a code-block directive into a fence, without its options', () => {
    const source = 'Run:\n\n.. code-block:: python\n   :linenos:\n\n   import mypkg\n   mypkg.run()\n\nDone.';
    expect(convertSection(text(source))).toEqual([text('Run:\n\n```python\nimport mypkg\nmypkg.run()\n```\n\nDone.')]);
  });

  test('leaves unknown directives, directives in fences and other sections alone', () => {
    const unknown = text('.. image:: diagram.png\n   :alt: A diagram');
    expect(convertSection(unknown)).toEqual([unknown]);
    const fenced = text('```rst\n.. note::\n   Not a note.\n```');
    expect(convertSection(fenced)).toEqual([fenced]);
    const params = { kind: 'parameters', value: [] };
    expect(convertSection(params)).toEqual([params]);
  });
});

describe('convertRst', () => {
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
    convertRst(dump);
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

test('convertSection leaves a directive inside a longer fence alone', () => {
  const value = '````text\n```\n.. note:: Not a note.\n````';
  expect(convertSection({ kind: 'text', value })).toEqual([{ kind: 'text', value }]);
});

describe('review regressions', () => {
  test('keeps a body line that opens with a role', () => {
    expect(convertSection(text('.. versionchanged:: 2.0\n   :func:`load` now accepts paths.'))).toEqual([
      text('*Changed in version 2.0:* :func:`load` now accepts paths.'),
    ]);
  });

  test('matches directive names case-insensitively', () => {
    expect(convertSection(text('.. Note:: Case.'))).toEqual([
      { kind: 'admonition', title: null, value: { annotation: 'note', description: 'Case.' } },
    ]);
  });

  test('fences code longer than any backtick run in it, and keeps its first indent', () => {
    expect(convertSection(text('.. code-block:: markdown\n\n      ```py\n   x\n      ```'))).toEqual([
      text('````markdown\n   ```py\nx\n   ```\n````'),
    ]);
  });

  test('rewrites version notes, code and links in entry descriptions', () => {
    const params = {
      kind: 'parameters',
      value: [{ name: 'x', description: 'The x.\n\n.. versionadded:: 1.2\n\nSee `docs <https://example.com>`_.' }],
    };
    expect(convertSection(params)).toEqual([
      {
        kind: 'parameters',
        value: [{ name: 'x', description: 'The x.\n\n*Added in version 1.2.*\n\nSee [docs](https://example.com).' }],
      },
    ]);
  });

  test('shows only the text of a link to a named target', () => {
    expect(rstLinksToMarkdown('See `Target <target_>`_.')).toBe('See Target.');
  });
});
