/**
 * Normalise a griffe dump into the model the renderers consume.
 *
 * Everything expensive or fiddly happens here, once per dump: alias resolution,
 * member filtering, inheritance with provenance, the page plan and the symbol
 * index. Components then render without policy decisions of their own.
 *
 * Two rules are worth stating because they are choices rather than
 * consequences:
 *
 * 1. `__all__` defines the *member* surface of a module, but not its navigation.
 *    Submodules are page-eligible whether or not they appear in `__all__`
 *    (private ones excluded), because a package that exports a curated surface
 *    from its `__init__` still wants its modules documented.
 * 2. Objects re-exported from elsewhere are documented at *both* paths, exactly
 *    as mkdocstrings does; the re-export records where the definition lives.
 */

import path from 'node:path';

import type { NormalisedFilters, NormalisedMembers, NormalisedSourceLink } from './config.ts';
import { formatSourceLink } from './config.ts';
import { PydocsError } from './errors.ts';
import type { AnnotationResolver } from './expr.ts';
import { createAnnotationResolver, expressionToPath } from './expr.ts';
import { isInside, matchesDottedGlob, moduleSlug, parentPath, shortName } from './paths.ts';
import type {
  DocstringSection,
  DocstringSectionAdmonition,
  DocstringSectionDeprecated,
  DocstringSectionText,
  ExprOrString,
  GriffeAlias,
  GriffeClass,
  GriffeDump,
  GriffeFunction,
  GriffeObject,
  GriffeParent,
} from './types.ts';
import { hasMembers } from './types.ts';

export type DocKind = 'module' | 'class' | 'function' | 'attribute' | 'alias';

/** Groups a renderer emits, in the order they should appear. */
export type MemberGroupId = 'attributes' | 'properties' | 'classes' | 'functions' | 'methods' | 'modules';

const GROUP_ORDER: MemberGroupId[] = ['attributes', 'properties', 'classes', 'functions', 'methods', 'modules'];

export interface MemberGroup {
  /** Also the `STRINGS` key for the group heading. */
  id: MemberGroupId;
  members: DocObject[];
}

export interface DocDocstring {
  /** Raw docstring text, indentation stripped by griffe. */
  value: string;
  /** Structured sections; empty when griffe ran without `-d`. */
  sections: DocstringSection[];
}

export interface DocDeprecation {
  version: string | undefined;
  description: string | undefined;
}

export interface DocSource {
  /** Path of the file, relative to the griffe working directory. */
  file: string | undefined;
  startLine: number | undefined;
  endLine: number | undefined;
  /** Resolved URL, from the configured template or from griffe's own `source_link`. */
  href: string | undefined;
}

export interface DocBase {
  /** Text to display for the base class. */
  text: string;
  /** Dotted path when the base resolves inside the documented package. */
  path: string | undefined;
  /** The raw expression, so renderers can link generic bases token by token. */
  expression: ExprOrString;
}

export interface DocObject {
  /** Dotted path this object is documented at; also its heading anchor. */
  path: string;
  /** Dotted path griffe found the definition at. Differs for re-exports and inherited members. */
  canonicalPath: string;
  name: string;
  kind: DocKind;
  /** Griffe labels: `property`, `classmethod`, `pydantic-model`, … */
  labels: string[];
  /** The raw griffe object, with aliases already resolved to their target. */
  object: GriffeObject;
  docstring: DocDocstring | undefined;
  /** First line of the docstring as plain text; empty when undocumented. */
  summary: string;
  deprecated: DocDeprecation | undefined;
  /** Kind of the object this one is a member of; undefined for the package root. */
  parentKind: 'module' | 'class' | undefined;
  /** Filtered members in render order. */
  members: DocObject[];
  /** The same members, bucketed for rendering. */
  groups: MemberGroup[];
  /** Module the definition lives in, when this object is a re-export. */
  reexportedFrom: string | undefined;
  /** Class the member was inherited from. */
  inheritedFrom: string | undefined;
  /** Target path of an alias that could not be resolved inside the package. */
  externalTargetPath: string | undefined;
  /** Declared base classes (classes only). */
  bases: DocBase[] | undefined;
  /** C3 linearisation over resolvable bases, starting with this class. */
  mro: string[] | undefined;
  /** Base classes that could not be resolved, for display only. */
  unresolvedBases: string[] | undefined;
  /** `@typing.overload` signatures, when the dump carries them. */
  overloads: GriffeFunction[] | undefined;
  source: DocSource | undefined;
  /** Slug of the page this object is rendered on. */
  pageSlug: string;
}

