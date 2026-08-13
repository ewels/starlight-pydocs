import { expect, test } from '@playwright/test';

import { searchSymbols, symbolSearch } from '../helpers.ts';

test('the symbol search element finds an object and the keyboard navigates to it', async ({ page }) => {
  // The autodoc guide places `<SymbolSearch />` by hand; the element fetches
  // `symbols.json` on first focus.
  await page.goto('guides/autodoc/');

  const { input, options } = await searchSymbols(page, 'generate');
  await expect(options.first()).toBeVisible();
  await expect(options.first()).toContainText('demopkg.Report.generate');
  await expect(input).toHaveAttribute('aria-expanded', 'true');

  await input.press('ArrowDown');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');

  await expect(page).toHaveURL(/\/api\/demopkg\/#demopkg\.Report\.generate$/);
  await expect(page.locator('[id="demopkg.Report.generate"]')).toBeVisible();
});

test('the generated package page carries a search box, and module pages do not', async ({ page }) => {
  await page.goto('api/demopkg/');
  await expect(symbolSearch(page).root).toHaveCount(1);

  await page.goto('api/demopkg/report/');
  await expect(symbolSearch(page).root).toHaveCount(0);
});

test('the symbol search element reports when nothing matches', async ({ page }) => {
  await page.goto('guides/autodoc/');

  const { empty, root } = await searchSymbols(page, 'nosuchsymbol');
  await expect(empty).toBeVisible();
  await expect(root.locator('.pyd-search-option')).toHaveCount(0);
});

test('Pagefind indexes the generated pages', async ({ page }) => {
  await page.goto('');

  await page.getByRole('button', { name: 'Search' }).click();
  const dialog = page.locator('dialog[aria-label="Search"]');
  const input = dialog.locator('input[type="text"]');
  await input.fill('generate_report');

  const result = dialog.locator('a[href*="/api/demopkg/"]').first();
  await expect(result).toBeVisible({ timeout: 15_000 });

  await result.click();
  await expect(page).toHaveURL(/\/api\/demopkg\//);
  await expect(page.locator('.pyd-module')).toBeVisible();
});
