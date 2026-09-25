import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { sidebar, sidebarGroup } from '../helpers.ts';

test('the sidebar places each package under the section it was configured for', async ({ page }) => {
  await page.goto('api/demopkg/');

  const apiReference = sidebarGroup(page, 'API reference');
  await expect(apiReference.locator('a[href$="/api/demopkg/"]')).toHaveCount(1);
  await expect(apiReference.locator('a[href$="/api/numpkg/"]')).toHaveCount(1);
  // sphpkg has a placeholder of its own, so it must not land in the shared group.
  await expect(apiReference.locator('a[href$="/api/sphpkg/"]')).toHaveCount(0);

  const sphinxDemo = sidebarGroup(page, 'Sphinx demo');
  await expect(sphinxDemo.locator('a[href$="/api/sphpkg/"]')).toHaveCount(1);
  await expect(sphinxDemo.locator('a[href$="/api/demopkg/"]')).toHaveCount(0);
});

test('the module tree lists every module page and its links navigate', async ({ page }) => {
  await page.goto('api/demopkg/');

  const demopkg = sidebarGroup(page, 'demopkg').first();
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

test('the agent skill page carries the shipped SKILL.md word for word', async ({ page, request }) => {
  // The page holds a hand-made copy of the skill the npm package ships. Every
  // line of the skill's body (headings one level down) must be on the page's
  // Markdown route, so an edit to one without the other fails here.
  const skill = await readFile(
    new URL('../../../../packages/starlight-pydocs/skills/starlight-pydocs/SKILL.md', import.meta.url),
    'utf8',
  );
  const lines = skill
    .replace(/^---\n[\s\S]*?\n---\n+/, '')
    .replace(/^#\s[^\n]*\n+/, '')
    .replace(/^(#{2,5}) /gm, '#$1 ')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const markdown = await (await request.get('guides/agent-skill.md')).text();
  for (const line of lines) expect(markdown).toContain(line);

  await page.goto('guides/agent-skill/');
  const content = page.locator('.sl-markdown-content');
  await expect(content.getByRole('heading', { name: '3. Decide what the public API is' })).toBeVisible();
  await expect(content).not.toContainText('name: starlight-pydocs');
});
