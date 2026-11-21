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
draw a second icon from a downstream widget.

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

So a custom widget that occupies the function-token slot of a static call must
render only its own slot content. The icon is already on the row, drawn by
`WidgetIcon` at the root.

## File layout

- `Widget*.vue` — leaf widgets registered with `defineWidget`.
- `Widget*/` — folder beside a widget for its helper modules (no enforced
  pattern beyond colocation).
- `WidgetIcon.vue` — owns the `DisplayIcon` symbol. Other widgets attach to it
  via `input[DisplayIcon] = { icon, showContents?, noGap? }` to request an
  inline icon in front of a child widget.
- **Widgets choose on the configuration, not the declared type.** An argument's
  configuration (`WidgetInput.dynamicConfig`) is chosen in this order: (1) its
  own `@` annotation, or one inherited from the parent (a choice's constructor
  argument, a vector's items); (2) otherwise its type's default widget, asked of
  the engine by `TypeDefaults`
  (`providers/openedProjects/widgetRegistry/typeDefaults.ts`:
  `Widget_Query.resolve_type`, once per type per session, cached; the answer is
  marked `isTypeDefault`); (3) with neither, literals and an argument's
  `tagValues` decide. The Date, Time_Of_Day, Date_Time, Boolean, number and text
  widgets score on the configuration's `kind` (`Date_Input`, `Time_Input`,
  `Date_Time_Input`, `Boolean_Input`, `Numeric_Input`, `Text_Input`), never on
  `expectedType` or `reprType`; the exceptions are `WidgetFileBrowser`'s
  transitional rule (it also matches a declared type that contains `File`,
  `Writable_File` or `Enso_Secret`, and its behaviour logic reads the type) and
  `WidgetVector` (a bare `Vector`). Rulings to keep in mind:
  - **Until PR 4, an argument's own `tagValues` win over a type default**,
    decided by origin (`isTypeDefault`), not by kind: an explicit annotation
    beats `tagValues`, a type default does not (`WidgetSelection`). This is
    today's behaviour, kept on purpose; a departure from the spec's literal
    order.
  - **Union types use the first member that is not `Nothing`**
    (`Integer | Nothing` asks about `Integer`; `Text | <constructors>` asks
    about `Text`). This is interim, until PR 4 replaces it.
  - **A type default claims only an unset argument or a literal of its own
    kind** (R8). A reference or connection, `_`, `Nothing`, a vector, a
    parenthesised group or a literal of another kind keeps the widget that draws
    it (an `Integer`-first union holding a text literal shows the text input).
    The number widget, `isBooleanArgument` and the date, time and date-time
    pickers (`pickerClaimsInput` in `WidgetPicker/wholeNode.ts`) check this;
    `WidgetText`'s matcher already admits only placeholders and text literals,
    and `WidgetFileBrowser` keeps its transitional type rule (it claimed any
    value of a browsable type before). An annotation's configuration keeps
    claiming whatever the argument holds.
  - **A type default does not set the browse mode** (R9): `useBrowserTypeInfo`
    treats it as no configuration, so the declared type decides and a
    `File | Enso_Secret` union offers both.
  - **A query runs in an executed frame**: the caller's expression when it has a
    computed value, otherwise any computed node of the graph shown
    (`graph.db.nodeIds()`; the answer does not depend on the frame). Failed or
    stale frames back off and are retried choosing a frame again. Until some
    frame executes, an un-annotated argument shows no widget; the first
    appearance of a type costs one round trip.
