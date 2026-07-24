import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/playwright-results',
  timeout: 45_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: true,
    timeout: 30_000
  },
  use: {
    trace: 'retain-on-failure'
  }
})
