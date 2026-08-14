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
 * Nothing here runs Shiki. The colours are computed at `astro:config:done` by
 * `libs/signature-highlighter.ts` and read back from a sidecar
 * (ARCHITECTURE.md decision 7): a highlighter built inside the SSR graph cannot
 * resolve a theme the host's own config never asked for, because Astro
 * tree-shakes Shiki's bundled themes out of that bundle. This module is the
 * render-time half — a lookup and a zip, both pure.
 *
 * Keys are the signature text itself, so a signature repeated across pages
 * (an inherited member, a re-export) is stored and coloured once.
 */

import type { AnnotationToken } from './expr.ts';
import { tokensText } from './expr.ts';

/** One run of text with the inline `--shiki-*` style Shiki gave it. */
export interface ColouredPiece {
  text: string;
  style?: string | undefined;
}

/** The sidecar: coloured pieces per signature text. */
export interface SignatureHighlights {
  texts: Record<string, ColouredPiece[]>;
}

export const EMPTY_SIGNATURE_HIGHLIGHTS: SignatureHighlights = { texts: {} };

/**
 * Recolour a signature's tokens from the pre-rendered sidecar.
 *
 * @param tokens - The signature, already line-broken.
 * @returns The same text, carrying both links and colours. Returned unchanged
 *   when the sidecar has no entry for it, so callers need no fallback: an
 *   uncoloured signature is the worst case, never a missing one.
 */
export function highlightTokens(tokens: AnnotationToken[], highlights: SignatureHighlights): AnnotationToken[] {
  const text = tokensText(tokens);
  if (text === '') return tokens;

  const coloured = highlights.texts[text];
  if (coloured === undefined || coloured.length === 0) return tokens;

  // The sidecar is keyed by the text, so this can only disagree if the file was
  // written for a different dump. Cheaper to check than to debug.
  if (coloured.map((piece) => piece.text).join('') !== text) return tokens;

  return zip(tokens, coloured);
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
