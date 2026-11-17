/**
 * reStructuredText markup that docstrings written for Sphinx carry into prose.
 *
 * Griffe parses docstring sections, but leaves RST directives and hyperlinks in
 * the text, where Markdown renders them as literal `.. note::` lines and
 * backticks. Two passes fix that:
 *
 * - `splitRstDirectives` runs once per dump, as it loads. It turns admonition
 *   and `deprecated` directives into the sections griffe produces for google
 *   `Note:` and `Deprecated:` blocks, so they render, badge and index exactly
 *   like those. Version notes and code blocks become Markdown in place.
 * - `rstLinksToMarkdown` runs over each prose string before rendering, like
 *   the cross-reference passes in `crossrefs.ts`.
 */

import { codeRanges, formatUrl } from './crossrefs.ts';
import type { DocstringSection, GriffeDump, GriffeObject } from './types.ts';
import { memberList } from './types.ts';

/** Admonition directives, by name, with the title to show when it is not the capitalised name. */
const ADMONITIONS: Record<string, string | undefined> = {
  note: undefined,
  warning: undefined,
  tip: undefined,
  hint: undefined,
  important: undefined,
  caution: undefined,
  attention: undefined,
  danger: undefined,
  error: undefined,
  todo: 'To do',
  seealso: 'See also',
};

const VERSION_NOTES: Record<string, string> = {
  versionadded: 'Added in version',
  versionchanged: 'Changed in version',
  versionremoved: 'Removed in version',
};

const CODE_DIRECTIVES = new Set(['code-block', 'code', 'sourcecode']);

/** `.. name:: argument`, at the start of a line. */
const DIRECTIVE_PATTERN = /^\.\. ([a-z][a-z-]*)::[ \t]*(.*)$/;

/** Opens or closes a fenced code block. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/** A directive option such as `:linenos:`, at the top of a directive body. */
const OPTION_PATTERN = /^\s+:[\w-]+:/;

/**
 * Rewrite the RST directives in every text section of a dump, in place.
 *
 * Runs before anything reads the dump, so section indices agree between the
 * model and the pre-rendered prose.
 */
export function splitRstDirectives(dump: GriffeDump): GriffeDump {
  const seen = new Set<GriffeObject>();
  const visit = (object: GriffeObject): void => {
    if (typeof object !== 'object' || object === null || seen.has(object)) return;
    seen.add(object);
    const parsed = object.docstring?.parsed;
    if (object.docstring && Array.isArray(parsed) && parsed.some(hasDirective)) {
      object.docstring.parsed = parsed.flatMap(splitSection);
    }
    for (const member of memberList(object)) visit(member);
  };
  for (const entry of Object.values(dump)) visit(entry);
  return dump;
}

function hasDirective(section: DocstringSection): boolean {
  return section.kind === 'text' && typeof section.value === 'string' && /^\.\. [a-z]/m.test(section.value);
}

/** One text section in, the text and directive sections it holds out. */
export function splitSection(section: DocstringSection): DocstringSection[] {
  if (!hasDirective(section)) return [section];

  const lines = (section.value as string).split('\n');
  const out: DocstringSection[] = [];
  let text: string[] = [];
  let fence: string | undefined;

  const flush = (): void => {
    const value = text.join('\n').trim();
    if (value !== '') out.push({ kind: 'text', value });
    text = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fenceMarker = FENCE_PATTERN.exec(line)?.[1];
    if (fence !== undefined) {
      if (fenceMarker !== undefined && fenceMarker.charAt(0) === fence.charAt(0)) fence = undefined;
      text.push(line);
      continue;
    }
    if (fenceMarker !== undefined) fence = fenceMarker;

    const match = fence === undefined ? DIRECTIVE_PATTERN.exec(line) : null;
    const name = match?.[1] ?? '';
    const argument = (match?.[2] ?? '').trim();
    const isAdmonition = name === 'admonition' || Object.hasOwn(ADMONITIONS, name);
    const isVersionNote = Object.hasOwn(VERSION_NOTES, name);
    if (match === null || !(isAdmonition || isVersionNote || name === 'deprecated' || CODE_DIRECTIVES.has(name))) {
      text.push(line);
      continue;
    }

    const { body, end } = directiveBody(lines, index + 1);
    index = end - 1;

    if (isVersionNote) {
      // Sphinx's own wording: `Added in version 2.0.`, or with a reason, `Changed in version 2.0: why`.
      const [version = '', ...rest] = argument.split(/\s+/);
      const reason = [rest.join(' '), body].filter((part) => part !== '').join(' ');
      text.push(
        `*${VERSION_NOTES[name] ?? ''} ${version}${reason === '' ? '.' : ':'}*${reason === '' ? '' : ` ${reason}`}`,
        '',
      );
    } else if (CODE_DIRECTIVES.has(name)) {
      text.push(`\`\`\`${argument}`, body, '```', '');
    } else if (name === 'deprecated') {
      const [version = '', ...rest] = argument.split(/\s+/);
      const description = [rest.join(' '), body].filter((part) => part !== '').join('\n\n');
      flush();
      out.push({ kind: 'deprecated', value: { version, description } });
    } else {
      flush();
      // `.. admonition:: Title` has a title of its own and no flavour.
      const generic = name === 'admonition';
      const title = generic ? argument : ADMONITIONS[name];
      const description =
        generic || argument === '' ? body : [argument, body].filter((part) => part !== '').join('\n\n');
      out.push({
        kind: 'admonition',
        title: title ?? null,
        value: { annotation: generic ? 'note' : name, description },
      });
    }
  }

  flush();
  return out;
}

/** The indented lines after a directive, dedented, without its options. */
function directiveBody(lines: string[], start: number): { body: string; end: number } {
  let end = start;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    end += 1;
  }
  const block = lines.slice(start, end);
  while (block.length > 0 && OPTION_PATTERN.test(block[0] ?? '')) block.shift();
  const indents = block.filter((line) => line.trim() !== '').map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);
  const body = block
    .map((line) => line.slice(indent))
    .join('\n')
    .trim();
  return { body, end };
}

/** `` `text <url>`_ `` and the anonymous `` `text <url>`__ ``. */
const LINK_PATTERN = /`([^`<]*?)\s*<([^`<>\s]+)>`__?/g;

/**
 * Rewrite RST hyperlinks as Markdown links. A link with no text shows its URL.
 * Links inside code are left alone.
 */
export function rstLinksToMarkdown(markdown: string): string {
  if (!markdown.includes('>`_')) return markdown;
  const code = codeRanges(markdown);
  return markdown.replace(LINK_PATTERN, (whole: string, text: string, url: string, offset: number) => {
    // The link's own backticks look like a code span that starts at `offset`; only
    // a code range that starts earlier and covers it means the link is quoted code.
    if (code.some((range) => range.start < offset && offset < range.end)) return whole;
    return `[${text.trim() === '' ? url : text.trim()}](${formatUrl(url)})`;
  });
}
