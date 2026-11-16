# SQL Query and Geo Map Library Visualizations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SQL Query visualization ships with `Standard.Database` and the Geo
Map with `Standard.Visualization`, loaded by the library-visualization path of
#817; the GUI keeps neither file, and saved projects keep both views.

**Architecture:** Two PRs, each applied to `develop` **after #817 has merged**
(it brings `Id.Library`, the library folder loader, `movedVisualizations.ts` and
`shippedVisualizations.test.ts`). PR A adds one allow-list of the bare modules a
run-time compiled visualization may import (`builtinModules.ts`) and a test that
holds every shipped file to it, makes `sql-formatter` a lazy module of that
list, and moves the SQL view (theme and copy-stopping inlined; interpolations
escaped). PR B lets `builtins` export the IDE's Mapbox token, its redaction and
the token-missing empty state, and moves the Geo Map (bounding box inlined, npm
types replaced by local ones). On the Enso side each PR changes only `Id`: the
database table's default becomes `Id.Library "Standard.Database" "SQL Query"`,
and the unused `Id.sql_query` / `Id.geo_map` go. Preprocessors stay where they
are.

**Tech Stack:** Enso standard library and its test framework (`expect_pinned`
goldens); TypeScript/Vue 3 in `app/gui` (run-time compiler: `vue/compiler-sfc`,
`sucrase`, web worker), vitest, `@vue/test-utils`, `@babel/parser`; pnpm.

**Spec:**
`docs/superpowers/specs/2026-11-16-library-visualizations-sql-geo-addendum.md`
(addendum to `2026-11-16-library-visualizations-design.md`). Its owner questions
decide what this plan builds:

Answered 2026-11-16: the owner chose the recommendation on all three (Q1
Standard.Visualization, Q2 yes, Q3 yes), and #817 is merged (848dd7f3f4).

