import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:5181/FieldBeeLines/',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5181 --strictPort --base=/FieldBeeLines/',
    url: 'http://127.0.0.1:5181/FieldBeeLines/',
    reuseExistingServer: false,
  },
});