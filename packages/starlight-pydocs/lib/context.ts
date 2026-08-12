/**
 * The shape of `virtual:starlight-pydocs/context` — the only data carried
 * through a virtual module. Deliberately small: configuration and dump file
 * paths, never the dumps themselves (they are megabytes; `lib/data.ts` reads
 * them lazily from disk, server-side).
 */

export interface PydocsPackageContext {
  /** Python import name of the documented package. */
  name: string;
  /** URL base for the generated pages, without leading or trailing slashes (e.g. `api/demopkg`). */
  base: string;
  /** Absolute path to the cached griffe dump JSON for this package. */
  dumpPath: string;
}

export interface PydocsContext {
  packages: PydocsPackageContext[];
  /** The host project's `base` Astro setting, normalised ('' or '/prefix'). */
  siteBase: string;
  /** Whether the host is Starlight (true) or vanilla Astro (false). */
  starlight: boolean;
  /** Astro trailingSlash setting, used when building hrefs. */
  trailingSlash: 'always' | 'never' | 'ignore';
}
