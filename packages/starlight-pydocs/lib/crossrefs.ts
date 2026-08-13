/**
 * mkdocstrings-style cross-references inside docstring prose.
 *
 * Docstrings written for mkdocstrings link to other objects with reference
 * syntax: `[Report][demopkg.report.Report]`, or `[demopkg.report.Report][]` for
 * the shorthand where the target doubles as the text. Markdown has no idea what
 * those targets mean, so the reference survives into the page as literal
 * brackets unless something rewrites it first.
 *
 * That something is `resolveCrossReferences`: a string-to-string pass run over
 * the raw Markdown before it reaches the host's processor (PLAN.md decision 7
 * rules out registering a plugin in that pipeline). It only rewrites a reference
 * whose target resolves to a URL, so a docstring that means `[a][b]` literally
 * keeps its brackets, and it leaves fenced code blocks, inline code spans and
 * targets that have a real Markdown reference definition alone.
 *
 * Resolution itself is the caller's: `createCrossReferenceResolver` builds the
 * documented order — this package's symbol index, then the other configured
 * packages', then the Sphinx inventories.
 */

import type { PackageModel } from './model.ts';
import { documentedPathFor } from './model.ts';
import { objectHref } from './paths.ts';

/** Resolves a cross-reference target to a URL, or returns undefined. */
export type CrossReferenceResolver = (target: string) => string | undefined;

export interface CrossReferenceResolverOptions {
  /** Models to search, in order. The rendered package comes first. */
  models: PackageModel[];
  /** The site's `base`, normalised ('' or '/prefix'). */
  siteBase: string;
  trailingSlash: 'always' | 'never' | 'ignore';
  /** Sphinx inventory lookup, for targets in other projects' documentation. */
  lookupExternal?: ((dottedPath: string) => string | undefined) | undefined;
}

/**
 * Build a resolver over a set of package models and the site's inventories.
 *
 * Hrefs are built exactly as the components build them (`objectHref` over the
 * symbol index), so a prose reference and a linked annotation to the same object
 * land on the same anchor.
 */
export function createCrossReferenceResolver(options: CrossReferenceResolverOptions): CrossReferenceResolver {
  const cache = new Map<string, string | undefined>();

  const lookup = (target: string): string | undefined => {
    for (const model of options.models) {
      const documented = documentedPathFor(model, target);
      const entry = documented === undefined ? undefined : model.symbolsByPath.get(documented);
      if (entry !== undefined) {
        return objectHref(options.siteBase, entry.pageSlug, entry.anchor, options.trailingSlash);
      }
    }
    return options.lookupExternal?.(target);
  };

  return (target) => {
    const trimmed = target.trim();
    if (trimmed === '') return undefined;
    if (cache.has(trimmed)) return cache.get(trimmed);
    const href = lookup(trimmed);
    cache.set(trimmed, href);
    return href;
  };
}

/** `[title][target]` and the `[target][]` shorthand. */
const REFERENCE_PATTERN = /\[([^\][]*)\]\[([^\][]*)\]/g;

/** A Markdown reference definition: `[label]: https://example.com`. */
const DEFINITION_PATTERN = /^ {0,3}\[([^\][]+)\]:\s+\S/;

/** Opens or closes a fenced code block. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface Range {
  start: number;
  end: number;
}

/**
 * Rewrite every resolvable cross-reference as a plain Markdown link.
 *
 * @param markdown - Raw docstring Markdown, as griffe emitted it.
 * @param resolve - Returns the URL for a target, or undefined to leave the
 *   reference exactly as written.
 */
