# Postgres and SQLite Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PostgreSQL and SQLite support out of `Standard.Database` into
`Standard.Postgres` and `Standard.SQLite`, with no project broken by the move:
the engine's service lookup finds providers in installed libraries, libraries
outside the core set declare their public types, and the IDE adds the imports
that code needs.

**Architecture:** Five tasks, each its own PR against `develop` from its own
worktree and branch. Task 1 (engine and language server: `Meta.lookup_services`
over installed libraries, `public-types:` in `package.yaml` with its check, and
the `library/listPublicTypes` request) must merge before Task 2 (GUI: the
unresolved-name detector, its three triggers, and the declared-types map from
that request). Task 3 (a Postgres-family base in `Standard.Database` that DuckDB
and Redshift build on, and Redshift no longer reading `.pgpass`) is independent.
Task 4 (SQLite out) needs Tasks 1 and 2; Task 5 (Postgres out) needs Tasks 1–4.

**Tech Stack:** Java and Scala (`engine/runtime`, `engine/language-server`,
`lib/scala/library-manager`, `lib/scala/pkg`; JUnit and ScalaTest), Enso (the
standard library and `test/*_Tests`), sbt (`build.sbt`), TypeScript and Vue with
vitest and Playwright (`app/gui`, `app/ydoc-shared`), Node (`tools/ci`), YAML
(`package.yaml`, `tools/ci/stdlib-test-map.yaml`,
`distribution/edition.template.yaml`), JSON Schema
(`app/gui/src/utils/datalinkSchema.json`).

