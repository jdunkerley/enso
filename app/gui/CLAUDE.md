# app/gui

The main Enso IDE GUI — a single-page web app built with Vite, served by
Electron (desktop) or a static host (cloud). Published as package `enso-gui`.

## Source layout

**Vue is the main GUI framework.** Shared infrastructure — app shell, command
palette, loading screen, cross-feature primitives, i18n, providers — lives at
`src/` directly (`src/components/`, `src/providers/`, etc.), not inside any
feature subtree. Feature-specific code lives in a subtree named after the
feature:

- `src/project-view/` — the **ProjectView** feature subtree (graph editor,
  component browser, code editor, visualizations, documentation editor). Vue.
  Uses `@vueuse/core`, `@tanstack/vue-query`, `yjs`. Import via `@/…`.
- `src/dashboard/` — the **Dashboard** feature subtree (auth, cloud storage,
  project browser, settings, billing). Still **React** as a historical artifact;
  being progressively migrated to Vue. Uses `react-aria`,
  `@tanstack/react-query`, `react-hook-form`, `zod`. TailwindCSS for styling.
  Import via `#/…`.

While the migration is in progress the two subtrees are bridged by **`veaury`**
so Vue can embed React (and vice versa): Vue mounts React through
`reactComponent` (`$/utils/react`), React mounts Vue through `vueComponent`
(`#/utilities/vue`). Stay in one framework per file; only cross at the bridge
boundary. `src/project-view/` no longer crosses it at all (#82).

Many commons still sit inside `src/project-view/` for historical reasons. The
plan is to move genuinely shared UI/utilities **out** of `project-view/` and
into `src/` proper so each feature subtree holds only its own feature-specific
code. When you add something new, ask: is it ProjectView-only, Dashboard-only,
or shared? Shared goes at `src/`.

**Rule of thumb for new work:** default to Vue, put cross-feature code at
`src/`, put feature-specific code in the matching subtree. When a Dashboard
component needs non-trivial changes, consider porting it to Vue rather than
extending the React version.

`App.vue` / `ReactRoot.tsx` / `entrypoint.ts` wire the subtrees together at the
top level.

## TypeScript path aliases

Defined in `vite.config.ts`:

- `@/…` → `src/project-view/…` (ProjectView feature subtree, Vue)
- `#/…` → `src/dashboard/…` (Dashboard feature subtree, currently React)
- `$/…` → `src/…` (shared/cross-feature code: app shell, providers, common
  components, i18n)

Reaching across subtrees (`@/` from `src/dashboard/`, or `#/` from
`src/project-view/`) is allowed but usually a smell — prefer pulling shared code
into `src/` and importing via `$/`, or cross the framework bridge via `veaury`.

**Nothing outside `src/dashboard/` may import `#/…`**, except the React modules
listed in `DASHBOARD_IMPORT_ALLOWLIST` in the root `eslint.config.mjs` (React
components mounted through `reactComponent`, and the bridge's own glue). ESLint
enforces this. The list only shrinks: when shared code needs something from the
dashboard that is framework-free, move it to `src/` (as #77 did) rather than
adding an entry. React files may import `$/…` freely.

## Where framework-free shared code lives

- `src/utils/` — general helpers (`LocalStorage`, `LruCache`, `event`,
  `inputBindings`, `download`, `mimeTypes`, `datalinkValidator`, …);
  `src/utils/data/` for small data-structure helpers; `src/utils/style/` for
  Tailwind class composition (`tailwindVariants`, `tailwindMerge`);
  `src/utils/testing/` for test-only helpers (`mountWithProviders`, the Vue
  component-test harness).
- `src/components/<Name>/variants.ts` — Tailwind variants shared by the React
  component of that name and its Vue port (`Button`, `Dialog`, `Text`, `Icon`,
  `Menu`, `Tooltip`, `Inputs`, …), plus other framework-free component
  constants. The Vue primitives themselves live beside them; see
  `src/components/CLAUDE.md`.
- **The backend's queries and mutations** (#192): `src/utils/backendQuery.ts`
  defines every backend method's query and mutation options once (key, stale
  time, persistence, invalidations), typed with `@tanstack/query-core`, so that
  React's `useQuery` and vue-query consume the same objects in the one shared
  `QueryClient`; `executeMutation` runs one from outside any component.
  `driveQueries.ts` (listings, search, new names), `driveMutations.ts` (the
  batched delete, restore, copy, move and download; the move's duplicate
  resolver is injected) and `transferBetweenCategories.ts` (with its context
  injected) build on it. The Vue wrappers are `@/composables/backend` and
  `$/composables/transferBetweenCategories`; the React ones are the
  `#/hooks/backend*Hooks` adapters, which go with the React drive (#91). Never
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

- `src/cloud/` — code that only makes sense against the Enso Cloud: at the top,
  framework-free logic (service-credential recipes, organization-invite email
  parsing, the Cognito password rule, permission classes); in
  `src/cloud/<area>/`, ported cloud-only features (`auth/`: the sign-in, sign-up
  and password pages; `account/`: the Account and API keys settings tabs'
  sections; `organization/`: the Organization, Members, User groups and Activity
  log tabs' sections and the "Invite" dialog; `billing/`: the paywall, the Usage
  tab and the top bar's billing parts; `versions/` and `properties/`: the right
  panel's Versions, Schedule and Properties tabs). Keep cloud-only code here
  rather than in `src/utils/`, so a build without the cloud can drop one folder.
  The core reaches the areas only through `registerCloud`
  (`src/cloud/index.ts`), which `entrypoint.ts` calls; see
  `src/cloud/CLAUDE.md`.

## Entry points

- `index.html` → `src/entrypoint.ts` (browser bundle)
- `src/App.vue` — top-level Vue shell that mounts both subtrees

## Scripts (run via `corepack pnpm`)

- `dev:vite` — Vite dev server with HMR.
- `build` / `build-cloud` — production bundle (with `ENSO_IDE_CLOUD_BUILD` env
  toggle for cloud-specific behavior).
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

The Dashboard subtree talks to the Enso Cloud over HTTPS (AWS Amplify +
Cognito). In local/desktop mode it also talks to the local TypeScript Project
Manager (`app/project-manager-shim/`), which is used in both dev and the
packaged Electron build. The old Scala Project Manager is no longer wired in.

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

## Gotcha: releases require an AG Grid licence

The table view falls back to AG Grid Community when
`ENSO_IDE_AG_GRID_LICENSE_KEY` is empty — silently, by design, so development,
CI and third-party builds work without a key. Because nothing at runtime reveals
the fallback, `vite.config.ts` carries a `requireAgGridLicense` plugin that
**fails the build** when `ENSO_IDE_REQUIRE_AG_GRID_LICENSE=true` and the key is
empty. CI sets that flag for release packaging only (`prepare_packaging_steps`
in `build_tools/build/src/ci_gen/job.rs` → `release.yml`); `ide-packaging.yml`
and `gui-checks.yml` deliberately do not.

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
unrelated errors (every `.vue`/`.tsx` file is then "reachable but not
included"). Instead add the exact file(s) TypeScript names in the error to
`tsconfig.node.json`'s `include` list, one by one, until the error is gone — the
closure is small and finite in practice (it was 13 files for #141, listed in the
file with a comment explaining why).
