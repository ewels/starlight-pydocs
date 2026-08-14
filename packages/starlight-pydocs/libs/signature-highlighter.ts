/**
 * Colouring signatures with Shiki, at `astro:config:done`.
 *
 * This runs in the config-time process on purpose (ARCHITECTURE.md decision 7,
 * the same reason docstring prose is rendered there). Astro tree-shakes Shiki's
 * bundled themes and languages out of the server bundle, so a highlighter built
 * inside the SSR graph cannot resolve a theme the host's own config never asked
 * for: it fails with "Theme 'github-light' is not included in this bundle", and
 * a Starlight site — whose prose code goes through Expressive Code, leaving
 * `markdown.shikiConfig` untouched — always asks for exactly such a theme. Here
 * the full bundle exists.
 *
 * The output is a sidecar keyed by signature text, read back at render time by
 * `lib/highlight.ts`. Keying by text rather than by object path means a
 * signature repeated across pages (an inherited member, a re-export) is
 * highlighted once.
 *
 * Shiki is reached through `@astrojs/markdown-remark`, an optional peer
 * dependency, and imported at the top level for the same reason
 * `docstring-renderer.ts` does it: Astro closes the Vite module runner that
 * loaded the config before integration hooks run, so a dynamic import started
 * later fails.
 */

import { writeAtomic } from '../lib/cache.ts';
import type { PydocsContext, ShikiThemes } from '../lib/context.ts';
import { getAnnotationResolver, getModel } from '../lib/data.ts';
import { errorMessage } from '../lib/errors.ts';
import type { AnnotationToken } from '../lib/expr.ts';
import { tokensText } from '../lib/expr.ts';
import type { ColouredPiece, SignatureHighlights } from '../lib/highlight.ts';
import type { PydocsLogger } from '../lib/logger.ts';
import { silentLogger } from '../lib/logger.ts';
import { displaySignatureTokens, overloadSignatureTokens } from '../lib/signature.ts';

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

/** One highlighter per theme pair, shared by every package in the process. */
const highlighters = new Map<string, Promise<Highlighter>>();

/**
 * Build (or reuse) the highlighter for a theme pair.
 *
 * @throws When Shiki is unreachable or the themes cannot be loaded. The caller
 *   reports it: a silent failure here is exactly what let the render-time
 *   version of this ship doing nothing at all.
 */
function getHighlighter(themes: ShikiThemes): Promise<Highlighter> {
  const key = JSON.stringify(themes);
  const existing = highlighters.get(key);
  if (existing !== undefined) return existing;

  const created = shikiModule.then(async (module) => {
    if (module === null) {
      throw new Error('@astrojs/markdown-remark is not installed');
    }
    const create = module.createShikiHighlighter as (options: unknown) => Promise<unknown>;
    return (await create({ themes, langs: ['python'] })) as Highlighter;
  });

  highlighters.set(key, created);
  return created;
}

/** Shiki's leaf text nodes, in order, each with the style of its own span. */
function flattenHast(node: HastNode, inherited?: string | undefined): ColouredPiece[] {
  if (node.type === 'text') return [{ text: node.value ?? '', style: inherited }];
  const own = node.properties?.style;
  const style = typeof own === 'string' && own.includes('--shiki') ? own : inherited;
  return (node.children ?? []).flatMap((child) => flattenHast(child, style));
}

/**
 * Every distinct signature text one package renders.
 *
 * Walks the documented objects rather than the pages, so an object reached only
 * through `<Autodoc>` is coloured too. Overloads are separate blocks with
 * separate text, so they are collected alongside.
 */
async function signatureTextsFor(context: PydocsContext, base: string): Promise<Set<string>> {
  const [model, resolver] = await Promise.all([getModel(context, base), getAnnotationResolver(context, base)]);
  const options = { resolver };
  const texts = new Set<string>();

  const add = (tokens: AnnotationToken[]): void => {
    const text = tokensText(tokens);
    if (text !== '') texts.add(text);
  };

  for (const doc of model.objectsByPath.values()) {
    add(displaySignatureTokens(doc, options));
    for (const overload of doc.overloads ?? []) add(overloadSignatureTokens(overload, doc, options));
  }

  return texts;
}

export interface HighlightSignaturesOptions {
  context: PydocsContext;
  /** Base of the package entry to colour. */
  base: string;
  /** Absolute path of the sidecar JSON to write. */
  highlightsPath: string;
  themes: ShikiThemes;
  logger?: PydocsLogger | undefined;
}

/**
 * Colour every signature of one package and write the sidecar.
 *
 * Always re-runs rather than reusing an existing sidecar: the colours depend on
 * the host's theme configuration, which can change without the dump changing,
 * and nothing in the dump's cache key would notice.
 *
 * @returns How many distinct signatures were coloured; zero when highlighting
 *   is unavailable, in which case signatures render uncoloured.
 */
export async function highlightSignaturesForPackage(options: HighlightSignaturesOptions): Promise<{ count: number }> {
  const logger = options.logger ?? silentLogger;
  const texts = await signatureTextsFor(options.context, options.base);

  let highlighter: Highlighter;
  try {
    highlighter = await getHighlighter(options.themes);
  } catch (cause) {
    // Worth a warning, not a failed build: an uncoloured signature still says
    // everything it needs to. Once per package, not once per signature.
    logger.warn(
      `could not syntax highlight the signatures of '/${options.base}': ${errorMessage(cause)}; ` +
        'they will render without colours',
    );
    await writeAtomic(options.highlightsPath, `${JSON.stringify({ texts: {} } satisfies SignatureHighlights)}\n`);
    return { count: 0 };
  }

  const highlights: SignatureHighlights = { texts: {} };
  for (const text of texts) {
    try {
      const coloured = flattenHast(await highlighter.codeToHast(text, 'python', { defaultColor: false }));
      // Shiki reproduces its input verbatim, but a grammar or transformer that
      // does not would silently shift every link, so the entry is dropped
      // rather than stored a character out of step.
      if (coloured.map((piece) => piece.text).join('') !== text) continue;
      highlights.texts[text] = coloured;
    } catch (cause) {
      logger.debug(`could not highlight a signature of '/${options.base}': ${errorMessage(cause)}`);
    }
  }

  await writeAtomic(options.highlightsPath, `${JSON.stringify(highlights)}\n`);
  const count = Object.keys(highlights.texts).length;
  logger.debug(`highlighted ${String(count)} signatures to ${options.highlightsPath}`);
  return { count };
}
