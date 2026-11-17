# Argument access, Boolean, Time_Of_Day and Date_Time widgets

Status: approved by the owner 2026-11-16 (in chat). Follows the Date picker
(`2026-11-15-date-widget-design.md`, #789) and the Date documentation pilot
(#800).

## Why

The Date picker showed two general gaps in the graph editor:

- A value inside an argument (`Date.new 2020 1 15` in `end`) cannot be turned
  into a node of its own, where it is easier to see, edit, reuse and connect.
- The parameters a node is not showing (`second`, `zone` on `Date_Time.new`)
  appear only while the node is focused for editing, and there is no direct way
  to add one.

The owner also wants the same picker work for `Time_Of_Day` and `Date_Time`, and
a Boolean widget that shows `True`/`False` instead of a bare checkbox.

## Parts and order

Four PRs, in this order. Pop out is a drag on any argument, so the pickers need
nothing from A; B and C can be built alongside it.

| Part | What                                        | Depends on            |
| ---- | ------------------------------------------- | --------------------- |
| A    | The `…` parameter menu and Pop out to node  | —                     |
| B    | Boolean: checkbox + code + ▾                | —                     |
| C    | Time_Of_Day: function pass and picker fixes | —                     |
| D    | Date_Time: new picker and function pass     | A (…), C (time field) |

## A. Reaching parameters and popping out values (every node)

### The `…` menu

- A `…` follows the last argument a call shows, on every call the node draws:
  the node's own call and any call nested in an argument (so `Date.new` inside
  `end` has its own `…`).
- It opens a menu, in the dropdown style (`activityDropdownStyles`, teleported
  to `popoverRoot`), listing the call's parameters that are not shown: each
  `ArgumentPlaceholder` whose `hideByDefault` is true, by name and short type
  (`second  Integer`, `zone  Time_Zone`).
- Picking one writes it as a named argument with its default
  (`Date_Time.new 2020 1 15 9 30 second=0`). It is then an `ArgumentAst`, always
  shown, with its widget (number, dropdown, picker) and its port.
- Picking an argument whose default is not a literal writes the default's code
  as the catalogue gives it (`zone=Time_Zone.system`).
- Nothing changes about today's behaviour: focusing the node for editing
  (`tree.showDetails`) still shows every argument. The `…` is shown only when at
  least one parameter is hidden.

### Pop out to node

- **How:** drag an argument off the node and drop it on the graph; the new node
  is placed where it is dropped. There is no menu entry (owner's decision): the
  drag is the one way to pop out.
- **Which arguments:** every argument that has a value (an `ArgumentAst`, not a
  placeholder, and not already a plain reference to another node). Dropping back
  on the node, or pressing Escape during the drag, cancels it.
- **Dragging an argument does nothing else.** If a drag that starts on an
  argument does anything today (such as starting an edge from its port), that
  behaviour is replaced by Pop out; the plan checks what the drag does now
  first. Dragging an edge's end is not dragging an argument and is unchanged.
- **What it writes,** as one undoable edit:
  1. A new node `<name> = <expression>` placed above the target node
     (`nodeCreation`'s placement), where `<name>` is a fresh identifier derived
     from the argument's name (`end1`), as new nodes are named today.
  2. The argument replaced by a reference to `<name>`, so an edge connects them.
- **Auto-scoped values are made explicit.** An argument's `..Month` is resolved
  against the argument's expected type, and a node has none, so each auto-scoped
  constructor in the expression is rewritten to its qualified form
  (`Date_Period.Month`), anywhere in the expression, using the expected types
  the call tree already holds for nested arguments. If a constructor's type
  cannot be determined, the drop does nothing and a toast says why, rather than
  producing broken code.
- **Imports:** any type or module the new node's expression names that the
  module does not yet import is added (`requiredImportsByProjectPath`, as the
  pickers do).
- Not in scope: the reverse (inlining a node back into an argument).

## B. Boolean

- A `Boolean`-typed argument (what `isHandledByCheckboxWidget` matches today)
  shows `[☑] True ▾`: a checkbox, then the value as code, then the ▾ arrow under
  it, like any dropdown argument.
- Clicking the checkbox flips the value (as now). ▾ opens `True` and `False`.
- An unset argument shows its default greyed, as other placeholders do; clicking
  either control writes the value.
- A connected argument shows the edge as today; the checkbox is hidden while the
  value is not a `True`/`False` literal.
- Replaces `WidgetCheckbox` everywhere it is used.

## C. Time_Of_Day

### Function pass (as the Date pilot's Tasks 1–3)

- Type every argument and correct every return type: `new`'s six arguments,
  `start_of`/`end_of`'s `period`, `to_date_time`'s `date` and `zone`, and the
  rest found by the assessment.
- `start_of`/`end_of`: `(period : Time_Period = ..Hour)`, so the dropdown writes
  `..Hour`.
- `+`/`-`: a dropdown of each `Time_Period`, written `..Hour`, plus
  `Duration.new` for a custom amount (like Date's `make_period_selector` with
  `Period.new`). `..Hour` resolves against the `Duration | Time_Period` union:
  the engine tries each member in turn.
- `to_date_time`: `date : Date` gets the date picker.
- The comparators' `that` stays untyped, as for Date (#797).
- An assessment table before and after, in this spec's appendix, as for Date.

### Picker

- The ▾ menu stays: `Time_Of_Day.now`, then the time field.
- The time field shows and keeps seconds when the value has them (today it edits
  hours and minutes only, so seconds are lost on edit).

## D. Date_Time

### Picker (`WidgetDateTime`, priority 53)

- Same shell as Date and Time (`WidgetPicker/PickerShell.vue`); scores Perfect
  for a `Date_Time`-typed argument or item, or a whole node that is
  `Date_Time.now` or `Date_Time.new …`; Mismatch under another dropdown.
- The ▾ menu: `Date_Time.now`, the calendar (DateMenu's), the time field
  (TimeOfDayMenu's).
- Picking a day or a time writes
  `Date_Time.new <year> <month> <day> <hour> <minute>`, keeping year … minute as
  ports.
- Editing an existing `Date_Time.new …` changes only the parts picked: its
  `second` and finer parts and its `zone=` are kept. The picker never sets a
  zone; `zone` is reached through A's `…` menu, and has its own dropdown.
- Choosing `Date_Time.now` replaces the whole value.

### Function pass

- `first_of_month`/`end_of_month`: declared `Integer`, return a `Date`; now
  declared `-> Date` (the owner's decision, 2026-11-16: no behaviour change).
- `week_of_year`: typed `locale` with `Locale.default_widget`, as for Date.
- `start_of`/`end_of`: typed `Date_Period | Time_Period`, with a dropdown of
  both kinds.
- `at_time_zone`/`set_time_zone`: typed `zone`.
- `+`/`-`: `Period`, `Duration` and both period kinds, with custom
  `Period.new`/`Duration.new` entries.
- The rest from the assessment, with before/after tables in the appendix.

## Testing

- Unit tests for each new piece of logic: the `…` menu's list, the explicit
  rewrite of auto-scoped constructors, the Pop out edit (node, reference,
  imports), the Boolean widget's edits, the time field's seconds, and the
  Date_Time picker's edits (zone and seconds kept).
- Playwright for each part's main flow on a real graph: add a hidden parameter
  through `…`; drag a `Date.new` out of `end` and check the edge and code; flip
  a Boolean both ways; pick a Date_Time day and time.
- Stdlib tests for each signature change; the API snapshots regenerated.
- An installer for the owner's hand test before each part merges (features wait
  for the owner's OK).

## Appendix: assessments

### Time_Of_Day — before

Taken on: 2026-11-16, commit 0b9a387d0e (develop), from the code:
`Time_Of_Day.enso`, its API snapshot and the IDE's widget rules (not in the
running IDE). Rows marked "Corrected in the IDE" were checked against the
packaged IDE built from #800's branch (the #829 screenshots): the IDE takes an
argument's type from a separate signature line too, where the catalogue's API
snapshot shows `Any`.

| Function                                           | Argument                                        | Type (declared)                                                           | Expected widget                         | Widget from the code                                             | Result  | Note                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| now                                                | —                                               | —                                                                         | —                                       | —                                                                | n/a     | No arguments.                                                                                           |
| new                                                | hour · minute                                   | Integer (untyped inline; the signature line is not seen by the catalogue) | number, 0–23 / 0–59                     | number (`@hour`, `@minute` Numeric_Input)                        | works   | The ranges come from the annotations; the type is `Any` in the catalogue.                               |
| new                                                | second · millisecond · microsecond · nanosecond | Integer (untyped)                                                         | number, shown when modified             | number (annotations)                                             | works   | Hidden until set; part A's `…` reaches them.                                                            |
| parse                                              | text                                            | Text                                                                      | text                                    | text                                                             | works   |                                                                                                         |
| parse                                              | format                                          | Date_Time_Formatter                                                       | format dropdown                         | `make_time_format_selector`                                      | works   | Return is `Any` in the catalogue.                                                                       |
| hour · minute · second · millisecond · microsecond | —                                               | —                                                                         | —                                       | —                                                                | n/a     | No arguments.                                                                                           |
| nanosecond                                         | include_milliseconds                            | Boolean (written `include_milliseconds=False:Boolean`)                    | checkbox                                | text box                                                         | missing | The ascription is on the default, so the catalogue sees `Any`.                                          |
| start_of · end_of                                  | period                                          | Time_Period (untyped)                                                     | Time_Period dropdown, writing `..Hour`  | Time_Period dropdown of bare names, writing `Time_Period.Minute` | works   | Corrected in the IDE: the IDE reads the type from the signature line. Writes whole names, not `..Hour`. |
| to_seconds                                         | —                                               | —                                                                         | —                                       | —                                                                | n/a     |                                                                                                         |
| to_date_time                                       | date                                            | Date (untyped)                                                            | date picker                             | date picker                                                      | works   | Corrected in the IDE: the type comes from the signature line.                                           |
| to_date_time                                       | zone                                            | Time_Zone (untyped)                                                       | time zone dropdown                      | text box                                                         | missing | No `@zone`, unlike `Date.to_date_time`.                                                                 |
| date_part                                          | period                                          | Time_Period                                                               | Time_Period dropdown                    | Time_Period dropdown                                             | works   | Return `Any`.                                                                                           |
| date_diff                                          | end                                             | Time_Of_Day                                                               | time picker                             | time picker                                                      | works   | Return `Any`.                                                                                           |
| date_diff · date_add                               | period                                          | Time_Period                                                               | Time_Period dropdown                    | Time_Period dropdown                                             | works   |                                                                                                         |
| date_add                                           | amount                                          | Integer                                                                   | number                                  | number                                                           | works   |                                                                                                         |
| + · -                                              | amount                                          | Duration \| Time_Period                                                   | Time_Period dropdown and `Duration.new` | dropdown of `..Hour` … `..Nanosecond`, no `Duration.new`         | partial | Corrected in the IDE: no custom `Duration.new`.                                                         |
| format                                             | format                                          | Date_Time_Formatter                                                       | format dropdown                         | format dropdown                                                  | works   | Return `Any`.                                                                                           |
| > · >= · < · <=                                    | that                                            | (untyped)                                                                 | —                                       | text box                                                         | n/a     | Stays untyped (#797).                                                                                   |

Hidden (`private: true`): `to_js_object`, `to_display_text`, `pretty`,
`default_widget`, `Time_Of_Day.from`.

#### After

Taken on: 2026-11-16, commit 1f0467354e, from the code (`Time_Of_Day.enso`, the
regenerated API snapshot and the IDE's widget rules); the running IDE is checked
in the PR's screenshots and the installer test. Only the rows that changed.

| Function              | Argument                                        | Type (declared)            | Expected widget                         | Widget from the code                             | Result | Note                                                                  |
| --------------------- | ----------------------------------------------- | -------------------------- | --------------------------------------- | ------------------------------------------------ | ------ | --------------------------------------------------------------------- |
| new                   | hour · minute                                   | Integer                    | number, 0–23 / 0–59                     | number (`@hour`, `@minute` Numeric_Input)        | works  | The catalogue now sees `Integer`; returns `Time_Of_Day ! Time_Error`. |
| new                   | second · millisecond · microsecond · nanosecond | Integer                    | number, shown when modified             | number (annotations)                             | works  | Typed `Integer`.                                                      |
| parse                 | text · format                                   | Text · Date_Time_Formatter | text · format dropdown                  | text · `make_time_format_selector`               | works  | Returns `Time_Of_Day ! Time_Error` instead of `Any`.                  |
| nanosecond            | include_milliseconds                            | Boolean                    | checkbox                                | checkbox                                         | works  | The type moved onto the argument, so the catalogue sees `Boolean`.    |
| start_of · end_of     | period                                          | Time_Period                | Time_Period dropdown, writing `..Hour`  | Time_Period dropdown (from the type)             | works  | Typed with a `..Hour` default; returns `Time_Of_Day`.                 |
| to_date_time          | date                                            | Date                       | date picker                             | date picker                                      | works  | Typed `Date`; returns `Date_Time`.                                    |
| to_date_time          | zone                                            | Time_Zone                  | time zone dropdown                      | time zone dropdown (`@zone`)                     | works  | `@zone` added, as `Date.to_date_time`.                                |
| + · -                 | amount                                          | Duration \| Time_Period    | Time_Period dropdown and `Duration.new` | `..Hour` dropdown and `Duration.new` (`@amount`) | works  | `@amount` added; returns `Time_Of_Day ! Time_Error`.                  |
| date_part · date_diff | period · end                                    | Time_Period · Time_Of_Day  | unchanged                               | unchanged                                        | works  | Now returns `Integer` (was `Any`).                                    |
| date_add · format     | —                                               | —                          | unchanged                               | unchanged                                        | works  | Now returns `Time_Of_Day` and `Text`.                                 |
| > · >= · < · <=       | that                                            | (untyped)                  | —                                       | text box                                         | n/a    | Still untyped (#797).                                                 |

### Date_Time — before

Taken on: 2026-11-16, commit 0b9a387d0e (develop), from the code:
`Date_Time.enso`, its API snapshot and the IDE's widget rules (not in the
running IDE).

| Function                                                                                        | Argument                            | Type (declared)                                  | Expected widget                                         | Widget from the code                                | Result  | Note                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| enso_epoch_start                                                                                | —                                   | —                                                | —                                                       | —                                                   | n/a     | Public (not hidden), typed `Date_Time`.                                                                                                         |
| now                                                                                             | —                                   | —                                                | —                                                       | —                                                   | n/a     |                                                                                                                                                 |
| new                                                                                             | year · month · day · hour · minute  | Integer                                          | number (month 1–12, day picker, hour 0–23, minute 0–59) | number (annotations)                                | works   | Return `Any` (separate signature line).                                                                                                         |
| new                                                                                             | second · millisecond · microsecond  | Integer                                          | number, shown when modified                             | number                                              | works   | Hidden until set.                                                                                                                               |
| new                                                                                             | nanosecond                          | (untyped `nanosecond = 0`)                       | number                                                  | number (annotation)                                 | works   | Catalogue type `Any`.                                                                                                                           |
| new                                                                                             | zone                                | Time_Zone                                        | zone dropdown                                           | `Time_Zone.default_widget`                          | works   |                                                                                                                                                 |
| parse                                                                                           | text · format                       | Text · Date_Time_Formatter                       | text · format dropdown                                  | text · format dropdown                              | works   | Return `Any`.                                                                                                                                   |
| from_unix_epoch_seconds · from_unix_epoch_milliseconds                                          | seconds, nanoseconds · milliseconds | Integer                                          | number                                                  | number                                              | works   | Return `Any`.                                                                                                                                   |
| year … microsecond, zone, date, time_of_day                                                     | —                                   | —                                                | —                                                       | —                                                   | n/a     | Getters, typed.                                                                                                                                 |
| nanosecond                                                                                      | include_milliseconds                | Boolean                                          | checkbox                                                | checkbox (`WidgetCheckbox`, `expectedType` Boolean) | works   | Getter with an argument; return `Integer`.                                                                                                      |
| to_unix_epoch_* · to_enso_epoch_*                                                               | —                                   | —                                                | —                                                       | —                                                   | n/a     | Return `Any`.                                                                                                                                   |
| week_of_year                                                                                    | locale                              | Locale \| Nothing (untyped)                      | locale dropdown                                         | text box                                            | missing | Date uses `@locale Locale.default_widget`.                                                                                                      |
| is_leap_year · length_of_year · century · quarter · length_of_month · day_of_year · day_of_week | —                                   | —                                                | —                                                       | —                                                   | n/a     | Return `Any`.                                                                                                                                   |
| first_of_month · end_of_month                                                                   | —                                   | —                                                | —                                                       | —                                                   | n/a     | Declared `Integer`, but the snapshot says `Any`; return a `Date` (`Time_Utils` takes a `LocalDate`; `Date_Part_Spec` compares with `Date.new`). |
| start_of · end_of                                                                               | period                              | Date_Period \| Time_Period (untyped)             | both kinds' dropdown                                    | text box                                            | missing |                                                                                                                                                 |
| at_time_zone · set_time_zone                                                                    | zone                                | Time_Zone (untyped)                              | zone dropdown                                           | zone dropdown (`@zone`)                             | works   | Catalogue type `Any`.                                                                                                                           |
| to_utc                                                                                          | —                                   | —                                                | —                                                       | —                                                   | n/a     | Return `Any`.                                                                                                                                   |
| date_part                                                                                       | period                              | Date_Period \| Time_Period                       | both kinds' dropdown                                    | text box                                            | missing | A union has no tag values.                                                                                                                      |
| date_diff                                                                                       | end                                 | Date_Time                                        | date-time picker                                        | text box                                            | missing | Needs the new picker.                                                                                                                           |
| date_diff · date_add                                                                            | period                              | Date_Period \| Time_Period                       | both kinds' dropdown                                    | text box                                            | missing |                                                                                                                                                 |
| date_add                                                                                        | amount                              | Integer                                          | number                                                  | number                                              | works   |                                                                                                                                                 |
| + · -                                                                                           | amount                              | Duration \| Period \| Time_Period \| Date_Period | both kinds, `Period.new`, `Duration.new`                | text box                                            | missing |                                                                                                                                                 |
| add_work_days                                                                                   | days · holidays                     | Integer · Vector Date (untyped)                  | number · list of date pickers                           | number · text box                                   | missing | Untyped, so no element type.                                                                                                                    |
| format                                                                                          | format                              | Date_Time_Formatter                              | format dropdown                                         | format dropdown                                     | works   | Return `Any`.                                                                                                                                   |
| > · >= · < · <=                                                                                 | that                                | (untyped)                                        | —                                                       | text box                                            | n/a     | Stays untyped (#797).                                                                                                                           |

Hidden (`private: true`): `to_js_object`, `to_display_text`, `pretty`,
`Date_Time.from`. (`enso_epoch_start` is not hidden. The type's own doc block is
also `private: true`.)

#### After

Taken from the code, the stdlib tests and the IDE's widget rules
(`app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`), with
`Date_Time.enso` and its API snapshot as of the Task 3 commit. The running IDE
was not used: that check is left to the installer hand test.

| Function                      | Argument        | Type (declared)                                  | Widget                                                                               | Result | Note                                                                                     |
| ----------------------------- | --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------- |
| week_of_year                  | locale          | Locale \| Nothing                                | locale dropdown (`@locale Locale.default_widget`)                                    | works  | Typed now, as Date.                                                                      |
| first_of_month · end_of_month | —               | —                                                | —                                                                                    | n/a    | Return `Date` in the snapshot.                                                           |
| start_of · end_of             | period          | Date_Period \| Time_Period                       | dropdown of both kinds (`@period make_date_time_period_selector`)                    | works  | Whole names (`Date_Period.Week`), so each entry resolves.                                |
| at_time_zone · set_time_zone  | zone            | Time_Zone                                        | zone dropdown                                                                        | works  | Typed now; the catalogue says `Time_Zone`, not `Any`.                                    |
| date_part                     | period          | Date_Period \| Time_Period                       | dropdown of both kinds                                                               | works  |                                                                                          |
| date_diff                     | end             | Date_Time                                        | date-time picker (`WidgetDateTime`, from this branch)                                | works  | Checked again by the picker's own tasks.                                                 |
| date_diff · date_add          | period          | Date_Period \| Time_Period                       | dropdown of both kinds                                                               | works  |                                                                                          |
| date_add                      | amount          | Integer                                          | number                                                                               | works  | Unchanged.                                                                               |
| + · -                         | amount          | Duration \| Period \| Time_Period \| Date_Period | dropdown of both kinds, plus `Period.new` and `Duration.new` (`include_custom=True`) | works  | The two custom entries are written `(Period.new)` and `(Duration.new)` for an amount.    |
| add_work_days                 | days · holidays | Integer · Vector Date                            | number · list of date pickers                                                        | works  | The typed `Vector Date` gives its items the date picker (#800); no annotation is needed. |
| > · >= · < · <=               | that            | (untyped)                                        | —                                                                                    | n/a    | Still untyped (#797).                                                                    |

Every other row of the table above is unchanged.
