# Date_Time: picker and function pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Date_Time` argument, list item or whole node gets a picker
(`Date_Time.now`, a calendar, a time field) that writes
`Date_Time.new y m d h mi` and keeps the rest of an existing value; and every
`Date_Time` function has typed arguments, correct return types and working
widgets.

**Architecture:** The picker copies the Date and Time_Of_Day pickers: a widget
on `WidgetPicker/PickerShell.vue` (`WidgetDateTime.vue`, priority 53), a menu
(`WidgetDateTime/DateTimeMenu.vue`) and a framework-free mapping
(`WidgetDateTime/dateTimeExpression.ts`). To reuse the two menus' parts rather
than copy them, the calendar moves out of `DateMenu.vue` into
`WidgetDate/DateCalendar.vue`, and the time field out of `TimeOfDayMenu.vue`
into `WidgetTimeOfDay/TimeField.vue`; both menus' existing tests must pass
unchanged after the move. The mapping reads `Date_Time.new`'s arguments from the
AST, so a kept argument (`second=45`, `zone=(Time_Zone.parse "…")`) is carried
over verbatim. The function pass is the Date pilot's Tasks 1–3 for
`Date_Time.enso`, with two selectors and the regenerated API snapshot.

**Tech Stack:** Vue 3, TypeScript, Reka UI (`Calendar`, `TimeField`), Vitest,
Playwright; Enso (standard library), sbt (engine distribution, in WSL).

**Spec:**
`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`
(part D). Precedents: `docs/superpowers/specs/2026-11-15-date-widget-design.md`
(the pickers) and `docs/superpowers/plans/2026-11-15-date-docs-pilot.md` (Tasks
1–3, the function pass).

**Base:** builds on `develop` alone. The spec lists part A and part C as
dependencies; neither is needed to build this:

