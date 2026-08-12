import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { STRINGS, resolveLabel, stringKeys } from '../lib/strings.ts';
import type { StringKey } from '../lib/strings.ts';

const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib');

async function readLib(name: string): Promise<string> {
  return fs.readFile(path.join(libDir, name), 'utf8');
}

describe('STRINGS', () => {
  test('every value is a non-empty string', () => {
    for (const key of stringKeys()) {
      expect(typeof STRINGS[key], key).toBe('string');
      expect(STRINGS[key].length, key).toBeGreaterThan(0);
    }
  });

  test('has a key per member group id', async () => {
    const model = await readLib('model.ts');
    const declaration = /GROUP_ORDER: MemberGroupId\[] = \[([^\]]+)]/.exec(model)?.[1];
    expect(declaration).toBeDefined();
    const ids = [...(declaration ?? '').matchAll(/'([a-z]+)'/g)].map(([, id]) => id ?? '');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(stringKeys()).toContain(id as StringKey);
  });

  test('every key the Markdown renderer asks for exists', async () => {
    const source = await readLib('markdown-doc.ts');
    const used = new Set<string>();
    for (const [, key] of source.matchAll(/label\('([A-Za-z]+)'/g)) used.add(key ?? '');
    for (const [, key] of source.matchAll(/'(kind[A-Z][A-Za-z]*|label[A-Z][A-Za-z]*)'/g)) used.add(key ?? '');
    for (const [, key] of source.matchAll(/heading: StringKey =\s*[^;]*?'([a-zA-Z]+)'/g)) used.add(key ?? '');

    expect(used.size).toBeGreaterThan(15);
    for (const key of used) expect(stringKeys(), `${key} is missing from STRINGS`).toContain(key as StringKey);
  });

  test('every key the signature helper names exists', async () => {
    const source = await readLib('signature.ts');
    for (const [, key] of source.matchAll(/return '(parameter[A-Za-z]+)'/g)) {
      expect(stringKeys()).toContain((key ?? '') as StringKey);
    }
  });

  test('covers the labels griffe attaches to the fixture package', () => {
    // Keys a renderer needs for the demopkg surface, spelled out so a rename
    // cannot silently drop a badge.
    for (const key of [
      'labelClassmethod',
      'labelStaticmethod',
      'labelInstanceAttribute',
      'labelClassAttribute',
      'labelModuleAttribute',
      'labelWritable',
      'labelPydanticModel',
      'labelPydanticField',
      'labelPydanticValidator',
      'kindProperty',
    ] as StringKey[]) {
      expect(stringKeys()).toContain(key);
    }
  });

  test('covers every docstring section heading we render', () => {
    for (const key of [
      'parameters',
      'otherParameters',
      'typeParameters',
      'returns',
      'yields',
      'receives',
      'raises',
      'warns',
      'examples',
      'attributes',
      'classes',
      'functions',
      'modules',
      'deprecated',
    ] as StringKey[]) {
      expect(stringKeys()).toContain(key);
    }
  });

  test('covers the search and page furniture the components need', () => {
    for (const key of [
      'searchLabel',
      'searchPlaceholder',
      'searchNoResults',
      'searchResults',
      'searchHint',
      'onPage',
      'apiReference',
      'viewSource',
      'sourceCode',
      'bases',
      'default',
      'required',
      'overload',
      'overloads',
      'inheritedFrom',
      'reexportedFrom',
      'aliasOf',
      'addedIn',
      'columnName',
      'columnType',
      'columnDescription',
      'columnDefault',
      'noMembers',
      'undocumented',
    ] as StringKey[]) {
      expect(stringKeys()).toContain(key);
    }
  });
});

describe('resolveLabel', () => {
  test('returns the English default', () => {
    expect(resolveLabel('parameters')).toBe('Parameters');
  });

  test('lets an override win', () => {
    expect(resolveLabel('parameters', { parameters: 'Argumente' })).toBe('Argumente');
  });

  test('ignores an override for another key', () => {
    expect(resolveLabel('returns', { parameters: 'Argumente' })).toBe('Returns');
  });
});
