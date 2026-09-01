/** @file Playwright browser testing configuration. */
import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests',
  // Headless tests are run via vitest, not playwright, so we ignore them here.
  testIgnore: ['headless/**'],
  forbidOnly: !!process.env.CI,
  workers: 1,
  // Generous per-test budget. Every spec pays a full cold engine start (JIT warm-up, a
  // from-source standard-library compile, and antivirus scanning the freshly-unpacked engine
  // on Windows CI runners) before its first project is interactive — see
  // `FIRST_PROJECT_TIMEOUT` in `electronTest.ts` — and still needs room for the rest of its
  // steps afterwards.
  timeout: 360000,
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