- `WidgetDate.vue` — a dropdown wrapper for an input configured `Date_Input`
  (vector items included) and for a whole node that is
  `Date.today`/`yesterday`/`tomorrow` or `Date.new` with any arguments
  (`WidgetPicker/wholeNode.ts`: a node root, parentheses skipped; not a call's
  target such as `Date.today.add_days 3`'s). It scores `Mismatch` where
  `WidgetSelection` already draws a dropdown (`hasDropdown`, exported from it),
  so there are never two arrows. It renders `<NodeWidget>` over its own input,
  so the argument shows its real code (`Date.today`, or `Date.new` with `year`,
  `month` and `day` ports), plus a `SelectionArrow` under it; the arrow opens a
  menu (`WidgetDate/DateMenu.vue`: `Date.today`, `Date.yesterday`,
  `Date.tomorrow`, which write at once, then the Reka calendar of
  `WidgetDate/DateCalendar.vue` and Cancel and Set: a day click only selects the
  day, Set or Enter on a day writes it, a click outside writes only a changed
  day, and Cancel and Escape write nothing) that **replaces the whole value** in
  one `module.edit` (the import goes in the same edit). Priority 51, after
  `WidgetSelection` (50), so an argument with its own `@` dropdown keeps it, and
  before `WidgetArgumentName`, which draws the name inside it.
  `WidgetDate/dateExpression.ts` is the framework-free expression <-> choice
  mapping. A specific date is written parenthesised (`(Date.new 2020 1 15)`)
  wherever it becomes an argument: an unparenthesised application written as a
  string splits into one group per argument. The decision is made on the AST the
  _port_ names (`parenthesisedApplication(code, value, portId)`), not on the
  value's parent: `WidgetGroup` hands its inner expression on with the Group's
  port, so the write replaces the parentheses too. Only a node's expression and
  a vector item are written bare. The menu opens on the current value through
  `unparenthesisedCode`. Design:
  `docs/superpowers/specs/2026-11-15-date-widget-design.md`.
- `WidgetTimeOfDay.vue` — the same for an input configured `Time_Input`
  (priority 52; `Time_Of_Day.now`, or `Time_Of_Day.new` with `hour`, `minute`
  and `second` ports). Its menu (`WidgetTimeOfDay/TimeOfDayMenu.vue`) is
  `Time_Of_Day.now`, the time part of `WidgetTimeOfDay/TimeField.vue` (shared
  with the Date_Time menu): a Reka `TimeField` (hours and minutes, seconds on
  request, written only when not zero) over scrollable columns of hours and
  minutes (and seconds) to pick from (`WidgetTimeOfDay/TimeColumns.vue`, a plain
  `HourMinuteSecond` v-model), and then Cancel and Set
  (`WidgetPicker/PickerActions.vue`, shared too). The field and the columns show
  one draft: a pick in a column writes nothing and leaves the focus in the
  field; typing scrolls the columns to the value. It reads any `Time_Of_Day.new`
  of integer literals, positional or named, a missing part being 0 (a bare
  `Time_Of_Day.new`; `Time_Of_Day.new 14`, which typing an hour into the unset
  `hour` writes, since `WidgetFunction` inserts the first trailing placeholder
  positionally; `hour=14`; `second=15` as the ＋ menu and `pretty` write it); an
  edit writes hour, minute and second positionally and keeps the millisecond,
  microsecond and nanosecond as they were written (`withKeptParts`). Set writes
  the draft (or only closes when it is the time already written); Enter in the
  field, leaving it or a click outside the menu writes it only if it was edited
  (the shell calls the handler the menu registers with `setAccept` before it
  ends the interaction); Cancel, Escape and the arrow's toggle do not. A cleared
  segment blocks the write until it is filled in. `timeExpression.ts` is the
  mapping. The wrapper, its floating menu and the interaction are
  `WidgetPicker/PickerShell.vue`, the menu frame is
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
- `WidgetDateTime.vue` — the same for an input or item configured
  `Date_Time_Input`, and a whole node that is `Date_Time.now` or `Date_Time.new`
  (priority 53). Its menu (`WidgetDateTime/DateTimeMenu.vue`) is
  `Date_Time.now`, then side by side the date menu's calendar
  (`WidgetDate/DateCalendar.vue`) and the time menu's field and columns
  (`WidgetTimeOfDay/TimeField.vue` with `fill`, hours and minutes, seconds on
  request and shown when the value has a second, its columns as tall as the
  calendar), then Cancel and Set across the bottom. `Date_Time.now` writes at
  once; a day click and a column click only select; Set writes the selected day
  at the field's time as `Date_Time.new y m d h mi` (with `s` when seconds are
  shown and not zero); Enter in the field, leaving the menu or a click outside
  writes only a changed day or time; Cancel and Escape write nothing.
  `dateTimeExpression.ts` reads the arguments from the AST: year and any of
  month … second, positional or named (`Date_Time.new 2026 11 17 14` is 14:00,
  so the menu opens on it), the missing ones taking `Date_Time.new`'s defaults;
  an edit keeps everything after the second as written (the finer parts and
  `zone`), writing the second positionally when a kept argument follows it
  positionally, and the picker never writes a zone. A new item of a
  `Vector Date_Time` starts as `Date_Time.now`.
- `WidgetBoolean.vue` — a Boolean: a checkbox that flips it, then its code (an
  unset argument's default greyed), drawn after the argument name (priority
  101). The ▾ is `WidgetSelection`'s: it lists `True` and `False`, with their
  imports, for every Boolean argument (`WidgetBoolean/booleanValue.ts`'s
  `isBooleanArgument`: `True`/`False` tag values, a `Boolean_Input`
  configuration (the Boolean type default, which claims only an unset argument
  or a literal), or a literal value; never an infix operator's operand, though
  the call tree gives it the operator's argument info) that has no `@` dropdown
  of its own. An unset argument's ▾ sits under its greyed default (the widget
  requests the arrow like `WidgetSelectionArrow`). A value that is not a literal
  is left to the other widgets, so it has no checkbox; a literal that is not an
  argument (a whole node, an operand) has the checkbox and no ▾. It replaced
  `WidgetCheckbox`.
- `WidgetFileBrowser.vue` — a file, folder or `Enso_Secret` argument's dropdown:
  `WidgetFileBrowser/localBrowser.ts` (the native file dialog),
  `localSecrets.ts` (the local secrets and **New secret…**, which set
  `Enso_Secret.get 'secret://<name>'`), and `browsableTypes.ts` (which kind an
  argument takes, its current path, and the edit that sets one).
