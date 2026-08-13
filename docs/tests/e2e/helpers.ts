/**
 * Locators shared by both projects of the suite, the Starlight docs site and the
 * plain Astro example. Not a spec file: it lives above both `testDir`s.
 *
 * The generated markup is addressed through its `data-pydocs-*` attributes and
 * `.pyd-` classes, which are the package's documented contract with themes and
 * tests alike. These helpers spell those selectors once.
 */

import type { Locator, Page } from '@playwright/test';

/** Anything a locator can be scoped to. */
type Scope = Locator | Page;

/**
 * Starlight's site navigation, which it renders once as `nav[aria-label="Main"]`.
 * The docs project only: the example site has no Starlight shell.
 */
export function sidebar(page: Page): Locator {
  return page.locator('nav[aria-label="Main"]');
}

/** The block documenting one object, addressed by its dotted path. */
export function member(scope: Scope, dottedPath: string): Locator {
  return scope.locator(`.pyd-member[data-pydocs-path="${dottedPath}"]`);
}

/** The rendered signature of one object. */
export function signature(scope: Scope, dottedPath: string): Locator {
  return scope.locator(`.pyd-signature[data-pydocs-signature="${dottedPath}"]`);
}

/** A parsed docstring section (`parameters`, `returns`, `raises`, …). */
export function section(scope: Scope, name: string): Locator {
  return scope.locator(`.pyd-section[data-pydocs-section="${name}"]`);
}

/** The symbol search element, with the parts every spec drives it through. */
export function symbolSearch(scope: Scope): {
  root: Locator;
  input: Locator;
  options: Locator;
  empty: Locator;
} {
  const root = scope.locator('pydocs-search');
  return {
    root,
    input: root.locator('.pyd-search-input'),
    options: root.locator('.pyd-search-option[role="option"]'),
    empty: root.locator('.pyd-search-empty'),
  };
}

/**
 * Type into the symbol search box, opening it first.
 *
 * The element fetches `symbols.json` on first focus, so the click matters.
 */
export async function searchSymbols(page: Page, query: string): Promise<ReturnType<typeof symbolSearch>> {
  const search = symbolSearch(page);
  await search.input.click();
  await search.input.fill(query);
  return search;
}
