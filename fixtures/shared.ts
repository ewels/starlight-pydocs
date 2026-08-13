/**
 * The bits both fixture generators need.
 *
 * These scripts run through node's type-stripping loader (`node
 * --experimental-strip-types`), so relative imports carry an explicit `.ts`
 * extension, as everywhere else in the Node-side code.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root, derived from this file's location. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run a generator, reporting a failure as one line and a non-zero exit code.
 *
 * These are developer scripts run by hand, so a stack trace is noise: what
 * matters is which step failed and that `pnpm` reports the failure.
 */
export async function runScript(main: () => Promise<void>): Promise<void> {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
