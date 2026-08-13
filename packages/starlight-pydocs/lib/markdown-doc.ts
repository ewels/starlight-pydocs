/**
 * Render the model as plain GitHub-flavoured Markdown.
 *
 * Two jobs: it feeds the `llms.txt` endpoint (decision 10 in PLAN.md), and it is
 * the golden format for the model's unit tests, where a single snapshot covers
 * ordering, provenance and docstring section handling at once.
 *
 * Docstring prose is passed through verbatim; it is already Markdown.
 */

import { annotationText } from './expr.ts';
import type { DocObject, MemberGroup, PackageModel, PageModel } from './model.ts';
import { overloadSignatureText, signatureText } from './signature.ts';
import type { StringOverrides, StringKey } from './strings.ts';
import { resolveLabel } from './strings.ts';
import type {
  DocstringNamedValue,
  DocstringSection,
  DocstringSectionAdmonition,
  DocstringSectionDeprecated,
  DocstringSectionExamples,
  DocstringSectionNamedValues,
  DocstringSectionReferences,
  DocstringSectionText,
  DocstringSectionThrown,
} from './types.ts';

export interface MarkdownDocOptions {
  /** Label overrides, e.g. from a Starlight translation table. */
  labels?: StringOverrides | undefined;
  /** Add `[View source]` links when the model resolved them. Default `false`. */
  includeSource?: boolean | undefined;
}

