import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { sidebar, signature } from '../helpers.ts';

/**
 * `demopkg` is documented twice by one plugin instance: from the fixture source
 * at `api/demopkg`, and from the checked-in dump at `1x/api/demopkg`. These
 * assertions are what makes that supported rather than incidental.
 */

/** Internal pydocs hrefs inside the page content, ignoring the site navigation. */
async function contentHrefs(page: Page): Promise<string[]> {
  return page
    .locator('main .sl-markdown-content a[href^="/starlight-pydocs/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

test('both documented versions of one package build their own pages', async ({ page }) => {
  await page.goto('api/demopkg/report/');
  await expect(page.locator('h1')).toHaveText('demopkg.report');
  await expect(signature(page, 'demopkg.report.Report')).toContainText('class Report(');

  await page.goto('1x/api/demopkg/report/');
  await expect(page.locator('h1')).toHaveText('demopkg.report');
  await expect(signature(page, 'demopkg.report.Report')).toContainText('class Report(');
});

test('each version links only within its own base', async ({ page }) => {
  await page.goto('1x/api/demopkg/report/');
  const pinned = await contentHrefs(page);
  expect(pinned.length).toBeGreaterThan(10);
  expect(pinned.filter((href) => !href.startsWith('/starlight-pydocs/1x/api/demopkg/'))).toEqual([]);

  await page.goto('api/demopkg/report/');
  const current = await contentHrefs(page);
  expect(current.length).toBeGreaterThan(10);
  expect(current.filter((href) => href.startsWith('/starlight-pydocs/1x/'))).toEqual([]);
});

test('each version gets its own sidebar group, under the section it was configured for', async ({ page }) => {
  await page.goto('1x/api/demopkg/');

  const current = sidebar(page).locator('details:has(> summary:has-text("API reference"))');
  await expect(current.locator('a[href$="/api/demopkg/"]')).toHaveCount(1);
  await expect(current.locator('a[href$="/1x/api/demopkg/"]')).toHaveCount(0);

  const legacy = sidebar(page).locator('details:has(> summary:has-text("v1.x"))');
  await expect(legacy.locator('summary:has-text("demopkg 1.x")')).toHaveCount(1);
  await expect(legacy.locator('a[href$="/1x/api/demopkg/"]')).toHaveCount(1);

  await legacy.getByRole('link', { name: 'report' }).click();
  await expect(page).toHaveURL(/\/1x\/api\/demopkg\/report\/$/);
});

test('each version serves its own endpoints', async ({ request }) => {
  const symbols = (await (await request.get('1x/api/demopkg/symbols.json')).json()) as {
    package: string;
    base: string;
    symbols: { path: string; page: string }[];
  };
  expect(symbols.package).toBe('demopkg');
  expect(symbols.base).toBe('1x/api/demopkg');
  expect(symbols.symbols.every((symbol) => symbol.page.startsWith('1x/api/demopkg'))).toBe(true);

  const llms = await (await request.get('1x/api/demopkg/llms.txt')).text();
  expect(llms.startsWith('# demopkg 1.x')).toBe(true);
  expect(llms).toContain('Rendered pages: https://ewels.github.io/starlight-pydocs/1x/api/demopkg/');
});
