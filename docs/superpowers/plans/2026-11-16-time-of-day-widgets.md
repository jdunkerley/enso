# Time_Of_Day: function pass and picker fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `Time_Of_Day` function has typed arguments, a correct return
type and a working widget, and the time picker keeps a value's seconds and finer
parts when it edits it.

**Architecture:** The Date pilot's Tasks 1–3, for `Time_Of_Day.enso`: an
assessment from the code (recorded in the spec's appendix), signature fixes
guarded by new stdlib tests, widget fixes (a period selector for `+`/`-`), and
the regenerated API snapshot. The picker fix is in the framework-free mapping
`WidgetTimeOfDay/timeExpression.ts`: it reads a named `second=` and the
millisecond, microsecond and nanosecond arguments, and writes them back; the
menu is unchanged and `WidgetTimeOfDay.vue` carries the kept parts from the
current value into the edit.

**Tech Stack:** Enso (standard library), sbt (engine distribution, in WSL), Vue
3, TypeScript, Vitest, Playwright.

**Spec:**
`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`
(part C), following `docs/superpowers/plans/2026-11-15-date-docs-pilot.md`
(Tasks 1–3) and the Date assessment in
`docs/superpowers/specs/2026-11-15-function-documentation-style-design.md`'s
appendix.

**Base:** builds on `develop` alone. It needs nothing from parts A
(`docs/superpowers/plans/2026-11-16-argument-access.md`), B or D.

## Global Constraints

- Every argument has a type ascription and every return type is correct, in the
  inline form (`name self (arg : T = default) -> R =`), with the separate
  `name : A -> B` signature line removed. `! Time_Error` stays on the return
  where the old signature had it.
- `start_of`/`end_of`: `(period : Time_Period = ..Hour)`, so the dropdown writes
  `..Hour`.
- `+`/`-`: `@amount make_time_period_selector`, a dropdown of each `Time_Period`
  (`Time_Period.Hour` … `Time_Period.Nanosecond`, whole names: the argument is a
  union, so `..Hour` would not resolve) and
  `Option "Duration.new" "(Duration.new)"`, as Date's `make_period_selector`.
- `to_date_time`: `(date : Date)`, which gives it the date picker, and
  `(zone : Time_Zone = Time_Zone.system)` with `@zone Time_Zone.default_widget`.
- The comparators' `that` stays untyped (#797): `that : Time_Of_Day` would turn
  `time < date` from `Incomparable_Values` into a `Type_Error`.
- The docs are not rewritten to the house style here (that is a later pass; the
  module is not added to `STYLE_CHECKED_MODULES`).
- Picker: `Time_Of_Day.new <hour> <minute>` followed by a positional or named
  `second`, and positional or named `millisecond`, `microsecond`, `nanosecond`
  (integer literals), is a time the picker opens on. An edit writes the picked
  hour, minute and second and keeps the finer arguments as they were written. A
  named `hour=`/`minute=` is still not the picker's (as today).
- Running an Enso test project by hand: the working directory is the project's
  parent, and a filter that matches nothing still exits 0 (root `CLAUDE.md`):
  compare test counts.
- Repo rules: `corepack pnpm`; stage explicit paths only; never `git stash`,
  `git add -A`/`.`, `--no-verify`. Commits end with a blank line, then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A `CHANGELOG.md` entry under `#### Enso Standard Library` (typed arguments,
  new dropdowns) — the picker fix is a bug fix and needs none of its own.
- Merge only after the owner's OK on an installer.

## File map

| File                                                                                                       | Responsibility                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`                             | appendix "Time_Of_Day — before" (and "after")    |
| `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Time_Of_Day.enso`                                  | signatures, widgets, `make_time_period_selector` |
| `test/Base_Tests/src/Data/Time/Time_Of_Day_Spec.enso`                                                      | a `Time_Of_Day signatures` group                 |
| `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Time_Of_Day.md`                               | the regenerated API snapshot                     |
| `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression.ts`                | named second, kept finer parts, `withKeptParts`  |
| `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/__tests__/timeExpression.test.ts` | their unit tests                                 |
| `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay.vue`                              | carry the kept parts into the edit               |
| `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`                                        | the `WidgetTimeOfDay.vue` entry                  |
| `app/gui/integration-test/project-view/widgets.spec.ts`                                                    | Playwright: seconds and milliseconds kept        |
| `CHANGELOG.md`                                                                                             | entry                                            |

Build and run helpers used below (WSL, sourcing `~/.enso-toolchain.sh` first;
root `CLAUDE.md`, "Verifying changes"; a clone on the Linux filesystem is much
faster than `/mnt/c`):

- Engine distribution: `sbt buildEngineDistribution`.
- The Time_Of_Day tests, from the repo root:

```bash
cd test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode \
  -da:com.oracle.graal.python.runtime.ExecutionContext" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso \
  --no-ir-caches --run "$PWD/Base_Tests" "Time_Of_Day"
```

The filter matches the `Time_Of_Day` and `Time_Of_Day signatures` groups. Note
the number of tests run, and compare it with the same run before Task 2, so a
filter that matched nothing is not read as a pass.

GUI commands run from `app/gui`: `corepack pnpm exec vitest run <path>`,
`corepack pnpm run typecheck`, `corepack pnpm exec eslint <paths>`. In a fresh
worktree run `corepack pnpm install` then `corepack pnpm -r compile` first.

---

### Task 1: The "before" assessment, from the code

**Files:**

- Modify:
  `docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`
  (the `### Time_Of_Day — before` heading of the appendix)

The Date pilot assessed in the running IDE; this pass reads the code, which is
enough because each widget follows from three things that can be read: the
argument's declared type as the catalogue sees it (the API snapshot,
`docs/api/Data/Time/Time_Of_Day.md`, shows `Standard.Base.Any.Any` for every
argument a separate signature line leaves untyped), its `@` annotation, and the
IDE's rules (`widgets/CLAUDE.md`: a `Time_Of_Day`/`Date`-typed argument gets the
picker, a single type with constructors its dropdown, a union none, `Integer` a
number, `Boolean` a checkbox).

