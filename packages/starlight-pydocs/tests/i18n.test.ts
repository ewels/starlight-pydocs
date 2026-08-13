import { describe, expect, test } from 'vitest';

import { createStringResolver, getTranslate, resolveString, translationKey } from '../lib/i18n.ts';
import { STRINGS, stringKeys } from '../lib/strings.ts';
import { Translations } from '../translations.ts';

describe('resolveString', () => {
  test('falls back to the English default', () => {
    expect(resolveString('parameters', undefined, undefined)).toBe('Parameters');
  });

  test('an override wins over everything', () => {
    expect(resolveString('parameters', 'Argumente', () => 'Paramètres')).toBe('Argumente');
  });

  test('an empty override is ignored', () => {
    expect(resolveString('parameters', '', undefined)).toBe('Parameters');
  });

  test('uses the namespaced translation when the host has one', () => {
    const translate = (key: string): string => (key === 'starlightPydocs.parameters' ? 'Paramètres' : key);
    expect(resolveString('parameters', undefined, translate)).toBe('Paramètres');
  });

  test('ignores a translation function that echoes the key', () => {
    expect(resolveString('returns', undefined, (key) => key)).toBe('Returns');
  });
});

describe('getTranslate', () => {
  test('reads t() off locals', () => {
    const translate = getTranslate({ t: (key: string) => `x${key}` });
    expect(translate?.('a')).toBe('xa');
  });

  test('is undefined outside Starlight', () => {
    expect(getTranslate({})).toBeUndefined();
    expect(getTranslate(null)).toBeUndefined();
    expect(getTranslate('nonsense')).toBeUndefined();
  });
});

describe('createStringResolver', () => {
  test('applies the component labels prop, then translations, then English', () => {
    const locals = { t: (key: string) => (key === 'starlightPydocs.returns' ? 'Retourne' : key) };
    const resolve = createStringResolver(locals, { parameters: 'Args' });
    expect(resolve('parameters')).toBe('Args');
    expect(resolve('returns')).toBe('Retourne');
    expect(resolve('raises')).toBe('Raises');
  });

  test('a call-site override still wins', () => {
    const resolve = createStringResolver({}, { parameters: 'Args' });
    expect(resolve('parameters', 'Inputs')).toBe('Inputs');
  });
});

describe('Translations', () => {
  test('the en table is every string, namespaced', () => {
    const en = Translations['en'];
    expect(en).toBeDefined();
    for (const key of stringKeys()) {
      expect(en?.[translationKey(key)], key).toBe(STRINGS[key]);
    }
    expect(Object.keys(en ?? {})).toHaveLength(stringKeys().length);
  });

  test('every key is namespaced so it cannot collide with another plugin', () => {
    for (const table of Object.values(Translations)) {
      for (const key of Object.keys(table)) expect(key.startsWith('starlightPydocs.')).toBe(true);
    }
  });
});
