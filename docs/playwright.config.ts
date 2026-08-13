import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

const DOCS_PORT = 4321;
const DOCS_BASE = '/starlight-pydocs';
const VANILLA_PORT = 4322;

const DOCS_URL = `http://localhost:${String(DOCS_PORT)}${DOCS_BASE}/`;
const VANILLA_URL = `http://localhost:${String(VANILLA_PORT)}/`;

// Use the pre-installed Chromium when present (e.g. this dev environment); fall
// back to Playwright's managed download elsewhere (e.g. CI after `playwright install`).
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {};
const chromium = { ...devices['Desktop Chrome'], launchOptions };

/**
 * A site to build and preview for the suite.
 *
 * ASTRO_PREVIEW_BACKGROUND opts out of Astro's agentic-environment detection,
 * which otherwise daemonises `astro preview`; Playwright would see the command
 * exit immediately and give up. Harmless where no agent is detected (CI).
 */
function previewServer(command: string, url: string) {
  return {
    command,
    url,
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
    reuseExistingServer: !process.env['CI'],
    timeout: 300_000,
  };
}

// Two sites, one suite: the Starlight docs site and the plain Astro example.
// Each project only runs the specs written for its site.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'docs', testDir: './tests/e2e/docs', use: { ...chromium, baseURL: DOCS_URL } },
    { name: 'vanilla', testDir: './tests/e2e/vanilla', use: { ...chromium, baseURL: VANILLA_URL } },
  ],
  // Both builds run griffe (through uvx) and both previews serve prerendered
  // output, so the suite exercises the real extraction path, not a dev server.
  webServer: [
    previewServer('pnpm build && pnpm preview', DOCS_URL),
    previewServer(
      [
        'pnpm --filter starlight-pydocs-example-vanilla build',
        `pnpm --filter starlight-pydocs-example-vanilla preview --port ${String(VANILLA_PORT)}`,
      ].join(' && '),
      VANILLA_URL,
    ),
  ],
});