export interface PageHeading {
  /** 2 for top-level members, 3 for members of a class. */
  depth: number;
  /** The dotted object path, matching the rendered heading id. */
  slug: string;
  /** Short name, as shown in the table of contents. */
  text: string;
}

export interface PageModel {
  /** URL slug without leading or trailing slashes. */
  slug: string;
  /** Dotted module path, used as the page title. */
  title: string;
  modulePath: string;
  /** The module rendered on this page. */
  object: DocObject;
  headings: PageHeading[];
  /** Dotted paths of child module pages. */
  children: string[];
  /** Dotted path of the parent module page. */
  parent: string | undefined;
}

export interface SymbolIndexEntry {
  path: string;
  kind: DocKind;
  pageSlug: string;
  /** Heading anchor on that page; empty for the page's own module. */
  anchor: string;
  /** First docstring line, markdown stripped. */
  brief: string;
}

export interface PackageModel {
  name: string;
  base: string;
  /** The package's root module. */
  root: DocObject;
  pages: PageModel[];
  pagesBySlug: Map<string, PageModel>;
  /** Every documented object, keyed by documented path. */
  objectsByPath: Map<string, DocObject>;
  symbols: SymbolIndexEntry[];
  symbolsByPath: Map<string, SymbolIndexEntry>;
  /** Name lookup tables per module/class scope, for annotation resolution. */
  scopes: Map<string, Map<string, string>>;
  /** Non-fatal problems worth surfacing in the build log. */
  warnings: string[];
}

export interface ModelOptions {
  packageName: string;
  /** URL base for the package's pages, without leading or trailing slashes. */
  base: string;
  members: NormalisedMembers;
  filters: NormalisedFilters;
  sourceLink: NormalisedSourceLink | undefined;
}

/** Build the normalised model for one package. */
export function buildModel(dump: GriffeDump, options: ModelOptions): PackageModel {
  const root = dump[options.packageName];
  if (root === undefined) {
    const available = Object.keys(dump);
    throw new PydocsError(
      `starlight-pydocs: the dump does not contain '${options.packageName}'` +
        (available.length > 0 ? `; it contains ${available.map((key) => `'${key}'`).join(', ')}` : ''),
    );
  }
  if (root.kind !== 'module') {
    throw new PydocsError(`starlight-pydocs: '${options.packageName}' is a ${root.kind}, expected a module`);
  }

  const builder = new ModelBuilder(dump, options);
  return builder.build(root);
}

class ModelBuilder {
  private readonly index = new Map<string, GriffeObject>();
  private readonly warnings: string[] = [];
  private readonly scopes = new Map<string, Map<string, string>>();
  private readonly objectsByPath = new Map<string, DocObject>();
  private readonly linearisations = new Map<string, string[]>();

  private readonly options: ModelOptions;

  // Parameter properties are avoided throughout `lib/`: node's type-stripping
  // loader (used by the fixture scripts) only handles erasable syntax.
  constructor(dump: GriffeDump, options: ModelOptions) {
    this.options = options;
    for (const entry of Object.values(dump)) this.indexObject(entry);
  }