- [ ] **Step 1: Check each row below against the code.** For every user-facing
      function, read its definition in `Time_Of_Day.enso` and its line in the
      API snapshot, and confirm or correct the row. The table as read on
      2026-11-16 (develop after #800):

```markdown
Taken on: <date>, commit <hash> (develop), from the code: `Time_Of_Day.enso`,
its API snapshot and the IDE's widget rules (not in the running IDE).

| Function                                           | Argument                                        | Type (declared)                                                           | Expected widget                         | Widget from the code                      | Result  | Note                                                                      |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------- | ------- | ------------------------------------------------------------------------- |
| now                                                | —                                               | —                                                                         | —                                       | —                                         | n/a     | No arguments.                                                             |
| new                                                | hour · minute                                   | Integer (untyped inline; the signature line is not seen by the catalogue) | number, 0–23 / 0–59                     | number (`@hour`, `@minute` Numeric_Input) | works   | The ranges come from the annotations; the type is `Any` in the catalogue. |
| new                                                | second · millisecond · microsecond · nanosecond | Integer (untyped)                                                         | number, shown when modified             | number (annotations)                      | works   | Hidden until set; part A's `…` reaches them.                              |
| parse                                              | text                                            | Text                                                                      | text                                    | text                                      | works   |                                                                           |
| parse                                              | format                                          | Date_Time_Formatter                                                       | format dropdown                         | `make_time_format_selector`               | works   | Return is `Any` in the catalogue.                                         |
| hour · minute · second · millisecond · microsecond | —                                               | —                                                                         | —                                       | —                                         | n/a     | No arguments.                                                             |
| nanosecond                                         | include_milliseconds                            | Boolean (written `include_milliseconds=False:Boolean`)                    | checkbox                                | text box                                  | missing | The ascription is on the default, so the catalogue sees `Any`.            |
| start_of · end_of                                  | period                                          | Time_Period (untyped)                                                     | Time_Period dropdown, writing `..Hour`  | text box                                  | missing | Untyped: no tag values.                                                   |
| to_seconds                                         | —                                               | —                                                                         | —                                       | —                                         | n/a     |                                                                           |
| to_date_time                                       | date                                            | Date (untyped)                                                            | date picker                             | text box                                  | missing |                                                                           |
| to_date_time                                       | zone                                            | Time_Zone (untyped)                                                       | time zone dropdown                      | text box                                  | missing | No `@zone`, unlike `Date.to_date_time`.                                   |
| date_part                                          | period                                          | Time_Period                                                               | Time_Period dropdown                    | Time_Period dropdown                      | works   | Return `Any`.                                                             |
| date_diff                                          | end                                             | Time_Of_Day                                                               | time picker                             | time picker                               | works   | Return `Any`.                                                             |
| date_diff · date_add                               | period                                          | Time_Period                                                               | Time_Period dropdown                    | Time_Period dropdown                      | works   |                                                                           |
| date_add                                           | amount                                          | Integer                                                                   | number                                  | number                                    | works   |                                                                           |
| + · -                                              | amount                                          | Duration \| Time_Period                                                   | Time_Period dropdown and `Duration.new` | text box                                  | missing | A union has no tag values.                                                |
| format                                             | format                                          | Date_Time_Formatter                                                       | format dropdown                         | format dropdown                           | works   | Return `Any`.                                                             |
| > · >= · < · <=                                    | that                                            | (untyped)                                                                 | —                                       | text box                                  | n/a     | Stays untyped (#797).                                                     |

Hidden (`private: true`): `to_js_object`, `to_display_text`, `pretty`,
`default_widget`, `Time_Of_Day.from`.
```

- [ ] **Step 2: Record and commit.** Replace the placeholder line under
      `### Time_Of_Day — before` with the checked table (correcting any row the
      code contradicts), filling in the date and commit.

```bash
git add docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md
git commit -m "Time_Of_Day pass: the assessment before the fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Signature fixes

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Time_Of_Day.enso`
- Modify: `test/Base_Tests/src/Data/Time/Time_Of_Day_Spec.enso`

**Interfaces:**

- Produces (the signatures Task 3 annotates and Task 4's snapshot shows):

```enso
    new (hour : Integer = 0) (minute : Integer = 0) (second : Integer = 0) (millisecond : Integer = 0) (microsecond : Integer = 0) (nanosecond : Integer = 0) -> Time_Of_Day ! Time_Error =
    parse (text : Text) (format : Date_Time_Formatter = Date_Time_Formatter.iso_time) -> Time_Of_Day ! Time_Error =
    nanosecond self (include_milliseconds : Boolean = False) -> Integer =
    start_of self (period : Time_Period = ..Hour) -> Time_Of_Day =
    end_of self (period : Time_Period = ..Hour) -> Time_Of_Day =
    to_date_time self (date : Date) (zone : Time_Zone = Time_Zone.system) -> Date_Time =
    date_part self (period : Time_Period) -> Integer =
    date_diff self (end : Time_Of_Day) (period : Time_Period) -> Integer =
    date_add self (amount : Integer) (period : Time_Period) -> Time_Of_Day =
    + self (amount : Duration | Time_Period) -> Time_Of_Day ! Time_Error =
    - self (amount : Duration | Time_Period) -> Time_Of_Day ! Time_Error =
    format self (format : Date_Time_Formatter) -> Text =
    to_js_object self -> JS_Object =
    to_display_text self -> Text =
    pretty self -> Text =
```

- [ ] **Step 1: Write the tests.** In `Time_Of_Day_Spec.enso`'s `add_specs`,
      after the three `specWith` calls, add a group of its own (the `specWith`
      groups also run on Java and Python times, whose constructors these tests
      do not concern):

```enso
    suite_builder.group "Time_Of_Day signatures" group_builder->
        group_builder.specify "start_of and end_of default to the hour, and take ..Minute" <|
            t = Time_Of_Day.new 15 37 58
            t.start_of . should_equal (Time_Of_Day.new 15 0 0)
            t.end_of . should_equal (Time_Of_Day.new 15 59 59 nanosecond=999999999)
            t.start_of ..Minute . should_equal (Time_Of_Day.new 15 37 0)

        group_builder.specify "to_date_time takes a Date, and a zone" <|
            dt = (Time_Of_Day.new 12 30).to_date_time (Date.new 2020 1 1) Time_Zone.utc
            dt . should_equal (Date_Time.new 2020 1 1 12 30 zone=Time_Zone.utc)

        group_builder.specify "+ and - take each Time_Period and a Duration" <|
            t = Time_Of_Day.new 12 30
            (t + Time_Period.Hour) . should_equal (Time_Of_Day.new 13 30)
            (t - Time_Period.Minute) . should_equal (Time_Of_Day.new 12 29)
            (t + (Duration.new seconds=15)) . should_equal (Time_Of_Day.new 12 30 15)
            (t - (Duration.new minutes=45)) . should_equal (Time_Of_Day.new 11 45)

        group_builder.specify "methods reject arguments of the wrong type" <|
            t = Time_Of_Day.new 12 30
            Test.expect_panic_with (t.to_date_time 5) Type_Error
            Test.expect_panic_with (t.start_of 5) Type_Error
            Test.expect_panic_with (t.end_of "Hour") Type_Error
            Test.expect_panic_with (t.nanosecond 5) Type_Error
            Test.expect_panic_with (Time_Of_Day.new "a") Type_Error
            Test.expect_panic_with (t.to_date_time (Date.new 2020 1 1) 5) Type_Error
```

`Type_Error` is imported already (`Standard.Base.Errors.Common.Type_Error`).

- [ ] **Step 2: Run them before the change** (build the distribution, then the
      Time_Of_Day tests; see the helpers above). Expected: the first three pass
      (`..Minute` may fail to resolve while `period` is untyped — note it); in
      the last, several `expect_panic_with` fail, since the untyped arguments
      fail later or differently. Record which, for the PR. Note the test count.

- [ ] **Step 3: Fix the signatures** in `Time_Of_Day.enso`, to the
      **Interfaces** list above:
  - Each method: replace the `name : A -> B` line and the definition line with
    the one inline definition line. Keep every `@` annotation above it, and the
    body unchanged.
  - `start_of`/`end_of`: the body stays `period.adjust_start self` /
    `period.adjust_end self`.
  - `to_date_time`: add `@zone Time_Zone.default_widget` above it (as
    `Date.to_date_time` has).
  - The comparators (`>`, `>=`, `<`, `<=`) are left as they are.
  - `now`, the getters with an inline `-> Integer` and `default_widget` are
    already in the inline form.

- [ ] **Step 4: Rebuild and run.** `sbt buildEngineDistribution`, then the
      Time_Of_Day tests, then the whole `Data.Time` suite
      (`--run "$PWD/Base_Tests" "Time"` — compare its count with develop's).
      Expected: all pass, the new group included; the count is develop's plus
      the four new tests.

- [ ] **Step 5: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Time_Of_Day.enso test/Base_Tests/src/Data/Time/Time_Of_Day_Spec.enso
git commit -m "Time_Of_Day: type every argument and correct the return types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Widget fixes

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Time_Of_Day.enso`
- Modify: `test/Base_Tests/src/Data/Time/Time_Of_Day_Spec.enso`

**Interfaces:**

- Produces (module-level, private, at the end of `Time_Of_Day.enso` before
  `Time_Of_Day.from`):

```enso
## ---
   private: true
   ---
   The choices for an amount of time added to, or taken from, a Time_Of_Day:
   each `Time_Period`, and `Duration.new` for a custom number of hours,
   minutes and seconds. The whole names are written, as the argument takes
   either type.
make_time_period_selector display:Display=..When_Modified -> Widget =
    periods = ["Hour", "Minute", "Second", "Millisecond", "Microsecond", "Nanosecond"].map name->
        code = "Time_Period." + name
        Option code code
    Widget.Single_Choice values=(periods + [Option "Duration.new" "(Duration.new)"]) display=display
```

- [ ] **Step 1: Write the test** (in the `Time_Of_Day signatures` group):

```enso
        group_builder.specify "+ and - offer each Time_Period and Duration.new" <|
            widget = make_time_period_selector
            labels = widget.values.map .label
            labels . should_equal ["Time_Period.Hour", "Time_Period.Minute", "Time_Period.Second", "Time_Period.Millisecond", "Time_Period.Microsecond", "Time_Period.Nanosecond", "Duration.new"]
            widget.values.last.value . should_equal "(Duration.new)"
```

and import it at the top of the spec:
`from Standard.Base.Data.Time.Time_Of_Day import make_time_period_selector`.
(`Widget.Single_Choice`'s `values` and `Choice.Option`'s `label`/`value` are the
fields `Metadata.enso` defines.)

Run: expected FAIL (no such function).

- [ ] **Step 2: Add the selector and the annotations**
  - The `make_time_period_selector` above, after `default_widget`'s type block
    ends (module level). `Option` and `Widget`, `Display` are imported already.
  - `@amount make_time_period_selector` above `+` and above `-`.
  - Nothing for `start_of`/`end_of`: the type `Time_Period` gives the dropdown,
    and with a single type the IDE writes `..Hour` (the Date pilot saw the same
    for `Date.start_of`).
  - Nothing for `to_date_time`'s `date`: a `Date`-typed argument gets the date
    picker (`WidgetDate.vue`).

- [ ] **Step 3: Rebuild, run the Time_Of_Day tests.** Expected: PASS.

- [ ] **Step 4: Check by hand in the IDE** (built distribution, `run` skill or
      the wiki's Building-and-Running): place `t = Time_Of_Day.new 9 30` and
      connect `start_of`, `+`, `to_date_time`, `nanosecond`; open each widget
      and check: `start_of` lists the six periods and writes `..Minute`; `+`
      lists six whole names and `Duration.new`, and both evaluate;
      `to_date_time`'s `date` has the date picker and `zone` the zone dropdown;
      `nanosecond`'s `include_milliseconds` is a checkbox.

- [ ] **Step 5: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Time_Of_Day.enso test/Base_Tests/src/Data/Time/Time_Of_Day_Spec.enso
git commit -m "Time_Of_Day: a working widget for every argument

- start_of and end_of type their period, so the dropdown writes ..Hour.
- + and - offer each Time_Period and Duration.new for a custom amount.
- to_date_time types date and zone, so the date picker and the zone dropdown
  appear.

The comparators' that stays untyped, as for Date (#797).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The API snapshot, and the "after" table

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Time_Of_Day.md`
- Modify: the spec's appendix

- [ ] **Step 1: Regenerate** (WSL, after Task 3's build), as #800 did for
      `Date.md`:

```bash
lib=$(echo built-distribution/enso-engine-*/enso-*/lib/Standard/Base/0.0.0-dev)
built-distribution/enso-engine-*/enso-*/bin/enso --docs api --in-project "$lib"
cp "$lib/docs/api/Data/Time/Time_Of_Day.md" distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Time_Of_Day.md
git diff distribution/lib/Standard/Base/0.0.0-dev/docs/api
```

Expected diff: only `Time_Of_Day.md` changes (no other module's snapshot moves),
with each argument and return of the **Interfaces** list of Task 2 typed, the
comparators still `Any`, and a new line
`- make_time_period_selector display:Standard.Base.Metadata.Display= -> Standard.Base.Metadata.Widget`.
If another file changes, find out why before going on.

- [ ] **Step 2: Check it the way CI does:**
      `corepack pnpm --filter build-scripts run stdlib-api-check`. Expected:
      passes.

- [ ] **Step 3: The "after" table.** Under the appendix's Time_Of_Day table, add
      `#### After` with the rows that changed (`Result` now **works**), taken
      from the IDE check of Task 3, Step 4.

- [ ] **Step 4: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/docs/api/Data/Time/Time_Of_Day.md docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md
git commit -m "Base API: Time_Of_Day's typed signatures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The picker keeps seconds and finer parts

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/__tests__/timeExpression.test.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay.vue`
- Modify: `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`

Today the picker already shows and writes a **positional** second
(`Time_Of_Day.new 14 30 15`). What loses seconds is any other spelling: a named
`second=15` (what part A's `…` menu writes, and what `Time_Of_Day.pretty`
writes) or a value with milliseconds (`Time_Of_Day.new 14 30 15 500`). Neither
is recognised, so the menu opens on the current time and an edit replaces the
whole value with `Time_Of_Day.new h m`.

**Interfaces:**

- Produces:

```ts
/** What the value stands for: the current time, or a specific one. */
export type TimeChoice =
  | { readonly kind: "now" }
  | ({ readonly kind: "time" } & HourMinuteSecond & {
        /**
         * The millisecond, microsecond and nanosecond arguments as they were written (`500`,
         * `millisecond=500`), kept by an edit. Absent when there are none.
         */
        readonly finer?: readonly string[];
      });

/** `picked`, with the finer parts of `current` when both are specific times: an edit keeps them. */
export function withKeptParts(
  picked: TimeChoice,
  current: TimeChoice | undefined,
): TimeChoice;
```

`parseTimeExpression` and `timeExpressionCode` keep their signatures.
`TimeOfDayMenu.vue` is not changed: it emits a `time` choice without `finer`,
which `withKeptParts` completes.

- [ ] **Step 1: Write the failing tests.** In `timeExpression.test.ts`:
  - Move `'Time_Of_Day.new 14 30 15 7'` out of the "is not ours" list (it is a
    time with a millisecond now).
  - Add to the "is a time choice" table:

```ts
    ['Time_Of_Day.new 14 30 second=15', { kind: 'time', hour: 14, minute: 30, second: 15 }],
    [
      'Time_Of_Day.new 14 30 15 7',
      { kind: 'time', hour: 14, minute: 30, second: 15, finer: ['7'] },
    ],
    [
      'Time_Of_Day.new 14 30 second=15 millisecond=500',
      { kind: 'time', hour: 14, minute: 30, second: 15, finer: ['millisecond=500'] },
    ],
    [
      'Time_Of_Day.new 14 30 millisecond=500',
      { kind: 'time', hour: 14, minute: 30, second: 0, finer: ['millisecond=500'] },
    ],
    [
      'Time_Of_Day.new 14 30 15 7 8 9',
      { kind: 'time', hour: 14, minute: 30, second: 15, finer: ['7', '8', '9'] },
    ],
```

- Add to the "is not ours" list:

```ts
    'Time_Of_Day.new 14 30 15 second=16',
    'Time_Of_Day.new 14 30 second=15 second=16',
    'Time_Of_Day.new 14 30 second=x',
    'Time_Of_Day.new 14 30 zone=15',
    'Time_Of_Day.new 14 30 15 7 8 9 10',
    'Time_Of_Day.new 14 30 15 millisecond=1000',
```

- Add to the `timeExpressionCode` round-trip table:

```ts
    [
      { kind: 'time', hour: 9, minute: 5, second: 0, finer: ['millisecond=500'] },
      'Time_Of_Day.new 9 5 millisecond=500',
    ],
    [
      { kind: 'time', hour: 9, minute: 5, second: 0, finer: ['500'] },
      'Time_Of_Day.new 9 5 0 500',
    ],
    [
      { kind: 'time', hour: 9, minute: 5, second: 15, finer: ['7', '8'] },
      'Time_Of_Day.new 9 5 15 7 8',
    ],
```

- Add:

```ts
describe("withKeptParts", () => {
  const current: TimeChoice = {
    kind: "time",
    hour: 14,
    minute: 30,
    second: 15,
    finer: ["millisecond=500"],
  };

  test("an edited time keeps the finer parts of the current one", () => {
    expect(
      withKeptParts({ kind: "time", hour: 9, minute: 0, second: 15 }, current),
    ).toEqual({
      kind: "time",
      hour: 9,
      minute: 0,
      second: 15,
      finer: ["millisecond=500"],
    });
  });

  test("now replaces the whole value", () => {
    expect(withKeptParts({ kind: "now" }, current)).toEqual({ kind: "now" });
  });

  test("nothing to keep from now, an unset value or a time without finer parts", () => {
    const picked: TimeChoice = { kind: "time", hour: 9, minute: 0, second: 0 };
    expect(withKeptParts(picked, { kind: "now" })).toEqual(picked);
    expect(withKeptParts(picked, undefined)).toEqual(picked);
    expect(
      withKeptParts(picked, { kind: "time", hour: 1, minute: 2, second: 3 }),
    ).toEqual(picked);
  });
});
```

(import `withKeptParts`.)

- [ ] **Step 2: Run, expect FAIL:**
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/__tests__/timeExpression.test.ts`

- [ ] **Step 3: Implement** in `timeExpression.ts`: replace `TIME_NEW` and the
      body of `parseTimeExpression`, extend `TimeChoice` and
      `timeExpressionCode`, and add `withKeptParts`:

```ts
/** `Time_Of_Day.new`, hour and minute as integer literals, then the rest of the arguments. */
const TIME_NEW = /^Time_Of_Day\.new\s+(\d+)\s+(\d+)((?:\s+\S+)*)$/;
const INTEGER = /^\d+$/;
const NAMED = /^(second|millisecond|microsecond|nanosecond)=(\d+)$/;
/** The arguments after the minute, in `Time_Of_Day.new`'s order. */
const AFTER_MINUTE = [
  "second",
  "millisecond",
  "microsecond",
  "nanosecond",
] as const;
type AfterMinute = (typeof AFTER_MINUTE)[number];
/** Each part's largest value, as `Time_Of_Day.new` documents them. */
const MAX: Readonly<Record<AfterMinute, number>> = {
  second: 59,
  millisecond: 999,
  microsecond: 999_999,
  nanosecond: 999_999_999,
};

/**
 * The choice that the code stands for, or `undefined` when the code is not one of the shapes:
 * `Time_Of_Day.now`, and `Time_Of_Day.new` with an hour and a minute as integer literals followed
 * by a second and the finer parts, positional or named, as integer literals. Anything else (a
 * variable, a computed argument, a named hour or minute, an argument given twice, a positional
 * argument after a named one, an hour of 24) is not ours.
 */
export function parseTimeExpression(
  code: string | undefined,
): TimeChoice | undefined {
  const text = code?.trim();
  if (text == null) return undefined;
  if (text === "Time_Of_Day.now") return { kind: "now" };
  const match = TIME_NEW.exec(text);
  if (match == null) return undefined;
  const values: Partial<Record<AfterMinute, number>> = {};
  const finer: string[] = [];
  let named = false;
  let next = 0;
  for (const arg of (match[3] ?? "").split(/\s+/).filter(Boolean)) {
    let name: AfterMinute;
    let value: number;
    if (INTEGER.test(arg)) {
      if (named || next >= AFTER_MINUTE.length) return undefined;
      name = AFTER_MINUTE[next++]!;
      value = Number(arg);
    } else {
      const byName = NAMED.exec(arg);
      if (byName == null) return undefined;
      named = true;
      name = byName[1] as AfterMinute;
      value = Number(byName[2]);
    }
    if (name in values || value > MAX[name]) return undefined;
    values[name] = value;
    if (name !== "second") finer.push(arg);
  }
  const time = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: values.second ?? 0,
  };
  if (!isValidTime(time)) return undefined;
  return finer.length > 0
    ? { kind: "time", ...time, finer }
    : { kind: "time", ...time };
}

/**
 * The code that a choice writes: the second when it is not zero or a finer part follows it
 * positionally (which needs it), then the finer parts as they were written.
 */
export function timeExpressionCode(choice: TimeChoice): string {
  if (choice.kind === "now") return "Time_Of_Day.now";
  const { hour, minute, second } = choice;
  const finer = choice.finer ?? [];
  const withSecond = second !== 0 || finer.some((arg) => INTEGER.test(arg));
  return [
    `Time_Of_Day.new ${hour} ${minute}`,
    ...(withSecond ? [String(second)] : []),
    ...finer,
  ].join(" ");
}

export function withKeptParts(
  picked: TimeChoice,
  current: TimeChoice | undefined,
): TimeChoice {
  if (
    picked.kind !== "time" ||
    current?.kind !== "time" ||
    current.finer == null
  )
    return picked;
  return { ...picked, finer: current.finer };
}
```

The rules, each pinned by a test: positional arguments end at the first named
one; a part given twice, positionally and by name or twice by name, is not ours
(`15 second=16`); a named finer part may follow a positional second
(`15 millisecond=500`).

- [ ] **Step 4: Run, expect PASS**, together with the menu's tests
      (`corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay`).

- [ ] **Step 5: Keep the parts on an edit** — in `WidgetTimeOfDay.vue`'s
      `choose`, write the picked choice with the current value's finer parts:

```ts
function choose(picked: TimeChoice, done: () => void) {
  const kept = withKeptParts(picked, choice.value);
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, timeImport.value);
    const code = timeExpressionCode(kept);
    const value =
      kept.kind === "time"
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
```

(import `withKeptParts` from `timeExpression`). The menu already opens with the
seconds shown when the value's second is not zero, so a named `second=15` now
shows and is kept.

- [ ] **Step 6: Docs.** In `widgets/CLAUDE.md`'s `WidgetTimeOfDay.vue` entry,
      after "written only when not zero)", add: "It reads a second written by
      name (`second=15`, as the `…` menu and `pretty` write it) and the
      millisecond, microsecond and nanosecond arguments, positional or named; an
      edit writes hour, minute and second positionally and keeps the finer
      arguments as they were written (`withKeptParts`)."

- [ ] **Step 7: Typecheck and lint** the changed files. Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay/__tests__/timeExpression.test.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay.vue app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md
git commit -m "GUI: the time picker keeps a named second and the finer parts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Playwright, changelog, verification, screenshots, PR

**Files:**

- Modify: `app/gui/integration-test/project-view/widgets.spec.ts` (the
  `Time_Of_Day widget` block)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Playwright.** In the `Time_Of_Day widget` block, add two whole
      nodes to its mocked main file
      (`…\n    time3 = Time_Of_Day.new 14 30 second=15\n    time4 = Time_Of_Day.new 14 30 15 500\n`)
      and two tests, opening the menu as the block's whole-node test does (one
      click selects the node, the second opens the menu):

```ts
test("editing a time with a named second keeps the second", async ({
  editorPage,
  page,
}) => {
  await timeNode(editorPage, page);
  const node = locate.graphNodeByBinding(page, "time3");
  const widget = node.locator(".WidgetTimeOfDay");
  const menu = page.locator(".TimeOfDayMenu");
  await widget.click({ position: { x: 4, y: 4 } });
  await widget.click({ position: { x: 4, y: 4 } });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("spinbutton")).toHaveText(["14", "30", "15"]);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  expect(await moduleCode(page)).toContain(
    "time3 = Time_Of_Day.new 15 30 15\n",
  );
});

test("editing a time with milliseconds keeps them", async ({
  editorPage,
  page,
}) => {
  await timeNode(editorPage, page);
  const node = locate.graphNodeByBinding(page, "time4");
  const widget = node.locator(".WidgetTimeOfDay");
  const menu = page.locator(".TimeOfDayMenu");
  await widget.click({ position: { x: 4, y: 4 } });
  await widget.click({ position: { x: 4, y: 4 } });
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  expect(await moduleCode(page)).toContain(
    "time4 = Time_Of_Day.new 15 30 15 500\n",
  );
});
```

(`timeNode` is called only for its mocks: the type entry that gives the import.
If the whole-node test in the block opens its menu differently, copy what it
does.) Run the spec from `app/gui` three times:
`corepack pnpm exec playwright test integration-test/project-view/widgets.spec.ts`.
Expected: all pass every time.

- [ ] **Step 2: Changelog** under `# Next Release` →
      `#### Enso Standard Library`:

```
- [Time_Of_Day's functions have typed arguments with working widgets: a
  period dropdown for start_of, end_of, + and -, and the date picker for
  to_date_time.][NNN]
```

with its link definition; `NNN` is replaced after opening the PR.

- [ ] **Step 3: Verify everything:**
  - GUI: the full Vitest once, typecheck, lint on the changed files, the
    Playwright spec three times (Windows is fine for these), and on Linux (WSL)
    the `WidgetTimeOfDay` unit tests and `prettier --check` of the changed
    files.
  - Stdlib (WSL): the Time_Of_Day tests and the whole `Base_Tests` `Time` run,
    counts compared with develop's; `stdlib-api-check`.
  - Say in the PR which of these ran where, and that `gatherLicenses` and
    `bloopInstall` were not exercised (nothing here touches them).

- [ ] **Step 4: Screenshots** (standing rule): before/after of the `+` dropdown
      on a Time_Of_Day node, `start_of`'s dropdown, `to_date_time`'s date
      picker, and the time menu on `Time_Of_Day.new 14 30 second=15`, pushed to
      the orphan `pr-screenshots` branch and linked in the PR.

- [ ] **Step 5: Commit, push and open the PR**

```bash
git add app/gui/integration-test/project-view/widgets.spec.ts CHANGELOG.md
git commit -m "Time_Of_Day pass: Playwright and changelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin <branch>
```

PR against `develop`, title "Time_Of_Day: typed functions, working widgets, and
a picker that keeps seconds"; body: the assessment table's summary, the spec
link, tests run where, screenshots, ending with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Replace `NNN`
and push. Build installers (IDE Packaging dispatch, `macos=true`) for the
owner's test; merge only after the owner's OK.

---

## Self-review

- **Spec coverage (part C):** type every argument and return — Task 2 (with
  `new`'s six, `start_of`/`end_of`, `to_date_time`'s `date` and `zone`, and the
  rest the assessment found: `parse`, `nanosecond`, `date_*`, `+`/`-`,
  `format`); `start_of`/`end_of` writing `..Hour` — Tasks 2–3; `+`/`-` dropdown
  with `Duration.new` — Task 3; `to_date_time` date picker — Tasks 2–3;
  comparators untyped — Task 2; before/after tables — Tasks 1 and 4; API
  snapshot — Task 4; stdlib tests — Tasks 2–3; picker keeps seconds — Tasks 5–6
  (the menu itself already shows and keeps a positional second; the fix covers
  the spellings that lost it).
- **Placeholders:** none.
- **Names:** `make_time_period_selector` (Task 3) is what Task 3's test imports
  and Task 4's snapshot lists; `withKeptParts` and `TimeChoice.finer` (Task 5)
  are what `WidgetTimeOfDay.vue` uses.
