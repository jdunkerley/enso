# Table's file formats as their own libraries

Epic #728. The core keeps only simple file formats; everything else becomes an
extension library. `Standard.Table` still hosts five formats through its
`File_Format_SPI`: Delimited, Excel, Fixed_Width, YXDB and EDI. Delimited stays.
The other four move into their own libraries, as XML did (#521) and as Postgres
and SQLite did before it:

| Library                | Ticket | Enso       | Java        | Third-party jars                  |
| ---------------------- | ------ | ---------- | ----------- | --------------------------------- |
| `Standard.EDI`         | #723   | ~200 lines | ~400 lines  | none (JDK only)                   |
| `Standard.Fixed_Width` | #725   | ~500 lines | ~700 lines  | none                              |
| `Standard.YXDB`        | #726   | ~160 lines | ~120 lines  | `yxdb-java` (26 KB)               |
| `Standard.Excel`       | #724   | ~1.4k      | ~3.9k lines | POI wrapper and its deps (~25 MB) |

Excel is the payoff: about 25 of the 28 MB in Table's `polyglot/java` is POI and
what it pulls in, carried by every project that never opens a workbook. The
other three are small, but each is a niche format with no reason to be in the
core.

## Decisions

- One spec and one plan for all four; one PR per library, in the order **EDI →
  Fixed_Width → YXDB → Excel**. EDI is the smallest and proves the pattern;
  Excel goes last, with the most to move, once the pattern is settled.
- No compatibility shim in Table (Table cannot re-export libraries that depend
  on it). Existing projects keep working through the mechanisms the Postgres /
  SQLite move built:
  - `Data.read` finds a format provider through `Meta.lookup_services`, which
    sees installed but unimported libraries, so `Data.read "x.xlsx"` needs no
    import.
  - The GUI adds the import for a moved type name (`Excel_Workbook`,
    `EDI_Format`, …) when a project opens or a node is committed.
  - The gap is extension methods: for these four, only `Date.from_excel` and
    `Date_Time.from_excel`. Code calling them needs
    `from Standard.Excel import all`. Each library's CLAUDE.md says so under
    "Things to avoid in generated code", as `Standard.XML`'s does for
    `table.to_xml`.
- The libraries ship in the distribution, as Postgres and SQLite do. The new
  project template does not import them. Install on demand is the library
  system's job, not this one's.
- Each Java project gets its own package, `org.enso.<name>`, so no package is
  split across two jars on the module path. EDI's Java stays Java (it could be
  Enso, but on the JVM a jar costs nothing).
- `YXDB` is named after the file format, like EDI, Excel and XML, not after
  Alteryx.
- Each PR is a visible change (an import becomes necessary): one changelog entry
  each, and each waits for the owner's OK before merging.

## Out of scope

- Spatial (`Spatial_Table`, `Spatial_Column`): shared with Database,
  Visualization and Geo; it needs its own decision about dependency direction.
- New features in any of the four, and upgrading POI (its 5.2.3 pin and the
  shaded wrapper move as they are).
