import { expect, test } from '@playwright/test';

import { member, signature } from '../helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('guides/autodoc/');
});

test('a class renders in the middle of hand-written prose', async ({ page }) => {
  const report = member(page, 'demopkg.report.Report');
  await expect(report).toBeVisible();

  // Default heading level 2, members one level deeper.
  await expect(report.locator('> h2[id="demopkg.report.Report"]')).toBeVisible();
  await expect(page.locator('h3[id="demopkg.report.Report.generate"]')).toBeVisible();

  await expect(signature(report, 'demopkg.report.Report')).toContainText('class Report(');
  await expect(report.locator('.pyd-params').first()).toContainText('Human readable report name');
});

test('headingLevel shifts the block without breaking its anchors', async ({ page }) => {
  const generate = member(page, 'demopkg.generate_report');
  await expect(generate.locator('> h3[id="demopkg.generate_report"]')).toBeVisible();
  await expect(generate.locator('.pyd-badge[data-pydocs-badge="kind"]')).toHaveText('function');
});

test('the anchors an autodoc block emits are navigable', async ({ page }) => {
  const anchor = member(page, 'demopkg.generate_report').locator('> h3 .pyd-anchor');
  await expect(anchor).toHaveAttribute('href', '#demopkg.generate_report');

  await anchor.click();
  await expect(page).toHaveURL(/\/guides\/autodoc\/#demopkg\.generate_report$/);
  await expect(page.locator('[id="demopkg.generate_report"]')).toBeInViewport();
});
