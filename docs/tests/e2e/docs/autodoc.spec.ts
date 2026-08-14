import { expect, test } from '@playwright/test';

import { member, signature } from '../helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('guides/autodoc/');
});

// The page renders `demopkg.generate_report` twice on purpose, once at the
// default heading level and once at `headingLevel={5}`, so a reader can compare
// them. `.first()` is the default-level block, `.last()` the shifted one.
const defaultBlock = (page: Parameters<typeof member>[0]) => member(page, 'demopkg.generate_report').first();
const shiftedBlock = (page: Parameters<typeof member>[0]) => member(page, 'demopkg.generate_report').last();

test('a function renders in the middle of hand-written prose', async ({ page }) => {
  const generate = defaultBlock(page);
  await expect(generate).toBeVisible();

  // Default heading level 2.
  await expect(generate.locator('> h2[id="demopkg.generate_report"]')).toBeVisible();

  await expect(signature(generate, 'demopkg.generate_report')).toContainText('generate_report');
  await expect(generate.locator('.pyd-params').first()).toContainText('fmt');
});

test('headingLevel shifts the block without breaking its anchors', async ({ page }) => {
  const generate = shiftedBlock(page);
  await expect(generate.locator('> h5[id="demopkg.generate_report"]')).toBeVisible();
  await expect(generate.locator('.pyd-badge[data-pydocs-badge="kind"]')).toHaveText('function');
});

test('the anchors an autodoc block emits are navigable', async ({ page }) => {
  const anchor = defaultBlock(page).locator('> h2 .pyd-anchor');
  await expect(anchor).toHaveAttribute('href', '#demopkg.generate_report');

  await anchor.click();
  await expect(page).toHaveURL(/\/guides\/autodoc\/#demopkg\.generate_report$/);
  await expect(page.locator('[id="demopkg.generate_report"]').first()).toBeInViewport();
});
