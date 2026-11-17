# widgets/

Per-node widget tree for the graph editor. Each `Widget*.vue` is a Vue SFC plus
a `widgetDefinition` exported from a sibling `<script lang="ts">` block. The
registry walks the node's AST and picks one widget per subexpression.

## Selection — `defineWidget`

A widget definition declares:

- A **matcher** — `WidgetInput.astMatcher(Ast.X)`, a `Symbol` on `WidgetInput`,
  or a custom type guard. Inputs that fail the matcher are never scored.
- A **priority** — **smaller wins**. The registry sorts ascending and
  short-circuits on the first `Score.Perfect`. So priority 1 beats priority 2.
- A **score** — `Score.Mismatch | Weak | Good | Perfect`. `Mismatch` rules the
  widget out even if the matcher passed. `Perfect` lets the registry stop
  scanning lower-priority candidates.

See `app/gui/src/providers/openedProjects/widgetRegistry/widgetRegistry.ts`.

When a widget renders `<NodeWidget :input="props.input" />` over its own input,
the registry is re-run with that widget added to `alreadyUsed`, so it won't
match itself recursively. That's how `WidgetIcon` wraps a child widget around
its glyph without infinite recursion.

## Icon rendering — render once, at the right layer

The node's category icon is the responsibility of **one** widget per row. Don't
draw a second icon from a downstream widget — that's the bug `WidgetAiPrompt`
was originally guilty of.

Two paths land an icon in the row:

- **Method calls** (`subject.method args …`): `WidgetSelfAccessChain` matches
  the outer `PropertyAccess`, computes the displayed icon from the call's `lhs`,
  and attaches `DisplayIcon` to that `lhs`'s widget input. The icon appears
  where the subject would have rendered.
- **Static calls** — `Main.<name> args …`, `Data.read …`, any application whose
  subject is a Type/constructor: `tree.primaryApplication.function` is `null`,
  because the AST's outer `App` function is the whole property access (the
  resolver folds the type subject into the method identity). In that case
  `ComponentWidgetTree.vue` attaches `DisplayIcon` to the **root** input, and
  `WidgetIcon` renders the glyph + recurses into the same input via
  `<NodeWidget>` for the rest of the row.

So a custom widget that occupies the function-token slot of a static call (e.g.
`WidgetAiPrompt` for AI nodes) must render only its own slot content. The icon
is already on the row, drawn by `WidgetIcon` at the root.

## File layout

- `Widget*.vue` — leaf widgets registered with `defineWidget`.
- `Widget*/` — folder beside a widget for its helper modules (no enforced
  pattern beyond colocation).
- `WidgetIcon.vue` — owns the `DisplayIcon` symbol. Other widgets attach to it
  via `input[DisplayIcon] = { icon, showContents?, noGap? }` to request an
  inline icon in front of a child widget.
- `WidgetDate.vue` — a dropdown wrapper for a `Date`-typed input (the argument's
  `reprType` or the input's `expectedType`, vector items included; nothing else
  untyped) and for a whole node that is `Date.today`/`yesterday`/`tomorrow` or
  `Date.new` with any arguments (`WidgetPicker/wholeNode.ts`: a node root,
  parentheses skipped; not a call's target such as `Date.today.add_days 3`'s).
  It scores `Mismatch` where `WidgetSelection` already draws a dropdown
  (`hasDropdown`, exported from it), so there are never two arrows. It renders
  `<NodeWidget>` over its own input, so the argument shows its real code
  (`Date.today`, or `Date.new` with `year`, `month` and `day` ports), plus a
  `SelectionArrow` under it; the arrow opens a menu (`WidgetDate/DateMenu.vue`:
  `Date.today`, `Date.yesterday`, `Date.tomorrow`, which write at once, then the
  Reka calendar of `WidgetDate/DateCalendar.vue` and Cancel and Set: a day click
  only selects the day, Set or Enter on a day writes it, a click outside writes
  only a changed day, and Cancel and Escape write nothing) that **replaces the
  whole value** in one `module.edit` (the import goes in the same edit).
  Priority 51, after `WidgetSelection` (50), so an argument with its own `@`
  dropdown keeps it, and before `WidgetArgumentName`, which draws the name
  inside it. `WidgetDate/dateExpression.ts` is the framework-free expression <->
  choice mapping. A specific date is written parenthesised
  (`(Date.new 2020 1 15)`) wherever it becomes an argument: an unparenthesised
  application written as a string splits into one group per argument. The
  decision is made on the AST the _port_ names
  (`parenthesisedApplication(code, value, portId)`), not on the value's parent:
  `WidgetGroup` hands its inner expression on with the Group's port, so the
  write replaces the parentheses too. Only a node's expression and a vector item
  are written bare. The menu opens on the current value through
  `unparenthesisedCode`. Design:
  `docs/superpowers/specs/2026-11-15-date-widget-design.md`.
