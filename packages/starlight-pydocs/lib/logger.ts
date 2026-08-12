/**
 * Logging seam for the framework-free core.
 *
 * Callers pass their host logger in (Astro's `AstroIntegrationLogger` satisfies
 * this shape), so nothing in `lib/` writes to the console itself.
 */

export interface PydocsLogger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

/** Logger that swallows everything. Used as the default in tests and library calls. */
export const silentLogger: PydocsLogger = {
  info() {},
  warn() {},
  debug() {},
};

/** Collects messages in memory. Handy for asserting on warnings in tests. */
export function createMemoryLogger(): PydocsLogger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info(message) {
      messages.push(`info: ${message}`);
    },
    warn(message) {
      messages.push(`warn: ${message}`);
    },
    debug(message) {
      messages.push(`debug: ${message}`);
    },
  };
}
