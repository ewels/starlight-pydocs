// Starlight-specific sidebar helpers. This file may import Starlight types; it
// must never be imported from lib/ or from the vanilla integration path.

import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import type { StarlightUserConfig } from '@astrojs/starlight/types';

import type { PydocsContext } from '../lib/context.ts';
import { getModel } from '../lib/data.ts';
import { buildHref, stripLeadingAndTrailingSlashes } from '../lib/paths.ts';

type SidebarUserItems = NonNullable<StarlightUserConfig['sidebar']>;
export type SidebarUserGroup = Extract<SidebarUserItems[number], { items: unknown }>;

type SidebarEntries = StarlightRouteData['sidebar'];
type SidebarEntry = SidebarEntries[number];
export type SidebarGroup = Extract<SidebarEntry, { type: 'group' }>;
export type SidebarLink = Extract<SidebarEntry, { type: 'link' }>;

const defaultSidebarGroupLabel = Symbol('StarlightPydocsSidebarGroupLabel');

/**
 * A placeholder sidebar group users put in their Starlight `sidebar` config.
 * The route middleware swaps it for the generated API tree at render time
 * (the generated pages are injected routes, unknown to Starlight's sidebar
 * builder at config time).
 */
export function getSidebarGroupsPlaceholder(label: symbol = defaultSidebarGroupLabel): SidebarUserGroup {
  return {
    collapsed: false,
    items: [],
    label: label.toString(),
  };
}

/** Replace placeholder groups (matched by label) with the generated groups. */
export function replaceSidebarPlaceholder(
  sidebar: SidebarEntries,
  placeholderLabel: string,
  groups: SidebarGroup[],
): SidebarEntries {
  function walk(entry: SidebarEntry): SidebarEntry | SidebarEntry[] {
    if (entry.type !== 'group') return entry;
    if (entry.label === placeholderLabel) return groups;
    return { ...entry, entries: entry.entries.flatMap((item) => walk(item)) };
  }

  return sidebar.flatMap((entry) => walk(entry));
}

function makeSidebarGroup(label: string, entries: (SidebarGroup | SidebarLink)[], collapsed: boolean): SidebarGroup {
  return { type: 'group', label, entries, collapsed, badge: undefined };
}

function makeSidebarLink(label: string, href: string, isCurrent: boolean): SidebarLink {
  return { type: 'link', label, href, isCurrent, badge: undefined, attrs: {} };
}

/** The placeholder label the default (single-instance) plugin uses. */
export function getDefaultPlaceholderLabel(): string {
  return defaultSidebarGroupLabel.toString();
}

// -- The generated navigation ----------------------------------------------

/** One entry of the generated tree, before `isCurrent` is known. */
interface NavNode {
  label: string;
  href: string;
  /** Child module pages. */
  children: NavNode[];
  collapsed: boolean;
}

export interface PydocsNavigation {
  /** Placeholder label → the groups that replace it. */
  groupsByPlaceholder: Map<string, NavNode[]>;
  /** Every generated page href, in navigation order, for pagination. */
  order: { label: string; href: string }[];
}

let navigationCache: { key: string; promise: Promise<PydocsNavigation> } | undefined;

/**
 * Cache key for the built navigation. Dump paths are content-keyed, so a dev
 * re-extraction produces a new path and a stale tree cannot be served; module
 * state survives Vite's invalidation of the context virtual module, which is
 * why an unkeyed once-only cache went stale.
 */
function navigationKey(context: PydocsContext): string {
  return JSON.stringify(context.packages.map((pkg) => [pkg.base, pkg.dumpPath]));
}

/**
 * Build the generated navigation once per process.
 *
 * The middleware runs for every page of the site, so this must not touch the
 * model per request: `isCurrent` is the only per-request part, and it is applied
 * when the tree is converted to Starlight entries.
 */
export function getPydocsNavigation(context: PydocsContext): Promise<PydocsNavigation> {
  const key = navigationKey(context);
  if (navigationCache?.key !== key) navigationCache = { key, promise: buildNavigation(context) };
  return navigationCache.promise;
}

async function buildNavigation(context: PydocsContext): Promise<PydocsNavigation> {
  const groupsByPlaceholder = new Map<string, NavNode[]>();
  const order: { label: string; href: string }[] = [];

  for (const pkg of context.packages) {
    const model = await getModel(context, pkg.base);
    const collapsed = pkg.sidebar.collapsed;
    const href = (slug: string): string => buildHref(context.siteBase, slug, context.trailingSlash);
    const pagesByModule = new Map(model.pages.map((page) => [page.modulePath, page]));

    // The package's own page is the group itself, its submodules the children;
    // both mirror the page plan.
    const nodeFor = (modulePath: string): NavNode => {
      const page = pagesByModule.get(modulePath);
      return {
        label: modulePath === model.root.path ? pkg.sidebar.label : (page?.object.name ?? modulePath),
        href: href(page?.slug ?? pkg.base),
        children: (page?.children ?? []).map((child) => nodeFor(child)),
        collapsed,
      };
    };

    const group = nodeFor(model.root.path);
    const placeholder = pkg.sidebar.group ?? getDefaultPlaceholderLabel();
    const existing = groupsByPlaceholder.get(placeholder);
    if (existing === undefined) groupsByPlaceholder.set(placeholder, [group]);
    else existing.push(group);

    const collect = (node: NavNode): void => {
      order.push({ label: node.label, href: node.href });
      for (const child of node.children) collect(child);
    };
    collect(group);
  }

  return { groupsByPlaceholder, order };
}

/** Convert one generated group to Starlight entries, marking the current page. */
export function toSidebarGroup(node: NavNode, pathname: string, overviewLabel: string): SidebarGroup {
  const entries: (SidebarGroup | SidebarLink)[] = [
    makeSidebarLink(overviewLabel, node.href, isCurrentHref(node.href, pathname)),
  ];

  for (const child of node.children) {
    entries.push(
      child.children.length === 0
        ? makeSidebarLink(child.label, child.href, isCurrentHref(child.href, pathname))
        : toSidebarGroup(child, pathname, overviewLabel),
    );
  }

  return makeSidebarGroup(node.label, entries, node.collapsed);
}

export function isCurrentHref(href: string, pathname: string): boolean {
  return stripLeadingAndTrailingSlashes(href) === stripLeadingAndTrailingSlashes(pathname);
}

/** Prev/next links for a generated page, following the navigation order. */
export function getPydocsPagination(
  navigation: PydocsNavigation,
  pathname: string,
): StarlightRouteData['pagination'] | undefined {
  const index = navigation.order.findIndex((entry) => isCurrentHref(entry.href, pathname));
  if (index === -1) return undefined;

  const link = (entry: { label: string; href: string } | undefined): SidebarLink | undefined =>
    entry === undefined ? undefined : makeSidebarLink(entry.label, entry.href, false);

  return { prev: link(navigation.order[index - 1]), next: link(navigation.order[index + 1]) };
}
