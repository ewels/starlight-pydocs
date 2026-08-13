/** Shared helpers for the unit tests. Not a test file itself. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  NormalisedFilters,
  NormalisedMembers,
  NormalisedSourceLink,
  PydocsConfig,
  PydocsPackageConfig,
} from '../lib/config.ts';
import type { ModelOptions, PackageModel } from '../lib/model.ts';
import { buildModel } from '../lib/model.ts';
import type { GriffeDump } from '../lib/types.ts';

/** Absolute path of the repository root, derived from this file's location. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function fixturePath(...segments: string[]): string {
  return path.join(repoRoot, 'fixtures', ...segments);
}

export function testFixturePath(...segments: string[]): string {
  return path.join(repoRoot, 'packages', 'starlight-pydocs', 'tests', 'fixtures', ...segments);
}

export async function loadFixtureDump(pkgName: string): Promise<GriffeDump> {
  return JSON.parse(await fs.readFile(fixturePath(pkgName, 'dump.json'), 'utf8')) as GriffeDump;
}

/**
 * The single package of a normalised test configuration. Every extraction test
 * configures exactly one, and `packages[0]` is optional under
 * `noUncheckedIndexedAccess`.
 */
export function onlyPackage(config: PydocsConfig): PydocsPackageConfig {
  const pkg = config.packages[0];
  if (pkg === undefined) throw new Error('no package');
  return pkg;
}

export const defaultFilters: NormalisedFilters = {
  special: false,
  private: false,
  imported: false,
  inherited: true,
};

export const noMembers: NormalisedMembers = { include: [], exclude: [] };

export interface ModelOverrides {
  base?: string;
  members?: Partial<NormalisedMembers>;
  filters?: Partial<NormalisedFilters>;
  sourceLink?: NormalisedSourceLink;
  addedIn?: ReadonlyMap<string, string>;
}

export function modelOptions(pkgName: string, overrides: ModelOverrides = {}): ModelOptions {
  return {
    packageName: pkgName,
    base: overrides.base ?? `api/${pkgName}`,
    members: { ...noMembers, ...overrides.members },
    filters: { ...defaultFilters, ...overrides.filters },
    sourceLink: overrides.sourceLink,
    addedIn: overrides.addedIn,
  };
}

/** Build a model straight from a checked-in dump. */
export async function fixtureModel(pkgName: string, overrides: ModelOverrides = {}): Promise<PackageModel> {
  return buildModel(await loadFixtureDump(pkgName), modelOptions(pkgName, overrides));
}

/** Member names of a documented object, in render order. */
export function memberNames(model: PackageModel, dottedPath: string): string[] {
  const object = model.objectsByPath.get(dottedPath);
  if (object === undefined) throw new Error(`no documented object at ${dottedPath}`);
  return object.members.map((member) => member.name);
}
