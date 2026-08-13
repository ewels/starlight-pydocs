import { expect, test } from '@playwright/test';

import { sidebar } from '../helpers.ts';

test('the sidebar places each package under the section it was configured for', async ({ page }) => {
  await page.goto('api/demopkg/');

  const apiReference = sidebar(page).locator('details:has(> summary:has-text("API reference"))');
  await expect(apiReference.locator('a[href$="/api/demopkg/"]')).toHaveCount(1);
  await expect(apiReference.locator('a[href$="/api/numpkg/"]')).toHaveCount(1);
  // sphpkg has a placeholder of its own, so it must not land in the shared group.
  await expect(apiReference.locator('a[href$="/api/sphpkg/"]')).toHaveCount(0);

  const sphinxDemo = sidebar(page).locator('details:has(> summary:has-text("Sphinx demo"))');
  await expect(sphinxDemo.locator('a[href$="/api/sphpkg/"]')).toHaveCount(1);
  await expect(sphinxDemo.locator('a[href$="/api/demopkg/"]')).toHaveCount(0);
});

test('the module tree lists every module page and its links navigate', async ({ page }) => {
  await page.goto('api/demopkg/');

  const demopkg = sidebar(page).locator('details:has(> summary:has-text("demopkg"))').first();
  await expect(demopkg.locator('a')).toHaveCount(5);

  await demopkg.getByRole('link', { name: 'report' }).click();
  await expect(page).toHaveURL(/\/api\/demopkg\/report\/$/);
  await expect(page.locator('h1')).toHaveText('demopkg.report');
});

test("a package's own page is labelled Overview and marked as current", async ({ page }) => {
  await page.goto('api/demopkg/report/');

  const overview = sidebar(page).getByRole('link', { name: 'Overview' }).first();
  await expect(overview).toHaveAttribute('href', /\/api\/demopkg\/$/);

  const current = sidebar(page).locator('a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute('href', /\/api\/demopkg\/report\/$/);
});

test('generated pages get prev/next pagination', async ({ page }) => {
  await page.goto('api/demopkg/report/');

  const pagination = page.locator('.pagination-links');
  await expect(pagination.locator('a[rel="prev"]')).toHaveAttribute('href', /\/api\/demopkg\/models\/$/);
  await expect(pagination.locator('a[rel="next"]')).toHaveAttribute('href', /\/api\/demopkg\/utils\/$/);

  await pagination.locator('a[rel="next"]').click();
  await expect(page.locator('h1')).toHaveText('demopkg.utils');
});
