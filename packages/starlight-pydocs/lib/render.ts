/**
 * The bridge between the model and the components.
 *
 * Components stay presentational: everything that needs the model, the site
 * configuration or a policy decision is computed here, framework-free and unit
 * testable. A `RenderScope` is built once per page (or per `<Autodoc>`) and
 * handed down as a single prop, which keeps the components from each reaching
 * into the virtual context module.
 */

import type { PydocsContext, PydocsPackageContext } from './context.ts';
import type { RenderedDocstrings } from './docstrings.ts';
import type { AnnotationResolver, AnnotationTarget } from './expr.ts';
import { getAnnotationResolver, getModel, getRenderedDocstrings, requirePackage } from './data.ts';
import { kindLabelKey, labelBadges } from './markdown-doc.ts';
import type { DocObject, PackageModel } from './model.ts';
import { documentedPathFor } from './model.ts';
import { assetHref, buildHref, objectHref } from './paths.ts';
import type { StringKey } from './strings.ts';
import type { Annotation } from './types.ts';

export interface RenderScope {
  /** Site-wide configuration from the virtual context module. */
  context: PydocsContext;
  /** The package being rendered. */
  pkg: PydocsPackageContext;
  model: PackageModel;
  /** Resolver for annotation names, wired to the site's inventories. */
  resolver: AnnotationResolver;
  /**
   * Docstring prose, already HTML. Rendered at `astro:config:done` through the
   * host's markdown processor, so no markdown engine runs at render time.
   */
  rendered: RenderedDocstrings;
}

/**
 * Build the scope for one documented package, reusing the per-process caches.
 *
 * @param base - Base of the package entry being rendered. Bases identify
 *   entries; the same import name may be documented at several of them.
 */
export async function createRenderScope(context: PydocsContext, base: string): Promise<RenderScope> {
  const pkg = requirePackage(context, base);
  const [model, resolver, rendered] = await Promise.all([
    getModel(context, base),
    getAnnotationResolver(context, base),
    getRenderedDocstrings(context, base),
  ]);
  return { context, pkg, model, resolver, rendered };
}

/** Href of a documented object, or undefined when nothing documents it. */
export function hrefForPath(scope: RenderScope, dottedPath: string): string | undefined {
  const documented = documentedPathFor(scope.model, dottedPath);
  if (documented === undefined) return undefined;
  const entry = scope.model.symbolsByPath.get(documented);
  if (entry === undefined) return undefined;
  return objectHref(scope.context.siteBase, entry.pageSlug, entry.anchor, scope.context.trailingSlash);
}

/** Href for a resolved annotation target: same-site page or external doc site. */
export function hrefForTarget(scope: RenderScope, target: AnnotationTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === 'external' ? target.href : hrefForPath(scope, target.path);
}

/** Href of a generated page. */
export function pageHref(scope: RenderScope, pageSlug: string): string {
  return buildHref(scope.context.siteBase, pageSlug, scope.context.trailingSlash);
}

/** Href of one of the package's sibling files (`symbols.json`, `llms.txt`, …). */
export function packageAssetHref(scope: RenderScope, filename: string): string {
  return assetHref(scope.context.siteBase, scope.pkg.base, filename);
}

// -- Badges ----------------------------------------------------------------

export type BadgeVariant = 'kind' | 'label' | 'deprecated' | 'added';

export interface DocBadge {
  variant: BadgeVariant;
  /** Translation key, when the badge text is one of our strings. */
  key: StringKey | undefined;
  /** Verbatim text, for griffe labels we have no translation for. */
  text: string | undefined;
  /** Appended after the label, for a badge that carries a value ("Added in 1.1"). */
  value?: string | undefined;
}

/**
 * Badges for an object's heading: its kind, the version it appeared in, the
 * griffe labels worth surfacing (`classmethod`, `pydantic model`, …) and a
 * deprecation marker.
 *
 * The kind and label keys come from the Markdown renderer so both outputs name
 * things identically.
 */
export function objectBadges(doc: DocObject): DocBadge[] {
  const badges: DocBadge[] = [];
  const kindKey = kindLabelKey(doc);
  if (kindKey !== undefined) badges.push({ variant: 'kind', key: kindKey, text: undefined });

  // Next to the kind badge, because "when did this appear" is the second thing
  // a reader wants from a heading.
  if (doc.addedIn !== undefined) {
    badges.push({ variant: 'added', key: 'addedIn', text: undefined, value: doc.addedIn });
  }

  for (const { key, raw } of labelBadges(doc)) {
    badges.push({ variant: 'label', key, text: key === undefined ? raw : undefined });
  }

  if (doc.deprecated !== undefined) badges.push({ variant: 'deprecated', key: 'deprecated', text: undefined });
  return badges;
}

// -- Members ---------------------------------------------------------------

export interface InheritedBucket {
  /** Dotted path of the base class the members came from. */
  from: string;
  members: DocObject[];
}

/**
 * Split a member list into the class' own members and one bucket per base
 * class, in MRO order, so inherited members can be collapsed separately.
 */
export function splitInherited(members: DocObject[]): { own: DocObject[]; inherited: InheritedBucket[] } {
  const own: DocObject[] = [];
  const buckets = new Map<string, DocObject[]>();

  for (const member of members) {
    const from = member.inheritedFrom;
    if (from === undefined) {
      own.push(member);
      continue;
    }
    const bucket = buckets.get(from);
    if (bucket === undefined) buckets.set(from, [member]);
    else bucket.push(member);
  }

  return { own, inherited: [...buckets].map(([from, bucket]) => ({ from, members: bucket })) };
}

// -- Docstring sections ----------------------------------------------------

/** The four aside flavours we style, matching Starlight's own set. */
export type AdmonitionKind = 'note' | 'tip' | 'caution' | 'danger';

const ADMONITION_KINDS: Record<string, AdmonitionKind> = {
  note: 'note',
  info: 'note',
  todo: 'note',
  seealso: 'note',
  example: 'note',
  abstract: 'note',
  summary: 'note',
  quote: 'note',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'tip',
  check: 'tip',
  warning: 'caution',
  caution: 'caution',
  attention: 'caution',
  danger: 'danger',
  error: 'danger',
  failure: 'danger',
  bug: 'danger',
};

/** Map a griffe admonition annotation onto one of our aside flavours. */
export function admonitionKind(annotation: Annotation): AdmonitionKind {
  const raw = typeof annotation === 'string' ? annotation : '';
  return ADMONITION_KINDS[raw.trim().toLowerCase()] ?? 'note';
}

/** Title for an admonition: the docstring's own title, else its annotation. */
export function admonitionTitle(title: string | null | undefined, annotation: Annotation): string {
  if (typeof title === 'string' && title.trim() !== '') return title;
  const raw = typeof annotation === 'string' ? annotation.trim() : '';
  if (raw === '') return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
