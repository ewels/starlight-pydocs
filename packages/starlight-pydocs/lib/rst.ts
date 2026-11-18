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

/** `.. name:: argument`, at the start of a line. Docutils matches names case-insensitively. */
const DIRECTIVE_PATTERN = /^\.\. ([a-z][a-z-]*)::[ \t]*(.*)$/i;

/** A directive option such as `:linenos:`, but not a body line opening with a role such as `:func:`x``. */
const OPTION_PATTERN = /^\s+:[\w-]+:(?:\s|$)/;

/** `` `text <url>`_ `` and the anonymous `` `text <url>`__ ``. */
const LINK_PATTERN = /`([^`<]*?)\s*<([^`<>\s]+)>`__?/g;

type DirectiveKind = 'admonition' | 'version' | 'deprecated' | 'code';

function directiveKind(name: string): DirectiveKind | undefined {
  if (name === 'admonition' || Object.hasOwn(ADMONITIONS, name)) return 'admonition';
  if (Object.hasOwn(VERSION_NOTES, name)) return 'version';
  if (name === 'deprecated') return 'deprecated';
  return CODE_DIRECTIVES.has(name) ? 'code' : undefined;
}

/**
 * Rewrite the RST in every docstring of a dump, in place, before anything reads
 * it, so section indices agree between the model and the prose.
 */
export function convertRst(dump: GriffeDump): GriffeDump {
  const visit = (object: GriffeObject): void => {
    const parsed = object.docstring?.parsed;
    if (object.docstring && Array.isArray(parsed)) object.docstring.parsed = parsed.flatMap(convertSection);
    for (const member of memberList(object)) visit(member);
  };
  for (const entry of Object.values(dump)) visit(entry);
  return dump;
}

/**
 * A text section splits into text, admonition and deprecated sections. Other
 * sections keep their shape: the prose in their entries is rewritten, but an
 * admonition directive there has no section to become and stays as it is.
 */
export function convertSection(section: DocstringSection): DocstringSection[] {
  if (section.kind === 'text') {
    if (typeof section.value !== 'string') return [section];
    if (!hasDirective(section.value)) return [{ ...section, value: rstLinksToMarkdown(section.value) }];
    return convertText(section.value, true);
  }
  const value: unknown = section.value;
  for (const item of Array.isArray(value) ? value : [value]) {
    if (Array.isArray(item) && item[0] === 'text' && typeof item[1] === 'string') {
      item[1] = convertProse(item[1]);
    } else if (typeof item === 'object' && item !== null && 'description' in item) {
      const entry = item as { description?: unknown };
      if (typeof entry.description === 'string') entry.description = convertProse(entry.description);
    }
  }
  return [section];
}

/** Version notes, code blocks and links rewritten as Markdown, in one prose string. */
export function convertProse(markdown: string): string {
  if (!hasDirective(markdown)) return rstLinksToMarkdown(markdown);
  const [converted] = convertText(markdown, false);
  return rstLinksToMarkdown(typeof converted?.value === 'string' ? converted.value : '');
}

function hasDirective(value: string): boolean {
  return /^\.\. [a-z]/im.test(value);
}

function joinParts(separator: string, ...parts: string[]): string {
  return parts.filter((part) => part !== '').join(separator);
}

/** A fence longer than any backtick run in the code it wraps. */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** With `split`, admonition and deprecated directives become sections of their own; without, they stay as text. */
function convertText(value: string, split: boolean): DocstringSection[] {
  const fences = fencedRanges(value);
  const lines = value.split('\n');
  const lineStarts: number[] = [];
  let lineStart = 0;
  for (const line of lines) {
    lineStarts.push(lineStart);
    lineStart += line.length + 1;
  }
  const out: DocstringSection[] = [];
  let text: string[] = [];

  const flush = (): void => {
    const joined = text.join('\n').trim();
    if (joined !== '') out.push({ kind: 'text', value: split ? rstLinksToMarkdown(joined) : joined });
    text = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const start = lineStarts[index] ?? 0;
    const inFence = fences.some((range) => range.start <= start && start < range.end);
    const match = inFence ? null : DIRECTIVE_PATTERN.exec(line);
    const name = (match?.[1] ?? '').toLowerCase();
    const kind = directiveKind(name);
    if (match === null || kind === undefined || (!split && (kind === 'admonition' || kind === 'deprecated'))) {
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
      const reason = joinParts(' ', rest.join(' '), body.trim());
      text.push(reason === '' ? `*${label}.*` : `*${label}:* ${reason}`, '');
    } else if (kind === 'code') {
      const fence = fenceFor(body);
      text.push(`${fence}${argument}`, body, fence, '');
    } else if (kind === 'deprecated') {
      flush();
      const description = convertProse(joinParts('\n\n', rest.join(' '), body.trim()));
      out.push({ kind: 'deprecated', value: { version, description } });
    } else {
      flush();
      const generic = name === 'admonition';
      const description = convertProse(generic ? body.trim() : joinParts('\n\n', argument, body.trim()));
      out.push({
        kind: 'admonition',
        title: (generic ? argument : ADMONITIONS[name]) ?? null,
        value: { annotation: generic ? 'note' : name, description },
      });
    }
  }

  flush();
  return out;
}

/** The indented lines after a directive, dedented, without its options or surrounding blank lines. */
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
  // Keep the first line's own indentation: in a code block it is meaningful.
  const body = block
    .map((line) => line.slice(indent))
    .join('\n')
    .replace(/^\s*\n/, '')
    .trimEnd();
  return { body, end };
}

/**
 * Rewrite RST hyperlinks as Markdown links. A link with no text shows its URL,
 * and a link to a named target (`<target_>`) only its text. Links inside code
 * are left alone.
 */
export function rstLinksToMarkdown(markdown: string): string {
  if (!markdown.includes('>`_')) return markdown;
  const code = codeRanges(markdown);
  return markdown.replace(LINK_PATTERN, (whole: string, text: string, url: string, offset: number) => {
    // The link's own backticks look like a code span that starts at `offset`; only
    // a code range that starts earlier and covers it means the link is quoted code.
    if (code.some((range) => range.start < offset && offset < range.end)) return whole;
    const label = text.trim();
    if (url.endsWith('_')) return label === '' ? whole : label;
    return `[${label === '' ? url : label}](${formatUrl(url)})`;
  });
}
