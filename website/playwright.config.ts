import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173/cave/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node test/serve-dist.mjs',
    url: 'http://127.0.0.1:4173/cave/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