export function resolveCrossReferences(markdown: string, resolve: CrossReferenceResolver): string {
  // Both forms contain `][`, so anything without it cannot hold a reference.
  if (!markdown.includes('][')) return markdown;

  const code = codeRanges(markdown);
  const defined = referenceDefinitions(markdown, code);

  let result = '';
  let cursor = 0;

  for (const match of markdown.matchAll(REFERENCE_PATTERN)) {
    const start = match.index;
    const title = match[1] ?? '';
    const target = (match[2] ?? '').trim();
    // The shorthand `[demopkg.Report][]` names its target in the text.
    const resolved = target === '' ? title.trim() : target;
    const text = title.trim() === '' ? resolved : title;

    // A real reference definition elsewhere in the same string means the author
    // wrote a Markdown reference link, not a cross-reference.
    if (defined.has(normaliseLabel(resolved))) continue;
    if (isEscaped(markdown, start)) continue;
    // The whole reference has to sit outside code: the title may contain a code
    // span (`[`Report`][demopkg.Report]` is the usual spelling), but a bracket
    // inside one is text, not syntax.
    if (overlapsCode(code, start, start + 1)) continue;
    const targetStart = start + (match[1] ?? '').length + 2;
    if (overlapsCode(code, targetStart, start + match[0].length)) continue;

    const href = resolve(resolved);
    if (href === undefined) continue;

    result += markdown.slice(cursor, start);
    result += `[${text}](${formatUrl(href)})`;
    cursor = start + match[0].length;
  }

  return cursor === 0 ? markdown : result + markdown.slice(cursor);
}

/** Wrap a URL in angle brackets when bare parentheses or spaces would break it. */
function formatUrl(href: string): string {
  return /[()\s]/.test(href) ? `<${href}>` : href;
}

function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isEscaped(markdown: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown.charAt(cursor) === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function overlapsCode(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((range) => range.start < end && start < range.end);
}

/**
 * Labels with a Markdown reference definition, so their references are left
 * alone. Definitions inside a code fence do not count.
 */
function referenceDefinitions(markdown: string, code: Range[]): Set<string> {
  const labels = new Set<string>();
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const match = DEFINITION_PATTERN.exec(line);
    if (match?.[1] !== undefined && !overlapsCode(code, offset, offset + line.length)) {
      labels.add(normaliseLabel(match[1]));
    }
    offset += line.length + 1;
  }
  return labels;
}

/**
 * Character ranges that are code: fenced blocks first (they swallow everything,
 * backticks included), then inline spans in what is left.
 *
 * Indented code blocks are deliberately not detected. Telling four-space code
 * from a list continuation needs a block parser, and griffe hands us dedented
 * prose where examples arrive fenced.
 */
function codeRanges(markdown: string): Range[] {
  const fences = fencedRanges(markdown);
  return [...fences, ...inlineCodeRanges(markdown, fences)].sort((a, b) => a.start - b.start);
}

function fencedRanges(markdown: string): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  let open: { marker: string; start: number } | undefined;

  for (const line of markdown.split('\n')) {
    const match = FENCE_PATTERN.exec(line);
    const marker = match?.[1];
    if (open === undefined) {
      if (marker !== undefined) open = { marker, start: offset };
    } else if (
      marker !== undefined &&
      marker.charAt(0) === open.marker.charAt(0) &&
      marker.length >= open.marker.length &&
      (match?.[2] ?? '').trim() === ''
    ) {
      ranges.push({ start: open.start, end: offset + line.length });
      open = undefined;
    }
    offset += line.length + 1;
  }

  // An unclosed fence runs to the end of the string, as CommonMark says.
  if (open !== undefined) ranges.push({ start: open.start, end: markdown.length });
  return ranges;
}

function inlineCodeRanges(markdown: string, fences: Range[]): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const char = markdown.charAt(cursor);
    if (char !== '`' || overlapsCode(fences, cursor, cursor + 1) || isEscaped(markdown, cursor)) {
      cursor += 1;
      continue;
    }

    const open = runLength(markdown, cursor);
    const closing = findClosingRun(markdown, cursor + open, open, fences);
    if (closing === undefined) {
      // No matching run: the backticks are literal text.
      cursor += open;
      continue;
    }
    ranges.push({ start: cursor, end: closing + open });
    cursor = closing + open;
  }

  return ranges;
}

function runLength(markdown: string, start: number): number {
  let length = 0;
  while (markdown.charAt(start + length) === '`') length += 1;
  return length;
}

/** Start index of the next run of exactly `length` backticks. */
function findClosingRun(markdown: string, from: number, length: number, fences: Range[]): number | undefined {
  let cursor = from;
  while (cursor < markdown.length) {
    if (markdown.charAt(cursor) !== '`' || overlapsCode(fences, cursor, cursor + 1)) {
      cursor += 1;
      continue;
    }
    const run = runLength(markdown, cursor);
    if (run === length) return cursor;
    cursor += run;
  }
  return undefined;
}
