/**
 * Shiki colours for signatures, without losing the cross-reference links.
 *
 * A signature arrives as {@link AnnotationToken}s: flat text, some of it
 * carrying a resolved link target. Shiki produces its own segmentation of the
 * same characters, each piece coloured. Neither segmentation nests inside the
 * other — a linked name can be one Shiki token, part of one, or span two — so
 * the two are zipped character by character and the result carries both.
 *
 * Colours come out as `--shiki-light` / `--shiki-dark` custom properties
 * (`defaultColor: false`), and `styles.css` picks the one matching the reader's
 * colour scheme. Links keep their own colour: `.pyd-type` wins over the
 * variable, so a highlighted signature still shows at a glance what is
 * clickable.
 *
 * Highlighting is best-effort. Shiki is reached through
 * `@astrojs/markdown-remark`, an optional peer dependency, and the import is
 * started at module load for the same reason `libs/docstring-renderer.ts` does
 * it: a dynamic import begun later can outlive the Vite module runner. If the
 * import fails, the grammar is missing or the round trip does not reproduce the
 * source exactly, the tokens come back exactly as they went in.
 */

import type { ShikiThemes } from './context.ts';
import type { AnnotationToken } from './expr.ts';
import { tokensText } from './expr.ts';

const shikiModule = import('@astrojs/markdown-remark/shiki').catch(() => null);

/** The slice of Shiki's HAST output this module reads. */
interface HastNode {
  type?: string;
  value?: string;
  properties?: { style?: unknown };
  children?: HastNode[];
}

interface Highlighter {
  codeToHast(code: string, lang: string, options?: unknown): Promise<HastNode> | HastNode;
}

/** One highlighter per theme pair, shared by every page in the process. */
const highlighters = new Map<string, Promise<Highlighter | null>>();

function getHighlighter(themes: ShikiThemes): Promise<Highlighter | null> {
  const key = JSON.stringify(themes);
  const existing = highlighters.get(key);
  if (existing !== undefined) return existing;

  const created = shikiModule
    .then(async (module) => {
      if (module === null) return null;
      const create = module.createShikiHighlighter as (options: unknown) => Promise<unknown>;
      return (await create({ themes, langs: ['python'] })) as Highlighter;
    })
    .catch(() => null);

  highlighters.set(key, created);
  return created;
}

/**
 * Recolour a signature's tokens with the host's Shiki themes.
 *
 * @param tokens - The signature, already line-broken. Returned unchanged when
 *   highlighting is unavailable, so callers need no fallback of their own.
 */
export async function highlightTokens(tokens: AnnotationToken[], themes: ShikiThemes): Promise<AnnotationToken[]> {
  const text = tokensText(tokens);
  if (text === '') return tokens;

  const highlighter = await getHighlighter(themes);
  if (highlighter === null) return tokens;

  try {
    const hast = await highlighter.codeToHast(text, 'python', { defaultColor: false });
    const coloured = flattenHast(hast);
    // Shiki reproduces its input verbatim, but a grammar or transformer that
    // does not would silently shift every link. Cheaper to check than to debug.
    if (coloured.map((piece) => piece.text).join('') !== text) return tokens;
    return zip(tokens, coloured);
  } catch {
    return tokens;
  }
}

interface ColouredPiece {
  text: string;
  style: string | undefined;
}

/** Shiki's leaf text nodes, in order, each with the style of its own span. */
function flattenHast(node: HastNode, inherited?: string | undefined): ColouredPiece[] {
  if (node.type === 'text') return [{ text: node.value ?? '', style: inherited }];
  const own = node.properties?.style;
  const style = typeof own === 'string' && own.includes('--shiki') ? own : inherited;
  return (node.children ?? []).flatMap((child) => flattenHast(child, style));
}

/**
 * Zip the two segmentations of the same text into one.
 *
 * Each step emits the shorter of the two remaining runs, so every piece of the
 * result sits inside exactly one annotation token and one Shiki token, and can
 * therefore carry the link of the first and the colour of the second.
 */
function zip(tokens: AnnotationToken[], coloured: ColouredPiece[]): AnnotationToken[] {
  const out: AnnotationToken[] = [];
  let tokenIndex = 0;
  let colourIndex = 0;
  let tokenOffset = 0;
  let colourOffset = 0;

  while (tokenIndex < tokens.length && colourIndex < coloured.length) {
    const token = tokens[tokenIndex] as AnnotationToken;
    const piece = coloured[colourIndex] as ColouredPiece;
    const length = Math.min(token.text.length - tokenOffset, piece.text.length - colourOffset);

    // A zero-length run means one side has an empty token; step past it rather
    // than spinning on it.
    if (length > 0) {
      out.push({
        text: token.text.slice(tokenOffset, tokenOffset + length),
        ...(token.target === undefined ? {} : { target: token.target }),
        ...(piece.style === undefined ? {} : { style: piece.style }),
      });
    }

    tokenOffset += length;
    colourOffset += length;
    if (tokenOffset >= token.text.length) {
      tokenIndex += 1;
      tokenOffset = 0;
    }
    if (colourOffset >= piece.text.length) {
      colourIndex += 1;
      colourOffset = 0;
    }
  }

  return out;
}
