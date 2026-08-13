import { expect, test } from '@playwright/test';

import { member, section } from '../helpers.ts';

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

  const resample = member(page, 'numpkg.resample');
  const rows = section(resample, 'parameters').first().locator('.pyd-params tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('grid');
  await expect(rows.nth(1)).toContainText('factor');
  await expect(rows.nth(1)).toContainText('Multiplier applied to both dimensions');

  const grid = member(page, 'numpkg.Grid');
  await expect(section(grid, 'parameters').first()).toContainText('Number of rows');
  await expect(section(grid, 'attributes').first()).toContainText('Number of columns');

  await expect(section(resample, 'raises')).toContainText('ValueError');
});

test('sphinx-style docstrings parse into sections, from a pre-generated dump', async ({ page }) => {
  await page.goto('api/sphpkg/');

  const submit = member(page, 'sphpkg.submit');
  const rows = section(submit, 'parameters').first().locator('.pyd-params tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('job');
  await expect(rows.nth(1)).toContainText('validate without queueing');

  await expect(section(member(page, 'sphpkg.Job'), 'parameters').first()).toContainText('Queue priority');

  await expect(section(submit, 'returns')).toContainText('identifier assigned to the job');

  // Nothing configured a source link for this package and the dump was made
  // portable, so there is nothing to link to.
  await expect(page.locator('a.pyd-source-link')).toHaveCount(0);
});

test('google-style docstrings render examples as highlighted code', async ({ page }) => {
  await page.goto('api/demopkg/');

  const examples = section(page.locator('.pyd-module[data-pydocs-path="demopkg"]'), 'examples').first();
  await expect(examples).toContainText('Build a report and write it to disk');
  // Starlight registers expressive-code on the processor the docstrings render
  // through, so a doctest block comes out as an expressive-code figure with the
  // same styling as the site's own code samples.
  await expect(examples.locator('.expressive-code figure pre')).toHaveCount(1);
  await expect(examples).toContainText('from demopkg import Report');
});
