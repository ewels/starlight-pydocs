/**
 * User-facing configuration types and their validation.
 *
 * The JSDoc on every option is the source for the generated options reference
 * page, so keep it complete and written for users rather than for maintainers.
 */

import path from 'node:path';

import { configError, PydocsError } from './errors.ts';
import { stripLeadingAndTrailingSlashes } from './paths.ts';

/** Docstring flavour passed to `griffe dump -d`. */
export type DocstringStyle = 'google' | 'numpy' | 'sphinx' | 'auto';

/** How aggressively a remote dump or inventory may be served from the cache. */
export type CacheMode = 'force' | 'revalidate' | 'bypass';

/** A griffe extension, optionally configured. */
export interface PydocsExtensionOptions {
  /** Import name or file path of the extension, as `griffe -e` accepts it. */
  name: string;
  /** Options passed to the extension. Serialised into the `-e` JSON payload. */
  options?: Record<string, unknown> | undefined;
}

export type PydocsExtensionInput = string | PydocsExtensionOptions;

/** Use a dump that already exists on disk instead of running griffe. */
export interface PydocsFileSource {
  /** Path to a `griffe dump` JSON file, relative to the project root. */
  file: string;
}

/** Download a dump published by the Python project's CI. */
export interface PydocsUrlSource {
  /** URL of a `griffe dump` JSON file. */
  url: string;
  /**
   * Cache policy for the download.
   *
   * - `revalidate` (default) sends `If-None-Match`/`If-Modified-Since`.
   * - `force` uses any cached copy without contacting the server.
   * - `bypass` always downloads.
   */
  cache?: CacheMode | undefined;
}

export type PydocsSourceInput = PydocsFileSource | PydocsUrlSource;

/** Glob patterns applied to dotted object paths (`demopkg.report.Report.*`). */
export interface PydocsMembersInput {
  /** When non-empty, only matching objects are documented. */
  include?: string[] | undefined;
  /** Matching objects are dropped, even when they also match `include`. */
  exclude?: string[] | undefined;
}

/** Coarse switches applied before the `members` globs. */
export interface PydocsFiltersInput {
  /** Document dunder members such as `__init__`. Default `false`. */
  special?: boolean | undefined;
  /** Document underscore-prefixed members. Default `false`. */
  private?: boolean | undefined;
  /** Document members that are imports rather than definitions. Default `false`. */
  imported?: boolean | undefined;
  /** Merge public members of resolvable base classes into classes. Default `true`. */
  inherited?: boolean | undefined;
}

/** Explicit source-link URL template. */
export interface PydocsSourceLinkTemplate {
  /**
   * URL template. Placeholders: `{path}` (path of the file relative to the
   * repository root), `{start}` and `{end}` (first and last line of the object),
   * `{ref}` (the `ref` option).
   */
  template: string;
  /** Git ref the template points at. Default `main`. */
  ref?: string | undefined;
  /**
   * Directory `{path}` is relative to, as a path relative to the project root.
   * Set it to the repository root when the Python sources live outside the Astro
   * project (`root: '..'` for a docs site in `docs/`); otherwise `{path}` is
   * whatever griffe reported, which is only repository-relative when griffe ran
   * from the repository root.
   */
  root?: string | undefined;
}

/** Source-link preset for the common forges. */
export interface PydocsSourceLinkPreset {
  /** Which forge's URL layout to use. */
  host: 'github' | 'gitlab' | 'bitbucket';
  /** Repository, as `owner/name`. */
  repo: string;
  /** Git ref to link to. Default `main`. */
  ref?: string | undefined;
  /** Directory `{path}` is relative to. See {@link PydocsSourceLinkTemplate.root}. */
  root?: string | undefined;
}

export type PydocsSourceLinkInput = PydocsSourceLinkTemplate | PydocsSourceLinkPreset;

/** Sidebar presentation for a package's generated group. */
export interface PydocsSidebarInput {
  /** Group label. Defaults to the package's `label`, itself defaulting to `name`. */
  label?: string | undefined;
  /** Render the group collapsed. Default `false`. */
  collapsed?: boolean | undefined;
  /**
   * Sidebar placeholder this package's group replaces, from
   * `createPydocsSidebarGroup()`. Use it to place several packages in different
   * parts of the sidebar; without it every package goes into the shared
   * `pydocsSidebarGroup` placeholder.
   */
  group?: { label: string } | undefined;
}

