/** @file Playwright browser testing configuration. */
import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests',
  // Headless tests are run via vitest, not playwright, so we ignore them here.
  testIgnore: ['headless/**'],
  forbidOnly: !!process.env.CI,
  workers: 1,
  // Generous per-test budget: a cold engine start (JIT warm-up, no IR caches, antivirus
  // scanning the freshly-unpacked engine on Windows CI runners) can push the first project's
  // startup well past what a warm local run needs.
  timeout: 240000,
  reportSlowTests: { max: 5, threshold: 60000 },
  expect: {
    timeout: 30000,
    toHaveScreenshot: { threshold: 0 },
  },
  use: {
    actionTimeout: 15000,
    viewport: { width: 1780, height: 1000 },
  },
})
