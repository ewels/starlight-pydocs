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

/** What starlight-codeblocks features the docstring Markdown should opt into. */
export interface CodeblocksMarkup {
  /** Language suffix for inline code, such as `py`; undefined when the site's inline highlighting is off. */
  inlineLanguage: string | undefined;
  /** Base of the package the docstrings belong to, so their code links to the same version's pages. */
  pydocsBase?: string | undefined;
}

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const CODE_SPAN = /(`+)(?!`)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/**
 * Make every fenced block `expandable`, tie it to `pydocsBase` and, when asked,
 * add a language suffix to inline code, so a site with starlight-codeblocks
 * collapses long examples, links them to the right version and colours inline
 * code with no configuration.
 *
 * ponytail: line-based, so a code span that wraps onto a second line stays plain.
 */
export function addCodeblocksMarkup(markdown: string, { inlineLanguage, pydocsBase }: CodeblocksMarkup): string {
  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const match = FENCE.exec(line);
      if (fence !== undefined) {
        if (match?.[2]?.startsWith(fence) === true && match[3]?.trim() === '') fence = undefined;
        return line;
      }
      if (match !== undefined && match !== null) {
        const [, indent = '', marker = '', info = ''] = match;
        fence = marker;
        let meta = info.trim() === '' ? 'text' : info.trimEnd();
        if (!/(^|\s)expandable\b/.test(meta)) meta += ' expandable';
        if (pydocsBase !== undefined && !/(^|\s)pydocsBase=/.test(meta)) meta += ` pydocsBase="${pydocsBase}"`;
        return `${indent}${marker}${meta}`;
      }
      if (inlineLanguage === undefined) return line;
      return line.replace(CODE_SPAN, (span, ticks: string, code: string) =>
        /\{:[\w+-]+\}$/.test(code) || code.endsWith(' ') ? span : `${ticks}${code}{:${inlineLanguage}}${ticks}`,
      );
    })
    .join('\n');
}
