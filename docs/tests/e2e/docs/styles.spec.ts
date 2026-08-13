import { expect, test } from '@playwright/test';

/**
 * Docstring flavours, end to end.
 *
 * Each package is configured with a different `docstringStyle`, so a section
 * table on the page proves that griffe parsed that flavour and the components
 * rendered it. `sphpkg` additionally proves the no-extraction path: its model
 * comes from a checked-in dump, not from a griffe subprocess.
 */

test('numpy-style docstrings parse into sections', async ({ page }) => {
  await page.goto('api/numpkg/');

  const parameters = page
    .locator('.pyd-member[data-pydocs-path="numpkg.resample"] .pyd-section[data-pydocs-section="parameters"]')
    .first();
  const rows = parameters.locator('.pyd-params tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('grid');
  await expect(rows.nth(1)).toContainText('factor');
  await expect(rows.nth(1)).toContainText('Multiplier applied to both dimensions');

  const grid = page.locator('.pyd-member[data-pydocs-path="numpkg.Grid"]');
  await expect(grid.locator('.pyd-section[data-pydocs-section="parameters"]').first()).toContainText('Number of rows');
  await expect(grid.locator('.pyd-section[data-pydocs-section="attributes"]').first()).toContainText(
    'Number of columns',
  );

  await expect(
    page.locator('.pyd-member[data-pydocs-path="numpkg.resample"] .pyd-section[data-pydocs-section="raises"]'),
  ).toContainText('ValueError');
});

test('sphinx-style docstrings parse into sections, from a pre-generated dump', async ({ page }) => {
  await page.goto('api/sphpkg/');

  const parameters = page
    .locator('.pyd-member[data-pydocs-path="sphpkg.submit"] .pyd-section[data-pydocs-section="parameters"]')
    .first();
  const rows = parameters.locator('.pyd-params tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('job');
  await expect(rows.nth(1)).toContainText('validate without queueing');

  await expect(
    page.locator('.pyd-member[data-pydocs-path="sphpkg.Job"] .pyd-section[data-pydocs-section="parameters"]').first(),
  ).toContainText('Queue priority');

  await expect(
    page.locator('.pyd-member[data-pydocs-path="sphpkg.submit"] .pyd-section[data-pydocs-section="returns"]'),
  ).toContainText('identifier assigned to the job');

  // Nothing configured a source link for this package and the dump was made
  // portable, so there is nothing to link to.
  await expect(page.locator('a.pyd-source-link')).toHaveCount(0);
});

test('google-style docstrings render examples as highlighted code', async ({ page }) => {
  await page.goto('api/demopkg/');

  const examples = page
    .locator('.pyd-module[data-pydocs-path="demopkg"] .pyd-section[data-pydocs-section="examples"]')
    .first();
  await expect(examples).toContainText('Build a report and write it to disk');
  // Starlight registers expressive-code on the processor the docstrings render
  // through, so a doctest block comes out as an expressive-code figure with the
  // same styling as the site's own code samples.
  await expect(examples.locator('.expressive-code figure pre')).toHaveCount(1);
  await expect(examples).toContainText('from demopkg import Report');
});