- **Widget queries.** `WidgetFunction/widgetQuery.ts` builds the query of a
  call: a method-pointer visualization of
  `Standard.Base.Metadata.Widget_Query.resolve_call` on the call's subject, with
  literal arguments (the method's module, type and name, the argument names, the
  argument expression ids, and `subjectIsType`), so nothing is compiled in the
  user's module and it needs no import. The answer is
  `{"arguments":[[name, {"widget":…}|{"error":{"step","message"}}],…]}`, read by
  `widgetQueryAnswerSchema`; `functionCallFromAnswer` turns it into the call's
  configuration, and a failed argument lands in `FunctionCall.errors`. An error
  subject (the user's own error) answers no widgets. `WidgetQueryError.vue`
  (priority 2) draws a failed argument: a warning marker with the error as its
  tooltip, then the argument as it is drawn with no answer.
  `WidgetQueryErrorKey` is set on the input only on failure, so every other
  widget is unaffected. Caveat: an unset optional argument whose query failed is
  hidden like any other, so its marker shows only once it is revealed or set;
  the error is in the Logs panel. An answer the IDE cannot read is reported once
  per project, method and issues (`reportWidgetSchemaMismatch`), and the parse
  and render times of an answer are reported when performance timings are on
  (`reportWidgetTiming`; both in `$/providers/engineLogAppend.ts`, called from
  `widgetFunctionCallInfo.ts`).
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
  and otherwise asks the engine (`DATA_READ_FORMAT_WIDGET_QUERY`: an in-frame
  `Standard.Base.Meta.call_module_method` of `resolve_call`
  (`@/util/moduleCall`) whose value is the `Data` module, in the current
  method's body context, 1 s timeout, so the node creation waits at most that
  long and one undo still removes node and import); `formatTypeForDrop` does
  both. The import goes in the node creation's edit.

## Argument access

- Each call with hidden parameters has a round ＋ after its arguments
  (`WidgetFunction/ParameterMenu.vue`; which parameters it offers:
  `WidgetFunction/hiddenParameters.ts`), shown only while the node is the only
  selected one (`showDetails`; the node may grow on selection). Its menu lists
  only that call's parameters; a pick is always written as a named argument. A
  prefix call nested inside another call's argument (`WidgetFunction` under
  another one, with arguments of its own) is drawn as an outlined group
  (`.nestedCall`) with its smaller ＋ inside, after its own last argument; the
  outer call's ＋ ends the node, inside it. An operator call gets the outline
  only when it has hidden parameters. The outline is an inset `box-shadow`,
  never a `border`, so a group is as high as a port at any depth and the node
  stays one line. Selecting a node does not show its hidden arguments, except
  those the method's doc front matter marks `selected`.
- Operator chains (`util/operatorChain.ts`, `chainRole`): a run of operators
  with the same precedence (from the parser, `Ast.binaryOperatorInfo`) is one
  flat row; an operand that is a chain of a different precedence, or one in
  parentheses, is a capsule (`WidgetApplication`'s `.operatorCapsule`, a darker
  tint, port-high, padded only at the sides), and `WidgetGroup` drops the
  parentheses around it. Operators are drawn as written.
- **Display comes from the doc front matter, not the widget.** A method's
  `arguments:` map (`always`, `selected`, `when_modified`; see
  `suggestionDatabase/documentation.ts`, `entry.argumentDisplay`) decides
  whether an argument shows on the collapsed node. An argument with no default
  always shows; otherwise the front matter decides, `when_modified` (shown once
  set, else via ＋) being the default. `ArgumentPlaceholder.isHidden(selected)`
  takes `selected` = the node is the sole selection, so a `selected` argument
  shows while its node is the only one selected and hides again with two
  selected. The ＋ menu never lists a `selected` argument that is currently
  shown. It is known statically, before the engine answers, so an `always`
  argument no longer pops in (a pending widget query does not force it shown)
  and shows even if its widget query fails. Widgets have no `display` or `label`
  (`Choice.Option`'s `label` stays); the engine's `ArgumentDisplayCheck`
  validates the block and `lintEnso` fails the standard library build on it.
- Every argument shows its parameter's name (`WidgetArgumentName`): every prefix
  argument, set or not, positional or named, at any depth. No operand of an
  infix operator shows a name. The argument is drawn as a chip of its own (name,
  small and dim, then the value); a top-level argument with a chip drops the
  separator line before it.
- `WidgetPort` marks an argument that can be popped out with `data-pop-out-port`
  (plus `data-pop-out-name` and `data-pop-out-type`); dragging it off the node
  makes it a node of its own. The drag and the edit are in `../popOut/` - see
  `../popOut/CLAUDE.md`. Inputs that handle `pointerdown` themselves (number,
  text, slider) do not start a pop out.
