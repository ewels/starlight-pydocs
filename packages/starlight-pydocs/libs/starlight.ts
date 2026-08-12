// Starlight-specific sidebar helpers. This file may import Starlight types; it
// must never be imported from lib/ or from the vanilla integration path.

import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import type { StarlightUserConfig } from '@astrojs/starlight/types';

import type { PydocsContext } from '../lib/context.ts';

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

export function makeSidebarGroup(
  label: string,
  entries: (SidebarGroup | SidebarLink)[],
  collapsed: boolean,
): SidebarGroup {
  return { type: 'group', label, entries, collapsed, badge: undefined };
}

export function makeSidebarLink(label: string, href: string, isCurrent: boolean): SidebarLink {
  return { type: 'link', label, href, isCurrent, badge: undefined, attrs: {} };
}

/** The placeholder label the default (single-instance) plugin uses. */
export function getDefaultPlaceholderLabel(): string {
  return defaultSidebarGroupLabel.toString();
}

export { type PydocsContext };
