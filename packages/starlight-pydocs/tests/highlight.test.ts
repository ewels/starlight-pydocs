import { describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import { createContext } from '../lib/context.ts';
import type { AnnotationToken } from '../lib/expr.ts';
import { tokensText } from '../lib/expr.ts';
import { highlightTokens } from '../lib/highlight.ts';

const config = normalizeConfig({ packages: [{ name: 'demopkg', base: 'api/demopkg' }] }, '/workspace');
const options = {
  dumpPaths: new Map<string, string>(),
  siteBase: '',
  trailingSlash: 'ignore',
  starlight: true,
} as const;

const themes = { light: 'github-light', dark: 'github-dark' };

const target = { kind: 'internal', path: 'pkg.Theme' } as const;

describe('highlightTokens', () => {
  test('colours the text without moving a character of it', async () => {
    const tokens: AnnotationToken[] = [
      { text: 'COLORS: ' },
      { text: 'dict', target },
      { text: "[str, int] = {\n  'a': 1,\n}" },
    ];
    const highlighted = await highlightTokens(tokens, themes);

    expect(tokensText(highlighted)).toBe(tokensText(tokens));
    expect(highlighted.some((token) => token.style?.includes('--shiki-light') === true)).toBe(true);
  });

  test('keeps every link, and never puts a colour on one', async () => {
    const tokens: AnnotationToken[] = [{ text: 'x: ' }, { text: 'Theme', target }, { text: ' = None' }];
    const highlighted = await highlightTokens(tokens, themes);

    const linked = highlighted.filter((token) => token.target !== undefined);
    expect(linked.map((token) => token.text).join('')).toBe('Theme');
    expect(linked.every((token) => token.target === target)).toBe(true);
  });

  test('splits a token when Shiki colours only part of it', async () => {
    // 'None' is a keyword to Shiki but one plain token to us, so the run
    // 'x = None' has to come back as more than one piece.
    const tokens: AnnotationToken[] = [{ text: 'x = None' }];
    const highlighted = await highlightTokens(tokens, themes);

    expect(highlighted.length).toBeGreaterThan(1);
    expect(tokensText(highlighted)).toBe('x = None');
  });

  test('returns empty input untouched', async () => {
    expect(await highlightTokens([], themes)).toEqual([]);
  });
});

describe('theme selection', () => {
  test('prefers a configured light/dark pair', () => {
    const context = createContext(config, {
      ...options,
      shikiConfig: { theme: 'dracula', themes: { light: 'min-light', dark: 'min-dark' } },
    });
    expect(context.shikiThemes).toEqual({ light: 'min-light', dark: 'min-dark' });
  });

  test('uses a deliberately chosen single theme for both schemes', () => {
    const context = createContext(config, { ...options, shikiConfig: { theme: 'dracula', themes: {} } });
    expect(context.shikiThemes).toEqual({ light: 'dracula', dark: 'dracula' });
  });

  test("ignores Astro's default, which would be dark colours on a light page", () => {
    const context = createContext(config, { ...options, shikiConfig: { theme: 'github-dark', themes: {} } });
    expect(context.shikiThemes).toEqual({ light: 'github-light', dark: 'github-dark' });
  });

  test('falls back when the host configured nothing', () => {
    expect(createContext(config, options).shikiThemes).toEqual({ light: 'github-light', dark: 'github-dark' });
  });
});
