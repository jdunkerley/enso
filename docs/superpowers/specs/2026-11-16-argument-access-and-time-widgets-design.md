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
- `+`/`-`: a dropdown of each `Time_Period` plus `Duration.new` for a custom
  amount (like Date's `make_period_selector` with `Period.new`).
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

- `first_of_month`/`end_of_month`: declared `Integer`, return a `Date_Time`.
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

(Filled in by part C's first task.)

### Date_Time — before

(Filled in by part D's first task.)
