import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../lib/config.ts';
import type { PydocsContext } from '../lib/context.ts';
import { createContext } from '../lib/context.ts';
import { clearCaches, getModel, getSignatureHighlights } from '../lib/data.ts';
import type { AnnotationToken } from '../lib/expr.ts';
import { tokensText } from '../lib/expr.ts';
import type { SignatureHighlights } from '../lib/highlight.ts';
import { EMPTY_SIGNATURE_HIGHLIGHTS, highlightTokens } from '../lib/highlight.ts';
import { displaySignatureTokens } from '../lib/signature.ts';
import { highlightSignaturesForPackage } from '../libs/signature-highlighter.ts';
import { fixturePath } from './helpers.ts';

const config = normalizeConfig({ packages: [{ name: 'demopkg', base: 'api/demopkg' }] }, '/workspace');
const options = {
  dumpPaths: new Map<string, string>(),
  siteBase: '',
  trailingSlash: 'ignore',
  starlight: true,
} as const;

const target = { kind: 'internal', path: 'pkg.Theme' } as const;

/** A sidecar entry standing in for one Shiki has produced. */
function highlightsFor(pieces: { text: string; style?: string }[]): SignatureHighlights {
  return { texts: { [pieces.map((piece) => piece.text).join('')]: pieces } };
}

const LIGHT = '--shiki-light:#005cc5';

describe('highlightTokens', () => {
  test('colours the text without moving a character of it', () => {
    const tokens: AnnotationToken[] = [{ text: 'x: ' }, { text: 'int', target }, { text: ' = 1' }];
    const highlighted = highlightTokens(
      tokens,
      highlightsFor([{ text: 'x: ' }, { text: 'int', style: LIGHT }, { text: ' = 1', style: LIGHT }]),
    );

    expect(tokensText(highlighted)).toBe('x: int = 1');
    expect(highlighted.some((token) => token.style?.includes('--shiki-light') === true)).toBe(true);
  });

  test('keeps every link, and colours it too', () => {
    const tokens: AnnotationToken[] = [{ text: 'x: ' }, { text: 'Theme', target }, { text: ' = None' }];
    const highlighted = highlightTokens(
      tokens,
      highlightsFor([{ text: 'x: Theme = ' }, { text: 'None', style: LIGHT }]),
    );

    const linked = highlighted.filter((token) => token.target !== undefined);
    expect(linked.map((token) => token.text).join('')).toBe('Theme');
    expect(linked.every((token) => token.target === target)).toBe(true);
  });

  test('splits a token where the two segmentations disagree', () => {
    // One annotation token, two coloured pieces: the result has to be two.
    const highlighted = highlightTokens(
      [{ text: 'x = None' }],
      highlightsFor([{ text: 'x = ' }, { text: 'None', style: LIGHT }]),
    );

    expect(highlighted.length).toBeGreaterThan(1);
    expect(tokensText(highlighted)).toBe('x = None');
  });

  test('returns the tokens untouched when the sidecar has no entry', () => {
    const tokens: AnnotationToken[] = [{ text: 'x = 1' }];
    expect(highlightTokens(tokens, EMPTY_SIGNATURE_HIGHLIGHTS)).toBe(tokens);
  });

  test('returns the tokens untouched when the stored text disagrees', () => {
    // A sidecar left over from another dump must not shift every link one
    // character to the left.
    const tokens: AnnotationToken[] = [{ text: 'x = 1' }];
    const stale: SignatureHighlights = { texts: { 'x = 1': [{ text: 'y = 2' }] } };
    expect(highlightTokens(tokens, stale)).toBe(tokens);
  });

  test('returns empty input untouched', () => {
    expect(highlightTokens([], EMPTY_SIGNATURE_HIGHLIGHTS)).toEqual([]);
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

/**
 * The config-time pass, end to end against the fixture dump.
 *
 * This is the half that used to run at render time and silently do nothing, so
 * it is exercised through the sidecar it writes rather than through its return
 * value: a pass that writes nothing readable is the failure being guarded.
 */
describe('highlightSignaturesForPackage', () => {
  let workspace: string;
  let context: PydocsContext;
  let highlightsPath: string;

  beforeEach(async () => {
    clearCaches();
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-highlight-'));
    const dump = path.join(workspace, 'demopkg.json');
    await fs.copyFile(fixturePath('demopkg', 'dump.json'), dump);
    highlightsPath = path.join(workspace, 'highlights.json');

    context = createContext(normalizeConfig({ packages: [{ name: 'demopkg' }] }, workspace), {
      dumpPaths: new Map([['api/demopkg', dump]]),
      highlightsPaths: new Map([['api/demopkg', highlightsPath]]),
      siteBase: '',
      trailingSlash: 'always',
      starlight: true,
    });
  });

  afterEach(async () => {
    clearCaches();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  test('writes colours that the render-time half can actually apply', async () => {
    const { count } = await highlightSignaturesForPackage({
      context,
      base: 'api/demopkg',
      highlightsPath,
      themes: { light: 'github-light', dark: 'github-dark' },
    });
    expect(count).toBeGreaterThan(0);

    // Read it back the way a page render does, then colour a real signature
    // from the same model. Anything that breaks the text/key agreement between
    // the two halves fails here.
    const highlights = await getSignatureHighlights(context, 'api/demopkg');
    const model = await getModel(context, 'api/demopkg');
    const report = model.objectsByPath.get('demopkg.report.Report');
    expect(report).toBeDefined();

    const tokens = displaySignatureTokens(report as NonNullable<typeof report>);
    const highlighted = highlightTokens(tokens, highlights);

    expect(tokensText(highlighted)).toBe(tokensText(tokens));
    expect(highlighted.some((token) => token.style?.includes('--shiki-light') === true)).toBe(true);
    expect(highlighted.some((token) => token.style?.includes('--shiki-dark') === true)).toBe(true);
  });

  test('an unreadable sidecar costs colours, not the page', async () => {
    await fs.writeFile(highlightsPath, 'not json');
    expect(await getSignatureHighlights(context, 'api/demopkg')).toEqual(EMPTY_SIGNATURE_HIGHLIGHTS);
  });
});