/** One past release of a package, as a git ref. */
export interface PydocsVersionRefInput {
  /** Git ref (tag, branch or commit) to extract the package from. */
  ref: string;
  /** Version label shown in the badge, e.g. `1.0`. */
  label: string;
}

/** Where the "added in" badges come from. */
export interface PydocsVersionsInput {
  /**
   * Refs to extract and compare against, **oldest first**. The package's current
   * source is the newest version implicitly, so it is not listed. An object
   * present in the oldest ref gets no badge: pre-history is noise.
   */
  refs: PydocsVersionRefInput[];
}

/** One documented Python package. */
export interface PydocsPackageInput {
  /** Python import name of the package, e.g. `demopkg`. Required. */
  name: string;
  /** URL base for the generated pages, relative to the site root. Default `api/<name>`. */
  base?: string | undefined;
  /**
   * Display name for this entry, used as the default sidebar group label.
   * Defaults to `name`. Give it a value when one package is documented at
   * several bases, so the sidebar can tell `demopkg 1.x` from `demopkg`.
   */
  label?: string | undefined;
  /**
   * Directories passed to `griffe --search`, relative to the project root.
   * Point them at the parent of the package directory (`../py/src` for
   * `../py/src/demopkg`). Default: the project root.
   */
  search?: string[] | undefined;
  /** Docstring flavour. Default `google`. */
  docstringStyle?: DocstringStyle | undefined;
  /** Options for the docstring parser, passed to `griffe -D` as JSON. */
  docstringOptions?: Record<string, unknown> | undefined;
  /** Griffe extensions, passed to `griffe -e`. */
  extensions?: PydocsExtensionInput[] | undefined;
  /**
   * Extra Python requirements the extensions need. Used for `uvx --with` and
   * printed in the error message when extraction fails without `uv`.
   */
  extraRequirements?: string[] | undefined;
  /** Pass `griffe -x` to allow importing the package for dynamic analysis. Default `false`. */
  forceInspection?: boolean | undefined;
  /** Use a pre-generated dump instead of running griffe. */
  source?: PydocsSourceInput | undefined;
  /** Fine-grained member selection by dotted path. */
  members?: PydocsMembersInput | undefined;
  /** Coarse member filters. */
  filters?: PydocsFiltersInput | undefined;
  /** Link each object to its source. Either a template or a forge preset. */
  sourceLink?: PydocsSourceLinkInput | undefined;
  /** Sidebar group presentation. */
  sidebar?: PydocsSidebarInput | undefined;
  /**
   * Badge each object with the version it appeared in, by extracting the package
   * at past git refs and comparing. Needs a git checkout with history, so it
   * cannot be combined with `source`.
   */
  versions?: PydocsVersionsInput | undefined;
}

/** Overrides for how griffe is invoked. */
export interface PydocsRunnerInput {
  /**
   * Full argv for the extraction command, taking precedence over every other
   * strategy. The dump arguments (`dump -f -d …`) and `-o <file>` are appended,
   * so pass only the executable and its own arguments, e.g.
   * `['micromamba', 'run', '-n', 'docs', 'griffe']`.
   */
  command?: string[] | undefined;
  /** Python interpreter to probe for `python -m griffe`. Default: `python3` then `python`. */
  python?: string | undefined;
}

/** A Sphinx inventory to resolve type annotations against. */
export interface PydocsInventoryInput {
  /** URL of an `objects.inv` file. Mutually exclusive with `file`. */
  url?: string | undefined;
  /** Path to a local `objects.inv`, relative to the project root. */
  file?: string | undefined;
  /**
   * Base URL that the inventory's relative URIs are resolved against. Defaults
   * to the `objects.inv` URL with its last segment removed.
   */
  base?: string | undefined;
  /** Cache policy for downloads. Default `revalidate`. */
  cache?: CacheMode | undefined;
}

/** Named inventory presets. `'python'` is the CPython standard library. */
export type PydocsInventoryPreset = 'python';

export type PydocsInventoryConfigInput = PydocsInventoryInput | PydocsInventoryPreset;

/**
 * The components a site may replace with its own. Every dispatching component
 * imports these through `virtual:starlight-pydocs/components`, so an override
 * applies everywhere, `<Autodoc>` included.
 */
