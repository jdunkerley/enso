# Table's File Formats as Their Own Libraries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** EDI, Fixed_Width, YXDB and Excel leave `Standard.Table` and become
`Standard.EDI`, `Standard.Fixed_Width`, `Standard.YXDB` and `Standard.Excel`.

**Architecture:** Each format already reaches the rest of the system only
through Table's `File_Format_SPI` registration (`Internal/Table_Services.enso`)
and `Main.enso` exports. Each new library registers its own `File_Format_SPI`
service in `package.yaml`, owns its Java in a new `std-<name>` sbt project under
`org.enso.<name>`, and owns its tests in `test/<Name>_Tests`. `Standard.XML`
(#521) is the worked example to copy from.

**Tech Stack:** Enso standard library, Java 24 via sbt (frgaal), JUnit 4, Enso
`Standard.Test`.

**Spec:** `docs/superpowers/specs/2026-11-13-table-format-libraries-design.md`
(epic #728). Read it first.

## Global Constraints

- Order and PRs: Task 1 EDI (#723) → Task 2 Fixed_Width (#725) → Task 3 YXDB
  (#726) → Task 4 serial dates (prep for #724) → Task 5 Excel (#724). One branch
  and one PR per task, each from fresh `develop`, each leaving `develop` green.
- No compatibility shim in Table. Table must not import or re-export any new
  library.
- Java package for each library: `org.enso.edi`, `org.enso.fixed_width`,
  `org.enso.yxdb`, `org.enso.excel`. No class of a new library stays in an
  `org.enso.table.*` package.
- New Java projects depend on `std-base` and `std-table` as `provided`.
- Library `package.yaml`: `namespace: Standard`, `version: 0.0.0-dev`,
  `license: Apache-2.0`, `public-types:`, and `services:` providing
  `Standard.Base.System.File_Format.File_Format_SPI`.
- Test projects: `namespace: enso_dev`, `version: 0.0.1`,
  `enso-version: default`, `license: MIT`, `author: jdunkerley`,
  `maintainer: jdunkerley`.
- Tasks 1, 2, 3, 5 are visible changes: one `CHANGELOG.md` entry each under
  `# Next Release` → `#### Enso Standard Library`, in the form
  `- [Description][NNN]` with a link definition, NNN = the PR number. The PR
  waits for the owner's OK before merging. Task 4 is invisible: label
  `CI: No changelog needed`, merges on green.
- POI is not upgraded; its 5.2.3 pin and note move unchanged.
- Spatial is untouched.

### Wiring checklist (every new library — Tasks 1, 2, 3, 5)

For library `<Name>`, sbt project `std-<name>`, directory `std-bits/<name>`.
Copy the Postgres or XML entry next to each site and rename.

1. `build.sbt`
   - A polyglot root next to `postgres-polyglot-root` (~line 4438):
     ``val `<name>-polyglot-root` = stdLibComponentRoot("<Name>") / "polyglot" / "java"``
   - ``lazy val `std-<name>` ``: copy `std-postgres` (~line 5341); change the
     `.in(file("std-bits") / "<name>")`, the jar name `std-<name>.jar`, the
     polyglot root, and `libraryDependencies` (polyglot `provided` plus the
     library's own; add `junit` and `junit-interface` `% Test` when it has JUnit
     tests). Keep `SPIHelpers.ensureSPIConsistency`. End with
     ``.dependsOn(`std-base` % "provided").dependsOn(`std-table` % "provided")``.
   - ``makeStdLibDistribution("<Name>", Distribution.sbtProjects(`std-<name>`))``
     in the distributions list (~lines 120–160).
   - The root aggregate list (~lines 500–540, next to `std-postgres`).
   - ``.dependsOn(`std-<name>` / Compile / packageBin)`` in the `runtime` list
     (~line 2719) and ``(`std-<name>` / Compile / packageBin).value`` in
     `std-benchmarks` (~line 3947).
   - Only when the library ships third-party jars (YXDB, Excel): add `"<Name>"`
     to the `GatherLicenses.verifyPackageAt` list (~line 290).
2. `distribution/edition.template.yaml`: an entry `- name: Standard.<Name>`,
   `repository: release`, `version: {{LIBS_VERSION}}` after `Standard.XML`.
3. `tools/ci/stdlib-test-map.yaml`: under `libraries`,
   `<Name>: { stdBits: [<name>], dependsOn: [Base, Table] }` (exactly the
   libraries its sources import); under `testProjects`, `<Name>_Tests` with its
   `imports` and `testImports`; remove the library from projects that no longer
   import it and add it to those that now do. Run
   `node tools/ci/check-workflows.mjs`: it fails with what to change until the
   map matches.
4. `engine/runtime-benchmarks/src/main/java/org/enso/compiler/benchmarks/module/ImportStandardLibrariesBenchmark.java`:
   add `from Standard.<Name> import all` to `IMPORTS`.
5. Docs: `distribution/lib/Standard/CLAUDE.md` (library list),
   `std-bits/CLAUDE.md` (project list), `test/CLAUDE.md` (test project list),
   Table's `CLAUDE.md` (drop the format), a new
   `distribution/lib/Standard/<Name>/0.0.0-dev/CLAUDE.md` modelled on
   `distribution/lib/Standard/XML/0.0.0-dev/CLAUDE.md` (what it is, Main entry
   points, Common usage, Layout, Things to avoid in generated code — including
   "moved out of `Standard.Table`: `from Standard.<Name> import all` is needed",
   Where to read more), and a one-paragraph `std-bits/<name>/CLAUDE.md` (what
   the jar holds, its dependencies).
6. Docs site: `corepack pnpm --filter docs-site run generate` and check the
   Components reference now has a page for `Standard.<Name>` and Table's no
   longer lists the format.
7. Legal review (only with third-party jars): see Tasks 3 and 5.

### Verification commands (used by every task)

```bash
# Build (Windows, or WSL with ~/.enso-toolchain.sh sourced)
sbt "std-<name>/test; buildEngineDistribution"

# Run an Enso test project (root CLAUDE.md: "Running an Enso test project by hand")
cd test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode \
  -da:com.oracle.graal.python.runtime.ExecutionContext" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/<Name>_Tests"
```

A filtered run that matches nothing still exits 0: compare the number of tests
that ran with the number written.

**Service-lookup check** (every task). A scratch file outside the tracked tree,
e.g. `scratchpad/<task>/lookup.enso`, importing only Base and Table:

```enso
from Standard.Base import all
from Standard.Table import all

main =
    t = Data.read (File.new "<absolute path to a sample file of the format>")
    IO.println t.to_text
```

Run it with `bin/enso --run <path>/lookup.enso` before the move (record the
output) and after (it must print the same).

---

### Task 1: `Standard.EDI` (#723)

**Files:**

- Create in `distribution/lib/Standard/EDI/0.0.0-dev/`: `package.yaml`,
  `src/Main.enso`, `src/EDI_Format.enso` (moved), `data/EDI_822.json` (moved),
  `docs/api/EDI_Format.md` (moved), `CLAUDE.md`
- Create: `std-bits/edi/src/main/java/org/enso/edi/EDIReader.java` (moved),
  `std-bits/edi/src/test/java/org/enso/edi/EDIReaderTests.java` (moved),
  `std-bits/edi/CLAUDE.md`
- Create: `test/EDI_Tests/package.yaml`, `src/Main.enso`, `src/EDI_Spec.enso`,
  `data/sample.822`, `data/sample.edi`, `data/custom.json`
- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Table_Services.enso`
  (remove the EDI import and `edi`), and the wiring-checklist files
- Delete: `Table/0.0.0-dev/src/IO/EDI_Format.enso`,
  `Table/0.0.0-dev/data/EDI_822.json` (and `data/` if then empty),
  `Table/0.0.0-dev/docs/api/IO/EDI_Format.md`,
  `std-bits/table/src/main/java/org/enso/table/read/EDIReader.java`,
  `std-bits/table/src/test/java/org/enso/table/read/EDIReaderTests.java`

**Interfaces:**

- Produces: `Standard.EDI.EDI_Format.EDI_Format` (constructor
  `EDI segment_end:Text="" definition:EDI_Definition=..EDI_822 map_fields:Boolean=True`),
  `Standard.EDI.EDI_Format.EDI_Definition` (`Raw_Segments`, `EDI_822`,
  `From_Json path`, `Custom structure field_map`), and Java
  `org.enso.edi.EDIReader` (`parseSegments`, `parse`, `EDIStructure`). The API
  is unchanged; only the module path and Java package change.

- [ ] **Step 1: Branch.**
      `git switch develop && git pull --ff-only && git switch -c wip/edi-library`

- [ ] **Step 2: Write characterization tests against today's Table.** Create
      `test/EDI_Tests` (package.yaml per Global Constraints, `name: EDI_Tests`)
      with `src/Main.enso`:

  ```enso
  from Standard.Base import all

  from Standard.Test import all

  import project.EDI_Spec

  main filter=Nothing =
      suite = Test.build suite_builder->
          EDI_Spec.add_specs suite_builder
      suite.run_with_filter filter
  ```

  `data/sample.822`: a minimal 822 interchange on one line, `~` segment
  terminator, `*` element separator (the ISA segment is fixed width):

  ```
  ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260101*1200*^*00704*000000001*0*P*>~GS*AA*SENDER*RECEIVER*20260101*1200*1*X*007040~ST*822*0001~BDE*00*REF1*20260101~SE*3*0001~GE*1*1~IEA*1*000000001~
  ```

  `data/sample.edi`: the same bytes (tests the `.edi` extension).
  `data/custom.json`:

  ```json
  {
    "structure": "[ISA,GS,ST,BDE,SE,GE,IEA]",
    "field_map": { "BDE": ["Purpose", "Reference", "Date"] }
  }
  ```

  `src/EDI_Spec.enso` (imports `Standard.Table` for now; Step 6 switches it):

  ```enso
  from Standard.Base import all

  from Standard.Table import all

  from Standard.Test import all

  add_specs suite_builder =
      sample = enso_project.data / "sample.822"
      suite_builder.group "EDI" group_builder->
          group_builder.specify "is chosen by extension for .822 and .edi" <|
              t1 = Data.read sample
              t2 = Data.read (enso_project.data / "sample.edi")
              t1.should_be_a Table
              t1.row_count . should_equal t2.row_count
              t1.column_names . should_equal t2.column_names

          group_builder.specify "reads raw segments" <|
              t = Data.read sample (EDI_Format.EDI definition=..Raw_Segments)
              t.column_names . should_equal ["Segment", "Elements"]
              t.at "Segment" . to_vector . should_equal ["ISA", "GS", "ST", "BDE", "SE", "GE", "IEA"]

          group_builder.specify "detects the segment terminator" <|
              auto = Data.read sample (EDI_Format.EDI definition=..Raw_Segments)
              explicit = Data.read sample (EDI_Format.EDI segment_end="~" definition=..Raw_Segments)
              auto.row_count . should_equal explicit.row_count

          group_builder.specify "maps 822 field names by default, not with map_fields=False" <|
              mapped = Data.read sample
              raw = Data.read sample (EDI_Format.EDI map_fields=False)
              mapped.column_names . should_not_equal raw.column_names

          group_builder.specify "reads with a custom definition from JSON" <|
              t = Data.read sample (EDI_Format.EDI definition=(..From_Json (enso_project.data / "custom.json")))
              t.should_be_a Table
              t.column_names.any (_.contains "Purpose") . should_be_true
  ```

- [ ] **Step 3: Run them against today's code.** `sbt buildEngineDistribution`,
      then run `EDI_Tests`. Expected: 5 tests, all PASS. If an expectation is
      wrong for the real reader (for example the column naming in the custom
      test), change the _expectation_ to what the reader does today — these
      tests pin current behaviour — and say so in the PR. Run the service-lookup
      check on `test/EDI_Tests/data/sample.822` and record the output.

- [ ] **Step 4: Commit.**
      `git add test/EDI_Tests && git commit -m "EDI_Tests: pin EDI reading before the move (#723)"`

- [ ] **Step 5: Move the code.**
  - `git mv` the Enso, data, docs and Java files to the paths under **Files**.
  - Java: `package org.enso.table.read;` → `package org.enso.edi;` in both
    files.
  - `EDI_Format.enso`: `polyglot java import org.enso.edi.EDIReader`;
    `import project.Table.Table` → `from Standard.Table import Table`; in
    `as_custom`, `Project_Description.new Standard.Table.Main` →
    `Project_Description.new Standard.EDI.Main`.
  - `src/Main.enso`:

    ```enso
    export project.EDI_Format.EDI_Definition
    export project.EDI_Format.EDI_Format
    ```

  - `package.yaml`:

    ```yaml
    name: EDI
    namespace: Standard
    version: 0.0.0-dev
    license: Apache-2.0
    public-types: [EDI_Format, EDI_Definition]

    services:
      - provides: Standard.Base.System.File_Format.File_Format_SPI
        with: Standard.EDI.EDI_Format.EDI_Format
    ```

  - `Table_Services.enso`: delete `import project.IO.EDI_Format.EDI_Format` and
    the `edi = …` line; the sum becomes `excel+delim+fixed+yxdb`.
  - Apply the wiring checklist (no legal review: JDK only).
  - `grep -rn "EDI_Format\|EDI_Definition\|EDIReader" distribution std-bits test app engine --include=*.enso --include=*.java --include=*.ts --include=*.scala`
    shows only the new locations.

- [ ] **Step 6: Point the tests at the new library.** In `EDI_Spec.enso`,
      replace `from Standard.Table import all` with
      `from Standard.Table import Table` and add `from Standard.EDI import all`.

- [ ] **Step 7: Verify.**
      `sbt "std-edi/test; std-table/test; buildEngineDistribution"`: JUnit PASS.
      `EDI_Tests`: 5 PASS. `Table_Tests`: PASS. The service-lookup check prints
      the same as in Step 3. `std-edi.jar` is in
      `built-distribution/enso-engine-*/enso-*/lib/Standard/EDI/*/polyglot/java`.
      Repeat the `EDI_Tests` run in WSL. `node tools/ci/check-workflows.mjs`
      PASS.

- [ ] **Step 8: Changelog and commit.** Entry:
      ``- [EDI files are read by the new Standard.EDI library; add `from Standard.EDI import all` to use `EDI_Format` by name.][NNN]``.
      Commit: `Standard.EDI: EDI moves out of Standard.Table (#723)`.

- [ ] **Step 9: PR.** Push; `gh pr create` with `Closes #723` and the
      before/after service-lookup output; fill NNN in the changelog and push.
      Wait for CI green and the owner's OK.

---

### Task 2: `Standard.Fixed_Width` (#725)

**Files:**

- Create in `distribution/lib/Standard/Fixed_Width/0.0.0-dev/`: `package.yaml`,
  `CLAUDE.md`, `src/Main.enso`, `src/Errors.enso`
- Move: everything in `Table/0.0.0-dev/src/Fixed_Width/`
  (`Fixed_Width_Format.enso`, `Invalid_Fixed_Width_Rows.enso`, …) →
  `Fixed_Width/0.0.0-dev/src/`;
  `Table/0.0.0-dev/src/Internal/Fixed_Width_Reader.enso` →
  `Fixed_Width/0.0.0-dev/src/Internal/Fixed_Width_Reader.enso`; their `docs/api`
  pages.
- Cut from Table's `src/Errors.enso` into the new `src/Errors.enso`:
  `Invalid_Fixed_Width_Row`, `Inconsistent_Fixed_Width_Lengths` (~lines 249–290
  today) and `Fixed_Width_Line_Too_Long` (~lines 1174–1200).
- Move Java → `std-bits/fixed-width/src/main/java/org/enso/fixed_width/`:
  `FixedWidthReader`, `FixedWidthReaderProblemAggregator`,
  `FixedWidthDecodingProblemAggregator`, `FixedWidthLineTooLongException`,
  `FixedWidthReadFailedException` (from `org/enso/table/read/`),
  `InvalidFixedWidthRow`, `InconsistentFixedWidthLengths` (from
  `org/enso/table/parsing/problems/`), and any JUnit test of them.
- Move tests: `test/Table_Tests/src/IO/Fixed_Width_Read_Spec.enso` →
  `test/Fixed_Width_Tests/src/Fixed_Width_Read_Spec.enso`;
  `test/Table_Tests/data/fixed-width/` →
  `test/Fixed_Width_Tests/data/fixed-width/`.
- Modify: Table's `src/Main.enso`, `src/Internal/Table_Services.enso`,
  `src/Errors.enso`; `test/Table_Tests/src/IO/Main.enso`; the doc comment in
  Base's `Line_Ending_Style` that mentions the format (name the library); the
  wiring-checklist files.

**Interfaces:**

- Consumes from Table, now imported across libraries: whatever the moved files
  import from `project.*` that is not in the move list (`Data_Formatter`,
  `Table`, header and row-problem helpers shared with Delimited). Each becomes
  `import Standard.Table.<same path>`. If one of them is `private` in Table,
  stop and report — do not make it public without asking.
- Produces: `Standard.Fixed_Width.Fixed_Width_Format.Fixed_Width_Format`,
  `Standard.Fixed_Width.Invalid_Fixed_Width_Rows.Invalid_Fixed_Width_Rows`, the
  three error types, and Java `org.enso.fixed_width.FixedWidthReader`.

- [ ] **Step 1: Branch** `wip/fixed-width-library` from fresh `develop`.

- [ ] **Step 2: Baseline.** Build; run `Table_Tests` with filter `"Fixed_Width"`
      and record how many tests ran (must be more than 0). Check
      `Fixed_Width_Format.for_read`: if it returns a format for some extension,
      run the service-lookup check on a matching file; if it returns `Nothing`
      for every file (Fixed_Width is only ever chosen explicitly), record
      instead the output of
      `Data.read <test/Table_Tests/data/fixed-width/fixed.txt> (Fixed_Width_Format.<constructor as used in Fixed_Width_Read_Spec>)`.

- [ ] **Step 3: Move.** `git mv` per **Files**. Java packages →
      `org.enso.fixed_width`; update every `polyglot java import` in the moved
      Enso. Move the three error types with their `polyglot java import`s
      re-pointed. The new `Main.enso` exports `Fixed_Width_Format`,
      `Invalid_Fixed_Width_Rows` and the three error types, mirroring exactly
      what Table's `Main.enso` exported for them; remove those exports from
      Table. `package.yaml`:

  ```yaml
  name: Fixed_Width
  namespace: Standard
  version: 0.0.0-dev
  license: Apache-2.0
  public-types: [Fixed_Width_Format, Invalid_Fixed_Width_Rows]

  services:
    - provides: Standard.Base.System.File_Format.File_Format_SPI
      with: Standard.Fixed_Width.Fixed_Width_Format.Fixed_Width_Format
  ```

  `Table_Services.enso`: drop the import and `fixed`; the sum becomes
  `excel+delim+yxdb`. Apply the wiring checklist (sbt project `std-fixed-width`,
  directory `std-bits/fixed-width`, library `Fixed_Width`; no legal review).
  Create `test/Fixed_Width_Tests` (`Main.enso` as in Task 1 Step 2, importing
  `project.Fixed_Width_Read_Spec`); add `from Standard.Fixed_Width import all`
  to the moved spec and fix its `enso_project.data` paths; remove it from
  `test/Table_Tests/src/IO/Main.enso`.

- [ ] **Step 4: Grep.**
      `grep -rn "Fixed_Width\|FixedWidth\|InvalidFixedWidthRow\|InconsistentFixedWidthLengths" distribution std-bits test app engine --include=*.enso --include=*.java --include=*.ts`
      shows only the new locations and prose you have updated.

- [ ] **Step 5: Verify.**
      `sbt "std-fixed-width/test; std-table/test; buildEngineDistribution"`.
      `Fixed_Width_Tests` runs as many tests as Step 2's filter, all PASS;
      `Table_Tests` PASS; Step 2's check prints the same (with
      `from Standard.Fixed_Width import all` added if the format was explicit);
      `Fixed_Width_Tests` in WSL; `check-workflows.mjs` PASS.

- [ ] **Step 6: Changelog, commit, PR** as Task 1 Steps 8–9, with `Closes #725`,
      entry
      ``- [Fixed-width text files are read by the new Standard.Fixed_Width library; add `from Standard.Fixed_Width import all` to use `Fixed_Width_Format`.][NNN]``
      and commit
      `Standard.Fixed_Width: fixed-width reading moves out of Standard.Table (#725)`.

---

### Task 3: `Standard.YXDB` (#726)

**Files:**

- Create in `distribution/lib/Standard/YXDB/0.0.0-dev/`: `package.yaml`,
  `CLAUDE.md`, `src/Main.enso`
- Move: `Table/0.0.0-dev/src/YXDB_Format.enso` →
  `YXDB/0.0.0-dev/src/YXDB_Format.enso` and its `docs/api` page;
  `std-bits/table/src/main/java/org/enso/table/read/YXDBReader.java` →
  `std-bits/yxdb/src/main/java/org/enso/yxdb/YXDBReader.java`;
  `test/Table_Tests/src/IO/YXDB_Spec.enso` →
  `test/YXDB_Tests/src/YXDB_Spec.enso`; `test/Table_Tests/data/yxdb/` →
  `test/YXDB_Tests/data/yxdb/`.
- Modify: `build.sbt` (`"uk.co.jdunkerley" % "yxdb-java" % "0.1.4"` moves from
  `std-table` to `std-yxdb`), Table's `src/Main.enso` and
  `src/Internal/Table_Services.enso`, `test/Table_Tests/src/IO/Main.enso`, and
  the wiring-checklist files.
- Legal review:
  `git mv tools/legal-review/Table/uk.co.jdunkerley.yxdb-java-0.1.4 tools/legal-review/YXDB/`;
  create `tools/legal-review/YXDB/reviewed-licenses/` with yxdb-java's licence
  entry copied from `tools/legal-review/Table/reviewed-licenses/`.
  `report-state` is generated, never written by hand.

**Interfaces:**

- Produces: `Standard.YXDB.YXDB_Format.YXDB_Format` and Java
  `org.enso.yxdb.YXDBReader`. It keeps calling
  `Standard.Base.Enso_Cloud.Data_Link_Helpers.as_file`.

- [ ] **Step 1: Branch and baseline.** `wip/yxdb-library` from fresh `develop`.
      Build; run `Table_Tests` with filter `"YXDB"` and record the count; run
      the service-lookup check on
      `test/Table_Tests/data/yxdb/AllNormalFields.yxdb`.

- [ ] **Step 2: Move** per **Files**. Java package `org.enso.yxdb`; update the
      `polyglot java import`; imports of Table's own modules become
      `from Standard.Table import …`. `Main.enso`:
      `export project.YXDB_Format.YXDB_Format`. `package.yaml`:

  ```yaml
  name: YXDB
  namespace: Standard
  version: 0.0.0-dev
  license: Apache-2.0
  public-types: [YXDB_Format]

  services:
    - provides: Standard.Base.System.File_Format.File_Format_SPI
      with: Standard.YXDB.YXDB_Format.YXDB_Format
  ```

  Remove Table's export and the `yxdb` registration (the sum becomes
  `excel+delim`). Apply the wiring checklist, including the `GatherLicenses`
  list. Create `test/YXDB_Tests` (`Main.enso` as in Task 1 Step 2, importing
  `project.YXDB_Spec`); add `from Standard.YXDB import all` to the spec.

- [ ] **Step 3: Licences.** In WSL (the verify step is skipped on Windows),
      `sbt gatherLicenses`; follow `tools/legal-review/CLAUDE.md` until Table
      and YXDB both report `No fatal errors`; then `sbt verifyLicensePackages`
      PASS. Commit the regenerated `distribution/**/THIRD-PARTY` and both
      `report-state` files.

- [ ] **Step 4: Verify** as Task 2 Step 5 with `std-yxdb` and `YXDB_Tests`,
      plus: `yxdb-java-0.1.4.jar` is in `lib/Standard/YXDB/*/polyglot/java` and
      no longer in Table's.

- [ ] **Step 5: Changelog, commit, PR** (`Closes #726`), entry
      ``- [Alteryx `.yxdb` files are read by the new Standard.YXDB library; add `from Standard.YXDB import all` to use `YXDB_Format` by name.][NNN]``,
      commit `Standard.YXDB: YXDB reading moves out of Standard.Table (#726)`.

---

### Task 4: Serial-date conversion becomes Table's own (prep for #724)

Google Sheets must not come to depend on Excel. Today
`std-bits/google/src/main/java/org/enso/google/GoogleSheetsForEnso.java` has
`import static org.enso.table.excel.ExcelUtils.fromExcelDateTime;`.

**Files:**

- Create: `std-bits/table/src/main/java/org/enso/table/util/SerialDates.java`
- Create:
  `std-bits/table/src/test/java/org/enso/table/util/SerialDatesTest.java`
- Modify: `std-bits/table/src/main/java/org/enso/table/excel/ExcelUtils.java`,
  `std-bits/google/src/main/java/org/enso/google/GoogleSheetsForEnso.java`

**Interfaces:**

- Produces:
  `org.enso.table.util.SerialDates.fromSerialDateTime(<same parameter type as ExcelUtils.fromExcelDateTime>)`,
  returning the same type, with exactly today's body (1900 dates, the 1900
  leap-year bug, fractional days). Private helpers and constants it uses move
  with it.

- [ ] **Step 1: Branch** `wip/serial-dates` from fresh `develop`.

- [ ] **Step 2: Failing test.** `SerialDatesTest` (JUnit 4): for each `x` in
      `{1, 59, 61, 45000, 45000.5, 0.25}`,
      `assertEquals(ExcelUtils.fromExcelDateTime(x), SerialDates.fromSerialDateTime(x))`.
      Run `sbt "std-table/testOnly org.enso.table.util.SerialDatesTest"`: FAIL
      (class missing).

- [ ] **Step 3: Implement.** Move the body and its helpers into
      `SerialDates.fromSerialDateTime`; `ExcelUtils.fromExcelDateTime` becomes a
      one-line delegation. Switch `GoogleSheetsForEnso` to
      `import static org.enso.table.util.SerialDates.fromSerialDateTime;` and
      its three call sites. `Excel_Extensions.enso` keeps calling `ExcelUtils`
      (it moves with Excel in Task 5).

- [ ] **Step 4: Verify.** `sbt "std-table/test; std-google/compile"` PASS;
      `grep -rn "ExcelUtils" std-bits/google` prints nothing.

- [ ] **Step 5: Commit and PR**
      `Table: serial-date conversion moves out of ExcelUtils (#724)`, label
      `CI: No changelog needed`, body says it prepares #724. Merge on green.

---

### Task 5: `Standard.Excel` (#724)

Start only after Task 4 is merged.

**Files:**

- Create in `distribution/lib/Standard/Excel/0.0.0-dev/`: `package.yaml`,
  `CLAUDE.md`, `src/Main.enso`, `src/Errors.enso`
- Move Enso from `Table/0.0.0-dev/src/` to `Excel/0.0.0-dev/src/`:
  `Excel/Excel_Workbook.enso`, `Excel/Excel_Format.enso`,
  `Excel/Excel_Range.enso`, `Excel/Excel_File_Format.enso` → top level;
  `Internal/Excel_Writer.enso`, `Internal/Excel_Reader.enso`,
  `Internal/Excel_Section.enso`, `Internal/Excel_Test_Helper.enso` →
  `Internal/`; `Extensions/Excel_Extensions.enso` → `Extensions/`; their
  `docs/api` pages.
- Cut from Table's `src/Errors.enso` into Excel's `src/Errors.enso`:
  `Empty_Sheet`, `Existing_Data`, `Range_Exceeded`, with their Java exception
  imports. `Invalid_Location` stays in Table (Google uses it).
- Move Java → `std-bits/excel/src/main/java/org/enso/excel/`: all of
  `org/enso/table/excel/` (sub-packages become `org.enso.excel.xssfreader`,
  `org.enso.excel.internal`), `read/ExcelReader.java`, `write/ExcelWriter.java`,
  `write/ExistingDataMode.java`, and the `org/enso/table/error/` exceptions only
  Excel uses (`EmptySheetException`, `ExistingDataException`,
  `RangeExceededException` — grep each first; `InvalidLocationException` stays).
  Their JUnit tests move to `std-bits/excel/src/test/java/…`.
- Move tests: `test/Table_Tests/src/IO/Excel_Spec.enso` →
  `test/Excel_Tests/src/Excel_Spec.enso`; from `test/Table_Tests/data/`:
  `MixedExcel.xlsx`, `OlderDates.xlsx`, `OlderDates1904.xlsx`,
  `RangeTests.xlsx`, `Sales_Sample_Data.xlsx`, `TestSheet.xlsb`,
  `TestSheet.xlsx`, `TestSheetOld.xls`, `WorkbookWithEmptyLastRow.xlsx`,
  `empty-sheets.xlsx`, `empty_last_column.xlsx` → `test/Excel_Tests/data/`. Grep
  each name in `test/` first: a file another Table_Tests spec still reads is
  copied, not moved.
- Modify: `build.sbt`, `project/Dependencies.scala` (the POI note now names
  `std-excel`), Table's `src/Main.enso` and `src/Internal/Table_Services.enso`,
  Table's `CLAUDE.md` (it also wrongly claims Parquet — fix that line), the
  specs in Step 6, `app/electron-client/src/ai/prompts.ts`,
  `ImportStandardLibrariesBenchmark.java` (its `"Excel_Format.read"` symbol
  stays; it resolves through the new `IMPORTS` line), the wiring files, and
  `tools/legal-review/{Table,Excel}`.

**Interfaces:**

- Consumes: Task 4's `org.enso.table.util.SerialDates`; Table's public Java
  (`org.enso.table.data.table.Table`, `Column`, `data.column.storage.*`,
  `data.column.builder.*`, `problems.ProblemAggregator`,
  `util.NameDeduplicator`, `util.FunctionWithException`,
  `util.ConsumerWithException`, `util.ColumnMapper`,
  `error.InvalidLocationException`, `error.ColumnNameMismatchException`,
  `error.ColumnCountMismatchException`); Base's
  `org.enso.base.cache.ReloadDetector`.
- Produces: `Standard.Excel.Excel_Format.Excel_Format`,
  `Standard.Excel.Excel_Workbook.Excel_Workbook`,
  `Standard.Excel.Excel_Range.Excel_Range`, the extension methods
  `Date.from_excel` and `Date_Time.from_excel`, the errors `Empty_Sheet`,
  `Existing_Data`, `Range_Exceeded`, and Java `org.enso.excel.*`.

- [ ] **Step 1: Branch and baseline.** `wip/excel-library` from fresh `develop`.
      Build; record `du -sh` and the jar list of Table's `polyglot/java`; run
      `Table_Tests` with filter `"Excel"` and record the count; run every spec
      listed in Step 6 and record pass/fail; run the service-lookup check on
      `test/Table_Tests/data/TestSheet.xlsx`.

- [ ] **Step 2: Java project.** Create `std-excel` per the wiring checklist
      with:

  ```scala
  libraryDependencies ++= Seq(
    "org.graalvm.polyglot"     % "polyglot"        % graalMavenPackagesVersion % "provided",
    "org.apache.poi"           % "poi-ooxml"       % poiOoxmlVersion,
    "org.apache.xmlbeans"      % "xmlbeans"        % xmlbeansVersion,
    "org.apache.logging.log4j" % "log4j"           % "2.24.3",
    "org.apache.logging.log4j" % "log4j-to-slf4j"  % "2.24.3", // org.apache.poi uses log4j
    "junit"                    % "junit"           % junitVersion   % Test,
    "com.github.sbt"           % "junit-interface" % junitIfVersion % Test
  ),
  Compile / unmanagedJars := Seq(Attributed.blank((`poi-wrapper` / assembly).value)),
  ```

  Its `packageBin` calls `StdBits.copyDependencies` with
  `unmanagedClasspath = (Compile / unmanagedJars).value` and the same
  `ignoreDependenciesByModuleID` POI triple `std-table` has today; it
  ``.dependsOn(`poi-wrapper`)``. From `std-table` remove the four
  POI/xmlbeans/log4j dependency lines, the `unmanagedJars` setting, the
  `ignoreDependenciesByModuleID` block and ``.dependsOn(`poi-wrapper`)``. Add
  `"Excel"` to the `GatherLicenses` list.

- [ ] **Step 3: Move the Java.** `git mv` per **Files**; packages
      `org.enso.table.excel…` → `org.enso.excel…`; `ExcelReader`, `ExcelWriter`,
      `ExistingDataMode` → `org.enso.excel`; fix imports.
      `sbt "std-table/compile; std-excel/test; std-google/compile"` PASS.
      `sbt "show std-table/Compile/dependencyClasspath"` lists no `poi`,
      `xmlbeans` or `log4j` jar.

- [ ] **Step 4: Move the Enso.** `git mv` per **Files**. In every moved file:
      `polyglot java import org.enso.table.excel.X` → `org.enso.excel.X` (and
      the read/write classes); `import project.X` for modules still in Table →
      `import Standard.Table.X` (stop and report if one is private);
      `project.Excel.Excel_Format` → `project.Excel_Format`, and so on.
      `Main.enso`:

  ```enso
  export project.Errors.Empty_Sheet
  export project.Errors.Existing_Data
  export project.Errors.Range_Exceeded
  export project.Excel_Format.Excel_Format
  export project.Excel_Range.Excel_Range
  export project.Excel_Workbook.Excel_Workbook
  export project.Extensions.Excel_Extensions.from_excel
  ```

  Export the three errors only if Table's `Main.enso` exported them; otherwise
  keep whatever shape Table gave them. `package.yaml`:

  ```yaml
  name: Excel
  namespace: Standard
  version: 0.0.0-dev
  license: Apache-2.0
  public-types: [Excel_Format, Excel_Workbook, Excel_Range]

  services:
    - provides: Standard.Base.System.File_Format.File_Format_SPI
      with: Standard.Excel.Excel_Format.Excel_Format
  ```

  Table: delete the four `Main.enso` exports (`Excel_Format`, `Excel_Range`,
  `Excel_Workbook`, `from_excel`) and the Excel import and `excel` line in
  `Table_Services.enso` (the format list becomes just `delim`).

- [ ] **Step 5: Grep.**
      `grep -rn "Excel_\|org.enso.table.excel\|ExcelReader\|ExcelWriter\|ExistingDataMode" distribution/lib std-bits engine app/gui/src app/electron-client/src --include=*.enso --include=*.java --include=*.ts --include=*.vue`
      shows only `Standard.Excel`, `std-bits/excel`, the benchmark, the prompts
      and tests.

- [ ] **Step 6: Tests.** Create `test/Excel_Tests` (`Main.enso` as in Task 1
      Step 2, importing `project.Excel_Spec`); move the spec and data; add
      `from Standard.Excel import all` to it and fix data paths. Add
      `from Standard.Excel import all` to each spec below (always the import,
      never a rewrite to another format — fewer behavioural changes):
  - `test/Table_Tests/src/IO/Formats_Spec.enso`
  - `test/Table_Tests/src/IO/Data_Link_Formats_Spec.enso`
  - `test/Table_Tests/src/IO/Cloud_Spec.enso`
  - `test/Table_Tests/src/IO/Delimited_Read_Spec.enso`
  - `test/Visualization_Tests/src/Widgets/File_Format_Widgets_Spec.enso`
  - `test/Cloud_Tests/src/Network/Fetch_Spec.enso`
  - `test/AWS_Tests/src/S3_Spec.enso`
  - `test/Examples_Tests/src/Examples_Spec.enso`

  A spec reading a moved data file through Table_Tests' `enso_project.data` uses
  a copied file or the new project's path. Update the test map's `imports` for
  every touched project. Remove `Excel_Spec` from
  `test/Table_Tests/src/IO/Main.enso`.

- [ ] **Step 7: App.** In `app/electron-client/src/ai/prompts.ts`, where it
      tells the model about Excel (the `Excel/` subdirectory, the `Excel_Format`
      `row_limit` hint), point at `Standard/Excel/0.0.0-dev/src/` and say Excel
      needs `from Standard.Excel import all`. Run the GUI `formatForPath` test
      (`corepack pnpm --filter enso-gui exec vitest run formatForPath`): PASS;
      change it only if it asserts a `Standard.Table` Excel path.

- [ ] **Step 8: Licences.** In WSL, `sbt gatherLicenses`. For each package it
      reports Table no longer resolves (expected: `curvesapi`, `SparseBitSet`,
      `commons-codec`, `commons-collections4`, `commons-compress`, `log4j-api`,
      `log4j-to-slf4j`, `poi`, `poi-ooxml`, `poi-ooxml-lite`, `xmlbeans`, and
      `commons-io` only if nothing left in Table pulls it),
      `git mv tools/legal-review/Table/<dir> tools/legal-review/Excel/`. A
      package both still resolve is copied. Copy the needed `reviewed-licenses`
      entries. Re-run until both report `No fatal errors`;
      `sbt verifyLicensePackages` PASS. Commit the THIRD-PARTY files and the
      `report-state`s.

- [ ] **Step 9: Verify.** Delete `target/**/update_cache_*` first (root
      CLAUDE.md).
      `sbt "std-table/test; std-excel/test; std-google/test; buildEngineDistribution"`.
      `Excel_Tests`: same count as Step 1, all PASS. `Table_Tests`,
      `Visualization_Tests`, `Examples_Tests`: PASS (the Cloud and AWS specs run
      in CI). The service-lookup check prints what Step 1 recorded. Record
      Table's `polyglot/java` size and jar list after; Excel's holds the POI
      wrapper. In WSL, `Excel_Tests` and `Table_Tests`.
      `sbt "javafmtCheckAll; scalafmtSbtCheck"` PASS.
      `node tools/ci/check-workflows.mjs` PASS.

- [ ] **Step 10: Changelog, commit, PR.** Entry:
      ``- [Excel workbooks are read and written by the new Standard.Excel library, and Standard.Table is about 25 MB smaller; add `from Standard.Excel import all` to use `Excel_Workbook`, `Excel_Format` or `Date.from_excel`.][NNN]``.
      Commit `Standard.Excel: Excel moves out of Standard.Table (#724)`. PR
      body: `Closes #724`, `Closes #728` (the last of the epic), Table's jar
      size and list before and after. Wait for green and the owner's OK.

---

## After the epic

- Sweep #728: tick all four and close it.
- Update the memory note `table-format-libraries`, and the wiki's
  Distribution-Licenses page if the legal-review steps taught anything new.
