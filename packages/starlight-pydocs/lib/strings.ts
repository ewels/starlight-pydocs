/**
 * English UI strings for everything the renderers label.
 *
 * Keys are flat and namespace-free so they map one-to-one onto Starlight's
 * translation tables (`translations.ts` mirrors these keys per locale) and onto
 * the label props every component accepts for vanilla Astro sites.
 */

export const STRINGS = {
  // Member group headings.
  attributes: 'Attributes',
  properties: 'Properties',
  classes: 'Classes',
  functions: 'Functions',
  methods: 'Methods',
  modules: 'Modules',

  // Docstring section headings.
  parameters: 'Parameters',
  otherParameters: 'Other parameters',
  typeParameters: 'Type parameters',
  returns: 'Returns',
  yields: 'Yields',
  receives: 'Receives',
  raises: 'Raises',
  warns: 'Warns',
  examples: 'Examples',
  notes: 'Notes',
  references: 'References',

  // Signature and member metadata.
  bases: 'Bases',
  default: 'default',
  required: 'required',
  overload: 'Overload',
  overloads: 'Overloads',
  inheritedFrom: 'Inherited from',
  reexportedFrom: 'Re-exported from',
  aliasOf: 'Alias of',
  deprecated: 'Deprecated',
  deprecatedSince: 'Deprecated since',
  addedIn: 'Added in',
  viewSource: 'View source',
  sourceCode: 'Source code',

  // Table column headings, used by the parameter and attribute tables.
  columnName: 'Name',
  columnType: 'Type',
  columnDescription: 'Description',
  columnDefault: 'Default',

  // Object kinds, for badges and search result grouping.
  kindModule: 'module',
  kindClass: 'class',
  kindFunction: 'function',
  kindMethod: 'method',
  kindAttribute: 'attribute',
  kindProperty: 'property',
  kindAlias: 'alias',

  // Labels griffe attaches that are worth surfacing as badges.
  labelClassmethod: 'classmethod',
  labelStaticmethod: 'staticmethod',
  labelAsync: 'async',
  labelAbstract: 'abstract',
  labelCached: 'cached',
  labelReadOnly: 'read-only',
  labelWritable: 'writable',
  labelInstanceAttribute: 'instance attribute',
  labelClassAttribute: 'class attribute',
  labelModuleAttribute: 'module attribute',
  labelPydanticModel: 'pydantic model',
  labelPydanticField: 'pydantic field',
  labelPydanticValidator: 'pydantic validator',

  // Symbol search.
  searchLabel: 'Search symbols',
  searchPlaceholder: 'Search classes, functions, attributes…',
  searchNoResults: 'No matching symbols',
  searchResults: 'Results',
  searchHint: 'Type part of a name, or a dotted path',

  // Page furniture.
  /** Accessible name of an anchor heading's link, followed by the object path. */
  permalink: 'Permalink to',
  apiReference: 'API reference',
  /** Sidebar link to a package's root page. */
  overview: 'Overview',
  onPage: 'On this page',
  noMembers: 'No documented members.',
  undocumented: 'No description provided.',
} as const;

export type StringKey = keyof typeof STRINGS;

export type StringOverrides = Partial<Record<StringKey, string>>;

/**
 * Resolve one label, letting a caller (a component prop, or a Starlight
 * translation table) override the English default.
 */
export function resolveLabel(key: StringKey, overrides?: StringOverrides | undefined): string {
  return overrides?.[key] ?? STRINGS[key];
}

/** Every key, handy for i18n completeness checks. */
export function stringKeys(): StringKey[] {
  return Object.keys(STRINGS) as StringKey[];
}
