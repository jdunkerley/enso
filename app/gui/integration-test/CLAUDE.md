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

## Accessibility checks

`dashboard/accessibility.spec.ts` is the dashboard's accessibility safety net
for the React→Vue port (#75, #81). It runs in every CI build, as part of the
ordinary suite.

- **axe-core** (`@axe-core/playwright`, WCAG 2.0–2.2 A/AA rules) scans four
  screens — login, drive, settings, and the asset panel — through
  `expectNoNewAxeViolations` in `accessibility.ts`. Each screen has a baseline,
  `accessibility-baseline/<screen>.json`: the violations the dashboard had when
  the check came in, keyed by rule id and (normalized) target selector. A
  violation not in the baseline fails the test; a baseline entry that no longer
  occurs is only annotated, so a fix never breaks the build.
- **axe runs only once the page's animations have settled**
  (`waitForAnimationsToSettle`). Layout rules such as `target-size` otherwise
  measure a panel mid-slide: the asset panel's Fullscreen button failed
  `target-size` in 2 of 10 runs until this wait went in. Scan a new screen the
  same way, and check it repeatedly (`--repeat-each=10 --workers=2`) before
  trusting its baseline.
- **Regenerating a baseline:** on Linux (WSL), with
  `UPDATE_AXE_BASELINE=true corepack pnpm exec playwright test --project="Integration Tests" integration-test/dashboard/accessibility.spec.ts`.
  Review the diff: a removed line is a fix, an added line is a new violation and
  needs a reason in the PR. `@axe-core/playwright` is pinned exactly for this
  reason (see `package.json`'s `"//"`); a bump means a regenerated baseline in
  the same PR.
- **Accessibility-tree snapshots** (`toMatchAriaSnapshot`) pin the roles, names
  and states of the drive table header, the user menu and the settings sidebar.
  They are partial on purpose — no unnamed icons, no react-aria-only nodes such
  as its hidden "Dismiss" buttons — so they hold a port to the contract, not to
  React's DOM. When a port changes a tree deliberately (e.g. the user menu
  becoming a `menu` of `menuitem`s), update the snapshot in the same PR
  (`--update-snapshots --update-source-method=overwrite`) and say why.

## Framework-neutral locators

The page objects must survive the port unchanged, so they locate things only by
role, accessible name, text, or an explicit `data-testid`. Do not use:

- react-aria's state attributes and classes (`data-selected`, `data-focused`,
  `data-pressed`, `data-entering`/`data-exiting`, `react-aria-*` classes) — use
  the ARIA state instead (e.g. `getByRole('row', { selected: true })`: drive
  rows carry `aria-selected`);
- react-toastify's classes (`.Toastify__*`) — toasts are inside
  `getByTestId('toast-host')`;
- generated or framework ids (`#react-aria-…`, `:r1:`) — `#agreements-modal`
  became `getByTestId('agreements-modal')`;
- waits for an animation's duration — wait for the resulting state
  (`toBeHidden()`, `toHaveCount(0)`) instead.

A `data-testid` is a contract with the Vue port: keep it on the equivalent
element. The ones the page objects rely on include `drive-view`, `asset-row`,
`asset-row-name`, `dummy-row`, `context-menu`, `modal-dialog`,
`agreements-modal`, `user-menu`, `right-panel`, `asset-search-bar`,
`upsert-secret-modal`, `directory-row-navigate-button` and `toast-host`.

## Port parity checklist

Every PR that ports part of the dashboard to Vue copies this into its
description and ticks it off. The flake baseline it compares against is
`docs/superpowers/specs/2026-09-30-dashboard-test-baseline.md`.

- [ ] Full dashboard suite (`integration-test/dashboard/`) run ≥5 times on
      **both** the PR and its base, in WSL/Linux with CI's settings (the
      commands are in the baseline doc); per-spec pass rates no worse than the
      base's.
- [ ] `accessibility.spec.ts` passes, with no baseline entry added — or each
      added entry explained — and entries the port fixed removed from the
      baseline.
- [ ] Accessibility-tree snapshots unchanged, or updated deliberately with the
      reason given.
- [ ] Page objects still framework-neutral (see above); every `data-testid` and
      accessible name the tests use survives on the Vue side.
- [ ] Vue unit tests for the ported components, mounted with
      `mountWithProviders` (`src/utils/testing/mountWithProviders.ts`).
- [ ] Keyboard-only pass over the ported screen: reach and operate every control
      with Tab, Shift+Tab, Enter, Space, Escape and the arrow keys; focus stays
      visible, and returns to the trigger when a menu or dialog closes.
- [ ] Electron e2e (`app/electron-client/tests/`), **only** when the port
      touches a flow an Electron spec drives; then run the specs that drive it.
      They need a packaged build, and the cloud specs a test account. The flows:
  - login form: the `email`/`password` textboxes and the Login button
    (`electronTest.ts`, `loginAsTestUser`);
  - terms-and-privacy dialog: the checkbox groups named by their labels, and
    Accept;
  - drive: `drive-view`, `asset-row-name`, the Cloud category button, the New
    Project button, a project row's context menu → Duplicate
    (`localWorkflow.spec.ts`, `cloudWorkflow.spec.ts`);
  - project tabs: the welcome project's `tab` and its close button
    (`closeWelcome`);
  - user menu → Settings → Members tab and its members table, with Remove
    (`cloudWorkflow.spec.ts`);
  - project rename from the editor, checked back in the drive's row names
    (`localWorkflow.spec.ts`).

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
