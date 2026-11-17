# Library visualizations, addendum: SQL Query and Geo Map leave the GUI

Status: approved (2026-11-16; the owner chose the recommendation on Q1, Q2 and
Q3). Addendum to `2026-11-16-library-visualizations-design.md` (#808,
implemented by #817), whose "Not in scope" names these two moves as follow-ups
once Image proves the path. To be built only after the owner approves the Image
move (#817). Plan:
`docs/superpowers/plans/2026-11-16-sql-geo-library-visualizations.md`.

## Goal

The SQL Query and Geo Map visualizations ship in a library's `visualizations/`
folder, as Image does after #817, and the GUI keeps no code that only they need,
except what belongs to the IDE itself (the Mapbox token setting).

## What each one needs today

A run-time compiled visualization can import only `vue`, `d3`, the GUI's
`builtins` module (`useVisualizationConfig`, `defineKeybinds`), relative `.vue`
/ `.ts` / asset files of its own folder, and scripts it lists in `scripts`. Any
other bare import is left as written by the compiler (`rewriteImports` in
`stores/visualization/compiler.ts`) and fails in the browser; a dynamic
`import('x')` is never rewritten at all. Every import of the two files, and what
to do with it:

| Visualization | Import                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL Query     | `DEFAULT_THEME`, `RGBA`, `Theme` from `visualizations/builtins.ts` | **Inline.** 15 lines (a hash of the type name to a colour); SQL is its only user.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SQL Query     | `stopCopy` from `@/util/shortcuts`                                 | **Inline.** Three lines: stop `Mod+C` from reaching the graph editor so the browser copies the selected text.                                                                                                                                                                                                                                                                                                                                                                                        |
| SQL Query     | `await import('sql-formatter')` (npm, ~200 KB, lazy chunk)         | **Owner question Q2.** Recommended: add it to the run-time module cache as a lazy module, like `d3`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| SQL Query     | `vue`                                                              | Allowed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Geo Map       | `useVisualizationConfig` from `@/util/visualizationBuiltins`       | Allowed: it is `builtins`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Geo Map       | `bbox` from `@turf/bbox` (npm)                                     | **Inline** a 20-line bounding box over GeoJSON coordinates; drop the `@turf/bbox` dependency (Geo Map is its only user). An empty layer gives no box instead of turf's `[∞, ∞, -∞, -∞]`.                                                                                                                                                                                                                                                                                                             |
| Geo Map       | `useMapboxToken` from `$/providers/mapboxToken`                    | **Owner question Q3.** The token is an IDE setting (Settings → Local → Maps, `localStorage`), not library data.                                                                                                                                                                                                                                                                                                                                                                                      |
| Geo Map       | `redactAccessToken` from `$/utils/redact`                          | **Q3.** Keeps the token out of the console log of Mapbox errors.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Geo Map       | `./GeoMapVisualization/MapboxTokenMissing.vue`                     | **Q3.** The empty state uses the app's `Result` and `Button`, its text catalogue and its router (to open Settings), none of which a library can reach.                                                                                                                                                                                                                                                                                                                                               |
| Geo Map       | `mapbox-gl` (global from `scripts`, type-only import)              | Still loaded from `api.tiles.mapbox.com` through `scripts`, but a library visualization's scripts now load when its view is first requested, not when its file is compiled (this PR makes it so: every project open would otherwise download Mapbox GL, and offering the view would wait on the CDN). The type-only `typeof import('mapbox-gl')` and `GeoJSON.*` types are replaced by small local types, since a library file is not type-checked; the `mapbox-gl` devDependency (types only) goes. |
| Geo Map       | `vue`                                                              | Allowed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Nothing in either file is impossible to move; two need the `builtins` set
widened, which the parent spec ruled out for Image ("This design does not widen
that set") and is therefore the owner's call.

## Decisions

### SQL Query goes to Standard.Database

- **Where:**
  `distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue`,
  registered as `{ kind: 'Library', name: 'Standard.Database' }`, name
  `SQL Query`. Its `inputType` is
  `Standard.Database.DB_Table.DB_Table | Standard.Database.DB_Column.DB_Column`,
  so any value it can show already means Standard.Database is loaded: offering
  does not change for anyone.
- **Enso:** `DB_Table_Implementation.default_viz_id` answers
  `Id.Library "Standard.Database" "SQL Query"`; `Id.sql_query` is deleted (its
  only user). The golden `default_db_table.json` becomes
  `{"library":{"name":"Standard.Database"},"name":"SQL Query"}`.
- **The data stays in Standard.Visualization.** `SQL_Viz` and its preprocessor
  `Standard.Visualization.SQL.Visualization.prepare_visualization` stay where
  they are: `Standard.Table` defines `SQL_Viz.from (that:Table)` and
  `SQL_Viz.from (that:Column)`, and Table cannot import Database (Database
  depends on Table). The visualization's `defaultPreprocessor` is unchanged, so
  the integration-test mock (`lsHandler.ts`) needs no change.
- **A fix carried by the move (own commit):** the view inserts the formatted SQL
  with `v-html`, and the interpolated values (user data: a filter's text, a
  column name) and the code are not escaped, so a text value `<b>x</b>` renders
  bold. The comment claims "it is not user input"; it is. The moved file formats
  with placeholder parameters, escapes the whole output, then puts the coloured,
  escaped values in. No change for ordinary values.

### Geo Map goes to Standard.Visualization (owner question Q1)

The parent spec assumed `Standard.Geo`. The research says otherwise:

- Geo Map's `dataType` is `Standard.Visualization.Viz_Table.Viz_Table`: it is
  offered for anything that converts to `Viz_Table` (an in-memory or database
  table, a column, a vector). Its data comes from
  `Standard.Visualization.Geo_Map.process_to_json_text`, and its column-name
  rules (`Geo_Map.name_sets`) are used by `Standard.Database`'s `DB_Viz_Source`.
  `Standard.Geo` (`Geo`, `geo_distance`) has no part in it and is imported by no
  other library.
- A library's visualizations appear only once the language server loads that
  library (`DefaultPackageRepository` reports every loaded library, transitive
  ones included). `Standard.Visualization` is loaded by `Standard.Table` (which
  imports `SQL_Viz`), by `Standard.Database`, by the new-project template
  (`import Standard.Visualization`) and by every built-in visualization's
  preprocessor. `Standard.Geo` is loaded only if the user imports it.
- So in `Standard.Geo`, a user with a table of latitude/longitude columns would
  no longer be offered the map until they import `Standard.Geo`, which nothing
  tells them to do, and a node saved with the map open would wait 10 s and then
  show "The library 'Standard.Geo' has no visualization 'Geo Map'." In
  `Standard.Visualization`, offering is what it is today.

Recommended:
`distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue`,
registered as `{ kind: 'Library', name: 'Standard.Visualization' }`, name
`Geo Map`. `Id.geo_map` is deleted (only `Id_Spec` uses it; no type defaults to
the map).

### The Mapbox token stays an IDE setting

The token setting (Settings → Local → Maps, `$/providers/mapboxToken`), its
redaction from logs and error reports (`$/utils/redact`, which also blocks
`.GeoMapVisualization` from Sentry Replay, so the moved file keeps that class)
and the "Maps need a Mapbox access token" empty state stay in the GUI: they are
the IDE's own settings UI. If Q3 is approved, `builtins` exports
`useMapboxToken`, `redactAccessToken` and the `MapboxTokenMissing` component
(moved to `components/visualizations/MapboxTokenMissing.vue`), and the library
file imports them from `builtins`. The empty state looks exactly as today.

### Moved ids

Rows added to `movedVisualizations.ts`, so saved projects keep their views:

| Old id                | Now                                                     |
| --------------------- | ------------------------------------------------------- |
| `Builtin` `SQL Query` | `Library` `Standard.Database`, name `SQL Query`         |
| `Builtin` `Geo Map`   | `Library` `Standard.Visualization`, name `Geo Map` (Q1) |

### One allow-list for what a visualization may import

Today the set of bare modules lives only in `compilerMessaging.ts`'s
`moduleCache`, and nothing checks a shipped file against it: the shipped-files
test of #817 mounts a library file through Vite, which resolves any npm import
and so would pass a file the IDE cannot load. The SQL PR adds
`stores/visualization/builtinModules.ts` (`BUILTIN_MODULE_NAMES`), makes
`moduleCache` satisfy it (the compiler checks both directions) and adds a test
that compiles every shipped library visualization and fails on any bare import
outside the list and on any dynamic `import()`. A widening of `builtins` then
shows up as a one-line diff to that list.

### Dropped GUI dependencies

`@turf/bbox` and `mapbox-gl` (types only) leave `app/gui/package.json`.
`sql-formatter` stays (as a lazy module of the cache) if Q2 is approved.

## Owner questions

- **Q1. Where does Geo Map go?** Recommended: **Standard.Visualization** (it
  owns the map's data and is loaded whenever a table is; offering is unchanged).
  Alternatives: Standard.Geo, as the parent spec said (the map disappears for
  users who have not imported Standard.Geo; the view and its data would live in
  two libraries); Standard.Table (always loaded with a table, but the data and
  preprocessor are in Visualization).
- **Q2. May `builtins` grow a lazy `sql-formatter` module?** Recommended:
  **yes** — one line in `moduleCache`
  (`get 'sql-formatter'() { return import('sql-formatter') }`), the GUI bundle
  is unchanged (the formatter is a lazy chunk today), and the view works
  offline. Alternatives: load it from a CDN through `scripts` and show the SQL
  unformatted when offline; or keep the SQL view in the GUI.
- **Q3. May `builtins` export the Mapbox token, its redaction and the
  token-missing empty state?** Recommended: **yes** — the token is an IDE
  setting a library cannot own, and three exports keep the map's behaviour
  (setting link, redacted logs, Replay block) exactly as now. Alternative: keep
  Geo Map in the GUI and move only SQL Query.

If Q2 is declined, the SQL PR is dropped (or uses the CDN variant); if Q3 is
declined, the Geo Map PR is dropped. The two PRs are otherwise independent.

## Testing

- **Run-time compatibility:** the allow-list test above, plus #817's compile
  test, cover both files.
- **SQL Query:** a mount test of the shipped file: formatted SQL with coloured,
  escaped interpolations; the error text; `Mod+C` not propagating; a value with
  markup shown as text.
- **Geo Map:** the existing `GeoMapVisualization.test.ts` cases, ported to mount
  the shipped file (token missing → empty state and Settings link; token set,
  changed, cleared; non-map data; Replay block; redacted errors), plus unit
  tests of the inlined bounding box.
- **Store:** `availability.test.ts` registers the two from their library files
  under library ids and keeps its expectations; `movedVisualizations.test.ts`
  gains the two rows.
- **Enso:** `Id_Spec`, `Table_Conversions_Spec` ("the default visualisation of a
  database table is the SQL view"), the `default_db_table` golden.
- **Integration tests:** none use these views (the `sqlVisualization` locator
  names a class, `.SqlVisualization`, that never existed; both locators are
  unused and are removed). The preprocessor mocks stay.
- **Hand test (installer):** a database table opens in SQL Query; a lat/lon
  table offers Geo Map without importing anything new; with and without a Mapbox
  token; a project saved before the change keeps both views.

## Delivery

Two PRs, each after #817 is merged, SQL first (it brings the allow-list): no
changelog entry (nothing changes for users; label `CI: No changelog needed`),
before/after screenshots of each view, and merge on the owner's OK after an
installer test, as for Image.

## Owner answers (2026-11-16)

- Q1: Geo Map goes to Standard.Visualization.
- Q2: yes, `builtins` gains the lazy `sql-formatter` module.
- Q3: yes, `builtins` exports `useMapboxToken`, `redactAccessToken` and the
  `MapboxTokenMissing` component.
