# Postgres and SQLite as their own libraries

The first step of the library system work (the core bundled set will be Base,
Table, Database, Visualization and Test; everything else becomes an ordinary
library). PostgreSQL and SQLite support move out of `Standard.Database` into
`Standard.Postgres` and `Standard.SQLite`, as DuckDB, Snowflake and Microsoft
already live in their own libraries. Nothing about the two backends justifies a
special place in Database.

Because a project then needs an import it did not need before, the IDE learns to
add imports itself: it notices when code uses a type from a library the module
does not import, and adds the import. And the engine's service lookup learns to
find providers in libraries that are installed but not loaded, so the
`Database.connect` dropdown, `Data.read` of a SQLite file and saved data links
keep working without an import.

## Decisions

- Existing projects are fixed by the GUI when they open: no compatibility shim
  in the libraries (`Standard.Database` cannot re-export the new libraries,
  which depend on it).
- The Postgres-flavoured dialect pieces that DuckDB and Redshift reuse become a
  public, backend-neutral base in Database; Database keeps no backend of its
  own.
- New projects' template does not import the two libraries; the dropdown lists
  every installed backend and the GUI adds the import when one is used.
- Only Postgres and SQLite move now. DuckDB, Snowflake, Microsoft and AWS stay
  in the template; taking them out later is a one-line change once the mechanism
  has proven itself.
- Discovery is done once, in the engine's service lookup, rather than per
  feature.

## Where things are today

(From a read of the code on 2026-10-30; `DB` =
`distribution/lib/Standard/Database/0.0.0-dev`.)

- Postgres and SQLite are ~6,300 lines of Enso: public types in
  `DB/src/Connection/` (`Postgres.enso`, `Postgres_Connection.enso`,
  `Data_Link/Postgres_Data_Link.enso`, `SQLite.enso`, `SQLite_Connection.enso`,
  `SQLite_Format.enso`, and the Postgres-only `SSL_Mode.enso`,
  `Client_Certificate.enso`), internals in `DB/src/Internal/Postgres/` and
  `DB/src/Internal/SQLite/`. `DB/src/Main.enso` exports `Postgres`, `SQLite` and
  `SQLite_Format`; `DB/package.yaml` registers their services (`File_Format_SPI`
  and `Database_Connection_Details_SPI` for SQLite; `Data_Link_SPI` and
  `Database_Connection_Details_SPI` for Postgres).
- They import only public Database modules, so they can move as they are.
- Java: `std-database` (`build.sbt`) carries the generic JDBC helpers, and also
  the `sqlite-jdbc` and `postgresql` drivers, the `sqlite-wrapper` natives, the
  native-image `SqliteJdbcPatchedFeature` and SQLite reflection config.
- DuckDB's dialect uses `Postgres_Connection.get_dialect` as its parent; AWS's
  Redshift uses `Postgres_Type_Mapping`, `Postgres.Helpers` and `Pgpass`.
- `Database.connect`'s `details` dropdown is built from
  `Meta.lookup_services Database_Connection_Details_SPI`, which only sees loaded
  packages (`LookupServicesNode` iterates `getLoadedPackagesJava`); DuckDB and
  the others appear only because the new-project template imports them.
- The GUI adds imports from suggestion-database entries (`module/imports.ts`:
  `requiredImports`, `analyzeImports`, `covers`; `module.ts`
  `addMissingImports`) when a component is chosen or some widgets apply a value.
  Nothing detects an unimported name in code, and the `Database.connect`
  dropdown's choices add no import.

## 1. Libraries and layering

**`Standard.SQLite`** (new): `SQLite` (`From_File`, `In_Memory`),
`SQLite_Format`, `SQLite_Connection`, and the dialect, type mapping, error
mapper, naming properties and services. Java: a new `std-sqlite` project with
`sqlite-jdbc`, the `sqlite-wrapper` natives and `SqliteJdbcPatchedFeature`.
`package.yaml` registers `File_Format_SPI` and
`Database_Connection_Details_SPI`.

**`Standard.Postgres`** (new): `Postgres` (`Server`), `Postgres_Connection`,
`SSL_Mode`, `Client_Certificate`, the data link and `Pgpass`. Java: a new
`std-postgres` project with the `postgresql` driver. `package.yaml` registers
`Data_Link_SPI` and `Database_Connection_Details_SPI`.

**`Standard.Database`** keeps everything backend-neutral (`Database.connect`,
`Connection`, `DB_Table`/`DB_Column`, the IR, `Credentials`,
`Connection_Options`, the JDBC helpers in `std-database`) and gains a public
**Postgres-family base**: the dialect and type-mapping pieces Postgres, DuckDB
and Redshift share, extracted from today's `Postgres_Dialect` and
`Postgres_Type_Mapping`. What goes into the base is decided by what DuckDB and
Redshift actually call. After the move Database contains no driver and no
backend.