- `WidgetTimeOfDay.vue` — the same for a `Time_Of_Day`-typed input (priority 52;
  `Time_Of_Day.now`, or `Time_Of_Day.new` with `hour`, `minute` and `second`
  ports). Its menu (`WidgetTimeOfDay/TimeOfDayMenu.vue`) is `Time_Of_Day.now`,
  the time part of `WidgetTimeOfDay/TimeField.vue` (shared with the Date_Time
  menu): a Reka `TimeField` (hours and minutes, seconds on request, written only
  when not zero) over scrollable columns of hours and minutes (and seconds) to
  pick from (`WidgetTimeOfDay/TimeColumns.vue`, a plain `HourMinuteSecond`
  v-model), and then Cancel and Set (`WidgetPicker/PickerActions.vue`, shared
  too). The field and the columns show one draft: a pick in a column writes
  nothing and leaves the focus in the field; typing scrolls the columns to the
  value. It reads any `Time_Of_Day.new` of integer literals, positional or
  named, a missing part being 0 (a bare `Time_Of_Day.new`; `Time_Of_Day.new 14`,
  which typing an hour into the unset `hour` writes, since `WidgetFunction`
  inserts the first trailing placeholder positionally; `hour=14`; `second=15` as
  the `…` menu and `pretty` write it); an edit writes hour, minute and second
  positionally and keeps the millisecond, microsecond and nanosecond as they
  were written (`withKeptParts`). Set writes the draft (or only closes when it
  is the time already written); Enter in the field, leaving it or a click
  outside the menu writes it only if it was edited (the shell calls the handler
  the menu registers with `setAccept` before it ends the interaction); Cancel,
  Escape and the arrow's toggle do not. A cleared segment blocks the write until
  it is filled in. `timeExpression.ts` is the mapping. The wrapper, its floating
  menu and the interaction are `WidgetPicker/PickerShell.vue`, the menu frame is
  `WidgetPicker/PickerMenuFrame.vue` and the parenthesising rule is
  `WidgetPicker/parentheses.ts`, all shared with `WidgetDate`. **The menu is
  positioned by `pickerMenuStyles`** (`WidgetSelection/styles.ts`): left edges
  lined up under the argument, kept there by `autoUpdate`, and shifted only by
  the screen's edge. `activityDropdownStyles` also shifts a dropdown to stay
  within the node, which pushed a menu wider than the rest of the node off its
  argument (by 160 px for an unset argument at a node's end). **Every picker
  menu is a fixed width** (200 px, set on `PickerMenuFrame`; the Date_Time menu
  sets its own 380 px through `--picker-menu-width`): the activity dropdowns'
  `size` middleware also set the menu's `min-width` to its anchor's, so a menu
  on a whole node grew with the node; `pickerMenuStyles` must not add one back.
  **The menu is open only when the widget asked for it** (`menuOpen`): editing a
  nested number makes the widget's interaction active too (as it does for
  `WidgetSelection`, which then opens its list), and must not show the menu. A
  nested number's `@click.stop` keeps its clicks from toggling it. **At a node
  root the first click is the node's**: `PickerShell` stops the click and
  toggles the menu only when the node is already selected
  (`.GraphNode.selected`) and no modifier is held; otherwise the click bubbles
  so the node selects (or, with Ctrl/Cmd, edits). `WidgetTimeOfDay` likewise
  takes `Time_Of_Day.now`/`new` whole nodes.
