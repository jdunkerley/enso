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
| `AlertDialog/`   | `AlertDialog`                                                                                   |
| `Menu/`          | `DropdownMenu`, `ContextMenu`, `MenuItem`, `MenuSection`, `MenuSeparator`, `MenuSubmenu`        |
| `Tooltip/`       | `Tooltip` (accessible), `VisualTooltip` (visual only)                                           |
| `ErrorBoundary/` | `ErrorBoundary`, `SuspenseLoader`                                                               |
| `Spinner/`       | `Spinner`, `StatelessSpinner`, `Loader`                                                         |
| others           | `Alert`, `Badge`/`StatusBadge`, `Breadcrumbs`, `ProgressBar`, `Result`, `Scroller`, `Separator` |

Forms and inputs are #79's; the toast host and the global modal stack are #80's.

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
- **Boolean props need an explicit `undefined` default** when `false` means
  something different from "not set" (a variant default, a group's shared
  value): Vue casts an absent `boolean` or `string | false` prop to `false`.
- Component tests use `__tests__/mountWithProviders.ts` (portal root, attach to
  the document, auto-unmount) and `@testing-library/user-event`. Cover roles,
  keyboard, focus and Escape: what react-aria gave the React version for free.
