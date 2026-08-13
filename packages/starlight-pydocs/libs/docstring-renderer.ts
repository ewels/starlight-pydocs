/**
 * Rendering docstring prose with the host project's markdown processor.
 *
 * The package depends on no markdown engine (ARCHITECTURE.md decision 7). Astro hands
 * integrations the resolved config, so `astroConfig.markdown.processor` is a live
 * `MarkdownProcessor` on current Astro: `createRenderer(shared)` returns
 * something that renders a string, and `astroConfig.markdown` *is* the shared
 * argument. The interface is duck-typed here rather than imported, so a
 * third-party processor works and no internal Astro package is a dependency.
 *
 * Astro 7.0.x has no `markdown.processor`. There, `@astrojs/markdown-remark`
 * (which astro itself depends on at that version) provides
 * `createMarkdownProcessor`. It is an optional peer dependency and is imported at
 * the top level, on purpose: Astro closes the Vite module runner that loaded the
 * config before integration hooks run, so a dynamic import started later fails
 * with "Vite module runner has been closed". Starlight does exactly this for the
 * same reason.
 */

import type { AstroConfig } from 'astro';

import { writeAtomic } from '../lib/cache.ts';
import type { CrossReferenceResolver } from '../lib/crossrefs.ts';
import { resolveCrossReferences } from '../lib/crossrefs.ts';
import { loadDump } from '../lib/data.ts';
import { assembleRenderedDocstrings, collectDocstringMarkdown } from '../lib/docstrings.ts';
import { errorMessage, PydocsError } from '../lib/errors.ts';
import type { PydocsLogger } from '../lib/logger.ts';
import { silentLogger } from '../lib/logger.ts';
import { sanitizeDocstringHtml } from '../lib/sanitize.ts';

const legacyMarkdownRemark = import('@astrojs/markdown-remark').catch(() => null);

/** The bit of `MarkdownProcessor` we use. */
interface MarkdownProcessorLike {
  name?: string;
  createRenderer(shared: unknown): Promise<MarkdownRendererLike>;
}

interface MarkdownRendererLike {
  render(content: string, options?: unknown): Promise<{ code: string }>;
}

/** Renders one Markdown string to HTML. */
export interface DocstringRenderer {
  /** Name of the engine behind it, for the build log. */
  name: string;
  render(markdown: string): Promise<string>;
}

function isProcessorLike(value: unknown): value is MarkdownProcessorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { createRenderer?: unknown }).createRenderer === 'function'
  );
}

/**
 * Build the renderer for a resolved Astro markdown configuration.
 *
 * @param markdown - `astroConfig.markdown`, which doubles as the shared options
 *   every processor's `createRenderer` takes.
 * @throws {PydocsError} When the host has neither a processor nor
 *   `@astrojs/markdown-remark` installed.
 */
export async function resolveDocstringRenderer(markdown: AstroConfig['markdown']): Promise<DocstringRenderer> {
  const processor: unknown = (markdown as { processor?: unknown } | undefined)?.processor;

  if (isProcessorLike(processor)) {
    const renderer = await processor.createRenderer(markdown);
    return {
      name: typeof processor.name === 'string' ? processor.name : 'markdown.processor',
      render: async (source) => (await renderer.render(source)).code,
    };
  }

  const legacy = await legacyMarkdownRemark;
  if (legacy !== null) {
    // The resolved config spells its optional fields `T | undefined`, which
    // `exactOptionalPropertyTypes` will not hand to a parameter spelled `T?`.
    // Same shape, two spellings; the value is exactly what the function wants.
    const shared = markdown as Parameters<typeof legacy.createMarkdownProcessor>[0];
    const renderer = await legacy.createMarkdownProcessor(shared);
    return {
      name: '@astrojs/markdown-remark',
      render: async (source) => (await renderer.render(source)).code,
    };
  }

  throw new PydocsError(
    [
      'starlight-pydocs: no markdown processor is available to render docstring prose.',
      'Astro 7.1 and later configure one by default (markdown.processor).',
      'On Astro 7.0.x, install @astrojs/markdown-remark, or set markdown.processor to',
      "satteri() from '@astrojs/markdown-satteri' or unified() from '@astrojs/markdown-remark'.",
    ].join('\n'),
  );
}

/** How many docstring strings are rendered concurrently. */
const RENDER_BATCH = 8;

export interface RenderDocstringsOptions {
  /** Absolute path of the griffe dump to read the prose from. */
  dumpPath: string;
  /** Absolute path of the sidecar JSON to write. */
  renderedPath: string;
  renderer: DocstringRenderer;
  /**
   * Resolves mkdocstrings-style `[title][target]` references. Without one the
   * references are left as written.
   */
  crossReferences?: CrossReferenceResolver | undefined;
  /**
   * Filter the rendered HTML through {@link sanitizeDocstringHtml}. Defaults to
   * on; `false` is the `sanitizeDocstrings: false` escape hatch.
   */
  sanitize?: boolean | undefined;
  logger?: PydocsLogger | undefined;
}

/**
 * Render every docstring string in a dump and write the sidecar.
 *
 * Always re-renders rather than reusing an existing sidecar: the output depends
 * on the host's markdown pipeline, which can change without the dump changing
 * (a new plugin, a different theme), and there is nothing in the dump's cache key
 * that would notice.
 */
export async function renderDocstringsForDump(options: RenderDocstringsOptions): Promise<{ count: number }> {
  const logger = options.logger ?? silentLogger;
  const items = collectDocstringMarkdown(await loadDump(options.dumpPath));
  const crossReferences = options.crossReferences;

  const html: string[] = [];
  for (let start = 0; start < items.length; start += RENDER_BATCH) {
    const batch = items.slice(start, start + RENDER_BATCH);
    html.push(
      ...(await Promise.all(
        batch.map(async (item) => {
          // Cross-references become ordinary Markdown links before the
          // processor sees them; nothing downstream knows they were special.
          const markdown =
            crossReferences === undefined ? item.markdown : resolveCrossReferences(item.markdown, crossReferences);
          try {
            const rendered = (await options.renderer.render(markdown)).trim();
            return options.sanitize === false ? rendered : sanitizeDocstringHtml(rendered);
          } catch (cause) {
            // One unrenderable docstring must not fail a build; the prose is
            // dropped and the object still documents its structure.
            logger.warn(`could not render a docstring of ${item.objectPath}: ${errorMessage(cause)}`);
            return '';
          }
        }),
      )),
    );
  }

  const rendered = assembleRenderedDocstrings(items, html);
  await writeAtomic(options.renderedPath, `${JSON.stringify(rendered)}\n`);
  logger.debug(`rendered ${String(items.length)} docstring strings to ${options.renderedPath}`);
  return { count: items.length };
}
