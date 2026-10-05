import { describe, expect, test } from 'vitest';

import { addCodeblocksMarkup, prepareDoctestMarkdown, unwrapParagraph } from '../lib/markdown.ts';

describe('unwrapParagraph', () => {
  test('unwraps a single paragraph', () => {
    expect(unwrapParagraph('<p>a <em>b</em> c</p>')).toBe('a <em>b</em> c');
  });

  test('trims before deciding', () => {
    expect(unwrapParagraph('\n<p>hi</p>\n')).toBe('hi');
  });

  test('keeps block markup when there is more than one paragraph', () => {
    expect(unwrapParagraph('<p>one</p>\n<p>two</p>')).toBe('<p>one</p>\n<p>two</p>');
  });

  test('leaves other block elements alone', () => {
    expect(unwrapParagraph('<ul><li>a</li></ul>')).toBe('<ul><li>a</li></ul>');
  });

  test('is empty for empty input', () => {
    expect(unwrapParagraph('')).toBe('');
  });
});

describe('prepareDoctestMarkdown', () => {
  test('fences a bare doctest transcript as python', () => {
    expect(prepareDoctestMarkdown('>>> 1 + 1\n2')).toBe('```python\n>>> 1 + 1\n2\n```');
  });

  test('leaves an already fenced block alone', () => {
    expect(prepareDoctestMarkdown('```text\nhi\n```')).toBe('```text\nhi\n```');
    expect(prepareDoctestMarkdown('~~~\nhi\n~~~')).toBe('~~~\nhi\n~~~');
  });

  test('is empty for blank input', () => {
    expect(prepareDoctestMarkdown('   \n ')).toBe('');
  });
});

describe('addCodeblocksMarkup', () => {
  const py = { inlineLanguage: 'py' };

  test('makes every fence expandable, and a fence with no language plain text', () => {
    expect(addCodeblocksMarkup('```python\nx = 1\n```\n\n~~~\nout\n~~~', { inlineLanguage: undefined })).toBe(
      '```python expandable\nx = 1\n```\n\n~~~text expandable\nout\n~~~',
    );
  });

  test('ties every fence to its package base, unless the author set one', () => {
    const markup = { inlineLanguage: undefined, pydocsBase: '1x/api/demopkg' };
    expect(addCodeblocksMarkup('```python\nx\n```', markup)).toBe(
      '```python expandable pydocsBase="1x/api/demopkg"\nx\n```',
    );
    expect(addCodeblocksMarkup('```py pydocsBase="api/other"\nx\n```', markup)).toBe(
      '```py pydocsBase="api/other" expandable\nx\n```',
    );
  });

  test('keeps an author-written expandable', () => {
    expect(addCodeblocksMarkup('```py expandable={4}\nx\n```', py)).toBe('```py expandable={4}\nx\n```');
  });

  test('suffixes inline code outside fences only', () => {
    expect(addCodeblocksMarkup('Call `run(x)` or ``a`b``.\n```py\n`not` this\n```', py)).toBe(
      'Call `run(x){:py}` or ``a`b{:py}``.\n```py expandable\n`not` this\n```',
    );
  });

  test('leaves indented code blocks as written', () => {
    expect(addCodeblocksMarkup('Usage::\n\n    echo `date`\n    ```\n\nRun `x`.', py)).toBe(
      'Usage::\n\n    echo `date`\n    ```\n\nRun `x{:py}`.',
    );
    expect(addCodeblocksMarkup('- item\n\n    `x` and\n    ```py\n    y\n    ```', py)).toBe(
      '- item\n\n    `x{:py}` and\n    ```py expandable\n    y\n    ```',
    );
  });

  test('finds fences inside blockquotes', () => {
    expect(addCodeblocksMarkup('> ```python\n> a = `b`\n> ```\n> see `c`', py)).toBe(
      '> ```python expandable\n> a = `b`\n> ```\n> see `c{:py}`',
    );
  });

  test('leaves escaped backticks in prose alone', () => {
    expect(addCodeblocksMarkup('Escaped \\`not code\\` here', py)).toBe('Escaped \\`not code\\` here');
  });

  test('leaves inline code with a suffix, or with no inline language, alone', () => {
    expect(addCodeblocksMarkup('`ls -l{:sh}` and `x`', py)).toBe('`ls -l{:sh}` and `x{:py}`');
    expect(addCodeblocksMarkup('`x{:c#}` and `x{:objective.c}`', py)).toBe('`x{:c#}` and `x{:objective.c}`');
    expect(addCodeblocksMarkup('`x`', { inlineLanguage: undefined })).toBe('`x`');
  });

  test('suffixes code that only looks like a suffix, such as a format spec', () => {
    expect(addCodeblocksMarkup('Pad with `{:02d}`.', py)).toBe('Pad with `{:02d}{:py}`.');
  });

  test('leaves HTML blocks as written, up to the next blank line', () => {
    expect(addCodeblocksMarkup('<div>\n`x`\n</div>\n\nSee `y` and <https://a.b> `z`.', py)).toBe(
      '<div>\n`x`\n</div>\n\nSee `y{:py}` and <https://a.b> `z{:py}`.',
    );
    expect(addCodeblocksMarkup('<https://a.b> has `z`.', py)).toBe('<https://a.b> has `z{:py}`.');
  });
});
