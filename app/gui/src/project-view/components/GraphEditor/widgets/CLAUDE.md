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
  behaviour logic (it reads the declared type, not to choose the widget) and
  `WidgetVector` (a bare `Vector`). Rulings to keep in mind:
  - **An argument's own `tagValues` win over a type default**, decided by origin
    (`isTypeDefault`), not by kind: an explicit annotation beats `tagValues`, a
    type default does not (`WidgetSelection`). This is today's behaviour, a
    deliberate departure from the spec's literal order, kept until a follow-up
    decides. The kind picker marks the input it hands its chosen kind's widget
    (`UnderKindPickerKey`, `underKindPicker`), and `WidgetSelection`'s
    `tagValues` and Boolean fallbacks leave a marked input alone: under the
    picker the kind's own configuration decides (an explicit `Single_Choice`
    still claims it).
  - **A declared union's widget is composed from its members'**
    (`A | B | Nothing`; see "Kind picker" below), and a composed union counts as
    a type default (`isTypeDefault`), so the precedence rules above treat it as
    they treat a single type's.
  - **A type default claims only an unset argument or a literal of its own
    kind** (R8). A reference or connection, `_`, `Nothing`, a vector, a
    parenthesised group or a literal of another kind keeps the widget that draws
    it (an `Integer` argument holding a text literal shows the text input; in an
    `Integer | Text` union the kind picker shows the Text kind). The number
    widget and `isBooleanArgument` check this. The date, time and date-time
    pickers are exempt (R10): they claim any value of a configured argument, as
    the declared-type rule did on develop, and draw its code through
    `NodeWidget` with a ▾ over it; `WidgetText`'s matcher already admits only
    placeholders and text literals. `WidgetFileBrowser` claims a browse
    configuration, a type default's too and whatever the value (like R10: a ▾
    over the code, so an argument or `Vector File` item holding a variable can
    be given a file instead), and otherwise only an argument whose declared type
    has a `File`, `Writable_File` or `Enso_Secret` member (exactly, by
    `unionMembers`: `Vector File` is none) and whose configuration is an
    annotation's `Single_Choice` or `Text_Input`, or still `Pending` (the browse
    items join its options, or sit in a dropdown over the text input:
    `Data.read`'s `path` is `@path (Text_Input)` on `Text | URI | File`), never
    under the kind picker and never from the type alone. An annotation's
    configuration keeps claiming whatever the argument holds. A test of a
    browsable argument should answer what the engine answers for it: a mocked
    `Single_Choice` hid the `Text_Input` case (#926).
  - **An offered auto-scoped constructor resolves without the engine**
    (`deriveAutoscopedCallInfo` in `@/util/callTree`, used by
    `widgetFunctionCallInfo.ts`): the engine resolves `..Equals` only when the
    call it is passed to reads it, and a call that fails first never does
    (`table.join on=[(..Equals 'county')]` without `right`: no call info, so no
    `left`/`right` and nothing to enter). When the engine has no call info and
    the parent's choice offers `..Name`, the constructor is taken from the
    suggestion database: the one of that name whose type the expected type
    names, else the only one of that name.
  - **A submenu stays open while its item is in sight**
    (`WidgetSelection/SelectionSubmenu.vue`): a list longer than the dropdown
    scrolls, and clicking a partly hidden group (`filter`'s `Text →`) scrolls it
    into view; only a scroll that takes the item out of sight closes its
    submenu.
  - **A type default does not set the browse mode** (R9): `useBrowserTypeInfo`
    treats it as no configuration, so the declared type decides, except under
    the kind picker (`underKindPicker`), where it is the chosen kind's widget:
    the File kind of `File | Enso_Secret` browses files only, its Secret kind
    secrets only.
  - **The number and text widgets** (`WidgetText` 1001, `WidgetNumber` 1002):
    the literal decides between them. A text literal under an annotation's
    `Numeric_Input` keeps the text input (both score Perfect; the text widget
    comes first), and `WidgetText` takes no number literal, so a number under
    `Text_Input` keeps the number input
    (`__tests__/numberTextPriority.test.ts`).
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
  user's module and it needs no import. A call with no subject (an auto-scoped
  constructor, `format=..Delimited`) hangs its query on its node's expression,
  not on itself: the engine caches only binding expressions and self arguments,
  so a query on a constructor inside a computed node was answered only when the
  node ran again (Note [A Query With No Subject Hangs On Its Node],
  `subjectlessQueryFrame`). The answer is
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
- **Resolvers: when a widget query runs again.** An argument whose widget a
  resolver computes answers
  `"resolver":{"dependencies":["self",…],"searchable"}`
  (`FunctionCall.resolvers`). The query follows the plan in
  `providers/openedProjects/widgetRegistry/widgetQueryPlan.ts` (Note [When A
  Widget Query Re-Runs]): the first query sends every argument's expression id;
  after an answer, only the named dependencies' ids, and a `revision` stamp of
  their code and computed value (the payload object; an edit may keep an
  expression's id). The configuration keeps its identity while that plan is
  equal (`WidgetFunction/stableConfig.ts`), so an argument nothing depends on
  changing asks nothing; the subject being recomputed re-runs the visualization
  in the engine. An answer is taken only when it is new since its query was sent
  and echoes the query's `revision` (latest wins). **Static answers** (no
  `resolver`, no `columns`) are kept per method and argument names for the
  project's session (`StaticAnswerCache`, an LRU of 256 in `projectStates.ts`),
  and a node they answer detaches its query; entries of a module are dropped
  when the engine sends that module's suggestions again (it was recompiled, or
  its library reloaded). A mock answer that is meant to change within a test
  must therefore declare a `resolver`. Arguments with no annotation whose type
  default is a resolver (`TypeDefaults.resolverDefault`, single types only) are
  resolved by the query too, named in `type_defaults`.
