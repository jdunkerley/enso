import { defineConfig, devices } from 'playwright/test'

/** Runs against the built site (`build`, then this serves it); no dev server. */
export default defineConfig({
  testDir: './e2e',
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:3210/enso/' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@touch/,
    },
    { name: 'touch', use: { ...devices['Pixel 7'] }, grep: /@touch/ },
  ],
  webServer: {
    command: 'corepack pnpm run serve',
    url: 'http://localhost:3210/enso/',
    reuseExistingServer: !process.env.CI,
  },
})
