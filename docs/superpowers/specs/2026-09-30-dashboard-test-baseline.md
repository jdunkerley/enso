# Dashboard Playwright Flake Baseline

**Date:** 2026-09-30 **Ticket:** #81 (part of the React→Vue epic #75)

This is the flake baseline that every dashboard port PR compares against (see
the parity checklist in `app/gui/integration-test/CLAUDE.md`). It records how
often each spec in `app/gui/integration-test/dashboard/` passes on unchanged
code, measured the way the checklist asks a port to measure itself.

## What was measured

- **Code:** `fd4586ed79`, the head of
  `refactor/move-framework-free-dashboard-code` (#77, merged as `87c132a3bd`).
  It moves files only and behaves exactly like `develop` at the time.
- **Host:** WSL2 (Ubuntu) on an AMD Ryzen AI Max+ 395 (32 threads), Node
  24.21.0, Playwright 1.63.0 and its bundled Chromium. A private clone on the
  Linux filesystem (`~/enso-r2v81`), not the checkout under `/mnt/c`.
- **Settings:** CI's. `CI=true` gives 2 workers and a production build served by
  `vite preview`. The one change from CI is `--retries=0`: CI retries once,
  which hides exactly the flakes a baseline has to count.
- **Two loads:**
  - _unconstrained_ — the whole machine;
  - _2 CPUs_ — the same run under `taskset -c 0-1`, closer to a GitHub
    `ubuntu-latest` runner (2 vCPUs, one of four shards). The timing races fixed
    in #136 and #146 only showed under load like this.

## Commands

From `app/gui`, after `corepack pnpm install --frozen-lockfile` and
`corepack pnpm -r --filter 'enso-gui^...' run compile` at the repository root:

```bash
. ~/.enso-toolchain.sh
# Build once; each run then serves the same bundle.
NODE_OPTIONS=--max-old-space-size=6144 node node_modules/vite/bin/vite.js -c vite.test.config.ts build

# One run. Repeat it N (>= 5) times; prefix it with `taskset -c 0-1` for the 2-CPU load.
CI=true PW_UNSAFE_SKIP_BUILD=true PLAYWRIGHT_PORT=5951 NODE_ENV=production \
PLAYWRIGHT_JSON_OUTPUT_FILE=run1.json \
  corepack pnpm exec playwright test --project='Integration Tests' --retries=0 \
  --reporter=list,json integration-test/dashboard/
```

Per-spec rates come from the JSON reports: count each test's final result in
each run, per spec file.

## Results

5 runs at each load. The suite has 22 specs and 73 tests; 70 run, and 3 are
skipped by design in every run:

- `assetSearchBar.spec.ts` › labels (not supported by search);
- `exportAsset.spec.ts` › export from remote to local, both the menu and the
  drag variant (`local+remote`).

| Load          | Runs | Test runs | Failures | Suite time per run |
| ------------- | ---: | --------: | -------: | -----------------: |
| unconstrained |    5 |       350 |        0 |         86 – 120 s |
| 2 CPUs        |    5 |       350 |        0 |        193 – 219 s |

Every spec passed every time at both loads:

| Spec                           | Tests run | Pass rate, unconstrained | Pass rate, 2 CPUs |
| ------------------------------ | --------: | -----------------------: | ----------------: |
| `assetSearchBar.spec.ts`       |         5 |               25/25 100% |        25/25 100% |
| `assetsTableFeatures.spec.ts`  |         4 |               20/20 100% |        20/20 100% |
| `authPreserveEmail.spec.ts`    |         1 |                 5/5 100% |          5/5 100% |
| `contextMenu.spec.ts`          |         1 |                 5/5 100% |          5/5 100% |
| `copy.spec.ts`                 |         9 |               45/45 100% |        45/45 100% |
| `createAsset.spec.ts`          |         7 |               35/35 100% |        35/35 100% |
| `dataLinkEditor.spec.ts`       |         1 |                 5/5 100% |          5/5 100% |
| `degradedAuth.spec.ts`         |         3 |               15/15 100% |        15/15 100% |
| `delete.spec.ts`               |         8 |               40/40 100% |        40/40 100% |
| `driveView.spec.ts`            |         1 |                 5/5 100% |          5/5 100% |
| `editAssetName.spec.ts`        |        11 |               55/55 100% |        55/55 100% |
| `exportAsset.spec.ts`          |         2 |               10/10 100% |        10/10 100% |
| `loginLogout.spec.ts`          |         1 |                 5/5 100% |          5/5 100% |
| `loginScreen.spec.ts`          |         1 |                 5/5 100% |          5/5 100% |
| `organizationSettings.spec.ts` |         2 |               10/10 100% |        10/10 100% |
| `pageSwitcher.spec.ts`         |         1 |                 5/5 100% |          5/5 100% |
| `rightPanel.spec.ts`           |         4 |               20/20 100% |        20/20 100% |
| `signUp.spec.ts`               |         1 |                 5/5 100% |          5/5 100% |
| `sort.spec.ts`                 |         1 |                 5/5 100% |          5/5 100% |
| `userMenu.spec.ts`             |         2 |               10/10 100% |        10/10 100% |
| `userSettings.spec.ts`         |         3 |               15/15 100% |        15/15 100% |
| `welcomeProject.spec.ts`       |         1 |                 5/5 100% |          5/5 100% |

**No flaky dashboard spec is known at this baseline.** The flakes #32 tracked
were fixed by #136 (table range selection) and #146/#147 (the left bar covering
the next click, the organization picture upload), all before this measurement.
So for a port the bar is simple: **any** failure in the dashboard suite, at
either load, is a regression until shown otherwise — rerun that spec on the base
branch the same number of times before blaming the port or the runner.

## After #81

The same measurement on #81's own branch, which adds
`dashboard/accessibility.spec.ts` and makes the page objects framework-neutral:

| Load          | Runs | Test runs | Failures | Suite time per run |
| ------------- | ---: | --------: | -------: | -----------------: |
| unconstrained |    5 |       375 |        0 |         88 – 102 s |
| 2 CPUs        |    5 |       375 |        0 |        182 – 200 s |

That is the 350 test runs above, all passing again, plus 25 of the 5 new
accessibility tests, all passing.

The accessibility spec was also run on its own, 10 times with `--workers=2`, 10
times on 2 CPUs, and once with `--workers=6 --repeat-each=10` (50 test runs):
all passed. Before axe waited for animations to settle, the asset panel check
failed 2 of 10 runs (`target-size` on the panel's Fullscreen button, measured
mid-slide).