- **Q1** (Geo Map's library): this plan uses the recommendation,
  `Standard.Visualization`. If the owner picks another library, apply "If Q1
  picks another library" at the end of PR B.
- **Q2** (`sql-formatter` in the module cache): PR A assumes yes. If declined,
  do not start PR A; ask whether to build the CDN variant.
- **Q3** (Mapbox exports in `builtins`): PR B assumes yes. If declined, do not
  start PR B.

## Global Constraints

- Start only after #817 is merged **and** the owner has answered Q1–Q3. Each PR
  branches from the then-current `origin/develop`.
- PR A: branch `viz/sql-query-library`, worktree `C:\Repos\Enso\ide-sqlviz`. PR
  B: branch `viz/geo-map-library`, worktree `C:\Repos\Enso\ide-geoviz`. PR B
  needs PR A's Task A1 (the allow-list): branch PR B after PR A merges, or, if
  PR A was dropped (Q2), cherry-pick PR A's Task A1 commit first.
- Neither PR is user-visible when it works: no `CHANGELOG.md` entry; label
  `CI: No changelog needed` at creation. Both still carry before/after
  screenshots of the view (orphan `pr-screenshots` branch) and merge only on the
  owner's OK after an installer test, as #817 did. Never
  `gh pr merge --delete-branch` (the branch is checked out in a worktree).
- Never `git stash`. Never commit `.superpowers/`.
- Never run pnpm from WSL inside a Windows path. Enso builds run in WSL from a
  Linux-filesystem clone (`~/sqlgeo`), after `. ~/.enso-toolchain.sh`, synced
  with
  `git fetch -q /mnt/c/Repos/Enso/ide refs/heads/<branch>:refs/remotes/local/<branch> && git checkout -B <branch> local/<branch>`.
  Delete `~/sqlgeo` once both PRs are merged.
- Running an Enso test project: `cd test` first (the working directory must be
  the project's parent), and check that tests ran: a filter matching nothing
  exits 0 with `0 tests failed.`
- Avoid new Vector allocation in Enso wherever possible.
- GUI gate (from `app/gui`): `CI=true corepack pnpm exec vitest run <paths>`
  (without `CI=true` missing snapshots are written silently), then
  `corepack pnpm run typecheck` and `corepack pnpm run lint`.
- Enso lint:
  `enso --enable-static-analysis --hide-progress -Werror --compile <lib dir>`.
- A changed public Enso API needs its `docs/api` updated to the generator's
  format (sorted, constructors first), or the Stdlib API check fails.
- `ENSO_UPDATE_PINNED=1` rewrites every golden a run reaches: copy back only the
  intended ones. Goldens have no trailing newline.
- A library visualization may import only the names in `BUILTIN_MODULE_NAMES`
  (Task A1) and relative files of its own folder; no dynamic `import()`. It is
  not type-checked: keep types local and simple.
- Python on Windows writes CRLF in text mode: use `newline=''`.

## File map

PR A — SQL Query → `Standard.Database`

| File                                                                                                                                | Change                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `app/gui/src/project-view/stores/visualization/builtinModules.ts` (new)                                                             | `BUILTIN_MODULE_NAMES`, the bare modules a visualization may import     |
| `app/gui/src/project-view/stores/visualization/compilerMessaging.ts`                                                                | `moduleCache` satisfies the list; `sql-formatter` as a lazy module      |
| `app/gui/src/project-view/stores/visualization/__tests__/shippedVisualizationImports.test.ts` (new)                                 | every shipped file imports only allowed modules                         |
| `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Table_Implementation.enso`                                            | `default_viz_id` → `Id.Library "Standard.Database" "SQL Query"`         |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso`, `docs/api/Id.md`                                                   | delete `sql_query`                                                      |
| `test/Visualization_Tests/src/{Id_Spec,Table_Conversions_Spec}.enso`, `data/pinned/default_db_table.json`                           | expectations                                                            |
| `distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue`                                                         | moved from `app/gui/.../components/visualizations/SQLVisualization.vue` |
| `app/gui/src/project-view/stores/visualization/__tests__/shippedSqlQuery.test.ts` (new)                                             | mount tests of the shipped file                                         |
| `app/gui/src/project-view/stores/visualization/index.ts`                                                                            | built-in list loses SQL                                                 |
| `app/gui/src/project-view/stores/visualization/movedVisualizations.ts` (+ test)                                                     | `Builtin "SQL Query"` row                                               |
| `app/gui/src/project-view/stores/visualization/__tests__/availability.test.ts`                                                      | register SQL from its library file under the library id                 |
| `app/gui/integration-test/project-view/locate.ts`                                                                                   | drop the dead `sqlVisualization` locator                                |
| `app/gui/vitest.config.ts`                                                                                                          | `resolve.dedupe` for `sql-formatter`, only if needed                    |
| `app/gui/src/project-view/stores/visualization/CLAUDE.md`, `distribution/lib/Standard/{Database,Visualization}/0.0.0-dev/CLAUDE.md` | docs                                                                    |

PR B — Geo Map → `Standard.Visualization`

| File                                                                                        | Change                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso`, `docs/api/Id.md`           | delete `geo_map`                                                                                |
| `test/Visualization_Tests/src/Id_Spec.enso`                                                 | expectation                                                                                     |
| `app/gui/src/project-view/util/visualizationBuiltins.ts`                                    | export `useMapboxToken`, `redactAccessToken`, `MapboxTokenMissing`                              |
| `app/gui/src/project-view/components/visualizations/MapboxTokenMissing.vue`                 | moved from `GeoMapVisualization/MapboxTokenMissing.vue`                                         |
| `app/gui/src/project-view/util/__tests__/visualizationBuiltins.test.ts` (new)               | the new exports                                                                                 |
| `distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue`              | moved from `app/gui/.../GeoMapVisualization.vue`                                                |
| `app/gui/src/project-view/stores/visualization/__tests__/shippedGeoMap.test.ts`             | moved from `components/visualizations/__tests__/GeoMapVisualization.test.ts`, plus bounding box |
| `app/gui/vitest.config.ts`                                                                  | alias `builtins` → `src/project-view/util/visualizationBuiltins.ts`                             |
| `app/gui/package.json`, `pnpm-lock.yaml`                                                    | drop `@turf/bbox`, `mapbox-gl`                                                                  |
| `app/gui/src/project-view/stores/visualization/{index.ts,movedVisualizations.ts}` (+ tests) | built-in list, `Builtin "Geo Map"` row                                                          |
| `app/gui/src/project-view/stores/visualization/__tests__/availability.test.ts`              | register Geo Map from its library file                                                          |
| `app/gui/src/providers/mapboxToken.ts`, `app/gui/src/utils/redact.ts`                       | comments name the new file                                                                      |
| `app/gui/integration-test/project-view/locate.ts`                                           | drop the unused `geoMapVisualization` locator                                                   |
| CLAUDE.md files as in PR A                                                                  | docs                                                                                            |

---

## PR A — SQL Query moves to Standard.Database

### Task A1: One allow-list of what a visualization may import

**Files:**

- Create: `app/gui/src/project-view/stores/visualization/builtinModules.ts`
- Modify: `app/gui/src/project-view/stores/visualization/compilerMessaging.ts`
  (the `moduleCache` literal, and `modules: Object.keys(moduleCache)` in
  `compile`)
- Test:
  `app/gui/src/project-view/stores/visualization/__tests__/shippedVisualizationImports.test.ts`

**Interfaces:**

- Produces:
  - `BUILTIN_MODULE_NAMES: readonly ['vue', 'builtins', 'd3']` (Task A3 adds
    `'sql-formatter'`) and `type BuiltinModuleName`, from
    `@/stores/visualization/builtinModules`.
  - The test's `unloadable(code)` stays private to the test file; later tasks
    only add shipped files for it to check.

- [ ] **Step 1: Write the failing test.**

```ts
/**
 * @file Every visualization a standard library ships imports only what the IDE's run-time compiler
 * provides. Vite (and so `shippedVisualizations.test.ts`) resolves any npm import, so a mount test
 * alone would pass a file the IDE cannot load.
 */
import { parse as babelParse } from "@babel/parser";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { BUILTIN_MODULE_NAMES } from "../builtinModules";
import { compileSfc } from "../compileSfc";

const STANDARD = path.resolve(
  __dirname,
  "../../../../../../../distribution/lib/Standard",
);
const shipped = readdirSync(STANDARD).flatMap((lib) => {
  const dir = path.join(STANDARD, lib, "0.0.0-dev", "visualizations");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".vue"))
        .map((f) => ({ lib, name: f, file: path.join(dir, f) }))
    : [];
});

/** Relative imports the compiler follows (`rewriteImports` in `compiler.ts`). */
const FOLLOWED = /\.(vue|ts|svg|png|jpe?g|webp|gif|apng)$/i;

/** The imports of compiled visualization code, as the run-time compiler sees them. */
function importsOf(code: string) {
  const sources = babelParse(code, {
    sourceType: "module",
  }).program.body.flatMap((stmt) =>
    stmt.type === "ImportDeclaration" ? [stmt.source.value] : [],
  );
  const isRelative = (s: string) => /^\.\.?\//.test(s);
  return {
    bare: sources.filter((s) => !isRelative(s)),
    relative: sources.filter(isRelative),
    dynamic: /\bimport\s*\(/.test(code),
  };
}

/** What in this compiled code the IDE could not load. */
function unloadable(code: string): string[] {
  const { bare, relative, dynamic } = importsOf(code);
  const allowed: readonly string[] = BUILTIN_MODULE_NAMES;
  return [
    ...bare
      .filter((s) => !allowed.includes(s))
      .map((s) => `bare import '${s}'`),
    ...relative
      .filter((s) => !FOLLOWED.test(s))
      .map((s) => `relative import '${s}'`),
    ...(dynamic ? ["a dynamic import()"] : []),
  ];
}

describe("the import check", () => {
  test("accepts vue and the IDE builtins", () => {
    const { code } = compileSfc(
      `<script setup lang="ts">
import { useVisualizationConfig } from 'builtins'
import { computed } from 'vue'
const c = computed(() => useVisualizationConfig())
</script>
<template><span>{{ c }}</span></template>`,
      "Ok.vue",
    );
    expect(unloadable(code)).toEqual([]);
  });

  test("rejects an npm package, a .js file and a dynamic import", () => {
    const { code } = compileSfc(
      `<script setup lang="ts">
import bbox from '@turf/bbox'
import helper from './helper.js'
const lazy = import('sql-formatter')
</script>
<template><span>{{ bbox }}{{ helper }}{{ lazy }}</span></template>`,
      "Bad.vue",
    );
    expect(unloadable(code)).toEqual([
      "bare import '@turf/bbox'",
      "relative import './helper.js'",
      "a dynamic import()",
    ]);
  });
});

test.each(shipped)(
  "$lib/$name imports only what the run-time compiler provides",
  ({ file, name }) => {
    const { code } = compileSfc(readFileSync(file, "utf8"), name);
    expect(unloadable(code)).toEqual([]);
  },
);
```

(If `@babel/parser`'s types make `stmt.source.value` awkward, narrow with
`stmt.type === 'ImportDeclaration'` as written; `@babel/parser` is already a GUI
dependency, used by `compiler.ts`.)

- [ ] **Step 2: Run, expect failure.** From `app/gui`:
      `CI=true corepack pnpm exec vitest run src/project-view/stores/visualization/__tests__/shippedVisualizationImports.test.ts`.
      Expected: FAIL, `Cannot find module '../builtinModules'`.

- [ ] **Step 3: Implement.** `builtinModules.ts`:

```ts
/**
 * The bare module names a run-time compiled visualization (a project's or a library's `.vue` file)
 * may import. `compilerMessaging.ts` provides one module per name; the compiler rewrites an import of
 * any of them to read that module. Widening this list widens what every library can rely on: it is
 * the owner's decision (see `CLAUDE.md`, "What a library visualization can use").
 */
export const BUILTIN_MODULE_NAMES = ["vue", "builtins", "d3"] as const;

/** One of {@link BUILTIN_MODULE_NAMES}. */
export type BuiltinModuleName = (typeof BUILTIN_MODULE_NAMES)[number];
```

In `compilerMessaging.ts`, replace the `moduleCache` literal:

```ts
/** One module per allowed name; `satisfies` makes the compiler check both directions. */
const builtinModules = {
  vue,
  builtins,
  get d3() {
    return import("d3");
  },
} satisfies Record<BuiltinModuleName, unknown>;

// Keeps the getters: a lazy module is imported only when a visualization asks for it.
const moduleCache: Record<string, unknown> = Object.create(
  null,
  Object.getOwnPropertyDescriptors(builtinModules),
);
```

with
`import { BUILTIN_MODULE_NAMES, type BuiltinModuleName } from '@/stores/visualization/builtinModules'`,
and in `compile` send `modules: [...BUILTIN_MODULE_NAMES]` instead of
`Object.keys(moduleCache)` (which would now also list compiled modules added
later).

- [ ] **Step 4: Run, expect pass**: the test file, then the whole
      `src/project-view/stores/visualization` folder, `typecheck`, `lint`.
      `Image/Image.vue` (from #817) must pass the per-file case.

- [ ] **Step 5: Commit**
      `GUI: one list of the modules a run-time visualization may import, checked against shipped files`.

---

### Task A2: Enso — a database table asks for Standard.Database's SQL view

**Files:**

- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Table_Implementation.enso:99-101`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso`
  (delete `sql_query`), `docs/api/Id.md`
- Test: `test/Visualization_Tests/src/Table_Conversions_Spec.enso:64-65`,
  `test/Visualization_Tests/src/Id_Spec.enso` (the `sql_query` line),
  `test/Visualization_Tests/data/pinned/default_db_table.json`

**Interfaces:**

- Consumes: `Id.Library library:Text name:Text` (#817).
- Produces: `Id.from` of a `DB_Table` is
  `Id.Library "Standard.Database" "SQL Query"`, JSON
  `{"library":{"name":"Standard.Database"},"name":"SQL Query"}`. The GUI's
  library id for it is `{ kind: 'Library', name: 'Standard.Database' }`, name
  `SQL Query` (Task A3).

- [ ] **Step 1: Write the failing test.** In `Table_Conversions_Spec.enso`:

```enso
        group_builder.specify "the default visualisation of a database table is Standard.Database's SQL view" <|
            Id.from dt . should_equal (Id.Library "Standard.Database" "SQL Query")
```

and in `Id_Spec.enso` delete
`Visualization.Id.sql_query.to_json . should_equal (json_for_name "SQL Query")`.
Set `default_db_table.json` to
`{"library":{"name":"Standard.Database"},"name":"SQL Query"}` (no trailing
newline):

```bash
printf '%s' '{"library":{"name":"Standard.Database"},"name":"SQL Query"}' > test/Visualization_Tests/data/pinned/default_db_table.json
```

- [ ] **Step 2: Run, expect failure.** In WSL (`~/sqlgeo`, synced, distribution
      built with `sbt buildEngineDistribution`):

```bash
cd test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" "Database values"
cd test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" "Pinned default visualisation"
```

Expected: the SQL-view spec and `default_db_table` fail
(`Id.Builtin "SQL Query"`). Check both runs list tests.

- [ ] **Step 3: Implement.** In `DB_Table_Implementation.enso`:

```enso
    default_viz_id (this_table : Table & DB_Table) =
        _ = this_table
        Id.Library "Standard.Database" "SQL Query"
```

In `Id.enso` delete the `sql_query` method with its doc comment. In
`docs/api/Id.md` delete the line `    - sql_query -> Standard.Base.Any.Any`.

- [ ] **Step 4: Run, expect pass**: `Visualization_Tests` whole, and lint
      `distribution/lib/Standard/Database/0.0.0-dev` and
      `distribution/lib/Standard/Visualization/0.0.0-dev`. Then
      `git grep -n "sql_query\b" -- distribution test engine | grep -i "Id\."`
      must be empty (the `sql_query` arguments of `Generic_JDBC_Connection.read`
      and DuckDB locals are unrelated), and
      `git grep -n default_viz_id -- distribution/lib/Standard/Database/0.0.0-dev/docs`
      must be empty (internal module, no API snapshot).

- [ ] **Step 5: Commit**
      `Database: a database table opens in Standard.Database's SQL Query view`.

---

### Task A3: GUI — the SQL view ships with Standard.Database

**Files:**

- Move (git mv):
  `app/gui/src/project-view/components/visualizations/SQLVisualization.vue` →
  `distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue`
- Modify: `app/gui/src/project-view/stores/visualization/builtinModules.ts`,
  `compilerMessaging.ts` (`sql-formatter`)
- Modify: `app/gui/src/project-view/stores/visualization/index.ts` (import and
  `builtinVisualizations` entry `sqlVisualization`)
- Modify:
  `app/gui/src/project-view/stores/visualization/movedVisualizations.ts`,
  `__tests__/movedVisualizations.test.ts`
- Modify:
  `app/gui/src/project-view/stores/visualization/__tests__/availability.test.ts`
- Modify: `app/gui/integration-test/project-view/locate.ts:154` (delete
  `sqlVisualization`: it names `.SqlVisualization`, a class that never existed,
  and nothing uses it)
- Test:
  `app/gui/src/project-view/stores/visualization/__tests__/shippedSqlQuery.test.ts`

**Interfaces:**

- Consumes: `BUILTIN_MODULE_NAMES` (A1); `canonicalVisualizationId` (#817).
- Produces: library visualization
  `{ kind: 'Library', name: 'Standard.Database' }` / `SQL Query`;
  `BUILTIN_MODULE_NAMES` gains `'sql-formatter'`;
  `canonicalVisualizationId({ module: { kind: 'Builtin' }, name: 'SQL Query' })`
  is the library id.

- [ ] **Step 1: Write the failing tests.** `shippedSqlQuery.test.ts`:

```ts
/** @file The SQL Query visualization that Standard.Database ships. */
import { mount } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import * as SqlQuery from "../../../../../../../distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue";

const TEXT = "Standard.Base.Data.Text.Text";
const NO_SQL = { error: "This value has no SQL to show." };

function sql(code: string, ...values: unknown[]) {
  return {
    data: {
      dialect: "SQLite",
      code,
      interpolations: values.map((value) => ({ enso_type: TEXT, value })),
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("it is the SQL Query view of database tables and columns", () => {
  expect(SqlQuery.name).toBe("SQL Query");
  expect(SqlQuery.inputType).toBe(
    "Standard.Database.DB_Table.DB_Table | Standard.Database.DB_Column.DB_Column",
  );
  expect(SqlQuery.defaultPreprocessor).toEqual([
    "Standard.Visualization.SQL.Visualization",
    "prepare_visualization",
  ]);
});

test("formats the SQL and colours each interpolated value by its type", () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql('SELECT "a" FROM "t" WHERE "b" = ?', "it's"),
  });
  const pre = wrapper.get("pre.sql");
  expect(pre.text()).toContain("\n");
  expect(pre.text().replace(/\s+/g, " ")).toBe(
    `SELECT "a" FROM "t" WHERE "b" = 'it''s'`,
  );
  const value = pre.get(".interpolation");
  expect(value.text()).toBe("'it''s'");
  expect(value.attributes("style")).toMatch(/color:\s*rgba\(/);
});

test("shows the error text when there is no SQL", () => {
  const wrapper = mount(SqlQuery.default, { props: { data: NO_SQL } });
  expect(wrapper.get("pre.sql").text()).toBe(NO_SQL.error);
});

test("Ctrl+C copies the selected SQL instead of reaching the graph editor", async () => {
  const graph = vi.fn();
  document.body.addEventListener("keydown", graph);
  const wrapper = mount(SqlQuery.default, {
    props: { data: NO_SQL },
    attachTo: document.body,
  });
  await wrapper
    .get(".SQLVisualization")
    .trigger("keydown", { key: "c", ctrlKey: true });
  expect(graph).not.toHaveBeenCalled();
  await wrapper
    .get(".SQLVisualization")
    .trigger("keydown", { key: "v", ctrlKey: true });
  expect(graph).toHaveBeenCalledTimes(1);
  wrapper.unmount();
  document.body.removeEventListener("keydown", graph);
});
```

(jsdom's `navigator.platform` is empty, so `Mod` is Ctrl, as in the GUI's
`isMacLike`.) In `movedVisualizations.test.ts` add:

```ts
test("the old builtin SQL Query id is read as the Standard.Database one", () => {
  expect(
    canonicalVisualizationId({
      module: { kind: "Builtin" },
      name: "SQL Query",
    }),
  ).toEqual({
    module: { kind: "Library", name: "Standard.Database" },
    name: "SQL Query",
  });
});
```

In `shippedVisualizations.test.ts` (from #817) add beside the Image case:

```ts
test("Standard.Database ships the SQL Query visualization", () => {
  expect(shipped.map((s) => `${s.lib}/${path.basename(s.file)}`)).toContain(
    "Database/SQL_Query.vue",
  );
});
```

- [ ] **Step 2: Run, expect failure**
      (`CI=true corepack pnpm exec vitest run src/project-view/stores/visualization`):
      `shippedSqlQuery` cannot resolve the file; the moved-id and shipped-list
      cases fail.

- [ ] **Step 3: Move the file and make it loadable.**

```bash
mkdir -p distribution/lib/Standard/Database/0.0.0-dev/visualizations
git mv app/gui/src/project-view/components/visualizations/SQLVisualization.vue distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue
```

In the moved file, extend the module doc comment with: "Shipped by
Standard.Database and compiled by the IDE at run time, so it imports only `vue`
and the IDE's lazy `sql-formatter` module." Replace everything from
`<script setup lang="ts">` up to (not including)
`/** The qualified name of the Text type. */` with:

```ts
<script setup lang="ts">
import { format, supportedDialects } from 'sql-formatter'
import { computed } from 'vue'

const props = defineProps<{ data: Data }>()

const language = computed(() =>
  props.data.dialect != null && supportedDialects.includes(props.data.dialect) ?
    props.data.dialect
  : 'sql',
)
const formatted = computed(() => {
  if (props.data.error != null || props.data.code == null) {
    return undefined
  }
  const params = (props.data.interpolations ?? []).map(renderInterpolationParameter)
  return format(props.data.code, { params, language: language.value })
})

interface RGBA {
  red: number
  green: number
  blue: number
  alpha: number
}

/** A colour for an Enso type: a hash of its qualified name (the GUI's former `DEFAULT_THEME`). */
function colorForType(type: string): RGBA {
  let hash = 0
  for (const c of type) {
    hash = 0 | (hash * 31 + c.charCodeAt(0))
  }
  if (hash < 0) {
    hash += 0x80000000
  }
  const red = (hash >> 24) / 0x180
  const green = ((hash >> 16) & 0xff) / 0x180
  const blue = ((hash >> 8) & 0xff) / 0x180
  return { red, green, blue, alpha: 1 }
}

/**
 * Let Mod+C (Ctrl, or Cmd on macOS) copy the selected SQL rather than reach the graph editor's
 * copy (the GUI's `stopCopy`).
 */
function stopCopy(event: KeyboardEvent) {
  const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)
  const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    event.stopPropagation()
  }
}
```

Then change `renderInterpolationParameter` to take only the interpolation and
use `colorForType`:

```ts
/** Renders HTML for displaying an Enso parameter that is interpolated into the SQL code. */
function renderInterpolationParameter(param: SQLInterpolation) {
  const value = formatInterpolationParameter(param);
  const fgColor = colorForType(param.enso_type);
  const bgColor = replaceAlpha(fgColor, INTERPOLATION_BACKGROUND_OPACITY);
  return renderRegularInterpolation(value, fgColor, bgColor);
}
```

Leave `convertColorToRgba`, `replaceAlpha`, `formatInterpolationParameter`,
`renderRegularInterpolation`, the template and the styles as they are (A4 fixes
the escaping).

In `builtinModules.ts`: `['vue', 'builtins', 'd3', 'sql-formatter']`. In
`compilerMessaging.ts` add to `builtinModules`:

```ts
  // The SQL Query view of Standard.Database formats with it; a lazy chunk, as when it was built in.
  get 'sql-formatter'() {
    return import('sql-formatter')
  },
```

In `movedVisualizations.ts` add the row
`['SQL Query', { module: { kind: 'Library', name: 'Standard.Database' }, name: 'SQL Query' }]`.
In `index.ts` delete the `sqlVisualization` import and list entry. Delete the
`sqlVisualization` locator in `locate.ts`.

In `availability.test.ts`, replace the `sqlVisualization` import with
`import * as sqlQueryVisualization from '../../../../../../../distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue'`
and the registration loop with:

```ts
// The builtin visualizations, and the library ones, registered as the visualization store does.
const metadata = new VisualizationMetadataDb();
const BUILTIN = { kind: "Builtin" } as const;
type Registered = Pick<
  VisualizationModule,
  "name" | "inputType" | "dataType" | "icon"
>;
const registered: [VisualizationIdentifier["module"], Registered][] = [
  [BUILTIN, tableVisualization],
  [BUILTIN, scatterplotVisualization],
  [{ kind: "Library", name: "Standard.Database" }, sqlQueryVisualization],
  [BUILTIN, geoMapVisualization],
];
for (const [module, { name, inputType, dataType, icon }] of registered) {
  metadata.set(toVisualizationId({ module, name }), {
    name,
    inputType,
    dataType,
    icon,
  });
}
```

with
`import type { VisualizationModule } from '@/stores/visualization/runtimeTypes'`
and `import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'`. Its
expectations do not change (they compare names).

- [ ] **Step 4: Run, expect pass**: the whole `src/project-view` unit suite,
      `typecheck`, `lint`. If Vite cannot resolve `sql-formatter` from the
      library file (`Failed to resolve import "sql-formatter"`: it looks beside
      `distribution/`, where pnpm put no `node_modules`), add to
      `vitest.config.ts`'s `defineConfig`:
      `resolve: { dedupe: ['sql-formatter'] }` (dedupe resolves from the config
      root, `app/gui`) and rerun. If `typecheck` reports errors inside
      `SQL_Query.vue` (it follows the test's import), change the test to load
      the file through a path TypeScript does not follow, as
      `const SqlQuery = await import(/* @vite-ignore */ SQL_QUERY_PATH)` with
      `SQL_QUERY_PATH = path.resolve(__dirname, '<same relative path>')`, and
      check vitest still loads it. Also run Task A1's test:
      `Database/SQL_Query.vue` must pass it (this is what proves the IDE can
      load it).

- [ ] **Step 5: Commit** `SQL Query: the view ships with Standard.Database`.

---

### Task A4: SQL Query escapes the code and the values it shows

**Files:**

- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue`
- Test:
  `app/gui/src/project-view/stores/visualization/__tests__/shippedSqlQuery.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
test("markup in a value or in the code is shown as text", () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql(`SELECT '<i>y</i>' AS "x" WHERE "b" = ?`, "<b>bold</b>"),
  });
  const pre = wrapper.get("pre.sql");
  expect(pre.find("i").exists()).toBe(false);
  expect(pre.find("b").exists()).toBe(false);
  expect(pre.text()).toContain(`'<i>y</i>'`);
  expect(pre.get(".interpolation").text()).toBe(`'<b>bold</b>'`);
});
```

- [ ] **Step 2: Run, expect failure** (`<b>` and `<i>` elements exist).

- [ ] **Step 3: Implement.** Format with placeholder parameters, escape the
      whole output, then put the coloured values in:

```ts
/** Escape text for an HTML context. */
function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A parameter sql-formatter copies through unchanged, swapped for the value after escaping. */
const placeholder = (index: number) => `__enso_param_${index}__`;
const PLACEHOLDER = /__enso_param_(\d+)__/g;

const formatted = computed(() => {
  if (props.data.error != null || props.data.code == null) {
    return undefined;
  }
  const interpolations = props.data.interpolations ?? [];
  const text = format(props.data.code, {
    params: interpolations.map((_, index) => placeholder(index)),
    language: language.value,
  });
  return escapeHtml(text).replace(PLACEHOLDER, (_, index) =>
    renderInterpolationParameter(interpolations[Number(index)]!),
  );
});
```

and in `renderRegularInterpolation` use `html += escapeHtml(String(value))`. Fix
the template comment:
`<!-- eslint-disable-next-line vue/no-v-html The code and every value are escaped (escapeHtml); only our own spans are markup. -->`.

- [ ] **Step 4: Run, expect pass**: `shippedSqlQuery.test.ts` (all cases,
      including the formatting one: the placeholders must not change how the SQL
      is formatted), Task A1's test.

- [ ] **Step 5: Commit**
      `SQL Query: show markup in the SQL and its values as text`.

---

### Task A5: Docs, PR, proof

**Files:**

- Modify: `app/gui/src/project-view/stores/visualization/CLAUDE.md` (moved-ids
  table row; "What a library visualization can use" names `BUILTIN_MODULE_NAMES`
  in `builtinModules.ts` and lists `sql-formatter`; Tests lists
  `shippedVisualizationImports.test.ts`, `shippedSqlQuery.test.ts`; Modules
  lists `builtinModules.ts`)
- Modify: `distribution/lib/Standard/Database/0.0.0-dev/CLAUDE.md` (a
  `visualizations/SQL_Query.vue` entry: what it shows, that the GUI compiles it
  at run time, that its preprocessor and `SQL_Viz` stay in
  Standard.Visualization because Table converts to `SQL_Viz`, and that
  `default_viz_id` names it)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md` (the SQL
  view itself is now in Standard.Database; `src/SQL/Visualization.enso` is its
  preprocessor)

- [ ] **Step 1: Packaging check in WSL.** Rebuild the distribution in `~/sqlgeo`
      and confirm
      `built-distribution/enso-engine-*/enso-*/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue`
      exists.
- [ ] **Step 2: Docs**, then `corepack pnpm exec prettier --check` on the
      changed Markdown and the moved `.vue` file. Commit `SQL Query: docs`.
- [ ] **Step 3: Open the PR** to `develop` with label `CI: No changelog needed`.
      Body: what moved and why the data stays in Standard.Visualization, the
      allow-list, the `sql-formatter` widening (Q2, approved on 2026-11-16), the
      escaping fix, test evidence. Link it; wait for CI green (the PR touches
      `distribution/`, so CI packages an installer with its own engine).
- [ ] **Step 4: Screenshots**: a database table node in SQL Query before
      (develop) and after (PR), with an interpolated value, on `pr-screenshots`,
      embedded in the PR.
- [ ] **Step 5: Hand to the owner** with the installer link and checklist:
  1. a new `DB_Table` node (e.g. `Database.connect (SQLite.In_Memory)` and a
     query with a filter) opens in SQL Query, formatted, the filter value
     coloured;
  2. a project saved before the change with a node showing SQL Query still shows
     it;
  3. the view picker of a database table lists SQL Query; an in-memory table's
     does not;
  4. selecting SQL text and pressing Ctrl+C copies it.

  Merge only on the owner's OK, without `--delete-branch`.

---

## PR B — Geo Map moves to Standard.Visualization

### Task B1: Enso — `Id.geo_map` goes

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso`
  (delete `geo_map`), `docs/api/Id.md`
- Test: `test/Visualization_Tests/src/Id_Spec.enso`

- [ ] **Step 1: Change the test.** Delete
      `Visualization.Id.geo_map.to_json . should_equal (json_for_name "Geo Map")`
      from `Id_Spec.enso`. (No type defaults to the map, so there is no new
      expectation; the golden `geo_*.json` files are preprocessor output and do
      not change.)
- [ ] **Step 2: Implement.** Delete `geo_map` and its doc comment from
      `Id.enso`; delete `    - geo_map -> Standard.Base.Any.Any` from
      `docs/api/Id.md`.
- [ ] **Step 3: Run, expect pass** (WSL, `~/sqlgeo` synced and rebuilt):
      `Visualization_Tests` whole; lint `Standard/Visualization`;
      `git grep -n "geo_map\b" -- distribution test engine | grep "Id\."` must
      be empty.
- [ ] **Step 4: Commit**
      `Visualization: Id.geo_map goes; the map is a library view`.

---

### Task B2: `builtins` offers the IDE's Mapbox token to visualizations

**Files:**

- Move (git mv):
  `app/gui/src/project-view/components/visualizations/GeoMapVisualization/MapboxTokenMissing.vue`
  → `app/gui/src/project-view/components/visualizations/MapboxTokenMissing.vue`
- Modify: `app/gui/src/project-view/util/visualizationBuiltins.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/GeoMapVisualization.vue`
  (its import of `MapboxTokenMissing`, until B3 moves it)
- Test: `app/gui/src/project-view/util/__tests__/visualizationBuiltins.test.ts`

**Interfaces:**

- Produces, from `builtins`:
  - `useMapboxToken(): ComputedRef<string | null>` — the token from Settings →
    Local → Maps, reactive.
  - `redactAccessToken(text: string): string` — `access_token` values replaced.
  - `MapboxTokenMissing` — the empty state component, with its "Open Settings"
    button.

- [ ] **Step 1: Write the failing test.**

```ts
/** @file What a run-time compiled visualization gets from the IDE (`import … from 'builtins'`). */
import { mapboxSettingsStore } from "$/providers/mapboxToken";
import * as builtins from "@/util/visualizationBuiltins";
import { afterEach, expect, test } from "vitest";

afterEach(() => mapboxSettingsStore.setState({ accessToken: null }));

test("a visualization reads the Mapbox token the user set, reactively", () => {
  mapboxSettingsStore.setState({ accessToken: "pk.one" });
  const token = builtins.useMapboxToken();
  expect(token.value).toBe("pk.one");
  mapboxSettingsStore.setState({ accessToken: null });
  expect(token.value).toBeNull();
});

test("a visualization can redact the token from what it logs", () => {
  expect(
    builtins.redactAccessToken(
      "https://api.mapbox.com/s?access_token=pk.secret",
    ),
  ).not.toContain("pk.secret");
});

test("a visualization can show the token-missing empty state", () => {
  expect(builtins.MapboxTokenMissing).toBeTypeOf("object");
});
```

- [ ] **Step 2: Run, expect failure**
      (`CI=true corepack pnpm exec vitest run src/project-view/util/__tests__/visualizationBuiltins.test.ts`):
      the exports are undefined.

- [ ] **Step 3: Implement.** `git mv` the component; fix its import in
      `GeoMapVisualization.vue` to `./MapboxTokenMissing.vue`. In
      `visualizationBuiltins.ts`:

```ts
export { useVisualizationConfig } from "@/providers/visualizationConfig";
export { defineKeybinds } from "@/util/shortcuts";

// Maps. The Mapbox token is an IDE setting (Settings → Local → Maps), not library data: the map
// visualization that Standard.Visualization ships reads it, redacts it from its logs, and shows the
// IDE's own empty state when it is missing.
export { default as MapboxTokenMissing } from "@/components/visualizations/MapboxTokenMissing.vue";
export { useMapboxToken } from "$/providers/mapboxToken";
export { redactAccessToken } from "$/utils/redact";
```

(Keep the file's existing header comment, if any; order the exports as the
import sorter wants: run `lint --fix` if it complains.)

- [ ] **Step 4: Run, expect pass**, plus the existing
      `components/visualizations/__tests__/GeoMapVisualization.test.ts`,
      `typecheck`, `lint`.

- [ ] **Step 5: Commit**
      `GUI: visualizations get the IDE's Mapbox token, redaction and empty state from builtins`.

---

### Task B3: GUI — the Geo Map ships with Standard.Visualization

**Files:**

- Move (git mv):
  `app/gui/src/project-view/components/visualizations/GeoMapVisualization.vue` →
  `distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue`
- Move (git mv):
  `app/gui/src/project-view/components/visualizations/__tests__/GeoMapVisualization.test.ts`
  →
  `app/gui/src/project-view/stores/visualization/__tests__/shippedGeoMap.test.ts`
- Modify: `app/gui/vitest.config.ts` (alias `builtins`)
- Modify: `app/gui/package.json`, `pnpm-lock.yaml` (drop `@turf/bbox`,
  `mapbox-gl`)
- Modify: `app/gui/src/project-view/stores/visualization/index.ts`,
  `movedVisualizations.ts`, `__tests__/movedVisualizations.test.ts`,
  `__tests__/availability.test.ts`, `__tests__/shippedVisualizations.test.ts`
- Modify: `app/gui/src/providers/mapboxToken.ts:2`,
  `app/gui/src/utils/redact.ts` (comments name `Geo_Map.vue` in
  Standard.Visualization)
- Modify: `app/gui/integration-test/project-view/locate.ts:155` (delete the
  unused `geoMapVisualization`)

**Interfaces:**

- Consumes: `useMapboxToken`, `redactAccessToken`, `MapboxTokenMissing`,
  `useVisualizationConfig` from `builtins` (B2); `BUILTIN_MODULE_NAMES` (A1).
- Produces: library visualization
  `{ kind: 'Library', name: 'Standard.Visualization' }` / `Geo Map`, exporting
  also `toGeoJSONs(data: unknown): GeoJSON[]` and
  `boundingBox(value: unknown): [number, number, number, number] | undefined`
  (for tests); `canonicalVisualizationId` maps `Builtin "Geo Map"` to it.

- [ ] **Step 1: Move the test and write the new cases.** `git mv` the test. In
      it, load the shipped file and keep `builtins` real except the config:

```ts
import { mapboxSettingsStore } from "$/providers/mapboxToken";
import { useText } from "$/providers/text";
import { replayPrivacyOptions } from "$/utils/redact";
import { mountWithProviders } from "$/utils/testing/mountWithProviders";
import { pinnedDir } from "@/components/visualizations/__tests__/pinnedGoldens";
import { flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import GeoMapVisualization, {
  boundingBox,
  dataType,
  defaultPreprocessor,
  name,
  toGeoJSONs,
} from "../../../../../../../distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue";

vi.mock("@/util/visualizationBuiltins", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/util/visualizationBuiltins")>()),
  useVisualizationConfig: () => ({
    size: { x: 200, y: 200 },
    setToolbarOverlay: vi.fn(),
  }),
}));
```

Keep the rest of the file (router mock, `MapMock`, the six cases) as it is. Add:

```ts
test("it is the Geo Map view of anything that converts to Viz_Table", () => {
  expect(name).toBe("Geo Map");
  expect(dataType).toBe("Standard.Visualization.Viz_Table.Viz_Table");
  expect(defaultPreprocessor).toEqual([
    "Standard.Visualization.Geo_Map",
    "process_to_json_text",
  ]);
});

describe("the bounding box (in place of @turf/bbox)", () => {
  const golden = (file: string) =>
    JSON.parse(readFileSync(path.join(pinnedDir, file), "utf8"));

  test("of a table of places is the box around them", () => {
    expect(toGeoJSONs(golden("geo_mem_table.json")).map(boundingBox)).toEqual([
      [-0.1, 48.8, 2.3, 51.5],
    ]);
  });

  test("of values that are not a map is nothing", () => {
    expect(toGeoJSONs(golden("geo_vector.json"))).toEqual([]);
    expect(toGeoJSONs(golden("geo_mem_table_nothing_known.json"))).toEqual([]);
    expect(toGeoJSONs(golden("geo_connection.json"))).toEqual([]);
  });

  test("covers points, lines, polygons and collections, ignoring heights", () => {
    expect(
      boundingBox({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [1, 2, 99] },
          {
            type: "LineString",
            coordinates: [
              [-3, 4],
              [5, -6],
            ],
          },
          {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 7],
                [0, 0],
              ],
            ],
          },
        ],
      }),
    ).toEqual([-3, -6, 10, 7]);
    expect(
      boundingBox({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [4, 5] } },
        ],
      }),
    ).toEqual([4, 5, 4, 5]);
  });

  test("of an empty layer is undefined, so the map is not fitted to it", () => {
    expect(
      boundingBox({ type: "FeatureCollection", features: [] }),
    ).toBeUndefined();
    expect(boundingBox({ type: "Feature", geometry: null })).toBeUndefined();
  });
});
```

In `movedVisualizations.test.ts`:

```ts
test("the old builtin Geo Map id is read as the Standard.Visualization one", () => {
  expect(
    canonicalVisualizationId({ module: { kind: "Builtin" }, name: "Geo Map" }),
  ).toEqual({
    module: { kind: "Library", name: "Standard.Visualization" },
    name: "Geo Map",
  });
});
```

In `shippedVisualizations.test.ts`:

```ts
test("Standard.Visualization ships the Geo Map visualization", () => {
  expect(shipped.map((s) => `${s.lib}/${path.basename(s.file)}`)).toContain(
    "Visualization/Geo_Map.vue",
  );
});
```

- [ ] **Step 2: Run, expect failure**
      (`CI=true corepack pnpm exec vitest run src/project-view/stores/visualization`):
      the shipped file does not exist; moved-id case fails.

- [ ] **Step 3: Move the file and make it loadable.**

```bash
mkdir -p distribution/lib/Standard/Visualization/0.0.0-dev/visualizations
git mv app/gui/src/project-view/components/visualizations/GeoMapVisualization.vue distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue
```

In the module `<script lang="ts">` block, after the constants, replace the types
from `type Data = …` to `declare const mapboxgl: …` with local types and the
pure functions moved up from the setup script:

```ts
// A library visualization is compiled at run time and not type-checked: it cannot use
// `@types/geojson` or `mapbox-gl`'s types. These local types document what this file reads.

/** A GeoJSON object (RFC 7946): a geometry, a Feature, or a collection of either. */
export interface GeoJSON {
  type: string;
  [key: string]: unknown;
}

type Data = RegularData | Layer | DataFrame;

interface RegularData {
  layers: Layer[];
}

interface ScatterplotLayer {
  type: "Scatterplot_Layer";
  data: Location[];
}

interface GeoJsonLayer {
  type: "GeoJsonLayer";
  data: GeoJSON | GeoJSON[];
}

type Layer = ScatterplotLayer | GeoJsonLayer;

type Color = string;

interface Location {
  latitude: number;
  longitude: number;
  color?: Color | undefined;
  radius?: number | undefined;
  label?: string | undefined;
}

interface DataFrame {
  df_latitude: number[];
  df_longitude: number[];
  df_color?: Color[];
  df_radius?: number[];
  df_label?: string[];
}

/** Mapbox GL, the global the `scripts` above load. */
declare const mapboxgl: any;

/** The GeoJSON layers a visualization value describes; a value that is not a map gives none. */
export function toGeoJSONs(data: unknown): GeoJSON[] {
  // Values that are not a map (a number, a vector, `{}` for a column) show the empty map.
  if (data == null || typeof data !== "object") return [];
  if ("type" in data) return [layerToGeoJSON(data as Layer)];
  if ("df_latitude" in data) return [dataframeToGeoJSON(data as DataFrame)];
  if ("layers" in data && Array.isArray(data.layers)) {
    return (data.layers as Layer[]).map(layerToGeoJSON);
  }
  return [];
}
```

followed by `layerToGeoJSON` and `dataframeToGeoJSON`, moved up from the setup
script unchanged except their types (`GeoJSON.GeoJSON` → `GeoJSON`; in
`dataframeToGeoJSON` collect into `const features: GeoJSON[] = []` and return
`{ type: 'FeatureCollection', features }`), and the bounding box:

```ts
/**
 * `[west, south, east, north]` around every position in a GeoJSON value (heights ignored), or
 * `undefined` when it has none. In place of `@turf/bbox`, which a library visualization cannot
 * import.
 */
export function boundingBox(
  value: unknown,
): [number, number, number, number] | undefined {
  let box: [number, number, number, number] | undefined;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      if (typeof node[0] === "number" && typeof node[1] === "number") {
        const x = node[0];
        const y = node[1];
        box = box
          ? [
              Math.min(box[0], x),
              Math.min(box[1], y),
              Math.max(box[2], x),
              Math.max(box[3], y),
            ]
          : [x, y, x, y];
      } else {
        node.forEach(visit);
      }
    } else if (node != null && typeof node === "object") {
      const object = node as Record<string, unknown>;
      visit(object.coordinates);
      visit(object.geometry);
      visit(object.geometries);
      visit(object.features);
    }
  };
  visit(value);
  return box;
}
```

In the setup script:

```ts
import {
  MapboxTokenMissing,
  redactAccessToken,
  useMapboxToken,
  useVisualizationConfig,
} from "builtins";
import {
  computed,
  effectScope,
  onScopeDispose,
  useTemplateRef,
  watch,
  type EffectScope,
} from "vue";
```

replacing the six old imports;
`const dataAsGeoJSONs = computed(() => toGeoJSONs(props.data))` replacing the
old computed and the two moved functions; and:

```ts
function boundingBoxOfCurrentData() {
  let finalBBox: any;
  for (const geojson of dataAsGeoJSONs.value) {
    const layerBbox = boundingBox(geojson);
    if (layerBbox == null) continue;
    finalBBox =
      finalBBox?.extend(layerBbox) ?? new mapboxgl.LngLatBounds(layerBbox);
  }
  return finalBBox;
}
```

In `class GeoMapVisualizationMap`, type `map` and `tooltip` as `any` (the
`mapboxgl.Map` / `mapboxgl.Popup` types are gone). Keep everything else —
including the class `GeoMapVisualization` and `data-sentry-block`, which
`$/utils/redact`'s `REPLAY_BLOCK_SELECTORS` depends on — unchanged. Delete the
now-empty `components/visualizations/GeoMapVisualization/` folder if B2 left it.

Elsewhere:

- `vitest.config.ts`, inside `defineConfig({ … })`:

```ts
    resolve: {
      // A library visualization imports the IDE's `builtins` module by that bare name; the run-time
      // compiler provides it (`compilerMessaging.ts`), and tests resolve it to the same file.
      alias: {
        builtins: fileURLToPath(
          new URL('./src/project-view/util/visualizationBuiltins.ts', import.meta.url),
        ),
      },
    },
```

(merged with A3's `dedupe` if that was added). Check that the `vi.mock` of
`@/util/visualizationBuiltins` reaches the library's `builtins` import (both
resolve to one file); if the map test sees the real config, add the same factory
as `vi.mock('builtins', …)`.

- `index.ts`: delete the `geoMapVisualization` import and list entry.
- `movedVisualizations.ts`: add
  `['Geo Map', { module: { kind: 'Library', name: 'Standard.Visualization' }, name: 'Geo Map' }]`.
- `availability.test.ts`: import `geoMapVisualization` from
  `'../../../../../../../distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue'`
  and register it as
  `[{ kind: 'Library', name: 'Standard.Visualization' }, geoMapVisualization]`.
- `locate.ts`: delete `geoMapVisualization`.
- `mapboxToken.ts` header: "which the map visualization (`Geo_Map.vue` in
  Standard.Visualization, through `builtins`) gives to Mapbox GL"; `redact.ts`'s
  `REPLAY_BLOCK_SELECTORS` comment: name the same file and say the class must
  stay `GeoMapVisualization`.
- Dependencies, from `app/gui`: `corepack pnpm remove @turf/bbox mapbox-gl`,
  then `git grep -n "@turf/bbox\|from 'mapbox-gl'\|import('mapbox-gl')" -- app`
  must be empty (the integration-test route for the Mapbox stylesheet URL
  stays).

- [ ] **Step 4: Run, expect pass**: the whole `src/project-view` unit suite
      (Task A1's import check must pass `Visualization/Geo_Map.vue`), then,
      because a dependency changed, delete the caches and run the full gate:

```bash
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
find . -name '.eslintcache'   -not -path '*/node_modules/*' -delete
corepack pnpm run typecheck && corepack pnpm run lint
```

If `typecheck` reports errors inside `Geo_Map.vue`, switch the test to a path
TypeScript does not follow, as in Task A3 step 4.

- [ ] **Step 5: Commit** `Geo Map: the view ships with Standard.Visualization`.

---

### Task B4: Docs, PR, proof

**Files:**

- Modify: `app/gui/src/project-view/stores/visualization/CLAUDE.md` (moved-ids
  row; "What a library visualization can use" lists the three Mapbox exports of
  `builtins`; Tests lists `shippedGeoMap.test.ts`; the "Add a row when another
  built-in moves" line drops the two done moves)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md` (a
  `visualizations/Geo_Map.vue` entry: the view of
  `Geo_Map.process_to_json_text`; Mapbox GL from `scripts`; the token comes from
  the IDE through `builtins`)

- [ ] **Step 1: Packaging check in WSL**:
      `built-distribution/enso-engine-*/enso-*/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue`
      exists.
- [ ] **Step 2: Docs**; `prettier --check` on the Markdown and the moved file.
      Commit `Geo Map: docs`.
- [ ] **Step 3: Open the PR** to `develop` with label `CI: No changelog needed`.
      Body: what moved, why Standard.Visualization (Q1), the `builtins` widening
      (Q3, approved on 2026-11-16), the inlined bounding box and dropped
      dependencies, test evidence. Link it; wait for CI green.
- [ ] **Step 4: Screenshots**: a lat/lon table in Geo Map (with a token) and the
      token-missing empty state, before (develop) and after (PR), on
      `pr-screenshots`, embedded in the PR.
- [ ] **Step 5: Hand to the owner** with the installer link and checklist:
  1. a new project,
     `Table.new [["lat", [51.5, 48.8]], ["lon", [-0.1, 2.3]], ["label", ["London", "Paris"]]]`:
     the view picker offers Geo Map without any new import, and it shows both
     cities with labels on hover;
  2. without a token: the "Maps need a Mapbox access token" state, and its
     button opens Settings → Local;
  3. setting a token while the map is open shows the map; clearing it shows the
     empty state again;
  4. a project saved before the change with a node showing Geo Map still shows
     it.

  Merge only on the owner's OK, without `--delete-branch`.

### If Q1 picks another library

For `Standard.Geo` (or `Standard.Table`), replace `Visualization` by `Geo` (or
`Table`) in: the target path of the `git mv` in B3, the `Library` name in
`movedVisualizations.ts`, its test, `availability.test.ts`,
`shippedVisualizations.test.ts` (`'Geo/Geo_Map.vue'`), the import path of
`shippedGeoMap.test.ts`, and B4's CLAUDE.md and packaging check (the library's
own CLAUDE.md instead of Visualization's). The preprocessor stays
`Standard.Visualization.Geo_Map.process_to_json_text`. For `Standard.Geo`, add
to B4's owner checklist: "a lat/lon table does **not** offer Geo Map until
`from Standard.Geo import all` is added; a saved Geo Map node in a project that
does not import Standard.Geo shows 'The library 'Standard.Geo' has no
visualization 'Geo Map'.' after 10 s", and say so in the PR body.

## Self-review notes

- Spec coverage: SQL home and Enso default (A2), SQL imports (A3), escaping fix
  (A4), Geo home (B3, Q1 variant), Geo imports and `builtins` widening (B2, B3),
  moved ids (A3, B3), allow-list (A1), dropped dependencies (B3), dead locators
  (A3, B3), docs and delivery (A5, B4).
- Names used across tasks: `BUILTIN_MODULE_NAMES`, `BuiltinModuleName` (A1, A3);
  `SQL_Query.vue`, `Geo_Map.vue`; `toGeoJSONs`, `boundingBox` (B3); library ids
  `Standard.Database` / `Standard.Visualization`.
