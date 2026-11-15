# Date widget

The owner's ask from the Date widget assessment (2026-11-15, in
`2026-11-15-function-documentation-style-design.md`'s appendix): `until`,
`days_until` and `work_days_until` show a plain text box for `end`, and
`holidays` has no way to enter dates. "Let's include creating a date picker
widget — it should let you choose today, yesterday, tomorrow or a specific date.
We can then use that more widely."

## Decisions (the owner's, 2026-11-15)

- **Relative dates write the short methods.** Today, Yesterday and Tomorrow
  write `Date.today`, `Date.yesterday` and `Date.tomorrow` (the last two are new
  in `Standard.Base`; the earlier `Date.today.previous` and `Date.today.next`
  are not recognised). A specific date writes `Date.new 2020 1 15`.
- **One chip.** An argument holding one of these shows as a single chip with the
  date's label (`Today`, `Yesterday`, `Tomorrow`, or `2020-01-15`), not as
  `Date.new` with three number fields. Clicking it opens a menu: Today,
  Yesterday, Tomorrow, a divider, then a month calendar.

## Behaviour

- **Where it appears.** On any argument whose expected type is
  `Standard.Base.Data.Time.Date.Date` (the argument's `reprType` or the input's
  `expectedType`), and on any expression of one of the four shapes above that is
  an argument, an operand that is not a call target, or a vector item. **A whole
  node is never a chip:** `date1 = Date.new 2020 1 15` keeps `WidgetFunction`'s
  year, month and day fields, whose ports an edge can be connected to. Typed
  `Date` arguments get it with no `@` annotation in the library.
- **Placeholder.** An unset argument shows the chip as `Pick a date` (the
  argument name shown as other widgets show it). When its default is one of the
  shapes, the chip is dimmed and has the default's label; when it is anything
  else (`Nothing`), that code shows dimmed after `Pick a date`, as other widgets
  show a default.
- **Parentheses.** A specific date is written as `(Date.new 2020 1 15)` where it
  becomes an argument or an operand. The rule looks at the AST the port names,
  not at the value: a value inside a group is reached through the group's port,
  and the write replaces the group, so it must bring its own parentheses. Only a
  node's expression and a vector item are written bare.
- **Accessibility.** The chip's name is `argument: label`, e.g.
  `end: 2020-01-15`.
- **Other values.** A connected port, a variable (`date1`) or any other
  expression is left to the widgets that show it today; the date widget scores
  `Mismatch` for it, except that an empty (placeholder) argument of Date type
  still gets the chip.
- **The calendar** opens on the chip's current date (today for a relative or
  unset value), marks today, and is navigable by keyboard (arrows, Enter,
  Escape) as the dashboard's `DatePicker` is. Choosing a day writes
  `Date.new y m d` and closes the menu. Choosing the day that is already chosen
  closes it without an edit. It spans years 100 to 9999, the range the chip
  recognises.
- **Imports.** `Date` is exported by `Standard.Base`'s main module; the widget
  adds the import if missing, as `WidgetCheckbox` does for `True`.
- **Inside a vector editor.** An item whose expected type is `Date` gets the
  same chip, so `holidays : Vector Date` with a `Widget.Vector_Editor` whose
  `item_default` is `Date.today` gives a list of date chips (the Date PR adds
  that annotation).
- **Undo.** One choice is one undo step.

## Time_Of_Day (same PR, after the date chip)

The owner, 2026-11-15: `to_date_time`'s `time_of_day` "should have a time
picker", done "similarly for Time_Of_Day — I don't think it needs as many
prebuilt special cases".

- **Where it appears.** The same rule keyed to
  `Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day`: every argument of that
  type, and the expressions it writes, wherever they appear.
- **Shapes.** `Time_Of_Day.now` (label `Now`) and
  `Time_Of_Day.new <h> <m> [<s>]` with integer literals (label `14:30`, or
  `14:30:15` when seconds are set). `Time_Of_Day.new` and `Time_Of_Day.new 14`
  are left to `WidgetFunction`: a chip would hide the placeholders of the
  arguments left out, and read `00:00` for a call nobody has filled in. As for
  dates, a whole node is never a chip (`Time_Of_Day.now` and
  `Time_Of_Day.new 14 30` nodes keep their fields).
- **The menu** has one shortcut, `Now`, then a time field (hours and minutes,
  seconds optional), keyboard-editable like the dashboard's date segments.
  Setting the field writes `Time_Of_Day.new 14 30`, adding seconds only when
  they are not zero. Enter in the field, moving focus out of it, or a click
  outside the menu writes the time if it was edited and is complete; Escape and
  clicking the chip again discard the edit. A segment that was cleared makes the
  time incomplete, and nothing is written until it is filled in again. Enter on
  `Add seconds` toggles the seconds.

## Out of scope (follow-up tickets)

- A `Date_Time` picker (the date chip and the time field together).
- Replacing `Date.default_widget` (`<Fixed Date>` / `<Today>`) in the library:
  only `Standard.Google` uses it; the Date PR or a follow-up switches it.
- The numeric widget's barely visible slider (the assessment's `month` note).

## Testing

- Unit: the expression ↔ label mapping (each shape, malformed `Date.new`
  arguments, non-literal arguments → not ours); the matcher's score for each
  shape, a typed placeholder, and a non-date expression.
- Component: choosing Today, Yesterday, Tomorrow and a calendar day each writes
  the expected code; keyboard opens, navigates and closes the calendar.
- Playwright (`integration-test/project-view/widgets.spec.ts`): a Date-typed
  argument in the mock suggestion database shows the chip, and a calendar choice
  updates the node's code.
- Screenshots on the PR (before: text box; after: chip, open menu).
