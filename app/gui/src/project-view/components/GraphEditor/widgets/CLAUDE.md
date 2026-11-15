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
- `WidgetDate.vue` — a chip (`Today`, `Yesterday`, `Tomorrow`, `2020-01-15`, or
  `Pick a date`) for a `Date`-typed argument or item and for the four shapes
  `Date.today`, `Date.yesterday`, `Date.tomorrow` and `Date.new <y> <m> <d>`,
  with a menu (`WidgetDate/DateMenu.vue`: the three relative days, then a Reka
  calendar). Priority 140: after `WidgetArgumentName`, before `WidgetFunction`;
  its comment explains it. `WidgetDate/dateExpression.ts` is the framework-free
  expression <-> label mapping. **A whole node is never a chip**
  (`date1 = Date.new 2020 1 15` keeps `WidgetFunction`'s fields, whose ports an
  edge can reach): `isPickableShape` scores `Mismatch` for a shape that is a
  node's expression. A specific date is written parenthesised
  (`(Date.new 2020 1 15)`) wherever it becomes an argument: an unparenthesised
  application written as a string splits into one group per argument. The
  decision is made on the AST the _port_ names
  (`parenthesisedApplication(code, value, portId)`), not on the value's parent:
  `WidgetGroup` hands the chip its inner expression with the Group's port, so
  the write replaces the parentheses too. Only a node's expression and a vector
  item are written bare. An unset argument whose default is a shape shows the
  chip dimmed with the default's label; any other default shows after
  `Pick a date`, dimmed. The chip's accessible name is `name: label`. Design:
  `docs/superpowers/specs/2026-11-15-date-widget-design.md`.
- `WidgetTimeOfDay.vue` — the same chip for a `Time_Of_Day`-typed argument or
  item and for `Time_Of_Day.now` (`Now`) and `Time_Of_Day.new` with 2 or 3
  integer literals (`14:30`, `14:30:15`, or `Pick a time`); `Time_Of_Day.new`
  and `Time_Of_Day.new 14` stay `WidgetFunction`'s, as a chip would hide the
  placeholders of the arguments left out. Its menu
  (`WidgetTimeOfDay/TimeOfDayMenu.vue`) is `Now` and a Reka `TimeField` (hours
  and minutes, seconds on request, written only when not zero): Enter in the
  field, leaving it or a click outside the menu writes it (the shell calls the
  handler the menu registers with `setAccept` before it ends the interaction),
  Escape and the chip's toggle do not. A cleared segment blocks the write until
  it is filled in. `timeExpression.ts` is the mapping. The chip, its floating
  menu and the interaction are `WidgetChip/ChipMenuShell.vue`, the menu frame is
  `WidgetChip/ChipMenuFrame.vue` and the "is this a value to pick" and
  parenthesising rules are `WidgetChip/shape.ts`, all shared with `WidgetDate`.
  Same priority (140) and rules.
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