  build(root: GriffeParent): PackageModel {
    const rootDoc = this.buildObject(root, root.path, {
      pageSlug: this.options.base,
      visiting: new Set<string>(),
    });

    const pages = this.buildPages(rootDoc);
    const symbols = this.buildSymbols(rootDoc);

    return {
      name: this.options.packageName,
      base: this.options.base,
      root: rootDoc,
      pages,
      pagesBySlug: new Map(pages.map((page) => [page.slug, page])),
      objectsByPath: this.objectsByPath,
      symbols,
      symbolsByPath: new Map(symbols.map((entry) => [entry.path, entry])),
      scopes: this.scopes,
      warnings: this.warnings,
    };
  }

  /** Index every object by canonical path and record module/class scopes. */
  private indexObject(object: GriffeObject): void {
    // Dumps may grow keys we know nothing about; anything without a path is not
    // an object we can document.
    if (typeof object?.path !== 'string') return;
    this.index.set(object.path, object);
    if (!hasMembers(object)) return;

    const scope = new Map<string, string>();
    for (const [name, member] of Object.entries(object.members ?? {})) {
      scope.set(name, member.kind === 'alias' ? member.target_path : member.path);
      this.indexObject(member);
    }
    this.scopes.set(object.path, scope);
  }

  // -- Member selection ----------------------------------------------------

  /**
   * The documented members of a module or class, in source order.
   *
   * `__all__` (griffe's `exports`) replaces the visibility heuristics for
   * non-module members when present. Submodules are handled separately: they are
   * navigation, so only privacy and the user's globs remove them.
   */
  private selectMembers(parent: GriffeParent, parentDocPath: string): GriffeObject[] {
    const exports = parent.kind === 'module' ? (parent.exports ?? undefined) : undefined;
    const exported = exports === undefined ? undefined : new Set(exports);
    const filters = this.options.filters;
    const selected: GriffeObject[] = [];

    for (const [name, member] of Object.entries(parent.members ?? {})) {
      const docPath = `${parentDocPath}.${name}`;
      const isSubmodule = member.kind === 'module';
      const isExported = exported?.has(name) === true;

      const isSpecial = member.is_special === true || (name.startsWith('__') && name.endsWith('__'));
      const isPrivate = !isSpecial && (member.is_private === true || isPrivateName(name));
      const isImported = member.is_imported === true;

      // Listing a name in `__all__` is an explicit decision to publish it, so it
      // overrides every heuristic below.
      if (!isExported) {
        // `__all__` governs members but not navigation: submodules are reached
        // through the module tree whether or not they are exported.
        if (exported !== undefined && !isSubmodule) continue;
        if (isSpecial && !filters.special) continue;
        if (isPrivate && !filters.private) continue;
        if (isImported && !isSubmodule && !filters.imported) continue;
        // Anything else griffe considers non-public (a wildcard exclusion, say)
        // stays hidden.
        if (member.is_public === false && !isPrivate && !isImported && !isSpecial) continue;
      }

      if (!this.includeAllows(docPath)) continue;
      if (this.excludeRejects(docPath)) continue;

      selected.push(member);
    }

    if (exported !== undefined) {
      const present = new Set(Object.keys(parent.members ?? {}));
      for (const name of exported) {
        if (!present.has(name)) {
          this.warnings.push(`${parent.path}: '${name}' is listed in __all__ but is not a member of the module`);
        }
      }
    }

    return selected;
  }

  private includeAllows(docPath: string): boolean {
    const include = this.options.members.include;
    if (include.length === 0) return true;
    return include.some(
      (pattern) =>
        matchesDottedGlob(pattern, docPath) ||
        // Keep containers on the way to an included descendant.
        pattern.startsWith(`${docPath}.`),
    );
  }

  private excludeRejects(docPath: string): boolean {
    return this.options.members.exclude.some((pattern) => matchesDottedGlob(pattern, docPath));
  }

  // -- Object construction -------------------------------------------------