export const OVERRIDABLE_COMPONENTS = [
  'ModuleDoc',
  'ClassDoc',
  'FunctionDoc',
  'AttributeDoc',
  'Signature',
  'DocstringSections',
  'MemberSummary',
  'SourceLink',
  'Heading',
] as const;

export type OverridableComponentName = (typeof OVERRIDABLE_COMPONENTS)[number];

/** Everything the plugin and the vanilla integration accept. */
export interface PydocsUserConfig {
  /** The packages to document. At least one is required. */
  packages: PydocsPackageInput[];
  /** Extraction overrides. */
  runner?: PydocsRunnerInput | undefined;
  /** Inventories used to link type annotations to other documentation sites. */
  inventories?: PydocsInventoryConfigInput[] | undefined;
  /** Serve `objects.inv` for this site so other projects can link into it. Default `true`. */
  publishInventory?: boolean | undefined;
  /** Serve `symbols.json` and enable the symbol search component. Default `true`. */
  symbolSearch?: boolean | undefined;
  /** Serve a plain-Markdown rendition of the API at `llms.txt`. Default `true`. */
  llmsTxt?: boolean | undefined;
  /**
   * Component overrides, keyed by one of {@link OVERRIDABLE_COMPONENTS} and
   * valued by an import path (relative to the project root) or a package
   * specifier.
   */
  components?: Partial<Record<OverridableComponentName, string>> | undefined;
  /** Inject the package stylesheet. Default `true`. */
  injectStyles?: boolean | undefined;
  /** Directory for cached dumps and inventories. Default `node_modules/.astro`. */
  cacheDir?: string | undefined;
}

// -- Normalised shapes -----------------------------------------------------

export interface NormalisedExtension {
  name: string;
  options: Record<string, unknown> | undefined;
}

export type NormalisedSource = { kind: 'file'; path: string } | { kind: 'url'; url: string; cache: CacheMode };

export interface NormalisedSourceLink {
  /** Template with `{path}`, `{start}`, `{end}` and `{ref}` placeholders. */
  template: string;
  ref: string;
  /** Absolute directory `{path}` is computed against, when configured. */
  root: string | undefined;
}

export interface NormalisedFilters {
  special: boolean;
  private: boolean;
  imported: boolean;
  inherited: boolean;
}

export interface NormalisedMembers {
  include: string[];
  exclude: string[];
}

export interface PydocsPackageConfig {
  name: string;
  /**
   * Base without leading or trailing slashes. This is the identity of a package
   * entry everywhere downstream: bases are unique and non-overlapping, while the
   * same `name` may be documented at several of them.
   */
  base: string;
  /** Display name, defaulting to `name`. */
  label: string;
  /** Absolute search paths. */
  search: string[];
  docstringStyle: DocstringStyle;
  docstringOptions: Record<string, unknown>;
  extensions: NormalisedExtension[];
  extraRequirements: string[];
  forceInspection: boolean;
  source: NormalisedSource | undefined;
  members: NormalisedMembers;
  filters: NormalisedFilters;
  sourceLink: NormalisedSourceLink | undefined;
  sidebar: PydocsSidebarConfig;
  versions: PydocsVersionsConfig;
}

export interface PydocsVersionsConfig {
  /** Refs to compare against, oldest first. Empty when the option is unset. */
  refs: PydocsVersionRefInput[];
}

export interface PydocsSidebarConfig {
  label: string;
  collapsed: boolean;
  /** Label of the placeholder group this package replaces, when it has its own. */
  group: string | undefined;
}

export interface NormalisedInventory {
  /** Absolute URL of the inventory, when it is remote. */
  url: string | undefined;
  /** Absolute path of the inventory, when it is local. */
  file: string | undefined;
  /** Base URL that entry URIs resolve against, with a trailing slash. */
  base: string;
  cache: CacheMode;
}

export interface PydocsConfig {
  packages: PydocsPackageConfig[];
  runner: { command: string[] | undefined; python: string | undefined };
  inventories: NormalisedInventory[];
  publishInventory: boolean;
  symbolSearch: boolean;
  llmsTxt: boolean;
  components: Partial<Record<OverridableComponentName, string>>;
  injectStyles: boolean;
  /** Absolute cache directory. */
  cacheDir: string;
  /** Absolute project root, used to resolve every relative path. */
  projectRoot: string;
}

