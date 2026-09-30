# React → Vue: foundation decisions (#76)

**Date:** 2026-09-30 **Status:** Recommendations, for the maintainer's approval
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
- **Needs approval:** a recommendation. Nothing downstream should build on it
  until the maintainer says yes.

The spike in this PR (decision 1) is the only code. It adds no user-visible
change.

## Summary

| #   | Decision                   | Recommendation                                                                                                                                 | Status         |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Headless accessibility lib | **Reka UI 2.10.5**, exact pin. Hand-roll only what it lacks (tables, drag and drop, selection brush), as React does today                      | Needs approval |
| 2   | Forms                      | **In-house `useForm` over zod**, keeping today's `Form`/`Field`/`Submit`/`Reset`/`FormError`/`FieldValue` API. No vee-validate                 | Needs approval |
| 3   | Toasts                     | **In-house `useToast` store + one `ToastHost.vue` on Reka `Toast` primitives.** No vue-sonner                                                  | Needs approval |
| 4   | Modal stack                | **Global `{ component, props }` stack + one `ModalHost.vue`**, with a shim that keeps React `setModal`/`unsetModal` callers working            | Needs approval |
| 5   | Tailwind modifiers         | **No mapping plugin.** Use Tailwind's built-in `aria-*:` and `data-[…]:` variants in Vue code. Drop `tailwindcss-react-aria-components` in #94 | Needs approval |
| 6   | Where code goes            | Primitives in `src/components/`, features in `src/dashboard/` as `.vue`, stores via `createContextStore` (global state only where it must be)  | Needs approval |
| 6a  | zustand                    | **Keep until #93** as framework-neutral glue; no new zustand stores; replace with Vue state and `useStorage` when the last React reader goes   | Needs approval |
| 6b  | Cloud-only separability    | **`src/dashboard/cloud/<area>/`** behind a lint boundary and a contribution registry                                                           | Needs approval |
| 7   | Port or delete             | **Port every cloud-only area; delete none.** The fork diverges freely from upstream                                                            | Decided        |
| 8   | Port playbook              | Appended to `app/gui/src/dashboard/CLAUDE.md`                                                                                                  | Needs approval |

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
  own tests. Do it deliberately, with the Playwright specs, in #78.
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
  style it with `DIALOG_BACKGROUND` (`#/components/Dialog/variants.ts`) and
  `TEXT_STYLE` (`#/components/Text/variants.ts`). This is the same `variants.ts`
  reuse as `DashboardDialogContent.vue`.
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
  `variants.ts` next to it. While `#/components/*/variants.ts` still exist, the
  Vue variants import their building blocks, as
  `src/components/Menu/variants.ts` does. When the React component is deleted,
  its `variants.ts` moves over.
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

- **Directory.** Ported cloud-only areas go under
  **`src/dashboard/cloud/<area>/`**:
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
  `#/cloud/**` from anywhere outside `src/dashboard/cloud/`. Cloud code may
  import the core; the core never imports cloud code.
- **Contribution points** instead of imports. The core exposes small registries.
  `src/dashboard/cloud/index.ts` fills them at start-up, and it is the only file
  the app entry imports from `cloud/`:
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

## Open questions for the maintainer

1. **Approve decisions 1–6b and 8,** or redirect them. #78–#80 are blocked until
   then.
2. **The `@vueuse/core` duplicate:** add the `pnpm.overrides` dedupe in #78
   (after re-running the specs), or accept 2.7 KB until Reka moves to vueuse 15?
3. **Accessibility verification depth (epic question 10):** add an axe baseline
   plus accessibility-tree snapshots to the Playwright suite in #78, or rely on
   manual checks per port? The recommendation is axe on the ported areas only,
   so it grows with the port.
4. **Cloud boundary:** is `src/dashboard/cloud/` the split you want, or should
   cloud code sit outside `src/dashboard/` altogether (for example,
   `src/cloud/`), so that a community build can exclude it at the Vite level?