- `WidgetDateTime.vue` — the same for a `Date_Time`-typed input or item, and a
  whole node that is `Date_Time.now` or `Date_Time.new` (priority 53). Its menu
  (`WidgetDateTime/DateTimeMenu.vue`) is `Date_Time.now`, then side by side the
  date menu's calendar (`WidgetDate/DateCalendar.vue`) and the time menu's field
  and columns (`WidgetTimeOfDay/TimeField.vue` with `fill`, hours and minutes,
  seconds on request and shown when the value has a second, its columns as tall
  as the calendar), then Cancel and Set across the bottom. `Date_Time.now`
  writes at once; a day click and a column click only select; Set writes the
  selected day at the field's time as `Date_Time.new y m d h mi` (with `s` when
  seconds are shown and not zero); Enter in the field, leaving the menu or a
  click outside writes only a changed day or time; Cancel and Escape write
  nothing. `dateTimeExpression.ts` reads the arguments from the AST: year and
  any of month … second, positional or named (`Date_Time.new 2026 11 17 14` is
  14:00, so the menu opens on it), the missing ones taking `Date_Time.new`'s
  defaults; an edit keeps everything after the second as written (the finer
  parts and `zone`), writing the second positionally when a kept argument
  follows it positionally, and the picker never writes a zone. A new item of a
  `Vector Date_Time` starts as `Date_Time.now`.
- `WidgetFileBrowser.vue` — a file, folder or `Enso_Secret` argument's dropdown:
  `WidgetFileBrowser/localBrowser.ts` (the native file dialog),
  `localSecrets.ts` (the local secrets and **New secret…**, which set
  `Enso_Secret.get 'secret://<name>'`), and `browsableTypes.ts` (which kind an
  argument takes, its current path, and the edit that sets one).
- `WidgetFunction/formatForPath.ts` — with `format` on `Auto_Detect`, which
  format library a call's new `path` needs: the one format type whose options'
  `patterns` match the file name (case ignored). `WidgetFunction.vue`'s
  `handleArgUpdate` adds its import in the update's edit; it is the one handler
  that sees every argument's update and every sibling's widget configuration
  (#489). A dropdown option's own `requires` is applied by
  `WidgetSelection/tags.ts`. A file dropped on the graph (`GraphEditor.vue`'s
  `uploadedFormatImports`) has no node of its own: it uses the `format` options
  that a `path`-and-`format` node holds right now (`trackFormatConfig`, which
  `WidgetFunction.vue` calls and withdraws when the node or its configuration
  goes, so nothing outlives its node, an engine restart or a project switch),
  and otherwise asks the engine (`DATA_READ_FORMAT_WIDGET_QUERY`, in the current
  method's body context, 1 s timeout, so the node creation waits at most that
  long and one undo still removes node and import); `formatTypeForDrop` does
  both. The import goes in the node creation's edit.

## Argument access

- The `…` after a call's arguments (`WidgetFunction/ParameterMenu.vue`; which
  parameters it offers: `WidgetFunction/hiddenParameters.ts`) adds a parameter
  the call is not showing, always written as a named argument. The button hides
  while it is the only selected node, unless its menu is open.
- `WidgetPort` marks an argument that can be popped out with `data-pop-out-port`
  (plus `data-pop-out-name` and `data-pop-out-type`); dragging it off the node
  makes it a node of its own. The drag and the edit are in `../popOut/` - see
  `../popOut/CLAUDE.md`. Inputs that handle `pointerdown` themselves (number,
  text, slider) do not start a pop out.
