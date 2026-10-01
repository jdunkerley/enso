# src/components/

Shared Vue UI: the app shell (`AppContainer/`, `CommandPalette.vue`, …) and the
**UI primitives** the React dashboard is being ported onto (#75). Import via
`$/components/…`. Nothing here may import `#/` (the React dashboard; ESLint
enforces it).

## The primitives

One folder per primitive, holding its SFCs, its `variants.ts` and its
`__tests__/`:

| Folder           | Components                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `Button/`        | `Button`, `ButtonGroup`, `CloseButton`, `CopyButton`                                            |
| `Text/`          | `Text`, `Heading`, `TextGroup`                                                                  |
| `Icon/`          | `Icon` (from `icons.svg`)                                                                       |
| `Dialog/`        | `Dialog`, `Popover`, `DialogClose`                                                              |
| `AlertDialog/`   | `AlertDialog`, `ConfirmDeleteModal` (asked through the modal stack)                             |
| `Menu/`          | `DropdownMenu`, `ContextMenu`, `MenuItem`, `MenuSection`, `MenuSeparator`, `MenuSubmenu`        |
| `Tooltip/`       | `Tooltip` (accessible), `VisualTooltip` (visual only)                                           |
| `ErrorBoundary/` | `ErrorBoundary` (`onlyRenderErrors` at route and tab roots), `SuspenseLoader`                   |
| `Spinner/`       | `Spinner`, `StatelessSpinner`, `Loader`                                                         |
| `Toast/`         | `ToastHost` (one, in `App.vue`), `ToastItem`; the store is `$/providers/toasts`                 |
| `ModalHost/`     | `ModalHost`, rendering the modal stack `$/providers/modals`                                     |
| `AboutModal/`    | `AboutModal` (one, in `App.vue`), opened by `openAboutModal()`                                  |
| `Link/`          | `Link` (a coloured link with an icon); `useClientNavigation` (`clientNavigation.ts`)            |
| others           | `Alert`, `Badge`/`StatusBadge`, `Breadcrumbs`, `ProgressBar`, `Result`, `Scroller`, `Separator` |

Forms and inputs are #79's.

**Toasts and programmatic modals are global stores**, not components you mount:
call `useToast()` (`@/util/toast`) or `useToasts()`, and
`useModals().open(C, props)`, or `useModals().ask(C, props)` for a confirmation
(it resolves `'confirm'` or `'dismiss'`). A stack modal leaves when it emits
`close`; a `Dialog`/`AlertDialog` emits `closed` after its exit animation, which
is when to emit it. `ModalHost` is mounted where the React modals need their
providers (`AppContainer.vue`, and the React `Page` elsewhere); never mount a
second one on a page that has one. A dialog opened by its own trigger stays a
local `<Dialog>`.

## Rules

- **Same styles as React.** Each primitive renders the `variants.ts` its React
  counterpart uses; `src/dashboard/components/__tests__/vuePortParity.test.tsx`
  checks the classes match. Only react-aria-only modifiers are respelled, as
  `data-[…]:`/`aria-*:` (`*_MOTION` constants beside the variants).
- **Reka UI** (`reka-ui`, exact pin) provides the behaviour: focus, keyboard,
  dismissal, ARIA. Overlays teleport to `portalTarget()` (`#enso-portal-root`).
- **Prop names follow React** (`isDisabled`, `isLoading`, `testId`, `tooltip`,
  variant names), with Vue mechanics: `class`, `*Class`, slots, `v-model:open`,
  a `trigger` slot instead of `X.Trigger`. See "Rulings from #78" in
  `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
- **Links navigate in the app.** react-aria's `RouterProvider` turned a plain
  click on a React link to a page of this app into a router push; `Link` and a
  `Button` with an `href` do the same through `useClientNavigation`. Use them
  (or that handler) for an in-app link, not a bare `<a>`, which reloads the
  page.
- **Boolean props need an explicit `undefined` default** when `false` means
  something different from "not set" (a variant default, a group's shared
  value): Vue casts an absent `boolean` or `string | false` prop to `false`.
- Component tests use `__tests__/mountWithProviders.ts` (portal root, attach to
  the document, auto-unmount) and `@testing-library/user-event`. Cover roles,
  keyboard, focus and Escape: what react-aria gave the React version for free.

## Forms and inputs (#79)

The Vue form layer and inputs follow the same rules. The form is an in-house
`useForm` over zod (decision 2), with the React `Form` API: see the header of
`Form/Form.vue` for a usage example, and "Rulings from #79" in the decision
record for where it differs.

| Folder            | Components                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Form/`           | `Form`, `Field`, `FieldError`, `FieldValue`, `FormError`, `Submit`, `Reset`; `useForm`, `useField`, `useFormContext`; `errorMap.ts` (shared with React)     |
| `Inputs/`         | `Input`, `BasicInput`, `Password`, `HiddenFile`, `Dropdown`, `FormDropdown`, `Selector`, `MultiSelector`, `ComboBox`, `DatePicker`, `TimeField`, `OTPInput` |
| `Checkbox/`       | `Checkbox`, `CheckboxGroup`, `Check`                                                                                                                        |
| `Radio/`          | `Radio`, `RadioGroup`                                                                                                                                       |
| `Switch/`         | `Switch`                                                                                                                                                    |
| `Stepper/`        | `Stepper`, `Step`, `StepContent`, `useStepperState`                                                                                                         |
| `ContextualHelp/` | `ContextualHelp`                                                                                                                                            |

- **Inputs are form fields.** Each takes a `name` (and optionally a `form`) and
  binds to the enclosing `Form.vue` through `useField`, as the React ones do;
  `Checkbox` and `Dropdown` also work without a form (`v-model`).
- **The control carries the ARIA state**: `aria-invalid`, and
  `aria-describedby`/`aria-errormessage` pointing at the field's error (the ids
  come from `useField`).
- **Native where react-aria was native.** Checkboxes, radios, switches and the
  `Selector` are native inputs hidden in a `<label>`, the DOM react-aria
  renders; lists, the combo box, dates and the one-time code are Reka.
- **React-aria-only modifiers** in the shared variants are respelled for Vue in
  `*_VUE_STATES` constants beside them, and the parity test
  (`src/dashboard/components/__tests__/vuePortFormParity.test.tsx`) removes them
  before comparing classes.
