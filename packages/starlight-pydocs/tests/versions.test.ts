import { describe, expect, test } from 'vitest';

import { buildModel } from '../lib/model.ts';
import type { GriffeDump } from '../lib/types.ts';
import {
  addedInLabel,
  collectDumpPaths,
  firstSeenLabels,
  toVersionAnnotations,
  versionLabelsFrom,
} from '../lib/versions.ts';
import { modelOptions } from './helpers.ts';

/**
 * Hand-written dumps rather than fixtures: the diff only reads object paths, and
 * three tiny releases of one package say more about the rules than a real dump
 * would.
 */
function dumpFor(members: Record<string, 'class' | 'function'>): GriffeDump {
  return {
    tinypkg: {
      kind: 'module',
      name: 'tinypkg',
      path: 'tinypkg',
      members: Object.fromEntries(
        Object.entries(members).map(([name, kind]) => [
          name,
          { kind, name, path: `tinypkg.${name}`, is_public: true, labels: [] },
        ]),
      ),
    },
  } as unknown as GriffeDump;
}

const v1 = dumpFor({ Report: 'class', generate: 'function' });
const v2 = dumpFor({ Report: 'class', generate: 'function', publish: 'function' });
const v3 = dumpFor({ Report: 'class', publish: 'function', archive: 'function' });

describe('collectDumpPaths', () => {
  test('lists every object path, nested members included', () => {
    const dump = {
      tinypkg: {
        kind: 'module',
        name: 'tinypkg',
        path: 'tinypkg',
        members: {
          report: {
            kind: 'module',
            name: 'report',
            path: 'tinypkg.report',
            members: {
              Report: {
                kind: 'class',
                name: 'Report',
                path: 'tinypkg.report.Report',
                members: {
                  generate: { kind: 'function', name: 'generate', path: 'tinypkg.report.Report.generate' },
                },
              },
            },
          },
          // A re-export: the alias has a path of its own, so both are recorded.
          Report: { kind: 'alias', name: 'Report', path: 'tinypkg.Report', target_path: 'tinypkg.report.Report' },
        },
      },
    } as unknown as GriffeDump;

    expect([...collectDumpPaths(dump)].sort()).toEqual([
      'tinypkg',
      'tinypkg.Report',
      'tinypkg.report',
      'tinypkg.report.Report',
      'tinypkg.report.Report.generate',
    ]);
  });

  test('ignores entries with no path', () => {
    expect(collectDumpPaths({ tinypkg: { kind: 'module' } } as unknown as GriffeDump).size).toBe(0);
  });
});

describe('firstSeenLabels', () => {
  const labels = firstSeenLabels([
    { label: '1.0', paths: collectDumpPaths(v1) },
    { label: '1.1', paths: collectDumpPaths(v2) },
    { label: '2.0', paths: collectDumpPaths(v3) },
  ]);

  test('labels an object with the version it appeared in', () => {
    expect(labels.get('tinypkg.publish')).toBe('1.1');
    expect(labels.get('tinypkg.archive')).toBe('2.0');
  });

  test('leaves everything present in the oldest ref unlabelled', () => {
    expect(labels.has('tinypkg')).toBe(false);
    expect(labels.has('tinypkg.Report')).toBe(false);
    expect(labels.has('tinypkg.generate')).toBe(false);
  });

  test('keeps the label of an object that was later removed, and nothing looks it up', () => {
    const removed = firstSeenLabels([
      { label: '1.0', paths: ['tinypkg', 'tinypkg.Report'] },
      { label: '1.1', paths: ['tinypkg', 'tinypkg.Report', 'tinypkg.gone'] },
      { label: '2.0', paths: ['tinypkg', 'tinypkg.Report'] },
    ]);
    expect(removed.get('tinypkg.gone')).toBe('1.1');
    expect(addedInLabel(removed, 'tinypkg.Report', 'tinypkg.Report')).toBeUndefined();
  });

  test('a single ref labels nothing: it is all pre-history', () => {
    expect(firstSeenLabels([{ label: '1.0', paths: collectDumpPaths(v1) }]).size).toBe(0);
  });
});

describe('addedInLabel', () => {
  const labels = new Map([['tinypkg.report.Report', '1.1']]);

  test('falls back to the canonical path, so re-exports inherit their definition', () => {
    expect(addedInLabel(labels, 'tinypkg.Report', 'tinypkg.report.Report')).toBe('1.1');
    expect(addedInLabel(labels, 'tinypkg.report.Report', 'tinypkg.report.Report')).toBe('1.1');
    expect(addedInLabel(labels, 'tinypkg.other', 'tinypkg.other')).toBeUndefined();
    expect(addedInLabel(undefined, 'tinypkg.report.Report', 'tinypkg.report.Report')).toBeUndefined();
  });
});

describe('the sidecar', () => {
  test('serialises with sorted keys and reads back', () => {
    const annotations = toVersionAnnotations(
      new Map([
        ['tinypkg.publish', '1.1'],
        ['tinypkg.archive', '2.0'],
      ]),
    );
    expect(Object.keys(annotations.addedIn)).toEqual(['tinypkg.archive', 'tinypkg.publish']);
    expect(versionLabelsFrom(annotations)).toEqual(
      new Map([
        ['tinypkg.archive', '2.0'],
        ['tinypkg.publish', '1.1'],
      ]),
    );
  });

  test('ignores anything that is not a label', () => {
    expect(versionLabelsFrom(undefined).size).toBe(0);
    expect(versionLabelsFrom({ addedIn: { a: '', b: 2 as unknown as string } }).size).toBe(0);
  });
});

describe('the model carries the labels', () => {
  test('addedIn lands on the objects the diff named, and on nothing else', () => {
    const model = buildModel(v3, {
      ...modelOptions('tinypkg'),
      addedIn: firstSeenLabels([
        { label: '1.0', paths: collectDumpPaths(v1) },
        { label: '1.1', paths: collectDumpPaths(v2) },
        { label: '2.0', paths: collectDumpPaths(v3) },
      ]),
    });

    expect(model.objectsByPath.get('tinypkg.archive')?.addedIn).toBe('2.0');
    expect(model.objectsByPath.get('tinypkg.publish')?.addedIn).toBe('1.1');
    expect(model.objectsByPath.get('tinypkg.Report')?.addedIn).toBeUndefined();
  });

  test('no labels means no annotations at all', () => {
    const model = buildModel(v3, modelOptions('tinypkg'));
    expect([...model.objectsByPath.values()].every((doc) => doc.addedIn === undefined)).toBe(true);
  });
});
