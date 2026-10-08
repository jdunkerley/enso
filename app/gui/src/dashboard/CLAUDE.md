# dashboard/

The **Dashboard feature** subtree: sign-up/sign-in, cloud project browser,
settings. Everything whose meaning is tied to the Enso Cloud shell (before a
project is opened, or alongside it) lives here. Import via the `#/` path alias.

**Vue.** This subtree was built as an independent React effort and has been
ported to Vue (#75); React and its dependencies are gone from the toolchain
(#94). Common UI primitives and utilities live at `src/` directly (see the
sibling project-view structure for the same principle); this directory holds
only Dashboard-specific code.

## Structure

- `pages/` — Route-level parts. `pages/dashboard/UserBar/` is the user bar, user
  menu and notification tray (#83), mounted by `AppContainer.vue`; the drive's
  rows, cells, column headings and drive bar are under `pages/dashboard/`. The
  `dashboard` route itself renders `$/components/DashboardPage.vue`, which holds
  the dashboard's global shortcuts and mounts `AppContainer.vue`.
- `layouts/` — The drive (#91): `DriveView.vue` (mounted by `LeftPanel.vue`)
  provides the drive store and its view state and holds `AssetsTable.vue`, the
  search bar and the context menus; `layouts/Drive/` has its composables
  (`driveView.ts`, the shown-versus-target location, which keeps the previous
  listing on screen until the new one has loaded; `driveActions.ts`;
  `assetItems.ts`; `suggestions.ts`; drag and drop). Its dialogs open on the
  modal stack (`$/providers/modals`), the labels, credential and datalink ones
  from `$/cloud/` (#198). Buttons inside a row bind `STOP_PRESS_PROPAGATION`
  (`layouts/Drive/pressPropagation.ts`), so that a press on them does not reach
  the row. `layouts/Settings/` is the settings page.
- `components/` — The drive's `ContextMenu.vue`. Shared primitives are in
  `src/components/`.
- `modals/` — `CaptureKeyboardShortcutModal.vue`. The drive's other dialogs are
  in `$/components/Drive/`, `$/components/AlertDialog/` and `$/cloud/`.
- `styles.css`, `tailwind.css` — Tailwind plus global resets.

The dashboard's keyboard shortcuts are the window's
(`$/providers/dashboardInputBindings`, the dashboard half of
`$/providers/inputBindings`, #170): menus read them through
`$/composables/menuEntries`, and the settings page edits them. Toasts go through
the Vue toast store (`$/providers/toasts`), modals through the modal stack
(`$/providers/modals`); the About dialog opens with `openAboutModal()`
(`$/components/AboutModal/aboutModal`).

## Conventions

- **Async/data**: vue-query over the framework-free options in
  `$/utils/backendQuery`, `$/utils/driveQueries` and `$/utils/driveMutations`
  (#192) — don't call `useQuery` with a literal key inside a component, and
  don't give a key options of its own.
- **Routing**: `vue-router`.
- **Styling**: Tailwind + CSS nesting (enabled via `postcss-nesting`). Prefer
  class utilities over ad-hoc CSS; if you need a component class, use
  `tailwind-variants`.

## Auth / cloud

The Dashboard authenticates against AWS Cognito via `aws-amplify`. The logic is
Vue (`src/authentication/`, `src/providers/{auth,session}.ts`), and so are the
sign-in, sign-up and password pages, in `src/cloud/auth/` (#85). Session tokens
are stored via `accessToken.ts` in `app/common/` and mirrored into the Project
Manager / LS so the engine can reach Enso Cloud.

## Talking to ProjectView

This subtree never imports from `@/` (the ProjectView subtree). Cross-subtree
wiring goes through shared providers under `src/providers/` (the `$/providers/`
alias), and each side subscribes.

## Tests

- Unit: `vitest` with `@vue/test-utils`, through `mountWithProviders`
  (`src/utils/testing/`).
- Integration: Playwright specs in `app/gui/integration-test/dashboard/`. A port
  follows the parity checklist in `app/gui/integration-test/CLAUDE.md`.

## Framework-free code does not live here

Utilities, types, configuration and Tailwind variants that import no framework
live in shared `src/` (see "Where framework-free shared code lives" in
`app/gui/CLAUDE.md`), and files here import them via `$/…`. When a dashboard
module turns out to be framework-free, move it out rather than adding to this
subtree; cloud-only logic goes to `src/cloud/`.

## Foundations

The port to Vue (#75) is complete; its foundation choices are recorded in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`, and still hold
for new work:

- Reka UI for accessibility primitives;
- in-house `useForm` over zod (give every text field a default, `''`: zod
  reports an `undefined` field as "This field is invalid" instead of the field's
  own message);
- `useToast` on one Vue `ToastHost` (hand-built, not Reka's `Toast`);
- a global modal stack;
- cloud-only areas under top-level `src/cloud/<area>/`, reached only through
  `registerCloud` (`src/cloud/index.ts`), so a community build can leave them
  out; an ESLint rule keeps the core off them (add a new area to `CLOUD_AREAS`
  in `eslint.config.mjs`). See `src/cloud/CLAUDE.md`;
- stores use `createContextStore`, unless non-component code must reach them.

For state styling, the components use the `selected:`, `pressed:`,
`placement-*:`, `outside-visible-range:` and `placeholder-shown:` variants over
the `data-*` attributes they set, defined in `tailwind.config.ts`
(`STATE_VARIANTS`), as well as `aria-*:` and `data-[…]:`.