Dependencies: Postgres and SQLite depend on Database. DuckDB depends on the
family base, not on Postgres. AWS (Redshift) depends on the base, and on
`Standard.Postgres` only for helpers that are truly Postgres-specific (`Pgpass`,
connection helpers) — or those move to the base if they turn out to be generic;
the implementation plan decides from the code.

The names are `Standard.Postgres` and `Standard.SQLite`, matching the types
users already write (`Postgres.Server`, `SQLite.From_File`).

Everything that moves with them: the edition
(`distribution/edition.template.yaml`), the `makeStdLibDistribution` entries,
legal-review and `THIRD-PARTY` files, the native-image settings in `build.sbt`,
`tools/ci/stdlib-test-map.yaml` (`libraries`, `stdBits`, `dependsOn`, test
`imports`), the imports of the test projects that use them (~55 `Table_Tests`
files, `Visualization_Tests`, `Base_Tests`' `Logging_Spec`,
`Generic_JDBC_Tests`, `DuckDB_Tests`), `std-tests`'
`LocalAuditedConnectionTest`, and the generated `docs/api` of every library
whose API changes.

## 2. Service discovery in the engine

`Meta.lookup_services` returns providers from every library the project can
resolve — the libraries of its edition and local library roots that are present
on disk — not only the loaded ones. It never downloads anything.

- **Order:** providers from loaded libraries first, then the others sorted by
  library name, so results are stable.
- **Cheap listing:** each library's `package.yaml` is read once per engine
  context for its `services:`; nothing is compiled.
- **Lazy loading:** each result is a supplier, as today. Resolving one ensures
  its package is loaded and compiles the provider's module. A caller that stops
  at its first match loads nothing more; `Data.read`'s format detection tries
  loaded providers first.
- **Failures are isolated:** a library that fails to load or compile is skipped
  with a logged warning; the other providers are still returned (today a failure
  panics the lookup).

This makes, without any import: the `Database.connect` dropdown list Postgres,
SQLite and every installed backend; `Data.read` recognise a SQLite file; and
saved data links of type `Postgres_Connection` resolve. Data links are looked up
by their registered type name across installed libraries, so the `libraryName`
in a saved file is advisory; the GUI's data link schema
(`app/gui/src/utils/datalinkSchema.json`) moves to `Standard.Postgres` and still
accepts `Standard.Database`.

**Cost:** the first lookup of a service in a session loads the libraries that
provide it. Shipped libraries have precompiled IR caches. The implementation
measures the dropdown's first open (which loads Postgres and SQLite); if it is
slow, the remedy is to warm the lookup in the background when a project opens.

**Tests:** an engine test with fixture libraries registering a service, one
never imported (found; loaded only when resolved) and one broken (skipped,
others returned). Enso tests: `Database_Widgets_Spec` lists SQLite and Postgres
without importing them (replacing its `import Standard.AWS` workaround);
`Data.read` of a `.db` file works without importing SQLite.

## 3. The GUI's unresolved-name detector

A pure function next to `module/imports.ts`:
`missingImports(module AST, suggestion database, current imports) → RequiredImport[]`.

- It collects capitalised names that start an expression or a qualified access
  (`Postgres` in `Postgres.Server …`, `SQLite` in `SQLite.From_File …`).
- It skips names the module binds, names already covered by an import
  (`analyzeImports`, `covers`), and autoscoped `..Name` forms (they depend on
  the expected type).
- It looks the name up among types in the suggestion database. Exactly one match
  gives that entry's `requiredImports` (the existing function, so re-exports are
  respected); several matches give nothing — the user chooses, as today.
- The import form is `from Standard.X import all`, the existing default for a
  type.

It runs, each run as one undoable edit:

1. **When a node's expression is committed** in the graph editor (new or
   edited), over that node.
2. **When a widget choice is applied:** the `Database.connect` dropdown's values
   (`(Postgres.Server 'localhost' 5432)`, `SQLite.From_File`) go through the
   detector, replacing the bare-qualified-name lookup in
   `WidgetSelection/tags.ts`.
3. **When a project opens,** over each module once — the fix for old projects.
   Imports added this way are logged, and one short notice says which imports
   were added.

The text code editor is not hooked (running the detector on every keystroke
would be wrong); the next project open covers edits made there.

**Tests:** vitest unit tests of `missingImports` (unimported `Postgres.Server` →
the import; already imported by `from … import all` or qualified → nothing; a
local binding of the same name → nothing; an ambiguous name → nothing; a type
defined in the project → nothing; `..Server` → nothing). A Playwright test:
choosing Postgres in the `Database.connect` dropdown adds the import; opening a
project whose `Main.enso` uses `SQLite.In_Memory` with only `Standard.Database`
imported adds the SQLite import.

## 4. Compatibility and rollout

