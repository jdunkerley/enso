# React → Vue: foundation decisions (#76)

**Date:** 2026-09-30 **Status:** Decisions 1–6b and 8 provisionally accepted
2026-09-30 under delegation (maintainer to review); 7 decided by the maintainer
**Epic:** #75 **Ticket:** #76

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
toasts.** The toasts look the same, so this is a faithful port with no visible
change. The `useToast` signature stays exactly as it is.

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