const DOCSTRING_STYLES: DocstringStyle[] = ['google', 'numpy', 'sphinx', 'auto'];
const CACHE_MODES: CacheMode[] = ['force', 'revalidate', 'bypass'];

/** Line-range URL templates for the forges we know about. */
const SOURCE_LINK_PRESETS: Record<PydocsSourceLinkPreset['host'], (repo: string) => string> = {
  github: (repo) => `https://github.com/${repo}/blob/{ref}/{path}#L{start}-L{end}`,
  gitlab: (repo) => `https://gitlab.com/${repo}/-/blob/{ref}/{path}#L{start}-{end}`,
  bitbucket: (repo) => `https://bitbucket.org/${repo}/src/{ref}/{path}#lines-{start}:{end}`,
};

const INVENTORY_PRESETS: Record<PydocsInventoryPreset, { url: string; base: string }> = {
  python: { url: 'https://docs.python.org/3/objects.inv', base: 'https://docs.python.org/3/' },
};

const PACKAGE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringArray(value: unknown, optionPath: string): string[] {
  if (!Array.isArray(value)) throw configError(optionPath, 'must be an array of strings');
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw configError(`${optionPath}[${index}]`, 'must be a non-empty string');
    }
    return entry;
  });
}

function normaliseExtensions(input: PydocsExtensionInput[] | undefined, optionPath: string): NormalisedExtension[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw configError(optionPath, 'must be an array');
  return input.map((entry, index) => {
    const entryPath = `${optionPath}[${index}]`;
    if (typeof entry === 'string') {
      if (entry.trim() === '') throw configError(entryPath, 'must be a non-empty string');
      return { name: entry, options: undefined };
    }
    if (!isPlainObject(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw configError(entryPath, "must be a string or an object with a 'name' property");
    }
    const options = entry.options;
    if (options !== undefined && !isPlainObject(options)) {
      throw configError(`${entryPath}.options`, 'must be an object');
    }
    return { name: entry.name, options: options as Record<string, unknown> | undefined };
  });
}

function normaliseSource(
  input: PydocsSourceInput | undefined,
  optionPath: string,
  projectRoot: string,
): NormalisedSource | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) throw configError(optionPath, "must be an object with 'file' or 'url'");
  const file = input.file;
  const url = input.url;
  if (file !== undefined && url !== undefined) {
    throw configError(optionPath, "set either 'file' or 'url', not both");
  }
  if (typeof file === 'string' && file.trim() !== '') {
    return { kind: 'file', path: path.resolve(projectRoot, file) };
  }
  if (typeof url === 'string' && url.trim() !== '') {
    assertUrl(url, `${optionPath}.url`);
    return { kind: 'url', url, cache: normaliseCacheMode(input.cache, `${optionPath}.cache`) };
  }
  throw configError(optionPath, "must set 'file' (a path) or 'url'");
}

function assertUrl(value: string, optionPath: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw configError(optionPath, 'must be an http(s) URL');
    }
  } catch (cause) {
    if (cause instanceof PydocsError) throw cause;
    throw configError(optionPath, `is not a valid URL: ${value}`);
  }
}

function normaliseCacheMode(value: unknown, optionPath: string): CacheMode {
  if (value === undefined) return 'revalidate';
  if (typeof value !== 'string' || !CACHE_MODES.includes(value as CacheMode)) {
    throw configError(optionPath, `must be one of ${CACHE_MODES.join(', ')}`);
  }
  return value as CacheMode;
}

function normaliseSourceLink(
  input: PydocsSourceLinkInput | undefined,
  optionPath: string,
  projectRoot: string,
): NormalisedSourceLink | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) throw configError(optionPath, "must be an object with 'template' or 'host'");
  const ref = input.ref === undefined ? 'main' : input.ref;
  if (typeof ref !== 'string' || ref.trim() === '')
    throw configError(`${optionPath}.ref`, 'must be a non-empty string');

  const rootInput = input.root;
  if (rootInput !== undefined && (typeof rootInput !== 'string' || rootInput.trim() === '')) {
    throw configError(`${optionPath}.root`, 'must be a non-empty path');
  }
  const root = rootInput === undefined ? undefined : path.resolve(projectRoot, rootInput);

  if (typeof input.template === 'string') {
    if (input.template.trim() === '') throw configError(`${optionPath}.template`, 'must be a non-empty string');
    if (!input.template.includes('{path}')) {
      throw configError(`${optionPath}.template`, "must contain the '{path}' placeholder");
    }
    return { template: input.template, ref, root };
  }

  const host = input.host;
  if (typeof host !== 'string' || !(host in SOURCE_LINK_PRESETS)) {
    throw configError(`${optionPath}.host`, `must be one of ${Object.keys(SOURCE_LINK_PRESETS).join(', ')}`);
  }
  const repo = input.repo;
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw configError(`${optionPath}.repo`, "must be an 'owner/name' repository slug");
  }
  const preset = SOURCE_LINK_PRESETS[host as PydocsSourceLinkPreset['host']];
  return { template: preset(repo), ref, root };
}