- **Notes: the fallback, and why.** `WidgetQueryNote.vue` (priority 3, after
  `WidgetQueryError`) marks an argument whose input carries
  `WidgetQueryNoteKey`: `unavailable` (an `info` icon; a dependency of the
  resolver is an error, "Choices unavailable: right has an error.") or `loading`
  (a spinner; "Loading choices…"). The marker
  (`WidgetQueryNote/QueryNoteMarker.vue`, the kind chip's box: a port high,
  centred on the row) stands inside the argument's chip, after its name: where
  `WidgetArgumentName` draws the name, the note is handed down to it
  (`NoteAfterNameKey`, as the kind chip is), elsewhere it stands in front of the
  value. A dependency the call does not set gets no `unavailable` note
  (`withoutUnsetDependencyNotes` in `widgetQueryPlan.ts`): unset, it is a
  `Missing_Argument` to the engine, not a problem to show; only a set argument
  whose value is an error (a connected `Error.throw` node, say) does. The
  argument itself has no widget from the query then, so it shows the call tree's
  ordinary fallback: its type default, else literals and `tagValues`. **The
  time-box** (`RESOLVER_TIME_BOX_MS`, 2 s): until a query is answered, the
  previous answer's widgets stay (`Pending` on a node's first query); after 2 s
  the resolvers' arguments (all queried arguments on a first query) show the
  fallback with the loading note, until the answer replaces it. The query is not
  cancelled.
