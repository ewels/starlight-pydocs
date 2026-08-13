/**
 * "Added in" annotations, computed by comparing the object paths of dumps taken
 * at successive git refs.
 *
 * `griffe check` has no machine-readable output (ARCHITECTURE.md decision 12), so the
 * comparison is ours: a dump lists every object path it contains, and the first
 * listed version containing a path is the version that introduced it. Everything
 * in this module is pure: the git work and the extraction live in
 * `lib/ref-extract.ts`, so the diff can be unit tested over hand-written dumps.
 *
 * Two deliberate rules:
 *
 * 1. Objects present in the **oldest** listed ref get no label. That ref is
 *    pre-history: "added in 1.0" on two thirds of a package's surface is noise,
 *    and it would be wrong for anything that predates 1.0.
 * 2. Objects in **no** listed ref get no label either. They are newer than the
 *    newest ref, and the current source has no version number to show.
 */

import type { GriffeDump, GriffeObject } from './types.ts';
import { memberList } from './types.ts';

/** One extracted ref, in configuration order (oldest first). */
export interface VersionSnapshot {
  /** Version label to badge with, e.g. `1.1`. */
  label: string;
  /** Every object path the ref's dump contains. */
  paths: Iterable<string>;
}

/** The sidecar written beside a dump: documented path → version label. */
export interface VersionAnnotations {
  addedIn: Record<string, string>;
}

/**
 * Every object path a dump contains, aliases included.
 *
 * Alias members carry their own path as well as a `target_path`, so a
 * re-exported object is recorded at both the path it is exposed at and the path
 * it is defined at, which is what {@link addedInLabel} looks up.
 */
export function collectDumpPaths(dump: GriffeDump): Set<string> {
  const paths = new Set<string>();

  const visit = (object: GriffeObject): void => {
    if (typeof object?.path !== 'string' || paths.has(object.path)) return;
    paths.add(object.path);
    for (const member of memberList(object)) visit(member);
  };

  for (const entry of Object.values(dump)) visit(entry);
  return paths;
}

/**
 * Label of the version each path first appears in.
 *
 * @param snapshots - Extracted refs, oldest first.
 * @returns A map of path → label, holding only paths that deserve a badge:
 *   anything already present in the oldest snapshot is recorded as seen and
 *   omitted. Paths that later disappeared stay in the map; nothing looks them up.
 */
export function firstSeenLabels(snapshots: VersionSnapshot[]): Map<string, string> {
  const labels = new Map<string, string>();
  const seen = new Set<string>();

  snapshots.forEach((snapshot, index) => {
    for (const path of snapshot.paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      if (index > 0) labels.set(path, snapshot.label);
    }
  });

  return labels;
}

/**
 * The badge label for one object, or undefined when it deserves none.
 *
 * The documented path is tried first, then the canonical one: a re-exported or
 * inherited member is documented at a path no dump ever contained, and the
 * definition's history is the honest answer for it.
 */
export function addedInLabel(
  labels: ReadonlyMap<string, string> | undefined,
  path: string,
  canonicalPath: string,
): string | undefined {
  if (labels === undefined) return undefined;
  return labels.get(path) ?? labels.get(canonicalPath);
}

/** Turn the labels into the sidecar shape, with sorted keys for stable files. */
export function toVersionAnnotations(labels: ReadonlyMap<string, string>): VersionAnnotations {
  const sorted = [...labels].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return { addedIn: Object.fromEntries(sorted) };
}

/** Read a sidecar back, ignoring anything that is not a string label. */
export function versionLabelsFrom(annotations: VersionAnnotations | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [path, label] of Object.entries(annotations?.addedIn ?? {})) {
    if (typeof label === 'string' && label !== '') labels.set(path, label);
  }
  return labels;
}
