import { expect, test } from '@playwright/test';

import { member, section, signature } from '../helpers.ts';

test.describe('demopkg.report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('api/demopkg/report/');
  });

  test('a class signature carries its __init__ parameters', async ({ page }) => {
    const reportSignature = signature(page, 'demopkg.report.Report');
    await expect(reportSignature).toContainText('class Report(');
    await expect(reportSignature).toContainText('name: str');
    await expect(reportSignature).toContainText('scores: dict[str, float] | None = None');
  });

  test('annotations link to documented objects on this site', async ({ page }) => {
    // The bases line of `Report`, resolved inside the package.
    const internal = page.locator('a.pyd-type[href$="#demopkg.report.BaseReport"]').first();
    await expect(internal).toHaveText('BaseReport');

    await internal.click();
    await expect(page).toHaveURL(/#demopkg\.report\.BaseReport$/);
    await expect(page.locator('[id="demopkg.report.BaseReport"]')).toBeVisible();
  });

  test('annotations link out through the configured inventory', async ({ page }) => {
    const parameters = member(page, 'demopkg.report.BaseReport.save').locator('.pyd-params');
    const external = parameters.locator('a.pyd-type--external');
    await expect(external).toHaveAttribute('href', 'https://docs.python.org/3/library/pathlib.html#pathlib.Path');
    await expect(external).toHaveText('pathlib.Path');
  });

  test('parameter tables list every parameter with its type and default', async ({ page }) => {
    const parameters = section(member(page, 'demopkg.report.Report'), 'parameters').first();
    const rows = parameters.locator('.pyd-params tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('name');
    await expect(rows.nth(0)).toContainText('required');
    await expect(rows.nth(1)).toContainText('scores');
    await expect(rows.nth(1)).toContainText('None');
  });

  test('the table of contents is built from dotted-path anchors', async ({ page }) => {
    const toc = page.locator('starlight-toc');
    await expect(toc.locator('a[href="#demopkg.report.Report"]')).toBeVisible();
    await expect(toc.locator('a[href="#demopkg.report.Report.generate"]')).toBeVisible();

    const anchors = await toc.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    // Every entry but Starlight's own "Overview" link is a dotted object path.
    const objectAnchors = anchors.filter((href) => href !== '#_top');
    expect(objectAnchors.length).toBeGreaterThan(10);
    expect(objectAnchors.every((href) => href.startsWith('#demopkg.report.'))).toBe(true);

    // And each one has a heading to land on.
    for (const href of objectAnchors) {
      await expect(page.locator(`[id="${href.slice(1)}"]`)).toHaveCount(1);
    }
  });

  test('every heading id is the dotted path of the object it documents', async ({ page }) => {
    const mismatched = await page
      .locator('.pyd-member')
      .evaluateAll((blocks) =>
        blocks
          .filter((block) => block.querySelector(':scope > .pyd-heading')?.id !== block.dataset['pydocsPath'])
          .map((block) => block.dataset['pydocsPath'] ?? ''),
      );
    expect(mismatched).toEqual([]);

    const anchor = member(page, 'demopkg.report.Report.render').locator('> .pyd-heading .pyd-anchor');
    await expect(anchor).toHaveAttribute('href', '#demopkg.report.Report.render');
  });

  test('objects link to their source lines on the configured forge', async ({ page }) => {
    const source = member(page, 'demopkg.report.Report.generate').locator('a.pyd-source-link');
    await expect(source).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\/ewels\/starlight-pydocs\/blob\/main\/fixtures\/demopkg\/src\/demopkg\/report\.py#L\d+-L\d+$/,
    );
  });

  test('deprecations are badged and explained', async ({ page }) => {
    const deprecated = member(page, 'demopkg.report.old_generate');
    await expect(deprecated.locator('.pyd-badge[data-pydocs-badge="deprecated"]')).toHaveText('Deprecated');
    const note = deprecated.locator('.pyd-aside[data-pydocs-aside="deprecated"]');
    await expect(note).toContainText('Since 0.3');
    // The prose went through the site's markdown processor, so the backticks in
    // the docstring are real code elements.
    await expect(note.locator('.pyd-markdown code')).toHaveText('generate_report');
  });

  test('docstring admonitions become asides', async ({ page }) => {
    const note = member(page, 'demopkg.report.Report.generate').locator('.pyd-aside');
    await expect(note).toHaveAttribute('data-pydocs-aside', 'note');
    await expect(note).toContainText('deliberately synchronous');
  });

  test('mkdocstrings cross-references in prose become links', async ({ page }) => {
    const prose = member(page, 'demopkg.report.generate_report').locator('.pyd-markdown').first();

    // A target documented on this site, and one resolved through the inventory.
    await expect(prose.locator('a[href$="/api/demopkg/report/#demopkg.report.Report"]')).toHaveText('Report');
    await expect(prose.locator('a[href="https://docs.python.org/3/library/pathlib.html#pathlib.Path"]')).toHaveText(
      'pathlib.Path',
    );

    // A target nothing resolves keeps the brackets it was written with.
    await expect(prose).toContainText('[nosuchpkg.Thing][]');
  });

  test('inherited members are collected and attributed to their base class', async ({ page }) => {
    const inherited = page.locator('details.pyd-inherited[data-pydocs-inherited="demopkg.report.BaseReport"]');
    await expect(inherited).toBeVisible();
    await expect(inherited.locator('summary')).toContainText('demopkg.report.BaseReport');

    const provenance = member(inherited, 'demopkg.report.Report.save')
      .locator('[data-pydocs-provenance="inherited"] a')
      .first();
    await expect(provenance).toHaveAttribute('href', /#demopkg\.report\.BaseReport$/);
  });
});

test('re-exported objects say where they were defined', async ({ page }) => {
  await page.goto('api/demopkg/');

  const provenance = member(page, 'demopkg.Report').locator(
    '> .pyd-provenance [data-pydocs-provenance="reexported"] a',
  );
  await expect(provenance).toHaveAttribute('href', /\/api\/demopkg\/report\/$/);
  await expect(provenance).toHaveText('demopkg.report');
});

test('pydantic models are labelled through the griffe extension', async ({ page }) => {
  await page.goto('api/demopkg/models/');

  const user = member(page, 'demopkg.models.User');
  await expect(user.locator('.pyd-badge[data-pydocs-badge="label"]').first()).toHaveText('pydantic model');
  await expect(member(user, 'demopkg.models.User.email').locator('.pyd-badge[data-pydocs-badge="label"]')).toHaveText(
    'pydantic field',
  );
});
