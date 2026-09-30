# dashboard/

The **Dashboard feature** subtree: sign-up/sign-in, cloud project browser,
settings, billing, subscription management. Everything whose meaning is tied to
the Enso Cloud shell (before a project is opened, or alongside it) lives here.
Import via the `#/` path alias.

**Currently implemented in React, legacy.** Vue is the main GUI framework; this
subtree was built as an independent React effort and is being progressively
migrated to Vue. Prefer porting a component to Vue over extending it here. New
features default to Vue.

Once the migration completes, this directory is expected to hold only
Dashboard-specific Vue code — common UI primitives / utilities should live at
`src/` directly (see the sibling project-view structure for the same principle).

## Structure (React, legacy shape)

- `pages/` — Route-level components. Top of the component tree for each URL.
- `layouts/` — Chromes that wrap multiple pages (protected-route wrappers, split
  panels).
- `modules/` — Feature-oriented slices (`payments/` for Stripe flows, etc.). A
  module owns its state and components.
- `components/` — Reusable UI atoms/molecules. Sub-folders group related parts
  (`Button/`, `Form/`, `Dialog/`, `Menu/`). The `aria/` folder re-exports
  `react-aria-components` with project-level styling applied. Truly shared UI
  will move to `src/` proper as it's ported.
- `providers/` — React context providers (auth, text/i18n, modals, toasts,
  etc.).
- `hooks/` — Custom React hooks.
- `data/serviceCredentials/` — the React forms for creating service credentials.
  Their framework-free recipes live in `src/cloud/`.
- `modals/` — Global-modal registry and renderer.
- `utilities/` — React-bound helpers only (`jsx`, `mergeRefs`, `reactQuery`,
  `tanstackQuery`, `zustand`, `vue`, …), plus `debug` and `equalities`.
- `styles.css`, `tailwind.css`, `typings.d.ts` — Tailwind plus global resets.

## Conventions (current React stack)

- **UI lib**: `react-aria-components` for accessibility primitives,
  `tailwind-variants` and `tailwind-merge` for class composition,
  `tailwindcss-react-aria-components` for matching selectors.
- **Forms**: `react-hook-form` + `zod` resolvers. Schemas live with the form,
  not in `data/`.
- **Async/data**: `@tanstack/react-query` throughout. Keys, queries, and
  mutations should go through the factories in `data/` — don't call `useQuery`
  with a literal key inside a component.
- **Routing**: `vue-router` (yes, really — the dashboard lives inside a Vue
  shell; React components consume routing via the bridge).
- **Error boundaries**: wrap new features with `ErrorBoundary` from
  `components/`; don't catch errors with try/catch for render-time failures.
- **Styling**: Tailwind + CSS nesting (enabled via `postcss-nesting`). Prefer
  class utilities over ad-hoc CSS; if you need a component class, use
  `tailwind-variants`.

## Auth / cloud

The Dashboard authenticates against AWS Cognito via `aws-amplify`. Session
tokens are stored via `accessToken.ts` in `app/common/` and mirrored into the
Project Manager / LS so the engine can reach Enso Cloud.

## Talking to ProjectView

This subtree never imports from `@/` (the ProjectView subtree). Cross-subtree
wiring goes through shared providers under `src/providers/` (the `$/providers/`
alias), and each side subscribes.

## Tests

- Unit: `vitest` + `@testing-library/react`.
- Integration: Playwright specs in `app/gui/integration-test/dashboard/`.

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
- `useToast` on Reka `Toast`;
- a global modal stack;
- Tailwind `aria-*:`/`data-[…]:` variants instead of the react-aria modifiers;
- cloud-only areas under top-level `src/cloud/<area>/`, so a community build can
  leave them out.

Every port PR follows this checklist.

1. **One mount site per PR.** Port a slice, switch the single place that mounts
   it (a `reactComponent(...)` wrapper, a route, a `reactTabs.ts` entry), and
   **delete the React file in the same PR**. There are no feature flags and no
   parallel copies, and the app ships after every PR. If the React file has
   other importers, it is not ready to delete, so port a smaller slice.
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
     registries.
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
