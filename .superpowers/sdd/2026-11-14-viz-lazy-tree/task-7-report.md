# Task 7 report

Status: DONE (see commit on `viz/tree-gui`).

- Created `TreeRow.vue`, `JSONVisualization/CLAUDE.md`; rewrote `JSONVisualization.vue` on
  `useVirtualList` over `useLazyTree`; deleted the five `Json*Widget.vue` and `types.ts`
  (`git grep` for them in `app/gui`: no output); added the sentence to
  `app/gui/src/project-view/CLAUDE.md` ("Visualizations").
- Deviations: none in behaviour. The plan's code was reformatted by Prettier into the repo style
  (single quotes, no semicolons). It compiled and linted as written: no TS fixes needed.
- Checks: vitest `src/project-view/components/visualizations` 9 files / 82 tests pass;
  `typecheck` (app + node) clean; `lint` clean (`--max-warnings=0`). No TS6307.
- Not verified: Playwright (Task 8), the component in a real browser/shadow DOM, the engine side.
- Concerns: no component test was added (the brief has none), so `TreeRow.vue` and the
  `useVirtualList` wiring are only typechecked until Task 8's spec runs.

## Fix round 1

- `TreeRow.vue`: dropped the `SvgIcon` import (its styles never reach the Shadow DOM, since
  `vite.config.ts:49` compiles only `visualizations/` and `shared/` as custom elements). The chevron
  is now an inline `<svg class="chevron" viewBox="0 0 16 16"><use :href="svgUseHref('chevron_right')"/></svg>`
  with TreeRow's own scoped rules: 12px size, and `.arrow.open .chevron { transform: rotate(90deg) }`.
- Other imports under `JSONVisualization/`: only `lazyTree`, `treeExpression`, `treeWire`, `TreeRow`
  (all in the directory), a type-only `nodeCreation` import, and utilities (`@/util/*`, vue, vueuse,
  zod). No component outside `visualizations/` or `shared/` is imported.
- Minor: `@mousedown` on `.content` calls `preventDefault()` when `event.detail > 1`, so a
  double-click no longer selects a word. A single click or drag still selects, so copy works.
- Checks (in `app/gui`): vitest `src/project-view/components/visualizations`: 9 files / 82 tests
  passed. `corepack pnpm run typecheck`: clean. `corepack pnpm run lint`: clean (`--max-warnings=0`).
- Not verified: the rotation in a real browser/Shadow DOM (Task 8's Playwright).