- `zone` and `second` are reached through part A's `…` menu
  (`docs/superpowers/plans/2026-11-16-argument-access.md`). This plan does not
  change or need that menu: the picker only has to keep a `second=`/`zone=` that
  is already written, which the tests seed directly. Until A merges, a user
  types them, or focuses the node to see every argument (today's behaviour).
- The time field is reused from `TimeOfDayMenu.vue` as it is on `develop` (Task
  5 extracts it). Part C changes `timeExpression.ts` and `WidgetTimeOfDay.vue`,
  not the menu, so the two merge without conflict in either order.

## Global Constraints

- `WidgetDateTime` has priority 53 (after `WidgetTimeOfDay`'s 52) and scores
  `Perfect` for a `Date_Time`-typed argument or item (`reprType` or
  `expectedType` is `Standard.Base.Data.Time.Date_Time.Date_Time`), or a whole
  node that is `Date_Time.now` or `Date_Time.new …` (any arguments); `Mismatch`
  where `WidgetSelection` already draws a dropdown (`hasDropdown`), and for
  anything else.
- The ▾ menu, in order: `Date_Time.now`, a divider, the calendar (the Date
  menu's), a divider, the time field (the Time_Of_Day menu's), hours and minutes
  only (no "Add seconds": the picker writes no second).
- A day or a time picked writes
  `Date_Time.new <year> <month> <day> <hour> <minute>` (all five positional, so
  each is a port), parenthesised where it becomes an argument
  (`parenthesisedApplication`), bare at a node root and as a vector item.
- Editing an existing `Date_Time.new …` keeps every argument after the minute as
  it was written: `second` and the finer parts, positional or named, and `zone=`
  (or a positional zone). The picker never writes a zone.
- `Date_Time.now` replaces the whole value.
- A day picked keeps the time (the field's, edited or not); a time written keeps
  the date (the value's, or today's for `now`/unset).
- A new item of a `Vector Date_Time` starts as `Date_Time.now`.
- Function pass: every argument typed and every return correct, inline form;
  `first_of_month`/`end_of_month` declared with what they return (see Task 2);
  `week_of_year`'s `locale` typed with `@locale Locale.default_widget`;
  `start_of`/`end_of` typed `Date_Period | Time_Period` with one selector
  listing both kinds; `at_time_zone`/`set_time_zone` typed `zone`; `+`/`-` with
  both kinds plus `Period.new` and `Duration.new`. The comparators' `that` stays
  untyped (#797). Docs are not rewritten to the house style here.
- Running an Enso test project by hand: the working directory is the project's
  parent, and a filter that matches nothing still exits 0 (root `CLAUDE.md`):
  compare test counts.
- Repo rules: `corepack pnpm`; stage explicit paths only; never `git stash`,
  `git add -A`/`.`, `--no-verify`. Commits end with a blank line, then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `CHANGELOG.md` entries under `#### Enso IDE` (the picker) and
  `#### Enso Standard Library` (the function pass).
- Merge only after the owner's OK on an installer.

## File map

| File (GUI paths under `app/gui/src/project-view/components/GraphEditor/widgets/`) | Responsibility                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`    | appendix "Date_Time — before" (and "after")           |
| `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date_Time.enso`           | signatures, widgets, `make_date_time_period_selector` |
| `test/Base_Tests/src/Data/Time/Date_Time_Spec.enso`                               | a `Date_Time signatures` group                        |
| `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Date_Time.md`        | the regenerated API snapshot                          |
| `WidgetDate/DateCalendar.vue`                                                     | the month calendar, moved out of `DateMenu.vue`       |
| `WidgetDate/DateMenu.vue`                                                         | uses `DateCalendar`                                   |
| `WidgetDate/dateExpression.ts`                                                    | exports `isValidDate`                                 |
| `WidgetTimeOfDay/TimeField.vue`                                                   | the time field, moved out of `TimeOfDayMenu.vue`      |
| `WidgetTimeOfDay/TimeOfDayMenu.vue`                                               | uses `TimeField`                                      |
| `WidgetDateTime/dateTimeExpression.ts`                                            | the expression <-> choice mapping, kept arguments     |
| `WidgetDateTime/DateTimeMenu.vue`                                                 | `Date_Time.now`, calendar, time field                 |
| `WidgetDateTime.vue`                                                              | the widget: scoring, the edit                         |
| `WidgetVector/elementType.ts`                                                     | `Date_Time.now` as a new item's default               |
| `…/__tests__/*.test.ts` beside each                                               | unit tests                                            |
| `CLAUDE.md` (the widgets folder)                                                  | a `WidgetDateTime.vue` entry; the moved parts         |
| `app/gui/integration-test/project-view/widgets.spec.ts`                           | Playwright: `Date_Time widget` block                  |
| `CHANGELOG.md`                                                                    | entries                                               |

Build and run helpers (WSL, sourcing `~/.enso-toolchain.sh` first; a clone on
the Linux filesystem is much faster than `/mnt/c`):

- Engine distribution: `sbt buildEngineDistribution`.
- The Date_Time tests, from the repo root:

```bash
cd test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode \
  -da:com.oracle.graal.python.runtime.ExecutionContext" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso \
  --no-ir-caches --run "$PWD/Base_Tests" "Date_Time"
```

Note the number of tests run before Task 2 and compare after.

GUI commands run from `app/gui`: `corepack pnpm exec vitest run <path>`,
`corepack pnpm run typecheck`, `corepack pnpm exec eslint <paths>`. In a fresh
worktree run `corepack pnpm install` then `corepack pnpm -r compile` first.

---

### Task 1: The "before" assessment, from the code

**Files:**

- Modify: the spec's appendix, `### Date_Time — before`

As part C's Task 1: each widget follows from the catalogue's type (the API
snapshot, `docs/api/Data/Time/Date_Time.md`, where a separate signature line
leaves `Standard.Base.Any.Any`), the `@` annotation, and the IDE's rules
(`widgets/CLAUDE.md`). A union has no tag values, so no dropdown.

- [ ] **Step 1: Check each row against the code** (`Date_Time.enso` and its
      snapshot); correct any the code contradicts. As read on 2026-11-16:

```markdown
Taken on: <date>, commit <hash> (develop), from the code: `Date_Time.enso`, its
API snapshot and the IDE's widget rules (not in the running IDE).

| Function                                                                                        | Argument                            | Type (declared)                                  | Expected widget                                         | Widget from the code       | Result  | Note                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| now                                                                                             | —                                   | —                                                | —                                                       | —                          | n/a     |                                                                                                                    |
| new                                                                                             | year · month · day · hour · minute  | Integer                                          | number (month 1–12, day picker, hour 0–23, minute 0–59) | number (annotations)       | works   | Return `Any` (separate signature line).                                                                            |
| new                                                                                             | second · millisecond · microsecond  | Integer                                          | number, shown when modified                             | number                     | works   | Hidden until set.                                                                                                  |
| new                                                                                             | nanosecond                          | (untyped `nanosecond = 0`)                       | number                                                  | number (annotation)        | works   | Catalogue type `Any`.                                                                                              |
| new                                                                                             | zone                                | Time_Zone                                        | zone dropdown                                           | `Time_Zone.default_widget` | works   |                                                                                                                    |
| parse                                                                                           | text · format                       | Text · Date_Time_Formatter                       | text · format dropdown                                  | text · format dropdown     | works   | Return `Any`.                                                                                                      |
| from_unix_epoch_seconds · from_unix_epoch_milliseconds                                          | seconds, nanoseconds · milliseconds | Integer                                          | number                                                  | number                     | works   | Return `Any`.                                                                                                      |
| year … nanosecond, zone, date, time_of_day                                                      | —                                   | —                                                | —                                                       | —                          | n/a     | Getters, typed.                                                                                                    |
| to_unix_epoch_* · to_enso_epoch_*                                                               | —                                   | —                                                | —                                                       | —                          | n/a     | Return `Any`.                                                                                                      |
| week_of_year                                                                                    | locale                              | Locale \| Nothing (untyped)                      | locale dropdown                                         | text box                   | missing | Date uses `@locale Locale.default_widget`.                                                                         |
| is_leap_year · length_of_year · century · quarter · length_of_month · day_of_year · day_of_week | —                                   | —                                                | —                                                       | —                          | n/a     | Return `Any`.                                                                                                      |
| first_of_month · end_of_month                                                                   | —                                   | —                                                | —                                                       | —                          | n/a     | Declared `Integer`; return a `Date` (`Time_Utils` takes a `LocalDate`; `Date_Part_Spec` compares with `Date.new`). |
| start_of · end_of                                                                               | period                              | Date_Period \| Time_Period (untyped)             | both kinds' dropdown                                    | text box                   | missing |                                                                                                                    |
| at_time_zone · set_time_zone                                                                    | zone                                | Time_Zone (untyped)                              | zone dropdown                                           | zone dropdown (`@zone`)    | works   | Catalogue type `Any`.                                                                                              |
| to_utc                                                                                          | —                                   | —                                                | —                                                       | —                          | n/a     |                                                                                                                    |
| date_part                                                                                       | period                              | Date_Period \| Time_Period                       | both kinds' dropdown                                    | text box                   | missing | A union has no tag values.                                                                                         |
| date_diff                                                                                       | end                                 | Date_Time                                        | date-time picker                                        | text box                   | missing | Needs the new picker.                                                                                              |
| date_diff · date_add                                                                            | period                              | Date_Period \| Time_Period                       | both kinds' dropdown                                    | text box                   | missing |                                                                                                                    |
| date_add                                                                                        | amount                              | Integer                                          | number                                                  | number                     | works   |                                                                                                                    |
| + · -                                                                                           | amount                              | Duration \| Period \| Time_Period \| Date_Period | both kinds, `Period.new`, `Duration.new`                | text box                   | missing |                                                                                                                    |
| add_work_days                                                                                   | days · holidays                     | Integer · Vector Date (untyped)                  | number · list of date pickers                           | number · text box          | missing | Untyped, so no element type.                                                                                       |
| format                                                                                          | format                              | Date_Time_Formatter                              | format dropdown                                         | format dropdown            | works   | Return `Any`.                                                                                                      |
| > · >= · < · <=                                                                                 | that                                | (untyped)                                        | —                                                       | text box                   | n/a     | Stays untyped (#797).                                                                                              |

Hidden (`private: true`): `to_js_object`, `to_display_text`, `pretty`,
`enso_epoch_start`, `Date_Time.from`.
```

(Read each function's `## ---` block for `private: true` before listing it as
user-facing; correct the hidden list from the code.)

- [ ] **Step 2: Record and commit.**

```bash
git add docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md
git commit -m "Date_Time pass: the assessment before the fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Signature fixes

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date_Time.enso`
- Modify: `test/Base_Tests/src/Data/Time/Date_Time_Spec.enso`

**Interfaces:**

- Produces (each replaces a separate signature line plus the definition line;
  bodies and `@` annotations unchanged):

```enso
    new (year:Integer=(Missing_Argument.throw "year")) (month:Integer=1) (day:Integer=1) (hour:Integer=0) (minute:Integer=0) (second:Integer=0) (millisecond:Integer=0) (microsecond:Integer=0) (nanosecond:Integer=0) (zone:Time_Zone=Time_Zone.system) -> Date_Time ! Time_Error =
    parse (text : Text) (format : Date_Time_Formatter = Date_Time_Formatter.default_enso_zoned_date_time) -> Date_Time ! Time_Error =
    from_unix_epoch_seconds (seconds : Integer) (nanoseconds : Integer = 0) -> Date_Time =
    from_unix_epoch_milliseconds (milliseconds : Integer) -> Date_Time =
    to_unix_epoch_seconds self -> Integer =
    to_unix_epoch_milliseconds self -> Integer =
    to_enso_epoch_seconds self -> Integer =
    to_enso_epoch_milliseconds self -> Integer =
    week_of_year self (locale : Locale | Nothing = Nothing) -> Integer =
    is_leap_year self -> Boolean =
    length_of_year self -> Integer =
    century self -> Integer =
    quarter self -> Integer =
    length_of_month self -> Integer =
    first_of_month self -> Date =
    end_of_month self -> Date =
    day_of_year self -> Integer =
    day_of_week self -> Day_Of_Week =
    start_of self (period : Date_Period | Time_Period = Date_Period.Month) -> Date_Time =
    end_of self (period : Date_Period | Time_Period = Date_Period.Month) -> Date_Time =
    at_time_zone self (zone : Time_Zone) -> Date_Time =
    set_time_zone self (zone : Time_Zone) -> Date_Time =
    to_utc self -> Date_Time =
    date_part self (period : Date_Period | Time_Period) -> Integer =
    date_diff self (end : Date_Time) (period : Date_Period | Time_Period) -> Integer = ensure_in_epoch self <|
    date_add self (amount : Integer) (period : Date_Period | Time_Period) -> Date_Time = ensure_in_epoch self <|
    + self (amount : Duration | Period | Time_Period | Date_Period) -> Date_Time ! Time_Error =
    add_work_days self (days : Integer = 1) (holidays : Vector Date = []) -> Date_Time =
    - self (amount : Duration | Period | Time_Period | Date_Period) -> Date_Time ! Time_Error =
    format self (format : Date_Time_Formatter) -> Text =
    to_display_text self -> Text =
    pretty self -> Text =
    to_js_object self -> JS_Object =
```

`start_of`/`end_of` keep `Date_Period.Month` as the default: their `period` is a
union, and `..Month` resolves only against a single type (Standard library
`CLAUDE.md`, "Autoscope"). The comparators are left as they are.

**`first_of_month`/`end_of_month`:** the spec says they "return a `Date_Time`",
but they return a `Date` today (`Time_Utils.first_of_month` takes and returns a
`LocalDate`; `Date_Part_Spec`, which runs for `Date_Time` too, checks
`… . first_of_month . should_equal <| Date.new 1987 1 1`). This plan declares
what they return, `-> Date`, and changes no behaviour. Returning a `Date_Time`
(the first instant of the month in the value's zone) would be a behaviour change
that breaks `Date_Part_Spec`; ask the owner before doing that instead.

- [ ] **Step 1: Write the tests.** In `Date_Time_Spec.enso`'s `add_specs`, after
      the `Date_Time equality` group, add:

```enso
    suite_builder.group "Date_Time signatures" group_builder->
        group_builder.specify "first_of_month and end_of_month are Dates" <|
            dt = Date_Time.new 2020 2 15 10 30
            dt.first_of_month . should_equal (Date.new 2020 2 1)
            dt.end_of_month . should_equal (Date.new 2020 2 29)
            Meta.type_of dt.first_of_month . should_equal_type Date
            Meta.type_of dt.end_of_month . should_equal_type Date

        group_builder.specify "start_of and end_of take either kind of period" <|
            dt = Date_Time.new 2022 9 15 10 30 45
            dt.start_of . should_equal (Date_Time.new 2022 9 1)
            dt.start_of Time_Period.Hour . should_equal (Date_Time.new 2022 9 15 10)
            dt.end_of Date_Period.Day . should_equal (Date_Time.new 2022 9 15 23 59 59 nanosecond=999999999)

        group_builder.specify "+ and - take both kinds of period, a Period and a Duration" <|
            dt = Date_Time.new 2020 1 31 12 0
            (dt + Date_Period.Month) . should_equal (Date_Time.new 2020 2 29 12 0)
            (dt + (Period.new days=1)) . should_equal (Date_Time.new 2020 2 1 12 0)
            (dt - Time_Period.Hour) . should_equal (Date_Time.new 2020 1 31 11 0)
            (dt - (Duration.new minutes=30)) . should_equal (Date_Time.new 2020 1 31 11 30)

        group_builder.specify "methods reject arguments of the wrong type" <|
            dt = Date_Time.new 2020 1 1 12 0
            Test.expect_panic_with (dt.at_time_zone 5) Type_Error
            Test.expect_panic_with (dt.set_time_zone 5) Type_Error
            Test.expect_panic_with (dt.week_of_year 5) Type_Error
            Test.expect_panic_with (dt.start_of 5) Type_Error
            Test.expect_panic_with (dt.end_of "Month") Type_Error
            Test.expect_panic_with (dt.add_work_days "a") Type_Error
            Test.expect_panic_with (dt.add_work_days 1 holidays=5) Type_Error
            Test.expect_panic_with (Date_Time.new 2020 nanosecond="a") Type_Error
```

`Type_Error` and `Meta` are available (`Standard.Base.Errors.Common.Type_Error`
is imported; `Meta` comes with `from Standard.Base import all` — if not, add
`import Standard.Base.Meta`).

- [ ] **Step 2: Run them before the change** (build, then the Date_Time tests).
      Expected: the first three pass; several `expect_panic_with` of the last
      fail. Record which, for the PR, and the test count.

- [ ] **Step 3: Fix the signatures** to the **Interfaces** list. Add
      `@locale Locale.default_widget` above `week_of_year` (as `Date.enso` line
      283 has). Keep `@zone Time_Zone.default_widget` on `new`, `at_time_zone`,
      `set_time_zone`.

- [ ] **Step 4: Rebuild and run** the Date_Time tests, then the whole `Time`
      suite (`--run "$PWD/Base_Tests" "Time"`), comparing counts with develop.
      Expected: all pass; the count is develop's plus the new tests (×1: the
      group is not run per backend).

- [ ] **Step 5: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date_Time.enso test/Base_Tests/src/Data/Time/Date_Time_Spec.enso
git commit -m "Date_Time: type every argument and correct the return types

first_of_month and end_of_month were declared Integer and return a Date;
they are now declared Date.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Widget fixes, the snapshot, the "after" table

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date_Time.enso`
- Modify: `test/Base_Tests/src/Data/Time/Date_Time_Spec.enso`
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Date_Time.md`
- Modify: the spec's appendix

**Interfaces:**

- Produces (module level, before `Date_Time.from`):

```enso
## ---
   private: true
   ---
   The choices for a period of a Date_Time: each `Date_Period`, then each
   `Time_Period`, by their whole names (the arguments take either type, so an
   auto-scoped name would not resolve). With `include_custom`, also
   `Period.new` and `Duration.new`, for an amount added to or taken from it.
make_date_time_period_selector (include_custom:Boolean=False) display:Display=..When_Modified -> Widget =
    date_periods = ["Year", "Quarter", "Month", "Week", "Day"].map name->
        code = "Date_Period." + name
        Option code code
    time_periods = ["Hour", "Minute", "Second", "Millisecond", "Microsecond", "Nanosecond"].map name->
        code = "Time_Period." + name
        Option code code
    custom = if include_custom then [Option "Period.new" "(Period.new)", Option "Duration.new" "(Duration.new)"] else []
    Widget.Single_Choice values=(date_periods + time_periods + custom) display=display
```

`Option` needs `from project.Metadata.Choice import Option` at the top of
`Date_Time.enso` (as `Date.enso` has); `Widget` and `Display` are imported.

- [ ] **Step 1: Write the test** (in the `Date_Time signatures` group), and the
      import
      `from Standard.Base.Data.Time.Date_Time import make_date_time_period_selector`:

```enso
        group_builder.specify "the period selectors list both kinds, and the custom amounts when asked" <|
            periods = ["Date_Period.Year", "Date_Period.Quarter", "Date_Period.Month", "Date_Period.Week", "Date_Period.Day", "Time_Period.Hour", "Time_Period.Minute", "Time_Period.Second", "Time_Period.Millisecond", "Time_Period.Microsecond", "Time_Period.Nanosecond"]
            make_date_time_period_selector.values.map .label . should_equal periods
            amounts = make_date_time_period_selector include_custom=True
            amounts.values.map .label . should_equal (periods + ["Period.new", "Duration.new"])
            amounts.values.last.value . should_equal "(Duration.new)"
```

Run: expected FAIL (no such function).

- [ ] **Step 2: Add the selector and the annotations:**
  - `@period make_date_time_period_selector` above `start_of`, `end_of`,
    `date_part`, `date_diff`, `date_add`.
  - `@amount (make_date_time_period_selector include_custom=True)` above `+` and
    `-`.
  - `add_work_days`' `holidays : Vector Date` needs no annotation: the IDE gives
    a `Vector Date` argument's items the date picker (#800).
  - `date_diff`'s `end : Date_Time` gets the new picker from Tasks 6–8.

- [ ] **Step 3: Rebuild, run the Date_Time tests.** Expected: PASS.

- [ ] **Step 4: Regenerate the snapshot** (WSL, as #800 did for `Date.md`):

```bash
lib=$(echo built-distribution/enso-engine-*/enso-*/lib/Standard/Base/0.0.0-dev)
built-distribution/enso-engine-*/enso-*/bin/enso --docs api --in-project "$lib"
cp "$lib/docs/api/Data/Time/Date_Time.md" distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Date_Time.md
git diff --stat distribution/lib/Standard/Base/0.0.0-dev/docs/api
corepack pnpm --filter build-scripts run stdlib-api-check
```

Expected: only `Date_Time.md` changes, every argument and return of Task 2's
list typed, the comparators still `Any`, and a new
`- make_date_time_period_selector include_custom:Standard.Base.Data.Boolean.Boolean= display:Standard.Base.Metadata.Display= -> Standard.Base.Metadata.Widget`
line; `stdlib-api-check` passes.

- [ ] **Step 5: Check in the IDE** (built distribution): place
      `dt = Date_Time.new 2020 1 15 9 30` and connect `start_of`, `+`,
      `date_diff`, `week_of_year`, `at_time_zone`, `add_work_days`. Each
      dropdown lists what the selector says and every entry evaluates
      (`Date_Period.Week` included); `week_of_year`'s locale and
      `at_time_zone`'s zone work; `holidays` is a list of date pickers. Write
      `#### After` under the appendix's Date_Time table with the rows that
      changed. (`date_diff`'s `end` is checked again in Task 9.)

- [ ] **Step 6: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date_Time.enso test/Base_Tests/src/Data/Time/Date_Time_Spec.enso distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Date_Time.md docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md
git commit -m "Date_Time: a working widget for every argument

- start_of, end_of, date_part, date_diff and date_add offer each Date_Period
  and Time_Period.
- + and - offer both kinds, and Period.new and Duration.new for a custom
  amount.
- week_of_year uses Locale.default_widget.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The calendar becomes `DateCalendar.vue`

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/DateCalendar.vue`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/DateMenu.vue`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/dateExpression.ts`
  (export `isValidDate`)
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/__tests__/DateCalendar.test.ts`

**Interfaces:**

- Produces:

```ts
// DateCalendar.vue
defineProps<{
  /** The day marked as chosen, if any. */
  selected: YearMonthDay | undefined
  /** The day whose month the calendar opens on. */
  shown: YearMonthDay
}>()
defineEmits<{ pick: [day: YearMonthDay] }>() // every day clicked or chosen with Enter, the selected one too
defineExpose({ /** Put the keyboard on the chosen day, else today, else the first focusable day. */ focusDay(): void })

// dateExpression.ts
export function isValidDate(date: YearMonthDay): boolean // unchanged body, now exported
```

- [ ] **Step 1: Write the failing test**

```ts
/** @file The calendar alone: it opens on the shown month, marks the selected day and emits picks. */
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import DateCalendar from "../DateCalendar.vue";

let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

const day = (n: number) =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-reka-calendar-cell-trigger]"),
  ).find(
    (el) =>
      el.textContent?.trim() === String(n) &&
      !el.hasAttribute("data-outside-view"),
  )!;

describe("the calendar", () => {
  test("opens on the shown month and marks the selected day", async () => {
    mounted = mount(DateCalendar, {
      props: {
        selected: { year: 2020, month: 1, day: 15 },
        shown: { year: 2020, month: 1, day: 15 },
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(document.querySelector(".heading")?.textContent).toContain("2020");
    expect(day(15).hasAttribute("data-selected")).toBe(true);
  });

  test("a click emits the day, the selected one included", async () => {
    mounted = mount(DateCalendar, {
      props: {
        selected: { year: 2020, month: 1, day: 15 },
        shown: { year: 2020, month: 1, day: 15 },
      },
      attachTo: document.body,
    });
    await flushPromises();
    day(20).click();
    await flushPromises();
    day(15).click();
    await flushPromises();
    expect(mounted.emitted("pick")).toEqual([
      [{ year: 2020, month: 1, day: 20 }],
      [{ year: 2020, month: 1, day: 15 }],
    ]);
  });

  test("focusDay puts the keyboard on the selected day", async () => {
    mounted = mount(DateCalendar, {
      props: {
        selected: { year: 2020, month: 1, day: 15 },
        shown: { year: 2020, month: 1, day: 15 },
      },
      attachTo: document.body,
    });
    await flushPromises();
    (mounted.vm as unknown as { focusDay(): void }).focusDay();
    expect(document.activeElement).toBe(day(15));
  });
});
```

(If Reka does not re-emit `update:modelValue` for the selected day on click, the
second `pick` is missing: `DateMenu` relies on it today to close on the chosen
day, so read `DateMenu.test.ts`'s "clicking the day that is already chosen"
test, which passes on develop, and match what it shows.)

- [ ] **Step 2: Run, expect FAIL** (module missing):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetDate`

- [ ] **Step 3: Move the calendar.** `DateCalendar.vue` takes, from
      `DateMenu.vue`: the Reka calendar imports, `toCalendarDate`, `minValue`,
      `maxValue`, the `placeholder` ref (initialised from `props.shown`), the
      `CalendarRoot` template block and all the calendar's styles
      (`.calendarHeader` … `.day`). Its `@update:modelValue` handler:

```ts
function pick(value: unknown) {
  if (!(value instanceof CalendarDate)) return;
  emit("pick", { year: value.year, month: value.month, day: value.day });
}
```

`focusDay` is the body of `DateMenu`'s `onMounted` focus code, querying the
calendar's own root element (`useTemplateRef('root')` on `CalendarRoot`,
`.$el`). `DateMenu.vue` keeps the relative choices, the dividers and the frame,
and becomes:

```ts
const calendar = useTemplateRef<InstanceType<typeof DateCalendar>>("calendar");
const shownDay = computed(() =>
  resolveChoice(props.choice ?? { kind: "today" }, today.value),
);
const selectedDay = computed(() =>
  props.choice?.kind === "date" ? props.choice : undefined,
);

/** Choosing the day that is already chosen changes nothing, so it only closes the menu. */
function chooseDay(day: YearMonthDay) {
  const chosen = selectedDay.value;
  if (
    chosen != null &&
    chosen.year === day.year &&
    chosen.month === day.month &&
    chosen.day === day.day
  )
    emit("close");
  else emit("choose", { kind: "date", ...day });
}

onMounted(() => nextTick(() => calendar.value?.focusDay()));
```

```vue
<DateCalendar
  ref="calendar"
  :selected="selectedDay"
  :shown="shownDay"
  @pick="chooseDay"
/>
```

Export `isValidDate` from `dateExpression.ts` (add `export`; Task 6 uses it).

- [ ] **Step 4: Run the new test and `DateMenu.test.ts` unchanged.** Expected:
      all PASS. `DateMenu.test.ts` must not be edited in this task: it is the
      proof that the move changed nothing.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/DateCalendar.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/DateMenu.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/dateExpression.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetDate/__tests__/DateCalendar.test.ts
git commit -m "GUI: the date menu's calendar is a component of its own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The time field becomes `TimeField.vue`

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/TimeField.vue`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/TimeOfDayMenu.vue`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/__tests__/TimeField.test.ts`

**Interfaces:**

- Produces:

```ts
// TimeField.vue
defineProps<{
  /** The time the field starts with. */
  initial: HourMinuteSecond
  /** Whether the seconds segment is shown at first. */
  initialShowSeconds: boolean
  /** Whether "Add seconds"/"Hide seconds" is offered; true by default. */
  secondsToggle?: boolean
}>()
defineEmits<{
  /** Enter was pressed in the field. */
  enter: []
  /** The focus left the field (its segments and its toggle); `next` is where it went. */
  leave: [next: EventTarget | null]
}>()
defineExpose({
  /** The time, if it was edited since the field opened and is complete; seconds are 0 while hidden. */
  editedTime(): HourMinuteSecond | undefined,
  /** The time as it stands, edited or not, if it is complete; seconds are 0 while hidden. */
  currentTime(): HourMinuteSecond | undefined,
  /** Put the keyboard on the hour segment. */
  focus(): void,
})
```

- [ ] **Step 1: Write the failing test**

```ts
/** @file The time field alone: what it reports as edited or current, and its events. */
import userEvent from "@testing-library/user-event";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import TimeField from "../TimeField.vue";

type Exposed = {
  editedTime(): unknown;
  currentTime(): unknown;
  focus(): void;
};
let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

async function mountField(props: Record<string, unknown>) {
  mounted = mount(TimeField, { props, attachTo: document.body });
  await flushPromises();
  const exposed = mounted.vm as unknown as Exposed;
  exposed.focus();
  return { wrapper: mounted, field: exposed };
}
const segments = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="spinbutton"]'));

describe("the time field", () => {
  test("reports no edit until it is changed, and the current time all along", async () => {
    const { field } = await mountField({
      initial: { hour: 14, minute: 30, second: 0 },
      initialShowSeconds: false,
    });
    expect(field.editedTime()).toBeUndefined();
    expect(field.currentTime()).toEqual({ hour: 14, minute: 30, second: 0 });
    await userEvent.keyboard("{ArrowUp}");
    expect(field.editedTime()).toEqual({ hour: 15, minute: 30, second: 0 });
  });

  test("Enter emits enter; leaving emits leave", async () => {
    const { wrapper } = await mountField({
      initial: { hour: 14, minute: 30, second: 0 },
      initialShowSeconds: false,
    });
    await userEvent.keyboard("{Enter}");
    expect(wrapper.emitted("enter")).toHaveLength(1);
    await userEvent.click(document.body);
    expect(wrapper.emitted("leave")).toHaveLength(1);
  });

  test("without the toggle there is no seconds button, and seconds stay hidden", async () => {
    await mountField({
      initial: { hour: 14, minute: 30, second: 15 },
      initialShowSeconds: false,
      secondsToggle: false,
    });
    expect(document.querySelector('[data-action="seconds"]')).toBeNull();
    expect(segments()).toHaveLength(2);
  });

  test("a cleared segment makes it incomplete", async () => {
    const { field } = await mountField({
      initial: { hour: 14, minute: 30, second: 0 },
      initialShowSeconds: false,
    });
    await userEvent.keyboard("{Backspace}{Backspace}");
    expect(field.editedTime()).toBeUndefined();
    expect(field.currentTime()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay`

- [ ] **Step 3: Move the field.** `TimeField.vue` takes from
      `TimeOfDayMenu.vue`: the `TimeFieldRoot`/`TimeFieldInput` imports and
      template (inside a `div.field` with `ref="container"` and
      `@focusout="onFocusOut"`), the seconds button (now
      `v-if="props.secondsToggle !== false"`), `toTime`, `draft`, `showSeconds`
      (initialised from `props.initialShowSeconds`), `granularity`, `dirty`,
      `incomplete`, `edit`, `toggleSeconds`, and the styles `.field` …
      `.secondsToggle`. Its own functions:

```ts
function timeOf(time: Time): HourMinuteSecond {
  return {
    hour: time.hour,
    minute: time.minute,
    second: showSeconds.value ? time.second : 0,
  };
}
function currentTime(): HourMinuteSecond | undefined {
  return incomplete.value || draft.value == null
    ? undefined
    : timeOf(draft.value);
}
function editedTime(): HourMinuteSecond | undefined {
  return dirty.value ? currentTime() : undefined;
}
function focus() {
  container.value?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
}
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget;
  // Moving between segments, or to the seconds button, is not leaving the field.
  if (next instanceof Node && container.value?.contains(next)) return;
  emit("leave", next);
}
defineExpose({ editedTime, currentTime, focus });
```

and `@keydown.enter.prevent="emit('enter')"` on `TimeFieldRoot`.

`TimeOfDayMenu.vue` keeps `chooseNow`, `close`, `settled`, `registerAccept` and
the frame, and becomes:

```ts
const field = useTemplateRef<InstanceType<typeof TimeField>>("field");
const initial: HourMinuteSecond =
  props.choice?.kind === "time" ? props.choice : (props.now ?? localNow());
const initialShowSeconds =
  props.choice?.kind === "time" && props.choice.second !== 0;

/** Write the field's time, once, if it was edited and is complete. */
function commit() {
  const time = field.value?.editedTime();
  if (settled || time == null) return;
  settled = true;
  emit("choose", { kind: "time", ...time });
}

function onLeave(next: EventTarget | null) {
  // Moving to another control of the menu is not leaving it.
  if (
    next instanceof Node &&
    (root.value?.$el as HTMLElement | undefined)?.contains(next)
  )
    return;
  commit();
}

onBeforeUnmount(() => (settled = true));
onMounted(() => {
  props.registerAccept?.(commit);
  void nextTick(() => field.value?.focus());
});
```

```vue
<TimeField
  ref="field"
  :initial="initial"
  :initialShowSeconds="initialShowSeconds"
  @enter="commit"
  @leave="onLeave"
/>
```

- [ ] **Step 4: Run the new test and `TimeOfDayMenu.test.ts` unchanged.**
      Expected: all PASS, without editing `TimeOfDayMenu.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/TimeField.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/TimeOfDayMenu.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/__tests__/TimeField.test.ts
git commit -m "GUI: the time menu's field is a component of its own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Date_Time expression mapping

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/__tests__/dateTimeExpression.test.ts`

**Interfaces:**

- Consumes: `YearMonthDay`, `isValidDate` (`WidgetDate/dateExpression.ts`, Task
  4).
- Produces:

```ts
/** The qualified name of the `Date_Time` type. */
export const DATE_TIME_TYPE = "Standard.Base.Data.Time.Date_Time.Date_Time";

/** A date and a time to the minute: what the picker writes. */
export interface DateTimeParts extends YearMonthDay {
  readonly hour: number;
  readonly minute: number;
}

/** What the value stands for: the current instant, or a specific one. */
export type DateTimeChoice =
  | { readonly kind: "now" }
  | ({ readonly kind: "dateTime" } & DateTimeParts & {
        /** The arguments after the minute, as written (`45`, `second=45`, `zone=Time_Zone.utc`); absent when none. */
        readonly kept?: readonly string[];
      });

export function parseDateTimeExpression(
  code: string | undefined,
): DateTimeChoice | undefined;
export function dateTimeExpressionCode(choice: DateTimeChoice): string;
/** `picked`, with the kept arguments of `current` when both are specific: an edit keeps them. */
export function withKeptArguments(
  picked: DateTimeChoice,
  current: DateTimeChoice | undefined,
): DateTimeChoice;
/** The local date and time of `now`, to the minute. */
export function localDateTimeNow(now?: Date): DateTimeParts;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import {
  dateTimeExpressionCode,
  parseDateTimeExpression,
  withKeptArguments,
  type DateTimeChoice,
} from "../dateTimeExpression";

const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  kept?: string[],
): DateTimeChoice => ({
  kind: "dateTime",
  year,
  month,
  day,
  hour,
  minute,
  ...(kept ? { kept } : {}),
});

describe("parseDateTimeExpression", () => {
  test.each([
    ["Date_Time.now", { kind: "now" }],
    ["Date_Time.new 2020 1 15 9 30", at(2020, 1, 15, 9, 30)],
    ["  Date_Time.new  2020 1 15 9 30 ", at(2020, 1, 15, 9, 30)],
    ["Date_Time.new 2020", at(2020, 1, 1, 0, 0)],
    ["Date_Time.new 2020 2 29", at(2020, 2, 29, 0, 0)],
    ["Date_Time.new 2020 hour=9", at(2020, 1, 1, 9, 0)],
    ["Date_Time.new 2020 1 15 9 30 45", at(2020, 1, 15, 9, 30, ["45"])],
    [
      "Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc",
      at(2020, 1, 15, 9, 30, ["second=45", "zone=Time_Zone.utc"]),
    ],
    [
      'Date_Time.new 2020 1 15 zone=(Time_Zone.parse "Europe/London")',
      at(2020, 1, 15, 0, 0, ['zone=(Time_Zone.parse "Europe/London")']),
    ],
    [
      "Date_Time.new 2020 1 15 9 30 45 500 0 0 Time_Zone.utc",
      at(2020, 1, 15, 9, 30, ["45", "500", "0", "0", "Time_Zone.utc"]),
    ],
  ] satisfies [string, DateTimeChoice][])(
    "%j is a choice",
    (code, expected) => {
      expect(parseDateTimeExpression(code)).toEqual(expected);
    },
  );

  test.each([
    undefined,
    "",
    "Date_Time.new",
    "Date_Time.new y 1 15",
    "Date_Time.new (2000 + 20) 1 15",
    "Date_Time.new 2020 13 1",
    "Date_Time.new 2020 2 30",
    "Date_Time.new 99 1 1",
    "Date_Time.new 2020 1 15 24 0",
    "Date_Time.new 2020 1 15 9 60",
    "Date_Time.new 2020 hour=9 10",
    "Date_Time.new 2020 month=2 month=3",
    "Date_Time.new 2020 1 month=2",
    "Date_Time.new 2020 colour=1",
    "Date_Time.new 2020 1 15 9 30 45 500 0 0 Time_Zone.utc 7",
    "Date_Time.now.hour",
    "Date_Time.now + Period.new",
    "Date.new 2020 1 15",
    "dt1",
  ])("%j is not ours", (code) => {
    expect(parseDateTimeExpression(code)).toBeUndefined();
  });
});

describe("dateTimeExpressionCode", () => {
  test.each([
    [{ kind: "now" }, "Date_Time.now"],
    [at(2020, 1, 15, 9, 30), "Date_Time.new 2020 1 15 9 30"],
    [at(2020, 1, 1, 0, 0), "Date_Time.new 2020 1 1 0 0"],
    [
      at(2020, 1, 15, 9, 30, ["second=45", "zone=Time_Zone.utc"]),
      "Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc",
    ],
    [
      at(2020, 1, 15, 9, 30, ["45", "500"]),
      "Date_Time.new 2020 1 15 9 30 45 500",
    ],
  ] satisfies [DateTimeChoice, string][])("%j writes %s", (choice, code) => {
    expect(dateTimeExpressionCode(choice)).toBe(code);
    expect(parseDateTimeExpression(code)).toEqual(choice);
  });
});

describe("withKeptArguments", () => {
  const current = at(2020, 1, 15, 9, 30, ["second=45", "zone=Time_Zone.utc"]);

  test("an edit keeps the arguments after the minute", () => {
    expect(withKeptArguments(at(2021, 3, 4, 10, 0), current)).toEqual(
      at(2021, 3, 4, 10, 0, ["second=45", "zone=Time_Zone.utc"]),
    );
  });

  test("now replaces the whole value", () => {
    expect(withKeptArguments({ kind: "now" }, current)).toEqual({
      kind: "now",
    });
  });

  test("nothing to keep from now, an unset value, or a value without extras", () => {
    const picked = at(2021, 3, 4, 10, 0);
    expect(withKeptArguments(picked, { kind: "now" })).toEqual(picked);
    expect(withKeptArguments(picked, undefined)).toEqual(picked);
    expect(withKeptArguments(picked, at(2020, 1, 1, 0, 0))).toEqual(picked);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetDateTime`

- [ ] **Step 3: Implement**

```ts
/**
 * @file The date-time widget's expression <-> choice mapping: which code a value holds as a date
 * and time, the code a choice writes, and the arguments an edit keeps. The arguments are read from
 * the AST, so a kept one (`zone=(Time_Zone.parse "Europe/London")`) is carried over verbatim
 * (`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`, part D).
 */
import {
  isValidDate,
  type YearMonthDay,
} from "@/components/GraphEditor/widgets/WidgetDate/dateExpression";
import { Ast } from "@/util/ast";

export const DATE_TIME_TYPE = "Standard.Base.Data.Time.Date_Time.Date_Time";

export interface DateTimeParts extends YearMonthDay {
  readonly hour: number;
  readonly minute: number;
}

export type DateTimeChoice =
  | { readonly kind: "now" }
  | ({ readonly kind: "dateTime" } & DateTimeParts & {
        readonly kept?: readonly string[];
      });

/** The parameters the picker writes, in `Date_Time.new`'s order. */
const PICKED = ["year", "month", "day", "hour", "minute"] as const;
type Picked = (typeof PICKED)[number];
/** The parameters an edit keeps, in `Date_Time.new`'s order after the minute. */
const KEPT = [
  "second",
  "millisecond",
  "microsecond",
  "nanosecond",
  "zone",
] as const;
const INTEGER = /^\d+$/;

/** The arguments of an application chain, first to last, and its callee. */
function callArguments(expr: Ast.Ast): {
  callee: Ast.Ast;
  args: { name: string | undefined; code: string }[];
} {
  const args: { name: string | undefined; code: string }[] = [];
  let node = expr;
  while (node instanceof Ast.App) {
    args.unshift({
      name: node.argumentName?.code(),
      code: node.argument.code(),
    });
    node = node.function;
  }
  return { callee: node, args };
}

/**
 * The choice that the code stands for, or `undefined` when it is not `Date_Time.now` or a
 * `Date_Time.new` whose year (required) and month, day, hour and minute (each optional) are integer
 * literals, positional or named, followed by any of `Date_Time.new`'s other arguments, which are
 * kept as written. A positional argument after a named one, an argument given twice, an unknown
 * name, a computed year … minute, or an impossible date or time is not ours.
 */
export function parseDateTimeExpression(
  code: string | undefined,
): DateTimeChoice | undefined {
  const text = code?.trim();
  if (!text) return undefined;
  if (text === "Date_Time.now") return { kind: "now" };
  const expr = Ast.parseExpression(text);
  if (expr == null) return undefined;
  const { callee, args } = callArguments(expr);
  if (callee.code() !== "Date_Time.new" || args.length === 0) return undefined;
  const parts: Partial<Record<Picked, number>> = {};
  const seen = new Set<string>();
  const kept: string[] = [];
  let named = false;
  let position = 0;
  for (const { name: given, code: argCode } of args) {
    let name: string;
    if (given == null) {
      if (named || position >= PICKED.length + KEPT.length) return undefined;
      name =
        position < PICKED.length
          ? PICKED[position]!
          : KEPT[position - PICKED.length]!;
      position += 1;
    } else {
      named = true;
      name = given;
    }
    if (seen.has(name)) return undefined;
    seen.add(name);
    if ((PICKED as readonly string[]).includes(name)) {
      if (!INTEGER.test(argCode)) return undefined;
      parts[name as Picked] = Number(argCode);
    } else if ((KEPT as readonly string[]).includes(name)) {
      kept.push(given == null ? argCode : `${given}=${argCode}`);
    } else return undefined;
  }
  if (parts.year == null) return undefined;
  const value = {
    year: parts.year,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
  if (!isValidDate(value) || value.hour > 23 || value.minute > 59)
    return undefined;
  return kept.length > 0
    ? { kind: "dateTime", ...value, kept }
    : { kind: "dateTime", ...value };
}

/** The code that a choice writes: year to minute positionally (each a port), then the kept arguments. */
export function dateTimeExpressionCode(choice: DateTimeChoice): string {
  if (choice.kind === "now") return "Date_Time.now";
  const { year, month, day, hour, minute } = choice;
  return [
    `Date_Time.new ${year} ${month} ${day} ${hour} ${minute}`,
    ...(choice.kept ?? []),
  ].join(" ");
}

export function withKeptArguments(
  picked: DateTimeChoice,
  current: DateTimeChoice | undefined,
): DateTimeChoice {
  if (
    picked.kind !== "dateTime" ||
    current?.kind !== "dateTime" ||
    current.kept == null
  )
    return picked;
  return { ...picked, kept: current.kept };
}

export function localDateTimeNow(now: Date = new Date()): DateTimeParts {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}
```

`Ast.App`'s `argumentName` is a `Token | undefined` and `argument` an
`Expression` (`app/ydoc-shared/src/ast/tree.ts`, `class App`). Check that
`Ast.parseExpression('Date_Time.new 2020 hour=9')` gives an `App` whose argument
name is `hour` (the `'Date_Time.new 2020 hour=9'` test does); if the named
argument comes as an `Ast.Assignment` or an `OprApp` with `=` instead, read
`tree.ts`'s `App` construction (`nameSpecification`) and extract the name from
what it builds.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/__tests__/dateTimeExpression.test.ts
git commit -m "GUI: the Date_Time picker's expression mapping, keeping second and zone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The menu

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/DateTimeMenu.vue`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/__tests__/DateTimeMenu.test.ts`

**Interfaces:**

- Consumes: `DateCalendar` (Task 4), `TimeField` (Task 5), Task 6's types and
  `localDateTimeNow`, `PickerMenuFrame`.
- Produces:

```ts
defineProps<{
  choice: DateTimeChoice | undefined;
  /** The date and time `Date_Time.now` and an unset value stand for; the browser's by default. A test sets it. */
  now?: DateTimeParts | undefined;
  /** As `TimeOfDayMenu`'s: the shell calls the handler on a click outside the menu. */
  registerAccept?: ((accept: () => void) => void) | undefined;
}>();
defineEmits<{ choose: [choice: DateTimeChoice]; close: [] }>();
```

The emitted `dateTime` choice has no `kept`; `WidgetDateTime` adds it.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @file The date-time menu: Date_Time.now, a day and a time each write the expected code; a day keeps
 * the time and a time keeps the day.
 */
import userEvent from "@testing-library/user-event";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import DateTimeMenu from "../DateTimeMenu.vue";
import {
  dateTimeExpressionCode,
  type DateTimeChoice,
  type DateTimeParts,
} from "../dateTimeExpression";

const NOW: DateTimeParts = {
  year: 2026,
  month: 11,
  day: 15,
  hour: 9,
  minute: 5,
};
const JAN_15: DateTimeChoice = {
  kind: "dateTime",
  year: 2020,
  month: 1,
  day: 15,
  hour: 14,
  minute: 30,
};

let mounted: VueWrapper | undefined;
afterEach(() => mounted?.unmount());

async function mountMenu(
  choice: DateTimeChoice | undefined,
  registerAccept?: (accept: () => void) => void,
) {
  mounted?.unmount();
  // The calendar marks "today" by the system clock when it renders (as in DateMenu.test.ts).
  vi.useFakeTimers({
    toFake: ["Date"],
    now: new Date(NOW.year, NOW.month - 1, NOW.day, 12),
  });
  try {
    mounted = mount(DateTimeMenu, {
      props: { choice, now: NOW, registerAccept },
      attachTo: document.body,
    });
    await flushPromises();
  } finally {
    vi.useRealTimers();
  }
  return mounted;
}

function chosenCodes(wrapper: VueWrapper): string[] {
  return (wrapper.emitted<[DateTimeChoice]>("choose") ?? []).map(([choice]) =>
    dateTimeExpressionCode(choice),
  );
}
const day = (n: number) =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-reka-calendar-cell-trigger]"),
  ).find(
    (el) =>
      el.textContent?.trim() === String(n) &&
      !el.hasAttribute("data-outside-view"),
  )!;
const segments = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="spinbutton"]'));

describe("the date-time menu", () => {
  test("lists Date_Time.now, then the calendar, then hours and minutes", async () => {
    const wrapper = await mountMenu(undefined);
    expect(wrapper.findAll(".item").map((item) => item.text())).toEqual([
      "Date_Time.now",
    ]);
    expect(wrapper.find("[data-reka-calendar-cell-trigger]").exists()).toBe(
      true,
    );
    expect(segments()).toHaveLength(2);
    expect(document.querySelector('[data-action="seconds"]')).toBeNull();
  });

  test("Date_Time.now writes Date_Time.now", async () => {
    const wrapper = await mountMenu(JAN_15);
    await wrapper.get('[data-choice="now"]').trigger("click");
    expect(chosenCodes(wrapper)).toEqual(["Date_Time.now"]);
  });

  test("a day is written at the value's time", async () => {
    const wrapper = await mountMenu(JAN_15);
    day(20).click();
    await flushPromises();
    expect(chosenCodes(wrapper)).toEqual(["Date_Time.new 2020 1 20 14 30"]);
  });

  test("on an unset value, a day is written at the current time", async () => {
    const wrapper = await mountMenu(undefined);
    day(20).click();
    await flushPromises();
    expect(chosenCodes(wrapper)).toEqual(["Date_Time.new 2026 11 20 9 5"]);
  });

  test("an edited time is written on the value's day", async () => {
    const wrapper = await mountMenu(JAN_15);
    segments()[0]!.focus();
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(chosenCodes(wrapper)).toEqual(["Date_Time.new 2020 1 15 15 30"]);
  });

  test("a day picked after a time edit takes the edited time", async () => {
    const wrapper = await mountMenu(JAN_15);
    segments()[0]!.focus();
    await userEvent.keyboard("{ArrowUp}");
    day(20).click();
    await flushPromises();
    expect(chosenCodes(wrapper)).toEqual(["Date_Time.new 2020 1 20 15 30"]);
  });

  test("the chosen day without a time edit only closes", async () => {
    const wrapper = await mountMenu(JAN_15);
    day(15).click();
    await flushPromises();
    expect(wrapper.emitted("choose")).toBeUndefined();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("Escape closes without writing, even after an edit", async () => {
    const wrapper = await mountMenu(JAN_15);
    segments()[0]!.focus();
    await userEvent.keyboard("{ArrowUp}{Escape}");
    expect(wrapper.emitted("close")).toHaveLength(1);
    await userEvent.click(document.body);
    expect(wrapper.emitted("choose")).toBeUndefined();
  });

  test("the accept hook writes an edited time, once", async () => {
    let accept: (() => void) | undefined;
    const wrapper = await mountMenu(JAN_15, (handler) => (accept = handler));
    segments()[0]!.focus();
    await userEvent.keyboard("{ArrowUp}");
    accept!();
    accept!();
    expect(chosenCodes(wrapper)).toEqual(["Date_Time.new 2020 1 15 15 30"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement `DateTimeMenu.vue`**

```vue
<script setup lang="ts">
/**
 * @file The date-time widget's menu: `Date_Time.now`, the calendar (the date menu's) and the time
 * field (the time-of-day menu's, hours and minutes). A day is written at the field's time, and a
 * time on the value's day (today's for `now` or an unset value). Like the time-of-day menu, an
 * edited time is written by Enter, by leaving the menu, or by a click outside it (the shell calls
 * the handler given to `registerAccept`); Escape closes without it. It writes nothing itself:
 * `WidgetDateTime.vue` does that.
 */
import DateCalendar from "@/components/GraphEditor/widgets/WidgetDate/DateCalendar.vue";
import type { YearMonthDay } from "@/components/GraphEditor/widgets/WidgetDate/dateExpression";
import PickerMenuFrame from "@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue";
import TimeField from "@/components/GraphEditor/widgets/WidgetTimeOfDay/TimeField.vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  useTemplateRef,
} from "vue";
import {
  localDateTimeNow,
  type DateTimeChoice,
  type DateTimeParts,
} from "./dateTimeExpression";

const props = defineProps<{
  choice: DateTimeChoice | undefined;
  now?: DateTimeParts | undefined;
  registerAccept?: ((accept: () => void) => void) | undefined;
}>();
const emit = defineEmits<{ choose: [choice: DateTimeChoice]; close: [] }>();

const root = useTemplateRef("root");
const calendar = useTemplateRef<InstanceType<typeof DateCalendar>>("calendar");
const field = useTemplateRef<InstanceType<typeof TimeField>>("field");

/** The date and time the menu opens on: the value's, or now's. */
const base: DateTimeParts =
  props.choice?.kind === "dateTime"
    ? props.choice
    : (props.now ?? localDateTimeNow());
const selectedDay = computed<YearMonthDay | undefined>(() =>
  props.choice?.kind === "dateTime" ? props.choice : undefined,
);
const initialTime = { hour: base.hour, minute: base.minute, second: 0 };
/** Set once the menu has chosen or closes, so a later blur writes nothing. */
let settled = false;

function choose(parts: DateTimeParts) {
  settled = true;
  emit("choose", { kind: "dateTime", ...parts });
}

function chooseNow() {
  settled = true;
  emit("choose", { kind: "now" });
}

/** A day keeps the time in the field, edited or not; the chosen day without a time edit only closes. */
function chooseDay(day: YearMonthDay) {
  if (settled) return;
  const time = field.value?.currentTime() ?? initialTime;
  const edited = field.value?.editedTime() != null;
  const chosen = selectedDay.value;
  if (
    !edited &&
    chosen != null &&
    chosen.year === day.year &&
    chosen.month === day.month &&
    chosen.day === day.day
  ) {
    close();
    return;
  }
  choose({ ...day, hour: time.hour, minute: time.minute });
}

/** Write the field's time on the value's day (or today's), once, if it was edited and is complete. */
function commitTime() {
  const time = field.value?.editedTime();
  if (settled || time == null) return;
  choose({
    year: base.year,
    month: base.month,
    day: base.day,
    hour: time.hour,
    minute: time.minute,
  });
}

function onLeave(next: EventTarget | null) {
  if (
    next instanceof Node &&
    (root.value?.$el as HTMLElement | undefined)?.contains(next)
  )
    return;
  commitTime();
}

function close() {
  settled = true;
  emit("close");
}

onBeforeUnmount(() => (settled = true));
onMounted(() => {
  props.registerAccept?.(commitTime);
  void nextTick(() => calendar.value?.focusDay());
});
</script>

<template>
  <PickerMenuFrame
    ref="root"
    class="DateTimeMenu"
    ariaLabel="Pick a date and time"
    @close="close"
  >
    <ul class="relative">
      <li>
        <button
          type="button"
          class="item"
          :class="{ selected: props.choice?.kind === 'now' }"
          data-choice="now"
          @click="chooseNow"
        >
          Date_Time.now
        </button>
      </li>
    </ul>
    <hr class="divider" />
    <DateCalendar
      ref="calendar"
      :selected="selectedDay"
      :shown="base"
      @pick="chooseDay"
    />
    <hr class="divider" />
    <TimeField
      ref="field"
      :initial="initialTime"
      :initialShowSeconds="false"
      :secondsToggle="false"
      @enter="commitTime"
      @leave="onLeave"
    />
  </PickerMenuFrame>
</template>
```

Notes: `base`'s `year`/`month`/`day` is the value's date, or now's for
`Date_Time.now` and unset (so a time on `now` is written on today). The keyboard
starts on the calendar, as in the date menu; Tab reaches the field. Moving the
focus from the field to the calendar is inside the menu (`onLeave` returns), so
it does not write the time on its own; picking a day then writes both.

- [ ] **Step 4: Run, expect PASS**; typecheck and lint the folder.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/DateTimeMenu.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/__tests__/DateTimeMenu.test.ts
git commit -m "GUI: the Date_Time picker's menu: now, a calendar and a time field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `WidgetDateTime`, whole nodes and vector items

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime.vue`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector/elementType.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector/__tests__/elementType.test.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/__tests__/widgetDateTime.score.test.ts`

**Interfaces:**

- Consumes: Task 6's `DATE_TIME_TYPE`, `parseDateTimeExpression`,
  `dateTimeExpressionCode`, `withKeptArguments`; Task 7's `DateTimeMenu`;
  `PickerShell`, `isWholeNodeCall`, `parenthesisedApplication`,
  `unparenthesisedCode`, `hasDropdown`.
- Produces: `widgetDefinition` (priority 53); root class `.WidgetDateTime`;
  `defaultItemCode(DATE_TIME_TYPE) === 'Date_Time.now'`.

- [ ] **Step 1: Write the failing tests.** The score test copies
      `WidgetTimeOfDay/__tests__/widgetTimeOfDay.score.test.ts` with:

```ts
import { widgetDefinition as timeWidget } from "@/components/GraphEditor/widgets/WidgetTimeOfDay.vue";
import { widgetDefinition as dateTimeWidget } from "@/components/GraphEditor/widgets/WidgetDateTime.vue";
import { DATE_TIME_TYPE } from "../dateTimeExpression";
// score(), inputFor(), inBlock(), placeholder() and typedArgument() as in the time test,
// with dateTimeWidget and the argument named 'moment'.

describe("the date-time widget scores", () => {
  test("a Date_Time-typed argument Perfect, by reprType or expected type", () => {
    expect(score(placeholder(typedArgument(DATE_TIME_TYPE)))).toBe(
      Score.Perfect,
    );
    expect(score(placeholder({ expectedType: DATE_TIME_TYPE as never }))).toBe(
      Score.Perfect,
    );
  });

  test("a node that is only a date-time Perfect, whatever its arguments", () => {
    expect(score(inBlock("x = Date_Time.now", "Date_Time.now"))).toBe(
      Score.Perfect,
    );
    expect(
      score(
        inBlock(
          "x = Date_Time.new 2020 1 15 9 30",
          "Date_Time.new 2020 1 15 9 30",
        ),
      ),
    ).toBe(Score.Perfect);
    expect(
      score(
        inBlock(
          "x = Date_Time.new y 1 15 zone=z",
          "Date_Time.new y 1 15 zone=z",
        ),
      ),
    ).toBe(Score.Perfect);
  });

  test("what is not a whole date-time node Mismatch", () => {
    expect(score(inBlock("x = Date_Time.now.hour", "Date_Time.now"))).toBe(
      Score.Mismatch,
    );
    expect(score(inBlock("x = foo Date_Time.now", "Date_Time.now"))).toBe(
      Score.Mismatch,
    );
    expect(score(inBlock("x = Date.today", "Date.today"))).toBe(Score.Mismatch);
    expect(score(inBlock("x = Time_Of_Day.now", "Time_Of_Day.now"))).toBe(
      Score.Mismatch,
    );
  });

  test("an argument that has its own dropdown Mismatch", () => {
    const singleChoice = {
      dynamicConfig: { kind: "Single_Choice", values: [] },
    } as never;
    expect(
      score(placeholder({ ...typedArgument(DATE_TIME_TYPE), ...singleChoice })),
    ).toBe(Score.Mismatch);
  });

  test("ranks after the time-of-day widget and before the argument name", () => {
    expect(dateTimeWidget.priority).toBe(53);
    expect(dateTimeWidget.priority).toBeGreaterThan(timeWidget.priority);
    expect(dateTimeWidget.priority).toBeLessThan(argumentNameWidget.priority);
  });
});
```

In `elementType.test.ts`'s `defaultItemCode` describe, add:

```ts
test("a new date-time starts as now", () => {
  expect(defaultItemCode("Standard.Base.Data.Time.Date_Time.Date_Time")).toBe(
    "Date_Time.now",
  );
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `WidgetDateTime.vue`** (as `WidgetTimeOfDay.vue`):

```vue
<script setup lang="ts">
import { useCurrentProject } from "$/components/WithCurrentProject.vue";
import { requiredImportsByProjectPath } from "$/providers/openedProjects/module/imports";
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from "$/providers/openedProjects/widgetRegistry";
import DateTimeMenu from "@/components/GraphEditor/widgets/WidgetDateTime/DateTimeMenu.vue";
import {
  DATE_TIME_TYPE,
  dateTimeExpressionCode,
  parseDateTimeExpression,
  withKeptArguments,
  type DateTimeChoice,
} from "@/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression";
import {
  parenthesisedApplication,
  unparenthesisedCode,
} from "@/components/GraphEditor/widgets/WidgetPicker/parentheses";
import PickerShell from "@/components/GraphEditor/widgets/WidgetPicker/PickerShell.vue";
import { isWholeNodeCall } from "@/components/GraphEditor/widgets/WidgetPicker/wholeNode";
import { hasDropdown } from "@/components/GraphEditor/widgets/WidgetSelection.vue";
import { ArgumentInfoKey } from "@/util/callTree";
import { ProjectPath } from "@/util/projectPath";
import type { QualifiedName } from "@/util/qualifiedName";
import { computed } from "vue";

const props = defineProps(widgetProps(widgetDefinition));
const { suggestionDb, module } = useCurrentProject();

const dateTimeImport = computed(() =>
  requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create(
      "Standard.Base" as QualifiedName,
      "Data.Time.Date_Time.Date_Time" as QualifiedName,
    ),
  ),
);

const choice = computed(() =>
  parseDateTimeExpression(unparenthesisedCode(props.input)),
);

/** One choice is one edit, so one undo step; an edit keeps the value's second, finer parts and zone. */
function choose(picked: DateTimeChoice, done: () => void) {
  const kept = withKeptArguments(picked, choice.value);
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, dateTimeImport.value);
    const code = dateTimeExpressionCode(kept);
    const value =
      kept.kind === "dateTime"
        ? parenthesisedApplication(code, props.input.value, props.input.portId)
        : code;
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value },
      directInteraction: true,
    });
  });
  done();
}
</script>

<script lang="ts">
function isDateTimeTyped(input: WidgetInput): boolean {
  return (
    input.expectedType === DATE_TIME_TYPE ||
    input[ArgumentInfoKey]?.info?.reprType === DATE_TIME_TYPE
  );
}

/** A node that is only a date-time: `Date_Time.now`, or `Date_Time.new` with whatever arguments. */
function isWholeDateTimeNode(input: WidgetInput): boolean {
  return isWholeNodeCall(input, {
    bare: ["Date_Time.now"],
    applied: ["Date_Time.new"],
  });
}

/**
 * The date and time-of-day widgets' counterpart for a `Date_Time`-typed argument or item, or a
 * whole node that is a date-time (no second dropdown where `WidgetSelection` gives one): its own
 * widgets show the code (`Date_Time.now`, or `Date_Time.new` with its ports), and an arrow under it
 * opens a menu of `Date_Time.now`, a calendar and a time field. Priority 53, after the time-of-day
 * widget (52).
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 53,
    score: (props) =>
      !hasDropdown(props.input) &&
      (isDateTimeTyped(props.input) || isWholeDateTimeNode(props.input))
        ? Score.Perfect
        : Score.Mismatch,
  },
  import.meta.hot,
);
</script>

<template>
  <PickerShell class="WidgetDateTime" :widget="props">
    <template #menu="{ close, done, setAccept }">
      <DateTimeMenu
        :choice="choice"
        :registerAccept="setAccept"
        @choose="choose($event, done)"
        @close="close"
      />
    </template>
  </PickerShell>
</template>
```

In `elementType.ts`, import `DATE_TIME_TYPE` and add
`[DATE_TIME_TYPE]: 'Date_Time.now'` to `DEFAULT_ITEMS`.

- [ ] **Step 4: Docs.** In `widgets/CLAUDE.md`'s "File layout", after the
      `WidgetTimeOfDay.vue` entry:

```markdown
- `WidgetDateTime.vue` — the same for a `Date_Time`-typed input or item, and a
  whole node that is `Date_Time.now` or `Date_Time.new` (priority 53). Its menu
  (`WidgetDateTime/DateTimeMenu.vue`) is `Date_Time.now`, the date menu's
  calendar (`WidgetDate/DateCalendar.vue`) and the time menu's field
  (`WidgetTimeOfDay/TimeField.vue`, hours and minutes only). A day or a time
  writes `Date_Time.new y m d h mi`; a day keeps the field's time and a time
  keeps the value's day. `dateTimeExpression.ts` reads the arguments from the
  AST: an edit keeps everything after the minute as written (`second`, the finer
  parts, `zone`), and the picker never writes a zone. A new item of a
  `Vector Date_Time` starts as `Date_Time.now`.
```

and in the `WidgetDate.vue` and `WidgetTimeOfDay.vue` entries, name the moved
parts (`DateCalendar.vue`, `TimeField.vue`) where they say "a Reka calendar" /
"a Reka `TimeField`".

- [ ] **Step 5: Run the tests (the widgets folder), typecheck, lint.** Expected:
      PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetDateTime/__tests__/widgetDateTime.score.test.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector/elementType.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector/__tests__/elementType.test.ts app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md
git commit -m "GUI: a Date_Time picker for arguments, list items and whole nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Playwright, changelog, verification, screenshots, PR

**Files:**

- Modify: `app/gui/integration-test/project-view/widgets.spec.ts` (a
  `test.describe('Date_Time widget', …)` after the `Time_Of_Day widget` block)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Playwright.** Copy the `Time_Of_Day widget` block's setup with
      `Data.hours_since` taking `moment : Date_Time`, the type entry for
      `Standard.Base.Data.Time.Date_Time` / `Date_Time`, and the main file:

```ts
"from Standard.Base import Data\n\nmain =\n    since = Data.hours_since\n    dt1 = Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc\n    dt2 = Date_Time.now\n";
```

`dateTimeNode` returns
`{ node, widget: node.locator('.WidgetDateTime'), menu: page.locator('.DateTimeMenu'), open }`
as `timeNode` does. Tests:

```ts
const days = "[data-reka-calendar-cell-trigger]:not([data-outside-view])";

test("a Date_Time argument: now writes the code it names, with the import", async ({
  editorPage,
  page,
}) => {
  const { widget, menu, open } = await dateTimeNode(editorPage, page);
  await open();
  await expect(menu.locator(".item")).toHaveText(["Date_Time.now"]);
  await expect(menu.getByRole("spinbutton")).toHaveCount(2);
  await menu.getByRole("button", { name: "Date_Time.now" }).click();
  await expect(menu).toBeHidden();
  await expect(widget).toContainText(/Date_Time\W*now/);
  const code = await moduleCode(page);
  expect(code).toContain("since = Data.hours_since Date_Time.now");
  expect(code).toContain("from Standard.Base import Date_Time");
});

test("a day writes Date_Time.new, parenthesised, with five ports", async ({
  editorPage,
  page,
}) => {
  const { widget, menu, open } = await dateTimeNode(editorPage, page);
  await open();
  await menu.locator(days).nth(19).click();
  await expect(menu).toBeHidden();
  await expect(widget.locator(".WidgetNumber")).toHaveCount(5);
  expect(await moduleCode(page)).toMatch(
    /since = Data\.hours_since \(Date_Time\.new \d+ \d+ 20 \d+ \d+\)\n/,
  );
});

test("a time typed and Enter writes it on today", async ({
  editorPage,
  page,
}) => {
  const { menu, open } = await dateTimeNode(editorPage, page);
  await open();
  await menu.getByRole("spinbutton").first().focus();
  await page.keyboard.type("0930");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  expect(await moduleCode(page)).toMatch(
    /since = Data\.hours_since \(Date_Time\.new \d+ \d+ \d+ 9 30\)\n/,
  );
});

/** The whole node `dt1`, opened: one click selects it, the next opens the menu. */
async function openWholeNode(page: Page) {
  const node = locate.graphNodeByBinding(page, "dt1");
  const widget = node.locator(".WidgetDateTime");
  const menu = page.locator(".DateTimeMenu");
  await widget.click({ position: { x: 4, y: 4 } });
  await expect(node).toHaveClass(/selected/);
  await widget.click({ position: { x: 4, y: 4 } });
  await expect(menu).toBeVisible();
  return { node, widget, menu };
}

test("a day picked on a whole node keeps its second and zone", async ({
  editorPage,
  page,
}) => {
  await dateTimeNode(editorPage, page);
  const { menu } = await openWholeNode(page);
  await menu.locator(days).nth(19).click();
  await expect(menu).toBeHidden();
  expect(await moduleCode(page)).toContain(
    "dt1 = Date_Time.new 2020 1 20 9 30 second=45 zone=Time_Zone.utc\n",
  );
});

test("a time edited on a whole node keeps its day, second and zone", async ({
  editorPage,
  page,
}) => {
  await dateTimeNode(editorPage, page);
  const { menu } = await openWholeNode(page);
  await menu.getByRole("spinbutton").first().focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  expect(await moduleCode(page)).toContain(
    "dt1 = Date_Time.new 2020 1 15 10 30 second=45 zone=Time_Zone.utc\n",
  );
});

test("Date_Time.now as a whole node has the picker", async ({
  editorPage,
  page,
}) => {
  await dateTimeNode(editorPage, page);
  await expect(
    locate.graphNodeByBinding(page, "dt2").locator(".WidgetDateTime"),
  ).toHaveCount(1);
});
```

`moduleCode`: use the block-level copy as the Date and Time blocks do (or a
top-level one, if part B has already lifted it there). Run from `app/gui` three
times:
`corepack pnpm exec playwright test integration-test/project-view/widgets.spec.ts`.
Expected: all pass every time.

- [ ] **Step 2: Changelog** under `# Next Release`:
  - `#### Enso IDE`:
    `- [A date-and-time picker for Date_Time values: Date_Time.now, a calendar and a time field. Editing a value keeps its seconds and time zone.][NNN]`
  - `#### Enso Standard Library`:
    `- [Date_Time's functions have typed arguments with working widgets, including period dropdowns for start_of, end_of, + and -.][NNN]`

  One link definition; `NNN` replaced after opening the PR.

- [ ] **Step 3: Verify everything:**
  - GUI: the full Vitest once; typecheck; lint on the changed files; the
    Playwright spec three times; on Linux (WSL) the widget unit tests and
    `prettier --check` of the changed files.
  - Stdlib (WSL): the Date_Time tests and the whole `Base_Tests` `Time` run,
    counts compared with develop's; `stdlib-api-check`.
  - In the IDE (installer or dev build with the built engine): `date_diff`'s
    `end` now has the picker; a `Vector Date_Time` argument's new item is
    `Date_Time.now`. Add those rows to the appendix's "After" table.
  - Say in the PR what ran where, and that `gatherLicenses`/`bloopInstall` were
    not exercised.

- [ ] **Step 4: Screenshots** (standing rule): the menu open on a typed
      argument, on a whole node with `second=`/`zone=`, before and after a pick;
      a period dropdown on a Date_Time node. Pushed to the orphan
      `pr-screenshots` branch and linked in the PR.

- [ ] **Step 5: Commit, push and open the PR**

```bash
git add app/gui/integration-test/project-view/widgets.spec.ts CHANGELOG.md docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md
git commit -m "Date_Time: Playwright, changelog and the assessment after

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin <branch>
```

PR against `develop`, title "Date_Time: a date-and-time picker and typed
functions"; body: what, the spec link, the `first_of_month` ruling (Task 2),
tests run where, screenshots, ending with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Replace `NNN`
and push. Build installers (IDE Packaging dispatch, `macos=true`) for the
owner's test; merge only after the owner's OK.

---

## Self-review

- **Spec coverage (part D):** `WidgetDateTime` priority 53 on `PickerShell`,
  Perfect for typed arguments/items and whole `now`/`new` nodes, Mismatch under
  another dropdown — Task 8; the menu (`now`, the calendar, the time field) —
  Tasks 4, 5, 7; writing `Date_Time.new y m d h mi` with ports — Tasks 6, 8, 9;
  keeping `second`, finer parts and `zone=`, never setting a zone — Task 6
  (`kept`), Task 8 (`withKeptArguments`), Playwright 4–5; `now` replaces the
  whole value — Task 6, Task 7; vector items — Task 8; function pass
  (`first_of_month`/`end_of_month`, `week_of_year`'s locale, `start_of`/`end_of`
  with both kinds, typed `zone`, `+`/`-` with `Period.new`/`Duration.new`, the
  rest from the assessment, before/after tables, stdlib tests, snapshot) — Tasks
  1–3 and 9. Unit tests for the picker's edits (zone and seconds kept) — Task 6.
- **Placeholders:** none. Two conditional notes (Reka re-emitting the selected
  day; the shape of a named argument in the AST) name the file to read and the
  existing test that settles it.
- **Names:** `DateCalendar` (`selected`, `shown`, `pick`, `focusDay`),
  `TimeField` (`initial`, `initialShowSeconds`, `secondsToggle`, `enter`,
  `leave`, `editedTime`, `currentTime`, `focus`), `isValidDate`,
  `DATE_TIME_TYPE`, `DateTimeParts`, `DateTimeChoice.kept`,
  `parseDateTimeExpression`, `dateTimeExpressionCode`, `withKeptArguments`,
  `localDateTimeNow`, `make_date_time_period_selector` are defined in the task
  that first uses them and spelled the same in every later one.