| What                                    | How it keeps working                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Old projects                            | The GUI adds the import when the project opens (section 3)                         |
| Old `.datalink` files                   | Resolved by type name across installed libraries (section 2)                       |
| `Data.read` of `.db` / `.sqlite` files  | Discovery (section 2)                                                              |
| `Database.connect`'s `macros:`          | Stay code strings (`Postgres.Server`, `SQLite.From_File`); the GUI adds the import |
| Code run outside the IDE (`enso --run`) | Needs the import added by hand; the changelog entry says so                        |

Five PRs, in order:

1. **Engine:** service discovery over installed libraries (no visible change on
   its own).
2. **GUI:** the detector and its three triggers. Useful at once for the
   libraries already separate. A feature: changelog entry; merges after the
   user's OK.
3. **Database:** extract the Postgres-family base and move DuckDB and Redshift
   onto it (no visible change).
4. **SQLite out** (needs 1 and 2): the library, `std-sqlite`, edition,
   native-image settings, legal files, test imports, the test map, API docs.
5. **Postgres out** (needs 1, 2 and 3): the same, plus the data link schema.

PRs 4 and 5 share one changelog entry ("PostgreSQL and SQLite are now the
libraries `Standard.Postgres` and `Standard.SQLite`; the IDE adds their
imports") and merge after the user's OK.

**Verification beyond CI:** a native-image and installer build on Windows and on
Linux/WSL, because SQLite's native libraries move to a new library directory: a
fresh project, `Database.connect`, choose SQLite, read a table. And an old
project using `SQLite.In_Memory` opens, gets its import, and runs.

## Out of scope

- Taking DuckDB, Snowflake, Microsoft and AWS out of the new-project template.
- Fetching libraries that are not installed (the library system's later steps).
- Hooking the text code editor into the detector.
- The rest of the library system: the core bundled set, release-zip publishing,
  the user's own library collection.

## Amendments (2026-10-30, from planning)

Writing the implementation plan against the code showed several statements above
to be wrong or impossible. These amendments replace the statements they name;
where they conflict, the amendment wins.

1. **How the GUI learns which library defines a type (user's decision).** The
   suggestion database holds only the types of libraries the engine has loaded,
   so for an old project that uses `SQLite.In_Memory` without the import it has
   no entry for `SQLite`. Every library outside the core set therefore
   **declares its public types** in its `package.yaml`, in a new `public-types:`
   list (for example `public-types: [SQLite, SQLite_Format]`). A check in
   `tools/ci/check-workflows.mjs` fails a library whose list differs from the
   types its `Main.enso` exports. The engine's discovery (section 2) reads the
   list together with `services:`, and the language server gains one request
   that returns, for every installed library, its declared types (name →
   library). The GUI asks for it once per project open and caches it; the
   detector (section 3) consults the suggestion database first and this map
   second. No table of libraries lives in the GUI.
2. **`SSL_Mode` and `Client_Certificate` stay in `Standard.Database`:** Redshift
   uses them too (section 1 said Postgres-only).
3. **The Postgres-family base** is `Standard.Database.Postgres_Family` (not
   exported from `Main.enso`) and takes the encoding helpers. `Pgpass` stays
   with Postgres; Redshift stops reading `.pgpass` (user's decision, 2026-10-30:
   `.pgpass` is a libpq client convention the Redshift driver does not use; Enso
   read it for Redshift untested, and `AWS_Credential.Default` read it alongside
   IAM). AWS still never depends on `Standard.Postgres` (resolves section 1's
   open point).
4. **Lookup order (section 2).** The builtin resolves every provider before
   returning, so "a caller that stops at its first match loads nothing more"
   cannot hold as written. `Meta.lookup_services` gains a `loaded_only`
   argument; callers that stop at a first match (format detection) ask the
   loaded libraries first and the installed ones only when none matched. The
   dropdown asks for all.
5. **"Installed"** means resolvable without a download: libraries of the edition
   present in the local cache or the bundle, plus local libraries when the
   project prefers local ones.
6. **Import form (section 3).** Imports are added in the form `requiredImports`
   already produces, `from Standard.X import Name` (not `import all`). A name is
   skipped when an existing import covers it (`covers`).
7. **Project open (section 3)** checks `Main.enso` only: the GUI never opens
   other modules.
8. **Tests "without an import" (section 2)** run as a subprocess spec
   (`Library_Discovery_Spec`), because other files of the same test project
   import the libraries.
9. **Test files to touch (section 1)** are about 20 (14 in `Table_Tests`, 3 in
   `Visualization_Tests`, 1 in `Base_Tests`, 2 in `Generic_JDBC_Tests`), not
   ~55.

Amendment 1 adds work to PRs 1 (discovery reads `public-types:`; the language
server request) and 2 (the GUI uses it), and to PRs 4 and 5 (the new libraries
declare their types).