  private buildObject(
    object: GriffeObject,
    docPath: string,
    context: {
      pageSlug: string;
      visiting: Set<string>;
      parentKind?: 'module' | 'class';
      inheritedFrom?: string;
      reexportedFrom?: string;
    },
  ): DocObject {
    const resolved = this.resolveAlias(object);
    const target = resolved.object;
    const reexportedFrom = context.reexportedFrom ?? resolved.reexportedFrom;

    const kind: DocKind = target.kind === 'type alias' ? 'attribute' : (target.kind as DocKind);
    const pageSlug = target.kind === 'module' ? moduleSlug(this.options.base, docPath) : context.pageSlug;

    const doc: DocObject = {
      path: docPath,
      canonicalPath: target.path,
      name: shortName(docPath),
      kind,
      labels: [...(target.labels ?? [])],
      object: target,
      docstring: normaliseDocstring(target),
      summary: briefFrom(target),
      deprecated: deprecationFrom(target),
      parentKind: context.parentKind,
      members: [],
      groups: [],
      reexportedFrom,
      inheritedFrom: context.inheritedFrom,
      externalTargetPath: resolved.externalTargetPath,
      bases: undefined,
      mro: undefined,
      unresolvedBases: undefined,
      overloads: overloadsFrom(target),
      source: this.sourceFor(target),
      pageSlug,
    };

    this.objectsByPath.set(docPath, doc);

    if (hasMembers(target) && !context.visiting.has(target.path)) {
      const visiting = new Set(context.visiting).add(target.path);
      const members: DocObject[] = [];

      for (const member of this.selectMembers(target, docPath)) {
        members.push(
          this.buildObject(member, `${docPath}.${member.name}`, { pageSlug, visiting, parentKind: target.kind }),
        );
      }

      if (target.kind === 'class') {
        const { bases, unresolved } = this.resolveBases(target);
        doc.bases = bases;
        doc.unresolvedBases = unresolved;
        doc.mro = this.lineariseClass(target.path);
        if (this.options.filters.inherited) {
          members.push(...this.inheritedMembers(target, docPath, members, pageSlug, visiting));
        }
      }

      doc.members = members;
      doc.groups = groupMembers(members, target.kind);
    }

    return doc;
  }

  /** Follow an alias into the dump when the target is part of it. */
  private resolveAlias(object: GriffeObject): {
    object: GriffeObject;
    reexportedFrom: string | undefined;
    externalTargetPath: string | undefined;
  } {
    if (object.kind !== 'alias') {
      return { object, reexportedFrom: undefined, externalTargetPath: undefined };
    }

    const seen = new Set<string>();
    let current: GriffeAlias = object;
    for (;;) {
      if (seen.has(current.target_path)) break;
      seen.add(current.target_path);
      const target = this.index.get(current.target_path);
      if (target === undefined) break;
      if (target.kind === 'alias') {
        current = target;
        continue;
      }
      return {
        object: target,
        reexportedFrom: parentPath(target.path),
        externalTargetPath: undefined,
      };
    }

    // Unresolvable target: an import from outside the documented package, or a
    // cycle. Keep it as a reference so renderers can show where it points.
    return { object, reexportedFrom: undefined, externalTargetPath: current.target_path };
  }

  // -- Inheritance ---------------------------------------------------------

  private resolveBases(klass: GriffeClass): { bases: DocBase[]; unresolved: string[] } {
    const bases: DocBase[] = [];
    const unresolved: string[] = [];

    for (const base of klass.bases ?? []) {
      const dotted = expressionToPath(base);
      const resolvedPath = dotted === undefined ? undefined : this.resolveClassPath(dotted, klass.path);
      const text = dotted ?? '';
      bases.push({ text: resolvedPath ?? text, path: resolvedPath, expression: base });
      if (resolvedPath === undefined) unresolved.push(text === '' ? 'unknown' : text);
    }

    return { bases, unresolved };
  }

