# gui/integration-test

Playwright-based integration tests for the GUI. Organized by feature subtree,
mirroring `src/`. Expect the structure to evolve as the Dashboard is ported to
Vue:

- `dashboard/` — Dashboard feature flows (sign-in, project list, settings). The
  Dashboard subtree is still React, legacy.
- `project-view/` — ProjectView feature flows (create nodes, connect edges, open
  visualization).
- `actions/` — Reusable test actions (page-object-style helpers).
- `mock/` — Mocks for the backend, Cognito, feature flags. Dashboard tests run
  against these by default.
- `base.ts` — Playwright base test fixture (provides auth'd page, mocked env,
  debug logging).
- `setup.ts` — Global setup (port finders, temp dirs).

## Run

```
cd app/gui
pnpm test:integration          # headless
pnpm test-dev:integration      # UI mode
```

## AG Grid licensed vs unlicensed

The suite runs in two Playwright projects, because the IDE's table view behaves
differently with and without an AG Grid Enterprise licence (see
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`):

- **`Integration Tests`** — the whole suite, with **no** licence key. Exercises
  the AG Grid Community fallbacks (Infinite Row Model, custom set filter, custom
  range selection/clipboard, custom context/column menus).
- **`Integration Tests (AG Grid licensed)`** — re-runs only the tests tagged
  `@ag-grid`, with a licence key, so the Enterprise path keeps its coverage.
  Registered **only** when `ENSO_IDE_AG_GRID_LICENSE_KEY` is set; otherwise it
  is skipped rather than run against an invalid key (which would exercise a
  watermarked, licence-erroring grid instead of real licensed behaviour). CI
  supplies it from `vars.ENSO_AG_GRID_LICENSE_KEY`.

Both projects inject `window.$config` before any app script runs (see
`mock/registerMocks.ts`), which `src/config.ts` prefers over the values Vite
baked in. That lets one build serve both modes — and, importantly, keeps the
unlicensed project unlicensed even when a key is present in the build
environment.

**Tag any new test that touches the grid** with `{ tag: '@ag-grid' }` so it runs
in both modes. Anything else runs once, unlicensed.

## Caveats

- `DASHBOARD_TESTS=true` switches the run to a mocked backend (see
  `vite.config.ts`).
- The Playwright `webServer` command uses a POSIX path, so the integration suite
  does not run on native Windows. Use WSL, or rely on CI.
- Requires `NODE_OPTIONS='--experimental-wasm-modules'` until Node 24 is default
  (the Rust parser WASM module).
- Install browsers once with `pnpm run playwright:install` (Chromium only).
- CI runs with a matrix of {dashboard, project-view} × {chromium}. Don't add
  cross-suite test IDs — they must stay independent.

## Writing tests

- Use page-object-style helpers from `actions/`, not raw selectors.
- Mock at the boundary (HTTP / Amplify / LS), not inside components.
- Avoid `page.waitForTimeout` — prefer role-based `toBeVisible` / `toHaveText`
  assertions.
