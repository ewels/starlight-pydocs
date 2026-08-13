/**
 * Translation tables injected into Starlight through the plugin's `i18n:setup`
 * hook.
 *
 * `lib/strings.ts` is the English source of truth; this module only namespaces
 * its keys (`starlightPydocs.<key>`) so they can share Starlight's global
 * translation table. Locales beyond `en` are added here as plain tables that
 * overlay only the keys they translate — Starlight falls back to English for
 * everything else.
 */

import { translationKey } from './lib/i18n.ts';
import type { StringKey } from './lib/strings.ts';
import { STRINGS, stringKeys } from './lib/strings.ts';

function namespaced(table: Partial<Record<StringKey, string>>): Record<string, string> {
  const entries: [string, string][] = [];
  for (const key of Object.keys(table) as StringKey[]) {
    const value = table[key];
    if (value !== undefined) entries.push([translationKey(key), value]);
  }
  return Object.fromEntries(entries);
}

const english = namespaced(Object.fromEntries(stringKeys().map((key) => [key, STRINGS[key]])));

export const Translations: Record<string, Record<string, string>> = {
  en: english,
};