function normaliseFilters(input: PydocsFiltersInput | undefined, optionPath: string): NormalisedFilters {
  if (input === undefined) return { special: false, private: false, imported: false, inherited: true };
  if (!isPlainObject(input)) throw configError(optionPath, 'must be an object');
  const read = (key: keyof NormalisedFilters, fallback: boolean): boolean => {
    const value = input[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw configError(`${optionPath}.${key}`, 'must be a boolean');
    return value;
  };
  return {
    special: read('special', false),
    private: read('private', false),
    imported: read('imported', false),
    inherited: read('inherited', true),
  };
}

function normaliseMembers(input: PydocsMembersInput | undefined, optionPath: string): NormalisedMembers {
  if (input === undefined) return { include: [], exclude: [] };
  if (!isPlainObject(input)) throw configError(optionPath, 'must be an object');
  return {
    include: input.include === undefined ? [] : requireStringArray(input.include, `${optionPath}.include`),
    exclude: input.exclude === undefined ? [] : requireStringArray(input.exclude, `${optionPath}.exclude`),
  };
}

function normaliseVersions(
  input: PydocsVersionsInput | undefined,
  optionPath: string,
  source: NormalisedSource | undefined,
): PydocsVersionsConfig {
  if (input === undefined) return { refs: [] };
  if (!isPlainObject(input)) throw configError(optionPath, "must be an object with a 'refs' array");
  if (source !== undefined) {
    // A pinned dump describes one release and carries no history to compare
    // against; the refs have to be extracted from a checkout.
    throw configError(
      optionPath,
      'needs source extraction, so it cannot be combined with a pre-generated ' +
        "'source' dump; document that release as its own packages entry instead",
    );
  }

  const refsInput = input.refs;
  if (!Array.isArray(refsInput) || refsInput.length === 0) {
    throw configError(`${optionPath}.refs`, 'must be a non-empty array of { ref, label }, oldest first');
  }

  return {
    refs: refsInput.map((entry, index) => {
      const entryPath = `${optionPath}.refs[${index}]`;
      if (!isPlainObject(entry) || typeof entry.ref !== 'string' || entry.ref.trim() === '') {
        throw configError(`${entryPath}.ref`, 'must be a non-empty string');
      }
      if (typeof entry.label !== 'string' || entry.label.trim() === '') {
        throw configError(`${entryPath}.label`, 'must be a non-empty string');
      }
      return { ref: entry.ref, label: entry.label };
    }),
  };
}

function normaliseInventory(
  input: PydocsInventoryConfigInput,
  optionPath: string,
  projectRoot: string,
): NormalisedInventory {
  if (typeof input === 'string') {
    if (!(input in INVENTORY_PRESETS)) {
      throw configError(
        optionPath,
        `unknown preset '${input}'; known presets: ${Object.keys(INVENTORY_PRESETS).join(', ')}`,
      );
    }
    const preset = INVENTORY_PRESETS[input];
    return { url: preset.url, file: undefined, base: preset.base, cache: 'revalidate' };
  }
  if (!isPlainObject(input)) throw configError(optionPath, "must be a preset name or an object with 'url' or 'file'");

  const cache = normaliseCacheMode(input.cache, `${optionPath}.cache`);
  const base = input.base;
  if (base !== undefined && (typeof base !== 'string' || base.trim() === '')) {
    throw configError(`${optionPath}.base`, 'must be a non-empty string');
  }

  if (typeof input.url === 'string' && input.url.trim() !== '') {
    if (input.file !== undefined) throw configError(optionPath, "set either 'url' or 'file', not both");
    assertUrl(input.url, `${optionPath}.url`);
    const resolvedBase = base ?? input.url.replace(/[^/]*$/, '');
    return { url: input.url, file: undefined, base: withTrailingSlash(resolvedBase), cache };
  }
  if (typeof input.file === 'string' && input.file.trim() !== '') {
    if (base === undefined) {
      throw configError(`${optionPath}.base`, "is required when the inventory is a local 'file'");
    }
    return {
      url: undefined,
      file: path.resolve(projectRoot, input.file),
      base: withTrailingSlash(base),
      cache,
    };
  }
  throw configError(optionPath, "must set 'url' or 'file'");
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalisePackage(input: PydocsPackageInput, optionPath: string, projectRoot: string): PydocsPackageConfig {
  if (!isPlainObject(input)) throw configError(optionPath, 'must be an object');
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw configError(`${optionPath}.name`, 'is required and must be the Python import name of the package');
  }
  if (!PACKAGE_NAME_PATTERN.test(name)) {
    throw configError(`${optionPath}.name`, `'${name}' is not a valid Python import name`);
  }

  const base = stripLeadingAndTrailingSlashes(input.base ?? `api/${name}`);
  if (base === '') {
    throw configError(`${optionPath}.base`, 'must not be empty or the site root');
  }
  if (/[?#\s]/.test(base)) {
    throw configError(`${optionPath}.base`, 'must be a plain URL path without query, fragment or spaces');
  }

  const label = input.label ?? name;
  if (typeof label !== 'string' || label.trim() === '') {
    throw configError(`${optionPath}.label`, 'must be a non-empty string');
  }

  const style = input.docstringStyle ?? 'google';
  if (!DOCSTRING_STYLES.includes(style)) {
    throw configError(`${optionPath}.docstringStyle`, `must be one of ${DOCSTRING_STYLES.join(', ')}`);
  }

  const docstringOptions = input.docstringOptions ?? {};
  if (!isPlainObject(docstringOptions)) throw configError(`${optionPath}.docstringOptions`, 'must be an object');

  const searchInput = input.search;
  const search =
    searchInput === undefined
      ? [projectRoot]
      : requireStringArray(searchInput, `${optionPath}.search`).map((entry) => path.resolve(projectRoot, entry));

  const sidebarInput = input.sidebar ?? {};
  if (!isPlainObject(sidebarInput)) throw configError(`${optionPath}.sidebar`, 'must be an object');
  const sidebarLabel = sidebarInput.label ?? label;
  if (typeof sidebarLabel !== 'string' || sidebarLabel.trim() === '') {
    throw configError(`${optionPath}.sidebar.label`, 'must be a non-empty string');
  }
  const collapsed = sidebarInput.collapsed ?? false;
  if (typeof collapsed !== 'boolean') throw configError(`${optionPath}.sidebar.collapsed`, 'must be a boolean');

  const groupInput = sidebarInput.group;
  let group: string | undefined;
  if (groupInput !== undefined) {
    if (!isPlainObject(groupInput) || typeof groupInput.label !== 'string' || groupInput.label.trim() === '') {
      throw configError(`${optionPath}.sidebar.group`, 'must be a placeholder from createPydocsSidebarGroup()');
    }
    group = groupInput.label;
  }

  const forceInspection = input.forceInspection ?? false;
  if (typeof forceInspection !== 'boolean') throw configError(`${optionPath}.forceInspection`, 'must be a boolean');

  const source = normaliseSource(input.source, `${optionPath}.source`, projectRoot);

  return {
    name,
    base,
    label,
    search,
    docstringStyle: style,
    docstringOptions,
    extensions: normaliseExtensions(input.extensions, `${optionPath}.extensions`),
    extraRequirements:
      input.extraRequirements === undefined
        ? []
        : requireStringArray(input.extraRequirements, `${optionPath}.extraRequirements`),
    forceInspection,
    source,
    members: normaliseMembers(input.members, `${optionPath}.members`),
    filters: normaliseFilters(input.filters, `${optionPath}.filters`),
    sourceLink: normaliseSourceLink(input.sourceLink, `${optionPath}.sourceLink`, projectRoot),
    sidebar: { label: sidebarLabel, collapsed, group },
    versions: normaliseVersions(input.versions, `${optionPath}.versions`, source),
  };
}

/** True when `base` is the same page as, or a descendant of, `other`. */
function basesOverlap(base: string, other: string): boolean {
  return base === other || base.startsWith(`${other}/`) || other.startsWith(`${base}/`);
}

/**
 * Validate a user configuration and fill in every default.
 *
 * @param user - The options object as written in the Astro config.
 * @param projectRoot - Absolute path every relative path is resolved against
 *   (Astro's `config.root`).
 * @throws {PydocsError} With a message naming the offending option, e.g.
 *   `packages[1].base: must not be empty or the site root`.
 */
export function normalizeConfig(user: PydocsUserConfig, projectRoot: string): PydocsConfig {
  if (!isPlainObject(user)) throw new PydocsError('starlight-pydocs: options must be an object');
  if (!path.isAbsolute(projectRoot)) {
    throw new PydocsError(`starlight-pydocs: projectRoot must be an absolute path, got '${projectRoot}'`);
  }

  const packagesInput = user.packages;
  if (!Array.isArray(packagesInput) || packagesInput.length === 0) {
    throw configError('packages', 'must be a non-empty array of packages to document');
  }

  const packages = packagesInput.map((entry, index) => normalisePackage(entry, `packages[${index}]`, projectRoot));

  // Bases, not names, identify an entry: one package may be documented several
  // times (a version at a time) as long as each has its own place in the site.
  const seenBases = new Map<string, number>();
  packages.forEach((pkg, index) => {
    for (const [otherBase, otherIndex] of seenBases) {
      if (basesOverlap(pkg.base, otherBase)) {
        throw configError(
          `packages[${index}].base`,
          `'${pkg.base}' overlaps packages[${otherIndex}].base ('${otherBase}'); give each package a distinct base`,
        );
      }
    }
    seenBases.set(pkg.base, index);
  });

  const runnerInput = user.runner ?? {};
  if (!isPlainObject(runnerInput)) throw configError('runner', 'must be an object');
  const command =
    runnerInput.command === undefined ? undefined : requireStringArray(runnerInput.command, 'runner.command');
  if (command !== undefined && command.length === 0) {
    throw configError('runner.command', 'must contain at least the executable');
  }
  const python = runnerInput.python;
  if (python !== undefined && (typeof python !== 'string' || python.trim() === '')) {
    throw configError('runner.python', 'must be a non-empty string');
  }

  const inventoriesInput = user.inventories ?? [];
  if (!Array.isArray(inventoriesInput)) throw configError('inventories', 'must be an array');
  const inventories = inventoriesInput.map((entry, index) =>
    normaliseInventory(entry, `inventories[${index}]`, projectRoot),
  );

  const components = user.components ?? {};
  if (!isPlainObject(components)) throw configError('components', 'must be an object');
  for (const [key, value] of Object.entries(components)) {
    if (!(OVERRIDABLE_COMPONENTS as readonly string[]).includes(key)) {
      throw configError(`components.${key}`, `is not overridable; choose one of ${OVERRIDABLE_COMPONENTS.join(', ')}`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw configError(`components.${key}`, 'must be an import path or specifier');
    }
  }

  const booleanOption = (value: unknown, optionPath: string, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw configError(optionPath, 'must be a boolean');
    return value;
  };

  const cacheDirInput = user.cacheDir;
  if (cacheDirInput !== undefined && (typeof cacheDirInput !== 'string' || cacheDirInput.trim() === '')) {
    throw configError('cacheDir', 'must be a non-empty string');
  }

  return {
    packages,
    runner: { command, python },
    inventories,
    publishInventory: booleanOption(user.publishInventory, 'publishInventory', true),
    symbolSearch: booleanOption(user.symbolSearch, 'symbolSearch', true),
    llmsTxt: booleanOption(user.llmsTxt, 'llmsTxt', true),
    components: components as Partial<Record<OverridableComponentName, string>>,
    injectStyles: booleanOption(user.injectStyles, 'injectStyles', true),
    cacheDir: path.resolve(projectRoot, cacheDirInput ?? path.join('node_modules', '.astro')),
    projectRoot,
  };
}

/** Expand a source-link template for one object. */
export function formatSourceLink(link: NormalisedSourceLink, file: string, startLine: number, endLine: number): string {
  return link.template
    .replaceAll('{ref}', link.ref)
    .replaceAll('{path}', file.split(path.sep).join('/'))
    .replaceAll('{start}', String(startLine))
    .replaceAll('{end}', String(endLine));
}
