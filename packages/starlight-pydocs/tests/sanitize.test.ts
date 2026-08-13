import { describe, expect, test } from 'vitest';

import { sanitizeDocstringHtml } from '../lib/sanitize.ts';

describe('sanitizeDocstringHtml', () => {
  test('removes script elements and their content', () => {
    expect(sanitizeDocstringHtml('<p>a<script>alert(1)</script>b</p>')).toBe('<p>ab</p>');
  });

  test('removes event-handler attributes', () => {
    expect(sanitizeDocstringHtml('<img src="x.png" onerror="alert(1)" alt="y">')).toBe('<img src="x.png" alt="y" />');
  });

  test('removes javascript: and data: hrefs but keeps http(s), mailto and relative ones', () => {
    expect(sanitizeDocstringHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeDocstringHtml('<a href="data:text/html,x">x</a>')).toBe('<a>x</a>');
    expect(sanitizeDocstringHtml('<a href="https://example.com/" rel="noreferrer">x</a>')).toBe(
      '<a href="https://example.com/" rel="noreferrer">x</a>',
    );
    expect(sanitizeDocstringHtml('<a href="/api/demopkg/#demopkg.Report">x</a>')).toBe(
      '<a href="/api/demopkg/#demopkg.Report">x</a>',
    );
  });

  test('drops frames, forms and unknown elements while keeping their text', () => {
    expect(sanitizeDocstringHtml('<iframe src="https://example.com"></iframe>kept')).toBe('kept');
    expect(sanitizeDocstringHtml('<form action="/steal"><input type="text"></form>')).toBe('');
    expect(sanitizeDocstringHtml('<object data="x"></object><embed src="x">after')).toBe('after');
  });

  test('keeps Shiki output byte-for-byte: classes, tabindex and dual-theme style variables', () => {
    const shiki =
      '<pre class="astro-code" style="background-color:#fff;--shiki-dark-bg:#24292e" tabindex="0">' +
      '<code><span style="color:#0550AE;--shiki-dark:#79B8FF">x</span></code></pre>';
    expect(sanitizeDocstringHtml(shiki)).toBe(shiki);
  });

  test('keeps GFM task-list checkboxes, tables and details', () => {
    expect(sanitizeDocstringHtml('<ul><li><input type="checkbox" checked disabled /> done</li></ul>')).toBe(
      '<ul><li><input type="checkbox" checked disabled /> done</li></ul>',
    );
    expect(sanitizeDocstringHtml('<table><tr><th scope="col">a</th><td colspan="2">b</td></tr></table>')).toContain(
      '<td colspan="2">b</td>',
    );
    expect(sanitizeDocstringHtml('<details open><summary>t</summary>b</details>')).toBe(
      '<details open><summary>t</summary>b</details>',
    );
  });

  test('keeps inline svg icons, without their event handlers', () => {
    const out = sanitizeDocstringHtml(
      '<svg viewBox="0 0 24 24" width="16" onload="alert(1)"><path d="M1 2" fill-rule="evenodd"/></svg>',
    );
    expect(out).toContain('viewbox="0 0 24 24"');
    expect(out).toContain('d="M1 2"');
    expect(out).not.toContain('onload');
  });

  test('keeps data: images (render-only) while links never get the scheme', () => {
    expect(sanitizeDocstringHtml('<img src="data:image/png;base64,AA" alt="" />')).toBe(
      '<img src="data:image/png;base64,AA" alt="" />',
    );
  });
});
