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
- The Rust parser is imported as an ESM WebAssembly module
  (`import * as wasm from './rust_ffi_bg.wasm'` in `app/rust-ffi/dist/`). Node
  24 supports this unflagged; on Node 22 it needs
  `NODE_OPTIONS='--experimental-wasm-modules'`, which is why `.node-version`
  pins 24.
- Install browsers once with `pnpm run playwright:install` (Chromium only).
- **Playwright is held at 1.55.1** (exact-pinned in the workspace catalog).
  1.63.0 makes the three `sorting and copying` tests in
  `tableVisualisation.spec.ts` about 3× flakier — the Shift+Click stops
  extending the cell range, so a two-row copy yields one row. Our code isn't the
  cause, and two attempted fixes made it no better. Don't bump it without
  re-measuring; the recipe and numbers are in #32.
- Switching between branches that pin different Playwright versions needs
  `corepack pnpm exec playwright install chromium` each way — they use different
  Chromium revisions, and the error ("Looks like Playwright Test or Playwright
  was just installed or updated") doesn't make the branch switch the obvious
  cause.
- **These tests are timing-sensitive.** Several pass in isolation and only fail
  under `--workers=2` with the whole spec running. When judging whether a change
  broke something here, run the full spec several times on both branches and
  compare rates — a single run proves nothing either way.
- CI runs with a matrix of {dashboard, project-view} × {chromium}. Don't add
  cross-suite test IDs — they must stay independent.

## Writing tests

- Use page-object-style helpers from `actions/`, not raw selectors.
- Mock at the boundary (HTTP / Amplify / LS), not inside components.
- Avoid `page.waitForTimeout` — prefer role-based `toBeVisible` / `toHaveText`
  assertions.
