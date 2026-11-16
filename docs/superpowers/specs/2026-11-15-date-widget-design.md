# Date widget

The owner's ask from the Date widget assessment (2026-11-15, in
`2026-11-15-function-documentation-style-design.md`'s appendix): `until`,
`days_until` and `work_days_until` show a plain text box for `end`, and
`holidays` has no way to enter dates. "Let's include creating a date picker
widget — it should let you choose today, yesterday, tomorrow or a specific date.
We can then use that more widely."

## Decisions (the owner's, 2026-11-15; revised 2026-11-16)

**Revised 2026-11-16, after testing: the widget is a dropdown wrapper, not a
chip.** Where the text below says "chip", read the design in this paragraph. The
argument shows its real code through the ordinary widgets: `Date.today` and
`Date.yesterday` as that code (no `Today` or `Yesterday` labels), and
`Date.new 2020 1 15` as `Date.new` with `year`, `month` and `day` fields that
are ports (an edge can be connected to them, and the numbers edit in place), as
`WidgetFunction` draws it. A selection arrow under the argument (the one the
dropdown arguments have) opens the menu, which **replaces the whole value**;
dropping an edge on the argument replaces it too. Clicking a field of a written
date edits the number and does not open the menu. The menu items are labelled
with the code they write (`Date.today`, `Date.yesterday`, `Date.tomorrow`,
`Time_Of_Day.now`). The widget applies **only** to inputs typed `Date` or
`Time_Of_Day` (the argument's `reprType` or the input's `expectedType`),
including vector items of that type; an untyped `Date.new ...` anywhere is drawn
as on any other expression, and a whole node, which has no expected type, is
never affected. It is `WidgetDate` (priority 51) and `WidgetTimeOfDay` (52),
after `WidgetSelection` (50), so an argument with its own `@` dropdown keeps
that, and before the argument name and the function widgets, which draw the
argument as they do under any dropdown. The shared shell is
`WidgetPicker/PickerShell.vue`.

- **Relative dates write the short methods.** Today, Yesterday and Tomorrow
  write `Date.today`, `Date.yesterday` and `Date.tomorrow` (the last two are new
  in `Standard.Base`; the earlier `Date.today.previous` and `Date.today.next`
  are not recognised). A specific date writes `Date.new 2020 1 15`.
- **A dropdown, not a chip.** (Replaced 2026-11-16, see above; the first design
  was a single chip with the date's label.) The menu is `Date.today`,
  `Date.yesterday`, `Date.tomorrow`, a divider, then a month calendar.

## Behaviour

- **Where it appears.** On any input whose expected type is
  `Standard.Base.Data.Time.Date.Date` (the argument's `reprType` or the input's
  `expectedType`), whatever it holds, and on a vector item of that type. Not on
  an untyped expression, and never on a whole node. Typed `Date` arguments get
  it with no `@` annotation in the library.
- **Placeholder.** An unset argument shows the argument name and the arrow, as
  other dropdown arguments do; its default shows as the other widgets show it.
- **Parentheses.** A specific date is written as `(Date.new 2020 1 15)` where it
  becomes an argument or an operand. The rule looks at the AST the port names,
  not at the value: a value inside a group is reached through the group's port,
  and the write replaces the group, so it must bring its own parentheses. Only a
  node's expression and a vector item are written bare.
- **Other values.** A connected port, a variable (`date1`) or any other
  expression in a Date-typed argument is drawn by the widgets that show it
  today, with the arrow under it; a choice replaces it.
- **The calendar** opens on the current `Date.new` value (today for any other
  value), marks today, and is navigable by keyboard (arrows, Enter, Escape) as
  the dashboard's `DatePicker` is. Choosing a day writes `Date.new y m d` and
  closes the menu. Choosing the day that is already chosen closes it without an
  edit. It spans years 100 to 9999, the range the widget recognises.
- **Imports.** `Date` is exported by `Standard.Base`'s main module; the widget
  adds the import if missing, as `WidgetCheckbox` does for `True`.
- **Inside a vector editor.** An item whose expected type is `Date` gets the
  same arrow and menu, so `holidays : Vector Date` with a `Widget.Vector_Editor`
  whose `item_default` is `Date.today` gives a list of dates (the Date PR adds
  that annotation).
- **Undo.** One choice is one undo step.

## Time_Of_Day (same PR, after the date widget)

The owner, 2026-11-15: `to_date_time`'s `time_of_day` "should have a time
picker", done "similarly for Time_Of_Day — I don't think it needs as many
prebuilt special cases".

- **Where it appears.** The same rule keyed to
  `Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day`: every input of that type.
  `Time_Of_Day.now` is shown as that code, and `Time_Of_Day.new 14 30` as
  `Time_Of_Day.new` with `hour` and `minute` (and `second`) fields.
- **The menu** has one shortcut, `Time_Of_Day.now`, then a time field (hours and
  minutes, seconds optional), keyboard-editable like the dashboard's date
  segments. Setting the field writes `Time_Of_Day.new 14 30`, adding seconds
  only when they are not zero. Enter in the field, moving focus out of it, or a
  click outside the menu writes the time if it was edited and is complete;
  Escape and clicking the arrow again discard the edit. A segment that was
  cleared makes the time incomplete, and nothing is written until it is filled
  in again. Enter on `Add seconds` toggles the seconds.

## Out of scope (follow-up tickets)

- A `Date_Time` picker (the calendar and the time field together).
- Replacing `Date.default_widget` (`<Fixed Date>` / `<Today>`) in the library:
  only `Standard.Google` uses it; the Date PR or a follow-up switches it.
- The numeric widget's barely visible slider (the assessment's `month` note).

## Testing

- Unit: the expression <-> choice mapping (each shape, malformed `Date.new`
  arguments, non-literal arguments -> not ours); the widgets' score (typed
  inputs only, never an untyped shape) and priority; the parenthesising rule.
- Component: choosing `Date.today`, `Date.yesterday`, `Date.tomorrow` and a
  calendar day each writes the expected code; keyboard opens, navigates and
  closes the calendar.
- Playwright (`integration-test/project-view/widgets.spec.ts`): a Date-typed
  argument in the mock suggestion database has the arrow, a choice writes its
  code, a written `Date.new` shows number fields, and editing one does not open
  the menu.
- Screenshots on the PR (before: text box; after: arrow, open menu).
