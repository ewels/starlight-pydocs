import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { satteri } from '@astrojs/markdown-satteri';
import type { AstroConfig } from 'astro';
import { describe, expect, test } from 'vitest';

import { renderedSectionBlock, renderedSectionBody, type RenderedDocstrings } from '../lib/docstrings.ts';
import { PydocsError } from '../lib/errors.ts';
import { renderDocstringsForDump, resolveDocstringRenderer } from '../libs/docstring-renderer.ts';
import { fixturePath } from './helpers.ts';

type MarkdownConfig = AstroConfig['markdown'];

/**
 * The shared markdown options, as Astro resolves them. Only the fields the
 * processors read matter here; dual Shiki themes are included because that is
 * what the docs site configures and what `styles.css` expects.
 */
function markdownConfig(overrides: Record<string, unknown> = {}): MarkdownConfig {
  return {
    syntaxHighlight: 'shiki',
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
    ...overrides,
  } as unknown as MarkdownConfig;
}

describe('resolveDocstringRenderer', () => {
  test('uses the configured processor (Sätteri, the Astro 7.2 default)', async () => {
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor: satteri() }));
    const html = await renderer.render('A *link* to [docs](https://example.com).');
    expect(html).toContain('<em>link</em>');
    expect(html).toContain('href="https://example.com"');
  });

  test('renders GFM tables and dual-theme code through the configured processor', async () => {
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor: satteri() }));
    const table = await renderer.render('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(table).toContain('<table>');

    const code = await renderer.render('```python\nx = 1\n```');
    expect(code).toContain('astro-code');
    expect(code).toContain('--shiki-light');
    expect(code).toContain('--shiki-dark');
  });

  test('falls back to @astrojs/markdown-remark when the host has no processor', async () => {
    const renderer = await resolveDocstringRenderer(markdownConfig());
    expect(renderer.name).toBe('@astrojs/markdown-remark');
    const html = await renderer.render('```python\nx = 1\n```');
    // Both engines emit `.astro-code` with the same theme custom properties, so
    // one stylesheet covers them.
    expect(html).toContain('astro-code');
    expect(html).toContain('--shiki-light');
  });

  test('accepts any object implementing createRenderer', async () => {
    const processor = {
      name: 'test-processor',
      options: {},
      createRenderer: () =>
        Promise.resolve({ render: (content: string) => Promise.resolve({ code: `<b>${content}</b>` }) }),
    };
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor }));
    expect(renderer.name).toBe('test-processor');
    expect(await renderer.render('hi')).toBe('<b>hi</b>');
  });

  test('ignores a processor that is not one', async () => {
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor: { name: 'broken' } }));
    expect(renderer.name).toBe('@astrojs/markdown-remark');
  });
});

describe('renderDocstringsForDump', () => {
  test('writes a sidecar of rendered prose beside the dump', async () => {
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor: satteri() }));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-rendered-'));
    const renderedPath = path.join(directory, 'rendered.json');

    const { count } = await renderDocstringsForDump({
      dumpPath: fixturePath('demopkg', 'dump.json'),
      renderedPath,
      renderer,
    });
    expect(count).toBeGreaterThan(20);

    const rendered = JSON.parse(await fs.readFile(renderedPath, 'utf8')) as RenderedDocstrings;
    const generate = rendered.objects['demopkg.report.Report.generate'];
    expect(generate).toBeDefined();
    expect(JSON.stringify(generate)).toContain('<p>');

    // The doctest block was fenced before rendering, so it comes back highlighted.
    const packageDoc = rendered.objects['demopkg'];
    const sections = Object.keys(packageDoc?.sections ?? {});
    const blocks = sections
      .flatMap((index) => [0, 1, 2].map((block) => renderedSectionBlock(rendered, 'demopkg', Number(index), block)))
      .filter((html) => html !== '');
    expect(blocks.some((html) => html.includes('astro-code'))).toBe(true);

    // And a plain text section is plain prose.
    const bodies = sections
      .map((index) => renderedSectionBody(rendered, 'demopkg', Number(index)))
      .filter((html) => html !== '');
    expect(bodies.some((html) => html.startsWith('<p>'))).toBe(true);

    await fs.rm(directory, { recursive: true, force: true });
  });

  test('a failing render costs that one string, not the build', async () => {
    const failing = {
      name: 'exploding',
      options: {},
      createRenderer: () =>
        Promise.resolve({
          render: (content: string) =>
            content.includes('Render the report')
              ? Promise.reject(new Error('nope'))
              : Promise.resolve({ code: '<p>ok</p>' }),
        }),
    };
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor: failing }));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-rendered-'));
    const renderedPath = path.join(directory, 'rendered.json');

    await renderDocstringsForDump({ dumpPath: fixturePath('demopkg', 'dump.json'), renderedPath, renderer });
    const rendered = JSON.parse(await fs.readFile(renderedPath, 'utf8')) as RenderedDocstrings;
    expect(JSON.stringify(rendered.objects['demopkg.report.Report.generate'])).not.toContain('Render the report');
    expect(rendered.objects['demopkg']).toBeDefined();

    await fs.rm(directory, { recursive: true, force: true });
  });

  test('a missing dump is a PydocsError', async () => {
    const renderer = await resolveDocstringRenderer(markdownConfig({ processor: satteri() }));
    await expect(
      renderDocstringsForDump({ dumpPath: '/nonexistent/dump.json', renderedPath: '/tmp/x.json', renderer }),
    ).rejects.toBeInstanceOf(PydocsError);
  });
});
