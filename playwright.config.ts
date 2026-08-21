import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real application: the production client bundle
 * served by the API process, against a seeded database and the real evaluation
 * sandbox. Nothing is mocked.
 */
const PORT = Number(process.env.E2E_PORT ?? 4300);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    launchOptions: {
      // The sandbox image ships Chromium at a fixed path; fall back to the
      // version Playwright downloaded when that path is absent.
      executablePath: process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium',
    },
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],

  webServer: {
    command: `E2E_PORT=${PORT} node e2e/server.mjs`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
