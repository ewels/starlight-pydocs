/** The single error type thrown by the framework-free core. */

/**
 * Error raised for anything the user can fix: invalid configuration, a missing
 * extraction toolchain, an unreadable dump. Messages are written to be read in
 * a terminal, so they name the option that is wrong and what to do about it.
 */
export class PydocsError extends Error {
  override readonly name = 'PydocsError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Build a configuration error whose message is prefixed with the dotted path of
 * the offending option, e.g. `packages[0].base: must not be empty`.
 */
export function configError(optionPath: string, message: string): PydocsError {
  return new PydocsError(`${optionPath}: ${message}`);
}