**Spec:**
`docs/superpowers/specs/2026-10-30-postgres-sqlite-libraries-design.md` (merged
#460), with its section "Amendments (2026-10-30, from planning)", which wins
where it differs from the sections above it. Paths below use `DB` =
`distribution/lib/Standard/Database/0.0.0-dev`, `SQ` =
`distribution/lib/Standard/SQLite/0.0.0-dev` and `PG` =
`distribution/lib/Standard/Postgres/0.0.0-dev`. The **core set** is Base, Table,
Database, Visualization and Test; every other library under
`distribution/lib/Standard` declares `public-types:` (Amendment 1).

## Global Constraints

- The spec's Decisions and Amendments stand: the GUI fixes old projects when
  they open (no compatibility shim in the libraries); the Postgres-flavoured
  pieces DuckDB and Redshift reuse become a public, backend-neutral base in
  Database, which keeps no backend; the new-project template
  (`lib/scala/pkg/src/main/resources/default/src/Main.enso`) does not import the
  two libraries; only Postgres and SQLite move; discovery is done once, in the
  engine's service lookup; no table of libraries lives in the GUI.
- Changelog: features and visible changes get a `CHANGELOG.md` entry: every task
  has one (Tasks 4 and 5 share theirs), so none takes the
  `CI: No changelog needed` label. An entry is `- [Description][NNN]` with
  `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`, NNN the PR's own number
  (open the PR, then add the entry).
- A change to a standard library's public signatures regenerates that library's
  committed `docs/api`
  (`sbt "runEngineDistribution --no-ir-caches --docs=api --in-project <library dir>"`,
  after `git rm` of the files of moved modules: the generator does not delete
  stale files), and `corepack pnpm --filter build-scripts run stdlib-api-check`
  passes.
- Verify on Linux (WSL; source `~/.enso-toolchain.sh` first, give cargo its own
  `CARGO_TARGET_DIR`) as well as Windows, as the root `CLAUDE.md` says.
- Run an Enso test project from `test/` (the project root's parent), with
  `JAVA_TOOL_OPTIONS="-enableassertions"`, and check that tests actually ran: a
  filter that matches nothing still exits 0.
- Java and Scala changes pass `sbt "scalafmtCheckAll; javafmtCheckAll"` (run
  `javafmtAll` and `scalafmtAll` first).
- `node tools/ci/check-workflows.mjs` and `node --test tools/ci/*.test.mjs` pass
  after any change to `tools/ci/`, to a library's `package.yaml` or `Main.enso`,
  or to a test project's imports.
- GUI changes pass `corepack pnpm --filter enso-gui run typecheck`, `run lint`
  and `run test:unit`, and `corepack pnpm exec prettier --check` on the changed
  files; Playwright with
  `corepack pnpm --filter enso-gui run test:integration -- <spec>`.
- Every task merges after the user's OK (an installer test for Tasks 2, 4 and
  5). Task 2 is a UI PR: before/after screenshots on the orphan `pr-screenshots`
  branch, linked from the PR.
- Never run `git stash` in any form, `git reset --hard`, a force-push or
  `--no-verify`; leave `.claude/settings.local.json` out of commits. PR bodies
  are written with the Write tool and passed with `--body-file`, say "Part of
  the library system (#412)", and end with the session's attribution. Commit
  messages end with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

## Rulings made while planning

Decided by the spec's Amendments (recorded there; the plan follows them):

- **Lookup order and `loaded_only` (Task 1) — Amendment 4.** The builtin gains
  `loaded_only`; the callers that stop at their first match (`get_format`,
  `find_format_for_data_link`, `Data_Link_SPI.find_data_link_type`,
  `File_System_SPI.get_type`,
  `Database_Connection_Details_SPI.resolve_constructor`) ask the loaded
  libraries first and the installed ones only when that finds nothing; the
  dropdown (`get_default_constructors`) asks for all.
- **"Installed" (Task 1) — Amendment 5.** Resolvable without a download: the
  edition's libraries in a cache or the bundle
  (`PublishedLibraryCache.findCachedLibrary`), plus local libraries when the
  project prefers local ones.
- **`SSL_Mode` and `Client_Certificate` stay in Database (Task 5) —
  Amendment 2.** `Redshift_Details.enso:5,8` imports both.
- **The Postgres-family base (Task 3) — Amendment 3.**
  `Standard.Database.Postgres_Family`, not exported from `Main.enso`, holding
  the dialect, type mapping, error mapper and `Helpers` (Redshift still calls
  `get_encoding_name` and `parse_postgres_encoding`,
  `Redshift_Connection.enso:30`; DuckDB calls neither). `Pgpass` stays with
  Postgres and moves in Task 5; Redshift stops reading `.pgpass` (the user's
  decision); AWS never depends on `Standard.Postgres`.
- **Import form and covered names (Task 2) — Amendment 6.** Imports take the
  form `requiredImports` produces (`from Standard.X import Name`); a name is
  skipped when an existing import covers it (`covers`). The open notice shows
  only when imports were added.
- **Project open checks `Main.enso` (Task 2) — Amendment 7.**
  `createModuleStore` opens only `FILE_NAME = 'Main.enso'`.
- **"Without an import" in a subprocess (Tasks 1, 4, 5) — Amendment 8.**
  `test/Table_Tests/src/Database/Library_Discovery_Spec.enso` runs a project
  made with `Enso_Bin_Utils` (`test/Base_Tests/src/Enso_Bin_Utils.enso`) whose
  `Main.enso` imports neither library. `Database_Widgets_Spec` proves discovery
  in Task 1 for the backends no file of its project imports (Redshift, DuckDB,
  Snowflake, SQL Server).
- **Test files to touch (Tasks 4, 5) — Amendment 9.** 14 in `Table_Tests`, 3 in
  `Visualization_Tests`, 1 in `Base_Tests` (inside a generated project's
  source), 2 in `Generic_JDBC_Tests`.
- **Declared public types (Tasks 1, 2, 4, 5) — Amendment 1.** Implemented as
  below.

Made while planning, with the evidence:

- **What counts as a "public type" (Task 1).** The names a library's
  `src/Main.enso` exports at top level: the last segment of `export a.b.C`, or
  its alias in `export a.b.C as D`, and each name of `from a.b export C, D`,
  keeping only capitalised names (a type, or a module used like one, such as
  `OneDrive_File`; lowercase names are functions like Geo's `geo_distance`).
  Types defined in `Main.enso` itself are not exported and do not count
  (`Standard.Examples` defines three and exports none, so it declares
  `public-types: []`, like `Google_Api` and `Searcher`, whose `Main.enso` export
  nothing). The check reuses `check-workflows.mjs`'s way of reading Enso sources
  (`ensoFiles`, a `^`-anchored multiline regex like `ENSO_IMPORT`, so an
  indented example in a doc comment does not count). Cost if wrong: a library
  whose users write a non-exported name gets no automatic import for it.
- **The language server lists the types itself (Task 1).** The language server
  does not share the runtime's package repository, so `library/listPublicTypes`
  computes the same listing with the code the engine uses: the listing moves out
  of `DefaultLibraryProvider` into `InstalledLibraries.find` (library-manager),
  which both the runtime (`DefaultLibraryProvider.findInstalledLibraries`) and
  the handler call, and reads each installed library's `package.yaml` with
  `PackageManager.Default`. The two use the same rule for what is installed, but
  not the same moment: the runtime lists once per context, the language server
  on each request, so a library created while a project is open shows in
  `library/listPublicTypes` at once and in service discovery after the project
  is reopened (Note [Service Discovery Over Installed Libraries]). Cost if
  wrong: that window.
- **The GUI's map is loaded beside the suggestion database (Task 2).**
  `createSuggestionDbStore` asks `library/listPublicTypes` once per project open
  and keeps `libraryPublicTypes` (name → the libraries declaring it) and
  `publicTypesLoaded`; the open trigger waits for `loaded`, `publicTypesLoaded`
  and the module's root (ruling below). A failed request is logged and leaves
  the map empty. `loaded` keeps its meaning, so
  `suggestionDatabase/__tests__/loaded.test.ts` only gains a mock for the new
  request. A name that several libraries declare gives nothing (the user
  chooses). Cost if wrong: an old project opened while the language server
  cannot answer gets no imports until it is reopened.
- **A broken installed provider is skipped, a broken loaded one still warns
  (Task 1).** For a library that discovery loads, a failure to load, compile or
  find the type is logged at WARNING and the provider left out (the spec). For
  an already loaded library the behaviour is today's: a `DataflowError` element,
  which `Meta.lookup_services` turns into a warning (`MetaServicesTest` keeps
  passing). Cost if wrong: none for users; the difference is visible only in a
  warning.
- **The base keeps the modules' names (Task 3).** DuckDB uses the whole dialect
  as its parent (eight methods and `get_dialect_operations`,
  `DuckDB_Dialect.enso:43-320`), so the base is the whole of today's
  `Postgres_Dialect`, plus `Postgres_Type_Mapping` (Redshift calls
  `sql_type_to_text`, `Redshift_Type_Mapping.enso:119`) and its
  `Postgres_Error_Mapper`. Keeping file and type names makes Task 3 a pure move
  plus import rewrites. The modules lose their `private` module keyword. The
  dialect still names itself `PostgreSQL`. Cost if wrong: a later rename of four
  modules.
- **The dropdown keeps its qualified-path lookup (Task 2).**
  `ExpressionTag.FromExpression` resolves a fully qualified value to a
  suggestion entry and gives it a label as well as imports; other widgets rely
  on that. The detector runs in `ExpressionTag.resolveExpression` for a tag that
  has no `requiredImports`, which is the case for
  `(Postgres.Server 'localhost' 5432)` and `SQLite.From_File`. Cost if wrong:
  none; both paths add the same import.
- **`Visualization_Tests` stops importing AWS (Task 1).** Dropping the
  `import Standard.AWS` workaround drops `AWS` from its `imports` in
  `tools/ci/stdlib-test-map.yaml` (`checkStdlibTestMap` requires an exact
  match), so an AWS-only PR no longer selects `Visualization_Tests`. `develop`
  still runs every project. Cost if wrong: a Redshift regression in the dropdown
  is caught on `develop`, not on the PR.
- **`Generic_JDBC_Tests` imports the libraries whose drivers it uses (Tasks 4,
  5).** A library's jars join the shared host class path only when the library
  is loaded (`registerPackageInternal` → `EnsoContext.addToClassPath`), and
  `JDBCProxy` finds drivers through that class loader. The SQLite and Postgres
  specs of `Generic_JDBC_Tests` connect by URL, so each imports its library. The
  same holds for users of `Generic_JDBC` with a `jdbc:sqlite:` or
  `jdbc:postgresql:` URL; the changelog entry says so. Cost if wrong: none.
- **The SQLite native-image feature moves with its library, under
  `org.enso.sqlite` (Task 4).** `SqliteJdbcPatchedFeature`, its
  `native-image.properties` and the two `org.sqlite` entries of
  `reflect-config.json` move to `std-bits/sqlite`; `build.sbt`'s `stdLibsJars`
  puts `std-sqlite`'s full class path on the image class path instead of
  `std-database`'s. `org.enso.sqlite` joins `STD_BITS_PACKAGE_ROOTS`
  (`app/gui/src/project-view/components/EngineLogs/engineLogModel.ts`), whose
  test reads `std-bits/*/src/main/java/org/enso/*`. The two SQLite resource
  patterns in `std-bits/table/.../resource-config.json` stay: that file is on
  the image class path whatever library ships the jar. Cost if wrong: a native
  image without SQLite, caught by the installer check.
- **`std-postgres` has a `CLAUDE.md` (Task 5).** It has no Java of its own (it
  ships the driver), like `std-generic-jdbc`, which has no tracked files and so
  no `stdBits` entry. `std-bits/postgres/CLAUDE.md` makes the directory exist in
  a checkout, so the map lists `stdBits: [postgres]` and a change to the
  driver's build runs Postgres's tests. Cost if wrong: none.
- **Old data links stay valid through a hidden schema branch (Task 5).** The
  datalink editor needs `const` to fill `libraryName` in a new link
  (`app/gui/src/utils/jsonSchema.ts`, `constantValueOfSchemaHelper`), so
  `PostgresDataLink` says `Standard.Postgres`, and a copy,
  `PostgresLegacyDataLink`, says `Standard.Database`; `DatalinkInput.vue`'s
  `UNAVAILABLE_SCHEMAS` keeps the copy out of the type list, and
  `JSONSchemaInput` still shows it when a link already uses it. The engine
  writes `Standard.Postgres` (`Postgres.enso:155`); the four
  `test/Table_Tests/data/datalinks/postgres-*.datalink` fixtures keep
  `Standard.Database`, so `Postgres_Spec` keeps proving that old files work.
  Cost if wrong: an old link opens in the editor as the hidden branch.
- **The first open of the dropdown is measured, not optimised (Tasks 4, 5).**
  The spec's remedy (warm the lookup when a project opens) is built only if the
  installer check's first open of the `Database.connect` dropdown takes more
  than 5 s on Windows; then a follow-up ticket, not this plan. Cost if wrong: a
  slow first open until that ticket lands.
- **Which callers list everything and which try loaded libraries first (Task 1,
  the controller's ruling).** A widget or dropdown lists every installed
  provider; a caller that stops at a first match tries the loaded providers
  first (`loaded_only=True`), then all. Every caller (from
  `git grep -n "Meta.lookup_services\|File_Format_SPI.get_\|File_System_SPI.get_\|Database_Connection_Details_SPI.get_\|_get_known_return_classes\|get_known_email_providers\|File_Format.all\b" -- distribution`):

  | Caller                                                                                                                                                      | Kind                                | Decision     |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------ |
  | `File_Format.enso` `get_format` (43; `Auto_Detect.get_reading_format`/`get_writing_format`, so `Data.read`, `Enso_File.enso:511`, `Response_Body.enso:110`) | first match                         | loaded first |
  | `File_Format.enso` `File_Format.all` (108)                                                                                                                  | list (`name_filter_widget`, 181)    | all          |
  | `File_Format.enso` `File_Format.resolve` (117)                                                                                                              | first match                         | loaded first |
  | `File_Format.enso` `all_known_name_patterns` (166; the file dialog's "All known formats")                                                                   | list                                | all          |
  | `File_Format.enso` `default_widget` (172)                                                                                                                   | widget                              | all          |
  | `File_Format.enso` `find_format_for_data_link` (601)                                                                                                        | first match                         | loaded first |
  | `Internal/Data_Read_Helpers.enso` `format_widget_with_raw_response` (65)                                                                                    | widget                              | all          |
  | `Network/HTTP/Response_Body.enso` `decode_format_selector` (227)                                                                                            | widget                              | all          |
  | `Table/.../Internal/Widget_Helpers.enso` `write_table_selector` (331)                                                                                       | widget                              | all          |
  | `Data/Read/Return_As.enso` `Return_As.resolve` (55)                                                                                                         | first match                         | loaded first |
  | `Data/Read/Return_As.enso` `default_widget` (68)                                                                                                            | widget                              | all          |
  | `Network/Email/Email_Provider.enso` `resolve` (37)                                                                                                          | first match                         | loaded first |
  | `Network/Email/Email_Provider.enso` `default_widget` (29)                                                                                                   | widget                              | all          |
  | `Enso_Cloud/Data_Link.enso` `find_data_link_type` (246)                                                                                                     | first match                         | loaded first |
  | `System/File.enso` `File_System_SPI.get_type` (96)                                                                                                          | first match                         | loaded first |
  | `System/File.enso` `File.new`'s `.any` check (103)                                                                                                          | membership of a loaded value's type | loaded only  |
  | `System/File.enso` `File.new`'s error message (104)                                                                                                         | list, only on error                 | all          |
  | `Database.enso` `get_default_constructors` (46, the dropdown)                                                                                               | widget                              | all          |
  | `Database.enso` `resolve_constructor` (81)                                                                                                                  | first match                         | loaded first |

  One behaviour changes visibly beyond the dropdowns: `Data.read_many` without
  `Standard.Table` imported now returns the merged `Table` (its `Return_As` is
  found among the installed libraries) instead of failing with "Standard.Table
  is not imported"; `test/Base_Tests/src/System/File_Read_Spec.enso:169-176` is
  rewritten for it (Task 1 Step 8). Cost if wrong: a dropdown lists formats
  whose library is loaded on first use, which is the intent.

- **Task 1 is user-visible (the controller's ruling).** From Task 1 on, the
  connection, format, return-type and e-mail dropdowns list installed libraries
  that are not imported, so Task 1 has a changelog entry under
  `#### Enso Standard Library` and merges after the user's OK.
- **The open check waits for the module too (Task 2).** `root` is set by the
  module observer, possibly after the suggestion database and the declared types
  have loaded, so the check runs once when all three are ready (`whenReadyOnce`
  in `module/openImportCheck.ts`, unit-tested in both orders). Cost if wrong:
  none.
- **The open check's edit is not undoable (Task 2, the controller's ruling).**
  The undo manager tracks only `localUserActionOrigins`
  (`app/ydoc-shared/src/yjsModel.ts:195-207`; `module.ts` adds each as a tracked
  origin), and edits made with another origin, like `'local:autoLayout'`
  (`nodesDisplacing.ts:37`) and `'local:derivedMetadata'` (`graph.ts:425`), are
  not undone. The open check edits with a new origin, `'local:autoImport'`,
  added to `Origin` and `tryAsOrigin` beside them, so Ctrl+Z after opening does
  not remove the imports. The node-commit and widget triggers stay inside the
  user's edit and undo with it. Cost if wrong: none.
- **macOS signing follows the SQLite jar (Task 4).**
  `app/electron-client/tasks/signArchivesMacOs.ts:112` signs the natives in
  `lib/Standard/Database/*/polyglot/java/sqlite-jdbc-*.jar`; Task 4 points it at
  `lib/Standard/SQLite/`. The file has no Postgres entry (the `postgresql` jar
  has no natives), so Task 5 does not touch it. Signing runs only in the release
  workflow on macOS, so it cannot be verified locally; the PR says so. Cost if
  wrong: an unsigned SQLite native in the next macOS release.
- **Redshift's credentials without `.pgpass` (Task 3).** In
  `Redshift_Details.jdbc_properties`, `AWS_Credential.Default` passes `user` =
  `db_user` and nothing else, as `AWS_Credential.Profile` does (the Profile case
  passes `db_user` as it is, `''` included, since `db_user:Text=''` is never
  `Nothing`); with the `jdbc:redshift:iam://` URL and no profile or keys, the
  Redshift driver uses the default AWS credential chain. The `Nothing` branch
  goes: the constructor's `credentials:Credentials|AWS_Credential` already
  rejects `Nothing` with a `Type_Error` panic when the value is built, before
  any connection, naming the expected types, which is how Snowflake and SQL
  Server, whose `credentials` are required
  (`Missing_Argument.throw "credentials"`), fail too. The default stays
  `..Profile` and the widget
  (`AWS_Credential.default_widget add_user_password=True`) is unchanged. Cost if
  wrong: a user who relied on `.pgpass` for Redshift must pass credentials; the
  changelog says so.

## Merge order

Task 1 first; Task 2 after Task 1 (it calls `library/listPublicTypes`; it can be
implemented in parallel and rebased); Task 3 any time; Task 4 after Tasks 1 and
2 have merged; Task 5 after Tasks 1–4. Tasks 4 and 5 both edit `build.sbt`,
`tools/ci/stdlib-test-map.yaml`, `distribution/edition.template.yaml`,
Database's `Main.enso`, `package.yaml` and `docs/api`, and `CHANGELOG.md`: Task
5 is branched from `develop` after Task 4 merges. Every task merges after the
user's OK.

---

### Task 1: engine service discovery and declared public types

**Files:**

- Create:
  `lib/scala/library-manager/src/main/scala/org/enso/librarymanager/InstalledLibraries.scala`
  and its test
  `lib/scala/library-manager/src/test/scala/org/enso/librarymanager/InstalledLibrariesSpec.scala`
- Modify:
  `lib/scala/library-manager/src/main/scala/org/enso/librarymanager/ResolvingLibraryProvider.scala`
  (new `findInstalledLibraries`),
  `lib/scala/library-manager/src/main/scala/org/enso/librarymanager/DefaultLibraryProvider.scala`
- Modify: `lib/scala/pkg/src/main/scala/org/enso/pkg/Config.scala`
  (`publicTypes`), `lib/scala/pkg/src/test/scala/org/enso/pkg/ConfigSpec.scala`
- Modify:
  `engine/runtime/src/main/scala/org/enso/interpreter/runtime/DefaultPackageRepository.scala`
  (`installedPackages`, `getInstalledUnloadedPackagesJava`)
- Modify:
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/LookupServicesNode.java`
- Modify:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/interop/MetaServicesTest.java`
  (the mock's new signature)
- Create:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/libraries/InstalledServicesTest.java`
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/libraries/LibraryApi.scala`
  (`LibraryListPublicTypes`),
  `engine/language-server/src/main/scala/org/enso/languageserver/protocol/json/JsonRpc.scala`,
  `engine/language-server/src/main/scala/org/enso/languageserver/protocol/json/JsonConnectionController.scala`
- Create:
  `engine/language-server/src/main/scala/org/enso/languageserver/libraries/LibraryPublicType.scala`,
  `engine/language-server/src/main/scala/org/enso/languageserver/libraries/handler/LibraryListPublicTypesHandler.scala`,
  `engine/language-server/src/test/scala/org/enso/languageserver/libraries/LibraryPublicTypesSpec.scala`
- Modify:
  `engine/language-server/src/test/scala/org/enso/languageserver/websocket/json/LibrariesTest.scala`
- Modify: `tools/ci/check-workflows.mjs` (`loadStdlib`, new `checkPublicTypes`),
  `tools/ci/check-workflows.test.mjs`
- Modify: the `package.yaml` of AWS, DuckDB, Examples, Generic_JDBC, Geo,
  Google, Google_Api, Image, Microsoft, Saas, Searcher, Snowflake and Tableau
  under `distribution/lib/Standard/<name>/0.0.0-dev/` (`public-types:`)
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Meta_Helpers.enso:37`,
  `distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso:504-530`
- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/System/File_Format.enso`
  (`get_format`, `File_Format_SPI.get_regs`, `get_types`,
  `find_format_for_data_link`)
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Enso_Cloud/Data_Link.enso`
  (`find_data_link_type`)
- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/System/File.enso`
  (`File_System_SPI.get_type`, `get_regs`, `File.new`'s `_` branch)
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Read/Return_As.enso`
  (`_get_known_return_classes`, `Return_As.resolve`),
  `distribution/lib/Standard/Base/0.0.0-dev/src/Network/Email/Email_Provider.enso`
  (`get_known_email_providers`, `resolve`),
  `test/Base_Tests/src/System/File_Read_Spec.enso` (the `read_many` default),
  `CHANGELOG.md`
- Modify: `DB/src/Connection/Database.enso` (`resolve_constructor`,
  `get_simple_regs`, `get_types`)
- Modify: `test/Visualization_Tests/src/Widgets/Database_Widgets_Spec.enso`
- Modify: `tools/ci/stdlib-test-map.yaml` (`Visualization_Tests.imports` loses
  `AWS`)
- Modify: `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Meta.md`,
  `distribution/lib/Standard/Base/0.0.0-dev/docs/api/System/File_Format.md`
  (regenerated)
- Modify: `engine/runtime/CLAUDE.md` (one line under "Non-obvious conventions":
  service lookup covers installed libraries; see the Note),
  `distribution/lib/Standard/CLAUDE.md` (the `package.yaml` paragraph), the wiki
  pages `Libraries-Editions` (the `public-types` field) and
  `Language-Server-Protocol-Language-Server` (the request), as `docs/CLAUDE.md`
  "Editing the wiki" says

**Interfaces:**

- Produces:
  `InstalledLibraries.find(edition: Editions.ResolvedEdition, preferLocalLibraries: Boolean, localLibraryProvider: LocalLibraryProvider, publishedLibraryCache: PublishedLibraryCache): Seq[ResolvedLibrary]`
  and `ResolvingLibraryProvider.findInstalledLibraries(): Seq[ResolvedLibrary]`
  (sorted by `LibraryName.toString`, never download).
- Produces: `Config.publicTypes: List[String]` (`public-types:` in
  `package.yaml`, default empty).
- Produces:
  `DefaultPackageRepository.getInstalledUnloadedPackagesJava: java.util.List[Package[TruffleFile]]`
  (installed libraries not loaded yet, `package.yaml` read once per context,
  sorted by name).
- Produces: `LookupServicesNode.execute(Type fqn, boolean loadedOnly)` and
  `protected abstract Iterable<Supplier<Type>> findImplementationsFor(Type service, boolean loadedOnly)`;
  a supplier may return `null` (skipped).
- Produces:
  `Meta.lookup_services spi_type (loaded_only:Boolean=False) -> Vector`:
  providers of loaded libraries first (loading order), then those of the other
  installed libraries by library name. Tasks 4 and 5 rely on this for
  `Database.connect`'s dropdown, `Data.read` and data links.
- Produces: the language server request `library/listPublicTypes`, no params,
  result
  `{ "publicTypes": [{ "name": "DuckDB", "library": "Standard.DuckDB" }, …] }`
  over the current project's installed libraries. Task 2 calls it.
- Produces: `checkPublicTypes` in `tools/ci/check-workflows.mjs`; Tasks 4 and 5
  declare the new libraries' types to satisfy it.

- [ ] **Step 1: The library-manager test.** Create
      `lib/scala/library-manager/src/test/scala/org/enso/librarymanager/InstalledLibrariesSpec.scala`:

```scala
package org.enso.librarymanager

import org.enso.editions.Editions.Repository
import org.enso.editions.{Editions, LibraryName}
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.semver.SemVer
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Path

class InstalledLibrariesSpec extends AnyWordSpec with Matchers {
  private val repo      = Repository("main", "https://example.com/main")
  private val cached    = LibraryName("Standard", "Cached")
  private val notCached = LibraryName("Standard", "Not_Cached")
  private val local     = LibraryName("Foo", "Local")

  private def published(name: LibraryName) =
    name -> Editions.Resolved.PublishedLibrary(name, SemVer.of(1, 0, 0), repo)

  private val edition = Editions.Resolved.Edition(
    parent        = None,
    engineVersion = Some(SemVer.of(0, 0, 0)),
    repositories  = Map("main" -> repo),
    libraries     = Map(published(cached), published(notCached))
  )

  private object Local extends LocalLibraryProvider {
    override def findLibrary(name: LibraryName): Option[LibraryRoot] =
      if (name == local) Some(LibraryRoot(Path.of("Foo", "Local"))) else None
    override def findAvailableLocalLibraries(): List[LibraryName] = List(local)
  }

  private object Cache extends PublishedLibraryCache {
    override def isLibraryCached(name: LibraryName, version: SemVer): Boolean =
      name == cached
    override def findCachedLibrary(
      name: LibraryName,
      version: SemVer
    ): Option[LibraryRoot] =
      if (name == cached) Some(LibraryRoot(Path.of("cache", "Cached")))
      else None
  }

  "InstalledLibraries.find" should {
    "list the edition's cached libraries only" in {
      InstalledLibraries
        .find(edition, preferLocalLibraries = false, Local, Cache)
        .map(_.name) shouldEqual Seq(cached)
    }

    "add local libraries, sorted by name, when the project prefers them" in {
      InstalledLibraries
        .find(edition, preferLocalLibraries = true, Local, Cache)
        .map(_.name) shouldEqual Seq(local, cached)
    }
  }
}
```

The cache has no way to download, so a library that is not cached cannot be
fetched by the listing. Run
`sbt "library-manager/testOnly org.enso.librarymanager.InstalledLibrariesSpec"`.
Expected: compilation fails, `InstalledLibraries` does not exist.

- [ ] **Step 2: Implement the listing.** Create
      `lib/scala/library-manager/src/main/scala/org/enso/librarymanager/InstalledLibraries.scala`:

```scala
package org.enso.librarymanager

import org.enso.editions.{Editions, LibraryName, LibraryVersion}
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache

/** The libraries a project can resolve without downloading anything: the
  * edition's libraries (with its parents') that are cached or bundled, and,
  * when the project prefers local libraries, the local ones. Used by the
  * runtime's service discovery and by the language server's
  * `library/listPublicTypes`, so the two always agree.
  */
object InstalledLibraries {

  /** @return the installed libraries, sorted by name */
  def find(
    edition: Editions.ResolvedEdition,
    preferLocalLibraries: Boolean,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache
  ): Seq[ResolvedLibrary] = {
    val resolver = LibraryResolver(localLibraryProvider)
    val locals =
      if (preferLocalLibraries) localLibraryProvider.findAvailableLocalLibraries()
      else Nil
    val names = edition.getAllDefinedLibraries.keySet ++ locals
    names.toSeq.sortBy(_.toString).flatMap { name =>
      resolver
        .resolveLibraryVersion(name, edition, preferLocalLibraries)
        .toOption
        .flatMap {
          case version @ LibraryVersion.Local =>
            localLibraryProvider
              .findLibrary(name)
              .map(ResolvedLibrary(name, version, _))
          case version @ LibraryVersion.Published(semver, _) =>
            publishedLibraryCache
              .findCachedLibrary(name, semver)
              .map(ResolvedLibrary(name, version, _))
        }
    }
  }
}
```

In `ResolvingLibraryProvider.scala`, add to the trait:

```scala
  /** Lists the libraries this provider can resolve without downloading
    * anything ([[InstalledLibraries.find]]).
    *
    * @return the resolved libraries, sorted by name
    */
  def findInstalledLibraries(): Seq[ResolvedLibrary]
```

In `DefaultLibraryProvider.scala`, import
`org.enso.librarymanager.published.PublishedLibraryCache` and add:

```scala
  /** @inheritdoc */
  override def findInstalledLibraries(): Seq[ResolvedLibrary] =
    publishedLibraryProvider match {
      case cache: PublishedLibraryCache =>
        InstalledLibraries.find(
          edition,
          preferLocalLibraries,
          localLibraryProvider,
          cache
        )
      case _ => Nil
    }
```

(`DefaultLibraryProvider.make` and `DependencyPreinstaller` pass a
`DefaultPublishedLibraryProvider`, which extends `CachedLibraryProvider`, a
`PublishedLibraryCache`.) Run the test again. Expected: both pass.

- [ ] **Step 3: The engine test.** Create
      `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/libraries/InstalledServicesTest.java`:

```java
package org.enso.interpreter.test.libraries;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.enso.test.utils.ProjectUtils;
import org.graalvm.polyglot.Value;
import org.junit.ClassRule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * {@code Meta.lookup_services} over libraries that are installed but not imported (Note [Service
 * Discovery Over Installed Libraries] in {@code LookupServicesNode}). The libraries sit next to the
 * project, which {@link ProjectUtils#createProject} makes prefer local libraries: {@code
 * Fixture.Api} defines the service, {@code Fixture.Zeta} (imported) and {@code Fixture.Alpha}
 * (never imported) provide it, and {@code Fixture.Broken} registers a provider whose module does
 * not exist.
 */
public final class InstalledServicesTest {
  @ClassRule public static final TemporaryFolder tmp = new TemporaryFolder();

  private static void writeLibrary(Path root, String dir, String packageYaml, String services)
      throws IOException {
    var src = Files.createDirectories(root.resolve(dir).resolve("src"));
    Files.writeString(root.resolve(dir).resolve("package.yaml"), packageYaml);
    Files.writeString(src.resolve("Main.enso"), "");
    if (services != null) {
      Files.writeString(src.resolve("Services.enso"), services);
    }
  }

  private static String providerYaml(String name, String with) {
    return """
        name: %s
        namespace: Fixture
        version: 0.0.1
        services:
          - provides: Fixture.Api.Main.Spi
            with: %s
        """
        .formatted(name, with);
  }

  private static String providerServices(String label) {
    return """
        from Fixture.Api import Spi

        type Impl

        Spi.from (that:Impl) =
            _ = that
            Spi.Value "%s"
        """
        .formatted(label);
  }

  private static List<String> strings(Value vector) {
    var result = new ArrayList<String>();
    for (long i = 0; i < vector.getArraySize(); i++) {
      result.add(vector.getArrayElement(i).asString());
    }
    return result;
  }

  @Test
  public void findsInstalledProvidersAfterLoadedOnesAndSkipsBrokenOnes() throws IOException {
    var root = tmp.newFolder().toPath();
    var api = root.resolve("Fixture_Api");
    Files.createDirectories(api.resolve("src"));
    Files.writeString(
        api.resolve("package.yaml"),
        """
        name: Api
        namespace: Fixture
        version: 0.0.1
        """);
    Files.writeString(
        api.resolve("src").resolve("Main.enso"),
        """
        type Spi
            Value name
        """);
    writeLibrary(
        root,
        "Fixture_Zeta",
        providerYaml("Zeta", "Fixture.Zeta.Services.Impl"),
        providerServices("zeta"));
    writeLibrary(
        root,
        "Fixture_Alpha",
        providerYaml("Alpha", "Fixture.Alpha.Services.Impl"),
        providerServices("alpha"));
    writeLibrary(
        root, "Fixture_Broken", providerYaml("Broken", "Fixture.Broken.No_Such_Module.Impl"), null);

    var projDir = Files.createDirectory(root.resolve("Proj"));
    ProjectUtils.createProject(
        "Proj",
        """
        import Standard.Base.Meta
        import Standard.Base.Warning.Warning
        from Fixture.Api import Spi
        import Fixture.Zeta

        main =
            before = Meta.lookup_services Spi loaded_only=True . map .name
            found = Meta.lookup_services Spi
            after = Meta.lookup_services Spi loaded_only=True . map .name
            [before, found.map .name, (Warning.get_all found).length, after]
        """,
        projDir);

    ProjectUtils.testProjectRun(
        projDir,
        res -> {
          assertEquals("only the imported provider is loaded", List.of("zeta"), strings(res.getArrayElement(0)));
          assertEquals("loaded first, then by name", List.of("zeta", "alpha"), strings(res.getArrayElement(1)));
          assertEquals("the broken provider is skipped, not a warning", 0, res.getArrayElement(2).asInt());
          assertEquals("resolving loaded Alpha", List.of("zeta", "alpha"), strings(res.getArrayElement(3)));
        });
  }
}
```

In `MetaServicesTest.java`, change the mock's override to
`protected Iterable<Supplier<Type>> findImplementationsFor(Type type, boolean loadedOnly)`
and the three `node.execute(spi)` calls to `node.execute(spi, false)`. Run
`sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.libraries.InstalledServicesTest"`.
Expected: the project fails to compile (`lookup_services` takes one argument).

- [ ] **Step 4: The repository's listing.** In `DefaultPackageRepository.scala`,
      after `getLoadedPackagesJava`:

```scala
  /** The installed libraries' packages: their `package.yaml` is read, nothing
    * is registered or compiled. Computed once per context, on the first service
    * lookup (Note [Service Discovery Over Installed Libraries] in
    * `LookupServicesNode`).
    */
  private lazy val installedPackages: Seq[Package[TruffleFile]] =
    libraryProvider.findInstalledLibraries().flatMap { library =>
      packageManager.loadPackage(context.findLibraryRootPath(library.root)) match {
        case Success(pkg) => Some(pkg)
        case Failure(error) =>
          logger.warn(
            s"Library ${library.name} is left out of service discovery: " +
            error.getMessage
          )
          None
      }
    }

  /** The installed libraries that are not loaded yet, sorted by name. */
  def getInstalledUnloadedPackagesJava: java.util.List[Package[TruffleFile]] =
    installedPackages.filterNot(pkg => isPackageLoaded(pkg.libraryName)).asJava
```

(`Success`/`Failure` and `SeqHasAsJava` are already imported.)

- [ ] **Step 5: The lookup.** In `LookupServicesNode.java`:
  - `build()`'s anonymous subclass overrides
    `findImplementationsFor(Type service, boolean loadedOnly)` and returns
    `super.defaultImplementationsFor(service, loadedOnly)`; the abstract
    method's Javadoc adds: "a supplier may return {@code null}: a provider of an
    installed library that could not be loaded, already logged and to be
    skipped".
  - `defaultImplementationsFor` becomes:

```java
  private Iterable<Supplier<Type>> defaultImplementationsFor(Type service, boolean loadedOnly) {
    var found = new ArrayList<Supplier<Type>>();
    var repository = EnsoContext.get(this).getPackageRepository();
    var serviceName = service.getQualifiedName();
    for (var p : repository.getLoadedPackagesJava()) {
      for (var with : providersOf(p, serviceName)) {
        found.add(() -> findType(with, p.namespace(), p.name()));
      }
    }
    if (!loadedOnly) {
      for (var p : repository.getInstalledUnloadedPackagesJava()) {
        for (var with : providersOf(p, serviceName)) {
          found.add(() -> loadAndFindType(p, with));
        }
      }
    }
    return found;
  }

  private static List<QualifiedName> providersOf(Package<?> p, QualifiedName service) {
    var providers = new ArrayList<QualifiedName>();
    for (var registration : ScalaConversions.asJava(p.getConfig().services())) {
      if (service.equals(registration.provides())) {
        providers.add(registration.with());
      }
    }
    return providers;
  }

  /**
   * Loads {@code p} and finds the provider {@code with} in it.
   *
   * @return the provider's type, or {@code null} (logged) when the library cannot be loaded or the
   *     type cannot be found or compiled
   */
  @CompilerDirectives.TruffleBoundary
  private Type loadAndFindType(Package<TruffleFile> p, QualifiedName with) {
    var ensoCtx = EnsoContext.get(this);
    var logger = ensoCtx.getLogger(LookupServicesNode.class);
    var loaded = ensoCtx.getPackageRepository().ensurePackageIsLoaded(p.libraryName());
    if (loaded.isLeft()) {
      logger.log(
          Level.WARNING, "Skipping the services of {0}: {1}", new Object[] {p.libraryName(), loaded});
      return null;
    }
    try {
      return findType(with, p.namespace(), p.name());
    } catch (AbstractTruffleException | CompilerError ex) {
      logger.log(
          Level.WARNING,
          "Skipping the service provider {0}: {1}",
          new Object[] {with, ex.getMessage()});
      return null;
    }
  }
```

- `execute` becomes
  `public final EnsoObject execute(Type fqn, boolean loadedOnly)`, iterates
  `findImplementationsFor(fqn, loadedOnly)`, and right after
  `var implType = supplierOfType.get();` adds
  `if (implType == null) { continue; }`.
- Imports: `java.util.List`, `java.util.logging.Level`,
  `com.oracle.truffle.api.TruffleFile`, `org.enso.pkg.Package`,
  `org.enso.compiler.core.CompilerError`.
- Above the class, the Note:

```java
/*
 * Note [Service Discovery Over Installed Libraries]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `Meta.lookup_services` returns the providers of every library the project can resolve without a
 * download (`ResolvingLibraryProvider.findInstalledLibraries`), not only of the loaded ones, so a
 * backend appears in `Database.connect`'s dropdown and a SQLite file reads without an import.
 * - Order: the loaded libraries' providers first, in loading order, then the others by library
 *   name, so results are stable.
 * - Cost: the installed libraries' `package.yaml` files are read once per context
 *   (`DefaultPackageRepository.installedPackages`); nothing is compiled until a provider of the
 *   requested service is resolved, which loads its library and compiles the provider's module.
 *   `loaded_only` skips the installed ones, for callers that stop at their first match.
 * - Failures: a library that discovery loads and that fails to load or compile is skipped with a
 *   logged warning; a loaded library's broken registration stays a dataflow error, as before.
 */
```

- [ ] **Step 6: The Enso side.** `Meta_Helpers.enso:37` becomes
      `lookup_services spi_type loaded_only = @Builtin_Method "Meta.lookup_services"`.
      In `Meta.enso`, the doc's first paragraph after the metadata becomes
      "Support for registration and discovery of services among Enso libraries.
      Returns the instances of `spi_type` registered by the libraries the
      project can resolve: the loaded ones first, then the other installed ones
      by name, loading each library as its provider is resolved. The vector may
      carry a warning if a loaded library's registration is invalid.", the
      argument list gains "- `loaded_only`: only the libraries already loaded,
      so nothing new is loaded.", and:

```enso
lookup_services spi_type (loaded_only:Boolean=False) -> Vector =
    v = Meta_Helpers.lookup_services spi_type loaded_only
```

In `File_Format.enso`:

```enso
get_format : Function -> Any | Nothing
get_format callback =
    first_format types =
        reader idx =
            if idx >= types.length then Nothing else
                format = callback (types.at idx)
                if format.is_nothing.not then format else
                    @Tail_Call reader (idx + 1)
        reader 0
    # The loaded libraries' formats are tried first, so that reading a file of a
    # known format loads no other library.
    first_format (File_Format_SPI.get_types loaded_only=True) . if_nothing <|
        first_format File_Format_SPI.get_types
```

```enso
    private get_regs b:Boolean=False loaded_only:Boolean=False =
        _ = b
        reg = Meta.lookup_services File_Format_SPI loaded_only=loaded_only
        reg.map .to_vector . flatten

    get_types b:Boolean=False loaded_only:Boolean=False =
        File_Format_SPI.get_regs b loaded_only . map .typ

    private find_format_for_data_link sub_type:Text =
        find loaded_only =
            found = File_Format_SPI.get_regs False loaded_only . find if_missing=Nothing spi->
                spi.data_link_format_name == sub_type
            if found.is_nothing then Nothing else found.typ
        (find True) . if_nothing <|
            (find False) . if_nothing <|
                Error.throw (Illegal_State.Error "Unknown format "+sub_type)
```

(document `loaded_only` on `get_types`). In `Data_Link.enso`:

```enso
    private find_data_link_type name =
        find loaded_only =
            found = Meta.lookup_services Data_Link_SPI loaded_only=loaded_only . find if_missing=Nothing spi->
                spi.name == name
            if found.is_nothing then Nothing else found.typ
        (find True) . if_nothing (find False)
```

In `File.enso`, `File_System_SPI`:

```enso
    private get_type protocol:Text b:Boolean =
        find loaded_only =
            vec = Self.get_regs b loaded_only . filter \e -> (e.protocol == protocol)
            if vec . not_empty then vec.first.typ else Nothing
        (find True) . if_nothing (find False)

    private get_regs b:Boolean loaded_only:Boolean=False =
        _ = b
        Meta.lookup_services File_System_SPI loaded_only=loaded_only

    private get_types b:Boolean loaded_only:Boolean=False =
        Self.get_regs b loaded_only . map .typ
```

and in `File.new`'s `_ ->` branch the `.any` check becomes
`(File_System_SPI.get_types False loaded_only=True).any` (a value of a file type
has its library loaded already). In `DB/src/Connection/Database.enso`:

```enso
    private resolve_constructor constructor:Function =
        first_resolved types =
            try_next idx =
                if idx >= types.length then Nothing else
                    resolved = (types.at idx).resolve constructor
                    if resolved.is_nothing then @Tail_Call try_next (idx + 1) else resolved
            try_next 0
        loaded = Database_Connection_Details_SPI.get_types False loaded_only=True
        (first_resolved loaded) . if_nothing <|
            (first_resolved (Database_Connection_Details_SPI.get_types False)) . if_nothing constructor

    private get_simple_regs b:Boolean loaded_only:Boolean=False -> Vector Database_Connection_Details_SPI =
        _ = b
        reg = Meta.lookup_services Database_Connection_Details_SPI loaded_only=loaded_only
        arr = reg.map .to_vector
        arr.flatten

    private get_types b:Boolean loaded_only:Boolean=False -> Vector =
        flat = Database_Connection_Details_SPI.get_simple_regs b loaded_only
        flat.map .typ
```

(`get_default_constructors`, the dropdown, keeps the full lookup.) The other
first-match callers (the ruling's table) get the same two passes. In
`File_Format.enso`, `File_Format.resolve`:

```enso
    resolve : Function -> File_Format
    resolve constructor = case constructor of
        _ : Function ->
            first_resolved arr =
                try_next idx =
                    if idx >= arr.length then Nothing else
                        resolved = (arr.at idx).resolve constructor
                        if resolved.is_nothing then @Tail_Call try_next (idx + 1) else resolved
                try_next 0
            (first_resolved (File_Format_SPI.get_types loaded_only=True)) . if_nothing <|
                (first_resolved File_Format_SPI.get_types) . if_nothing <|
                    Error.throw (Illegal_Argument.Error "Expected a file format, but got a function.")
        _ -> constructor
```

In `Return_As.enso`, `SPI._get_known_return_classes` takes
`(loaded_only:Boolean=False)` and passes it to `Meta.lookup_services`, and
`resolve`'s search becomes:

```enso
            first_resolved types =
                try_next idx =
                    if idx >= types.length then Nothing else
                        resolved = (types.at idx).resolve value
                        if resolved.is_nothing then @Tail_Call try_next (idx + 1) else resolved
                try_next 0
            (first_resolved (SPI._get_known_return_classes loaded_only=True)) . if_nothing <|
                (first_resolved SPI._get_known_return_classes) . if_nothing symbol_not_found
```

(`symbol_not_found` keeps its message for an installation without
`Standard.Table`). In `Email_Provider.enso`, `get_known_email_providers` takes
`(loaded_only:Boolean=False)` the same way, and `resolve` becomes:

```enso
    private resolve constructor:Function -> Email_Provider =
        first_resolved types =
            try_next idx =
                if idx >= types.length then Nothing else
                    resolved = (types.at idx).resolve constructor
                    if resolved.is_nothing then @Tail_Call try_next (idx + 1) else resolved:Email_Provider
            try_next 0
        (first_resolved (Email_Provider_SPI.get_known_email_providers loaded_only=True)) . if_nothing <|
            (first_resolved Email_Provider_SPI.get_known_email_providers) . if_nothing constructor
```

The widgets in the ruling's table keep calling the full lookup unchanged.

- [ ] **Step 7: Run the engine tests.** Build the distribution
      (`sbt buildEngineDistribution`), then
      `sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.libraries.InstalledServicesTest org.enso.interpreter.test.interop.MetaServicesTest"`.
      Expected: all pass. If `InstalledServicesTest` reports the four results in
      another shape, read the engine log for the `Skipping …` warnings before
      changing the expectations.

- [ ] **Step 8: The Enso test.** In
      `test/Visualization_Tests/src/Widgets/Database_Widgets_Spec.enso`, delete
      the comment and `from Standard.AWS import all` (lines 9-10), and make the
      last group:

```enso
    suite_builder.group "Widgets for Database" group_builder->
        group_builder.specify "works for `connect`, listing every installed backend" <|
            result = Widgets.get_widget_json Database .connect ["details"]
            result.should_contain "SQLite"
            result.should_contain "Postgres"
            # No file of this project imports these libraries: discovery finds them.
            result.should_contain "Redshift"
            result.should_contain "DuckDB"
            result.should_contain "Snowflake"
            result.should_contain "Microsoft SQL Server"
```

In `tools/ci/stdlib-test-map.yaml`, `Visualization_Tests.imports` becomes
`[Base, Database, Examples, Geo, Image, Table, Test, Visualization]`. From
`test/`:

```bash
JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests"
JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests"
JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Table_Tests"
```

Before running, rewrite `File_Read_Spec.enso`'s spec "would default to returning
as merged Table, but will raise a helpful error if Standard.Table is not loaded"
(lines 169-176), whose premise the lookup removes:

```enso
        group_builder.specify "returns a merged Table by default, finding Standard.Table without an import" <|
            files = [enso_project.data / "sample.json"]
            r1 = Data.read_many files
            Meta.type_of r1 . to_text . should_equal "Table"
```

Expected: all pass (the first with the new group). The full `Base_Tests` and
`Table_Tests` cover the first-match callers. Any other expectation that a
widget's list changes is updated in this PR and listed in its body; those known
now: `File_Read_Spec.enso:169-176` (above). `File_Format_Widgets_Spec`,
`Table_Widgets_Spec` and `Widget_Helpers_Spec` use `should_contain`, so longer
lists still pass; check their output for new entries. Run
`node tools/ci/check-workflows.mjs` and `node --test tools/ci/*.test.mjs`.

- [ ] **Step 9: `public-types:` in the package config.** In `ConfigSpec.scala`,
      next to the labels tests:

```scala
    "keep public types through a round trip" in {
      val yaml =
        """name: Example
          |namespace: Standard
          |public-types:
          |  - Example
          |  - Example_Format
          |""".stripMargin
      val config = Config.fromYaml(yaml).get
      config.publicTypes shouldEqual List("Example", "Example_Format")
      Config.fromYaml(config.toYaml()).get.publicTypes shouldEqual
      List("Example", "Example_Format")
    }

    "default to no public types and omit them from the YAML" in {
      val config = Config.fromYaml("name: example\n").get
      config.publicTypes shouldEqual Nil
      config.toYaml() should not include "public-types"
    }
```

Run `sbt "pkg/testOnly org.enso.pkg.ConfigSpec"`; expected: fails to compile. In
`Config.scala`: the case class gains a last parameter
`publicTypes: List[String] = Nil` (after `labels`, so positional callers keep
compiling) documented "@param publicTypes the types the library's `Main.enso`
exports, for tools that look a type up without loading the library
(`public-types:`)"; `JsonFields` gains
`val PublicTypes: String = "public-types"`; the decoder, after `labels`:

```scala
            publicTypes <- clazzMap
              .get(JsonFields.PublicTypes)
              .map(implicitly[YamlDecoder[List[String]]].decode)
              .getOrElse(Right(Nil))
```

with `publicTypes` passed last to `Config(...)` (a malformed list fails the
package, unlike `labels`, which a user edits: a library author should hear about
it); the encoder, after `labels`:

```scala
        if (value.publicTypes.nonEmpty) {
          elements.add(
            (
              JsonFields.PublicTypes,
              implicitly[YamlEncoder[List[String]]].encode(value.publicTypes)
            )
          )
        }
```

Run the test again; expected: passes. The runtime's discovery reads the list
with `services:` through the same `Config` (`installedPackages`, Step 4).

- [ ] **Step 10: The language server's request.** Create
      `engine/language-server/src/main/scala/org/enso/languageserver/libraries/LibraryPublicType.scala`:

```scala
package org.enso.languageserver.libraries

import org.enso.editions.Editions
import org.enso.librarymanager.InstalledLibraries
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.pkg.PackageManager

/** A type an installed library declares in its `package.yaml`
  * (`public-types:`).
  *
  * @param name the type's name, as its library's `Main.enso` exports it
  * @param library the library's qualified name, e.g. `Standard.SQLite`
  */
case class LibraryPublicType(name: String, library: String)

object LibraryPublicType {

  /** The declared types of every library the project can resolve without a
    * download, in the libraries' name order.
    */
  def list(
    edition: Editions.ResolvedEdition,
    preferLocalLibraries: Boolean,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache
  ): Seq[LibraryPublicType] =
    InstalledLibraries
      .find(
        edition,
        preferLocalLibraries,
        localLibraryProvider,
        publishedLibraryCache
      )
      .flatMap { library =>
        PackageManager.Default
          .loadPackage(library.root.location.toFile)
          .toOption
          .toSeq
          .flatMap(_.getConfig().publicTypes)
          .map(LibraryPublicType(_, library.name.toString))
      }
}
```

In `LibraryApi.scala`, after `LibraryListLocal`:

```scala
  case object LibraryListPublicTypes
      extends Method("library/listPublicTypes") { self =>

    case class Result(publicTypes: Seq[LibraryPublicType])

    implicit val hasParams: HasParams.Aux[this.type, Unused.type] =
      new HasParams[this.type] {
        type Params = Unused.type
      }

    implicit val hasResult: HasResult.Aux[this.type, self.Result] =
      new HasResult[this.type] {
        type Result = self.Result
      }
  }
```

Create
`engine/language-server/src/main/scala/org/enso/languageserver/libraries/handler/LibraryListPublicTypesHandler.scala`,
modelled on `EditionsListDefinedLibrariesHandler.scala`:

```scala
package org.enso.languageserver.libraries.handler

import akka.actor.{Actor, ActorRef, Props, Status}
import akka.pattern.pipe
import com.typesafe.scalalogging.LazyLogging
import org.enso.jsonrpc.{Id, Request, ResponseError, ResponseResult}
import org.enso.languageserver.libraries.LibraryApi._
import org.enso.languageserver.libraries.{
  BlockingOperation,
  EditionReference,
  EditionReferenceResolver,
  LibraryPublicType,
  LocalLibraryManagerFailureMapper
}
import org.enso.languageserver.util.UnhandledLogging
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache

/** A request handler for the `library/listPublicTypes` endpoint: the types the
  * current project's installed libraries declare (`public-types:`).
  */
class LibraryListPublicTypesHandler(
  editionReferenceResolver: EditionReferenceResolver,
  localLibraryProvider: LocalLibraryProvider,
  publishedLibraryCache: PublishedLibraryCache
) extends Actor
    with LazyLogging
    with UnhandledLogging {
  override def receive: Receive = requestStage

  private case class Result(publicTypes: Seq[LibraryPublicType])

  import context.dispatcher

  private def requestStage: Receive = {
    case Request(LibraryListPublicTypes, id, _) =>
      BlockingOperation
        .run {
          val edition = editionReferenceResolver
            .resolveEdition(EditionReference.CurrentProjectEdition)
            .get
          val preferLocal = editionReferenceResolver.getCurrentProjectConfig.get
            .preferLocalLibraries
          LibraryPublicType.list(
            edition,
            preferLocal,
            localLibraryProvider,
            publishedLibraryCache
          )
        }
        .map(Result) pipeTo self

      context.become(responseStage(id, sender()))
  }

  private def responseStage(id: Id, replyTo: ActorRef): Receive = {
    case Result(publicTypes) =>
      replyTo ! ResponseResult(
        LibraryListPublicTypes,
        id,
        LibraryListPublicTypes.Result(publicTypes)
      )
      context.stop(self)

    case Status.Failure(exception) =>
      replyTo ! ResponseError(
        Some(id),
        LocalLibraryManagerFailureMapper.mapException(exception)
      )
      context.stop(self)
  }
}

object LibraryListPublicTypesHandler {

  /** Creates a configuration object to create
    * [[LibraryListPublicTypesHandler]].
    */
  def props(
    editionReferenceResolver: EditionReferenceResolver,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache
  ): Props = Props(
    new LibraryListPublicTypesHandler(
      editionReferenceResolver,
      localLibraryProvider,
      publishedLibraryCache
    )
  )
}
```

(the `_` params pattern is `LibraryListLocalHandler`'s). Register it: in
`JsonRpc.scala`, `.registerRequest(LibraryListPublicTypes)` after
`LibraryListLocal`'s; in `JsonConnectionController.scala`, after
`LibraryListLocal -> …`:

```scala
      LibraryListPublicTypes -> LibraryListPublicTypesHandler
        .props(
          libraryConfig.editionReferenceResolver,
          libraryConfig.localLibraryProvider,
          libraryConfig.publishedLibraryCache
        ),
```

The JSON codec is derived (`JsonRpc.scala` imports `io.circe.generic.auto._`),
so the result is `{ "publicTypes": [{ "name": …, "library": … }] }`.

Tests. Create
`engine/language-server/src/test/scala/org/enso/languageserver/libraries/LibraryPublicTypesSpec.scala`:

```scala
package org.enso.languageserver.libraries

import org.enso.editions.{Editions, LibraryName}
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.semver.SemVer
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Files

class LibraryPublicTypesSpec extends AnyWordSpec with Matchers {
  "LibraryPublicType.list" should {
    "list the types an installed library declares" in {
      val root = Files.createTempDirectory("public-types")
      Files.writeString(
        root.resolve("package.yaml"),
        """name: Lib
          |namespace: Foo
          |version: 0.0.1
          |public-types: [Thing, Other_Thing]
          |""".stripMargin
      )
      val name = LibraryName("Foo", "Lib")
      val local = new LocalLibraryProvider {
        override def findLibrary(n: LibraryName): Option[LibraryRoot] =
          if (n == name) Some(LibraryRoot(root)) else None
        override def findAvailableLocalLibraries(): List[LibraryName] =
          List(name)
      }
      val noCache = new PublishedLibraryCache {
        override def isLibraryCached(n: LibraryName, v: SemVer): Boolean = false
        override def findCachedLibrary(
          n: LibraryName,
          v: SemVer
        ): Option[LibraryRoot] = None
      }
      val edition = Editions.Resolved.Edition(
        parent        = None,
        engineVersion = Some(SemVer.of(0, 0, 0)),
        repositories  = Map(),
        libraries     = Map()
      )
      LibraryPublicType.list(edition, true, local, noCache) shouldEqual Seq(
        LibraryPublicType("Thing", "Foo.Lib"),
        LibraryPublicType("Other_Thing", "Foo.Lib")
      )
    }
  }
}
```

and in `LibrariesTest.scala` a check that the request is wired (the test
edition's published libraries are not cached, so the list is empty):

```scala
  "library/listPublicTypes" should {
    "answer with the installed libraries' declared types" in {
      val client = getInitialisedWsClient()
      client.send(json"""
          { "jsonrpc": "2.0",
            "method": "library/listPublicTypes",
            "id": 0
          }
          """)
      client.expectJson(
        json"""
          { "jsonrpc": "2.0",
            "id": 0,
            "result": { "publicTypes": [] }
          }
          """,
        timeout = defaultTimeout
      )
    }
  }
```

Run
`sbt "language-server/testOnly org.enso.languageserver.libraries.LibraryPublicTypesSpec org.enso.languageserver.websocket.json.LibrariesTest"`.
Expected: both pass. If the second returns libraries (the test home holds a
cached one), assert on the `publicTypes` key's presence instead of its value.

- [ ] **Step 11: The check, and the libraries' declarations.** In
      `tools/ci/check-workflows.mjs`, next to `ENSO_IMPORT`:

```js
/** The standard libraries every project gets; the others declare `public-types:`. */
export const CORE_LIBRARIES = [
  "Base",
  "Database",
  "Table",
  "Test",
  "Visualization",
];

/**
 * A top-level export of `Main.enso`: `export a.b.C`, `export a.b.C as D` or `from a.b export C, D`.
 * Indented lines are examples in doc comments and do not count.
 */
const ENSO_EXPORT =
  /^(?:export\s+(?:[\w.]*\.)?(\w+)(?:\s+as\s+(\w+))?|from\s+[\w.]+\s+export\s+([\w, ]+?))\s*$/gm;

/** The capitalised names a `Main.enso` exports: what its library declares in `public-types:`. */
export function exportedTypes(mainSource) {
  const names = new Set();
  for (const [, last, alias, list] of mainSource.matchAll(ENSO_EXPORT)) {
    const exported =
      list != null
        ? list.split(",").map((name) => name.trim())
        : [alias ?? last];
    for (const name of exported) if (/^[A-Z]/.test(name)) names.add(name);
  }
  return [...names].sort();
}
```

In `loadStdlib`, while it walks the libraries, also record each library's
declaration and exports:

```js
const dir = version == null ? null : path.join(standard, name, version);
publicTypes[name] =
  dir == null
    ? null
    : {
        declared: parse(readFileSync(path.join(dir, "package.yaml"), "utf8"))?.[
          "public-types"
        ],
        exported: exportedTypes(
          existsSync(path.join(dir, "src", "Main.enso"))
            ? readFileSync(path.join(dir, "src", "Main.enso"), "utf8")
            : "",
        ),
        source: path.posix.join(
          "distribution/lib/Standard",
          name,
          version,
          "package.yaml",
        ),
      };
```

(`const publicTypes = {}` beside `libraries`; return it with the others), and
add after `checkStdlibTestMap`:

```js
/**
 * Every library outside the core set declares, in `package.yaml`'s `public-types:`, exactly the
 * capitalised names its `Main.enso` exports, so that the IDE can find a type's library without
 * loading it (spec 2026-10-30-postgres-sqlite-libraries, Amendment 1).
 */
export function checkPublicTypes({ stdlib }) {
  const problems = [];
  for (const [name, entry] of Object.entries(stdlib.publicTypes ?? {})) {
    if (entry == null || CORE_LIBRARIES.includes(name)) continue;
    const { declared, exported, source } = entry;
    if (!Array.isArray(declared)) {
      problems.push(
        `${source}: no \`public-types:\` list (its Main.enso exports [${exported.join(", ")}])`,
      );
      continue;
    }
    const sorted = [...declared].map(String).sort();
    if (sorted.join(",") !== exported.join(",")) {
      problems.push(
        `${source}: \`public-types\` is [${sorted.join(", ")}] but Main.enso exports [${exported.join(", ")}]`,
      );
    }
  }
  return problems;
}
```

and append `checkPublicTypes` to `CHECKS`. In `check-workflows.test.mjs` (import
`checkPublicTypes` and `exportedTypes`):

```js
describe("exportedTypes", () => {
  test("reads exports, aliases and lists, skipping functions and examples", () => {
    assert.deepEqual(
      exportedTypes(
        [
          "export project.DuckDB.DuckDB",
          "export project.Table_Extensions.geo_distance",
          "export project.S3.S3_File as File_On_S3",
          "from project.Image export Image, Matrix",
          "## Example",
          "    export project.Not.Counted",
          "",
        ].join("\n"),
      ),
      ["DuckDB", "File_On_S3", "Image", "Matrix"],
    );
  });
});

describe("checkPublicTypes", () => {
  const lib = (yaml, main) => ({
    "distribution/lib/Standard/Base/0.0.0-dev/package.yaml": "name: Base\n",
    "distribution/lib/Standard/Base/0.0.0-dev/src/Main.enso":
      "export project.Any.Any\n",
    "distribution/lib/Standard/Geo/0.0.0-dev/package.yaml": yaml,
    "distribution/lib/Standard/Geo/0.0.0-dev/src/Main.enso": main,
  });
  const main =
    "export project.Geo.Geo\nexport project.Table_Extensions.geo_distance\n";
  const at = "distribution/lib/Standard/Geo/0.0.0-dev/package.yaml:";

  test("accepts a matching declaration, and ignores the core set", () => {
    assert.deepEqual(
      checkPublicTypes(
        fixture({}, lib("name: Geo\npublic-types: [Geo]\n", main)),
      ),
      [],
    );
  });
  test("requires the declaration outside the core set", () => {
    assert.deepEqual(checkPublicTypes(fixture({}, lib("name: Geo\n", main))), [
      `${at} no \`public-types:\` list (its Main.enso exports [Geo])`,
    ]);
  });
  test("reports a declaration that differs from the exports", () => {
    assert.deepEqual(
      checkPublicTypes(
        fixture({}, lib("name: Geo\npublic-types: [Geo, Old]\n", main)),
      ),
      [`${at} \`public-types\` is [Geo, Old] but Main.enso exports [Geo]`],
    );
  });
});
```

(the existing `fixture` helper returns what the checks take, as for
`checkStdlibTestMap`). Run
`corepack pnpm exec prettier --write tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs`
(the snippets above are not in the repository's style), then
`node --test tools/ci/*.test.mjs`; expected: passes. Then add, after
`maintainers:` in each library's `package.yaml`, one line (the lists are the
exports of each `src/Main.enso` today):

| Library      | `public-types:` line                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| AWS          | `public-types: [AWS, AWS_Credential, AWS_Region, Redshift_Details, S3, S3_File]`                            |
| DuckDB       | `public-types: [DuckDB]`                                                                                    |
| Examples     | `public-types: []`                                                                                          |
| Generic_JDBC | `public-types: [Generic_JDBC_Connection]`                                                                   |
| Geo          | `public-types: [Geo, Distance_Units]`                                                                       |
| Google       | `public-types: [Google_Analytics, Google_Credential, Google_Sheets]`                                        |
| Google_Api   | `public-types: []`                                                                                          |
| Image        | `public-types: [Image, Matrix, Read_Flag, Write_Flag]`                                                      |
| Microsoft    | `public-types: [Azure, Azure_Storage, SQLServer_Details, Microsoft365_Credential, OneDrive, OneDrive_File]` |
| Saas         | `public-types: [Strava, Salesforce]`                                                                        |
| Searcher     | `public-types: []`                                                                                          |
| Snowflake    | `public-types: [Snowflake_Details]`                                                                         |
| Tableau      | `public-types: [Hyper_Column, Hyper_File, Hyper_Table]`                                                     |

Run `node tools/ci/check-workflows.mjs`; expected: `Workflow policy: OK`. In
`distribution/lib/Standard/CLAUDE.md`, after the SPI section, add a "Public
types" section: "A library outside the core set (Base, Table, Database,
Visualization, Test) lists in `package.yaml`'s `public-types:` the capitalised
names its `Main.enso` exports. The IDE uses the list to add an import for a
library the engine has not loaded; `tools/ci/check-workflows.mjs`
(`checkPublicTypes`) fails when it differs from `Main.enso`." Document the field
on the wiki's `Libraries-Editions` page (the `package.yaml` fields) and the
request on `Language-Server-Protocol-Language-Server`, next to
`library/listLocal`.

- [ ] **Step 12: API docs and Linux.** Regenerate
      `distribution/lib/Standard/Base/0.0.0-dev/docs/api` and `DB/docs/api` with
      the command in Global Constraints, run `stdlib-api-check`, and repeat
      Steps 1, 7, 8, 9 and 10 in WSL. Add the line to
      `engine/runtime/CLAUDE.md`.
- [ ] **Step 13: Commit and open the PR.** Title
      `Engine: service discovery over installed libraries, and declared public types`.
      Add to `CHANGELOG.md` under `#### Enso Standard Library`:
      `- [Connection, file format, return type and e-mail dropdowns list the installed libraries' choices, even those not imported yet][NNN]`.
      Body: the Note's three points, the caller table, `public-types:` and its
      check, `library/listPublicTypes`, the rulings on what counts as a public
      type and on the shared listing, and the test runs (Windows and WSL). Wait
      for the user's OK.

---

### Task 2: the GUI's unresolved-name detector

Needs Task 1 merged (`library/listPublicTypes`). A feature: changelog entry
under `#### Enso IDE`; merges after the user's OK.

**Files:**

- Modify: `app/ydoc-shared/src/languageServer.ts` (`listLibraryPublicTypes`),
  `app/ydoc-shared/src/languageServerTypes.ts` (`LibraryPublicType`,
  `response.ListLibraryPublicTypes`)
- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/index.ts`
  (`loadLibraryPublicTypes`, the store's `libraryPublicTypes` and
  `publicTypesLoaded`),
  `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/loaded.test.ts`
  (the mock answers the new request)
- Modify: `app/gui/src/providers/openedProjects/module/imports.ts`
  (`missingImports`; export `entryPathFromRequiredImport`)
- Modify: `app/gui/src/providers/openedProjects/module/module.ts`
  (`addDetectedImports`, the open trigger, `importsAddedOnOpen`)
- Create: `app/gui/src/providers/openedProjects/module/openImportCheck.ts`
  (`whenReadyOnce`) and
  `app/gui/src/providers/openedProjects/module/__tests__/openImportCheck.test.ts`
- Modify: `app/ydoc-shared/src/yjsModel.ts` (the `'local:autoImport'` origin),
  `app/ydoc-shared/src/ast/__tests__/nodeMetadata.test.ts`
- Modify: `app/gui/src/providers/openedProjects/graph/graph.ts`
  (`setNodeContent`)
- Modify: `app/gui/src/project-view/composables/nodeCreation.ts`
  (`useNodeCreation`'s `moduleStore` type, `afterCreation`)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/tags.ts`
  (`ExpressionTag.resolveExpression`)
- Modify: `app/gui/src/project-view/components/GraphEditor/toasts.ts`
  (`useImportsAddedOnOpenToast`),
  `app/gui/src/project-view/components/GraphEditor.vue`
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/mockSuggestion.ts`
  (`makeType` takes `reexport`)
- Create:
  `app/gui/src/providers/openedProjects/graph/__tests__/missingImports.test.ts`
- Modify: `app/gui/integration-test/mock/lsHandler.ts` (`setMockMainFile`,
  `restoreMockMainFile`, `setMockPublicTypes`, the `library/listPublicTypes`
  case)
- Create: `app/gui/integration-test/project-view/autoImports.spec.ts`
- Create: `app/gui/src/providers/openedProjects/module/CLAUDE.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: Task 1's `library/listPublicTypes`.
- Produces:
  `missingImports(moduleRoot: Ast.BodyBlock, db: SuggestionDb, existingImports: readonly AbstractImport[], scope?: Ast.Ast, libraryPublicTypes?: ReadonlyMap<string, readonly ProjectPath[]>): RequiredImport[]`.
- Produces on the suggestion database store:
  `libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]>` (type name →
  the installed libraries declaring it) and `publicTypesLoaded: boolean`.
- Produces on `ModuleStore`:
  `addDetectedImports(edit: MutableModule, scope?: Ast.Ast): RequiredImport[]`
  and `importsAddedOnOpen: RequiredImport[]`.

- [ ] **Step 1: Failing unit tests.** In `mockSuggestion.ts`, give `makeType`
      `opts: CommonOptions & { reexport?: string } = {}` and pass
      `...(opts.reexport ? { reexport: opts.reexport } : {})` into the entry, as
      `makeModule` does. Create
      `app/gui/src/providers/openedProjects/graph/__tests__/missingImports.test.ts`:

```ts
import {
  analyzeImports,
  missingImports,
  type RequiredImport,
} from "$/providers/openedProjects/module/imports";
import { mockProjectNameStore } from "$/providers/openedProjects/projectNames";
import { SuggestionDb } from "$/providers/openedProjects/suggestionDatabase";
import type { SuggestionEntry } from "$/providers/openedProjects/suggestionDatabase/entry";
import { makeType } from "$/providers/openedProjects/suggestionDatabase/mockSuggestion";
import { Ast } from "@/util/ast";
import type { ProjectPath } from "@/util/projectPath";
import { tryQualifiedName, type Identifier } from "@/util/qualifiedName";
import { unwrap } from "enso-common/src/utilities/data/result";
import { expect, test } from "vitest";
import { assertDefined } from "ydoc-shared/util/assert";

const projectNames = mockProjectNameStore();

const projectPath = (path: string) =>
  unwrap(projectNames.parseProjectPath(unwrap(tryQualifiedName(path))));

const db = (...entries: SuggestionEntry[]) => SuggestionDb.createMock(entries);

const POSTGRES = makeType("Standard.Postgres.Postgres.Postgres", {
  reexport: "Standard.Postgres",
});
const THING = makeType("Standard.Things.Thing.Thing", {
  reexport: "Standard.Things",
});

const unqualified = (from: string, name: string): RequiredImport => ({
  kind: "Unqualified",
  from: projectPath(from),
  import: name as Identifier,
});

function detect(
  code: string,
  suggestions: SuggestionDb,
  publicTypes: ReadonlyMap<string, readonly ProjectPath[]> = new Map(),
) {
  const root = Ast.parseBlock(code);
  return missingImports(
    root,
    suggestions,
    [...analyzeImports(root, projectNames)],
    root,
    publicTypes,
  );
}

const CONNECT =
  "main =\n    db = Database.connect (Postgres.Server 'localhost' 5432)\n";

test("an unimported Postgres.Server needs the Postgres import", () => {
  expect(
    detect("from Standard.Database import all\n" + CONNECT, db(POSTGRES)),
  ).toEqual([unqualified("Standard.Postgres", "Postgres")]);
});

test.each([
  ["imported with all", "from Standard.Postgres import all\n"],
  ["imported by name", "from Standard.Postgres import Postgres\n"],
  ["imported qualified", "import Standard.Postgres.Postgres.Postgres\n"],
])("nothing when the type is %s", (_, imports) => {
  expect(detect(imports + CONNECT, db(POSTGRES))).toEqual([]);
});

test("another name imported from the same library does not cover it", () => {
  const imports = "from Standard.Postgres import Postgres_Connection\n";
  expect(detect(imports + CONNECT, db(POSTGRES))).toEqual([
    unqualified("Standard.Postgres", "Postgres"),
  ]);
});

test("nothing for a local binding of the same name", () => {
  expect(
    detect(
      "main =\n    Postgres = 42\n    x = Postgres.Server\n",
      db(POSTGRES),
    ),
  ).toEqual([]);
});

test("nothing for an ambiguous name", () => {
  const other = makeType("Standard.Other.Thing.Thing", {
    reexport: "Standard.Other",
  });
  expect(detect("main =\n    x = Thing.new\n", db(THING, other))).toEqual([]);
});

test("nothing for a type defined in the project", () => {
  const own = makeType("local.Mock_Project.Main.Postgres");
  expect(detect(CONNECT, db(POSTGRES, own))).toEqual([]);
});

test("nothing for an autoscoped constructor", () => {
  expect(
    detect("main =\n    db = Database.connect ..Postgres\n", db(POSTGRES)),
  ).toEqual([]);
});

const SQLITE_CODE = "main =\n    c = Database.connect (SQLite.In_Memory)\n";

test("a type of a library the engine has not loaded comes from the declared types", () => {
  const declared = new Map([["SQLite", [projectPath("Standard.SQLite")]]]);
  expect(detect(SQLITE_CODE, db(), declared)).toEqual([
    unqualified("Standard.SQLite", "SQLite"),
  ]);
});

test("the suggestion database wins over the declared types", () => {
  const sqlite = makeType("Standard.Database.SQLite.SQLite", {
    reexport: "Standard.Database",
  });
  const declared = new Map([["SQLite", [projectPath("Standard.SQLite")]]]);
  expect(detect(SQLITE_CODE, db(sqlite), declared)).toEqual([
    unqualified("Standard.Database", "SQLite"),
  ]);
});

test("nothing for a type several libraries declare", () => {
  const declared = new Map([
    ["SQLite", [projectPath("Standard.SQLite"), projectPath("Other.SQLite")]],
  ]);
  expect(detect(SQLITE_CODE, db(), declared)).toEqual([]);
});

test("only the given scope is looked at", () => {
  const root = Ast.parseBlock(
    "main =\n    a = Postgres.Server\nother =\n    b = Thing.new\n",
  );
  const other = Ast.findModuleMethod(root, "other");
  assertDefined(other);
  expect(
    missingImports(root, db(POSTGRES, THING), [], other.statement),
  ).toEqual([unqualified("Standard.Things", "Thing")]);
});
```

Run
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/graph/__tests__/missingImports.test.ts`.
Expected: fails, `missingImports` is not exported.

- [ ] **Step 2: The declared-types map and the detector.** In
      `app/ydoc-shared/src/languageServerTypes.ts`, next to
      `LibraryComponentGroup`:

```ts
/** A type an installed library declares in its `package.yaml` (`public-types:`). */
export interface LibraryPublicType {
  /** The type's name, as the library's `Main.enso` exports it. */
  name: string;
  /** The library's qualified name, e.g. `Standard.SQLite`. */
  library: string;
}
```

and in `namespace response`, after `GetComponentGroups`:

```ts
export interface ListLibraryPublicTypes {
  publicTypes: LibraryPublicType[];
}
```

In `app/ydoc-shared/src/languageServer.ts`, after `getComponentGroups`:

```ts
  /** The types the project's installed libraries declare (`public-types:` in their `package.yaml`). */
  listLibraryPublicTypes(): Promise<LsRpcResult<response.ListLibraryPublicTypes>> {
    return this.request('library/listPublicTypes', {})
  }
```

In `suggestionDatabase/index.ts`, after `loadGroups`:

```ts
/**
 * The types the installed libraries declare, by name: how the import detector finds the library of
 * a type whose library the engine has not loaded, so the suggestion database has no entry for it.
 */
async function loadLibraryPublicTypes(
  lsRpc: LanguageServer,
  projectNames: ProjectNameStore,
): Promise<ReadonlyMap<string, readonly ProjectPath[]>> {
  const result = await exponentialBackoff(() => lsRpc.listLibraryPublicTypes());
  if (!result.ok) {
    if (!lsRpc.isDisposed) {
      result.error.log(
        "Cannot read the libraries' public types. Continuing without them",
      );
    }
    return new Map();
  }
  const byName = new Map<string, ProjectPath[]>();
  for (const { name, library } of result.value.publicTypes) {
    const path = projectNames.parseProjectPath(library as QualifiedName);
    if (path.ok) byName.set(name, [...(byName.get(name) ?? []), path.value]);
  }
  return byName;
}
```

and in `createSuggestionDbStore`, before `return proxyRefs({`:

```ts
/** The installed libraries' declared types, read once when the project opens. */
const libraryPublicTypes = shallowRef<
  ReadonlyMap<string, readonly ProjectPath[]>
>(new Map());
const publicTypesLoaded = ref(false);
loadLibraryPublicTypes(projectStore.lsRpcConnection, projectNames).then(
  (byName) => {
    libraryPublicTypes.value = byName;
    publicTypesLoaded.value = true;
  },
);
```

with `libraryPublicTypes` and `publicTypesLoaded: readonly(publicTypesLoaded)`
in the returned object (add `shallowRef` to the file's `vue` import). In
`loaded.test.ts`, the mock language server gains
`listLibraryPublicTypes: async () => Ok({ publicTypes: [] }),`.

In `imports.ts`, export `entryPathFromRequiredImport` (drop nothing else),
import `ProjectPath` as a type, and add after `filterOutRedundantImports`:

```ts
// =======================
// === Missing imports ===
// =======================

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * The imports that the type names used in `scope` need and the module lacks (the design is
 * `docs/superpowers/specs/2026-10-30-postgres-sqlite-libraries-design.md`, section 3 and its
 * Amendments 1 and 6).
 *
 * A name counts when it is capitalised and starts an expression or a qualified access (`Postgres`
 * in `Postgres.Server 'h' 5432`). It is skipped when the module binds it (an assignment, a
 * function, a name an import brings in), when an existing import covers it, and when it is
 * autoscoped (`..Server`). Otherwise it is looked up among the suggestion database's types: one
 * match gives that entry's {@link requiredImports}; a type of the current project, or several
 * matches, give nothing. With no match, `libraryPublicTypes` (the types the installed libraries
 * declare) gives the import when exactly one library declares the name.
 * @param moduleRoot - The module's top-level block, for its bindings.
 * @param scope - The part of the module to look at, such as a node's expression.
 */
export function missingImports(
  moduleRoot: Ast.BodyBlock,
  db: SuggestionDb,
  existingImports: readonly AbstractImport[],
  scope: Ast.Ast = moduleRoot,
  libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]> = new Map(),
): RequiredImport[] {
  const bound = boundNames(moduleRoot, existingImports);
  const result: RequiredImport[] = [];
  for (const name of new Set(referencedTypeNames(scope))) {
    if (bound.has(name)) continue;
    for (const required of importsForTypeName(db, name, libraryPublicTypes)) {
      const covered = existingImports.some((existing) =>
        covers(existing, required),
      );
      if (!covered && !result.some((r) => requiredImportEquals(r, required)))
        result.push(required);
    }
  }
  return result;
}

/** Capitalised names that start an expression or a qualified access, as `Ast.visitRecursive` finds them. */
function referencedTypeNames(scope: Ast.Ast): string[] {
  const names: string[] = [];
  Ast.visitRecursive(scope, (ast) => {
    if (ast instanceof Ast.Import || ast instanceof Ast.AutoscopedIdentifier)
      return false;
    if (ast instanceof Ast.PropertyAccess) return ast.lhs ? [ast.lhs] : false;
    if (ast instanceof Ast.Ident && TYPE_NAME.test(ast.code()))
      names.push(ast.code());
    return true;
  });
  return names;
}

/** Names the module binds: assignments, functions, and what its imports bring in by name. */
function boundNames(
  moduleRoot: Ast.BodyBlock,
  existingImports: readonly AbstractImport[],
) {
  const bound = new Set<string>();
  for (const { from, imported } of existingImports) {
    if (imported.kind === "Module") {
      const name =
        imported.alias ??
        (from.path
          ? qnLastSegment(from.path)
          : from.project
            ? qnLastSegment(from.project)
            : undefined);
      if (name) bound.add(name);
    } else if (imported.kind === "List") {
      for (const name of imported.names) bound.add(name);
    }
  }
  Ast.visitRecursive(moduleRoot, (ast) => {
    if (ast instanceof Ast.Assignment && ast.pattern instanceof Ast.Ident) {
      bound.add(ast.pattern.code());
    } else if (
      ast instanceof Ast.FunctionDef &&
      ast.name instanceof Ast.Ident
    ) {
      bound.add(ast.name.code());
    }
    return true;
  });
  return bound;
}

function importsForTypeName(
  db: SuggestionDb,
  name: string,
  libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]>,
): RequiredImport[] {
  const types: SuggestionEntry[] = [];
  for (const id of db.conflictingNames.lookup(name)) {
    const entry = db.get(id);
    if (entry?.kind === SuggestionKind.Type) types.push(entry);
  }
  if (types.some((entry) => entry.definedIn.project == null)) return [];
  if (types.length === 1) return requiredImports(db, types[0]!);
  if (types.length > 1) return [];
  const libraries = libraryPublicTypes.get(name) ?? [];
  return libraries.length === 1
    ? [{ kind: "Unqualified", from: libraries[0]!, import: name as Identifier }]
    : [];
}
```

(`Ast.visitRecursive` is used this way in
`app/gui/src/project-view/util/ast/bindings.ts` and `abstract.ts`'s
`unqualifyQualifiedNames`.) Run the test. Expected: all pass.

- [ ] **Step 3: The module store.** In `module.ts`, import `missingImports`,
      `printRequiredImport` and `entryPathFromRequiredImport` from `./imports`,
      and, inside `scope.run` after `addMissingImportsDisregardConflicts`:

```ts
/**
 * Add, in `edit`, the imports that the type names used in `scope` (the whole module by
 * default) need, so they are one undoable step with the change that needed them.
 * @returns the imports added.
 */
function addDetectedImports(
  edit: MutableModule,
  scope?: Ast.Ast,
): RequiredImport[] {
  if (!root.value) return [];
  const topLevel = edit.getVersion(root.value);
  const existingImports = [...analyzeImports(topLevel, projectNames)];
  const found = missingImports(
    topLevel,
    suggestionDb.entries,
    existingImports,
    scope ?? topLevel,
    suggestionDb.libraryPublicTypes,
  );
  if (found.length === 0) return [];
  const conflicts = addMissingImports(edit, found) ?? [];
  return found.filter(
    (imp) =>
      !conflicts.some((c) =>
        c.fullyQualified.equals(entryPathFromRequiredImport(imp)),
      ),
  );
}
```

Create `app/gui/src/providers/openedProjects/module/openImportCheck.ts`:

```ts
/** @file Run a check once, when every value it needs is there, whatever order they arrive in. */
import { watch, type WatchStopHandle } from "vue";

/**
 * Call `run` with the value of `get` the first time it is not `undefined`, then stop watching.
 * The module's root, the suggestion database and the declared types each arrive asynchronously
 * and in no fixed order, so the project-open import check waits for all of them this way.
 */
export function whenReadyOnce<T>(
  get: () => T | undefined,
  run: (value: T) => void,
) {
  let stop: WatchStopHandle | undefined;
  let done = false;
  stop = watch(
    get,
    (value) => {
      if (done || value === undefined) return;
      done = true;
      stop?.();
      run(value);
    },
    { immediate: true },
  );
  if (done) stop();
}
```

and its test, `module/__tests__/openImportCheck.test.ts`:

```ts
import { whenReadyOnce } from "$/providers/openedProjects/module/openImportCheck";
import { expect, test } from "vitest";
import { nextTick, ref } from "vue";

function setup() {
  const root = ref<string>();
  const loaded = ref(false);
  const typesLoaded = ref(false);
  const runs: string[] = [];
  whenReadyOnce(
    () => (loaded.value && typesLoaded.value ? root.value : undefined),
    (value) => runs.push(value),
  );
  return { root, loaded, typesLoaded, runs };
}

test("runs once when the module opens after the database and the declared types", async () => {
  const { root, loaded, typesLoaded, runs } = setup();
  loaded.value = true;
  typesLoaded.value = true;
  await nextTick();
  expect(runs).toEqual([]);
  root.value = "Main";
  await nextTick();
  expect(runs).toEqual(["Main"]);
  root.value = "Main again";
  await nextTick();
  expect(runs).toEqual(["Main"]);
});

test("runs once when the module opens first", async () => {
  const { root, loaded, typesLoaded, runs } = setup();
  root.value = "Main";
  typesLoaded.value = true;
  await nextTick();
  expect(runs).toEqual([]);
  loaded.value = true;
  await nextTick();
  expect(runs).toEqual(["Main"]);
});
```

In `app/ydoc-shared/src/yjsModel.ts`, `Origin` gains `'local:autoImport'` (and
the comment above it names it: "imports the IDE added when a project opened"),
and `tryAsOrigin` returns it like `'local:autoLayout'`; in
`ast/__tests__/nodeMetadata.test.ts`, beside the `'local:derivedMetadata'`
cases: `expect(tryAsOrigin('local:autoImport')).toBe('local:autoImport')` and
`expect(isLocalUserActionOrigin('local:autoImport')).toBe(false)`.

Right before `return Ok(proxyRefs({` in `module.ts`:

```ts
/** The imports added when the module was opened, for the graph editor's notice. */
const importsAddedOnOpen = ref<RequiredImport[]>([]);
whenReadyOnce(
  () =>
    suggestionDb.loaded && suggestionDb.publicTypesLoaded
      ? root.value
      : undefined,
  (openedRoot) => {
    const needed = missingImports(
      openedRoot,
      suggestionDb.entries,
      [...analyzeImports(openedRoot, projectNames)],
      openedRoot,
      suggestionDb.libraryPublicTypes,
    );
    if (needed.length === 0) return;
    let added: RequiredImport[] = [];
    // Not a user action: the undo manager does not track this origin, so Ctrl+Z after
    // opening does not take the imports away.
    edit(
      (edit) => {
        added = addDetectedImports(edit);
        return Ok();
      },
      { origin: "local:autoImport" },
    );
    if (added.length > 0) {
      console.info(
        "Added the imports this module needed:",
        added.map(printRequiredImport),
      );
      importsAddedOnOpen.value = added;
    }
  },
);
```

(import `whenReadyOnce` from `./openImportCheck`; `EditOptions.origin` is passed
to `applyEdit`).

and add `addDetectedImports` and `importsAddedOnOpen` to the `proxyRefs` object.
The notice (Step 6) shows only when `importsAddedOnOpen` is non-empty.

- [ ] **Step 4: Trigger 1, a node's expression is committed.** In `graph.ts`,
      `setNodeContent`'s edit becomes:

```ts
module.edit((edit) => {
  const editExpr = edit.getVersion(node.innerExpr);
  editExpr.syncToCode(content);
  if (withImports) {
    // TODO: substituting conflicting names does not work (enso-org/enso#9356).
    module.addMissingImports(edit, withImports);
  }
  module.addDetectedImports(edit, editExpr);
  return Ok();
});
```

(the old body only logged when the parent was missing and then substituted
nothing; drop that dead branch). In `nodeCreation.ts`, `useNodeCreation`'s
`moduleStore` becomes
`ToValue<Pick<ModuleStore, 'edit' | 'addMissingImports' | 'addDetectedImports'>>`,
and in `afterCreation`, after the `conflicts` loop:

```ts
toValue(moduleStore).addDetectedImports(edit, assignment);
```

Check `app/gui/src/project-view/providers/graphNodeCreation.ts` passes the full
module store (it does; adjust if `typecheck` says otherwise).

- [ ] **Step 5: Trigger 2, a widget choice.** In `tags.ts`, `resolveExpression`
      becomes:

```ts
  resolveExpression(edit: Ast.MutableModule, module: ModuleStore) {
    if (this.requiredImports) {
      // TODO: substituting conflicting names does not work (enso-org/enso#9356).
      module.addMissingImports(edit, this.requiredImports)
    } else {
      // A value that is not a suggestion entry, like `Database.connect`'s
      // `(Postgres.Server 'localhost' 5432)`: find what its names need.
      module.addDetectedImports(edit, this.expressionAst)
    }
    return this.expression
  }
```

- [ ] **Step 6: Trigger 3's notice.** In `GraphEditor/toasts.ts`:

```ts
/**
 * One notice listing the imports a project needed when it opened: code from before a type moved
 * to a library of its own, or written in another editor.
 */
export function useImportsAddedOnOpenToast(
  module: ToValue<Pick<ModuleStore, "importsAddedOnOpen">>,
  projectNames: ProjectNameStore,
) {
  const toast = useToast.info();
  watch(
    () => toValue(module).importsAddedOnOpen,
    (added) => {
      if (added.length === 0) return;
      const lines = added.map((imp) =>
        requiredImportToAst(imp, projectNames).code(),
      );
      toast.show(
        `Added ${added.length === 1 ? "an import" : "imports"} this project needed: ${lines.join("; ")}`,
      );
      toValue(module).importsAddedOnOpen = [];
    },
    { immediate: true },
  );
}
```

(imports: `watch`, `toValue` from `vue`, `ToValue` from `$/utils/reactivity`,
the `ModuleStore` and `ProjectNameStore` types, `requiredImportToAst`). In
`GraphEditor.vue`, after `const toasts = useGraphEditorToasts(projectStore)`:
`useImportsAddedOnOpenToast(module, projectNames)`.

- [ ] **Step 7: The Playwright test.** In `mock/lsHandler.ts`, before
      `fileTree`:

```ts
let mainFileOverride: string | undefined;
let mockPublicTypes: { name: string; library: string }[] = [];

/** Serve `code` as the mock project's `Main.enso` until {@link restoreMockMainFile}. */
export function setMockMainFile(code: string) {
  mainFileOverride = code;
}

/** Answer `library/listPublicTypes` with `types` until {@link restoreMockMainFile}. */
export function setMockPublicTypes(types: { name: string; library: string }[]) {
  mockPublicTypes = types;
}

/** Serve the standard mock `Main.enso` and no declared types again. */
export function restoreMockMainFile() {
  mainFileOverride = undefined;
  mockPublicTypes = [];
}
```

The `'Main.enso'` getter returns `mainFileOverride ?? mainFile`, and
`mockLSHandler` gains, next to `'runtime/getComponentGroups'`:

```ts
    case 'library/listPublicTypes':
      return { publicTypes: mockPublicTypes } satisfies response.ListLibraryPublicTypes
```

Create `integration-test/project-view/autoImports.spec.ts`:

```ts
/** @file The IDE adds the imports that code needs (the unresolved-name detector). */
import { expect, test, type Page } from "integration-test/base";
import {
  restoreMockMainFile,
  setMockMainFile,
  setMockPublicTypes,
  updateVisualizationData,
} from "integration-test/mock/lsHandler";
import { mockMethodCallInfo } from "./expressionUpdates";
import * as locate from "./locate";

async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press("ControlOrMeta+`");
  await expect(page.locator(".CodeEditor")).toBeVisible();
  return page.evaluate(() => (window as any).__codeEditorApi.textContent());
}

test.afterEach(restoreMockMainFile);

test.describe("choosing a backend in the Database.connect dropdown", () => {
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          "from Standard.Base import all\nfrom Standard.Database import all\n\n## A project for the import detector.\nmain =\n    db = Database.connect\n",
        ),
    },
  });

  test("adds the import of the chosen backend", async ({
    editorPage,
    page,
  }) => {
    await editorPage
      .mockSuggestion({
        type: "type",
        module: "Standard.Postgres.Postgres",
        name: "Postgres",
        params: [],
        reexport: "Standard.Postgres.Main",
      })
      .mockSuggestion({
        type: "method",
        module: "Standard.Database.Connection.Database",
        name: "connect",
        arguments: [
          {
            name: "details",
            reprType:
              "Standard.Database.Connection.Connection_Details.Connection_Details",
            isSuspended: false,
            hasDefault: false,
          },
        ],
        selfType: "Standard.Database.Connection.Database",
        returnType: "Standard.Database.Connection.Connection.Connection",
        isStatic: true,
        annotations: ["details"],
      });
    updateVisualizationData(".connect", [
      [
        "details",
        {
          type: "Widget",
          constructor: "Single_Choice",
          label: null,
          values: [
            {
              type: "Choice",
              constructor: "Option",
              value: "(Postgres.Server 'localhost' 5432)",
              label: "Postgres",
              parameters: [],
            },
          ],
          display: { type: "Display", constructor: "Always" },
        },
      ],
    ]);
    await mockMethodCallInfo(page, "db", {
      methodPointer: {
        module: "Standard.Database.Connection.Database",
        definedOnType: "Standard.Database.Connection.Database",
        name: "connect",
      },
      notAppliedArguments: [0],
    });
    const node = locate.graphNodeByBinding(page, "db");
    const details = node
      .locator(".WidgetTopLevelArgument")
      .filter({ has: page.getByText("details") });
    await details.locator(".WidgetSelection").first().click();
    await page
      .locator(".DropdownWidget:not([data-transitioning]) .item")
      .filter({ hasText: "Postgres" })
      .click();
    await expect(node).toContainText("Postgres.Server");
    expect(await moduleCode(page)).toContain(
      "from Standard.Postgres import Postgres",
    );
  });
});

test.describe("opening a project that uses SQLite without importing it", () => {
  test.use({
    setupApi: {
      local: () => {
        setMockMainFile(
          "from Standard.Base import all\nfrom Standard.Database import all\n\n## A project for the import detector.\nmain =\n    connection = Database.connect (SQLite.In_Memory)\n",
        );
        // The engine has not loaded `Standard.SQLite`: only its declaration knows `SQLite`.
        setMockPublicTypes([{ name: "SQLite", library: "Standard.SQLite" }]);
      },
    },
  });

  test("adds the SQLite import and says so", async ({ editorPage, page }) => {
    await editorPage;
    await expect(page.getByTestId("toast-host")).toContainText(
      "from Standard.SQLite import SQLite",
    );
    // The import is not part of the undo history.
    await page.keyboard.press("ControlOrMeta+Z");
    expect(await moduleCode(page)).toContain(
      "from Standard.SQLite import SQLite",
    );
  });
});

test("a project whose imports are complete opens without a notice", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  await expect(page.getByTestId("toast-host")).not.toContainText(
    "Added an import",
  );
  await expect(page.getByTestId("toast-host")).not.toContainText(
    "Added imports",
  );
});
```

(`clearPreprocessorOverrides` runs per test already, `mock/localApi.ts:132`; the
last test opens the standard mock project.) Run
`corepack pnpm --filter enso-gui run test:integration -- integration-test/project-view/autoImports.spec.ts`
three times on Windows and three times in WSL, then the whole
`integration-test/project-view/` once in each (the standard mock project now
runs the detector on open). Expected: all pass every time. If the dropdown's
item list is empty, compare the `connect` entry's shape with
`Standard.Base.Data.read`'s in `mock/data/mockSuggestions.json` before changing
the test.

- [ ] **Step 8: Docs, checks, changelog.** Create
      `app/gui/src/providers/openedProjects/module/CLAUDE.md`:

```markdown
# src/providers/openedProjects/module/

The module store (`module.ts`, the open project's `Main.enso` as an AST) and the
import logic (`imports.ts`).

- `requiredImports` is what a suggestion entry needs; `addMissingImports` adds
  them, skipping covered and conflicting ones.
- `missingImports` is the unresolved-name detector: the capitalised names a
  piece of code uses that no import covers, looked up among the suggestion
  database's types and then among the types the installed libraries declare
  (`public-types:` in their `package.yaml`, from the language server's
  `library/listPublicTypes`, loaded by the suggestion database store), which is
  how it finds a library the engine has not loaded. `addDetectedImports` runs it
  in an edit, so the imports are one undoable step with the change. It runs when
  a node's expression is committed (`graph.ts` `setNodeContent`,
  `nodeCreation.ts`), when a dropdown value without an entry is applied
  (`WidgetSelection/tags.ts`), and once when the module opens, after the
  suggestion database and the declared types have loaded (`importsAddedOnOpen`,
  shown by `GraphEditor/toasts.ts` only when imports were added). The code
  editor is not hooked: the next open covers its edits.
- Design:
  `docs/superpowers/specs/2026-10-30-postgres-sqlite-libraries-design.md`
  (section 3 and its Amendments).
```

Run `typecheck`, `lint`, `test:unit` and prettier (Global Constraints), also for
`app/ydoc-shared` (`corepack pnpm --filter ydoc-shared run typecheck` and
`run test:unit`). Add to `CHANGELOG.md` under `#### Enso IDE`:

```markdown
- [The IDE adds the imports your code needs][NNN]: when a new or edited
  component, or a dropdown choice, uses a type from a library the project does
  not import, the import is added with it. Opening a project adds any imports
  its code is missing, and a notice says which.
```

- [ ] **Step 9: Commit, screenshots, PR.** Title
      `IDE: add the imports that code needs`. Before/after screenshots of the
      dropdown choice and of the notice on open, on the `pr-screenshots` branch,
      linked from the body. Body: the three triggers, the declared-types map and
      when the open check runs, Amendments 6 and 7, `Main.enso` only. Wait for
      the user's OK.

---

### Task 3: the Postgres-family base in Database, and Redshift without `.pgpass`

A visible change (Redshift no longer reads `.pgpass`): changelog entry under
`#### Enso Standard Library`; merges after the user's OK.

**Files (moves, `git mv`):**

```bash
DB=distribution/lib/Standard/Database/0.0.0-dev
mkdir -p $DB/src/Postgres_Family
git mv $DB/src/Internal/Postgres/Postgres_Dialect.enso      $DB/src/Postgres_Family/Postgres_Dialect.enso
git mv $DB/src/Internal/Postgres/Postgres_Type_Mapping.enso $DB/src/Postgres_Family/Postgres_Type_Mapping.enso
git mv $DB/src/Internal/Postgres/Postgres_Error_Mapper.enso $DB/src/Postgres_Family/Postgres_Error_Mapper.enso
git mv $DB/src/Internal/Postgres/Helpers.enso               $DB/src/Postgres_Family/Helpers.enso
git rm $DB/docs/api/Internal/Postgres/Helpers.md \
  $DB/docs/api/Internal/Postgres/Postgres_Dialect.md $DB/docs/api/Internal/Postgres/Postgres_Type_Mapping.md
```

**Files (edits):**

- Modify: `DB/src/Postgres_Family/Postgres_Dialect.enso`,
  `DB/src/Postgres_Family/Postgres_Error_Mapper.enso` (delete the first line,
  `private`, so other libraries can import them)
- Modify: `DB/src/Postgres_Family/Postgres_Type_Mapping.enso:9`
- Modify: `DB/src/Connection/Postgres_Connection.enso:19,20,25`
- Modify:
  `distribution/lib/Standard/DuckDB/0.0.0-dev/src/Internal/DuckDB_Dialect.enso:12,43`
- Modify:
  `distribution/lib/Standard/AWS/0.0.0-dev/src/Database/Redshift/Internal/Redshift_Dialect.enso:9,180,598`
- Modify:
  `distribution/lib/Standard/AWS/0.0.0-dev/src/Database/Redshift/Internal/Redshift_Type_Mapping.enso:11`
- Modify:
  `distribution/lib/Standard/AWS/0.0.0-dev/src/Database/Redshift/Redshift_Connection.enso:30`
- Modify:
  `distribution/lib/Standard/AWS/0.0.0-dev/src/Database/Redshift/Redshift_Details.enso`
  (drop the `Pgpass` import, line 9; `jdbc_properties`, lines 82-91)
- Modify: `test/AWS_Tests/src/Redshift_Spec.enso` (a credentials group),
  `CHANGELOG.md`
- Modify: `test/Table_Tests/src/Database/Postgres_Spec.enso:18`
- Modify: `DB/docs/api` (regenerated: `Postgres_Family/*.md`), `DB/CLAUDE.md`
  (Layout gains the base)

**Interfaces:**

- Produces:
  `Standard.Database.Postgres_Family.Postgres_Dialect.postgres : Postgres_Dialect`
  (the whole PostgreSQL dialect, for use as a parent),
  `Standard.Database.Postgres_Family.Postgres_Type_Mapping.Postgres_Type_Mapping`,
  `Standard.Database.Postgres_Family.Postgres_Error_Mapper.Postgres_Error_Mapper`,
  `Standard.Database.Postgres_Family.Helpers` (`get_encoding_name`,
  `parse_postgres_encoding`). `Pgpass` stays at
  `Standard.Database.Internal.Postgres.Pgpass` until Task 5 moves it. Task 5's
  `Postgres_Connection` and `Postgres` build on them; DuckDB and AWS depend on
  Database only.

What DuckDB and Redshift use today (the evidence for the base's contents):

| File:line                                                     | Uses                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DuckDB/0.0.0-dev/src/Internal/DuckDB_Dialect.enso:12,43`     | `Postgres_Connection.get_dialect` as `parent`                                                                                                                                               |
| `DuckDB_Dialect.enso:44,103,112,155,173,212,220,320`          | the parent's `get_dialect_operations`, `get_limit_sql_modifier`, `get_part_order`, `prepare_distinct`, `make_cast`, `cast_op_type`, `cast_aggregate_columns`, `prepare_metadata_for_period` |
| `AWS/.../Redshift/Internal/Redshift_Dialect.enso:9,180,598`   | `Postgres_Connection.get_dialect.prepare_order_descriptor`, `.get_dialect_operations`                                                                                                       |
| `AWS/.../Redshift/Internal/Redshift_Type_Mapping.enso:11,119` | `Postgres_Type_Mapping.sql_type_to_text`                                                                                                                                                    |
| `AWS/.../Redshift/Redshift_Connection.enso:30`                | `Helpers.get_encoding_name`, `parse_postgres_encoding`                                                                                                                                      |
| `AWS/.../Redshift/Redshift_Details.enso:9,84,85`              | `Pgpass.read` (removed in this task: Redshift stops reading `.pgpass`)                                                                                                                      |
| `AWS/.../Redshift/Redshift_Details.enso:5,8`                  | `Client_Certificate`, `SSL_Mode` (stay in `Connection/`, Amendment 2)                                                                                                                       |

- [ ] **Step 1: Move and rewrite the imports.** Run the `git mv` block. Then:
  - `Postgres_Type_Mapping.enso:9`:
    `import project.Postgres_Family.Postgres_Error_Mapper.Postgres_Error_Mapper`
  - `Postgres_Connection.enso:19,20,25`:
    `import project.Postgres_Family.Postgres_Dialect`,
    `import project.Postgres_Family.Postgres_Type_Mapping.Postgres_Type_Mapping`,
    `from project.Postgres_Family.Helpers import get_encoding_name, parse_postgres_encoding`
  - `DuckDB_Dialect.enso:12`:
    `import Standard.Database.Postgres_Family.Postgres_Dialect`; line 43:
    `parent = Postgres_Dialect.postgres`
  - `Redshift_Dialect.enso:9`:
    `import Standard.Database.Postgres_Family.Postgres_Dialect`; line 180:
    `Postgres_Dialect.postgres.prepare_order_descriptor internal_column sort_direction text_ordering`;
    line 598: `postgres_ops = Postgres_Dialect.postgres.get_dialect_operations`
  - `Redshift_Type_Mapping.enso:11`:
    `import Standard.Database.Postgres_Family.Postgres_Type_Mapping.Postgres_Type_Mapping`
  - `Redshift_Connection.enso:30`:
    `from Standard.Database.Postgres_Family.Helpers import get_encoding_name, parse_postgres_encoding`
  - `Redshift_Details.enso:9`: delete
    `import Standard.Database.Internal.Postgres.Pgpass`; `jdbc_properties`'
    `credentials` becomes:

    ```enso
        credentials = case self.credentials of
            ## The IAM URL and no keys or profile: the driver uses the default AWS
               credential chain. `.pgpass` is not read (a libpq convention).
            AWS_Credential.Default -> [Pair.new 'user' self.db_user]
            AWS_Credential.Profile profile ->
                [Pair.new 'user' self.db_user] + (if profile == '' then [] else [Pair.new 'profile' profile])
            AWS_Credential.Key access_key_id secret_access_key ->
                [Pair.new 'user' self.db_user, Pair.new 'AccessKeyID' access_key_id, Pair.new 'SecretAccessKey' secret_access_key]
            Credentials.Username_And_Password username password ->
                [Pair.new 'user' username, Pair.new 'password' password]
    ```

    and the `credentials` argument's doc says: "`.pgpass` is not read; pass
    `Credentials.Username_And_Password` or an `AWS_Credential`".

  - `Postgres_Spec.enso:18`:
    `from Standard.Database.Postgres_Family.Helpers import parse_postgres_encoding`

  Then
  `git grep -n "Internal\.Postgres\.\(Postgres_Dialect\|Postgres_Type_Mapping\|Postgres_Error_Mapper\|Helpers\)" -- distribution test`
  prints nothing, `git grep -n "Pgpass" -- distribution/lib/Standard/AWS` prints
  nothing, and
  `git grep -n "Postgres_Connection\.get_dialect" -- distribution test` prints
  only `DB/src/Connection/Postgres_Connection.enso` itself and
  `test/Table_Tests/src/Database/Postgres_Spec.enso` (which tests Postgres).

  In `test/AWS_Tests/src/Redshift_Spec.enso` add (with
  `import Standard.Base.Errors.Common.Type_Error` and
  `import Standard.Test.Test_Environment`) a group that needs no server, called
  from `add_specs` before the connection-dependent ones:

```enso
    suite_builder.group "[Redshift] Credentials, without a server" group_builder->
        group_builder.specify "AWS_Credential.Default passes the user and reads no .pgpass file" <|
            pgpass = File.create_temporary_file "pgpass" ".conf"
            "redshift.example.com:5439:*:someone:from-pgpass".write pgpass on_existing_file=..Overwrite
            if Platform.is_unix then
                Process.run "chmod" ["0600", pgpass.absolute.path] . exit_code . should_equal Exit_Code.Success
            Test_Environment.unsafe_with_environment_override "PGPASSFILE" pgpass.absolute.path <|
                details = Redshift_Details.Redshift "redshift.example.com" 5439 "dev" "someone" credentials=AWS_Credential.Default
                properties = details.jdbc_properties
                properties.map .first . should_equal ["user"]
                properties.first.second . should_equal "someone"
            pgpass.delete

        group_builder.specify "credentials=Nothing fails when the details are built" <|
            Test.expect_panic Type_Error <|
                Redshift_Details.Redshift "redshift.example.com" credentials=Nothing
```

(the `.pgpass` file gets 0600, which `Pgpass.verify` requires on Unix, so the
first test would see its password if anything still read it). Add to
`CHANGELOG.md` under `#### Enso Standard Library`:

```markdown
- [Redshift connections no longer read the PostgreSQL `.pgpass` file][NNN]: pass
  credentials explicitly or use AWS credentials.
```

- [ ] **Step 2: Build and run the tests.** `sbt buildEngineDistribution`, start
      a Postgres the way CI does (WSL):

```bash
docker run -d --name enso-pg -p 5432:5432 -e POSTGRES_DB=enso_test_db \
  -e POSTGRES_USER=enso_test_user -e POSTGRES_PASSWORD=enso_test_password postgres:18
export ENSO_POSTGRES_DATABASE=enso_test_db ENSO_POSTGRES_HOST=localhost:5432 \
  ENSO_POSTGRES_USER=enso_test_user ENSO_POSTGRES_PASSWORD=enso_test_password
cd test
for p in Table_Tests DuckDB_Tests AWS_Tests Generic_JDBC_Tests; do
  JAVA_TOOL_OPTIONS="-enableassertions" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/$p" || echo "FAILED $p"
done
```

Expected: no `FAILED`, and `Table_Tests` reports its `[PostgreSQL]` groups as
run, not pending (`AWS_Tests`' connection-dependent Redshift specs stay pending
without credentials; the new credentials group runs and passes). CI runs the
same projects in the `standard-library` suites with the `postgres` service
(`.github/workflows/engine-checks-platform.yml`, `postgres:18`) and AWS in
`std-aws`.

- [ ] **Step 3: API docs, docs, Linux.** Regenerate `DB/docs/api`,
      `distribution/lib/Standard/DuckDB/0.0.0-dev/docs/api` and
      `distribution/lib/Standard/AWS/0.0.0-dev/docs/api`; run
      `stdlib-api-check`. In `DB/CLAUDE.md`'s Layout add:
      "`src/Postgres_Family/` — the PostgreSQL dialect, type mapping, error
      mapper and encoding helpers that Postgres, DuckDB and Redshift share. Not
      exported from `Main.enso`; other libraries import the modules directly."
      Repeat Step 2 on Windows (DuckDB and SQLite parts; no Postgres there, as
      in CI).
- [ ] **Step 4: Commit and open the PR.** Title
      `Database: a Postgres-family base; Redshift no longer reads .pgpass`.
      Body: the table above, Amendments 2 and 3, the ruling on Redshift's
      credentials, and the test runs. Wait for the user's OK.

---

### Task 4: SQLite out, into `Standard.SQLite`

Needs Tasks 1 and 2 merged. A feature (changelog entry shared with Task 5);
merges after the user's OK.

**Files (moves):**

```bash
DB=distribution/lib/Standard/Database/0.0.0-dev
SQ=distribution/lib/Standard/SQLite/0.0.0-dev
mkdir -p $SQ/src/Internal $SQ/docs/api $SQ/THIRD-PARTY tools/legal-review/SQLite \
  std-bits/sqlite/src/main/java/org/enso/sqlite/nativeimage \
  std-bits/sqlite/src/main/resources/META-INF/native-image/org/enso/sqlite
git mv $DB/src/Connection/SQLite.enso             $SQ/src/SQLite.enso
git mv $DB/src/Connection/SQLite_Connection.enso  $SQ/src/SQLite_Connection.enso
git mv $DB/src/Connection/SQLite_Format.enso      $SQ/src/SQLite_Format.enso
for f in SQLite_Dialect SQLite_Entity_Naming_Properties SQLite_Error_Mapper SQLite_Services SQLite_Type_Mapping; do
  git mv $DB/src/Internal/SQLite/$f.enso $SQ/src/Internal/$f.enso
done
git rm $DB/docs/api/Connection/SQLite.md $DB/docs/api/Connection/SQLite_Connection.md \
  $DB/docs/api/Connection/SQLite_Format.md $DB/docs/api/Internal/SQLite/*.md
git mv std-bits/database/src/main/java/org/enso/database/nativeimage/SqliteJdbcPatchedFeature.java \
  std-bits/sqlite/src/main/java/org/enso/sqlite/nativeimage/SqliteJdbcPatchedFeature.java
git mv std-bits/database/src/main/resources/META-INF/native-image/org/enso/database/native-image.properties \
  std-bits/sqlite/src/main/resources/META-INF/native-image/org/enso/sqlite/native-image.properties
git mv tools/legal-review/Database/org.xerial.sqlite-jdbc-3.53.4.0 tools/legal-review/SQLite/
git mv $DB/THIRD-PARTY/org.xerial.sqlite-jdbc-3.53.4.0 $SQ/THIRD-PARTY/
```

**Files (create and modify):**

- Create: `SQ/package.yaml`, `SQ/src/Main.enso`, `SQ/CLAUDE.md`,
  `SQ/docs/api/**` (generated)
- Create: `std-bits/sqlite/CLAUDE.md`,
  `std-bits/sqlite/src/main/resources/META-INF/native-image/org/enso/sqlite/reflect-config.json`
- Create: `test/Table_Tests/src/Database/Library_Discovery_Spec.enso`
- Modify: the moved `.enso` files (imports), `SqliteJdbcPatchedFeature.java`
  (package), `native-image.properties` (feature name)
- Modify:
  `std-bits/database/src/main/resources/META-INF/native-image/org/enso/database/reflect-config.json`
  (drop the two `org.sqlite` entries), `std-bits/database/CLAUDE.md`,
  `std-bits/CLAUDE.md`
- Modify: `DB/src/Main.enso`, `DB/package.yaml`, `DB/CLAUDE.md`,
  `DB/docs/api/**` (regenerated), `DB/THIRD-PARTY/NOTICE` (regenerated)
- Modify: `build.sbt`, `distribution/edition.template.yaml`, `.gitignore`
- Modify: `tools/legal-review/Database/report-state`,
  `tools/legal-review/SQLite/report-state` (regenerated)
- Modify: `tools/ci/stdlib-test-map.yaml`
- Modify: `app/gui/src/project-view/components/EngineLogs/engineLogModel.ts`
  (`STD_BITS_PACKAGE_ROOTS`)
- Modify: `distribution/lib/Standard/CLAUDE.md` (library index)
- Modify: `app/electron-client/tasks/signArchivesMacOs.ts:112` (the SQLite jar's
  glob: `lib/Standard/Database/*/polyglot/java/sqlite-jdbc-*.jar` →
  `lib/Standard/SQLite/*/polyglot/java/sqlite-jdbc-*.jar`)
- Modify: the test files listed in Step 5,
  `test/Table_Tests/src/Database/Main.enso`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: Task 1's discovery (the dropdown, `Data.read`) and
  `checkPublicTypes`, Task 2's detector (through `library/listPublicTypes`).
- Produces: library `Standard.SQLite` exporting `SQLite` (`From_File`,
  `In_Memory`) and `SQLite_Format`; modules `Standard.SQLite.SQLite_Connection`,
  `Standard.SQLite.Internal.SQLite_Type_Mapping` (tests import them); sbt
  project `std-sqlite`, its `sqlite-polyglot-root` and `sqlite-native-libs`.

- [ ] **Step 1: The library.** Run the move block. Rewrite the moved modules'
      imports, in this order (a Database module becomes `Standard.Database.…`, a
      SQLite one `project.…`):

```bash
cd distribution/lib/Standard/SQLite/0.0.0-dev/src
sed -i -E \
  -e 's/^(import|from) project\./\1 Standard.Database./' \
  -e 's/^(import|from) Standard\.Database\.Connection\.(SQLite|SQLite_Connection|SQLite_Format)\./\1 project.\2./' \
  -e 's/^(import|from) Standard\.Database\.Internal\.SQLite\./\1 project.Internal./' \
  SQLite.enso SQLite_Connection.enso SQLite_Format.enso Internal/*.enso
cd -
git grep -n "project\.\(Connection\|DB_\|Dialects\|Errors\|SQL\.\|SQL_Query\|Column_Description\)" -- distribution/lib/Standard/SQLite
```

Expected: the grep prints nothing. Once `SQ/package.yaml` and `SQ/src/Main.enso`
(below) exist, compile the library with the engine of an existing build before
the long one, to catch private members or names used across the new library
boundary:

```bash
built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --compile distribution/lib/Standard/SQLite/0.0.0-dev
```

Expected: no Enso compile errors (a missing `org.sqlite` class is expected until
`std-sqlite` is built in Step 2; anything else is fixed now, by comparing with
how `Standard.DuckDB` reaches the same Database internals). Create
`SQ/package.yaml`:

```yaml
name: SQLite
namespace: Standard
version: 0.0.0-dev
license: APLv2
authors:
  - name: Enso Team
    email: contact@enso.org
maintainers:
  - name: Enso Team
    email: contact@enso.org
public-types: [SQLite, SQLite_Format]

services:
  - provides: Standard.Base.System.File_Format.File_Format_SPI
    with: Standard.SQLite.Internal.SQLite_Services.Impl

  - provides: Standard.Database.Connection.Database.Database_Connection_Details_SPI
    with: Standard.SQLite.Internal.SQLite_Services.Impl
```

`SQ/src/Main.enso`:

```enso
export project.SQLite.SQLite
export project.SQLite_Format.SQLite_Format
```

In `DB/src/Main.enso` delete `export project.Connection.SQLite.SQLite` and
`export project.Connection.SQLite_Format.SQLite_Format`; in `DB/package.yaml`
delete the two `Standard.Database.Internal.SQLite.SQLite_Services.Impl`
registrations. `Database.connect`'s `macros:`
(`DB/src/Connection/Database.enso:14-19`) stay as they are:
`sqlite: details=SQLite.From_File` is code the component browser inserts, and
Task 2's node trigger adds the import. Create `SQ/CLAUDE.md` in the shape of
`distribution/lib/Standard/DuckDB/0.0.0-dev/CLAUDE.md`: what it is ("SQLite
backend for `Standard.Database`: in-memory or file databases, and reading
`.db`/`.sqlite` files with `Data.read`"), main entry points (`SQLite.In_Memory`,
`SQLite.From_File path`, `SQLite_Connection`, `SQLite_Format`), common usage
(`Database.connect (SQLite.From_File "x.db")`, then `query`/`read`), and a
pitfall: "Moved out of `Standard.Database`; `from Standard.SQLite import all` is
needed in code run outside the IDE (the IDE adds it)."

- [ ] **Step 2: `std-sqlite` and `build.sbt`.** In
      `SqliteJdbcPatchedFeature.java` change the package to
      `org.enso.sqlite.nativeimage`; in the moved `native-image.properties`:
      `Args=--features=org.enso.sqlite.nativeimage.SqliteJdbcPatchedFeature`.
      Create `std-bits/sqlite/.../org/enso/sqlite/reflect-config.json`:

```json
[
  {
    "name": "org.sqlite.SQLiteErrorCode"
  },
  {
    "name": "org.sqlite.SQLiteException"
  }
]
```

and remove those two objects from `std-database`'s `reflect-config.json`. In
`build.sbt`:

- Next to `` `database-polyglot-root` `` (around line 4972):

```scala
val `sqlite-polyglot-root` =
  stdLibComponentRoot("SQLite") / "polyglot" / "java"
val `sqlite-native-libs` =
  stdLibComponentRoot("SQLite") / "polyglot" / "lib"
```

and delete `` `database-native-libs` ``.

- The new project, after `` `std-database` ``:

```scala
lazy val `std-sqlite` = project
  .in(file("std-bits") / "sqlite")
  .settings(
    frgaalJavaCompilerSetting,
    autoScalaLibrary := false,
    Compile / compile / compileInputs := (Compile / compile / compileInputs)
      .dependsOn(SPIHelpers.ensureSPIConsistency)
      .value,
    Compile / packageBin / artifactPath :=
      `sqlite-polyglot-root` / "std-sqlite.jar",
    libraryDependencies ++= Seq(
      "org.graalvm.polyglot" % "polyglot"    % graalMavenPackagesVersion % "provided",
      "org.xerial"           % "sqlite-jdbc" % sqliteVersion
    ),
    // Extract native libraries from sqlite-jdbc-**.jar and put them under
    // Standard/SQLite/polyglot/lib directory. The minimized jar will be
    // put under Standard/SQLite/polyglot/java directory.
    Compile / packageBin := {
      val cacheStoreFactory = streams.value.cacheStoreFactory
      val stdSqliteJar      = (Compile / packageBin).value
      StdBits
        .copyDependencies(
          `sqlite-polyglot-root`,
          Seq("std-sqlite.jar"),
          ignoreScalaLibrary = true,
          ignoreDependencyIncludeTransitive =
            Some(s"sqlite-jdbc-${sqliteVersion}"),
          libraryUpdates     = (Compile / update).value,
          logger             = streams.value.log,
          cacheStoreFactory  = cacheStoreFactory,
          unmanagedClasspath = (Compile / unmanagedJars).value,
          polyglotLibDir     = Some(`sqlite-native-libs`),
          extractedNativeLibsDirs = Seq(
            (`sqlite-wrapper` / extractedFilesDir).value
          ),
          extraJars = Seq(
            (`sqlite-wrapper` / thinJarOutput).value
          )
        )
      stdSqliteJar
    },
    clean := Def.task {
      val _ = clean.value
      IO.delete(`sqlite-polyglot-root`)
      IO.delete(`sqlite-native-libs`)
    }.value
  )
  .dependsOn(`std-base` % "provided")
  .dependsOn(`std-table` % "provided")
  .dependsOn(`std-database` % "provided")
```

- `` `std-database` `` keeps only the polyglot API and the `postgresql` driver
  (Task 5 removes that), and copies its dependencies without natives:

```scala
    libraryDependencies ++= Seq(
      "org.graalvm.polyglot" % "polyglot"   % graalMavenPackagesVersion % "provided",
      "org.postgresql"       % "postgresql" % postgresVersion
    ),
    Compile / packageBin := {
      val result            = (Compile / packageBin).value
      val cacheStoreFactory = streams.value.cacheStoreFactory
      StdBits
        .copyDependencies(
          `database-polyglot-root`,
          Seq("std-database.jar"),
          ignoreScalaLibrary = true,
          libraryUpdates     = (Compile / update).value,
          unmanagedClasspath = (Compile / unmanagedClasspath).value,
          logger             = streams.value.log,
          cacheStoreFactory
        )
      result
    },
    clean := Def.task {
      val _ = clean.value
      IO.delete(`database-polyglot-root`)
    }.value
```

- `GatherLicenses.distributions` (the `makeStdLibDistribution` list, line ~123):
  add
  `makeStdLibDistribution("SQLite", Distribution.sbtProjects(`std-sqlite`)),`
  after Database's.
- The aggregate list (line ~485): add `` `std-sqlite`, `` after
  `` `std-saas`, ``.
- `runtime`'s `(Runtime / compile)` (line ~2804): add
  ``.dependsOn(`std-sqlite` / Compile / packageBin)`` after `std-saas`'s.
- `ciBuildEngineDistribution` (line ~260):
  `Seq("Base", "Table", "Image", "Database", "SQLite")`.
- The native image's `stdLibsJars` (line ~3880): the comment and `databaseCp`
  become

```scala
        // sqliteCp needs to be included in class-path because of
        // the patched SqliteJdbcFeature. It is not enough to include just
        // the jars from `sqlite-polyglot-root`.
        val sqliteCp =
          (`std-sqlite` / Compile / fullClasspath).value
            .map(_.data.getAbsolutePath)
```

    and the non-fast branch is `base ++ sqliteCp ++` the table, database,
    `` `sqlite-polyglot-root`.listFiles("*.jar").map(_.getAbsolutePath()) ``
    and duckdb jars.

- `rebuildNativeImage` (line ~3924):
  `val sqliteFeature = "org.enso.sqlite.nativeimage.SqliteJdbcPatchedFeature"`,
  used where `databaseFeature` was.
- `` `std-tests` `` (line ~5261): add ``.dependsOn(`std-sqlite`)``
  (`LocalAuditedConnectionTest` opens `jdbc:sqlite::memory:`).

`.gitignore`: after `distribution/lib/Standard/Database/*/polyglot/` add
`distribution/lib/Standard/SQLite/*/polyglot/`.
`distribution/edition.template.yaml`: after the `Standard.Database` entry add

```text
  - name: Standard.SQLite
    repository: release
    version: {{LIBS_VERSION}}
```

(copied from the `Standard.Database` entry: two-space indented, and
`{{LIBS_VERSION}}` with no spaces inside the braces, which
`project/Editions.scala` requires).

Create `std-bits/sqlite/CLAUDE.md`: "Java for `Standard.SQLite`
(`distribution/lib/Standard/SQLite/`), packaged as `std-sqlite.jar` with the
`sqlite-jdbc` driver (thinned by `lib/java/sqlite-wrapper`, whose natives go to
`polyglot/lib`). Its only class is `nativeimage/SqliteJdbcPatchedFeature`, the
native-image feature `build.sbt`'s `rebuildNativeImage` names; `stdLibsJars`
puts this project's full class path on the image class path for it. The JDBC
plumbing is `std-bits/database`'s." In `std-bits/database/CLAUDE.md`, the first
paragraph names SQLite among the libraries that use it, not as part of it; in
`std-bits/CLAUDE.md` add `sqlite/` to the modules list.

- [ ] **Step 3: Legal review.** In WSL: `sbt gatherLicenses`, then
      `sbt verifyLicensePackages`. Expected: `No fatal errors` for every
      distribution and a passing verify; commit the regenerated
      `DB/THIRD-PARTY/NOTICE`, `SQ/THIRD-PARTY/NOTICE`,
      `tools/legal-review/{Database,SQLite}/report-state`. If SQLite reports
      unreviewed copyrights, carry over the decisions of the moved
      `org.xerial.sqlite-jdbc-3.53.4.0` directory (see
      `tools/legal-review/CLAUDE.md`, "Bumping a dependency", step 2).
- [ ] **Step 4: Declared types and the log roots.** `SQ/package.yaml` already
      declares `public-types: [SQLite, SQLite_Format]` (Step 1), what
      `SQ/src/Main.enso` exports; `node tools/ci/check-workflows.mjs` passes
      (`checkPublicTypes`; Database is in the core set and declares nothing).
      This is what lets the IDE add the SQLite import to an old project whose
      engine has not loaded `Standard.SQLite` (Amendment 1).

In `engineLogModel.ts`, add `'org.enso.sqlite',` after `'org.enso.snowflake',`
in `STD_BITS_PACKAGE_ROOTS`. Run the GUI's `test:unit` (its `logOrigin` test
reads the new package root).

- [ ] **Step 5: The tests' imports.** Add the line
      `from Standard.SQLite import all` right after the file's
      `from Standard.Database import all` in:
  - `test/Table_Tests/src/Common_Table_Operations/Core_Spec.enso` (line 12)
  - `test/Table_Tests/src/Common_Table_Operations/Join/Cross_Join_Spec.enso` (9)
  - `test/Table_Tests/src/Common_Table_Operations/Join/Join_Spec.enso` (9)
  - `test/Table_Tests/src/Common_Table_Operations/Join/Lookup_Spec.enso` (8)
  - `test/Table_Tests/src/Common_Table_Operations/Join/Union_Spec.enso` (8)
  - `test/Table_Tests/src/Common_Table_Operations/Join/Zip_Spec.enso` (7)
  - `test/Table_Tests/src/Database/Codegen_Spec.enso` (6)
  - `test/Table_Tests/src/Database/Common/Default_Ordering_Spec.enso` (6)
  - `test/Table_Tests/src/Database/Common/Names_Length_Limits_Spec.enso` (6)
  - `test/Table_Tests/src/Database/Upload_Spec.enso` (15)
  - `test/Table_Tests/src/IO/Read_Many_Spec.enso` (7)
  - `test/Table_Tests/src/Database/SQLite_Spec.enso` (14), whose line 15 becomes
    `import Standard.SQLite.SQLite_Connection.SQLite_Connection`
  - `test/Visualization_Tests/src/Table_Spec.enso` (5)
  - `test/Visualization_Tests/src/Widgets/Database_Widgets_Spec.enso` (7)
  - `test/Generic_JDBC_Tests/src/Generic_JDBC_SQLite_Spec.enso` (3), with a
    comment above it: `# Loads the library, and with it the SQLite JDBC driver.`

  And:
  - `test/Table_Tests/src/Database/Types/SQLite_Type_Mapping_Spec.enso`: line 8
    `import Standard.SQLite.SQLite_Connection.SQLite_Connection`, line 11
    `import Standard.SQLite.Internal.SQLite_Type_Mapping`, line 12
    `from Standard.Database import SQL_Query` plus a new line
    `from Standard.SQLite import SQLite`.
  - `test/Table_Tests/src/In_Memory/Table_Spec.enso:17`:
    `import Standard.SQLite.SQLite.SQLite`.
  - `test/Visualization_Tests/src/SQL_Spec.enso:4`:
    `from Standard.Database import SQL_Query` plus a new line
    `from Standard.SQLite import SQLite`.
  - `test/Base_Tests/src/Logging_Spec.enso`: inside the generated project's
    source (after line 139, `from Standard.Database import all`), the line
    `            from Standard.SQLite import all`, indented like its neighbours.

  The list is every file whose code (outside comments and strings) names
  `SQLite`, `SQLite_Format`, `SQLite_Connection` or `SQLite_Type_Mapping`, plus
  the two that need the driver (`Generic_JDBC_SQLite_Spec`, `Logging_Spec`'s
  subprocess). Re-derive it before editing in case `develop` moved:

```bash
git grep -lwE "SQLite|SQLite_Format|SQLite_Connection" -- 'test/*.enso'
```

and drop the hits that only mention SQLite in a comment, a group name or a
string.

In `tools/ci/stdlib-test-map.yaml`: under `libraries` add
`SQLite: { stdBits: [sqlite], dependsOn: [Base, Database, Table] }`;
`Generic_JDBC_Tests.imports` becomes
`[Base, Database, Generic_JDBC, SQLite, Test]`; `Table_Tests.imports`
`[Base, Database, Examples, SQLite, Table, Test, Visualization]`;
`Visualization_Tests.imports`
`[Base, Database, Examples, Geo, Image, SQLite, Table, Test, Visualization]`.
Run `node tools/ci/check-workflows.mjs` and `node --test tools/ci/*.test.mjs`.

- [ ] **Step 6: The discovery test.** Create
      `test/Table_Tests/src/Database/Library_Discovery_Spec.enso`:

```enso
from Standard.Base import all

from Standard.Database import all
from Standard.SQLite import all

from Standard.Test import all

import enso_dev.Base_Tests.Enso_Bin_Utils

## Runs `main_src` as the `Main.enso` of a new project and returns what it
   printed. The project imports only what `main_src` says, unlike this test
   project, which imports `Standard.SQLite` and so has it loaded.
private run_project main_src:Text -> Text =
    parent = Enso_Bin_Utils.create_tmp_dir
    Panic.with_finalizer (parent.delete recursive=True) <|
        project = Enso_Bin_Utils.create_new_project parent "discovery_check" main_src
        jvm_args = if Enso_Bin_Utils.runs_in_aot then [] else ["--jvm"]
        Enso_Bin_Utils.enso_run jvm_args+["--run", project.path] parent.path

add_specs suite_builder =
    suite_builder.group "Library discovery without an import" group_builder->
        group_builder.specify "Data.read recognises a SQLite file" <|
            db_file = File.create_temporary_file "discovery" ".db"
            db_file.delete
            connection = Database.connect (SQLite.From_File db_file)
            connection.execute_update 'CREATE TABLE "t" ("x" INTEGER)'
            connection.execute_update 'INSERT INTO "t" VALUES (1), (2), (3)'
            connection.close
            main_src = 'from Standard.Base import all\n\nmain =\n    connection = Data.read (File.new "' + db_file.path + '")\n    IO.println (Meta.type_of connection . to_text)\n    IO.println (connection.query "t" . read . row_count)\n'
            output = run_project main_src
            output.should_contain "SQLite_Connection"
            output.should_contain "3"
            db_file.delete

        group_builder.specify "Database.connect's dropdown lists SQLite" <|
            main_src = 'from Standard.Base import all\nfrom Standard.Database import all\nimport Standard.Visualization.Widgets\n\nmain =\n    IO.println (Widgets.get_widget_json Database .connect ["details"])\n'
            run_project main_src . should_contain "SQLite.From_File"

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

In `test/Table_Tests/src/Database/Main.enso` add
`import project.Database.Library_Discovery_Spec` and
`Library_Discovery_Spec.add_specs suite_builder` after the SQLite ones.

- [ ] **Step 7: Build and run.** `sbt buildEngineDistribution`, then from
      `test/` (assertions on, as in Global Constraints) `Table_Tests`,
      `Visualization_Tests`, `Generic_JDBC_Tests`, `Base_Tests`, `DuckDB_Tests`,
      then
      `sbt "std-tests/testOnly org.enso.database.audit.LocalAuditedConnectionTest"`.
      Expected: all pass; `Table_Tests`' log shows the two "Library discovery"
      specs run. Then regenerate `DB/docs/api` and `SQ/docs/api` (the `SQ`
      directory must exist first, so `stdlib-api-check` picks it up) and run
      `stdlib-api-check`. Do all of it on Windows and in WSL.
- [ ] **Step 8: Native image and installers.** On Windows (a Visual Studio
      developer prompt) and in WSL,
      `corepack pnpm --filter build-scripts run ide-local`. Install each
      installer and check by hand, timing the first:
  - a fresh project: `Database.connect`, open the `details` dropdown (note how
    long the first open takes), choose SQLite, browse to a `.db` file (make one
    with `test/Table_Tests/data/` if needed); the node gets
    `from Standard.SQLite import SQLite` with it; read a table.
  - `Data.read` of the same `.db` file in a node, with no SQLite import, gives a
    connection.
  - an old project: a project whose `Main.enso` has
    `connection = Database.connect (SQLite.In_Memory)` with only
    `from Standard.Base import all` and `from Standard.Database import all`
    opens, shows the notice, gets the import, and runs.

  If the first dropdown open takes more than 5 s on Windows, open a follow-up
  ticket for warming the lookup when a project opens (ruling); record the time
  in the PR either way.

- [ ] **Step 9: Docs and changelog.** `DB/CLAUDE.md`: the intro's backends list
      says SQLite is in `Standard.SQLite`; Layout unchanged.
      `distribution/lib/Standard/CLAUDE.md`'s index gains "`SQLite/` — SQLite
      backend (in-memory or file) and the `.db` file format." Add to
      `CHANGELOG.md` under `#### Enso Standard Library`:

```markdown
- [SQLite is now its own library, `Standard.SQLite`][NNN]: the IDE adds
  `from Standard.SQLite import SQLite` where code uses it, and fixes older
  projects when they open; `Database.connect`'s list and `Data.read` of a SQLite
  file work without the import. Code run outside the IDE (`enso --run`), and
  `Generic_JDBC` connections to a `jdbc:sqlite:` URL, need
  `from Standard.SQLite import all` added by hand.
```

- [ ] **Step 10: Commit and open the PR.** Title
      `Standard.SQLite: SQLite moves out of Standard.Database`. Body: what moved
      (the `git mv` list), the build changes, the legal review, the test and
      installer results with the dropdown timing, and the rulings on the
      subprocess test, `Generic_JDBC_Tests` and the native-image feature, and
      that the macOS signing glob (`signArchivesMacOs.ts`) moved but cannot be
      verified locally (it runs only in the macOS release job). Wait for the
      user's OK.

---

### Task 5: Postgres out, into `Standard.Postgres`

Needs Tasks 1–4 merged; branch from `develop` after Task 4. A feature (the
changelog entry is Task 4's, extended); merges after the user's OK.

**Files (moves):**

```bash
DB=distribution/lib/Standard/Database/0.0.0-dev
PG=distribution/lib/Standard/Postgres/0.0.0-dev
mkdir -p $PG/src/Internal $PG/docs/api $PG/THIRD-PARTY tools/legal-review/Postgres
git mv $DB/src/Connection/Postgres.enso                    $PG/src/Postgres.enso
git mv $DB/src/Connection/Postgres_Connection.enso         $PG/src/Postgres_Connection.enso
git mv $DB/src/Connection/Data_Link/Postgres_Data_Link.enso $PG/src/Postgres_Data_Link.enso
git mv $DB/src/Internal/Postgres/Postgres_Services.enso    $PG/src/Internal/Postgres_Services.enso
git mv $DB/src/Internal/Postgres/Pgpass.enso               $PG/src/Internal/Pgpass.enso
git rm $DB/docs/api/Connection/Postgres.md $DB/docs/api/Connection/Postgres_Connection.md \
  $DB/docs/api/Internal/Postgres/Pgpass.md
git mv tools/legal-review/Database/org.postgresql.postgresql-42.7.13 tools/legal-review/Postgres/
git mv tools/legal-review/Database/org.checkerframework.checker-qual-3.55.1 tools/legal-review/Postgres/
git mv tools/legal-review/Database/reviewed-licenses tools/legal-review/Postgres/
git mv $DB/THIRD-PARTY/org.postgresql.postgresql-42.7.13 $PG/THIRD-PARTY/
git mv $DB/THIRD-PARTY/org.checkerframework.checker-qual-3.55.1 $PG/THIRD-PARTY/
```

(`checker-qual` is `postgresql`'s dependency; `reviewed-licenses/MIT_License` is
its licence.)

**Files (create and modify):**

- Create: `PG/package.yaml`, `PG/src/Main.enso`, `PG/CLAUDE.md`,
  `PG/docs/api/**` (generated), `std-bits/postgres/CLAUDE.md`,
  `tools/legal-review/Database/components-without-dependencies`
- Modify: the moved `.enso` files (imports; `Postgres.enso:155`'s `libraryName`)
- Modify: `DB/src/Main.enso`, `DB/package.yaml`, `DB/CLAUDE.md`,
  `DB/docs/api/**`, `DB/THIRD-PARTY/NOTICE`
- Modify: `build.sbt`, `distribution/edition.template.yaml`, `.gitignore`,
  `tools/legal-review/{Database,Postgres}/report-state`
- Modify: `tools/ci/stdlib-test-map.yaml`
- Modify: `app/gui/src/utils/datalinkSchema.json`,
  `app/gui/src/datalinks/DatalinkInput.vue` (`UNAVAILABLE_SCHEMAS`),
  `app/gui/src/datalinks/__tests__/DatalinkInput.test.ts`,
  `app/gui/src/utils/__tests__/dataLinkSchema.test.ts`
- Modify: `tools/http-test-helper/www-files/some-postgres.datalink`
- Modify: `test/Table_Tests/src/Database/Postgres_Spec.enso`,
  `test/Generic_JDBC_Tests/src/Generic_JDBC_Postgres_Spec.enso`,
  `test/Table_Tests/src/Database/Library_Discovery_Spec.enso`
- Modify: `std-bits/database/CLAUDE.md`, `std-bits/CLAUDE.md`,
  `distribution/lib/Standard/CLAUDE.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: Task 3's `Standard.Database.Postgres_Family.*`; Task 1's discovery
  for the dropdown and data links; Task 2's detector.
- Produces: library `Standard.Postgres` exporting `Postgres` (`Server`); modules
  `Standard.Postgres.Postgres_Connection` (`Postgres_Connection`, `get_dialect`)
  and the private `Standard.Postgres.Postgres_Data_Link`;
  `Standard.Postgres.Internal.Pgpass` (the `.pgpass` reader, Postgres only); sbt
  project `std-postgres` and `postgres-polyglot-root`. `SSL_Mode`,
  `Client_Certificate` and the family base stay in `Standard.Database`; DuckDB
  and AWS do not depend on `Standard.Postgres`.

- [ ] **Step 1: The library.** Run the move block, then:

```bash
cd distribution/lib/Standard/Postgres/0.0.0-dev/src
sed -i -E \
  -e 's/^(import|from) project\./\1 Standard.Database./' \
  -e 's/^(import|from) Standard\.Database\.Connection\.(Postgres|Postgres_Connection)\./\1 project.\2./' \
  -e 's/^(import|from) Standard\.Database\.Connection\.Data_Link\.Postgres_Data_Link\./\1 project.Postgres_Data_Link./' \
  -e 's/^(import|from) Standard\.Database\.Internal\.Postgres\.Postgres_Services\./\1 project.Internal.Postgres_Services./' \
  -e 's/^(import|from) Standard\.Database\.Internal\.Postgres\.Pgpass/\1 project.Internal.Pgpass/' \
  Postgres.enso Postgres_Connection.enso Postgres_Data_Link.enso Internal/Postgres_Services.enso Internal/Pgpass.enso
sed -i 's/\["libraryName", "Standard.Database"\]/["libraryName", "Standard.Postgres"]/' Postgres.enso
cd -
git grep -n "project\.\(Connection\|Internal\.Postgres\.\|DB_\|Dialects\|Errors\|SQL\.\|SQL_Query\|Column_Description\|Postgres_Family\)" -- distribution/lib/Standard/Postgres
```

Expected: the grep prints nothing (`Postgres.enso`'s `SSL_Mode` and
`Client_Certificate` imports are now `Standard.Database.Connection.…`).
`PG/package.yaml`:

```yaml
name: Postgres
namespace: Standard
version: 0.0.0-dev
license: APLv2
authors:
  - name: Enso Team
    email: contact@enso.org
maintainers:
  - name: Enso Team
    email: contact@enso.org
public-types: [Postgres]

services:
  - provides: Standard.Base.Enso_Cloud.Data_Link.Data_Link_SPI
    with: Standard.Postgres.Internal.Postgres_Services.Impl

  - provides: Standard.Database.Connection.Database.Database_Connection_Details_SPI
    with: Standard.Postgres.Internal.Postgres_Services.Impl
```

`PG/src/Main.enso`:

```enso
export project.Postgres.Postgres
```

In `DB/src/Main.enso` delete `export project.Connection.Postgres.Postgres`
(`Client_Certificate`, `SSL_Mode` stay); in `DB/package.yaml` delete the two
Postgres registrations and, with them, the now empty `services:` key.
`git grep -n "Internal/Postgres\|Internal\.Postgres" -- distribution` prints
nothing. `PG/CLAUDE.md` follows `SQ/CLAUDE.md`'s shape:
`Postgres.Server host port database …` for `Database.connect`,
`Postgres_Connection`, data links of type `Postgres_Connection` (old files with
`libraryName: Standard.Database` still work), `SSL_Mode` and
`Client_Certificate` come from `Standard.Database`, and the same pitfall about
the import outside the IDE.

- [ ] **Step 2: `std-postgres` and `build.sbt`.** Next to the SQLite roots:
      ``val `postgres-polyglot-root` = stdLibComponentRoot("Postgres") / "polyglot" / "java"``.
      After `` `std-sqlite` ``:

```scala
lazy val `std-postgres` = project
  .in(file("std-bits") / "postgres")
  .settings(
    frgaalJavaCompilerSetting,
    autoScalaLibrary := false,
    Compile / compile / compileInputs := (Compile / compile / compileInputs)
      .dependsOn(SPIHelpers.ensureSPIConsistency)
      .value,
    Compile / packageBin / artifactPath :=
      `postgres-polyglot-root` / "std-postgres.jar",
    libraryDependencies ++= Seq(
      "org.graalvm.polyglot" % "polyglot"   % graalMavenPackagesVersion % "provided",
      "org.postgresql"       % "postgresql" % postgresVersion
    ),
    Compile / packageBin := {
      val result            = (Compile / packageBin).value
      val cacheStoreFactory = streams.value.cacheStoreFactory
      StdBits
        .copyDependencies(
          `postgres-polyglot-root`,
          Seq("std-postgres.jar"),
          ignoreScalaLibrary = true,
          libraryUpdates     = (Compile / update).value,
          unmanagedClasspath = (Compile / unmanagedClasspath).value,
          logger             = streams.value.log,
          cacheStoreFactory
        )
      result
    },
    clean := Def.task {
      val _ = clean.value
      IO.delete(`postgres-polyglot-root`)
    }.value
  )
  .dependsOn(`std-base` % "provided")
  .dependsOn(`std-table` % "provided")
  .dependsOn(`std-database` % "provided")
```

- `` `std-database` ``'s `libraryDependencies` keeps only the polyglot API.
- `GatherLicenses.distributions`:
  `makeStdLibDistribution("Postgres", Distribution.sbtProjects(`std-postgres`)),`.
- Aggregate list: `` `std-postgres`, ``; `runtime`'s `(Runtime / compile)`:
  ``.dependsOn(`std-postgres` / Compile / packageBin)``;
  `ciBuildEngineDistribution`: add `"Postgres"`.
- `stdLibsJars`: add
  `` `postgres-polyglot-root`.listFiles("*.jar").map(_.getAbsolutePath()) ``
  next to the SQLite jars (the driver was in the image through Database's jars
  before). `initializeAtRuntime` keeps `"org.postgresql"`.

`.gitignore`: `distribution/lib/Standard/Postgres/*/polyglot/`.
`edition.template.yaml`, after the `Standard.SQLite` entry:

```text
  - name: Standard.Postgres
    repository: release
    version: {{LIBS_VERSION}}
```

`tools/legal-review/Database/components-without-dependencies`:

```
# See `componentsWithoutDependenciesFileName` in project/GatherLicenses.scala.
std-database: depends only on the GraalVM polyglot API, which the runtime provides, and on other standard libraries; the JDBC drivers ship with Standard.Postgres, Standard.SQLite and the other backend libraries.
```

`std-bits/postgres/CLAUDE.md`: "Ships the `postgresql` JDBC driver (and its
`checker-qual`) for `Standard.Postgres` as `polyglot/java` jars; no Java of its
own. The Postgres code is Enso, in `distribution/lib/Standard/Postgres/`; the
shared dialect is `Standard.Database.Postgres_Family`."
`std-bits/database/CLAUDE.md` and `std-bits/CLAUDE.md` updated as in Task 4.

- [ ] **Step 3: Legal review.** `sbt gatherLicenses`,
      `sbt verifyLicensePackages` in WSL, as Task 4 Step 3, for Database and
      Postgres.
- [ ] **Step 4: The data link schema.** In `datalinkSchema.json`,
      `PostgresDataLink.properties.libraryName` becomes
      `{ "const": "Standard.Postgres" }`; add `PostgresLegacyDataLink`, a copy
      of `PostgresDataLink` with
      `"title": "Postgres Database Connection (Standard.Database)"` and
      `"libraryName": { "const": "Standard.Database" }`; add
      `{ "$ref": "#/$defs/PostgresLegacyDataLink" }` to `DataLink.anyOf` after
      `PostgresDataLink`. In `DatalinkInput.vue`:

```ts
const UNAVAILABLE_SCHEMAS: ReadonlyMap<string, TextId | null> = new Map([
  ["#/$defs/EnsoFileDataLink", null],
  // Links written before PostgreSQL moved to `Standard.Postgres`: valid, never offered.
  ["#/$defs/PostgresLegacyDataLink", null],
]);
```

In `DatalinkInput.test.ts`, the new Postgres link's expectation (line ~139)
becomes `libraryName: 'Standard.Postgres'`; `WITH_SECRET` keeps
`Standard.Database` (an old link still opens in the form) and the type-list test
(line ~117) keeps its five titles (the legacy one is not offered). In
`tools/http-test-helper/www-files/some-postgres.datalink`, `libraryName` becomes
`Standard.Postgres`. In `dataLinkSchema.test.ts` add:

```ts
v.test("validates Postgres data links of both library names", () => {
  const current = loadDataLinkFile(
    path.resolve(
      REPO_ROOT,
      "tools/http-test-helper/www-files/some-postgres.datalink",
    ),
  );
  testSchema(current, "some-postgres.datalink");
  const old = loadDataLinkFile(
    path.resolve(TABLE_DATA_LINKS_ROOT, "postgres-db.datalink"),
  );
  v.expect((old as { libraryName: string }).libraryName).toBe(
    "Standard.Database",
  );
  testSchema(old, "postgres-db.datalink");
});
```

Run the GUI's `test:unit`, `typecheck`, `lint` and prettier.

- [ ] **Step 5: Declared types, tests, map.** `PG/package.yaml` declares
      `public-types: [Postgres]` (Step 1), what `PG/src/Main.enso` exports;
      `node tools/ci/check-workflows.mjs` passes. Then:
  - `Postgres_Spec.enso`: after line 12 (`from Standard.Database import all`)
    add `from Standard.Postgres import all`; line 13 becomes
    `import Standard.Postgres.Postgres_Connection.Postgres_Connection`, and line
    16 `import Standard.Postgres.Internal.Pgpass`.
  - `Generic_JDBC_Postgres_Spec.enso`: after line 4 add
    `from Standard.Postgres import all`.
  - `Library_Discovery_Spec.enso`: the dropdown spec also checks
    `should_contain "Postgres.Server"`, and a third spec:

```enso
        group_builder.specify "a saved Postgres data link resolves" <|
            link = enso_project.data / "datalinks" / "postgres-db.datalink"
            main_src = 'from Standard.Base import all\n\nmain =\n    r = Data.read (File.new "' + link.path + '")\n    IO.println (r.catch . to_display_text)\n'
            # The link's server does not exist: what matters is that the type is found.
            run_project main_src . should_not_contain "Missing_Data_Link_Library"
```

- `tools/ci/stdlib-test-map.yaml`: under `libraries`,
  `Postgres: { stdBits: [postgres], dependsOn: [Base, Database, Table] }`;
  `Generic_JDBC_Tests.imports`
  `[Base, Database, Generic_JDBC, Postgres, SQLite, Test]`;
  `Table_Tests.imports`
  `[Base, Database, Examples, Postgres, SQLite, Table, Test, Visualization]`.
  Run `check-workflows.mjs` and its tests. Re-check with
  `git grep -lwE "Postgres|Postgres_Connection" -- 'test/*.enso'` that no other
  file names them in code (`DuckDB_Tests` imports
  `enso_dev.Table_Tests.Database.Postgres_Spec`, which is enough).
- [ ] **Step 6: Build and run.** As Task 3 Step 2 with a Postgres server
      (`Table_Tests`, `DuckDB_Tests`, `AWS_Tests`, `Generic_JDBC_Tests`,
      `Visualization_Tests`), including `Postgres_Spec`'s data link specs (they
      read the old-format fixtures and fetch `some-postgres.datalink` from the
      HTTP test helper, `stdlib-test` starts it). Regenerate `DB/docs/api` and
      `PG/docs/api`, run `stdlib-api-check`. Windows and WSL.
- [ ] **Step 7: Native image and installers.** As Task 4 Step 8, with: a fresh
      project's dropdown lists Postgres and choosing it adds
      `from Standard.Postgres import Postgres`; with a Postgres server (WSL's
      container, reachable from Windows on `localhost:5432`) the connection
      opens and a table reads; an old project with
      `Database.connect (Postgres.Server 'localhost' 5432 …)` gets its import on
      open; an existing `postgres-db.datalink`-style file (with real connection
      details) opens from the drive in the datalink editor and reads. Record the
      first dropdown open's time again.
- [ ] **Step 8: Docs and changelog.** `DB/CLAUDE.md`: Database has no backend;
      Postgres is `Standard.Postgres`, SQLite `Standard.SQLite`; the family base
      stays. `distribution/lib/Standard/CLAUDE.md`'s index gains "`Postgres/` —
      PostgreSQL backend." and Database's line says the Postgres-family dialect
      base lives there. Replace Task 4's `CHANGELOG.md` entry with:

```markdown
- [PostgreSQL][NNN5] and [SQLite][NNN4] are now their own libraries,
  `Standard.Postgres` and `Standard.SQLite`: the IDE adds their imports where
  code uses them and fixes older projects when they open, and
  `Database.connect`'s list, `Data.read` of a SQLite file and saved PostgreSQL
  data links work without the import. Code run outside the IDE (`enso --run`),
  and `Generic_JDBC` connections to their URLs, need
  `from Standard.Postgres import all` or `from Standard.SQLite import all` added
  by hand.
```

with `[NNN5]: https://github.com/jdunkerley/enso/pull/NNN5` beside Task 4's link
definition.

- [ ] **Step 9: Commit and open the PR.** Title
      `Standard.Postgres: PostgreSQL moves out of Standard.Database`. Body: the
      moves, the data link schema change, the ruling on `SSL_Mode` and
      `Client_Certificate`, the legal review, test and installer results. Wait
      for the user's OK.

---

## Spec coverage

| Spec section                                                                                                                                                  | Task                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Libraries and layering: `Standard.SQLite`                                                                                                                  | 4                                                                                             |
| 1. `Standard.Postgres`, data link, `Pgpass`                                                                                                                   | 5 (`Pgpass` moves with Postgres, Amendment 3)                                                 |
| 1. Database's Postgres-family base, DuckDB and Redshift on it                                                                                                 | 3                                                                                             |
| 1. Everything that moves with them (edition, `makeStdLibDistribution`, legal, native image, test map, test imports, `LocalAuditedConnectionTest`, `docs/api`) | 4, 5                                                                                          |
| 2. Service discovery: order, cheap listing, lazy loading, failures                                                                                            | 1                                                                                             |
| 2. Dropdown, `Data.read`, data links without an import                                                                                                        | 1 (mechanism), 4 and 5 (`Library_Discovery_Spec`)                                             |
| 2. Data link schema moves, still accepts `Standard.Database`                                                                                                  | 5                                                                                             |
| 2. Cost: measure the dropdown's first open                                                                                                                    | 4, 5 (installer check)                                                                        |
| 2. Tests: engine fixtures; `Database_Widgets_Spec` without the AWS workaround                                                                                 | 1                                                                                             |
| 3. The detector, its rules and its tests                                                                                                                      | 2                                                                                             |
| 3. Triggers: node commit, widget choice, project open with one notice                                                                                         | 2                                                                                             |
| 4. Compatibility table (old projects, old data links, `Data.read`, `macros:`, `enso --run`)                                                                   | 2, 1, 1, 4 (unchanged `macros:`), changelog in 4 and 5                                        |
| 4. Five PRs, shared changelog entry, verification beyond CI                                                                                                   | Merge order; 4 and 5                                                                          |
| Amendment 1: `public-types:`, its check, discovery reads it, `library/listPublicTypes`                                                                        | 1 (all thirteen non-core libraries declare), 2 (GUI map), 4 and 5 (the new libraries declare) |
| Amendment 2: `SSL_Mode`, `Client_Certificate` stay                                                                                                            | 5                                                                                             |
| Amendment 3: `Postgres_Family` with the helpers; Redshift stops reading `.pgpass`                                                                             | 3                                                                                             |
| Amendment 4: `loaded_only`, loaded first                                                                                                                      | 1                                                                                             |
| Amendment 5: "installed"                                                                                                                                      | 1 (`InstalledLibraries.find`)                                                                 |
| Amendment 6: `requiredImports` form, `covers` only                                                                                                            | 2                                                                                             |
| Amendment 7: `Main.enso` only                                                                                                                                 | 2                                                                                             |
| Amendment 8: subprocess spec                                                                                                                                  | 4, 5 (`Library_Discovery_Spec`)                                                               |
| Amendment 9: ~20 test files                                                                                                                                   | 4 Step 5, 5 Step 5                                                                            |