  /** Resolve a base-class name to a class inside the dump, following aliases. */
  private resolveClassPath(dotted: string, fromPath: string): string | undefined {
    const [first, ...rest] = dotted.split('.');
    if (first === undefined) return undefined;

    const candidates: string[] = [];
    const ownerModule = this.moduleOf(fromPath);
    if (ownerModule !== undefined) {
      const scope = this.scopes.get(ownerModule);
      const mapped = scope?.get(first);
      if (mapped !== undefined) candidates.push([mapped, ...rest].join('.'));
    }
    candidates.push(dotted);

    for (const candidate of candidates) {
      const object = this.followToObject(candidate);
      if (object?.kind === 'class' && isInside(object.path, this.options.packageName)) return object.path;
    }
    return undefined;
  }

  private followToObject(path: string): GriffeObject | undefined {
    let current = this.index.get(path);
    const seen = new Set<string>();
    while (current?.kind === 'alias' && !seen.has(current.target_path)) {
      seen.add(current.target_path);
      current = this.index.get(current.target_path);
    }
    return current;
  }

  /** Nearest enclosing module of a dotted path. */
  private moduleOf(path: string): string | undefined {
    let current: string | undefined = path;
    while (current !== undefined) {
      const object = this.index.get(current);
      if (object?.kind === 'module') return current;
      current = parentPath(current);
    }
    return undefined;
  }

  /** C3 linearisation over the bases we can resolve; externals simply stop it. */
  private lineariseClass(classPath: string): string[] {
    const cached = this.linearisations.get(classPath);
    if (cached !== undefined) return cached;

    // Guard against inheritance cycles in malformed dumps.
    this.linearisations.set(classPath, [classPath]);

    const object = this.index.get(classPath);
    const parents =
      object?.kind === 'class'
        ? (object.bases ?? [])
            .map((base) => {
              const dotted = expressionToPath(base);
              return dotted === undefined ? undefined : this.resolveClassPath(dotted, classPath);
            })
            .filter((value): value is string => value !== undefined)
        : [];

    const sequences: string[][] = [
      ...parents.map((parent) => this.lineariseClass(parent)),
      parents.length > 0 ? [...parents] : [],
    ].filter((sequence) => sequence.length > 0);

    const result = [classPath, ...merge(sequences)];
    this.linearisations.set(classPath, result);
    return result;
  }

  /**
   * Public members of the resolvable bases, in MRO order, that the class does
   * not define itself.
   */
  private inheritedMembers(
    klass: GriffeClass,
    docPath: string,
    own: DocObject[],
    pageSlug: string,
    visiting: Set<string>,
  ): DocObject[] {
    const taken = new Set(own.map((member) => member.name));
    const inherited: DocObject[] = [];

    for (const basePath of this.lineariseClass(klass.path).slice(1)) {
      const base = this.index.get(basePath);
      if (base?.kind !== 'class') continue;
      for (const member of this.selectMembers(base, docPath)) {
        if (taken.has(member.name)) continue;
        taken.add(member.name);
        inherited.push(
          this.buildObject(member, `${docPath}.${member.name}`, {
            pageSlug,
            visiting,
            parentKind: 'class',
            inheritedFrom: basePath,
          }),
        );
      }
    }

    return inherited;
  }

  // -- Source links --------------------------------------------------------

  private sourceFor(object: GriffeObject): DocSource | undefined {
    const file = this.sourceFile(object);
    const startLine = typeof object.lineno === 'number' ? object.lineno : undefined;
    const endLine = typeof object.endlineno === 'number' ? object.endlineno : startLine;
    const griffeLink = typeof object.source_link === 'string' ? object.source_link : undefined;

    const link = this.options.sourceLink;
    const href =
      link !== undefined && file !== undefined
        ? formatSourceLink(link, file, startLine ?? 1, endLine ?? startLine ?? 1)
        : griffeLink;

    if (file === undefined && href === undefined) return undefined;
    return { file, startLine, endLine, href };
  }