- The other findings of the 2026-11-13 review of Base, Table and Database: HTTP
  and Email stay in Base; the Postgres-family dialect base stays in Database;
  Enso Cloud needs its own design; `Enso_Secret` leaves the `Enso_Cloud`
  namespace (#727); Database's doc examples stop naming dialects (#729).

## The shared pattern

For a library `Standard.<Name>`:

- `distribution/lib/Standard/<Name>/0.0.0-dev/`
  - `package.yaml`: `name`, `namespace: Standard`, `version: 0.0.0-dev`,
    `license: Apache-2.0`, `public-types:` listing the moved public types, and a
    `services:` entry providing
    `Standard.Base.System.File_Format.File_Format_SPI` with the format type (as
    `Standard.XML` does).
  - `src/Main.enso` exporting the public types (and, for Excel, the extension
    methods).
  - `docs/api/` pages moved from Table's.
  - `CLAUDE.md` in the style of `Standard.XML`'s: entry points, common usage,
    layout, things to avoid in generated code.
- `std-bits/<name>/`, sbt project `std-<name>`: the format's Java under
  `org.enso.<name>`, depending on `std-base` and `std-table` as `provided`; its
  third-party jars go to the library's own `polyglot/java`. Its JUnit tests move
  with it.
- Wiring:
  - `build.sbt`: the project, `makeStdLibDistribution("<Name>", …)`, and
    whatever aggregate or test-task lists the existing libraries appear in.
  - `distribution/edition.template.yaml`.
  - `tools/ci/stdlib-test-map.yaml`, so CI runs the new test project when the
    library or its Java changes.
  - `ImportStandardLibrariesBenchmark`.
  - `distribution/lib/Standard/CLAUDE.md`, `std-bits/CLAUDE.md`,
    `test/CLAUDE.md`, Table's CLAUDE.md.
  - The docs-site Components reference is generated from the catalogues and
    picks the library up; check the generated page exists.
- `test/<Name>_Tests/`: the format's specs and data, moved out of `Table_Tests`.
- Table loses the format's `File_Format_SPI.new` line in
  `Internal/Table_Services.enso`, its exports in `Main.enso`, its error types in
  `Errors.enso`, its Java and the Maven dependencies only it used.

Verification for each PR: the new test project and `Table_Tests` pass; the JUnit
tests pass in the new project; `Data.read` of the format's file in a project
that imports only `Standard.Base` and `Standard.Table` returns the same result
as before (the service lookup); and the library appears in a built distribution
with its jars, on Windows and in WSL.

## The four libraries

### 1. `Standard.EDI` (#723)

- `src/IO/EDI_Format.enso` (`EDI_Format`, `EDI_Definition`) →
  `src/EDI_Format.enso`.
- `data/EDI_822.json` → the new library's `data/`; `EDI_Definition.EDI_822`
  loads it through `enso_project.data`, which then resolves to `Standard.EDI`.
- `EDIReader.java` and `EDIReaderTests.java` → `std-edi`, package
  `org.enso.edi`.
- New `test/EDI_Tests` (Table has none for EDI today): read a small hand-made
  `.edi` and `.822` file; `Raw_Segments`; a `From_Json` custom definition;
  `map_fields=False`; segment-terminator auto-detection; the format chosen by
  extension through `Data.read`.

### 2. `Standard.Fixed_Width` (#725)

- `src/Fixed_Width/*` and `src/Internal/Fixed_Width_Reader.enso`.
- From Table's `Errors.enso`: `Invalid_Fixed_Width_Row`,
  `Inconsistent_Fixed_Width_Lengths`, `Fixed_Width_Line_Too_Long`.
- Java → `org.enso.fixed_width`: `FixedWidthReader`,
  `FixedWidthReaderProblemAggregator`, `FixedWidthDecodingProblemAggregator`,
  `FixedWidthLineTooLongException`, `FixedWidthReadFailedException`, and the
  problems `InvalidFixedWidthRow`, `InconsistentFixedWidthLengths` (now in
  `table/parsing/problems`). Nothing else uses them.
- `Data_Formatter`, value parsing and the shared row-problem helpers stay in
  Table; the new library imports them.
- `test/Table_Tests/data/fixed-width/` and the Fixed_Width specs →
  `test/Fixed_Width_Tests`. Base's `Line_Ending_Style` docs mention the format:
  keep the mention, name the library.

### 3. `Standard.YXDB` (#726)

- `src/YXDB_Format.enso`, `YXDBReader.java` → `org.enso.yxdb`, and the
  `yxdb-java` dependency moves from `std-table` to `std-yxdb`.
- It keeps calling Base's `Data_Link_Helpers.as_file`, so local `.datalink`
  files that point at a `.yxdb` keep working.
- `test/Table_Tests/data/yxdb/` and `YXDB_Spec` → `test/YXDB_Tests`.

### 4. `Standard.Excel` (#724)

Enso:

- `src/Excel/*` (`Excel_Workbook`, `Excel_Format`, `Excel_Range`,
  `Excel_File_Format`), `src/Internal/Excel_Writer`, `Excel_Reader`,
  `Excel_Section`, `Excel_Test_Helper`, and `src/Extensions/Excel_Extensions`
  (`Date.from_excel`, `Date_Time.from_excel`).
- From Table's `Errors.enso`, the error types only Excel uses: `Empty_Sheet`,
  `Existing_Data`, `Range_Exceeded`. `Invalid_Location` stays: Google Sheets
  uses it.
- Table's `Main.enso` loses four exports: `Excel_Format`, `Excel_Range`,
  `Excel_Workbook`, `from_excel`. Writing needs no change in Table: it already
  goes through Base's `File_Format.write_table` SPI.

Java (→ `org.enso.excel`):

- `org.enso.table.excel.**` (including `xssfreader` and the connection pool),
  `read/ExcelReader`, `write/ExcelWriter`, and `write/ExistingDataMode` (only
  `ExcelWriter` uses it). They use Table's public Java (`Table`, `Column`,
  storages, builders, `ProblemAggregator`, `NameDeduplicator`, the `error`
  exceptions), which `std-excel` gets from `std-table` as `provided`.
