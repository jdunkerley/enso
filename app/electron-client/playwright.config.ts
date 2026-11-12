/** @file Playwright browser testing configuration. */
import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests',
  // Headless tests are run via vitest, not playwright, so we ignore them here.
  testIgnore: ['headless/**'],
  // Warms the engine's IR cache once so specs don't each pay a cold standard-library compile.
  globalSetup: './globalSetup.ts',
  forbidOnly: !!process.env.CI,
  // `line` on CI, not the default `dot`: it prints a failure, and a test's output (the engine dump,
  // Note [A Failed Test Dumps The Engine's Threads] in tests/electronTest.ts), as they happen, so
  // they reach the log even when the job's time limit cancels the run.
  reporter: process.env.CI ? 'line' : 'list',
  // Each spec drives a freshly-launched packaged Electron app + engine + Language Server, so a
  // slow CI runner or the occasional localhost static-server startup race can fail a step that
  // is healthy on a second attempt. Retry on CI; keep local runs fail-fast.
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // Headroom for a first project that still has to JIT-warm and load the (now cached) standard
  // library, plus the rest of the spec.
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
