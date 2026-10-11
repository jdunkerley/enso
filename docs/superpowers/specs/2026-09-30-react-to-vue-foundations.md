# React → Vue: foundation decisions (#76)

**Date:** 2026-09-30 **Status:** Decisions 1–6b and 8 provisionally accepted
2026-09-30 under delegation (maintainer to review); 7 decided by the maintainer
**Epic:** #75 **Ticket:** #76

> **Completed:** the port is finished, and React was removed from the toolchain
> in #94.

The dashboard (`app/gui/src/dashboard/`, about 46.9k lines of React) rests on
four libraries that have no Vue counterpart yet: react-aria, react-hook-form,
react-toastify, and a zustand store that holds React elements as the global
modal slot. Every porting ticket (#78–#94) depends on how these are replaced.
This record sets out each choice, with the evidence and the rejected
alternatives. It also records the scope decisions the maintainer has already
made.

Each decision is marked:

- **Decided:** already settled by the maintainer.
- **Provisionally accepted:** the maintainer, away overnight, delegated these
  decisions on 2026-09-30 (#76, last comment). Ports may build on them; the
  maintainer reviews them and can reverse any.

The spike in this PR (decision 1) is the only code. It adds no user-visible
change.

## Summary

| #   | Decision                   | Recommendation                                                                                                                                 | Status                                                              |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Headless accessibility lib | **Reka UI 2.10.5**, exact pin. Hand-roll only what it lacks (tables, drag and drop, selection brush), as React does today                      | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 2   | Forms                      | **In-house `useForm` over zod**, keeping today's `Form`/`Field`/`Submit`/`Reset`/`FormError`/`FieldValue` API. No vee-validate                 | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 3   | Toasts                     | **In-house `useToast` store + one `ToastHost.vue` on Reka `Toast` primitives.** No vue-sonner                                                  | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 4   | Modal stack                | **Global `{ component, props }` stack + one `ModalHost.vue`**, with a shim that keeps React `setModal`/`unsetModal` callers working            | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 5   | Tailwind modifiers         | **No mapping plugin.** Use Tailwind's built-in `aria-*:` and `data-[…]:` variants in Vue code. Drop `tailwindcss-react-aria-components` in #94 | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 6   | Where code goes            | Primitives in `src/components/`, features in `src/dashboard/` as `.vue`, stores via `createContextStore` (global state only where it must be)  | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 6a  | zustand                    | **Keep until #93** as framework-neutral glue; no new zustand stores; replace with Vue state and `useStorage` when the last React reader goes   | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 6b  | Cloud-only separability    | **Top-level `src/cloud/<area>/`** behind a lint boundary and a contribution registry                                                           | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |
| 7   | Port or delete             | **Port every cloud-only area; delete none.** The fork diverges freely from upstream                                                            | Decided                                                             |
| 8   | Port playbook              | Appended to `app/gui/src/dashboard/CLAUDE.md`                                                                                                  | Provisionally accepted 2026-09-30 (delegated; maintainer to review) |

## How the evidence was gathered

All counts come from `develop` at `22204a6f87` (2026-09-30), over
`app/gui/src/dashboard`, unless stated otherwise.

- **react-aria usage** was counted per symbol, across namespace imports
  (`aria.X`) and named imports from `#/components/aria`, `react-aria`,
  `react-aria-components`, `react-stately` and `@react-aria/*`. 68 files import
  one of these modules.
- **Wrapper usage** was counted as JSX occurrences of the dashboard's own
  components (`<Dialog`, `<Form`, …).
- **Bundle figures:**
  - _In-app deltas_ compare two production builds (`corepack pnpm run build`) by
    chunk, with sourcemap attribution per package.
  - _Per-library figures_ are esbuild bundles (minified, tree-shaken) with
    `vue`, `react`, `zod`, `@floating-ui/*` and `@internationalized/*` external,
    because the app already ships those. esbuild does not deduplicate against
    the app the way Rollup does, so treat these figures as upper bounds. For
    `DropdownMenu`, the in-app cost was 69% of the esbuild figure.
- **Maintenance health** comes from npm: release dates, and weekly downloads for
  2026-09-22 to 2026-09-28.

## 1. Headless accessibility library

### Options

- **A. Reka UI** (the Vue successor of Radix Vue).
- **B. Hand-rolled** on the existing `@floating-ui/vue` plus `@vueuse/core`.
- **C. Headless UI for Vue** (Tailwind Labs).
- **D. Ark UI** (Zag.js state machines).

### What the dashboard actually uses from react-aria

The table below counts the files that use each family, as primitives. The
wrappers built on them reach much further: `<Dialog` has 23 uses, `<Popover` 22,
`<Form` 43, `<Input` 44, `<Checkbox` 10 (plus 7 `Checkbox.Group`), `<Switch` 12,
`<ComboBox` 7, `<Radio` 7, `<Selector` 5, `<Stepper` 5 and `<DatePicker` 3.
There are also 36 `Dialog.Trigger`/`Popover.Trigger` sites and 15 controlled
dialogs.

| react-aria family                                                 | Files | Reka UI covers it with                                                              |
| ----------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------- |
| Dialog / Modal / Popover / overlay state                          |     9 | `Dialog`, `AlertDialog`, `Popover` (focus trap, scroll lock, `aria-hidden`)         |
| Menu, submenu, `Keyboard`                                         |     3 | `DropdownMenu`, `ContextMenu`, `…Sub*` (typeahead, roving focus)                    |
| ListBox / ComboBox / `useFilter`                                  |     6 | `Listbox`, `Combobox` (with its own filtering), `Select`                            |
| Tooltip                                                           |     2 | `Tooltip`                                                                           |
| Text fields, labels and field errors (`TextField`, `SearchField`) |    17 | `Label` + native inputs. The `Form` wiring moves to decision 2                      |
| Checkbox / Radio / Switch (+ groups)                              |     9 | `Checkbox`, `CheckboxGroup`, `RadioGroup`, `Switch`                                 |
| Date / time (`DatePicker`, `Calendar`, `TimeField`)               |     3 | `DatePicker`, `Calendar`, `DateField`, `TimeField` (same `@internationalized/date`) |
| Tabs                                                              |     1 | `Tabs`                                                                              |
| Table / GridList / TagGroup                                       |     4 | **Nothing.** See the gaps below                                                     |
| Drag and drop (`useDrop`), `FileTrigger`                          |     3 | **Nothing.** See the gaps below                                                     |
| Buttons, links, `Pressable`, press events                         |     9 | Native `<button>`/`<a>`. Reka has no press abstraction, and Vue needs none          |
| Focus/hover hooks (`useFocusRing`, `useHover`, …)                 |     9 | `:focus-visible` / `:hover` in CSS, and `@vueuse/core` (`useFocusWithin`)           |
| Breadcrumbs (`useBreadcrumbItem`)                                 |     1 | Plain `<nav>` + `aria-current`                                                      |
| Providers (`I18nProvider`, `RouterProvider`, `useLocale`)         |     5 | `ConfigProvider` (locale, dir). The router is vue-router already                    |
| OTP (`input-otp`)                                                 |     2 | `PinInput`                                                                          |

**The known gaps are smaller than the ticket feared.** The asset table does not
use react-aria for grid navigation or drag and drop. Its arrow-key handling
(`AssetsTable.tsx:624–722`), its drag and drop (44 native `onDrag*`/`onDrop`
handlers in 6 files) and `SelectionBrush` are already hand-rolled on DOM events.
They port as framework translations, not as accessibility-library gaps. What is
genuinely uncovered:

- the aria `Table`/`GridList` in two Settings sections (API keys, user groups);
- `TagGroup` in `ManageLabelsModal`;
- `useDrop` on breadcrumbs.

All four are small. They become plain semantic markup (`<table>`, a
`role="list"` of toggle buttons, native drop events) with `@vueuse/core`
helpers.

### Evidence

- **Compatibility:** Reka UI 2.10.5 (released 2026-09-21) declares a peer of
  `vue >= 3.4.0`.
  - It installs against Vue 3.5.43 and passes the clean `vue-tsc` typecheck (TS
    5.8.2, `vue-tsc` 2.2.12).
  - It passes ESLint 10 with `eslint-plugin-vue` 10.11, with the repo config
    unchanged.
  - It builds with Vite 7.3.6.
  - It shares `@floating-ui/vue` 1.1.11 and `@internationalized/date` 3.7.0 with
    the app, so neither is duplicated.
- **One duplicate:** Reka depends on `@vueuse/core` ^14, and the app uses 15.
  pnpm installs both. The cost is 2.7 KB minified in-app. Every vueuse function
  Reka imports also exists in 15, so a `pnpm.overrides` entry
  (`"reka-ui>@vueuse/core": "15.0.0"`, and the same for `@vueuse/shared`) would
  deduplicate it. That is left undone here: it swaps a dependency under Reka's
  own tests. **Plan (provisionally accepted):** #78 adds the override and keeps
  it only if Reka's tests and ours pass with it; otherwise we accept the 2.7 KB
  and say why next to the pin.
- **Bundle, measured in-app (spike):**

  | Build                          | Change (minified) | Change (gzip) |
  | ------------------------------ | ----------------: | ------------: |
  | Initial chunk (`entrypoint`)   |           +2.6 KB |       +0.9 KB |
  | `Dashboard` route chunk (lazy) |            +56 KB |        +16 KB |
  | All JS                         |          +58.7 KB |      +17.3 KB |
  | CSS                            |           +0.9 KB |       +0.1 KB |

  Of the 58.7 KB:
  - Reka code: 47.5 KB.
  - vueuse 14: 2.7 KB.
  - `aria-hidden`: 1.5 KB.
  - `defu`: 0.7 KB.
  - Extra `@floating-ui` middleware: 2.6 KB.
  - The spike's own components: 3.4 KB.

  The initial chunk barely moves, because `AppContainer` is part of the lazily
  loaded `Dashboard` chunk.

- **Bundle, by component group (esbuild upper bound, minified / gzip KB):**

  | Group                                                                                                    | Exports |     Min |     Gzip |
  | -------------------------------------------------------------------------------------------------------- | ------: | ------: | -------: |
  | DropdownMenu (the spike)                                                                                 |      17 |    80.1 |     22.6 |
  | Menus: DropdownMenu + ContextMenu                                                                        |      33 |    92.1 |     24.5 |
  | Overlays: Dialog + AlertDialog + Popover + Tooltip                                                       |      30 |    75.5 |     20.9 |
  | Form controls: Checkbox, RadioGroup, Switch, Label, Select, Combobox, Listbox, PinInput, TagsInput, Tabs |      62 |   177.4 |     52.7 |
  | Dates: DatePicker + Calendar + DateField + TimeField                                                     |      36 |   117.5 |     32.4 |
  | Toast                                                                                                    |       8 |    29.9 |     10.5 |
  | **Everything the port needs**                                                                            | **170** | **356** | **95.5** |

  Scaled by the in-app ratio, the whole set costs about **245 KB minified (about
  66 KB gzip)**. That replaces about 512 KiB of react-aria in the initial chunk,
  so the net saving estimated in the epic (about 600 KiB after Reka) stands.

- **Accessibility, proven in the running app** (spike, below):
  - The trigger and menu get the `menu`/`menuitem` roles and `aria-expanded`.
  - Opening from the keyboard focuses the first item.
  - Arrow keys wrap and skip disabled items.
  - Enter and Space select, then return focus to the trigger.
  - Escape closes the menu and returns focus to the trigger.
  - An outside click dismisses the menu.
  - Reka's menu is modal by default, like react-aria's popovers: the dismissing
    click is swallowed, not passed through. Behaviour stays the same across the
    two frameworks, in both directions.
  - The global key-binding registry does not intercept the menu's keys.
- **Maintenance:** Reka UI is MIT-licensed.
  - 37 releases in the 2.x line since 2025-02-20. The latest was 9 days ago.
  - About 2.29 M weekly downloads. It is the base of shadcn-vue and Nuxt UI.

### Recommendation

**Reka UI, exact-pinned at 2.10.5**, with the reason recorded in
`app/gui/package.json`'s `"//"` notes, per the frozen-pin convention. Two
reasons for the exact pin:

- A minor release can change focus or dismissal timing, and the Playwright suite
  is timing-sensitive.
- The bump should be a deliberate, measured step.

For i18n, `ConfigProvider` replaces react-aria's `I18nProvider`. Mount it once,
in `App.vue`, in #78.

### Rejected

- **Hand-rolled on `@floating-ui/vue`.** Positioning is the easy 10%. The rest
  would all have to be built and then maintained:
  - focus scopes and restoration;
  - dismissable layers (Escape, outside click, nested layers);
  - roving focus with typeahead;
  - `aria-hidden` on siblings, and scroll lock;
  - date-segment editing.

  The project-view's existing Vue menus show how that drifts: about 23
  `role`/`aria-*` attributes across all 185 `.vue` files, and no roving focus.
  Hand-rolling is kept only for the gaps listed above.

- **Headless UI for Vue.** It is still on the 1.7 line (1.7.23), because v2 is
  React-only. It lacks components the dashboard needs: Tooltip, Toast,
  ContextMenu, date pickers and Calendar, PinInput and Checkbox. A second
  library would still be needed.
- **Ark UI.** Its coverage is comparable. Its state-machine indirection (Zag.js)
  is a second mental model next to Vue reactivity, and it has much less Vue
  adoption. Not measured further, because Reka met every requirement.

### The spike (acceptance criterion)

The spike adds the following files:

- `src/components/Menu/`: `DropdownMenu.vue`, `MenuItem.vue`,
  `MenuSeparator.vue` and `variants.ts`. They wrap Reka's `DropdownMenu*` and
  style it with `DIALOG_BACKGROUND` (`$/components/Dialog/variants.ts`) and
  `TEXT_STYLE` (`$/components/Text/variants.ts`), which #77 moved out of the
  dashboard. This is the same `variants.ts` reuse as
  `DashboardDialogContent.vue`.
- The menu portals into `#enso-portal-root`, next to the React overlays, so both
  frameworks share one stacking context and the dashboard's base styles.
- `src/components/AppContainer/HeadlessUiSpike.vue` is mounted in
  `AppContainer.vue`, beside the React `UserBar`, behind the new
  `enableHeadlessUiSpike` feature flag (off by default). Users see nothing.
- Tests:
  - `src/components/Menu/__tests__/DropdownMenu.test.ts` (vitest, jsdom, 5
    tests) covers keyboard open and first-item focus, the portal target, arrow
    navigation with wrap and disabled items skipped, Enter to select and return
    focus, Escape, and the state attributes the styles key on.
  - `integration-test/dashboard/headlessUiSpike.spec.ts` (Playwright, 5 tests)
    runs the same behaviours in the running app with react-aria live, plus two
    more:
    - it opens and closes the Vue menu and the react-aria user menu against each
      other;
    - it checks the computed styles (backdrop blur, highlight background). No
      Tailwind conflicts.

The flag, `HeadlessUiSpike.vue` and its spec go when the first real
`DropdownMenu` mount site lands (#78). The primitive itself stays and grows
there.

## 2. Forms

### Options

- **A. vee-validate 4.15.1 + `@vee-validate/zod`.**
- **B. A thin in-house `useForm` over zod**, mirroring today's `Form` API.

### Evidence

- **Callers do not use react-hook-form directly.** Only one file outside
  `components/Form/` imports it. The dashboard's `Form` wrapper (1,765 lines)
  already hides it and adds most of the value itself:
  - an i18n zod error map;
  - offline blocking (`canSubmitOffline`);
  - closing the dialog on success (`method="dialog"`, 18 uses);
  - submission as a tracked mutation with Sentry capture;
  - `setFormError`, and reset-on-submit.
- **react-hook-form features callers do reach:**
  - `Controller`: 19 matches in 14 files. This over-counts: `AbortController`
    also matches.
  - `useWatch`: 4. `form.watch`: 12, in 3 files.
  - `setValue`: 10. `getValues`: 13. `trigger`: 2. `setError`: 1.
  - `formState.*`: 8.
  - `useFieldArray`: none.

  All of these are trivial with Vue reactivity: a `reactive` values object, a
  `computed` of per-field errors from `schema.safeParseAsync`, `watch` for
  `onChange`.

- **Cost:** vee-validate + `@vee-validate/zod` is 33.5 KB minified / 12.0 KB
  gzip, against 25.2 / 9.6 for react-hook-form + resolvers today.
- **Maintenance risk:** the last stable vee-validate release, 4.15.1, is from
  2025-06-07. v5 has been in beta since 2025-08-02 (Standard Schema) and is
  still in beta (5.0.0-beta.1, 2026-03-04). `@vee-validate/zod` 4.x peers on
  `zod ^3.24`. Adopting 4.x now therefore means a v5 migration later, and it
  would hold back a zod 4 upgrade in the dependency programme (#20).
- **Fit:** vee-validate brings its own component API (`<Form>`, `<Field>`,
  `<ErrorMessage>`). Callers would move to it and then still need the wrapper's
  extras on top.

### Recommendation

An **in-house `useForm` over zod**, in `src/components/Form/`. It keeps the
public shape callers use today, so ports stay mechanical:

- `Form` (props `schema`, `defaultValues`, `onSubmit`, `method`, `gap`,
  `testId`);
- `Form.Field`, `Form.Submit`, `Form.Reset`, `Form.FormError`,
  `Form.FieldValue`;
- `form.setValue`, `getValues`, `watch`, `setFormError`.

Move the i18n error map and the offline rule into a framework-free module first,
so the React and Vue forms share them during the transition. Estimate: 400–600
lines, plus tests, in #79.

### Rejected

- **vee-validate.** It is a dependency on a stale stable line with a pending
  breaking major. It pins zod 3. It duplicates what the wrapper already does,
  and none of its features (field arrays, i18n rules, `<Field>` slots) is
  needed.

## 3. Toasts

### Options

- **A. vue-sonner 2.0.9.**
- **B. Reka `Toast`** (primitives only).
- **C. In-house on Reka `Toast` primitives:** a queue store plus one host.

### Evidence

- **The API to keep is `useToast`**, used by 14 Vue/TS files: `show` (updates in
  place, by a stable per-topic id), `dismiss`, `reportError`, the kinds
  `error`/`info`/`warning`/`success`, `autoClose: false`, and `outliveScope`. It
  renders through react-toastify today. `src/project-view/util/toast.ts` imports
  `toast` from `react-toastify`, and the only container is `<ToastContainer>` in
  `dashboard/App.tsx`.
- **The dashboard's direct react-toastify use** is 20 files. It calls
  `toast()`/`toastify.toast` 11 times, `success` 7, `error` 7, `promise` 3,
  `loading` 2, `update` 2, `dismiss` 1. The container options that matter are
  `position="top-center"`, `limit={3}`, `closeOnClick={false}`, the `Slide`
  transition, and the class
  `text-sm leading-cozy bg-selected-frame rounded-lg backdrop-blur-default`.
- **vue-sonner:**
  - MIT; about 2.09 M weekly downloads.
  - The last release is 2025-10-01, a year ago.
  - Cost: 22.5 KB minified / 7.5 KB gzip, plus 18 KB of its own CSS.
  - It has the right imperative API, including `promise`, `loading` and update
    by id. But it also brings Sonner's look: a collapsed, stacked card pile.
    Keeping today's look would mean overriding its CSS, or using its unstyled
    mode and restyling everything, which removes most of its value.
- **Reka `Toast`** (10.5 KB gzip, upper bound, and Reka is already in) provides
  the accessible parts:
  - a live region and the F8 viewport hotkey;
  - pause on hover and on focus;
  - swipe to dismiss;
  - `role="status"`.

  It is component-driven (`ToastRoot v-model:open`) and has no imperative queue.
  That is the part to write, and it is small: a global list of
  `{ id, type, content, autoClose }`, with `show`/`update`/`dismiss`/`promise`
  and `limit`.

- **Test impact:** `integration-test/actions/EditorPageActions.ts:40` locates
  `.Toastify__toast`. Whichever option is chosen, change that page object to a
  neutral locator (`getByRole('status')` or a `data-testid`) first, in the same
  PR as the swap.

### Recommendation

**Option C: an in-house `useToast` store (global, framework-free API) and one
`ToastHost.vue` built on Reka `Toast`, styled with Tailwind to match today's
toasts.** (Revised in #80: the host is hand-built, not on Reka `Toast`; see
"Rulings from #80", item 2.) The toasts look the same, so this is a faithful
port with no visible change. The `useToast` signature stays exactly as it is.

- **Transition shim:** while React code still calls `toastify.toast(...)`,
  replace those imports with a small `#/utilities/toast` adapter over the same
  store. It covers `toast`, `.success`, `.error`, `.warning`, `.info`,
  `.loading`, `.promise`, `.update` and `.dismiss`.
- **Then** remove the `ToastContainer` and react-toastify, in #80.

### Rejected

- **vue-sonner.** It is a year since its last release. Its visual design would
  have to be fought or rebuilt, and its extra CSS pays for no feature we lack.
- **Reka `Toast` alone.** It has no imperative API, so every caller would have
  to own component state. A store is required either way.

## 4. Modal stack

### Evidence

- **Today:** `providers/ModalProvider.tsx` holds a single zustand slot of type
  `React.JSX.Element`. `TheModal` renders it through `ModalWrapper`, which
  `AppContainer.vue` mounts via veaury.
- **Callers:**
  - 24 `setModal(...)` calls and 15 `unsetModal()` calls, across 25 files.
  - Two of those files are Vue: `CommandPalette.vue` and `providers/session.ts`.
    The latter calls it from a mutation callback, outside any component setup.
  - `setModal` is called with 7 distinct modals, all as JSX, and there is one
    functional-update form.
- **Separately,** 36 `Dialog.Trigger`/`Popover.Trigger` sites and 15 controlled
  (`isOpen`/`modalProps`) dialogs own their overlay locally.
  `DialogStackProvider` (14 references) tracks nesting for react-aria.

### Design (recommended)

- **The store.** `src/providers/modals.ts` is a **global** store
  (`createGlobalState`, as `providers/devTools.ts` does), not a
  `createContextStore`. The reasons: callers include mutation callbacks and the
  React shim, which run outside component setup, and there is exactly one stack
  per window.

  ```ts
  interface ModalEntry<C extends Component = Component> {
    readonly key: number;
    readonly component: C;
    readonly props: ComponentProps<C>;
  }
  // open(component, props) → { key, close }; close(key?); closeAll(); stack: readonly ModalEntry[]
  ```

  It is a stack, not a slot, so a confirmation can open over a dialog without
  replacing it. Today's `setModal` semantics (replace the current modal) become
  `closeAll(); open(...)` in the shim.

- **The host.** One `ModalHost.vue`, mounted once in `App.vue`, renders
  `stack.map(e => <component :is="e.component" v-bind="e.props" @close="close(e.key)" />)`.
  Each entry is a Reka `DialogRoot` (the ported `Dialog`), and they all portal
  into `#enso-portal-root`. Reka's dismissable-layer stack handles nesting,
  Escape (topmost first) and focus return, so `DialogStackProvider` has no Vue
  counterpart.
- **Local dialogs stay local.** A `Dialog.Trigger` pattern ports to a `<Dialog>`
  with a trigger slot. Only programmatic opens go through the store.
- **The compatibility shim.** For the transition, `ModalProvider.tsx`'s exported
  functions keep their signatures.
  - `setModal(<Jsx .../>)` pushes an entry whose component is a tiny Vue
    wrapper, `reactComponent`-mounting that JSX.
  - `unsetModal()` becomes `closeAll()`.
  - `getModal()`/`useModal()` read the top of the stack.

  React and Vue modals then share one stack and one Escape order. Each port that
  removes a `setModal(<X/>)` caller swaps it for `modals.open(XVue, props)`. The
  shim goes in #93, together with zustand's last use here.

### Rejected

- **A `createContextStore`.** It cannot be reached from `session.ts`'s mutation
  callback or from the React shim, which is the main reason the store exists.
- **Keeping a single slot.** It is what forces today's functional-update tricks
  (`setModal(prev => …)`). A stack is no harder, and matches Reka's layering.

## 5. Styling: replacing the `tailwindcss-react-aria-components` modifiers

### Evidence

These are real modifier uses in class strings, including chained forms
(`hover:selected:`). The ticket's earlier figure for `selected:` (32) came from
a raw grep, which also matches object keys such as `selected: { true: … }` in
`tv()` definitions and props. Those are JavaScript, not Tailwind modifiers, and
port unchanged.

| Modifier                             | Uses | Files | On non-react-aria elements it falls back to…                       |
| ------------------------------------ | ---: | ----: | ------------------------------------------------------------------ |
| `hover:`                             |   55 |    22 | native `:hover`. Works in Vue as is                                |
| `focus-visible:`                     |   25 |     7 | native `:focus-visible`. Works as is                               |
| `focus:`                             |   18 |     8 | native `:focus`. Works as is                                       |
| `focus-within:`                      |   16 |     4 | native. Works as is                                                |
| `disabled:`                          |   16 |     6 | native `:disabled` only. **Reka's `data-disabled` is not matched** |
| `selected:` (+`group-selected:` 5)   |   10 |     7 | `[data-selected]` only                                             |
| `pressed:` (+`group-pressed:` 3)     |    5 |     4 | `[data-pressed]` only                                              |
| `placement-{top,bottom,left,right}:` |   16 |     2 | `[data-placement=…]` only                                          |
| `outside-visible-range:`             |    3 |     3 | `[data-outside-visible-range]` only                                |
| `placeholder:`                       |    2 |     2 | `[data-placeholder]` only                                          |
| `placeholder-shown:`, `read-only:`   |    3 |     3 | native                                                             |

The plugin scopes its native-named variants to `:where([data-rac])` and falls
back to the native pseudo-class elsewhere. So `hover:`, `focus*:` and similar
already behave correctly on Vue elements, and nothing conflicts. The spike's
computed-style checks confirm this. Only about 40 uses (the rows marked "only")
need a new spelling. They sit in a handful of files: popover and menu variants,
the date picker, and radio/checkbox styles.

### Options

- **A. A mapping plugin that re-registers the colliding names** (`selected`,
  `disabled`, `open`, `placement-*`) as unions of react-aria and Reka selectors.
- **B. No plugin.** Use Tailwind 3.4's built-in variants in Vue code. Remove the
  react-aria plugin in #94.

### Recommendation

**Option B.** Prefer the ARIA variants, because they are semantic and
framework-neutral:

- `aria-selected:`, `aria-checked:`, `aria-disabled:`, `aria-expanded:`,
  `aria-pressed:`, `aria-invalid` (as `aria-[invalid=true]:`).

Use `data-[…]:` for Reka-only state:

- `data-[highlighted]:`, `data-[state=open]:`, `data-[state=checked]:`;
- `data-[side=bottom]:` (in place of `placement-bottom:`);
- `data-[disabled]:`, `data-[outside-view]:`, `data-[placeholder]:`.

The spike's `variants.ts` does exactly this. Each port rewrites the few "only"
modifiers in the variants file it copies. When React goes (#94),
`tailwindcss-react-aria-components` is removed with nothing to migrate.

### Rejected

- **Option A.** Tailwind 3 `addVariant` replaces a same-name variant
  (`variantMap.set`) and re-inserts it into the ordering list. Re-registering
  `disabled` or `selected` from a second plugin would therefore silently change
  selector order and specificity for all the existing React code. A union plugin
  also keeps the react-aria vocabulary alive after react-aria has gone. For
  about 40 edits, the risk is not worth it.

## 6. Where code goes

### Recommendation

- **Primitives** (Button, Dialog, Menu, Form, inputs, Toast host, Modal host) go
  in **`src/components/<Name>/`**, imported as `$/components/…`. Each gets a
  `variants.ts` next to it. #77 already moved the React components'
  `variants.ts` to `src/components/<Name>/`, so the Vue variants import their
  building blocks from there via `$/`, as `src/components/Menu/variants.ts`
  does. Shared code may not import `#/` (#77's ESLint rule).
- **Dashboard features** go in **`src/dashboard/`** (`#/…`) as `.vue` files,
  replacing the `.tsx` in place: same folder, same name, one PR per mount site.
  The directory ends up holding only Dashboard-specific Vue code, as
  `src/dashboard/CLAUDE.md` already states.
- **Framework-free logic** (validation, error maps, query factories,
  `variants.ts` inputs) moves to `src/` under #77 before the components that use
  it are ported.
- **Stores** use **`createContextStore`** (`@/providers`) for anything scoped to
  a component subtree. Use a **global** `createGlobalState` store only when
  non-component code, or the React shim, must reach it: modals (decision 4),
  toasts (decision 3). **No Pinia:** nothing in the app uses it, and
  `createContextStore` already gives typed provide/inject with testable
  factories.

### 6a. Does zustand survive?

**Evidence:**

- zustand is imported by 13 files. Of those, 4 are Vue-side providers:
  `featureFlags.ts`, `category.ts`, `localDirectories.ts`, and the new
  `codeFont.ts`.
- They are read from Vue through `$/utils/zustand` (`useZustandStoreRef`) and
  from React through `#/hooks/storeHooks`.
- Their value is exactly that neutrality, plus the `persist` middleware (with
  versioned migration, in `featureFlags.ts`).
- Cost: about 5 KB.

**Recommendation:** keep zustand until #93. Its vanilla `createStore` does not
depend on React, and it is the cheapest way to share state across the bridge
while both frameworks read it. From now on:

- **no new zustand stores:** new state in Vue code is Vue state;
- **in #93,** once no React reader is left, replace each store with a
  `createGlobalState` over `useStorage` (`@vueuse/core`), migrating the
  persisted keys and formats (`enso-feature-flags` v4, `enso-code-font`);
- **then drop the dependency and `utils/zustand.ts`.**

**Rejected:**

- **Replacing zustand now.** Every React reader would need a Vue-to-React
  adapter in its place: churn in files that are about to be deleted anyway.
- **Keeping zustand for good.** That would leave two state idioms in a Vue-only
  app.

### 6b. Keeping cloud-only ports separable

The maintainer may later move cloud-only areas into a separate community version
(see decision 7). Recommendation:

- **Directory.** Ported cloud-only areas go under top-level
  **`src/cloud/<area>/`**, not `src/dashboard/cloud/`. #77 (#151) created
  `src/cloud/` for cloud-only framework-free logic, and a top-level folder is
  what lets a community build leave cloud code out at build level:
  - `billing/` (plans, paywall, subscribe, payments success);
  - `organization/` (members, user groups, activity log, invitations, setup);
  - `versions/` (asset versions, diff, scheduling and executions);
  - `auth/` (Cognito pages, 2FA, API keys);
  - `credentials/`;
  - `agreements/`;
  - `versionChecker/`;
  - `devtools/`.

  Shared primitives stay in `src/components/`, and shared framework-free logic
  in `src/`.

- **One-way boundary.** An ESLint `no-restricted-imports` rule forbids importing
  `$/cloud/**` from anywhere outside `src/cloud/`. Cloud code may import the
  core; the core never imports cloud code.
- **Contribution points** instead of imports. The core exposes small registries.
  `src/cloud/index.ts` fills them at start-up, and it is the only file the app
  entry imports from `cloud/`:
  - routes;
  - settings tabs;
  - user-menu entries;
  - right-panel tabs;
  - asset context-menu entries;
  - the paywall check.

  Removing that one import, plus the directory, is the future community split.

- **Gradual.** This costs nothing extra per port. A cloud-area ticket (#84,
  #87–#89) creates its folder and registers itself. The registries appear with
  the first ticket that needs each one.

## 7. Scope: port or delete (Decided, 2026-09-30)

- **Port every cloud-only area; delete none.** This covers:
  - billing, plans and paywall;
  - organization admin;
  - project scheduling and versions;
  - the Cognito auth pages, 2FA and API keys;
  - service-credential forms;
  - `VersionChecker`;
  - the agreements modal;
  - `EnsoDevtoolsImpl`.

  Tickets #84, #87, #88 and #89 keep their full porting scope. Ported cloud-only
  code follows decision 6b, so that a later community split is mechanical.

- **The fork diverges freely from upstream's dashboard.** Upstream merge
  conflicts are no constraint on structure or naming.

## 8. Port playbook

The checklist is appended to `app/gui/src/dashboard/CLAUDE.md` ("Porting a React
component to Vue"):

- one mount site per PR, deleting the React file in the same PR;
- keep `data-testid`s and accessible names;
- neutral locators before the swap;
- run the area's Playwright specs N times in WSL on both branches;
- the changelog under the repo's current rule: a faithful port with no visible
  change takes the `CI: No changelog needed` label, and a visible change gets an
  entry.

## Delegated decisions (2026-09-30)

The maintainer asked for sensible decisions overnight (#76, last comment):

1. **Decisions 1–6b and 8:** provisionally accepted as written, with the cloud
   location changed to `src/cloud/<area>/` (6b).
2. **`@vueuse/core` duplicate:** #78 tries the `pnpm.overrides` dedupe (see
   decision 1).
3. **Accessibility:** automated. #81 adds axe checks with a checked-in baseline,
   and every port runs them.
4. **Merge plan:** this PR and the ports built on it (#78 onwards) stay open for
   the maintainer's review; invisible refactors and tooling (#77, #81) merge on
   green.

## Rulings from #78 (core primitives, 2026-09-30)

#78 built the Vue primitives in `src/components/` and had to settle its own open
questions. They were delegated like the decisions above: provisionally accepted,
for the maintainer to review.

1. **One icon set: `icons.svg`.** The React `Icon` already draws only from it
   (`SvgMask` and the standalone SVG imports are gone; `IconProp`'s `_Icon`
   parameter is vestigial). The Vue `Icon.vue` uses the same `svgUseHref` with
   the same `ICON_STYLES`. The project-view's `SvgIcon` stays as it is: it draws
   from the same file and sizes itself with CSS variables for the graph editor,
   so the two differ only in styling, not in icons.
2. **No merge of the dashboard `Dialog` with `DashboardDialogContent` or
   `MenuPanel`.** `Dialog.vue` is the one modal dialog. `DashboardDialogContent`
   is a styling-only embedded layout and `MenuPanel` a graph-editor panel;
   replacing their users is #82's.
3. **Prop names follow React where they carry meaning, Vue where they are
   mechanics.** Kept: `isDisabled`, `isLoading`, `isDismissable`,
   `isKeyboardDismissDisabled`, `isNonModal`, `testId`, `tooltip`, every variant
   name and value, and the component names (`Button`, `Text`, `Dialog`; an
   ESLint override allows single-word names in `src/components/*/`). Changed:
   `className` → `class` (still `twMerge`d through the variants, as React does),
   `*ClassName` → `*Class`, render props → scoped slots, `onOpenChange` →
   `v-model:open`, react-aria placements (`'bottom start'`) → `@floating-ui`
   ones (`'bottom-start'`). A press handler that may return a promise is the
   `onPress` prop, bound with `@press`, so that the button can show its loader.
4. **Compound triggers become a `trigger` slot.** `Dialog.Trigger`,
   `Popover.Trigger`, `Menu.Trigger` and `AlertDialog.Trigger` have no Vue
   component. `DialogStackProvider` has none either: Reka's layer stack orders
   Escape and outside clicks.
5. **Two tooltips, and the project-view registry stays.** `Tooltip.vue` (Reka)
   is the accessible one (`role="tooltip"`, `aria-describedby`, opens on focus).
   `VisualTooltip.vue`, `Text`'s overflow tooltip and a disabled `Button`'s
   tooltip are visual only (`aria-hidden`, hover only, `@floating-ui`), as in
   React. The project-view `TooltipTrigger`/`TooltipDisplayer` registry is a
   different design (one floating element, a 1.5 s delay, graph-editor styling,
   and it must work inside visualizations' custom elements) and is left alone.
6. **Motion moves to Reka's attributes.** The shared variants keep react-aria's
   `isEntering`/`isExiting` and `placement-*:` for React. The Vue side adds
   `DIALOG_MOTION`, `POPOVER_MOTION` and `TOOLTIP_MOTION` beside them, keyed on
   `data-state` and `data-side` (decision 5). The dialog's slide moves from the
   full-screen layer onto the box, because Reka animates each layer it unmounts
   separately; the box is all that layer shows.
7. **More `variants.ts` leave the React files.** So that both frameworks share
   one definition, #78 moved `ICON_STYLES`, `ICON_DISPLAY_STYLES`,
   `SEPARATOR_STYLES`, `BADGE_STYLES`, `STATUS_BADGE_STYLES`, `ALERT_STYLES`,
   `PROGRESS_BAR_STYLES`, `RESULT_STYLES` (with the status colours),
   `LOADER_STYLES` (with the spinner phases and sizes), `SCROLLER_STYLES`,
   `BREADCRUMBS_STYLES`, `BREADCRUMB_ITEM_STYLES`, `TOOLTIP_STYLES`,
   `POPOVER_STYLES`, the button group's styles and the dialogs'
   ignore-outside-click selector into `src/components/<Name>/variants.ts`, and
   the breadcrumb-collapsing utility (with its test) into
   `src/components/Breadcrumbs/`. The React files import them unchanged.
8. **`ContextMenu` is a Reka `DropdownMenu` at a virtual point.** Reka's own
   `ContextMenu` cannot be closed or opened from code, which the drive's
   imperative `ContextMenuApi` needs. Items are shared with `DropdownMenu`.
9. **`Suspense` is `SuspenseLoader.vue`**, so that it cannot shadow Vue's
   built-in `<Suspense>`. **`ErrorBoundary`** is `onErrorCaptured`; it cannot
   reset failed queries as React's does (`@tanstack/vue-query` has no
   `QueryErrorResetBoundary`), so it emits `@reset` for the caller to refetch.
10. **`AlertDialog` has no form.** Forms are #79. It has two buttons; the
    confirm button takes focus and shows loading while `onConfirm`'s promise is
    pending. As in React, Escape and outside clicks do not dismiss it.
11. **Parity is checked by classes.** `vuePortParity.test.tsx` renders the React
    and Vue `Button`, `Text`, `Badge`, `Alert` and `Dialog` with the same props
    and requires the same classes (the `DIALOG_MOTION` classes aside). With the
    same stylesheet that is the same look, and unlike screenshots it runs
    everywhere. The menu's in-app check is the spike's Playwright spec, which
    compares computed styles. It found one difference: the spike's menu
    separator was `bg-primary/10` where React's is `/30`; fixed.
12. **The `@vueuse/core` override is kept.** `pnpm-workspace.yaml` dedupes
    Reka's `@vueuse/core`/`@vueuse/shared` 14 onto the app's 15. Every
    Reka-based test passes against it (see the PR for the runs).
13. **A trap for porters: Vue casts an absent boolean prop to `false`.** A prop
    typed `boolean` (or `string | false`) that is not passed arrives as `false`,
    not `undefined`, which would override a variant's default or a button
    group's shared value. The primitives declare such props with an explicit
    `undefined` default; a new prop needs the same.
14. **Not done here, by scope:** switching a real consumer to each primitive
    (the feature tickets and #82 do that, one mount site at a time), and a
    CHANGELOG entry (no user-visible change: the PR takes
    `CI: No changelog needed`, per the repository rule).
15. **Reka's `ConfigProvider` is mounted in `AppContainer.vue`, not `App.vue`**
    as decision 1 planned. In `App.vue` it pulled Reka's shared code into the
    initial chunk (+79 KB minified there, measured); `AppContainer` is the
    lazily loaded dashboard, where the primitives are used. A primitive used
    before sign-in would fall back to Reka's default locale, `en`.

## Rulings from #79 (forms and inputs, 2026-10-01)

#79 built the Vue form layer and inputs in `src/components/` (`Form/`,
`Inputs/`, `Checkbox/`, `Radio/`, `Switch/`, `Stepper/`) and settled the
ticket's open questions. Delegated like the rulings above: provisionally
accepted, for the maintainer to review.

1. **In-house, confirmed against `useForm.ts`.** The three features the ticket
   named all fit without a library:
   - _default values from queries_: `defaultValues` may be a getter, read when
     the form is created and again by `reset()`. As in React it is not
     re-applied on its own; a form fed by a query calls `reset()` when the data
     arrives, or is keyed on it;
   - _`onSubmit` returning a promise_: awaited, with `formState.isSubmitting`
     set meanwhile (inputs and `Submit` disabled, `Submit` loading);
   - _`setFormError`_: a `root.submit` error that `FormError` shows, as a failed
     submission does.

   The rest keeps react-hook-form's names and rules: `mode`/`reValidateMode`
   (validate on submit, then re-validate on change), dirty and touched state,
   `setValue`, `getValues`, `trigger`, `setError`, `clearErrors`, `reset`,
   `resetField`, `setFocus`, focus on the first invalid field, the offline rule,
   `method="dialog"`, `resetOnSubmit`, and Sentry capture of JS errors. About
   800 lines of TypeScript (`useForm`, `useField`, types, value helpers) and 500
   of components; vee-validate stays out.

2. **Where the Vue API differs, by design.**
   - `errors` is flat, keyed by dotted path, with `root.submit` and
     `root.offline` for the form-level ones.
   - `watch(name)` is a reactive read: wrap it in `computed`. There is no
     `control`, `Controller` or `register`: an input calls `useField`, which
     replaces `useController`, `useFieldRegister` and `useFieldState`.
   - `submit()` resolves after a failed submission instead of rejecting; the
     failure is shown by `FormError` and reported to `onSubmitFailed`.
   - A submission is not a tracked vue-query mutation. The React one existed
     only to show submissions in the query devtools.
   - Render props are scoped slots (`Form`'s `{ form }`, `FieldValue`'s
     `{ value }`), and `children` naming an item is a `toLabel`/`toTextValue`
     prop or a `{ item }` slot.

3. **`Submit` is disabled while submitting, not while invalid.** The ticket
   asked for both, but React never disabled it while invalid, and pressing
   Submit on an invalid form is what shows the errors and focuses the first one;
   specs rely on that. `isDisabledWhenInvalid` opts in.

4. **"Required" comes from `isRequired` only.** React's `useFieldRegister` reads
   a string's minimum length from the schema, but react-hook-form returns
   `required` only in progressive mode, so the reading never reached a field:
   React shows the `*` (and sets `required`) only when told. The Vue port does
   the same, and the parity test checks it.

5. **Messages come from `useText()` keys**, through the zod error map now in the
   framework-free `src/components/Form/errorMap.ts`, which the React `useForm`
   uses too, with the form-level error rule (offline notice, submission error,
   generic fallback).

6. **The control carries the ARIA state.** React put `aria-invalid` and the
   error's id on the field's wrapper `div`; the Vue inputs also set
   `aria-invalid`, `aria-describedby` and `aria-errormessage` on the control
   itself. Invisible, and what a screen reader reads.

7. **Native controls where react-aria rendered native ones.** Reka's `Checkbox`,
   `RadioGroup` and `Switch` are `<button role="checkbox">` and friends;
   react-aria renders a native input hidden in a `<label>`. The Vue `Checkbox`,
   `Radio`, `Switch` and `Selector` keep react-aria's DOM, so they keep native
   keyboard and form behaviour, and the hover/press/focus-visible states React
   styled on are tracked the same way (identical classes). Lists
   (`MultiSelector`, `Dropdown`), `ComboBox`, `DatePicker`, `TimeField` and
   `OTPInput` are Reka's.

8. **Dates: ISO input, localized calendar.** React formats the date input in the
   `sv` locale to get ISO order, but in Reka the locale also names the
   calendar's months, weekdays and cells (it read "måndag 31 augusti" to a
   screen reader). The Vue `DatePicker` uses the user's locale and orders the
   segments itself (`yyyy-mm-dd`, 24-hour, English placeholders), so the input
   looks as React's and the calendar speaks the user's language. `TimeField`
   uses the user's locale, as React's does. Both stay (decision 7 keeps the
   scheduling and activity-log filters that use them).

9. **`ResizableInput` and `ResizableContentEditableInput` are deleted, not
   ported:** nothing imported either.

10. **`OTPInput` is on Reka's `PinInput`,** one `<input>` per character, which
    shows the native caret where `input-otp` drew a blinking fake one; pasting
    fills every box. `input-otp` stays in `package.json` until the last React
    caller (`SetupTwoFaForm`, #84) is ported, and goes in that PR. No new
    dependency.

11. **Shared variants, Vue spellings beside them.** #79 moved the form, input,
    checkbox, radio, switch and stepper `tv()` definitions out of the React
    files (`src/components/<Name>/variants.ts`); the React files import them
    unchanged. React-aria-only modifiers get Vue spellings in `*_VUE_STATES`
    constants, which `vuePortFormParity.test.tsx` strips before comparing the
    React and Vue classes of every input family.

12. **No screen is ported here.** The ticket's end-to-end proof
    (`ForgotPassword`) is left to #85, which owns the auth pages; `Form.vue`'s
    header shows that form in Vue as its usage example. No mount site changes,
    so the Playwright suite is untouched, and the PR takes
    `CI: No changelog needed`.

## Rulings from #80 (app-wide services, 2026-10-01)

#80 moved the toasts, the programmatic modal stack and the app-wide effects to
Vue, and had to settle its own questions. Like #78's, they were delegated:
provisionally accepted, for the maintainer to review.

1. **Split.** #80 delivers the toasts, the modal stack and the theme,
   selection-clearing and `window.navigate` effects. Key bindings, the About
   menu handler, `confirm`/`ask` (with `reactApi.confirmDelete`) and error
   boundaries at route and tab roots moved to #156: each is a reviewable change
   of its own, and the key-binding registry is the largest part of the ticket.
2. **The toast host is built by hand, not on Reka's `Toast`**, reversing that
   part of decision 3. `ToastHost.vue` still keeps the in-house store and the
   `useToast` API. Three things in Reka 2.10.5's `ToastRoot` break parity with
   today's toasts:
   - it listens for Escape on `window` (`onKeyStroke`), so any Escape anywhere,
     including the graph editor's, closes every toast;
   - it renders a second, hidden copy of each toast's text, prefixed with a
     label, in a separate `role="alert"` element: what assistive technology gets
     differs from today, and a Playwright `getByText` on a toast's message
     matches two elements;
   - its timer pauses all toasts while the viewport is hovered, and it has no
     progress bar to keep in step with the timer.

   The hand-built host reproduces react-toastify's behaviour instead: about 480
   lines for the host and its styles, 200 for the store. It also keeps Reka out
   of the initial chunk, since `App.vue` mounts it.

3. **Toasts look and behave as react-toastify's did.** The CSS values were
   copied (320px container at the top centre, or the bottom right for the copy
   and notification toasts; padding, shadow, the same Tailwind classes; icons,
   close button, 5px progress bar and their colours), and so were the mechanics:
   the timer is the progress bar's shrink animation, which starts once the toast
   has slid in (0.7 s), pauses on hover and while the window is unfocused, and
   closes the toast when it ends (5 s by default); the toast then slides out
   (0.7 s) and collapses (0.3 s); at most three are shown, the rest queued;
   `role="alert"` on the message, a `close` button, `role="progressbar"`
   "notification timer". Two differences, neither visible: an update applies at
   once (react-toastify deferred it by a tick and 100 ms), and dismissing a
   queued toast drops it (react-toastify showed it later).
4. **React callers use a shim, `#/utilities/toast`**, with the subset of
   react-toastify's `toast` they used (`success`/`error`/`info`/`warning`,
   `loading`, `promise`, `update`, `dismiss`, `onChange`); React content renders
   through `reactComponent`. react-toastify is removed. Toasts carry
   `data-testid="toast"`, and the host's containers carry
   `data-ignore-click-outside`, which replaces `.Toastify__toast-container` in
   `IGNORE_INTERACT_OUTSIDE_SELECTOR`.
5. **The modal host mounts where `ModalWrapper` did**, not in `App.vue` as
   decision 4 planned: in `AppContainer.vue` for the dashboard, and in the React
   `Page` for the other pages. The React modals need the providers they had
   there (`AppContainer` gives React its container data, drive location and
   `reactApi`); a host in `App.vue` would render them without. As before, a page
   has exactly one host. `Page` loads its host as an async component: the host's
   `ErrorBoundary` brings Reka, which would otherwise join the initial chunk (82
   KB minified, measured).
6. **The host adds no element and does not teleport.** Each modal portals its
   own overlay (the React shim through React's `Portal`, as `ModalWrapper` did;
   a Vue `Dialog` through Reka), so the DOM is unchanged. Each entry sits in the
   Vue `ErrorBoundary`; the shim's frame keeps the React one inside.
7. **`setModal` keeps its single-slot meaning.** It replaces the whole stack,
   and its entry stays until the next `setModal`/`unsetModal`, even after the
   dialog closed itself, as the zustand slot did: `useModalRef` (the asset
   search bar's "is a modal open" check) depends on it. Fixing that is a
   behaviour change for a later port.
8. **React code reaches the global stores as
   `getToastsStore`/`getModalsStore`**, aliases of `useToasts`/`useModals`: a
   `use` name called outside a component trips React's rules-of-hooks lint, and
   these stores are not hooks.
9. **No Vue `ask`/`confirm` yet.** Nothing would call it; it lands with its
   first caller, the `ConfirmDeleteModal` port, in #156.
10. **The theme and selection effects run from app start** (`App.vue`), not from
    when React mounted. The outcome is the same: the dark-theme flag is a global
    store, and the listeners are document-wide.
11. **Parity was checked in the running app**, not only by class: screenshots of
    the offline and sign-out toasts taken on #154's branch (react-toastify) were
    compared on #80's with zero differing pixels, with the same geometry,
    computed styles and accessible names, and the phase durations measured the
    same (see the PR).

## Rulings from #156 (About, `ask`, error boundaries, 2026-10-01)

#156 took over the rest of #80: key bindings, the About menu handler,
`confirm`/`ask` and the error boundaries at route and tab roots. Delegated like
the rulings above: provisionally accepted, for the maintainer to review.

1. **Split again: key bindings are #170.** The ticket asks for one registry,
   with rebinding reaching "both the dashboard and the graph editor". Today only
   the dashboard's shortcuts are user-rebindable (the settings tab lists them;
   they persist in `LocalStorage` under `inputBindings`); the graph editor's
   (`@/bindings`) are fixed. Making them rebindable adds rows to the settings
   tab and changes what users can do: a feature, with a changelog entry and
   design questions (which shortcuts, how cross-scope conflicts such as `Mod+C`
   show), which a parity PR cannot carry. The two registries also differ in
   semantics (`defineKeybinds` has `allowRepeat` and first-match handler order;
   `defineBindingNamespace` has metadata and a default handler), so unifying
   them touches every keyboard path in the drive and the graph editor and
   deserves its own review, with a migration test against the stored format.
2. **`ask` is on the modal store**: `useModals().ask(component, props)` pushes
   the modal with `onConfirm`/`onCancel` and resolves `'confirm'` or
   `'dismiss'`. A caller's own `onConfirm` (the deletion itself) runs first, so
   the `AlertDialog` shows it pending as React's did; if it throws, the question
   stays open. A modal that leaves the stack unanswered (`closeAll`, a
   `setModal`) resolves `'dismiss'`. There is no separate `confirm`: `ask` with
   `ConfirmDeleteModal` (or another `AlertDialog`) is it.
3. **A stack modal leaves after its exit animation.** The design left open in
   #80 (ruling 9): `Dialog` and `AlertDialog` emit `closed` once Reka has
   unmounted the overlay, which it does when the exit animation ends, and a
   stack modal emits `close` then. The host itself stays simple.
4. **`ConfirmDeleteModal.vue` is in `src/components/AlertDialog/`**, not in
   `src/dashboard/modals/` beside the React one: its caller,
   `CategoryButton.vue`, is shared code and may not import `#/`, and the modal
   is a generic "are you sure" over the shared `AlertDialog`. The React
   `ConfirmDeleteModal` stays (the playbook's "delete the React file" does not
   apply): eight React callers open it from a `Dialog.Trigger`, and each goes
   with its feature's port. Same title, prompt, alerts, button labels and
   `data-testid`s (`modal-dialog`, `alert-dialog-confirm`/`-cancel`); the
   message is laid out as React's form lays it out (a column, items at the
   start, 1rem apart).
5. **One visible difference, deliberately kept.** A Vue-asked modal leaves the
   stack when it closes; a `setModal` entry stayed until the next
   `setModal`/`unsetModal` (#80, ruling 7). So after confirming a drop on Trash,
   or removing a favourite folder, `useModalRef` no longer reports a modal, and
   typing goes to the asset search bar at once, as it does when no dialog has
   been opened. Keeping the stale entry would mean emulating that bug in the Vue
   stack.
6. **The React `ask` forwards to the Vue one** (`askModal` in the
   `ModalProvider` shim): the React dialog renders in the shim's frame, which
   passes it `onConfirm`/`onCancel`. It keeps its old semantics: it replaces
   every open modal, and closes them all once answered.
7. **The About dialog is mounted in `App.vue`, not opened on the stack.** It
   must open from the app menu on every page, as it did from `App.tsx`; the
   stack is rendered only where a page mounts its host (not on the agreements,
   subscribe or restore-account pages, for instance). `App.vue` registers the
   menu handler and mounts `AboutModal.vue` (loaded on first use, kept mounted
   for its exit animation) inside the React root's slot, so it is available
   exactly where the React one was. The user and info menus open it with
   `openAboutModal()`. It sits outside Reka's `ConfigProvider`
   (`AppContainer.vue`), which changes nothing: it has no locale-dependent part.
8. **The Vue `CopyButton` toasts as React's does**, reversing #78's note:
   "Copied to clipboard" at the bottom right (`successToastMessage`, `true` by
   default), closing with the check icon after 2 s; a failure shows an error
   toast and keeps the error icon.
9. **Error boundaries at the roots catch only render errors**
   (`onlyRenderErrors`): errors thrown by a component's `setup` or render
   function, which is what React's boundary catches. The Vue boundary otherwise
   catches everything `onErrorCaptured` sees, including event handlers and
   watchers; at a root that would replace a working graph editor with the error
   display because one click handler threw. Those errors go on to the app's
   handler (Sentry's), as before. Placed around: the route in `App.vue` (reset
   on navigation), each middle-panel tab inside its `KeepAlive` (so the other
   tabs live on), and the right panel's open panel (reset on switching).
   `ReactRoot.tsx`'s and `Page.tsx`'s React boundaries stay for React content.
   **For review:** with a boundary at the roots, a render error deep in Vue
   content now shows the error display over the nearest root, where Vue alone
   leaves just the failing component empty. That is React's behaviour and the
   ticket's intent, but it trades graceful degradation for a visible failure.
10. **The boundary's error display is loaded on first use.** Statically, a
    boundary in `App.vue` brought `Button`, `Result` and Reka into the initial
    chunk (+101 KB minified, measured); now the initial chunk is unchanged (+0.6
    KB). Tests wait for the display to appear.
11. **A dialog without a trigger handles focus as react-aria does**
    (`Dialog/focusReturn.ts`), found by comparing the running app before and
    after. Reka focused the dialog's first button on opening (the About dialog's
    Close button) and, when the element that opened it had gone, dropped focus
    on the page's body on closing. Now the dialog focuses itself on opening (an
    `AlertDialog` still focuses its confirm button, as React's `autoFocus` did),
    and on closing returns focus to its opener or, when that was an item of a
    menu that closed as the dialog opened, to that menu's trigger: the user
    menu's button, after "About Enso". The trigger is the element whose
    `aria-controls` names the menu or, since react-aria's `DialogTrigger` names
    an id its popover does not render, the one open popup trigger
    (`aria-expanded="true"` with `aria-controls`) outside the portal root. The
    return waits for Reka's own clean-up, whose still active focus trap would
    otherwise take the focus back. An `AlertDialog`'s confirm button is focused
    as visibly focused (`focus({ focusVisible: true })`), as react-aria shows
    focus that no key or pointer press led to: React's Delete button opened in
    its focused colour, and so does the Vue one. The Vue dialogs also fix two
    React quirks, invisible to a mouse user: they are named by their title
    (React's had no accessible name), and Tab stays inside the confirmation
    (React's let it escape to the page once).
12. **Not done, by scope:** react-aria's `RouterProvider` and `I18nProvider`
    (they go with #94) and `VersionChecker` (with its feature's port).

## Rulings from #82 (React leaves in Vue hosts, 2026-10-01)

#82 replaced the small React components that Vue mounted through
`reactComponent`. Delegated like the rulings above: provisionally accepted, for
the maintainer to review.

1. **Split.** Two parts of the ticket moved elsewhere:
   - **The devtools are #172.** `EnsoDevtoolsImpl` (666 lines) uses nearly every
     #78/#79 primitive and needs Vue counterparts of five React hooks; it would
     have doubled the PR for a panel that only development builds render and no
     spec covers. The React query panel goes with it: the one `QueryClient` is
     Vue's, and the Vue DevTools plugin already shows it, so whether
     `@tanstack/vue-query-devtools` is wanted at all is #172's question.
   - **`FilePathInput` goes with `JSONSchemaInput` (#92).** Its only user is the
     React `JSONSchemaInput`, so a Vue `FilePathInput` would just move the
     Vue-in-React crossing from `FilePathInput` into `JSONSchemaInput`: the same
     number of bridge points.

   `ProtectedLayout.vue` therefore still calls `reactComponent`, for the
   devtools (#172) and `AgreementsModal` (#84); `CommandPalette.vue` and
   `UpsertSecretPanel.vue` no longer do.

2. **`src/project-view/` is React-free.** Its `Result`/`Loader` users and
   `WithCurrentProject.vue` use `Result.vue` and `Loader.vue`. The bridge itself
   (`reactComponent`, `suspendedReactComponent`), which lived in
   `project-view/util/react.tsx` and imported `#/components/Suspense`, moved to
   `src/utils/react.tsx` (`$/utils/react`), beside `zustand.ts`, until #93.

3. **The `centered` workarounds go, and `Result.vue` gets the bare attribute
   right.** The comments blamed React, but the cause was Vue's: a prop typed
   through `VariantProps<…>` is a type the SFC compiler cannot resolve, so it
   does not know the prop is a boolean, and a bare `centered` arrives as `''`,
   which names no variant (and so drops `m-auto`). The callers now leave it out
   (the default, `all`, is `m-auto`), and `Result.vue` spells the prop's type
   out, `boolean` first, so that a bare `centered` means `true`; a test pins it.
   The in-app comparison found this: the first port wrote `centered`, and the
   "No documentation available" result moved to the top of the panel. The same
   trap applies to any boolean variant prop typed through `VariantProps`.

4. **`Dialog.vue` puts its attributes on the dialog element**
   (`inheritAttrs: false`, `v-bind="$attrs"` on Reka's `DialogContent`), as
   React spreads its other props onto react-aria's `Dialog`. The session
   overlays ("Logging out", "Reconnecting session…") have no title and are named
   by `aria-label`; Reka's renderless `DialogRoot` had dropped it.

5. **The session overlays are their own component, loaded asynchronously.**
   `SessionOverlays.vue` holds the two dialogs, and `ProtectedLayout.vue` mounts
   it through `defineAsyncComponent`. `ProtectedLayout` is the root of every
   route, the login page included; importing `Dialog.vue` statically put 64 KiB
   of Reka dialog code (minified, measured) on that critical path, where React's
   dialog had come with React itself. Now the chunk is fetched just after the
   layout renders, long before any logout. The overlays sit outside Reka's
   `ConfigProvider` (`ProtectedLayout` is above `AppContainer.vue`); they show a
   spinner and a title, nothing locale-dependent, so Reka's default locale
   changes nothing (as for the About dialog, #156 ruling 7).

6. **`KeyboardShortcut.vue` is a shared primitive** in
   `src/components/KeyboardShortcut/`: the menus and the keyboard-shortcuts
   settings tab will use it too. It takes the shortcut string only. React's
   `action` form reads the user-rebindable bindings from the React
   `InputBindingsProvider`, which has no Vue counterpart until #170; it comes
   with it. The React component stays for its three React users (the menus'
   `MenuEntry`, the settings tab and the capture modal), as #156 kept the React
   `ConfirmDeleteModal`.

7. **`UpsertSecretForm.vue` is cloud code, in `src/cloud/credentials/`**:
   secrets exist only in the Enso Cloud. The core `UpsertSecretPanel.vue`
   imports it directly and says why: decision 6b's lint boundary and registries
   do not exist yet, and a registry for one panel would be built ahead of its
   design. A community split needs a slot for the file browser's "New secret"
   action. React's `doCreate`/`doCancel` callbacks became a `create` event and a
   `cancel` prop (`'close' | 'reset' | 'emit'`). The React form stays for the
   drive's `UpsertSecretModal` and the asset panel (#92, #89).

8. **Parity was checked element by element and in the running app.**
   `vuePortParity.test.tsx` now compares the React and Vue `Result`, `Loader`
   and `KeyboardShortcut` trees (tags, classes, text; the shortcut on macOS,
   Windows and Linux), and `upsertSecretFormParity.test.tsx` the two secret
   forms, allowing only the Vue `Button`'s two known differences (its
   always-present `focus:` classes and the `display: contents` span around its
   label). veaury's wrapper element was `display: contents` (`App.vue`), so
   dropping it leaves the layout as it was; screenshots of each touched screen
   taken on the base and the branch were compared pixel for pixel (see the PR).

9. **No changelog entry.** Nothing changes for users, so the PR takes
   `CI: No changelog needed`, though the ticket asked for an entry.

## Rulings from #83 (the top bar, 2026-10-02)

#83 ported the top bar: the user bar with the user menu and the notification
tray, the info bar and menu of the pages outside the dashboard, and the version
checker. (The About dialog was already Vue, #156.) Delegated like the rulings
above: provisionally accepted, for the maintainer to review.

1. **Where the parts went.**
   - `UserBar`, `UserMenu` and `NotificationTray` are `.vue` files in their
     React folder, `src/dashboard/pages/dashboard/UserBar/` (decision 6).
     `AppContainer.vue` imports `UserBar.vue`; its allowlist entry replaces the
     React one.
   - `InfoBar` and `InfoMenu` are in `src/components/InfoBar/`: they are the
     shell of every page outside the dashboard, which the Vue auth pages (#85)
     will mount. The React `Page` loads the bar on demand, as it does the modal
     host, so that its popover keeps Reka off the login page's critical path.
   - Two shared primitives: `MenuEntry.vue` (the button entry of a popover menu,
     on `MENU_ENTRY_VARIANTS`, now shared) and `ProfilePicture.vue`.
   - The cloud-only parts are under `src/cloud/`: `billing/` (the trial
     indicator, "Upgrade" and the "Upgrade Plan" entry), `organization/` (the
     maintainer's organization switcher) and `versionChecker/` (decision 6b's
     list). They are imported directly, with a note, as #82 did (ruling 7): a
     user-menu registry would be designed around two entries, one of which sits
     between core entries.
   - **"Invite" stays React** (`InviteUsersButton`, mounted with
     `reactComponent`): its dialog, `InviteUsersModal`, is also the Members
     settings' and is #87's (organization) to port.
2. **The user menu stays a dialog of buttons.** The ticket asks for "menu roles,
   arrow keys, Escape, matching react-aria behaviour". What react-aria gives
   here is a dialog ("User Settings") of buttons: the React `Popover` renders a
   plain `role="dialog"`, and #81's accessibility snapshot pins it. A `menu` of
   `menuitem`s with arrow keys would change what screen readers announce and how
   the menu is driven: a feature for its own ticket. The snapshot is unchanged.
3. **One deliberate difference, for keyboard users: focus goes into the
   popover.** The React popover is not react-aria's `Dialog`, so it never moved
   focus: after opening the user menu (by click or Enter) focus stayed on the
   button, Tab went on to the page beneath, and Escape closed it only once focus
   had somehow got inside. A Reka popover traps focus. `Popover.vue` now focuses
   its dialog element as it opens (as react-aria's `useDialog` does), rather
   than its first control; Tab then moves through the entries, Escape closes it
   and returns focus to the button. Seen by a keyboard user only: the button
   loses its focus ring while the menu is open, and the entries show React's
   focus ring (spelled out under `focus-visible:`, as Tailwind does not generate
   variants of the multi-selector `focus-ring` class). It is a fix, so it takes
   no changelog entry.
4. **Two `Popover.vue` parity fixes, found by screenshot.** React's popover is
   positioned against the viewport, so its `w-full` is the viewport's width
   capped by the size's `max-w-*`; Reka's sits in a wrapper as wide as its
   content and shrank (the user menu was 141px wide, not 206px): the Vue popover
   uses `w-screen` instead. And it keeps react-aria's 12px from the viewport's
   edges (`collisionPadding`). It also takes react-aria's `crossOffset`, which
   the tray uses. With these, the user menu, the tray and the info menu match
   React's pixel for pixel.
5. **The shortcuts are the user's, shared with React.** The user menu shows each
   entry's shortcut and its entries are global actions while the bar is mounted,
   open or not, as React's `useMenuEntries` made them: in the command palette,
   with `Mod+,` (Settings) and `Mod+/` (About) attached to `document.body`. So
   the dashboard's bindings, with the user's changes, are now one instance
   (`$/providers/dashboardInputBindings`, shared with #86) that the React
   `InputBindingsProvider` uses too, and `useMenuEntries` has a Vue counterpart
   (`$/composables/menuEntries`). `MenuEntry.vue` reads its action's shortcut,
   icon and colour from it, which #82 (ruling 6) left out of
   `KeyboardShortcut.vue`. One registry for both binding systems is still #170.
6. **Notifications.** The React hooks are a Vue composable over the uploads
   store (`notifications.ts`); the ticket's "over vue-query" applied only to
   `useIsMutatingForBothBackends`, which nothing used, and is gone. An upload's
   progress now follows each chunk (React re-read it only when something else
   re-rendered); the messages, toasts and the minute a finished notification
   stays are unchanged. The tray's list is a plain `role="list"`, where React's
   was a react-aria `GridList` (`role="grid"`) whose rows the arrow keys moved
   between; nothing selects them, and each item's one control (its close button)
   is reached with Tab. Invisible.
7. **The version checker still checks upstream's releases.** The maintainer's
   decision was to point it at this fork's releases if that is contained and the
   fork publishes any: it publishes none (`gh release list` is empty,
   `releases/latest` answers 404), so it keeps polling
   `enso-org/enso/releases/latest` exactly as before, and the question went to
   the maintainer as #180. `App.vue` mounts it where React did (in the React
   root, on every page), only while the check is enabled (the desktop app, or
   forced from the devtools), and loads it then. "Remind me later" now marks the
   cached release as postponed; React wrote its `select`ed view into the cache,
   so the next `select` threw and the dialog was hidden by that error until the
   next check. The outcome is the same.
8. **About.** The user and info menus open the existing Vue dialog through
   `openAboutModal()`. Its `Mod+/` shortcut now comes from the Vue
   `useMenuEntries`. In Playwright (Chromium, base and branch alike), About
   opened with `Mod+/` takes focus and closes with Escape; the installer bug
   (#170) did not reproduce there and is left to #170.
9. **No changelog entry.** Nothing changes for a mouse user, and the keyboard
   change is a fix: the PR takes `CI: No changelog needed`, though the ticket
   asked for an entry.

## Rulings from #85 (authentication pages, 2026-10-02)

#85 ported the authentication pages: sign-in (with its one-time-code step),
sign-up (with its email-confirmation step), email confirmation, forgot password,
reset password and account restoration. Delegated like the rulings above:
provisionally accepted, for the maintainer to review.

1. **One PR, not split.** The six pages and their layout were about 1.1k lines
   of React and are about 1k of Vue, behind one mount site (the router); a split
   would have kept the React `AuthenticationPage`, `Link` and Form layer on the
   auth path for a second PR with nothing to gain.
2. **The first cloud area, and its entry point.** The pages are in
   `src/cloud/auth/` (decision 6b), and the core reaches them only through
   `registerCloud(router)` in `src/cloud/index.ts`, which `entrypoint.ts` calls
   before the router starts. Routes are the first registry: `registerCloud` adds
   them with `router.addRoute`, the sign-in, sign-up and restore pages under the
   protected layout, which is now a named route (`PROTECTED_LAYOUT_ROUTE`,
   `src/router/routeNames.ts`). The ESLint boundary decision 6b asked for exists
   now: outside `src/cloud/`, importing `$/cloud` or an area (`CLOUD_AREAS` in
   `eslint.config.mjs`) is an error. Two exemptions: `entrypoint.ts`, and the
   React dashboard while it is ported (it mixes cloud and core code). The
   framework-free helpers at the top of `src/cloud/` (`validation.ts`, …) are
   not areas and stay importable. A community build drops the folder and the one
   call.
3. **Names.** `Login` and `Registration` became `LoginPage.vue` and
   `RegistrationPage.vue` (`vue/multi-word-component-names`); the other pages
   keep their React names. The old `src/components/RegistrationPage.vue`, which
   only hosted the React form, is gone: the sign-up page carries its data loader
   (the user-agreements query) itself.
4. **The info bar is #83's Vue one.** The React `Page` around each auth page
   showed the info bar (logo menu: About, and Sign out when signed in) and
   mounted the modal host. `AuthenticationPage.vue` does both: the Vue `InfoBar`
   (`$/components/InfoBar/`, ported by #83) and `ModalHost.vue`, each loaded on
   first use, as the React `Page` loads them. `RestoreAccount` had no `Page`,
   and still has none.
5. **Every auth page loads on demand, the sign-in page included.** The React
   `Login` was imported statically by `router.ts`, so it sat in the initial
   chunk. A static Vue sign-in page would pull Reka (through `Button`'s tooltip)
   into the initial chunk, which #78 and #80 kept out, so it is a lazy route
   like the others. Measured with `corepack pnpm run build`: the initial chunk
   shrinks by 69.2 KB minified (24.0 KB gzip); all JavaScript grows by 55.0 KB
   (26.6 KB gzip), as the Vue primitives the pages share land in chunks of their
   own while the React form layer stays for the dashboard's other forms.
6. **Links navigate in the app.** react-aria's `RouterProvider` made a plain
   click on a React link to a page of this app a router push. A Vue `<a>` would
   reload the page. `useClientNavigation` (`src/components/Link/`) applies
   react-aria's rule (same window, same origin, no download, no modifier key),
   and both the new `Link.vue` and `Button.vue` with an `href` use it. This
   changes `Button.vue` for every caller: none had an in-app `href` before.
7. **Query parameters are read from `useRoute()`** (`queryParam`), not from the
   global `useQueryParams` store the React pages used. The pages only read them;
   the values are the same; and a global store keeps the first router it saw,
   which component tests cannot replace.
8. **Toasts that outlive the page use the global store.** `useToast` dismisses
   its toast when its component goes, so "Check your email" after a password
   reset request (shown as the page returns to sign-in), the reset success, the
   missing-link-parameter errors and the federated sign-in errors call
   `useToasts().show`, as the React `toast` did.
9. **Two React quirks are kept.** A wrong one-time code shows no message: the
   React form reset itself after `onSubmit` returned, which cleared the error
   `onSubmit` had just set, and emptied the code for another try; the Vue form
   does the same. And `ConfirmRegistration` renders an empty `h1` (its title is
   `''`). Either fix is a visible change, so it is left for a separate issue.
10. **A porter's trap: untouched fields.** react-hook-form read an untouched
    uncontrolled input as `''`; the Vue `useForm` leaves a field without a
    default `undefined`, which zod reports as "This field is invalid" instead of
    the field's own message (a too-short password, a mismatched confirmation).
    Every text field of the auth forms has an `''` default; the playbook says so
    now.
11. **Fixes to the primitives, found by comparing the running pages.**
    - React's `Field` puts its label id on the whole field content when it has
      no label, so a label-less `Checkbox.Group` is named by its checkboxes'
      text: `group "I agree to the Enso Terms of Service"` is how the sign-up
      page object and the agreements dialog locate it. The Vue `Field` does the
      same, and `CheckboxGroup` is always labelled by that id.
    - The pages now mount a little later than React's statically loaded sign-in
      page did, so an `autoFocus` input's delayed focus (100 ms, as in React)
      could fire while a test, or a fast user, was already typing in the next
      field, and take the keystrokes. The delayed focus now leaves a text field
      that already has the focus alone.
    - `CheckboxGroup` has a `description` slot, for a description with markup
      (the Terms of Service link).
12. **What a user notices: nothing.** Every state of every page was compared
    with develop's in the running app (18 screenshots, accessibility trees, DOM,
    focus and tab order; see the PR), with no differing pixel. The accessibility
    trees differ only by react-aria's live-region announcer (`log` elements),
    which the Vue buttons do not add; the one-time-code step, which the mocked
    Cognito cannot reach, is covered by unit tests instead. axe no longer
    reports two `color-contrast` nodes on the login screen (the Forgot password
    link and the Login button's content, which carried react-aria's generated
    ids); the pixels are the same, so the baseline keeps them rather than
    claiming a fix. The PR takes `CI: No changelog needed`.

## Rulings from #86 (settings: the shell and the personal tabs, 2026-10-02)

#86 ported the settings page's shell (sidebar, search, layout, the `SettingsTab`
query parameter) and its personal tabs: Account (with two-factor
authentication), Local, Appearance and Keyboard shortcuts. Delegated like the
rulings above: provisionally accepted, for the maintainer to review.

1. **One PR, not split.** The ticket allowed a split (shell, Local and Account
   first; 2FA and shortcuts later). Every split point left a React piece inside
   a Vue tab: 2FA is a section of the Account tab, and the capture modal shares
   the keyboard tab's bindings. The work is in reviewable commits instead: the
   bindings store, the shell and its tabs, the cloud's sections, and the
   primitives' fixes.
2. **The declarative model survives,** framework-free, in
   `src/configurations/settings.ts`: tabs, sections and entries, the context
   their predicates receive, and the search. One search spans the Vue and the
   React tabs, so search results stay as they were. Entries name a Vue component
   instead of JSX; a component reads the page's context with
   `useSettingsContext` (`$/providers/settingsContext`, a `createContextStore`)
   rather than as props, so a component that needs none does not get one as a
   stray attribute. The Appearance tab (two switches) was ported too: it was the
   last personal tab, and a third framework boundary for 60 lines was not worth
   keeping.
3. **The Account tab is the cloud's,** under decision 6b. Every one of its
   sections needs Enso Cloud or Cognito. They are in `src/cloud/account/`
   (profile and password forms as data, the account's deletion, the profile
   picture) and `src/cloud/auth/` (two-factor authentication), and reach the
   core through the second registry, `contributeSettingsSections(tab, loader)`
   (`$/providers/settingsContributions`). A loader keeps them out of the initial
   chunk; the settings route waits for it, so the tab never renders half-filled.
   `account` joins `CLOUD_AREAS`. In a build without the cloud the Account tab
   is empty.
4. **The organization tabs stay React, inside the Vue page**, through one
   `ReactSettingsTab` (`reactComponent`), with a TODO for #87 and #88: their
   React shell (`Tab`, `Section`, `Entry`, `FormEntry`, `Input`, `AriaInput`,
   `CustomEntry`, `Paywall`) and their data stay too. The React context lost the
   members only the personal tabs used.
5. **One set of dashboard bindings per window.** The bindings lived in the React
   `InputBindingsProvider`'s state, out of Vue's reach. They moved, unchanged,
   to `$/providers/dashboardInputBindings`: the same `localStorage` key
   (`inputBindings`), the same format, and the same loading. Tests load what the
   React provider saved. One quirk is kept for #170: an action missing from the
   saved record loads with no bindings (only an action added in a later release
   can be missing). A change bumps a counter that Vue tracks and the React
   provider watches, so React's consumers re-read the bindings: the command
   palette shows a new shortcut at once. It is the same instance as #83's
   (ruling 5 there): #83's Vue menus read it through
   `useDashboardInputBindings`, an alias of `getDashboardInputBindings`, and see
   a rebinding at once too.
6. **Rebinding works now; it did not on `develop`.** Comparing the running app
   found that the React capture modal never received a key: its form had the
   focus, yet `Ctrl+Shift+K`, `q` or `Escape` left it at "No shortcut entered"
   (Playwright, on the base branch). The Vue modal takes the keys at once. It is
   a bug fix, so the PR takes `CI: No changelog needed` under the repository's
   rule.
7. **`qrcode.react` is replaced by `uqr` 0.1.3** (exact pin, MIT, no
   dependencies), a port of the encoder `qrcode.react` bundles (Nayuki's QR Code
   generator). For six links, including the authenticator links Cognito issues,
   the two give identical modules; a test pins one. `QrCode.vue` draws them as
   `QRCodeCanvas` did. `input-otp` goes too, with the last React one-time-code
   input (#79, ruling 10).
8. **Fixes to the primitives, found by comparing screenshots.**
   - `Switch`, `Checkbox`, `Radio` and the `Selector`'s options rendered
     `data-selected="false"`, which the react-aria Tailwind plugin's `selected:`
     matches (it tests presence): an unchecked switch looked checked. They now
     omit the attribute, as react-aria does.
   - `ComboBox`: its list is as wide as the field and starts under it, is no
     taller than the space below (12px short of the window's edge), and scrolls
     inside, opening at the selected item. The field's `<label>` wraps the
     chevron button, which is its first control, so hovering anywhere on the
     field hovered the button; it now shows hover only for a real pointer, as
     react-aria's `data-hovered` did. It is named "Show suggestions", as
     react-aria named it; the list is named by the field's label, and the reset
     button is in the tab order again (Reka takes it out). `toOptionText` gives
     an option a text other than the one typing filters by (React's `children`
     returning a string).
   - `OTPInput`: an `<input>`'s intrinsic width kept the six boxes from sharing
     the row, and three of them were clipped.
   - `Popover` keeps 12px from the window's edges, react-aria's
     `containerPadding`.
   - `CopyButton`'s copy-and-toast moved to `Button/copy.ts` (`useCopy`), which
     the new `CopyBlock` shares.
9. **Small things that change nothing visible.**
   - The current-password field's `autocomplete` was `current-assword`. It is
     `current-password` now, and the axe baseline's `autocomplete-valid` entry
     for it is gone.
   - The React tab content's `onInteracted` set the tab to its own value: a
     no-op. It was dropped.
   - The time-zone field's `hidden` predicate (free and solo plans) never
     applied: the React combo box ignored it. It was dropped, and the field
     shows as before.
   - Names: `SettingsPage.vue` and `SettingsSearchBar.vue`
     (`vue/multi-word-component-names`). `reactTabs.ts`' unused `Settings`
     export is gone.
   - `KeyboardShortcut.vue` is byte-identical to #174's, so that either PR can
     land first.
10. **What a user notices: rebinding works** (ruling 6). Otherwise every state
    of the personal tabs was compared with the base branch in the running app
    (25 screenshots, accessibility trees and DOM): the differences left are the
    drive's timestamps behind the page, antialiasing, the deliberate ones above,
    and three of the primitives': the one-time code is six labelled inputs
    rather than one (#79, ruling 10); a combo box opened from the keyboard keeps
    the caret where it was rather than at the end; and while a combo box's list
    is open, react-aria hid the rest of the page from assistive technology
    (`aria-hidden` outside it), which Reka's combo box does not. The tab order
    through each personal tab is the React page's.

## Rulings from #89 (asset panel: Versions and Activity, 2026-10-02)

#89 ports the right panel's asset tabs. Delegated like the rulings above:
provisionally accepted, for the maintainer to review.

1. **Split: Versions and Activity first, Properties and Schedule in #183.**
   Properties leans on React pieces with no Vue counterpart yet (the datalink
   editor's `JSONSchemaInput`, #92; the secret form, #174; the drive table's
   "created by" and "shared with" columns; the spotlight), and the Schedule tab
   brings `NewProjectExecutionModal` (437 lines) and a calendar. Together they
   would have doubled a PR whose two tabs already stand alone.
2. **Port, not delete** (decision 7): versions, the diff view and the version
   tags and comments are all ported.
3. **Where the code goes.** The Versions tab is cloud-only, so it is
   `src/cloud/versions/`; `RightPanel.vue` imports it directly and says why,
   until #179's registry exists (then #183 moves it there and adds `versions` to
   `CLOUD_AREAS`). The Activity tab also works locally, and its host
   `RightPanel.vue` is shared code that may not import `#/`, so it is
   `src/components/AssetPanel/`, not `src/dashboard/`. Two shared pieces came
   with the port: `UserWithPopover.vue` (the React one stays for the drive table
   and the settings) and `ProfilePicture.vue`, byte for byte #181's, so the two
   PRs merge cleanly. `patterns.ts` (`TEXT_WITH_ICON`) moved to
   `src/components/`, and `Text.vue` exposes its element, which the version row
   measures as React did through a `ref`.
4. **The diff view is CodeMirror's merge view, and Monaco is gone.** The ticket
   asked for it: Monaco was fetched from jsDelivr at run time (there was no
   `loader.config`), so the diff did not work offline. `@codemirror/merge`
   6.12.2 replaces `@monaco-editor/react` and `monaco-editor`, and loads with
   the first comparison, not with the dashboard. It is styled after the Monaco
   editor it replaces: side by side, read-only, line numbers in Monaco's colour,
   Monaco's `vs` diff colours for changed lines and text, its 14px monospace
   font, and hatched spacers where Monaco drew its diagonal fill. **For
   review:** it is not pixel-identical: Monaco's overview ruler and scrollbars,
   its gutter +/- markers and its indent guides have no counterpart (the text,
   line numbers and highlights sit where Monaco's did; see ruling 7). The panel
   is cloud-only and opened on demand, so the PR still takes
   `CI: No changelog needed`; say if it should have an entry. The
   selection-clearing effect's Monaco exemption (`isElementPartOfMonaco`) went
   with it: the merge view's editors are content-editable, which the effect
   already exempts.
5. **"Compare with" opens on the modal stack** (`useModals().open`), where React
   used `setModal`. As with #156 (ruling 5), the dialog leaves the stack when it
   closes, so `useModalRef` no longer reports a stale modal afterwards. "See
   changes" stays a local dialog with a trigger, as React's `Dialog.Trigger`
   was.
6. **Queries keep React's keys and options**, in
   `src/cloud/versions/queries.ts`: `[type, 'listAssetVersions', id]` with a
   stale time of 0 and persistence on, the version-content key, and the sessions
   key `['getProjectSessions', id, title]`; the cached and persisted entries
   stay valid, and `INVALIDATION_MAP` invalidates them as before. The
   version-tag hooks moved there from `#/hooks/backendHooks` with the same
   optimistic update. A tab waits for its query in `setup` inside a
   `SuspenseLoader`, as React's `useSuspenseQuery` suspended, and is keyed by
   its asset or project, so a new selection shows the loader again.
7. **Overlays placed as react-aria placed them**, found by comparing screenshots
   of the base and the branch. `Popover.vue` takes #181's version verbatim
   (React's width, 12px from the viewport's edges, focusing itself as it opens),
   so the two PRs merge cleanly. `DropdownMenu.vue` gains an `offset` prop
   (default unchanged, 4) and, like `MenuSubmenu.vue`, react-aria's 12px
   `containerPadding`; the version menu passes React's centred `bottom`
   placement and 8px offset, and a submenu sits 8px from its item. With these,
   the menu, the submenu, the tag and user popovers and every tab match React to
   the pixel (the remaining differences are the drive's clock-time column). The
   diff view's gutter and line highlight were measured against Monaco's and
   aligned to the pixel; ruling 4 lists what still differs.
8. **One React class string is not carried over:** each tag's
   `min-w-[8ch] max-w-[32ch]` was built at run time, so Tailwind never generated
   it, and it had no effect.
9. **Tests.** `ProjectSessions.test.tsx` is ported to Vue with the same cases,
   plus switching projects and the logs button; `AssetVersions.test.ts` covers
   the placeholders, the list, restore, duplicate-and-open, "Compare with", "See
   changes" (the diff's two sides, Escape, focus back on the trigger), the
   comment editor (Enter, Escape) and the tags (suggestions, add, remove,
   collapse), from the keyboard where react-aria gave React that access.
10. **No changelog entry**: the PR takes `CI: No changelog needed` (see ruling 4
    for the one visible difference).

## Rulings from #90 (the drive's state, 2026-10-03)

#90 ports the drive's state and data layer. Delegated like the rulings above:
provisionally accepted, for the maintainer to review.

1. **Split: the state first, the queries and mutations in #192.** The ticket
   covers about 3,000 lines of React hooks. The state (the `DriveProvider` store
   and the category switch's pending state) stands alone; the data layer does
   not split as cleanly, because merging the two sides' query defaults changes
   when some queries refetch (see #192) and the move mutation asks the React
   duplicate-assets modal (#92). #192 also deletes `reactApi`, which keeps only
   `transferBetweenCategories` until then.
2. **The drive store is framework-free, with thin React adapters**, as
   `dashboardInputBindings` is (#86). `$/providers/driveStore` holds the
   selection, the clipboard (`pasteData`), the asset to rename, the context
   menu, whether the selection can be downloaded and the drag target, as one
   immutable snapshot in a `shallowRef`: `update(patch)` replaces it, so fields
   set together reach subscribers together, as zustand's `setState` did, and
   sets and assets are never wrapped in proxies. It is not a zustand store
   (decision 6a). The ticket's "expanded directories" no longer exist: the table
   lists one directory at a time.
3. **One store per mounted drive, not a global one.** The React drive unmounts
   when the left panel is hidden, and its selection and clipboard went with it.
   `DriveProvider` creates the store as before; the Vue drive will provide its
   own with `provideDriveStore` (`createContextStore`). Nothing outside the
   drive reads the store.
4. **React reads it through `storeHooks`' `useStore`, unchanged.** The adapter
   (`useDriveState`) gives `useStore` a read-only view of the store (`getState`,
   `subscribe`), so the selectors, their equality functions and the rows'
   `unsafeEnableTransition` render exactly as before. `useStore` now accepts
   that read-only shape (`ReadonlyStoreApi`). Consumers write through the
   store's own setters and `update`, and the three subscribers in `AssetsTable`
   keep firing on every update, as they did.
5. **`isNavigating` replaces React's transition state, and React still keeps the
   old listing on screen.** The drive location (`$/providers/drive`) has an
   explicit `isNavigating` and a `setNavigationTransition` hook. The React drive
   (`useDriveNavigationTransition`) installs its `startTransition`, so a change
   of category or directory still renders in a transition (the old rows stay
   while the new ones suspend, which the specs rely on through `data-category`),
   and mirrors the transition's pending state into `isNavigating`, which
   `CategoryButton.vue` shows as its spinner. The Vue drive (#91) will set
   `isNavigating` from its query (`placeholderData: keepPreviousData`). The
   transition moved from `Dashboard.tsx` into the drive, which is the only
   component reading the location that can suspend; `AppContainer` loses its two
   React props.
6. **One query cache already.** `entrypoint.ts` creates one vue-query
   `QueryClient` and `ReactRoot.tsx` hands the same instance to React's
   `QueryClientProvider`, so the two sides share keys, cache and persistence;
   nothing is bridged.
7. **No changelog entry**: nothing on screen changes, so the PR takes
   `CI: No changelog needed`.

## Rulings from #170 (one key-binding registry; graph shortcuts rebindable, 2026-10-03)

#170 unifies the two key-binding registries in Vue and, as the maintainer
decided on 2026-10-02, makes the graph editor's shortcuts rebindable from
Settings → Keyboard shortcuts. Delegated like the rulings above: provisionally
accepted, for the maintainer to review.

1. **One PR, in two commits.** The first commit unifies the registry and the
   store with no visible change; the second makes the graph's shortcuts editable
   and puts them in the command palette. Split into two PRs, the first would
   have carried the graph half of the store, its saved format and the scopes
   with nothing in the app to exercise them, and the whole would have been
   reviewed and tested twice.
2. **One registry and one store; two dispatchers.**
   - `$/configurations/graphInputBindings` holds the graph editor's shortcuts in
     the dashboard's definition format (`defineBindings`: bindings, category,
     icon, `rebindable`), with the same defaults in the same order. A test pins
     every default as it was on `develop`, and the order, which decides which
     action a shared key goes to first.
   - `$/configurations/keyboardShortcuts` is the registry: every action of the
     dashboard, the graph editor and the app shell, with its scope, category,
     name and current bindings, and the conflict checks.
   - `$/providers/inputBindings` is the window's one store: both namespaces,
     loaded and saved together. `$/providers/dashboardInputBindings` is now its
     dashboard half, under the same names, so the React provider and #83's Vue
     menus are unchanged.
   - Dispatch stays where it was. The dashboard's `defineBindingNamespace`
     handlers (focus scopes, `DEFAULT_HANDLER`, React and Vue menus) and the
     graph's `defineKeybinds` handler (`allowRepeat`, first-match order, digits
     by position) differ in semantics (#156, ruling 1). Both now read the store,
     so a rebinding applies at once; merging them would touch every keyboard
     path of the drive and the graph for no visible gain.
   - `graphBindings` is `defineRebindableKeybinds`: it rebuilds its lookups when
     the store's bindings change, and its `bindings` (which the shortcut
     tooltips and menus show) are getters that Vue tracks. `@/providers/action`
     reads them through getters, so tooltips and context menus show the user's
     shortcut.
   - `isMacLike` moved from `@/composables/events` (which re-exports it) to
     `$/utils/event`, so shared configuration does not import a project-view
     composable.
3. **Three scopes.** Every shortcut is active in one:
   - `app`: anywhere in the window. The dashboard's actions attached to
     `document.body` (the user menu's Settings and About, Go Back and Forward,
     the settings tabs, Close Modal, Cancel Cut), and the app shell's (Close
     Tab, Quit, the command palette, Escape).
   - `drive`: the dashboard's other actions, attached to the assets table's
     focus scope, so they act only on a key pressed inside it.
   - `graph`: the graph editor's, whose handler listens only while its project
     tab is current (`KeepAlive` deactivates it otherwise).

   `app` overlaps both others; `drive` and `graph` never do, since a project tab
   and the drive are never current together and focus cannot be inside a hidden
   tab. So a graph shortcut may share a key with a drive shortcut (both have
   `Mod+C` for Copy, by default), never with an `app` one. The scopes are
   documented in `keyboardShortcuts.ts`, which lists the dashboard's `app`
   actions by name.

4. **Conflicts are checked by scope, and named.** The capture dialog refuses a
   key that another action has in an overlapping scope, and says which ("This
   shortcut is already used by 'Undo'."); React's check refused any key of any
   dashboard action, with "This shortcut already exists.", which is still the
   message for a key the action itself has. Keys are compared in a canonical
   form (`OsDelete` is the platform's Delete; case and modifier order do not
   matter). A non-rebindable shortcut still holds its key: no action can take
   Escape, `Mod+K`, `Mod+W` or `Mod+Q`. For the dashboard this is slightly
   stricter (the app shell's keys) and, for its `app` actions, also checks the
   graph's: About can no longer be given `Mod+Z`.
5. **A conflict the user makes is shown; a shared default is not.** A reset can
   bring back a default that the user has since given to another action. The
   settings tab then draws both bindings in red and names the other action in
   the row's description column (which was empty: no dashboard action had a
   description). Keys that two actions share by default are shared on purpose
   and are not reported: Rename and Restore From Trash (`Mod+R`), each acting
   only where it applies; and the Escapes.
6. **What stays fixed, and why** (noted beside each in `@/bindings` and the
   registry):
   - Escape: the graph's Deselect All, the app's Cancel, Close Modal and the
     rest. Escape cancels everywhere.
   - Delete on a selected connection follows Delete on components
     (`GRAPH_BINDING_FOLLOWERS`): one key deletes the selection, whichever kind
     it is, as the defaults have it. It is not listed, and never conflicts with
     the action it follows. The listed action's name says both: "Delete Selected
     Components or Connection".
   - The app shell's Close Tab (its alternatives exist because browsers keep
     `Mod+W`), Quit and Open Command Palette: they are not the graph's, and stay
     as they are; they are in the registry so that nothing takes their keys.
   - The focused widgets inside the project view: the component browser (typing
     into it), CodeMirror's text and documentation editors, lists, the table's
     grid and visualizations. They take their keys first while they have the
     focus, deliberately shadowing the graph's (`Enter` in a list, `Mod+C` in a
     text editor), so they are no conflict either.
   - Mouse bindings: the capture dialog takes keys only.

   That leaves 19 graph actions rebindable, in two categories after the
   dashboard's: Graph Editor and Graph Components.

7. **Saved format, version 2.** The same `localStorage` key (`inputBindings`)
   and record of action to bindings, extended so that both directions work:
   - `"$version": ["2"]` marks it. It is a list because a version 1 reader
     validates the whole record as lists of strings, and would drop everything
     on any other shape.
   - Every dashboard action is still written, as in version 1, so a downgraded
     build keeps the user's dashboard bindings.
   - A graph action is written only when it differs from its defaults, so a
     later change to a default reaches everyone who has not changed that action.
     Graph ids are dotted and dashboard ids are not, so they never collide, and
     a version 1 reader ignores them.
   - Loading reads either version. Each action found replaces that action's
     defaults; an unknown action, or a graph action that is not rebindable, is
     ignored. Tests load a version 1 record unchanged, round-trip version 2, and
     read version 2's output with version 1's own schema and loader.
8. **#86's kept quirk is fixed:** an action missing from the saved record now
   keeps its defaults, instead of loading with none (#86, ruling 5). Every save
   writes every dashboard action, so only an action added in a later release can
   be missing, and it should come with its default.
9. **The settings tab groups every action by category,** the dashboard's too,
   under a heading row each, in the registry's order (the dashboard's
   categories, then the graph's). The rows used to be one list in definition
   order. Settings search finds the tab by the graph actions' names as well.
10. **The command palette lists the graph's actions** while the graph editor is
    the current tab: its enabled rebindable actions, named and grouped as in the
    settings, with their current shortcuts. They were not in the palette before.
11. **Digits are captured as the graph editor matches them.** Its handler takes
    a digit key by position (`event.code`), so `Shift+2` reaches it as `2`, not
    `@`. The capture dialog does the same for a graph action
    (`digitsByPosition`), and keeps the character for a dashboard action, whose
    handlers match `event.key`.
12. **A graph shortcut may be a plain key,** as Space, Enter and F1 are by
    default: the capture dialog does not ask for a modifier. Typing does not
    reach the graph's handler from its text editors; a probe bound `Q` to Show
    Code Editor and typed `q` into the component browser, a node's text widget
    and the code editor itself, and the code editor did not toggle in any of
    them.
13. **Not done:** one dispatcher for both (ruling 2); rebinding the app shell's
    shortcuts or mouse bindings; and the React `KeyboardShortcut`'s `action`
    form in Vue, which nothing in Vue needs yet.
14. **Changelog entry:** yes. Rebinding graph shortcuts is a feature.

## Rulings from #183 (asset panel: Properties and Schedule, 2026-10-03)

#183 is the second part of #89: the right panel's Properties and Schedule tabs.
Delegated like the rulings above: provisionally accepted, for the maintainer to
review.

1. **The third registry: right-panel tabs.** `RightPanel.vue` no longer imports
   cloud code. `contributeRightPanelTab(tab, loader)`
   (`$/providers/rightPanelContributions`) gives the Properties (`settings`),
   Versions and Schedule (`executionsCalendar`) tabs their content;
   `registerCloud` calls `registerPropertiesTab` and `registerVersionsTabs`. The
   tabs' definitions (icon, title, order, when they are enabled, the scheduler's
   paywall) stay in `$/providers/rightPanel`, so their place in the bar, and the
   axe baseline's `nth-child` targets, are unchanged; a tab that nothing
   contributed is hidden, so a build without the cloud shows none of the three.
   A contribution is a loader: each tab's code loads when it first opens,
   showing meanwhile the loader React's `Suspense` showed around the React tabs.
   The registry imports no component, since `registerCloud` reaches it from the
   app's entry. `properties` and `versions` join `CLOUD_AREAS`.
2. **Where the code goes.** Schedule is `src/cloud/versions/` (decision 6b lists
   scheduling there); Properties is a new area, `src/cloud/properties/`: every
   section needs the cloud (the tab says so outside it). `reactTabs.ts` keeps
   only the drive, and the React `AssetProperties`, `ProjectExecutionsCalendar`,
   `ProjectExecution`, `AssetPanelPlaceholder`, `NewProjectExecutionModal` and
   `spotlightHooks` are deleted, with the unused
   `listProjectExecutionsQueryOptions` and
   `getProjectExecutionDetailsQueryOptions`.
3. **The datalink editor stays React, behind the bridge.** `JSONSchemaInput` and
   its `FilePathInput` are #92's, shared with the drive's datalink dialog (#82,
   ruling 1). The tab ports the form around it (Vue `Form`, "Update" and "Reset"
   once changed, `FormError`) and mounts only the React editor (`DatalinkInput`,
   a controlled value and `onChange`) with `reactComponent`, from
   `properties/reactDatalinkInput.ts`: the one `#/` import in `src/cloud/`,
   allowlisted until #92. React's `FieldError` there had no field around it and
   rendered nothing; the Vue form shows no field error either. The secret's form
   is #82's `UpsertSecretForm.vue` (`cancel="reset"`); the React one stays for
   the drive's dialog. The drive table's "created by" and "shared with" cells
   and the label pill are small Vue copies in `properties/`
   (`PermissionDisplay.vue`, `AssetLabel.vue`), never pressable, as the tab used
   them; the drive keeps the React ones until its port.
4. **One deliberate difference: the spotlight finds its section.** "Edit" on a
   secret or a datalink dims the window around its configuration. React measured
   the section only when it was resized, so when "Edit" also opened the right
   panel, the cutout stayed where the section was as the panel began to slide
   in, at the window's right edge, and the section itself stayed dim. The Vue
   overlay follows the section every frame and ends up around it. With the panel
   already open the two are identical. A fix, so no changelog entry.
5. **The calendar is Reka's, shaped as react-aria's.** Reka's `Calendar` gives
   the keyboard (arrows, Enter/Space, paging at the month's edges) and the
   previous/next buttons. To keep what assistive technology gets: the root is an
   `application` named by the month with a hidden `h2`, the table a `grid` named
   by the month, each day a button named "Today, …" / "… selected" as react-aria
   named it, and a hidden "Next" button ends the calendar, as in React. The
   header row stays empty: React gave its header cells no content. Days of other
   months are disabled through `isDateDisabled`, not Reka's
   `disableDaysOutsideCurrentView`, which marks every cell `aria-disabled`. The
   chosen day and month are not reset when the selection moves to another
   project (React's calendar was not keyed). While a month loads, a loader
   replaces the tab and the calendar keeps its state, as React's suspended query
   did. "Previous" is a new text id (react-aria supplied it).
6. **Primitives fixed by comparing the running app.**
   - `DatePicker`: `minValue` and `hideTimeZone` (React passed them through),
     and values written as the `sv` locale writes them (`2045-01-26 1:23`: the
     month and day padded, the hour not), where it showed `2045-1-26 01:23`.
   - `Dropdown`: the closed field grew by its list's height, clipping its bottom
     border; and its list takes the first Escape while it has a selection, as
     react-aria's `ListBox` did, so a dialog around it closes on the second.
   - `DropdownMenu`: an item that opens a dialog leaves the focus there. Reka
     returned it to the menu's trigger as the menu's exit animation ended, and
     the dialog's focus trap took it back without showing it: the deletion
     question's "Delete" lost its focused colour.
7. **Kept as React had them:** only the `compact` execution row (the only one
   the calendar used) is ported; the repeat is described with "monthly on the
   last weekday" still disabled; the delete question goes on the modal stack
   (`ask`), and leaves it when answered (#156, ruling 5).
8. **What still differs, by a few pixels.** The executions' actions menu,
   centred under a trigger near the window's right edge, sits 4px left of
   React's: react-aria offset it although it fitted (the Vue menu is centred on
   its trigger); the date field's digits are rasterised 1px lower within
   identical boxes. Everything else, every state of both tabs, matches React's
   pixels apart from the drive's clock columns and antialiasing (see the PR).
9. **No changelog entry**: the PR takes `CI: No changelog needed` (ruling 4 is a
   fix).

## Rulings from #84 (the layouts' modals and the cloud-disabled page, 2026-10-03)

#84 ported the modals the layouts mount (the agreements gate, organization
setup, the pending invitation, the end of a trial, the downgrade warning) and
the page shown when running projects in the browser is disabled. Delegated like
the rulings above: provisionally accepted, for the maintainer to review.

1. **Port, not delete, and all here.** Decision 7 keeps every cloud-only area,
   so the ticket's port-or-delete questions are settled: all five modals and the
   page are ported. The trial and downgrade dialogs are ported here rather than
   with billing (#88): they are mounted by the same layout as the others, and
   moving them later is a file move. The cloud-disabled page still has a job
   after #3: it is what a browser build shows while `enableCloudExecution` is
   off, which #3 did not change. One PR, in four commits; the whole is about 500
   lines of Vue, and a split would have left `reactComponent` in one of the two
   layouts.
2. **Where they went.** `src/cloud/agreements/` (the dialog, and the agreement
   state `userAgreements.ts`, moved unchanged from `$/composables/` — the
   sign-up page, also cloud code, is its other user), `src/cloud/organization/`
   (setup, invitation), `src/cloud/billing/` (trial ended, downgraded, and the
   `downgradeModal` storage key they share) and `src/cloud/browserDisabled/`
   (the page and its route). `agreements` and `browserDisabled` join
   `CLOUD_AREAS`; `organization` and `billing` stay out of it, since #83's
   user-menu parts are imported directly from them.
3. **A third registry: the layouts' contributions**
   (`$/providers/layoutContributions`). `registerCloud` contributes the
   agreements gate (`contributeAgreementsGate`: the agreement state and the
   dialog) and the four modals over the dashboard
   (`contributeAppContainerModals`); the page is a route, added like #85's.
   **The layouts still decide when each shows**, with their logic unchanged; a
   contribution supplies only what shows. Moving the decision logic (the
   organization query, the plan and subscription rules) into the cloud would
   need the data loaders to take contributed loaders that run before their first
   `await`; that is a change of its own, for the community split. Each
   contribution is a loader, and the layout's data loader awaits it, so nothing
   joins the initial chunk and no modal appears a frame late.
4. **The agreements gate behaves exactly as before.** Same rules (signed-in
   users on protected pages, not in local-only mode), same queries, same storage
   keys and values, recorded at the same moment (the submit of a form with both
   boxes ticked), and the page stays unrendered while it shows. It fails closed:
   if the gate's chunk or the documents' hashes cannot be loaded, the navigation
   fails, as a failed hash fetch did. Only a build with no gate contributed at
   all (no cloud) asks nothing. Tests pin each rule (`ProtectedLayout.test.ts`,
   `AgreementsModal.test.ts`, `userAgreements.test.ts`,
   `registerCloud.test.ts`).
5. **`AlertDialog.vue` answers through a form, as React's did.** React's
   `AlertDialog` submitted through its `Form`: a failed `onConfirm`/`onCancel`
   kept the dialog open and showed the error under the buttons
   (`form-submit-error`), and while offline it showed the offline notice and did
   not answer. The Vue one showed neither; the invitation and trial dialogs need
   both. It now lays out and submits as React's form did. `canSubmitOffline`
   defaults to `true`, so `ConfirmDeleteModal` (#156) keeps answering offline;
   the #84 dialogs pass `false`, React's default. `cancel: null` leaves out the
   cancel button, as React's `cancel={null}` did.
6. **The downgrade warning's clock is a plain interval**, re-read each minute as
   React's `useCurrentTimestamp` did; `@vueuse/core`'s `useTimestamp` has no
   interval option in the version the app uses.
7. **What a user notices: nothing.** Every state (the agreements dialog
   unticked, focused, with errors, one ticked, both ticked, prefilled; setup,
   too short, done; invitation; trial ended; downgraded; the page loading and
   redirected) was compared with develop's in the running app. The agreements
   dialog and the page match to the pixel. The other dialogs match once the
   compositing layer Reka's enter animation leaves behind is re-created; with
   it, some rows rasterize a pixel apart (the shared `Dialog`/`AlertDialog`
   motion of #78, ruling 6, not this port). The remaining differences are the
   drive's clock column behind the overlay and the input's caret. The
   accessibility trees differ as before: the dialogs are named by their titles
   (#156, ruling 11), and react-aria's live-region `log`s and hidden "Dismiss"
   buttons are gone. The PR takes `CI: No changelog needed`.

## Rulings from #87 (settings: Organization, Members and the Invite dialog, 2026-10-03)

#87 ports the Settings organization tabs. Delegated like the rulings above:
provisionally accepted, for the maintainer to review.

1. **Split.** This PR ports Organization, Members and the Invite dialog (and the
   paywall pieces they show); User groups (with an accessible drag and drop),
   Activity log, API keys and Usage follow in their own issue, linked from #87
   and #75. Each half is about 1k lines of React, and the second brings the drag
   and drop and the date filters. **Usage is #87's, not #88's:** #88 names the
   Billing & Plans tab only, and Usage shows scheduled executions. The Billing
   tab stays React for #88.
2. **The core declares the tabs; the cloud fills them.** Organization and
   Members are declared in `tabs.ts` (name, icon, sidebar place, visibility,
   Members' `inviteUser` feature) with no sections, and
   `src/cloud/organization/` contributes their sections
   (`contributeSettingsSections`). A Vue tab with no sections is not listed, so
   a build without the cloud shows neither. A registry of whole tabs was
   rejected: it would split the sidebar's order between the core and the cloud.
3. **The tab-level paywall is a contribution** (`contributeSettingsPaywall`, the
   third settings registry, decision 6b's "paywall check"). The core decides
   with `useIsFeatureUnderPaywall`; the cloud supplies the screen
   (`src/cloud/billing/paywall/SettingsPaywall.vue`). The members tab is behind
   `inviteUser`, which a plan with several seats always has, so in practice only
   the devtools' paywall override shows it.
4. **The paywall pieces the tabs show are ported now**, though the paywall is
   #88's: `PaywallScreen`, `PaywallDialog`, `PaywallDialogButton`,
   `PaywallButton`, `PaywallAlert`, `PaywallLock`, `PaywallBulletPoints` and
   `PaywallUpgradeButton` (the paywall's `UpgradeButton`; the user bar's is
   `billing/UpgradeButton.vue`), in `src/cloud/billing/paywall/`, with React's
   markup and classes. The React originals stay for their React callers (user
   groups, the menus, the React settings `Tab`); `PaywallAlert.tsx` went with
   its last caller. `billing` and `organization` join `CLOUD_AREAS`: their only
   direct importers are in the exempt `src/dashboard/`.
5. **One Invite dialog**, `src/cloud/organization/InviteUsersModal.vue`, for
   every place that invites users: the Members tab and the user bar's
   `InviteUsersButton.vue` open it from a `trigger` slot, and an app-level modal
   (#84) can open it through `v-model:open`. React's `relativeToTrigger` (a
   popover variant) had no caller and is not ported, nor is the attempt to
   colour invalid addresses with the CSS Custom Highlight API (it cannot reach
   an `<input>`'s text).
6. **Four React faults are fixed, not kept**, each found by comparing the
   running app with develop's; none changes a working state:
   - an invalid address made the form's validation throw (the highlight ranges
     were set on the field's label), and "Send invites" spun for good; the Vue
     form says "Email is invalid", as React meant to;
   - an address typed twice was invited twice (React put the parsed objects in a
     `Set`);
   - removing or sending an invitation left the Members list stale until it went
     stale on its own: React invalidated `['listInvitations']`, a key only its
     form's own query had. `INVALIDATION_MAP` now has `inviteUser` and
     `deleteInvitation` invalidate `listInvitations`;
   - "Go to Members Page" set the old `page` query parameter, so from the drive
     it only closed the dialog; it now opens the Members tab. It still always
     shows: React's check for "already on the Members tab" read that same stale
     parameter and never held, and hiding it would move the Close button.
7. **The Vue `AlertDialog` shows a failed answer's error**, as React's (a
   `Form`) did with `Form.FormError`: same message, alert and
   `form-submit-error` test id. Removing a member the backend refuses showed why
   in React, and nothing in the Vue dialog. #78's ruling 10 stands: there is
   still no form, only the error.
8. **Queries keep React's keys and options**: `listUsers` and `listInvitations`
   persisted, fresh for a minute (`src/cloud/organization/queries.ts`). The
   invitation form now shares the Members tab's key, but refetches on opening
   (stale time 0), as its own React query did.
9. **The React form shell goes.** The React tabs left (billing, user groups,
   activity log, API keys, usage) have only custom entries, so `FormEntry`,
   `Input` and `AriaInput` are deleted with the organization form, and the React
   settings context loses `updateOrganization`, which the Vue one gains.
10. **What a user notices: the fixes above.** Every state of both tabs and the
    dialog (list, edit, save, validation and server errors, removal and its
    confirmation and error, resend, the paywall dialog, the read-only view of a
    member, no seats left, search, the user bar's Invite) was compared with
    develop's: the differences left are the drive's clock column behind the
    page, the fixes, a 1px sub-pixel shift of the invite field's description
    (the shared `Input.vue`), and native `:hover` on a button that appears under
    a resting pointer, where react-aria waits for the pointer to move. One
    keyboard difference is left to the shared `Dialog.vue`: a dialog opened from
    its trigger (Invite, the paywall dialog) focuses its first control, the
    close button, where react-aria focused the dialog itself; the Tab cycle
    inside is the same. Changing it would change every triggered Vue dialog, so
    it is not done here. No changelog entry: the PR takes
    `CI: No changelog needed`.

## Rulings from #191 (settings: User groups, Activity log, API keys and Usage, 2026-10-03)

#191 is #87's second half: the User groups, Activity log, API keys and Usage
tabs. Delegated like the rulings above: provisionally accepted, for the
maintainer to review.

1. **The same pattern as #87.** The core declares the four tabs in `tabs.ts`
   (name, icon, sidebar place, visibility, User groups' `userGroups` and Usage's
   `scheduler` paywall features) with no sections, and the cloud fills them
   through `contributeSettingsSections`. A build without the cloud lists none of
   them, and local-only mode (#186) still hides them by their visibility
   predicates.
2. **Where each tab went.** User groups and Activity log are the organization's:
   `src/cloud/organization/` (with `lambdaKinds.ts`). API keys belong to the
   user's account, not the organization (the tab is not `organizationOnly`):
   `src/cloud/account/`, beside the Account tab's sections. Usage summarises
   what the scheduler ran and is behind its paywall, and React called its props
   `Finances…`: `src/cloud/billing/` (with `executionUsage.ts` and its test). No
   new area, so `CLOUD_AREAS` is unchanged.
3. **`ReactSettingsTab` is needed for Billing & Plans only**, until #88. The
   React shell left (`Tab`, `Section`, `Entry`, `CustomEntry`) has only that
   tab, which has no paywall feature, so the React settings `Paywall` went, and
   with it the React `PaywallScreen`, `PaywallDialogButton` and `PaywallButton`,
   which had no other caller. `PaywallDialog` (and what it uses) stays for the
   React menus.
4. **There is no drag and drop to port.** The ticket names a drag and drop of
   users onto groups; the React tab lost it upstream (#13111, "Update User
   Groups settings section"). Users join a group through "Add Users", a combo
   box of the organization's other members, which is a keyboard path as much as
   a pointer one; a unit test drives it from the keyboard end to end (Manage
   Users, Add Users, choose, add, Done, Remove, back).
5. **Tables are plain tables.** React's user-group and API-key tables were
   react-aria `Table`s (`role="grid"`: one Tab stop, rows and cells reached with
   the arrow keys); the Vue ones are `<table>`s with the same `aria-label`,
   header cells, classes and rows, as the Members tab's always was. Each button
   in them is now its own Tab stop. Invisible to a pointer user; the same trade
   as the notification tray's list (#83, ruling 6).
6. **Queries keep React's keys and options**: `listUserGroups` and `listApiKeys`
   stale at once and persisted; `listUsers` fresh for good (React's
   `STALE_TIME_MAP`) where the user groups and the activity log read it, a
   minute on the Members tab as before; the activity log's pages under
   `[…, 'getLogEvents', filters, { infinite: true }]`, fresh for a minute and
   not persisted; `listExecutionsSummary` by month, the same. The user groups
   ask for the members only once there is a group, as React's rows did.
7. **Confirmations go on the modal stack** (`useModals().ask` with
   `ConfirmDeleteModal`). Deleting a group and removing a member from one close
   the confirmation at once and run the mutation behind it, as React's
   `unsetModal()` before `await` did; deleting an API key waits for the
   deletion, with the button loading, as React's awaited `onConfirm` did. A new
   key's secret opens in `ApiKeyDialog.vue` on the stack, where React used
   `setModal`, once the "New API Key" popover has closed.
8. **Two primitives grew a prop.** `DatePicker.vue` takes `maxValue` (the
   activity log's dates stop at today, later days disabled in the calendar, as
   React's did), and `PaywallDialogButton.vue` passes its default slot on as the
   button's label ("New User Group" at the team plan's limit).
9. **Primitive fixes, found by comparing screenshots.** These tabs are the first
   Vue screens to use a date picker, an empty combo box, and a confirmation
   opened from a menu item:
   - `DatePicker.vue`: the calendar opens below the field's start (react-aria's
     trigger was the whole field), not centred on the chevron; its weekday
     headers are screen-reader only, since React's header cells rendered no text
     (Vue's squashed seven letters into one cell's width and pushed the first
     column right); and it ends with React's empty error text, 4px. Measured
     afterwards: the same box and grid, to the pixel.
   - `ComboBox.vue`: with no items it opens no list; it showed an empty strip
     ("Add Users" when every member is in the group).
   - `DropdownMenu.vue`: closing, it leaves the focus in a dialog an item
     opened. It took the focus back to its trigger, the confirmation's trap
     pulled it in again without the focus ring, and "Delete" showed its resting
     colour where React's showed its focused one. The dialog still returns focus
     to the trigger when it closes.
   - The user groups' row menu opens below the chevron's start, 8px off, where
     react-aria's `Menu.Trigger` put it (#89's version menu is centred because
     React's passed `bottom`).
10. **React quirks kept.** The activity log asks for its next page whenever the
    list does not fill its view, and its pages never run out (React's
    `getNextPageParam` always returns one), so a short log is asked for again
    and again: measured on the mocked backend, about 150 requests in 3 s on the
    base and about 370 on the branch (the Vue list re-renders faster). It is the
    same loop, and worth an issue of its own. Sorting by timestamp applies the
    direction to one operand only; a picked day filters from that day's local
    midnight (React called `toDate()` on a `CalendarDate`, which falls back to
    the local time zone).
11. **One keyboard difference, left to the shared primitives.** In "Add Users",
    Escape with the combo box's list open closes the list; React's closed the
    whole popover at once. Pressed again, it closes the popover, but only once
    the list's exit animation has ended (about 150 ms): Reka's list keeps its
    dismissable layer until then. Changing it means changing the shared
    `ComboBox` and `Popover` for every caller.
12. **What a user notices: nothing.** 26 screenshots of every state (each tab,
    the popovers, menus, confirmations, the paywall at the limit and its dialog,
    the new key's secret, the empty states, the Usage paywall on the free plan)
    were compared with the base on a mocked team-plan account: the differences
    left are the drive's clock column behind the page, the activity log's
    loading row (ruling 10), a half-pixel shift of the combo box's list, and a
    1px shift of a tooltip. No changelog entry: the PR takes
    `CI: No changelog needed`.

## Rulings from #92 (the drive's asset modals, 2026-10-03)

#92 ports the modals the drive opens. Delegated like the rulings above:
provisionally accepted, for the maintainer to review.

1. **Split: the simple modals first, the rest in #198.** This PR ports the
   duplicate-name dialog (`DuplicateAssetsModal`, which #192's move mutation
   needs), the secret dialog, the drive's delete confirmations and the drag
   preview. #198 takes the labels popover (`ManageLabelsModal`, with
   `ColorPicker`), the credential forms (`CreateCredentialModal` and
   `data/serviceCredentials/`) and the datalink dialog with `JSONSchemaInput`
   and `FilePathInput`. Each of those is a large piece of its own: the labels
   popover is anchored to a React row and nests two popovers and a confirmation;
   the datalink editor is recursive and schema-driven and shares
   `reactDatalinkInput.ts` with #190's Properties tab, so it belongs on top of
   #190.
2. **Where the code goes.** The duplicate-name dialog, the drag preview and the
   asset summary and icon they show are shared code, `src/components/Drive/`,
   not `src/dashboard/`: framework-free callers must open the dialog
   (`resolveDuplications`), today the React upload and paste hooks and after
   #192 the Vue mutations, which may not import `#/`. The secret dialog is cloud
   code, `src/cloud/credentials/UpsertSecretModal.vue`, around #82's form. The
   two listing query factories the dialog reads moved unchanged, with their
   keys, to framework-free `$/utils/driveQueries`, so the React drive and the
   dialog share the cached listings.
3. **React opens the Vue modals on the stack.** `setVueModal(C, props)`
   (`ModalProvider.tsx`) replaces the open modals, as `setModal` did; the modal
   leaves the stack once it has closed, as #156 ruled for asked modals (ruling 5
   there). A button that was a react-aria `Dialog.Trigger` (the toolbar's New
   Secret and Clear Trash) opens its modal with `useVueModalTrigger`
   (`hooks/vueModalHooks.ts`), which keeps the `aria-expanded` react-aria gave
   it. react-aria's `aria-haspopup` never reached the dashboard's `Button`
   (measured on the base), so there is none to keep. The delete confirmations
   use #156's `ConfirmDeleteModal.vue`; the React one stays for the settings and
   the labels popover.
4. **The duplicate-name form keeps its values in an array.** React keyed them by
   asset id, and a local asset's id is an encoded path whose dots read as nested
   fields; the entries are `entries.N` now. Invisible.
5. **Three React quirks are kept**, each a visible change to fix, so they are
   listed in #198 instead:
   - "Change" keeps the choice: React reset the field to its current value.
   - "Skip the rest" does nothing: it skips the entries whose conclusion is
     unset, and none ever is.
   - Skip All changes what Apply submits (every asset is skipped, as before) but
     not what the entries show, because React's entries did not re-render when
     only their conclusion changed. The Vue entries show their last own choice.
6. **What a keyboard or screen-reader user notices.** The duplicate-name dialog
   focuses itself as it opens (React's left the focus on the Import button
   outside the modal, so Tab first walked the page beneath), and every dialog
   here is named by its title (#156, ruling 11). A dialog leaves after its exit
   animation (#156, ruling 3), about 200ms after React's did.
7. **Escape and the dashboard's global binding.** The React dashboard binds
   Escape on `document.body` to `closeModal`, which closes every modal.
   react-aria's dialogs and popovers stopped the key before it got there; Reka
   listens on the document, after it. So, on the page, Escape in a Vue stack
   modal is first a `closeAll`: the modal leaves the stack without being
   answered. The duplicate-name dialog therefore reports a cancellation whenever
   it leaves the stack unanswered (as Escape did in React), and its rename form
   stops Escape itself and closes only itself: without that, Escape there closed
   the whole dialog and left the upload waiting forever (found in a keyboard
   pass against the base). Any Vue popover inside a Vue stack modal needs the
   same until the binding goes (#170) or `Popover.vue` stops the key as
   react-aria did; #198's labels popover is the next one.
8. **The React `UpsertSecretModal.tsx` keeps only its form**, for the React
   asset panel (`AssetProperties.tsx`) and the form's parity test; #190 deletes
   the panel, and the file goes with the next PR after both have landed.
9. **A porter's trap: branded ids as props.** A prop typed with one of the
   backend's ids (`DirectoryId`, `SecretId`) is a `Newtype` that Vue's prop
   check sees as an `Object`, and it warns at run time when given the string.
   Such a prop is declared `DirectoryId & string`.
10. **No changelog entry.** Nothing changes for a mouse user, so the PR takes
    `CI: No changelog needed`.

## Rulings from #192 (the drive's queries and mutations, 2026-10-03)

#192 is the second half of #90: the drive's data layer. Delegated like the
rulings above: provisionally accepted, for the maintainer to review. The ruling
on #192 itself (a comment there) settled the main question: where React and Vue
gave the same query key different options, the React drive's options win, and
each key's options are defined once, in framework-free factories.

1. **One PR, not split.** The factories, the batched mutations, the transfer
   between categories and the uploads depend on each other (the transfer runs
   the batched mutations and the upload to the cloud), and the React drive hooks
   left over are adapters; the work is in reviewable commits instead.
2. **The options live in `$/utils/backendQuery`**, typed with
   `@tanstack/query-core`, and both frameworks consume the same objects:
   `backendQueryOptions(backend, method, args, extra?)` and
   `backendMutationOptions(backend, method, extra?)`, with every per-method
   default (`STALE_TIME_MAP`, `PERSISTENCE_MAP`, `INVALIDATION_MAP`) read
   through `backendQueryDefaults`. The Vue `@/composables/backend` keeps its
   reactive signature (arguments as a getter, the query disabled while they are
   `undefined`) and builds on the same defaults. A caller's extra options are
   limited to those whose types React and vue-query agree on (`enabled` as a
   boolean, numeric `staleTime`, `gcTime`, `refetchInterval`, `retry`, `meta`):
   vue-query reads a function-valued option as a getter, where React passes it
   the query. `executeMutation(queryClient, options, variables)` runs a mutation
   through the mutation cache from outside any component, as React's
   `useMutationCallback` did, so `useMutationState` still sees it.
3. **Per-key options, and what changes.** Six keys differed. All now have the
   React drive's options:

   | Key                           | Before: React / Vue       | Now           | Effect                                                                                                                                                                                                                                                                                                                                                                 |
   | ----------------------------- | ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `getFileDetails`              | persisted / not           | persisted     | None today: nothing queries it through the factories (the asset preview, `AssetContentsEditor.vue`, has its own key and options).                                                                                                                                                                                                                                      |
   | `searchDirectory`, `listTags` | not persisted / persisted | not persisted | None: only React queries them.                                                                                                                                                                                                                                                                                                                                         |
   | `listUsers`                   | stale time ∞ / 0          | ∞             | None: only React queries it.                                                                                                                                                                                                                                                                                                                                           |
   | `getOrganization`, `usersMe`  | stale time ∞ / 0          | 5 minutes     | **The maintainer's choice, not React's** (ruling 4). `AppContainerLayout.vue` (the trial-ended and organization-setup modals), `TrialProgress.vue`, `SettingsPage.vue`, the file browser widget and `ProfilePictureInput.vue` no longer refetch on every mount, only once the cached value is five minutes old; the React drive now refetches too, where it never did. |

   Mutations follow React's semantics too: a caller's `meta.invalidates` is
   added to the method's (Vue replaced them), and the network mode is the
   backend's whatever the caller passes. No Vue caller passed either, so nothing
   changes. `listDirectory` (stale time 0, not persisted) and `getAssetDetails`
   (not persisted) were already the same on both sides.

4. **The organization and the user stay fresh for five minutes** (the
   maintainer's choice on #201, option B). The React drive's ∞ would have ended
   the Vue screens' refetch on mount, which is what picked up a subscription
   changed elsewhere (a trial that ended while the app was closed, a plan bought
   on another device); Vue's 0 refetched on every mount. `getOrganization` and
   `usersMe` now get `ACCOUNT_STALE_TIME_MS` (5 minutes) in `STALE_TIME_MAP`, on
   both sides. It differs from both old behaviours: unlike React's ∞, a value
   older than five minutes is refetched when a screen mounts or the window
   regains focus, so an outside change shows within minutes; unlike Vue's 0,
   mounting a screen within five minutes of the last fetch uses the cache
   without a request. Persistence and the mutations' invalidations are
   unchanged, so an edit in the app still refetches at once, and a persisted
   value restored on start-up older than five minutes is refetched as soon as it
   is read. A unit test pins the value.
5. **The batched mutations are framework-free**, in `$/utils/driveMutations`
   (delete, restore, copy, move, download), with their keys and invalidations
   unchanged. The move asks how to resolve name conflicts through an injected
   `DuplicationResolver`; callers pass `resolveDuplications`
   (`$/components/Drive/duplicateAssets`, #92), and tests pass a stub.
   `#/hooks/backendBatchedHooks` keeps only the React drive's
   `use*MutationState` adapters. Dead code went with the move: the copy's
   mutation-state hook, `useRemoveSelfPermissionMutation`,
   `getProjectExecutionDetailsQueryOptions` and `UserGroupInfoWithUsers` had no
   callers.
6. **Transferring between categories** is `$/utils/transferBetweenCategories`,
   with its context injected (backends, the user's root, the categories store,
   the query client, the duplicate resolver, the "copy instead" question, the
   upload to the cloud, the toast). `CategoryButton.vue` calls the Vue
   composable, `$/composables/transferBetweenCategories`; the React drive's
   paste and "download to local" call the React adapter. `$/providers/reactApi`
   is deleted, and `AppContainer.vue` has no React props left.
7. **The "copy instead" question is Vue, from both frameworks:**
   `CopyInsteadModal.vue` in `$/components/Drive/`, asked with
   `askToCopyInstead`, with React's title, text, alert, icon and buttons. Like
   the React `ask` it replaces, it closes the open modals first. As with #156's
   `ConfirmDeleteModal` (ruling 11 there) it is named by its title, keeps Tab
   inside, and leaves after its exit animation. **Cancel does nothing** (#200,
   at the maintainer's request on #201): React went on to attempt the move after
   a cancelled question between two teams' folders, or from a team's folder to
   the user's, which the backend then refused or carried out. Now nothing is
   sent and nothing changes; unit tests and
   `integration-test/dashboard/copyInstead.spec.ts` check it, the spec against
   the requests the mocked cloud receives. A bug fix, so no changelog entry.
8. **Toasts: `promise` moved into the store.** The transfer shows the download
   to the local drive as a loading toast that turns into its outcome, as
   react-toastify's `toast.promise` did; `useToasts().promise` now does that,
   and the React shim's `toast.promise` forwards to it.
9. **Uploads.** `uploadFiles` (the drive's upload of picked or dropped files, on
   either backend) moved into `$/providers/upload`, beside the uploads store it
   drives. The upload of local projects to the cloud is cloud-only, so it is
   `src/cloud/uploadToCloud.ts`: a top-level helper, not an area, because the
   core's transfer calls it. `#/hooks/backendUploadFilesHooks` keeps only React
   adapters.
10. **Cloud-only queries are under `src/cloud/`:** a project's scheduled
    executions in `versions/schedule.ts` (`projectExecutionsQueryOptions`, for
    #183's Schedule tab), and the subscription price with the plans' constants
    in `billing/` (`subscriptionPrice.ts`, `plans.ts`), which the React plan
    selector imports. The organization's queries have no factories of their own:
    they are the generic `getOrganization` and `listUsers`, whose options are
    the shared table's, and the core reads the organization too.
11. **The download directory is the Vue store's.** The React
    `useDownloadDirectory` had its own suspending query of
    `/api/download-directory-path`, which `entrypoint.ts` already fetches at
    start-up for `useLocalPaths`. React now reads `useLocalPaths` through a
    context, and the second request and the suspension are gone.
12. **What stays React, for #91.** The adapters above, and the React-only drive
    hooks with no data of their own (`cutAndPasteHooks`, `copyHooks`,
    `dragAndDropHooks`, `dragDelayHooks`, `assetsTableItemsHooks`,
    `directoryIdsHooks`), say so in their file comments; each goes when the Vue
    drive replaces its caller. The Vue drive's hooks (mutation state, new folder
    and project, rename, upload) come with their first Vue caller, in #91: until
    then they would be dead code, and vue-query consumes the factories directly.
13. **No changelog entry.** The only change on screen is the "copy instead"
    dialog being the Vue `AlertDialog` (ruling 7), which #156 compared class for
    class with React's; the PR takes `CI: No changelog needed`.

## Rulings from #91 (the drive table, drive bar and asset search, 2026-10-04)

#91 ports the drive itself. Delegated like the rulings above: provisionally
accepted, for the maintainer to review.

1. **One PR, the table first.** The table, its rows and cells, the context
   menus, the drive bar and the search bar share one view state (the location
   being shown, the listing, the selection), so the slices of the ticket would
   each have needed the reverse bridge (`vueComponent`) both ways. The work is
   in reviewable commits instead: the shared primitives, the Vue drive, the
   React deletions, the tests. `LeftPanel.vue` mounts `DriveView.vue` directly
   and imports no React; `reactTabs.ts` is gone.
2. **A faithful port, not a redesign.** React had no `treegrid` role, no roving
   tabindex and no ARIA drag and drop: the table is a `<table>` whose rows carry
   `aria-selected`, its keyboard model is the hand-rolled one of
   `AssetsTable.tsx` (arrows, Shift and Ctrl ranges, Ctrl+Space, Enter,
   bindings), and its drag and drop was already native HTML5 events. All three
   are ported as they were; the ticket's richer accessibility (a `treegrid`,
   drag and drop announcements) is a follow-up, so that this PR changes nothing
   a user can see or a spec can tell. The table stays paged, not virtualised.
3. **React's navigation transition is emulated, not dropped.** React switched
   category and directory inside `startTransition`, so the old listing stayed on
   screen, the pressed control showed a spinner, and the page objects wait for
   that (`drive-view`'s `data-category`). `layouts/Drive/driveView.ts` keeps a
   _target_ location and a _shown_ one: the shown one moves only when the
   target's directory details (and, in the trash, its listing) have loaded.
   `navigate(source, change)` records which control started it, for its spinner,
   and the drive location's `isNavigating` is fed from it. `providers/drive`
   lost the React-only `setNavigationTransition`.
4. **The context menu keeps React's DOM**, not the shared Reka
   `$/components/Menu/ContextMenu.vue` (a `menu` of `menuitem`s, which takes
   focus): a non-modal popover with the `context-menu` test id, a `dialog` named
   by its label, `MenuEntry.vue` buttons, no focus taken on opening. It closes
   on Escape, a press outside, a right-click elsewhere, and a scroll outside —
   the last only once it has been open for two frames, since the focus a
   right-click gives a row scrolls the table a pixel on the next frame, which
   React's menu, mounted in a transition, never saw.
5. **react-aria's press semantics are kept where the specs depend on them.**
   `usePress` stopped a press propagating, so a button in a row never selected
   the row; Vue's buttons do not, so buttons in rows and headings bind
   `STOP_PRESS_PROPAGATION` (`layouts/Drive/pressPropagation.ts`). Likewise
   react-aria's interact-outside (a press that starts _and_ ends outside) is
   what closes the rename form and the context menu.
6. **React's quirks are kept, each noted where it lives:** Ctrl+Space toggles
   against the selection as it was at the key press; the search bar focuses the
   highlighted suggestion, restores its value on focus and shows suggestions a
   tick late; the path column sets the directory and then the category (which
   resets it); the rename form checks `min(1)` before `trim()`, so whitespace
   alone is accepted. Each is pinned by a probe against the base or a unit test.
7. **What was dead in React is not ported.** The labels column's overflow ("show
   all labels") never appeared: its measurement never ran. It is left out, and a
   follow-up restores it on purpose if wanted. The edit button keeps a generated
   id (no name), as React's did, so the axe baseline is unchanged.
8. **The labels, credential and datalink dialogs stay React (#198)**, opened
   from Vue through `openReactModal` (`ModalProvider.tsx`), which puts a React
   element on the modal stack and takes it off when the dialog closes itself.
   `layouts/Drive/reactModals.tsx` is the one place that does it, and goes when
   #198 lands. `setVueModal` had no caller left and is gone.
9. **Shared primitives, additively.** `EditableSpan/` and `SelectionBrush/` are
   new in `src/components/`; `Breadcrumbs/` gains `isLoading`, `onPress`,
   `onDragDelay` and a focusable `role="link"` container; `MenuEntry` a
   `tooltip`; `Input` an `error` override; `useMenuEntries` an optional target
   element. No existing caller changes.
10. **Paging stops at the end.** React's effect fetching the next page while the
    table was not full re-ran harmlessly; the same loop in Vue's microtasks hung
    the page on a short directory, so it is guarded by `hasNextPage`.
11. **Tests.** The specs pass unedited; only a page object's comment changed.
    Unit tests pin what react-aria gave the primitives (the rename form, the
    context menu, the breadcrumbs). The table's keyboard model, drag and drop
    and rubber band need layout and pointer capture, which jsdom lacks, so the
    Playwright specs and the probes against the base cover them.
12. **No changelog entry**: nothing a user can see changed; the PR takes
    `CI: No changelog needed`.

## Rulings from #172 (the Enso devtools, 2026-10-03)

#172 ports the Enso devtools that `ProtectedLayout.vue` mounted through
`reactComponent`, and settles whether the React query devtools panel stays.
Delegated like the rulings above: provisionally accepted, for the maintainer to
review.

1. **The query devtools panel is dropped, not ported.** The React panel
   (`@tanstack/react-query-devtools`, behind `showDevtools`, which only
   `IS_DEV_MODE` ever set) showed the one `QueryClient`, which is Vue's.
   `vite-plugin-vue-devtools` already shows that client in development builds:
   `entrypoint.ts` installs vue-query with `enableDevtoolsV6Plugin: true`, and
   the running dev build registers its "vue-query" plugin with the Vue DevTools
   (checked in WSL, beside the router's and the widget registry's). One
   inspector, in the place the rest of the app's state already is, with no new
   dependency: `@tanstack/vue-query-devtools` is not added. The store's
   `showDevtools` and the dialogs' `.tsqd-parent-container` exemption went with
   the panel. `@tanstack/react-query-devtools` itself stays in `package.json`
   until #94 removes the React packages.
2. **Everything else is kept** (decision 7): the plan override, the version
   checker switch, every feature flag, the paywall toggles, the local storage
   viewer and editor, "Clear cache and reload", and the overrides list with its
   resets. Same sections, order, texts and classes.
3. **Where it went: `src/cloud/devtools/`** (decision 6b's list):
   `EnsoDevtools.vue` (the mount), `DevtoolsPanel.vue` (the button and popover),
   `EnsoDevStatus.vue` (the overrides list) and `LocalStorageSection.vue`.
   `devtools` joins `CLOUD_AREAS`. The core reaches it through one more layout
   contribution, `contributeDevtools` in `$/providers/layoutContributions`;
   `ProtectedLayout.vue` renders what was contributed, while signed in, as
   before, and neither layout calls `reactComponent` any more. A build without
   the cloud has no devtools; the panel is mostly about the cloud (plan,
   paywall), and its feature flags can still be set through
   `window.setFeatureFlags`.
4. **Development builds only, decided at build time.** `registerCloud` calls
   `registerDevtools()` under `process.env.NODE_ENV === 'development'`, spelled
   out rather than `IS_DEV_MODE`, so that Vite replaces it with `false` in that
   module and Rollup drops the call, the import and the lazily loaded chunk.
   Measured with `corepack pnpm run build` (WSL, develop against the branch): no
   devtools code in any production chunk (searched for the panel's literal
   strings and component names), and four chunks fewer. Develop shipped the
   React query devtools' lazily loaded production bundle and its dependencies
   though nothing ever rendered them: all JavaScript shrinks by 261 KiB (78 KiB
   gzip).
5. **The panel scrolls, as React's did.** react-aria limits a popover to the
   space the window leaves; Reka's grows with its content, which pushed the
   panel's top off screen. The panel's popover is capped at Reka's
   `--reka-popover-content-available-height` and scrolls.
6. **Small differences, none visible to users** (the panel is never in a
   production build): an emptied number field no longer writes `NaN` to its flag
   (a value is written only once the flag's schema accepts it); the feature
   flags form is no longer nested inside the "Feature Flags" heading's `span`;
   the popover is named "Enso Devtools"; "Excecution" is spelled right; the edit
   dialog writes through `setFromUntrustedSource`, so the key's schema checks
   the value twice.
7. **Tests:** `cloud/devtools/__tests__/EnsoDevtools.test.ts` opens the panel
   from the keyboard, closes it with Escape (focus back on the button), and
   drives each section: a feature flag and its reset in the overrides list, a
   number flag, the plan override and its reset, the plan section's absence when
   signed out, the version checker, a paywall toggle against
   `useIsFeatureUnderPaywall`, "Hide Devtools", "Clear cache and reload", and
   editing (with a schema error) and deleting a local storage entry.
   `registerCloud.test.ts` pins that the devtools are contributed in development
   only, and `ProtectedLayout.test.ts` that they show only while signed in.
8. **No changelog entry**: a development-only tool, invisible to users; the PR
   takes `CI: No changelog needed`.

## Rulings from #88 (billing, plans and the paywall, 2026-10-03)

#88 ports the rest of billing: the Billing & Plans settings tab, the
subscription page with its plan cards and dialogs, the Stripe checkout, the
payments success page, and the last React paywall component. Delegated like the
rulings above: provisionally accepted, for the maintainer to review.

1. **Port, not delete, in one PR.** Decision 7 keeps billing, so the ticket's
   "remove" option is closed. The whole is about 1,500 lines of React and 1,000
   of Vue behind three mount sites (two routes and a settings tab) that share
   the plan model; split, the checkout would have been reviewed without the page
   that starts it. The trial and downgrade dialogs were already Vue (#84), as
   were the paywall pieces the settings tabs show (#87) and the top bar's
   billing parts (#83).
2. **Where it went.** `src/cloud/billing/`: the tab's section
   (`BillingSettingsSection.vue`), the plans (`plans.ts`), their price
   (`subscriptionPrice.ts`) and the pending checkout (`pendingCheckout.ts`);
   `src/cloud/billing/subscribe/`: the subscription page, the cards
   (`PlanCard.vue`, React's `Card`, renamed for
   `vue/multi-word-component-names`), the Solo confirmation and the plan dialog
   (`SubscribeButton.vue`, `PlanSelectorDialog.vue`, `SubscriptionSummary.vue`,
   the dialog's `Summary`), the checkout (`checkout.ts`) and the payments
   success page. `plans.ts` and `subscriptionPrice.ts` are byte for byte #192's
   (#201), so the two PRs merge cleanly whichever lands first.
3. **Routes are the cloud's.** `registerBillingRoutes` adds `/subscribe` under
   the main app's layout, now a named route (`APP_CONTAINER_LAYOUT_ROUTE`,
   `$/router/routeNames`), and `/payments/success` at the top level, where the
   React routes were, with the same paths and access. A build without the cloud
   has neither: both paths then fall to the catch-all and land on the dashboard,
   as a link to them should.
4. **Billing & Plans is declared by the core and filled by the cloud,** like
   #87's tabs: `tabs.ts` keeps its name, icon, place and visibility (an
   organization admin whose organization has a subscription), and
   `registerBillingSettings` contributes its section. `ReactSettingsTab`, the
   React tab data and the React settings shell (`Tab`, `Section`, `Entry`,
   `CustomEntry`) are deleted: nothing else used them. The settings page has one
   kind of tab again.
5. **The checkout is unchanged, request for request.** Measured by recording
   every request, every `window.open` call, every popup and every navigation in
   the running app, on develop and on the branch, for the Team checkout (three
   seats), the Solo checkout, the customer portal and the paywall dialog: the
   logs are identical. The same `POST payments/checkout/sessions` with
   `{ price, quantity, interval }`; the same
   `POST payments/customer-portal-sessions/create?ignored=` with a `null` body;
   Stripe opened with `window.open(url, '_blank')` (the desktop app hands it to
   the system browser), then focused; the same pending plan in local storage,
   and the same move to `/payments/success`. Both run as vue-query mutations, as
   React's did, so the cache's global handlers (the unauthorized-session
   recovery) still see them; the portal's keeps its key,
   `['billing', 'customerPortalSession']`.
6. **The last React paywall component goes.** The React menus' `MenuEntry.tsx`
   opened the React `PaywallDialog` with `setModal` for a paywalled entry
   ("Upload To Cloud" on the free plan). It now opens the Vue one on the modal
   stack (`PaywallModal.vue`), replacing every open modal as `setModal` did;
   like every Vue-opened modal, it leaves the stack when it closes (#156, ruling
   5). `#/components/Paywall` is deleted.
7. **One React quirk kept: no `*` on Seats.** React passed `isRequired`, but its
   field let the schema's reading (not required) win, so the label had no
   asterisk; the Vue input leaves `isRequired` out, so it looks the same. The
   React input also leaked a `label` attribute onto the `<input>` and set
   `aria-invalid="false"`; the Vue one has neither, which changes nothing a
   screen reader announces (the accessibility trees are identical).
8. **A failed price would show the error display** (`ErrorDisplay.vue`), as
   React's `Summary` did. The price is computed locally, so it never fails; the
   path is kept for parity rather than tested.
9. **What a user notices: nothing.** Every state was compared with develop's in
   the running app: the subscription page on each plan (free, Solo, Team,
   enterprise) and for a member who is not the admin, the Solo confirmation, the
   Team dialog with one, three and eleven seats (the limit's error), the `plan`
   parameter opening a dialog, the payments success page, the Billing tab and
   its failure toast, and the paywall dialog from a menu. The page, its cards
   and every state outside a dialog match to the pixel; inside the plan dialog
   some text rasterizes a pixel apart while every box measures the same (the
   shared `Dialog` motion, as in #84, ruling 7). The accessibility trees differ
   only as in #84: the dialogs are named by their titles, and react-aria's
   live-region `log`s are gone. A new Playwright spec, `billing.spec.ts`, drives
   both checkouts, the portal and the paywall dialog against the mocked cloud
   (which gains the payments configuration and the customer portal), and passes
   on develop and on the branch. No changelog entry: the PR takes
   `CI: No changelog needed`.

## Rulings from #198 (the drive's labels popover, credentials and datalink dialog, 2026-10-04)

#198 is #92's second part: the labels popover (`ManageLabelsModal`, with
`ColorPicker`), the "New Credential" dialog and its forms, and the "Create
Datalink" dialog with the datalink editor (`JSONSchemaInput`, `FilePathInput`).
Delegated like the rulings above: provisionally accepted, for the maintainer to
review.

1. **One PR, in logical commits.** The three pieces share the React drive's
   mount sites (the toolbar, the context menus) and two primitive fixes; with
   them no drive code calls `setModal` with a React element any more (#92's
   first acceptance criterion). The React `UpsertSecretModal.tsx` (its form
   only, kept for the React asset panel that #190 deleted) and its parity test
   go too, as do `data/serviceCredentials/` and every React file the three
   replaced.
2. **Where the code goes.** All three are cloud-only: `src/cloud/labels/`,
   `src/cloud/credentials/` (beside the secret dialog) and
   `src/cloud/datalinks/` (the editor, its form field and the dialog). The
   Properties tab's datalink form now uses `datalinks/DatalinkFormInput.vue`, so
   `properties/reactDatalinkInput.ts` and its `DASHBOARD_IMPORT_ALLOWLIST` entry
   are gone: nothing in `src/cloud/` imports `#/`. `labels` and `datalinks` join
   `CLOUD_AREAS` (only the exempt React dashboard imports them); `credentials`
   stays out, as the core's `UpsertSecretPanel.vue` imports it (#82, ruling 7).
3. **A popover on the modal stack, anchored to what React rendered.**
   `Popover.vue` gains an `anchor` (Reka's `PopoverAnchor` with a `reference`:
   an element it does not render, React's `triggerRef`), an `opener` (where
   focus returns when it has no trigger; by default the element focused as it
   opened, as react-aria's focus scope restores it) and a `closed` event (after
   the exit animation, as `Dialog`'s). The labels column's two edit buttons were
   `Dialog.Trigger`s: they open the popover with `useVueModalTrigger`, anchored
   to the pressed button (`aria-expanded` kept, #92 ruling 3). The context
   menu's "Label" uses `setVueModal`.
4. **The Escape gap, fixed where it is contained.** The labels popover and its
   nested "Create Label" form each stop Escape and close themselves, as #92's
   rename form does (ruling 7 there), so Escape closes the innermost one only
   and never reaches the dashboard's global binding. `Popover.vue` itself does
   not stop the key: a popover holding a combo box or a dropdown would then
   close before the list (#191, ruling 11, pins today's order), which is a
   change for every caller. A confirmation asked over the popover is a stack
   `AlertDialog`: Escape there still reaches the binding and closes both, as
   React's `setModal` path did.
5. **Seven React quirks are kept**, each a visible change to fix, listed for a
   separate decision (with #92's three in #198):
   - the popover opened from the context menu sits at the window's top-left
     corner: React anchored it to the row through a ref that is cleared as the
     menu closes. The Vue one is anchored to that corner on purpose
     (`anchor: null`);
   - the "Next color" swatch beside "Create <search>" does nothing visible: it
     set the colour on the popover's form, not its own, so the label is created
     in the least used colour;
   - Enter in the search field submits the popover's form, which resets it: the
     search clears and the checks go back to what the assets had when it opened;
   - the label pills show every label, checked or not;
   - the labels written to an asset are computed from what it had when the
     popover opened, so creating two labels in a row keeps only the second;
   - the datalink editor shows an invalid secret's description twice;
   - its `boolean` case is a plain checkbox (React's was a form field named
     `input` whose state replaced the value given; no datalink schema reaches
     it, as every boolean there is a `const`).
6. **What changes for assistive technology.** react-aria's `TagGroup` (a `grid`
   of focusable rows) is a `list` of `listitem`s (decision 1): nothing acts on a
   pill, so each was a Tab stop for nothing. The popover traps focus, as #83
   ruled for `Popover.vue` (React's let Tab walk out to the page). The dialogs
   are named by their titles (#156, ruling 11). Each credential checkbox is
   named by its own text: `CheckboxControl.vue` now sets `aria-labelledby` on
   its input, because inside a labelled `CheckboxGroup` the field's `<label>`
   also labelled the first checkbox, naming it "Scopes Sheets Analytics" (React
   named it "Sheets"; its group was named by the whole text through a duplicated
   id, and the Vue group keeps "Scopes").
7. **Two more primitive fixes, found by comparing the running app.**
   - `Tooltip.vue` opens on focus only when the keyboard put the focus there
     (`$/utils/inputModality`, react-aria's `useFocusVisible` modality): a
     confirmation cancelled with the mouse returns focus to the trash button,
     and the Vue tooltip "Delete" opened there, where React's did not.
     `:focus-visible` (Reka's `ignoreNonKeyboardFocus`) could not do it: a text
     field matches it on every focus, and jsdom does not support it.
   - `Dropdown.vue`'s list root is `contents`, so that the grid row's item is
     the list itself (`overflow-auto`), as React's was. With the root as the
     item (#183's `min-h-0`), the closed list overflowed it; the field geometry
     was the same, but nested lists at fractional positions painted differently.
     Deleting a label removes the button that asked; focus then goes to the
     search field, as React's focus scope moved it.
8. **The datalink editor is one recursive component.** `JSONSchemaInput.vue`
   keeps React's structure part for part (a lone part unwrapped, several in a
   `flex flex-col gap-1` column), its classes, react-aria's keyboard-only focus
   ring (`focusRing.ts`) and React's choice of the `anyOf` member that the value
   matches. `FilePathInput.vue` mounts the project view's
   `FileBrowserWidget.vue` directly, where React crossed the bridge. The secrets
   query keeps React's key and options.
9. **Credential forms as React had them**: every text field has a `''` default
   (the playbook's rule), the Microsoft 365 name defaults to "Microsoft365", the
   Google form shows a failure under the form while the others toast it, and the
   list is in React's order (`credentialInfos.ts`).
10. **What a user notices: nothing.** Every state (the popover from the menu and
    from the column, search, no match, the swatch, hover, a toggled label,
    "Create Label" with a colour and its error, Escape in each, the delete
    question, creating and deleting; each credential form, its errors, the type
    list, a permission's description; the datalink dialog with each type, the
    type list, invalid values, a secret, an optional property, the file path
    with its file browser; the Properties tab's editor) was compared with
    develop's. The differences left are antialiasing, a sub-pixel shift of the
    popover's text where Reka centres it on the edit button, and the dropdown
    fields of the two dialogs, rasterized a pixel apart until the compositing
    layer of the dialog's enter animation is re-created (#84, ruling 7): the
    geometry and computed styles are the same, and the datalink dialog's fields,
    measured, are pixel-identical once the layer is re-created. No changelog
    entry: the PR takes `CI: No changelog needed`.

## Rulings from #207 (the React quirks the ports kept, 2026-10-08)

#207 decides the React behaviour that #92, #191 and #198 ported unchanged and
listed for a separate decision. Delegated like the rulings above: provisionally
accepted, for the maintainer to review.

1. **The labels popover from the context menu opens under the row**, at its
   start (by the asset's name: the row is as wide as the table), and focus
   returns to the row. React meant to anchor it to the row; its ref was cleared
   as the menu closed. Used as a shortcut or from the command palette, the entry
   finds the row by the asset's id; with no row shown, the popover still falls
   back to the window's top-left corner.
2. **"Next color" moves the swatch to the next colour**, and "Create <search>"
   creates the label in it (it set the colour on the popover's form, not its
   own).
3. **Enter in the popover's search field does nothing**
   (`resetOnSubmit: false`): the form only holds the popover's state, and its
   reset cleared the search and put the checks back to what the assets had when
   it opened.
4. **The pills show the labels the assets have** (every, or some, of them), as
   their name, "Selected labels", says; with none, the strip is not shown.
5. **Each change writes the labels as the popover last wrote them**, not as the
   asset had them when it opened, so two labels created in a row both stay.
6. **An invalid secret's description shows once** in the datalink editor.
7. **The datalink editor's `boolean` case stays a plain checkbox.** It works (it
   reports its value), and no datalink schema reaches it; React's form-field
   version was the odd one. Nothing to fix.
8. **The duplicate-name dialog**: "Change" puts an entry back to undecided (and
   a rename back to the suggested name), offering Skip, Replace and Rename
   again; "Skip the rest" skips the entries still undecided and keeps the
   others' choice; Skip All shows every entry as skipped.
9. **A press on a modal's backdrop keeps focus inside it.** `Dialog.vue` and
   `AlertDialog.vue` prevent the `mousedown` default on the overlay outside the
   dialog (`keepFocusOnBackdropPress`, `focusReturn.ts`), so a dialog that stays
   open (not dismissable, or an alert) keeps its focus, as react-aria's modal
   did; a dismissable one still closes and returns focus to its opener.
10. **Escape in "Add Users" keeps closing the list first.** This is the WAI-ARIA
    combobox pattern (Escape dismisses the listbox), what the Vue dropdown does
    and what #191's ruling 11 and #198's ruling 4 pin for every popover holding
    a list; React closing the whole popover at once was the quirk. What was
    wrong is the second Escape: pressed while the closed list was still fading
    out (about 150 ms), Reka's list was still the topmost dismissable layer and
    took the key for nothing. `ComboBox.vue` now closes the dialog or popover
    around it then (`onEscapeCapture`), so the second Escape always closes it.
11. **No changelog entry**: these are fixes, so the PR takes
    `CI: No changelog needed`.
