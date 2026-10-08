# dashboard/

The **Dashboard feature** subtree: sign-up/sign-in, cloud project browser,
settings. Everything whose meaning is tied to the Enso Cloud shell (before a
project is opened, or alongside it) lives here. Import via the `#/` path alias.

**Vue.** This subtree was built as an independent React effort and has been
ported to Vue (#75); no React code is left in it (#93). Removing React and its
dependencies from the toolchain is #94. Common UI primitives and utilities live
at `src/` directly (see the sibling project-view structure for the same
principle); this directory holds only Dashboard-specific code.

## Structure

- `pages/` — Route-level parts. `pages/dashboard/UserBar/` is the user bar, user
  menu and notification tray (#83), mounted by `AppContainer.vue`; the drive's
  rows, cells, column headings and drive bar are under `pages/dashboard/`. The
  `dashboard` route itself renders `$/components/DashboardPage.vue`, which holds
  the dashboard's global shortcuts and mounts `AppContainer.vue`.
- `layouts/` — The drive (#91): `DriveView.vue` (mounted by `LeftPanel.vue`)
  provides the drive store and its view state and holds `AssetsTable.vue`, the
  search bar and the context menus; `layouts/Drive/` has its composables
  (`driveView.ts`, the shown-versus-target location that stands in for React's
  navigation transition; `driveActions.ts`; `assetItems.ts`; `suggestions.ts`;
  drag and drop). Its dialogs open on the modal stack (`$/providers/modals`),
  the labels, credential and datalink ones from `$/cloud/` (#198). Buttons
  inside a row bind `STOP_PRESS_PROPAGATION`
  (`layouts/Drive/pressPropagation.ts`), as react-aria's `usePress` stopped a
  press reaching the row. `layouts/Settings/` is the settings page.
- `components/` — The drive's `ContextMenu.vue`. Shared primitives are in
  `src/components/`.
- `modals/` — `CaptureKeyboardShortcutModal.vue`. The drive's other dialogs are
  in `$/components/Drive/`, `$/components/AlertDialog/` and `$/cloud/`.
- `styles.css`, `tailwind.css`, `typings.d.ts` — Tailwind plus global resets.

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

Utilities, types, configuration and Tailwind variants that import no React live
in shared `src/` (see "Where framework-free shared code lives" in
`app/gui/CLAUDE.md`), and React files here import them via `$/…`. When a
dashboard module turns out to be framework-free, move it out rather than adding
to this subtree; cloud-only logic goes to `src/cloud/`.

## Porting a React component to Vue (playbook)

The foundation choices are recorded in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`; its status line
says which are provisionally accepted and which the maintainer has confirmed.
They are:

- Reka UI for accessibility primitives;
- in-house `useForm` over zod;
- `useToast` on one Vue `ToastHost` (hand-built, not Reka's `Toast`; see
  "Rulings from #80");
- a global modal stack;
- Tailwind `aria-*:`/`data-[…]:` variants instead of the react-aria modifiers;
- cloud-only areas under top-level `src/cloud/<area>/`, so a community build can
  leave them out.

Every port PR follows this checklist.

1. **One mount site per PR.** Port a slice, switch the single place that mounts
   it (a route, a tab entry, a component), and **delete the React file in the
   same PR**. There are no feature flags and no parallel copies, and the app
   ships after every PR. If the React file has other importers, it is not ready
   to delete, so port a smaller slice.
2. **Keep every `data-testid` and accessible name**, identical: role, label,
   `aria-*`, visible text. The specs must pass **unedited**; only page objects
   (`integration-test/actions/`) may change.
3. **Neutralise locators before the swap.** Page objects that match react-aria
   or react-toastify internals (`[data-selected="true"]`, `.Toastify__toast`,
   and comments that mention react-aria timing) move to role, label or testid
   locators, in the same PR, and pass on `develop` first.
4. **Put code where the record says.**
   - Primitives go in `src/components/<Name>/` (`$/components/…`), with their
     `variants.ts`.
   - Features go in `src/dashboard/` as `.vue`, in the same folder the `.tsx`
     was in.
   - Cloud-only features go in `src/cloud/<area>/`, reached only through the
     registries: `registerCloud` (`src/cloud/index.ts`) adds them, and an ESLint
     rule keeps the core off them (add the area to `CLOUD_AREAS` in
     `eslint.config.mjs`). See `src/cloud/CLAUDE.md`.
   - Give every text field of a ported form a default (`''`): react-hook-form
     read an untouched input as `''`, the Vue form leaves it `undefined`, which
     zod reports as "This field is invalid" instead of the field's message.
   - Stores use `createContextStore`, unless non-component code must reach them.
5. **Reuse the styles.** Build on the existing `variants.ts` (as
   `DashboardDialogContent.vue` and `src/components/Menu/variants.ts` do).
   Rewrite only the react-aria-only modifiers (`selected:`, `pressed:`,
   `placement-*:`, `outside-visible-range:`, `placeholder:`, and `disabled:` on
   non-native elements) to `aria-*:` or `data-[…]:`.
6. **Run the area's Playwright specs N times in WSL, on both branches** (N ≥ 5,
   with `--repeat-each` and the default workers), and compare pass rates, not
   single runs. Use a private clone and a distinct `PLAYWRIGHT_PORT`. A new
   flake on the port branch blocks the merge, even if the spec is "known flaky".
   Run the axe accessibility checks (#81) too; the ported area must not add
   violations to the checked-in baseline.
7. **Unit-test the behaviour react-aria gave for free**, with vitest and
   `@testing-library/user-event`: keyboard, focus and Escape (see
   `src/components/Menu/__tests__/DropdownMenu.test.ts`).
8. **Changelog, under the repo's current rule** (root `CLAUDE.md`).
   - A **faithful port with no visible change** takes the
     `CI: No changelog needed` label.
   - A port that **changes what users see or can do** (a new keyboard path,
     different styling) gets an entry.
   - When in doubt, ask.
9. **Verify** with a clean typecheck (delete `*.tsbuildinfo`), `eslint` and
   `prettier` on the touched files, `vitest`, and `corepack pnpm run build`.
   Note the bundle delta in the PR if it moves by more than a few KB.
