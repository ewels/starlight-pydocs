import { expect, test } from '@playwright/test';

/**
 * The plain Astro site in `examples/vanilla`.
 *
 * Two things are under test that the docs site cannot cover: the built-in layout
 * (there is no Starlight to render the page shell) and the unified markdown
 * pipeline (`markdown: { processor: unified() }`), which is the other engine
 * docstring prose has to render through.
 */

test('a generated module page renders through the built-in layout', async ({ page }) => {
  await page.goto('api/demopkg/report/');

  await expect(page).toHaveTitle('demopkg.report');
  await expect(page.locator('h1.pyd-page-title')).toHaveText('demopkg.report');
  await expect(page.locator('.pyd-module[data-pydocs-path="demopkg.report"]')).toBeVisible();

  const toc = page.locator('nav.pyd-toc');
  await expect(toc.locator('.pyd-toc-title')).toHaveText('On this page');
  await expect(toc.locator('a[href="#demopkg.report.Report"]')).toBeVisible();
  await expect(toc.locator('li')).not.toHaveCount(0);

  await expect(page.locator('.pyd-signature[data-pydocs-signature="demopkg.report.Report"]')).toContainText(
    'class Report(',
  );
});

test('the package page lists its submodules', async ({ page }) => {
  await page.goto('api/demopkg/');

  const submodules = page.locator('.pyd-submodules[data-pydocs-group="modules"]');
  await expect(submodules.locator('a')).toHaveCount(4);

  await submodules.getByRole('link', { name: 'utils' }).click();
  await expect(page.locator('h1.pyd-page-title')).toHaveText('demopkg.utils');
});

test('docstring prose is rendered HTML, through the unified pipeline', async ({ page }) => {
  await page.goto('api/demopkg/report/');

  // Prose became real elements rather than being escaped into text.
  const prose = page.locator('.pyd-markdown').first();
  await expect(prose.locator('p').first()).toBeVisible();
  await expect(page.locator('.pyd-markdown code').first()).toBeVisible();

  // Astro's unified processor highlights with Shiki, which emits `.astro-code`
  // (expressive-code, which Starlight adds, is not in this pipeline).
  const code = page.locator('.pyd-example .astro-code');
  await expect(code).toHaveCount(1);
  await expect(code).toContainText('Report("weekly")');
  await expect(page.locator('.expressive-code')).toHaveCount(0);
});

test('nothing on the page comes from Starlight', async ({ page }) => {
  await page.goto('api/demopkg/report/');

  for (const selector of ['starlight-toc', 'site-search', '.sl-markdown-content', '.sl-flex', '.sidebar-pane']) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
});

test('a hand-written page documents one object and searches the package', async ({ page }) => {
  await page.goto('');

  const report = page.locator('.pyd-member[data-pydocs-path="demopkg.Report"]');
  await expect(report.locator('> h2[id="demopkg.Report"]')).toBeVisible();
  await expect(report.locator('[data-pydocs-path="demopkg.Report.generate"] > h3')).toBeVisible();

  const search = page.locator('pydocs-search');
  const input = search.locator('.pyd-search-input');
  await input.click();
  await input.fill('Report');

  const options = search.locator('.pyd-search-option[role="option"]');
  await expect(options.first()).toContainText('demopkg.Report');

  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/api\/demopkg\/#demopkg\.Report$/);
});

test('the Content Layer loader exposes the API surface as data', async ({ page }) => {
  await page.goto('symbols/');

  const rows = page.locator('#loader-entries tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(page.locator('[data-symbol-path="numpkg.Grid.area"]')).toContainText('Compute the number of cells.');
  await expect(page.locator('[data-symbol-path="numpkg.resample"]')).toContainText('Scale a grid by a factor.');
  await expect(page.locator('[data-symbol-path="numpkg"]')).toContainText('module');
});