- **Search as you type.** A searchable argument's input carries
  `WidgetSearchKey`, a callback `WidgetSelection` calls with the text typed in
  its dropdown (`''` when it opens or closes). `WidgetFunction/widgetSearch.ts`
  sends a second query for that argument alone, with `search` set to the text
  once typing pauses for `SEARCH_DEBOUNCE_MS` (250 ms); an answer whose `search`
  echo is not the current text is dropped (latest wins), and the answer's widget
  replaces the argument's while the text is there. The local filter still
  applies on top, matching anywhere in a name for a searchable argument (the
  engine's search does) and the start of a name otherwise. Only the Database
  table-name pickers are searchable today.
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

## Kind picker

A declared union (`Integer | Nothing`, `Text | File | Nothing`) is drawn by
`WidgetKindPicker.vue` over a composed configuration.

- **Composition** (`providers/openedProjects/widgetRegistry/unionKinds.ts`,
  `composeUnion`, reached from `TypeDefaults.lookup`): `unionMembers` splits the
  declared type on top-level `|`; each member's type default is asked
  separately. `Nothing` is a kind of its own. A member with no widget is
  dropped. **The conversion rule:** a member A is dropped when another member B
  has `B.from (that : A)` (`convertsBetween`, read from the suggestion
  database's `conversionSources`), but only when B itself has a widget (`URI`
  absorbs nothing): `Text | File` is just a File (`File.from (that : Text)`),
  while `Text | Regex` keeps both kinds (no `Regex.from (that : Text)` exists).
  Conversions count through other members (A → B → C drops A and B), and of
  members that all convert to each other (two, or a cycle of more) the earliest
  stays; if every member would go the first stays. `Nothing` is never absorbed
  and never absorbs. Members with deep-equal widgets collapse. Only
  `Single_Choice` kinds merge into one `Single_Choice` (`Nothing` an option); a
  single kind stays that widget; otherwise a `Union` with `Nothing` last. The
  result is memoised per type while the member widgets and the conversion
  verdicts are unchanged, so a conversion appearing later re-composes it. An
  engine-built `Widget.Union` (and a `@` annotation) parse to the same `Union`
  configuration.
- **The look:** the icon of the kind the value is
  (`WidgetKindPicker/KindChip.vue`), directly in front of the value, which is
  drawn by that kind's own widget (the node still shows its code). On a selected
  node the icon is a button opening a list of the kinds; `Nothing` is the
  picker's last entry, written as plain `Nothing`, and with `Nothing` chosen
  there is no icon: the selected node shows a `Nothing ▼` button in place of the
  value, the unselected one plain `Nothing`. **The argument's name stays in
  every state**: where `WidgetArgumentName` will draw the name
  (`argumentNameShown`, its own score), the picker does not draw the chip itself
  but hands it down on the input (`KindChipKey`,
  `WidgetKindPicker/kindChipKey.ts`), and `WidgetArgumentName` draws it between
  the name and the value (and leaves the value out while it is the `Nothing ▼`
  button). Elsewhere (a vector item, an operand) the picker draws the chip in
  front of its inner widget. Arrow keys move in the list (in `KindChip`, not in
  `DropdownWidget`); Enter chooses. Switching writes the kind's default code and
  its imports in one edit (`WidgetKindPicker/kindImports.ts`, shared with a
  vector's new item). After a switch the chip's new button takes the focus
  (`WidgetKindPicker/focusAfterSwitch.ts`): only the switched chip's (same node,
  kinds and chosen kind), and nothing waits when the button was kept. The
  picker's root does not stop Enter: its inner widgets handle Enter as they do
  outside a union, and the chip and its list stop it themselves. **The list
  shows every kind**, not the dropdown's usual 6.4 rows: it scrolls only when
  the window below the button is shorter (`listMenuStyles` in
  `WidgetSelection/styles.ts` reports the height left, which `KindChip` divides
  by the graph's zoom). A kind without an icon (`Nothing`) has its label
  indented to line up with the labels after the icons. The bare icon of an
  unselected node is 1 px lower than the port's centre, so its glyph sits on the
  baseline of the text beside it.
- **Priority 44**: before `WidgetAnyToTarget` (45), `WidgetFileBrowser` (49),
  `WidgetSelection` (50), the date and time pickers and `WidgetRegex` (102),
  which draw the chosen kind inside it: a `Union` configuration must reach the
  picker first. A widget between the picker and `WidgetArgumentName` (100) must
  hand its input on to `<NodeWidget>` (spread, so `KindChipKey` survives), or
  the name and the chip are lost; `__tests__/kindChipSpread.test.ts` reads every
  widget in that band and fails on one that builds its inner input afresh. It
  scores only when the value is one of the kinds (or unset), otherwise it steps
  aside and the value is drawn as any other.
- **`kindIcon`** (`WidgetKindPicker/kindIcon.ts`) is the one place to give a
  kind an icon; without one the chip shows the label.
- **`matchKind` / `kindDefaultCode`** (`WidgetKindPicker/kindMatch.ts`) are the
  one place to teach a new widget kind its value shape: `matchKind` says which
  kind an expression is, `kindDefaultCode` the code switching to it writes (a
  test checks that each default reads back as its own kind). A vector's new item
  uses the first kind with a default (`vectorItemKind`, `vectorItemDefault`,
  `WidgetVector/elementType.ts`), with that kind's imports. A vector value is
  the first `Vector_Editor` kind whose item widget takes every item (so `[]` the
  first of them), else the first kind taking any vector. An option written in
  parentheses is matched without them only when they wrap it whole
  (`stripOuterParentheses`: `(a) + (b)` is left as it is).
- `WidgetRegex.vue` (priority 102, after `WidgetArgumentName`, since it draws
  the call from its parts) is the input of a `Regex_Input` argument: `regex '…'`
  is drawn as the call's head (`regex`, `Regex.compile`, as written) with the
  pattern edited in place by `WidgetText`, both inside the outline a call in an
  argument has (`WidgetFunction`'s `.nestedCall`); an unset argument is an empty
  input that writes `regex '<text>'` on blur. A `Regex` argument outside a union
  with `tagValues` of its own gets the values' dropdown (`WidgetSelection`, 50)
  around the regex input, by D1 (#919): an argument's own `tagValues` win over a
  type default (`__tests__/regexSelection.test.ts`).

## Column pickers

- A column picker in an annotation is a **reference** (`Column_Name`,
  `Column_Names`, `Column_Vector`, `Order_By`), not a list of options. The
  answer's `columns` block holds each table's column names, kinds and type names
  once, and `columnPickers.ts` (`$/providers/openedProjects/widgetRegistry/`)
  expands every reference from it while `functionCallFromAnswer` builds the
  configuration, so a node with fifty pickers sends its columns once. The
  reference and `columns` schemas are zod types in `configuration.ts`.
- The expansions are cached per project, keyed on the schemas of every source
  the picker reads, those of the pickers nested in its `extra` included
  (`SchemaCache`, an LRU of 64, in `projectStates.ts` beside `TypeDefaults`), so
  a recomputed table that answers the same columns reuses them.
- `kinds` filters the columns offered; `Other` is always included.
- **Absent source** (no `columns` entry for the picker's `from`): `Column_Name`
  without `extra` is a `Text_Input` (`expression` is ignored without a source);
  with `extra` it is a `Single_Choice` of the extras; `Column_Names` is a
  `Multiple_Choice` of its regex and by-type options, or a `Text_Input` when it
  has none; `Column_Vector` and `Order_By` are a `Vector_Editor` of
  `Text_Input`, new items `''`.
- **Adding a picker flag**: the Enso constructor field in `Metadata.enso` (Base)
  and its `to_json`, the zod schema in `configuration.ts`, the expansion in
  `columnPickers.ts`, and a test in `columnPickers.test.ts` and the Base/Table
  Enso tests. A flag the GUI does not know is dropped by zod, so forgetting the
  schema fails silently.

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
