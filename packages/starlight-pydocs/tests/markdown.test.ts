import { describe, expect, test } from 'vitest';

import { prepareDoctestMarkdown, unwrapParagraph } from '../lib/markdown.ts';

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
