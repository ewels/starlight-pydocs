/**
 * String work around docstring prose. No markdown engine lives here.
 *
 * The package renders docstring Markdown through whatever processor the host
 * project has configured, and it depends on neither engine (ARCHITECTURE.md decision 7).
 * Resolving and calling that processor is Astro glue, so it lives in
 * `libs/docstring-renderer.ts`; the pieces that are pure string manipulation
 * live here, where they can be unit tested without an engine at all.
 */

/** Matches HTML that is a single paragraph and nothing else. */
const SINGLE_PARAGRAPH = /^<p>([\s\S]*)<\/p>$/;

/**
 * Unwrap rendered HTML for somewhere a block element would be wrong: a table
 * cell, a definition term, a badge.
 *
 * Multi-paragraph input keeps its block markup. Unwrapping only the
 * single-paragraph case is what makes this safe to use for docstring
 * descriptions of unknown length.
 */
export function unwrapParagraph(html: string): string {
  const trimmed = html.trim();
  const single = SINGLE_PARAGRAPH.exec(trimmed);
  return single?.[1] !== undefined && !single[1].includes('<p>') ? single[1] : trimmed;
}

/**
 * Prepare a doctest block for rendering by fencing it.
 *
 * Griffe hands us `examples` sections as raw `>>>` transcripts with no fence, so
 * the fence is ours to add. `python` rather than mkdocstrings' `pycon`: no
 * Python-console grammar ships in the Shiki bundles these processors use, and
 * `python` highlights doctest transcripts correctly. Text that is already fenced
 * is left alone.
 */
export function prepareDoctestMarkdown(example: string): string {
  const trimmed = example.trim();
  if (trimmed === '') return '';
  if (/^(```|~~~)/.test(trimmed)) return trimmed;
  return `\`\`\`python\n${trimmed}\n\`\`\``;
}
