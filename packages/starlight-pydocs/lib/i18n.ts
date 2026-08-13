/**
 * Label resolution for the components.
 *
 * Precedence: an explicit prop wins, then Starlight's `t()` if the host has a
 * translation, then the bundled English default from `strings.ts`. That is what
 * lets one component set work in a translated Starlight site and in a plain
 * Astro project with nothing but label props.
 *
 * Starlight's translation keys are namespaced (`starlightPydocs.parameters`)
 * because they share one global table with every other plugin; our own keys
 * stay bare so `strings.ts` remains the single readable source. The prefix is
 * applied here, in one place.
 */

import type { StringKey, StringOverrides } from './strings.ts';
import { STRINGS } from './strings.ts';

/** Prefix for the keys injected into Starlight's translation tables. */
export const TRANSLATION_PREFIX = 'starlightPydocs.';

/** A translation function, as Starlight provides on `Astro.locals.t`. */
export type Translate = (key: string) => string;

/** The Starlight translation key for one of our string keys. */
export function translationKey(key: StringKey): string {
  return `${TRANSLATION_PREFIX}${key}`;
}

/**
 * Resolve one label.
 *
 * @param key - Key in `STRINGS`.
 * @param override - Value from a component prop, which always wins.
 * @param translate - Starlight's `t()`, when the host is Starlight.
 */
export function resolveString(key: StringKey, override: string | undefined, translate: Translate | undefined): string {
  if (override !== undefined && override !== '') return override;
  if (translate !== undefined) {
    const namespaced = translationKey(key);
    const value = translate(namespaced);
    // Starlight returns the key itself when nothing translates it.
    if (typeof value === 'string' && value !== '' && value !== namespaced) return value;
  }
  return STRINGS[key];
}

/**
 * Read Starlight's translation function off `Astro.locals` without importing
 * `@astrojs/starlight`, so components keep working in vanilla Astro.
 */
export function getTranslate(locals: unknown): Translate | undefined {
  if (typeof locals !== 'object' || locals === null) return undefined;
  const translate = (locals as Record<string, unknown>)['t'];
  return typeof translate === 'function' ? (translate as Translate) : undefined;
}

/** Resolve a label, optionally overridden at the call site. */
export type StringResolver = (key: StringKey, override?: string | undefined) => string;

/**
 * Bind a resolver to `Astro.locals` and a component's `labels` prop, so
 * components do not repeat the lookup dance for every label.
 */
export function createStringResolver(locals: unknown, overrides?: StringOverrides | undefined): StringResolver {
  const translate = getTranslate(locals);
  return (key, override) => resolveString(key, override ?? overrides?.[key], translate);
}