/** Render one module page. */
export function renderPageMarkdown(page: PageModel, options: MarkdownDocOptions = {}): string {
  const lines: string[] = [];
  renderObject(page.object, 1, lines, options);

  if (page.children.length > 0) {
    lines.push(`**${label('modules', options)}**`, '');
    for (const child of page.children) lines.push(`- \`${child}\``);
    lines.push('');
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

/** Render every page of a package, in navigation order. */
export function renderPackageMarkdown(model: PackageModel, options: MarkdownDocOptions = {}): string {
  return `${model.pages.map((page) => renderPageMarkdown(page, options).trim()).join('\n\n---\n\n')}\n`;
}

function label(key: StringKey, options: MarkdownDocOptions): string {
  return resolveLabel(key, options.labels);
}

function renderObject(doc: DocObject, depth: number, lines: string[], options: MarkdownDocOptions): void {
  lines.push(`${'#'.repeat(Math.min(depth, 6))} ${doc.path}`, '');

  const badges = objectBadges(doc, options);
  if (badges.length > 0) lines.push(badges.join(' · '), '');

  if (doc.kind !== 'module') {
    for (const overload of doc.overloads ?? []) {
      lines.push('```python', `@overload`, overloadSignatureText(overload, doc), '```', '');
    }
    lines.push('```python', signatureText(doc, { qualified: false }), '```', '');
  }

  if (doc.bases !== undefined && doc.bases.length > 0) {
    const bases = doc.bases.map((base) => `\`${base.path ?? base.text}\``).join(', ');
    lines.push(`${label('bases', options)}: ${bases}`, '');
  }

  if (doc.inheritedFrom !== undefined) {
    lines.push(`${label('inheritedFrom', options)}: \`${doc.inheritedFrom}\``, '');
  }
  if (doc.reexportedFrom !== undefined) {
    lines.push(`${label('reexportedFrom', options)}: \`${doc.reexportedFrom}\``, '');
  }
  if (doc.externalTargetPath !== undefined) {
    lines.push(`${label('aliasOf', options)}: \`${doc.externalTargetPath}\``, '');
  }
  if (doc.deprecated !== undefined) {
    pushDeprecation(doc.deprecated.version, doc.deprecated.description, lines, options);
  }

  for (const section of doc.docstring?.sections ?? []) {
    renderSection(section, lines, options);
  }

  if (options.includeSource === true && doc.source?.href !== undefined) {
    lines.push(`[${label('viewSource', options)}](${doc.source.href})`, '');
  }

  for (const group of doc.groups) {
    renderGroup(group, depth, lines, options);
  }
}

/** The deprecation line, written the same way for an object and for a section. */
function pushDeprecation(
  version: string | undefined,
  description: string | undefined,
  lines: string[],
  options: MarkdownDocOptions,
): void {
  const detail = [version, description].filter((part) => part !== undefined).join(' — ');
  lines.push(`**${label('deprecated', options)}**${detail === '' ? '' : `: ${detail}`}`, '');
}

function renderGroup(group: MemberGroup, depth: number, lines: string[], options: MarkdownDocOptions): void {
  // Submodules are pages of their own; the parent page only lists them.
  if (group.id === 'modules') return;
  for (const member of group.members) {
    renderObject(member, depth + 1, lines, options);
  }
}

function objectBadges(doc: DocObject, options: MarkdownDocOptions): string[] {
  const badges: string[] = [];
  const kindKey = kindLabelKey(doc);
  if (kindKey !== undefined) badges.push(`*${label(kindKey, options)}*`);
  if (doc.addedIn !== undefined) badges.push(`*${label('addedIn', options)} ${doc.addedIn}*`);
  for (const { key, raw } of labelBadges(doc)) {
    badges.push(`*${key === undefined ? raw : label(key, options)}*`);
  }
  return badges;
}

/** One griffe label to badge: its translation key, or the raw label. */
export interface LabelBadge {
  key: StringKey | undefined;
  raw: string;
}

/**
 * The griffe labels an object should be badged with.
 *
 * Shared with the HTML renderer so both name the same set: the label the kind
 * badge already carries is dropped, so a property is not badged `property` twice.
 */
export function labelBadges(doc: DocObject): LabelBadge[] {
  const kindKey = kindLabelKey(doc);
  const badges: LabelBadge[] = [];
  for (const raw of doc.labels) {
    const key = labelKeyFor(raw);
    if (key !== undefined && key === kindKey) continue;
    badges.push({ key, raw });
  }
  return badges;
}

/** Exported so the components label badges exactly as the Markdown renderer does. */
export function kindLabelKey(doc: DocObject): StringKey | undefined {
  switch (doc.kind) {
    case 'module':
      return 'kindModule';
    case 'class':
      return 'kindClass';
    case 'function':
      return doc.parentKind === 'class' ? 'kindMethod' : 'kindFunction';
    case 'attribute':
      return doc.labels.includes('property') ? 'kindProperty' : 'kindAttribute';
    case 'alias':
      return 'kindAlias';
  }
}

const LABEL_KEYS: Record<string, StringKey> = {
  classmethod: 'labelClassmethod',
  staticmethod: 'labelStaticmethod',
  async: 'labelAsync',
  abstractmethod: 'labelAbstract',
  cached: 'labelCached',
  'read-only': 'labelReadOnly',
  writable: 'labelWritable',
  'instance-attribute': 'labelInstanceAttribute',
  'class-attribute': 'labelClassAttribute',
  'module-attribute': 'labelModuleAttribute',
  'pydantic-model': 'labelPydanticModel',
  'pydantic-field': 'labelPydanticField',
  'pydantic-validator': 'labelPydanticValidator',
  property: 'kindProperty',
};

/** The `STRINGS` key for a raw griffe label, when we have a translation for it. */
function labelKeyFor(raw: string): StringKey | undefined {
  return LABEL_KEYS[raw];
}

/**
 * The `STRINGS` key for a section heading.
 *
 * Griffe's section kinds double as string keys wherever the two spell a name the
 * same way, so only the multi-word kinds need mapping.
 */
function headingKey(kind: StringKey | 'other parameters' | 'type parameters' | 'type aliases'): StringKey {
  switch (kind) {
    case 'other parameters':
      return 'otherParameters';
    case 'type parameters':
      return 'typeParameters';
    // A list of type aliases is shown under the modules heading.
    case 'type aliases':
      return 'modules';
    default:
      return kind;
  }
}

function renderSection(section: DocstringSection, lines: string[], options: MarkdownDocOptions): void {
  switch (section.kind) {
    case 'text': {
      const value = (section as DocstringSectionText).value;
      if (typeof value === 'string' && value.trim() !== '') lines.push(value.trim(), '');
      return;
    }

    case 'parameters':
    case 'other parameters':
    case 'attributes':
    case 'type parameters': {
      // Parameters and attributes are the sections that carry default values.
      renderNamedValues(section as DocstringSectionNamedValues, headingKey(section.kind), lines, options, true);
      return;
    }

    case 'returns':
    case 'yields':
    case 'receives': {
      renderNamedValues(section as DocstringSectionNamedValues, headingKey(section.kind), lines, options, false);
      return;
    }

    case 'raises':
    case 'warns': {
      const entries = (section as DocstringSectionThrown).value;
      if (!Array.isArray(entries) || entries.length === 0) return;
      lines.push(`**${label(headingKey(section.kind), options)}**`, '');
      for (const entry of entries) {
        const type = annotationText(entry.annotation);
        lines.push(`- ${type === '' ? '' : `\`${type}\` — `}${(entry.description ?? '').trim()}`);
      }
      lines.push('');
      return;
    }

    case 'examples': {
      const pairs = (section as DocstringSectionExamples).value;
      if (!Array.isArray(pairs) || pairs.length === 0) return;
      lines.push(`**${label('examples', options)}**`, '');
      for (const pair of pairs) {
        const [kind, value] = pair;
        if (typeof value !== 'string') continue;
        // Doctest blocks arrive as `examples`; prose arrives as `text`.
        if (kind === 'text') lines.push(value.trim(), '');
        else lines.push('```pycon', value.trim(), '```', '');
      }
      return;
    }

    case 'admonition': {
      const value = (section as DocstringSectionAdmonition).value;
      // The deprecation line above already carries this content.
      if (value?.annotation === 'deprecated') return;
      const title =
        typeof section.title === 'string' && section.title !== '' ? section.title : annotationText(value?.annotation);
      lines.push(`> **${title}**`, '>');
      for (const line of (value?.description ?? '').trim().split('\n')) {
        lines.push(`> ${line}`);
      }
      lines.push('');
      return;
    }

    case 'deprecated': {
      const value = (section as DocstringSectionDeprecated).value;
      pushDeprecation(value?.version, value?.description, lines, options);
      return;
    }

    case 'functions':
    case 'classes':
    case 'modules':
    case 'type aliases': {
      const entries = (section as DocstringSectionReferences).value;
      if (!Array.isArray(entries) || entries.length === 0) return;
      lines.push(`**${label(headingKey(section.kind), options)}**`, '');
      for (const entry of entries) {
        lines.push(`- \`${entry.name ?? ''}\` — ${(entry.description ?? '').trim()}`);
      }
      lines.push('');
      return;
    }

    default:
      // Unknown section kinds are skipped rather than guessed at.
      return;
  }
}

function renderNamedValues(
  section: DocstringSectionNamedValues,
  heading: StringKey,
  lines: string[],
  options: MarkdownDocOptions,
  withDefaults: boolean,
): void {
  const entries = section.value;
  if (!Array.isArray(entries) || entries.length === 0) return;
  lines.push(`**${label(heading, options)}**`, '');
  for (const entry of entries) {
    lines.push(`- ${namedValueLine(entry, options, withDefaults)}`);
  }
  lines.push('');
}

function namedValueLine(entry: DocstringNamedValue, options: MarkdownDocOptions, withDefaults: boolean): string {
  const parts: string[] = [];
  if (entry.name !== undefined && entry.name !== '') parts.push(`\`${entry.name}\``);
  const type = annotationText(entry.annotation);
  if (type !== '') parts.push(`(\`${type}\`)`);
  if (withDefaults && entry.value !== undefined && entry.value !== null) {
    const defaultText = annotationText(entry.value);
    if (defaultText !== '') parts.push(`(${label('default', options)}: \`${defaultText}\`)`);
  }
  const description = (entry.description ?? '').trim().replace(/\n/g, ' ');
  return `${parts.join(' ')}${parts.length > 0 && description !== '' ? ' — ' : ''}${description}`;
}