  /**
   * The path a source link should show.
   *
   * Griffe's `relative_filepath` is relative to the process it ran in, which is
   * the Astro project root. That is repository-relative only when the two are
   * the same directory; a docs site with its Python sources one level up gets an
   * absolute path instead. `sourceLink.root` fixes it by naming the directory
   * paths should be relative to, computed from the absolute `filepath`.
   */
  private sourceFile(object: GriffeObject): string | undefined {
    const root = this.options.sourceLink?.root;
    const absolute = typeof object.filepath === 'string' ? object.filepath : undefined;
    if (root !== undefined && absolute !== undefined && path.isAbsolute(absolute)) {
      return path.relative(root, absolute).split(path.sep).join('/');
    }
    return object.relative_filepath;
  }

  // -- Pages and symbols ---------------------------------------------------

  private buildPages(root: DocObject): PageModel[] {
    const pages: PageModel[] = [];

    const visit = (module: DocObject, parent: string | undefined): void => {
      const children = module.members.filter((member) => member.kind === 'module');
      pages.push({
        slug: module.pageSlug,
        title: module.path,
        modulePath: module.path,
        object: module,
        headings: pageHeadings(module),
        children: children.map((child) => child.path),
        parent,
      });
      for (const child of children) visit(child, module.path);
    };

    visit(root, undefined);
    return pages;
  }

  private buildSymbols(root: DocObject): SymbolIndexEntry[] {
    const symbols: SymbolIndexEntry[] = [];

    const visit = (object: DocObject): void => {
      symbols.push({
        path: object.path,
        kind: object.kind,
        pageSlug: object.pageSlug,
        anchor: object.kind === 'module' ? '' : object.path,
        brief: object.summary,
      });
      for (const member of object.members) visit(member);
    };

    visit(root);
    return symbols;
  }
}

/** Standard C3 merge over already-linearised sequences. */
function merge(sequences: string[][]): string[] {
  const pending = sequences.map((sequence) => [...sequence]).filter((sequence) => sequence.length > 0);
  const result: string[] = [];

  while (pending.length > 0) {
    let candidate: string | undefined;
    for (const sequence of pending) {
      const head = sequence[0];
      if (head === undefined) continue;
      const isInTail = pending.some((other) => other.indexOf(head) > 0);
      if (!isInTail) {
        candidate = head;
        break;
      }
    }
    if (candidate === undefined) {
      // Inconsistent hierarchy: fall back to first-come order rather than fail.
      candidate = pending[0]?.[0];
      if (candidate === undefined) break;
    }
    result.push(candidate);
    for (const sequence of pending) {
      if (sequence[0] === candidate) sequence.shift();
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index]?.length === 0) pending.splice(index, 1);
    }
  }

  return result;
}

function isPrivateName(name: string): boolean {
  return name.startsWith('_');
}

/** Bucket members for rendering; order inside a bucket is source order. */
export function groupMembers(members: DocObject[], parentKind: 'module' | 'class'): MemberGroup[] {
  const buckets = new Map<MemberGroupId, DocObject[]>();

  for (const member of members) {
    const id = groupIdFor(member, parentKind);
    const bucket = buckets.get(id);
    if (bucket === undefined) buckets.set(id, [member]);
    else bucket.push(member);
  }

  return GROUP_ORDER.filter((id) => (buckets.get(id)?.length ?? 0) > 0).map((id) => ({
    id,
    members: buckets.get(id) ?? [],
  }));
}

function groupIdFor(member: DocObject, parentKind: 'module' | 'class'): MemberGroupId {
  switch (member.kind) {
    case 'module':
      return 'modules';
    case 'class':
      return 'classes';
    case 'function':
      return parentKind === 'class' ? 'methods' : 'functions';
    case 'attribute':
      return member.labels.includes('property') ? 'properties' : 'attributes';
    case 'alias':
      return 'attributes';
  }
}

