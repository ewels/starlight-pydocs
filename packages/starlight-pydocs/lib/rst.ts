/** reStructuredText directives and hyperlinks, which griffe leaves in docstring prose as raw text. */

import { codeRanges, fencedRanges, formatUrl } from './crossrefs.ts';
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

/** A directive option such as `:linenos:`, at the top of a directive body. */
const OPTION_PATTERN = /^\s+:[\w-]+:/;

/** `` `text <url>`_ `` and the anonymous `` `text <url>`__ ``. */
export const LINK_PATTERN = /`([^`<]*?)\s*<([^`<>\s]+)>`__?/g;

type DirectiveKind = 'admonition' | 'version' | 'deprecated' | 'code';

function directiveKind(name: string): DirectiveKind | undefined {
  if (name === 'admonition' || Object.hasOwn(ADMONITIONS, name)) return 'admonition';
  if (Object.hasOwn(VERSION_NOTES, name)) return 'version';
  if (name === 'deprecated') return 'deprecated';
  return CODE_DIRECTIVES.has(name) ? 'code' : undefined;
}

/**
 * Rewrite the RST directives in every text section of a dump, in place, before
 * anything reads it, so section indices agree between the model and the prose.
 */
export function splitRstDirectives(dump: GriffeDump): GriffeDump {
  const visit = (object: GriffeObject): void => {
    const parsed = object.docstring?.parsed;
    if (object.docstring && Array.isArray(parsed)) object.docstring.parsed = parsed.flatMap(splitSection);
    for (const member of memberList(object)) visit(member);
  };
  for (const entry of Object.values(dump)) visit(entry);
  return dump;
}

function joinParts(separator: string, ...parts: string[]): string {
  return parts.filter((part) => part !== '').join(separator);
}

/** One text section in, the text and directive sections it holds out. */
export function splitSection(section: DocstringSection): DocstringSection[] {
  if (section.kind !== 'text' || typeof section.value !== 'string' || !/^\.\. [a-z]/m.test(section.value)) {
    return [section];
  }

  const fences = fencedRanges(section.value);
  const lines = section.value.split('\n');
  const out: DocstringSection[] = [];
  let text: string[] = [];
  const lineStarts: number[] = [];
  let lineStart = 0;
  for (const line of lines) {
    lineStarts.push(lineStart);
    lineStart += line.length + 1;
  }

  const flush = (): void => {
    const value = text.join('\n').trim();
    if (value !== '') out.push({ kind: 'text', value });
    text = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const start = lineStarts[index] ?? 0;
    const inFence = fences.some((range) => range.start <= start && start < range.end);
    const match = inFence ? null : DIRECTIVE_PATTERN.exec(line);
    const name = match?.[1] ?? '';
    const kind = directiveKind(name);
    if (match === null || kind === undefined) {
      text.push(line);
      continue;
    }

    const argument = (match[2] ?? '').trim();
    const { body, end } = directiveBody(lines, index + 1);
    index = end - 1;
    const [version = '', ...rest] = argument.split(/\s+/);

    if (kind === 'version') {
      // Sphinx's own wording: `Added in version 2.0.`, or with a reason, `Changed in version 2.0: why`.
      const label = `${VERSION_NOTES[name] ?? ''} ${version}`;
      const reason = joinParts(' ', rest.join(' '), body);
      text.push(reason === '' ? `*${label}.*` : `*${label}:* ${reason}`, '');
    } else if (kind === 'code') {
      text.push(`\`\`\`${argument}`, body, '```', '');
    } else if (kind === 'deprecated') {
      flush();
      out.push({ kind: 'deprecated', value: { version, description: joinParts('\n\n', rest.join(' '), body) } });
    } else {
      flush();
      const generic = name === 'admonition';
      out.push({
        kind: 'admonition',
        title: (generic ? argument : ADMONITIONS[name]) ?? null,
        value: { annotation: generic ? 'note' : name, description: generic ? body : joinParts('\n\n', argument, body) },
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
  const indents = block.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);
  const body = block
    .map((line) => line.slice(indent))
    .join('\n')
    .trim();
  return { body, end };
}

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
