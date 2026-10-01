# gui/integration-test

Playwright-based integration tests for the GUI. Organized by feature subtree,
mirroring `src/`. Expect the structure to evolve as the Dashboard is ported to
Vue:

**Type-checked in CI** (`tsconfig.node.json`, run by `app/gui`'s `typecheck`
script alongside the app's own `tsconfig.app.json` — see #141). If a new file
here imports a type or helper from `src/` that isn't already reachable,
`vue-tsc --noEmit -p tsconfig.node.json` fails with `TS6307` naming the missing
file; add it to `tsconfig.node.json`'s `include` list (see the gotcha in
`app/gui/CLAUDE.md` — do not widen it to a `src/**` glob).

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

Single projects:
`corepack pnpm exec cross-env NODE_ENV=production playwright test --project=Setup`
(or `--project="Integration Tests"`). `PROD=true` builds and previews instead of
running the dev server.

### On native Windows

The same commands work from PowerShell, Git Bash or `cmd.exe` (#21). Linux — WSL
or CI — stays the reference: check anything timing- or rendering-sensitive there
before trusting a Windows result. Differences to know about:

- **Screenshot comparisons are skipped off Linux.** Baselines are `*-linux.png`
  only, and Chromium rasterises text differently on Windows (about a fifth of
  the code-font samples' pixels differ). Use `expectScreenshot` from
  `integration-test/screenshot.ts`, never `expect(page).toHaveScreenshot`
  directly: it compares on Linux and elsewhere records a `screenshot skipped`
  annotation, while the rest of the test still runs. Do not commit `*-win32.png`
  files — `--update-snapshots` on Windows has nothing to write through the
  helper, but a direct `toHaveScreenshot` would create them.
- **The mocked filesystem is POSIX-style.** Join its paths with `posix.join`
  (`node:path`), not `join`: the tests run in Node on the host, so `join` writes
  backslashes into them on Windows.
- **Shutdown.** Playwright ignores `gracefulShutdown` on Windows and kills the
  web server's process tree with `taskkill /T /F`; nothing is left listening on
  the port afterwards.
- The `webServer` command must stay shell-neutral: it runs through `cmd.exe` on
  Windows, so no POSIX paths, no `VAR=value` prefixes, and no `.bin` shims
  (`playwright.config.ts` runs Vite's `bin/vite.js` with `node`).

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
- The Rust parser is imported as an ESM WebAssembly module
  (`import * as wasm from './rust_ffi_bg.wasm'` in `app/rust-ffi/dist/`). Node
  24 supports this unflagged; on Node 22 it needs
  `NODE_OPTIONS='--experimental-wasm-modules'`, which is why `.node-version`
  pins 24.
- Install browsers once with `pnpm run playwright:install` (Chromium only).
- **Playwright is pinned exactly** in the workspace catalog
  (`pnpm-workspace.yaml`), because each release bundles a different Chromium and
  these tests are timing-sensitive. It was held at 1.55.1 for a while (#32): on
  1.63.0 the three `sorting and copying` tests in `tableVisualisation.spec.ts`
  were ~3x flakier. The cause was a race in our table (range selection updated
  from AG Grid's deferred cell events, so a Mod+C could overtake a Shift+Click),
  fixed in #136; the newer Chromium only widened the window. Bump it by
  re-measuring the full spec on both versions, as #32 describes.
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
- **Never leave the cursor on the dashboard's left bar.** It expands over the
  drive panel 550ms after the pointer enters it, covering the toolbar's "New
  Project" and each row's leftmost button. Playwright moves the mouse only once
  its target is uncovered, so the bar never collapses and the click times out
  (`<div class="categories"> from <div class="leftBar expanded"> intercepts pointer events`)
  — but only when the next click lands more than ~550ms later, i.e. on a loaded
  CI runner (#146). Every helper that clicks or drops on the bar ends with
  `page.mouse.move(0, 0)`; do the same in new ones.