- `ExcelUtils.fromExcelDateTime` is split out first into
  `org.enso.table.util.SerialDates`, which stays in Table: Google Sheets'
  `GoogleSheetsForEnso` uses the same serial-date conversion and switches to it,
  so `Standard.Google` does not come to depend on Excel. `Excel_Extensions`
  calls it from its new home.
- The POI wrapper (`poi-wrapper` assembly via `unmanagedJars`), `poi-ooxml`,
  `xmlbeans`, `log4j-api`, `log4j-to-slf4j` and what they pull in move to
  `std-excel`, with the POI 5.2.3 pin and its note in
  `project/Dependencies.scala`. Check which of the commons jars (`commons-io`,
  `commons-compress`, `commons-collections4`, `commons-codec`) anything left in
  Table still needs; `commons-math3` and `univocity` stay. Record Table's
  `polyglot/java` size before and after in the PR.

Tests and other users:

- `test/Table_Tests/src/IO/Excel_Spec.enso` (1.6k lines) and the `.xls`,
  `.xlsx`, `.xlsb` files in `test/Table_Tests/data/` → `test/Excel_Tests`.
- Specs that use Excel incidentally: `Formats_Spec`, `Data_Link_Formats_Spec`,
  `Cloud_Spec`, `Delimited_Read_Spec` (Table_Tests), `File_Format_Widgets_Spec`
  (Visualization_Tests), `Fetch_Spec` (Cloud_Tests), `S3_Spec` (AWS_Tests),
  `Examples_Spec` (Examples_Tests). Each either adds `Standard.Excel` to its
  project and imports it, or, where Excel was only a convenient example, uses a
  format still in the core. The plan decides per spec.
- `app/electron-client/src/ai/prompts.ts`: add the import where a prompt reads a
  workbook. The GUI `formatForPath` test changes only if a dotted name changes.
- `Standard.Examples` keeps its `xlsx` sample: it returns a `File`, so it does
  not depend on Excel.
- `Excel_Test_Helper` uses Base's `ReloadDetector`; that stays in Base.

## Risks

- A test project the plan misses keeps compiling against Table's Excel types and
  fails only in its own CI job. Grep the whole of `test/` and
  `distribution/lib/` for each moved name before each PR.
- The service lookup must find the format with only `Standard.Table` imported;
  the verification step above checks it explicitly rather than trusting the test
  projects, which import the new library.
- Moving POI's jars changes which jars resolve for `std-table`; delete
  `target/**/update_cache_*` before trusting a build (root CLAUDE.md).
