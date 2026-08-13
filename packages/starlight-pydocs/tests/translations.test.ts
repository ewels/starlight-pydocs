import { describe, expect, test } from 'vitest';

import { TRANSLATION_PREFIX, translationKey } from '../lib/i18n.ts';
import { STRINGS, stringKeys } from '../lib/strings.ts';
import { Translations } from '../translations.ts';

/** Locales the package ships beyond English. */
const LOCALES = ['de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'no', 'pt-BR', 'ru', 'sv', 'zh'];

/** Keys that are Python or pydantic identifiers, so no locale translates them. */
const UNTRANSLATED: string[] = [
  'labelClassmethod',
  'labelStaticmethod',
  'labelAsync',
  'labelAbstract',
  'labelCached',
  'labelPydanticModel',
  'labelPydanticField',
  'labelPydanticValidator',
];

function bareKeys(table: Record<string, string>): string[] {
  return Object.keys(table).map((key) => key.slice(TRANSLATION_PREFIX.length));
}

describe('Translations', () => {
  test('ships English plus every documented locale', () => {
    expect(Object.keys(Translations).sort()).toEqual(['en', ...LOCALES].sort());
  });

  test('the en table is every string, namespaced', () => {
    const en = Translations['en'];
    expect(en).toBeDefined();
    for (const key of stringKeys()) {
      expect(en?.[translationKey(key)], key).toBe(STRINGS[key]);
    }
    expect(Object.keys(en ?? {})).toHaveLength(stringKeys().length);
  });

  test('every key of every locale exists in STRINGS', () => {
    const known = new Set<string>(stringKeys());
    for (const [locale, table] of Object.entries(Translations)) {
      for (const key of bareKeys(table)) {
        expect(known.has(key), `${locale} translates '${key}', which is not a string key`).toBe(true);
      }
    }
  });

  test('every key is namespaced so it cannot collide with another plugin', () => {
    for (const table of Object.values(Translations)) {
      for (const key of Object.keys(table)) expect(key.startsWith(TRANSLATION_PREFIX)).toBe(true);
    }
  });

  test('every value is a non-empty string', () => {
    for (const [locale, table] of Object.entries(Translations)) {
      for (const [key, value] of Object.entries(table)) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  test('each locale translates every string but the Python identifiers', () => {
    const expected = stringKeys().filter((key) => !UNTRANSLATED.includes(key));
    for (const locale of LOCALES) {
      const table = Translations[locale];
      expect(table, locale).toBeDefined();
      const translated = new Set(bareKeys(table ?? {}));
      const missing = expected.filter((key) => !translated.has(key));
      // Italian keeps "overload" as an invariable noun, so its singular is the
      // English default rather than a repeated entry.
      expect(missing, `${locale} is missing translations`).toEqual(locale === 'it' ? ['overload'] : []);
    }
  });

  test('no locale translates a Python or pydantic identifier', () => {
    for (const locale of LOCALES) {
      const translated = new Set(bareKeys(Translations[locale] ?? {}));
      for (const key of UNTRANSLATED) {
        expect(translated.has(key), `${locale} should leave '${key}' in English`).toBe(false);
      }
    }
  });

  test('the untranslated list only names real string keys', () => {
    const known = new Set<string>(stringKeys());
    for (const key of UNTRANSLATED) expect(known.has(key), key).toBe(true);
  });

  test('translations differ from English where a language has its own word', () => {
    // A table full of English strings would pass every check above.
    for (const locale of LOCALES) {
      const table = Translations[locale] ?? {};
      const differing = Object.entries(table).filter(
        ([key, value]) => value !== STRINGS[key.slice(TRANSLATION_PREFIX.length) as keyof typeof STRINGS],
      );
      expect(differing.length, locale).toBeGreaterThan(40);
    }
  });
});
