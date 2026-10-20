# app/gui

The main Enso IDE GUI — a single-page web app built with Vite, served by
Electron (desktop) or the Vite dev server. Published as package `enso-gui`.

## Source layout

**Vue is the main GUI framework.** Shared infrastructure — app shell, command
palette, loading screen, cross-feature primitives, i18n, providers — lives at
`src/` directly (`src/components/`, `src/providers/`, etc.), not inside any
feature subtree. Feature-specific code lives in a subtree named after the
feature:

- `src/project-view/` — the **ProjectView** feature subtree (graph editor,
  component browser, code editor, visualizations, documentation editor). Vue.
  Uses `@vueuse/core`, `@tanstack/vue-query`, `yjs`. Import via `@/…`.
- `src/dashboard/` — the **Dashboard** feature subtree (the local drive, project
  browser, settings). Vue, ported from React (#75; React itself was removed in
  #94). TailwindCSS for styling. Import via `#/…`.

Many commons still sit inside `src/project-view/` for historical reasons. The
plan is to move genuinely shared UI/utilities **out** of `project-view/` and
into `src/` proper so each feature subtree holds only its own feature-specific
code. When you add something new, ask: is it ProjectView-only, Dashboard-only,
or shared? Shared goes at `src/`.

**Local-only.** The IDE runs with no Enso Cloud: no remote configuration fetch,
always the one local user and session (`makeLocalSession` in
`src/providers/session.ts`, no authentication), core contributions are in
`src/registerCore.ts`. See
`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`.

**Rule of thumb for new work:** default to Vue, put cross-feature code at
`src/`, put feature-specific code in the matching subtree.

`entrypoint.ts` creates the app; `App.vue` is the shell (the router view, the
toasts, the About dialog, the tooltips). The `dashboard` route renders
`src/components/DashboardPage.vue`, which holds the dashboard's global shortcuts
and mounts `AppContainer.vue`.

## TypeScript path aliases

Defined in `vite.config.ts`:

- `@/…` → `src/project-view/…` (ProjectView feature subtree, Vue)
- `#/…` → `src/dashboard/…` (Dashboard feature subtree, Vue)
- `$/…` → `src/…` (shared/cross-feature code: app shell, providers, common
  components, i18n)

Reaching across subtrees (`@/` from `src/dashboard/`, or `#/` from
`src/project-view/`) is allowed but usually a smell — prefer pulling shared code
into `src/` and importing via `$/`.

**Nothing outside `src/dashboard/` may import `#/…`**, except the modules listed
in `DASHBOARD_IMPORT_ALLOWLIST` in the root `eslint.config.mjs` (the dashboard
features the shell mounts, and its stylesheets). ESLint enforces this. The list
only shrinks: when shared code needs something from the dashboard that is
framework-free, move it to `src/` (as #77 did) rather than adding an entry.

## Where framework-free shared code lives

- `src/utils/` — general helpers (`LocalStorage`, `LruCache`, `event`,
  `inputBindings`, `inputModality`, `download`, `mimeTypes`,
  `datalinkValidator`, …); `src/utils/data/` for small data-structure helpers;
  `src/utils/style/` for Tailwind class composition (`tailwindVariants`,
  `tailwindMerge`); `src/utils/testing/` for test-only helpers
  (`mountWithProviders`, the Vue component-test harness).
- `src/utils/persistedStore.ts` — a reactive state object saved to
  `localStorage`, behind the feature flags, the code-font settings and the local
  directories (`src/providers/`). Its entry format (`{ state, version }`) is the
  one zustand's `persist` used, so settings saved before #94 still load; keep
  it.
- `src/components/<Name>/variants.ts` — Tailwind variants of the component of
  that name (`Button`, `Dialog`, `Text`, `Icon`, `Menu`, `Tooltip`, `Inputs`,
  …), plus other framework-free component constants. The Vue primitives
  themselves live beside them; see `src/components/CLAUDE.md`.
- **The backend's queries and mutations** (#192): `src/utils/backendQuery.ts`
  defines every backend method's query and mutation options once (key, stale
  time, persistence, invalidations), typed with `@tanstack/query-core`, which
  vue-query consumes in the one shared `QueryClient`; `executeMutation` runs one
  from outside any component. `driveQueries.ts` (listings, search, new names),
  `driveMutations.ts` (the batched delete, copy, move and download; the move's
  duplicate resolver is injected) build on it. The Vue wrappers are
  `@/composables/backend` and `$/composables/moveAssets` (copy or move assets
  between the local folders); the drive's own (mutation state, new folder and
  project, rename, uploads) are in `#/layouts/Drive/driveActions` (#91). Never
  give a key different options on the two sides.
- `src/configurations/` — static configuration: the keyboard shortcuts (the
  dashboard's `inputBindings.ts`, the graph editor's `graphInputBindings.ts`,
  and `keyboardShortcuts.ts`, the one registry over both with their scopes and
  conflict checks, #170), the settings tabs, and the settings page's model
  (`settings.ts`: tabs, sections and entries, their context, and the search over
  them).

## Keyboard shortcuts

One registry and one store cover the dashboard's and the graph editor's
shortcuts (#170). The definitions are in `src/configurations/`
(`inputBindings.ts`, `graphInputBindings.ts`); `keyboardShortcuts.ts` lists
every action with its scope (`app`, `drive`, `graph`), category and name, and
finds conflicts; `$/providers/inputBindings` holds the user's changes, saved in
`localStorage` under `inputBindings` (its file comment describes the versioned
format). Dispatch stays with each part: the dashboard's `defineBindingNamespace`
handlers, and the graph editor's `graphBindings` (`@/bindings`,
`defineRebindableKeybinds`), which follows the store. A new graph shortcut goes
in `graphInputBindings.ts` (and gets a name in `english.json`); a fixed one
stays in `@/bindings` with the reason it is fixed. The rulings are in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md` ("Rulings from
#170").

- `src/versions/` — the Versions tab, registered by `src/registerCore.ts` (local
  git versions).
- `src/versionChecker/` — the "new version available" dialog (GitHub releases),
  mounted by `App.vue`.
- `src/secrets/` — dormant: the secret and per-service credential forms and the
  project view's `UpsertSecretPanel`, kept compiling and tested for local
  secrets later (decision 5); nothing opens them.
- `src/datalinks/` — dormant until PR 2b: the datalink editor and its dialog.
- **Contribution registries.** The core reaches optional parts of the UI through
  registries, not by importing them: `contributeRightPanelTab` in
  `$/providers/rightPanelContributions` (the Versions tab uses it, from
  `registerCore.ts`), `contributeSettingsSections` in
  `$/providers/settingsContributions` (no contributor now). A contribution is a
  loader (`() => import(…)`), so its code stays out of the initial chunk; a tab
  or section that nothing contributes is hidden. Labels are not cloud-only: the
  drive's labels code is in `src/dashboard/components/labels/`, and asks the
  backend's `supportsLabels`.

## Engine logs (the bottom dock's Logs tab)

The bottom dock (`project-view/components/BottomPanel.vue`) has Code and Logs
tabs (`BottomPanel/`; the tab is saved under `bottom-dock-tab`). Both stay
mounted and are switched with `v-show`. `` Mod+` `` toggles the dock on its last
tab; `graph.toggleLogs` (`Mod+L`) opens it on Logs or closes it. The Logs tab
and its stream client are in `project-view/components/EngineLogs/` (see its
`CLAUDE.md`); `GraphEditor.vue` owns the stream so that the tab's error badge
counts while it is hidden.

## Entry points

- `index.html` → `src/entrypoint.ts` (browser bundle)
- `src/App.vue` — top-level Vue shell

## Scripts (run via `corepack pnpm`)

- `dev:vite` — Vite dev server with HMR.
- `build` — production bundle.
- `test:unit` — vitest.
- `test:integration` — Playwright.
- `playwright:install` — install the pinned browser.

## ProjectView ↔ backend

The ProjectView subtree talks to the Enso Language Server via Yjs documents. The
Yjs client lives in `ydoc-shared`; messaging is handled via WebSocket
(`y-websocket` / `modern-isomorphic-ws`). Parsing of Enso source on the client
side uses the Rust parser compiled to WASM (`rust-ffi` package →
`ydoc-shared/src/ast/`).

## Dashboard ↔ backend

The Dashboard talks to the local Project Manager shim, the only backend. The
shim (`app/project-manager-shim/`) is the local TypeScript Project Manager, used
in both dev and the packaged Electron build. The old Scala Project Manager is no
longer wired in.

The drive's sidebar is a list of **categories** (`$/providers/category`), each
on one backend (`CATEGORY_BACKEND`, always the local one): Local, Recent
(`localRecent`) and the saved local directories (`localDirectory`).

- **Ask `isRecentCategory`, never `type === 'localRecent'`**: a Recent list has
  no new folder or project and no navigating up, drops into or out of it are
  cancelled, and the listing asks `recentProjects`.
- A category with no home directory (a Recent) is rooted at its backend's root
  (`driveView.ts`).
- Local Recent's context menu keeps Open, Close, Label, Open in File Browser and
  Copy Id(s), and adds Remove from Recent (`AssetContextMenu.vue`).
- Labels (both backends) are in `src/dashboard/components/labels/`; see its
  `CLAUDE.md`. `Backend.supportsLabels(assetType)` gates every labels control.

## Assets and icons

Static assets live in `public/`. The GUI also ships with sample project
templates under `templates/`.

**Icons:** the only valid icon names are the `<symbol id="...">` entries in
`src/project-view/assets/icons.svg`. That set is mirrored into the generated
list `src/project-view/util/iconMetadata/iconName.ts` (do not hand-edit — it's
regenerated by `scripts/generateIconMetadata.mjs`, triggered via
`pnpm --filter enso-gui run generate-icons`). `SvgIcon` and `WidgetIcon` look up
their `name` prop against that list via `svgUseHref`
(`src/project-view/util/icons.ts`); any unknown name silently falls through to a
"missing" glyph. When you need an icon that isn't there yet, add a `<symbol>` to
`icons.svg` and regenerate. Grep `iconName.ts` or `icons.svg` before using a new
name — `ai_sparkle` was a painful example of an invented name that rendered
blank.

**Drawing an icon:** follow `docs/style-guide/icons.md` (16px canvas, filled by
default, 2px round strokes only for the tools family, `currentColor`, one 0.3
secondary tone). `src/project-view/assets/__tests__/iconStyle.test.ts` enforces
the mechanical rules; see `src/project-view/assets/CLAUDE.md`.

## Gotcha: builds without an AG Grid licence ship AG Grid Community

The table view falls back to AG Grid Community when
`ENSO_IDE_AG_GRID_LICENSE_KEY` is empty — silently, with no watermark or console
error. This applies to releases too: CI passes the `ENSO_AG_GRID_LICENSE_KEY`
repository variable when it exists, and the fork has none, so its releases ship
Community. (Releases used to fail the build without a key; that gate was removed
so the fork can release.)

Note `.env` sets `ENSO_IDE_AG_GRID_LICENSE_KEY=` as an empty placeholder, so any
check on this key must test for non-empty, never merely "is set".

## Gotcha: node memory

Vite production builds need `NODE_OPTIONS=--max-old-space-size=6144` (already
set in the `build` script). If you invoke Vite directly, re-export it or the
Rollup chunker OOMs when sourcemaps are on.

## Gotcha: two tsconfigs are type-checked, and `tsconfig.node.json`'s `include` is a closed list

The `typecheck` script (what CI's `ci:typecheck` runs) checks **both**
`tsconfig.app.json` (the Vue app, `src/`) and `tsconfig.node.json` (node-side
code: `integration-test/`, `playwright.config.ts`, the Vite configs) — see #141.
Before that fix, `tsconfig.node.json` was never checked in CI and had quietly
accumulated ~20 errors.

`tsconfig.node.json` is a **composite** project (inherited from `tsconfig.json`
via `extends`), so TypeScript requires every file the checker reaches —
including one pulled in only by a type-only import — to appear in its `include`.
Node-side code occasionally needs a type or small pure-TS helper from `src/`
(e.g. `base.ts` importing the `FeatureFlags` type), and that file's own imports
then need listing too. **Resist the urge to fix a resulting `TS6307` by adding a
broad `"./src/**/*.ts"` glob** — that pulls in `entrypoint.ts`, which imports
`App.vue`, which cascades into the whole Vue app and produces hundreds of
unrelated errors (every `.vue` file is then "reachable but not included").
Instead add the exact file(s) TypeScript names in the error to
`tsconfig.node.json`'s `include` list, one by one, until the error is gone — the
closure is small and finite in practice (it was 13 files for #141, listed in the
file with a comment explaining why).

## Local versioning (saving versions)

`$/providers/localVersioning` holds each open local project's git status (polled
every 5 s by its own loop, one request in flight at a time), saving (the ydoc
flush, `flush.ts`, then `versioning/commit`) and the repository prompts;
`projectStates.ts` watches a local project when it initializes and offers a
repository before it closes. Versions are saved when a project closes or is
saved; quitting the app saves none. The Playwright mock is
`integration-test/mock/localVersioning.ts` (routes in `mock/versioning/`); git
is absent by default, and a spec opts in with `setupApi.local`. See the design,
`docs/superpowers/specs/2026-10-16-local-git-versioning-design.md`.