/** H2 per documented top-level member, H3 for the members of a class. */
export function pageHeadings(module: DocObject): PageHeading[] {
  const headings: PageHeading[] = [];

  for (const group of module.groups) {
    // Submodules get pages of their own, so they are links rather than headings.
    if (group.id === 'modules') continue;
    for (const member of group.members) {
      headings.push({ depth: 2, slug: member.path, text: member.name });
      // Group order, not source order: the table of contents has to match what
      // the renderer emits.
      for (const childGroup of member.groups) {
        for (const child of childGroup.members) {
          headings.push({ depth: 3, slug: child.path, text: child.name });
        }
      }
    }
  }

  return headings;
}

function normaliseDocstring(object: GriffeObject): DocDocstring | undefined {
  const docstring = object.docstring;
  if (docstring === undefined || docstring === null) return undefined;
  return { value: docstring.value, sections: docstring.parsed ?? [] };
}

function overloadsFrom(object: GriffeObject): GriffeFunction[] | undefined {
  if (object.kind !== 'function') return undefined;
  const overloads = object.overloads;
  return Array.isArray(overloads) && overloads.length > 0 ? overloads : undefined;
}

/**
 * The first line of the docstring, as plain text.
 *
 * Deliberately naive markdown stripping: the brief goes into a search index and
 * an `objects.inv`, where a leftover asterisk matters less than pulling in a
 * markdown parser.
 */
export function briefFrom(object: GriffeObject): string {
  const sections = object.docstring?.parsed ?? [];
  const text = sections.find((section): section is DocstringSectionText => section.kind === 'text');
  const raw = typeof text?.value === 'string' ? text.value : (object.docstring?.value ?? '');
  return stripMarkdown(firstLine(raw));
}

function firstLine(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const [first = ''] = trimmed.split(/\r?\n/);
  return first.trim();
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .trim();
}

/**
 * Deprecation metadata, from whichever signal is available: griffe's
 * `is_deprecated` flag, a `deprecated` docstring section, or the `Deprecated:`
 * admonition that the google parser produces (griffe 2.1.0 routes google-style
 * `Deprecated:` blocks through `admonition`, not `deprecated`).
 */
export function deprecationFrom(object: GriffeObject): DocDeprecation | undefined {
  const sections = object.docstring?.parsed ?? [];

  for (const section of sections) {
    if (section.kind === 'deprecated') {
      const value = (section as DocstringSectionDeprecated).value;
      return { version: value?.version, description: value?.description };
    }
    if (section.kind === 'admonition') {
      const value = (section as DocstringSectionAdmonition).value;
      if (value?.annotation === 'deprecated') {
        return { version: undefined, description: value.description };
      }
    }
  }

  return object.is_deprecated === true ? { version: undefined, description: undefined } : undefined;
}

/**
 * Resolver for annotation names, wired to a model and (optionally) inventories.
 */
export function buildAnnotationResolver(
  model: PackageModel,
  lookupExternal?: (dottedPath: string) => string | undefined,
): AnnotationResolver {
  const documented = new Set<string>();
  for (const entry of model.symbols) {
    documented.add(entry.path);
    // Canonical paths matter too: an annotation may name the definition site.
    const object = model.objectsByPath.get(entry.path);
    if (object !== undefined) documented.add(object.canonicalPath);
  }

  return createAnnotationResolver({
    isDocumented: (dottedPath) => documented.has(dottedPath),
    lookupScope: (scopePath, name) => model.scopes.get(scopePath)?.get(name),
    lookupExternal,
  });
}

/**
 * Documented path for a canonical path, preferring the shortest one when an
 * object is documented at several paths (a re-export and its definition).
 */
export function documentedPathFor(model: PackageModel, canonicalPath: string): string | undefined {
  if (model.objectsByPath.has(canonicalPath)) return canonicalPath;
  let best: string | undefined;
  for (const [path, object] of model.objectsByPath) {
    if (object.canonicalPath !== canonicalPath) continue;
    if (best === undefined || path.length < best.length) best = path;
  }
  return best;
}
