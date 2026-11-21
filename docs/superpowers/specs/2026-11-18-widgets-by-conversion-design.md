# Widgets by conversion

Status: approved design (2026-11-18). Piece 4 of
[Visualizations: data types and layering](2026-11-13-visualization-depends-on-base-design.md),
widened from "widget queries by method pointer" to a new basis for widgets.

## Goal

A type declares its default widget once, next to itself, as a conversion; a
table-like library gets every column picker by converting to one data type; a
widget that depends on the user's input says so in its signature and reacts to
it. Widgets become easier to write, testable as plain Enso calls, visible when
they fail, and fast on wide tables. New projects no longer need
`import Standard.Visualization`.

## Where we are

- **Every Enso-side widget is an annotation** (`@arg <expr>`, about 670 in the
  standard libraries). The expression is a `Widget` value or a function of
  `self`, optionally taking `cache`. The IDE evaluates every annotated argument
  of a node, on every change of the node's value, through
  `Standard.Visualization.Widgets.get_widget_json value .name [args] uuids`.
- **Type defaults are a naming convention.** 30 types define `default_widget …`
  and annotations call it by hand (`@locale Locale.default_widget`). An argument
  without an annotation gets only the GUI's own guesses: Boolean, number, text,
  date and time pickers, file and secret browsers by declared type (hard-coded
  in TypeScript), and a dropdown of constructors from the suggestion database's
  `tagValues`.
- **The method is found by name.** `Meta.get_annotation value .name arg`
  resolves on the value, which guesses wrong for static calls, extension methods
  and methods inherited through `Any`.
- **Two queries are compiled as text in the user's module**
  (`widgetFunctionCallInfo.ts`, the autoscoped/static fallback;
  `formatForPath.ts`, `DATA_READ_FORMAT_WIDGET_QUERY`). That is why the template
  (`lib/scala/pkg/src/main/resources/default/src/Main.enso`), every sample and
  `samples.test.ts` keep `import Standard.Visualization`.
- **Dependencies on other arguments are hidden.** A helper taking `cache` calls
  `cache "right"`, which looks the argument's value up by expression id
  (`Runtime.value_for_uuid`). Nothing declares the dependency, so the IDE cannot
  know when to re-query.
- **Errors disappear.** `get_widget_json` catches every panic and logs it
  (`Widget.log_internal … ..Warning`); the user just gets no widget.
- **`display` arrives late.** Whether an argument is shown on the collapsed node
  (`Display.Always`) comes with the widget query's answer, so the argument
  appears only after the engine answers, and not at all if the query fails. 134
  annotations set `display=..Always` and 13 `..When_Modified`; many exist only
  for that. `Display.Expanded_Only` is unused (the GUI treats it as
  `When_Modified`). Widget-level `label` is never set in Enso and never read in
  the GUI.

### Measured baseline (develop 6d32a562e5, 2026-11-18)

`get_widget_json` timed per method, 1,000 rows, mixed column types, engine time
only (the GUI's parse is not included):

| Widget, 500 columns            | In-memory      | SQLite     | DuckDB     | JSON          |
| ------------------------------ | -------------- | ---------- | ---------- | ------------- |
| `select_columns`, `sort`, `at` | 1–2 ms         | 1 ms       | 1 ms       | 29 KB         |
| `set` (`Simple_Expression`)    | 122–133 ms     | 109–116 ms | 105–108 ms | 1.6 MB        |
| `filter`                       | 107–166 ms     | 79–92 ms   | 77–80 ms   | 942 KB        |
| `join` with `right`            | ~2 ms (cached) | ~3 ms      | 117–126 ms | 205 KB–1.3 MB |
| `aggregate`, `cross_tab`       | 2–4 ms         | 10–12 ms   | 12–17 ms   | 650–770 KB    |
| `Locale.default_widget`        | 25 ms per call | (same)     | (same)     | 2 KB          |

- The cost is size: the same column list is copied into every nested option
  (`filter` builds ~30 options, each with the 500-name chooser).
- `_with_table_cache` keys on `table_version_hash`, a random UUID per in-memory
  table: a recomputed table with identical columns misses, which is every edit
  in the IDE. Database tables never cache (`_table_key` gives `Nothing`).
- No widget issues SQL; column names are in memory.

### Engine spike (2026-11-18)

`Widget.from (that : Locale.type)` fails today with "The name `Locale.type`
could not be found" (`MethodDefinitions` and `TypeNames`). A throwaway change of
about 40 lines in five compiler files (resolve `X.type` to X's eigentype, the
route static methods already take) made it work with **no runtime change**:

- dispatch works for conversions in the source type's module and in the
  target's; for built-in (`Integer`, `Text`), Base (`Locale`) and user types,
  with constructors or statics only; through a variable in a module that does
  not import the type; with IR caches and static analysis on;
- a value conversion `W.from (that : Foo)` and `W.from (that : Foo.type)` do not
  collide; neither leaks to the other;
- no conversion gives a catchable `No_Such_Conversion` panic;
- **a `from (that : Any)` catch-all also catches every type object** that has no
  specific conversion;
- **the suggestion database records `that : Foo.type` as `…Foo`**, the same as a
  value conversion, so the GUI's `conversionSources` index (used by the
  visualization picker) would wrongly believe Foo values convert.

## Design

### 1. How a widget is decided

For each argument of a call (nested constructor calls included), the first that
applies wins:

1. **The parameter's annotation**: a `Widget` value (static) or a resolver
   (dynamic, §3).
2. **The type default**: the argument type's `Widget` conversion (§2), with the
   union and vector rules (§4).
3. **The GUI's own detection** of literals (a `True` literal is a Boolean, a
   text literal is text) and `tagValues`.

An annotation is only ever a `Widget` value or a resolver. The old form, a
function of `self` taking `cache`, is removed.

**Errors are results.** Resolution gives each argument a widget or an error. The
GUI shows the error on the argument and still offers the next rule's widget, so
the argument stays editable. Every error is also **logged in the engine** with
`log_internal` (the Logs panel's Libraries source): the method, the argument,
the step that failed (annotation resolver, or `Widget.from` for type X), the
message, its cause chain and, for a panic, the Enso stack trace. Logs are
deduplicated on the cache key (§6), so a resolver failing on every keystroke
logs once. A GUI-side schema mismatch (today
`console.error('Unable to parse widget configuration.')`) is also sent to the
Logs panel, under Engine.

### 2. Type defaults by conversion

```
## In Locale.enso
Widget.from (that : Locale.type) = Single_Choice …

## In Filter_Condition.enso: extra arguments, all defaulted
Widget.from (that : Filter_Condition.type) (include_text:Boolean=True) (include_boolean:Boolean=True) … = …

## An annotation tweaking a type default
@condition (Widget.from Filter_Condition include_text=False include_boolean=False)
```

- **The default is the conversion with every extra argument at its default**; a
  tweak passes some. `default_widget` is removed from all 30 types; nothing
  replaces it under another name. Extra defaulted arguments on conversions have
  precedent (`Day_Of_Week.from (that : Integer) (first_day:…)`,
  `Column.from (that:Vector) (name:Text="Vector")`).
- **Where a parameter is typed `Widget`, a type converts itself**
  (`Vector_Editor item_editor=Locale`). Vector elements are not converted, so
  inside `Option`'s `parameters` write `Widget.from Date`.
- **No `Widget.from (that : Any)`**: it would catch every type.
  `No_Such_Conversion` means "no type default".
- **A type default may be a resolver** (§3) when the type needs the subject:
  `Widget.from (that : Simple_Expression.type) = Widget.Resolver _simple_expression_widget`.
  It is fetched once per type; the resolver then runs per node.
- **Nested arguments follow the same rules.** The arguments of a constructor
  inside an argument (`that` in `..Equals that=…`) are call arguments like any
  other, so `Option`'s `parameters` is needed only to override. Today's
  `Filter_Condition.default_widget` spells out a nested widget for every option;
  most of it goes.

The 30 types today, and what each becomes:

| Group                    | Types                                                                                                                                                                                                                                                                                              | Becomes                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A. Plain                 | Locale, Return_As, Case, Encoding, Text_Sub_Range, Duration, Time_Zone, Email_Address, Email_Attachment, Email_Provider, Header, File_Format (Base); Connection_Options (Database); Google_Credential; Azure_Storage; AWS_Region; Columns_To_Add, Columns_To_Keep, Join_Kind, Rows_To_Read (Table) | `Widget.from (that : X.type)`                          |
| B. Parameterised         | Filter_Condition, Index_Sub_Range (`count`), Date (`include_today`), Time_Of_Day (`include_now`), AWS_Credential (`add_user_password`), Credentials (`include_nothing`)                                                                                                                            | the conversion, with the parameters as extra arguments |
| C. Needs the subject     | Simple_Expression, Generate_Rows_Range, Google_Analytics_Account, Google_Analytics_Property                                                                                                                                                                                                        | the conversion returns a `Widget.Resolver`             |
| D. Hard-coded in the GUI | Boolean, Integer/Float/Number, Text, Date, Date_Time, Time_Of_Day, File, Writable_File, Enso_Secret                                                                                                                                                                                                | conversions in `Metadata.enso` (the target's module)   |

**Decided 2026-11-19 (plans for PRs 3a and 3b):** group C (and
`DuckDB_GeoFormat`, which reads a connection) keeps `default_widget` until PR 6,
so PR 3 deletes it from the other types only. `Date` and `Time_Of_Day` have no
group B default in use: their unused `default_widget`s are deleted and their
defaults are group D's pickers. The spec's "Azure_Storage" is
`Azure_Blob_Storage`. Until PR 4, a union takes its first member's default (not
`Nothing`), except that an argument whose union contains `File`, `Writable_File`
or `Enso_Secret` keeps the file browser. The GUI caches a type's default for the
session.

Group D's defaults: `Boolean_Input`; `Numeric_Input` (`decimal_places` 0 for
Integer); `Text_Input`; new `Date_Input`, `Date_Time_Input` and `Time_Input`
constructors for the existing pickers (today they cannot be requested, e.g. in a
nested position); `File_Browse` (`action=..Save` for `Writable_File`);
`Secret_Browse`. The GUI's scoring by declared type for these is deleted; its
literal detection stays.

### 3. Resolvers: widgets that depend on input

```
@on _join_on_widget
join self right:Table on=… = …

private _join_on_widget self (right : Table | Nothing = Nothing) (search : Text = "") -> Widget = …
```

- **The parameters are the dependencies.** A resolver's parameters may be
  `self`, any argument of the call by name, and `search`. Any other parameter is
  an error at load time (and in tests). Read with `Meta.meta f . arguments`, as
  the `cache` check does today.
- **It re-runs** exactly when `self` or a named dependency changes value, or
  when `search` changes. An unrelated argument changing does not re-run it.
- **A dependency with no value yet** (argument not set) leaves the parameter at
  its default, so resolvers are written for `Nothing`.
- **A dependency that is an error** skips the resolver; the argument falls to
  its type default, with a note ("choices unavailable: right has an error") and
  an info log entry.
- **`search`** is the text the user is typing in the argument. A resolver that
  declares it is searchable: the GUI sends the text (debounced, latest wins) and
  the resolver returns matching choices, e.g. a `LIKE` query for table names. A
  resolver without it returns its full list and the GUI filters locally.
- **A test is a call**: `_join_on_widget t1 right=t2 . should_equal …`.

### 4. Unions and vectors: the kind picker

```
Text | Integer | Nothing   →   [Text ▾] [ hello ]      picker: Text · Integer · Nothing
Text | Regex               →   [Regex ▾] [ a.*c ]      (regex syntax)
```

- **The kinds** are the union's members that have a widget, plus `Nothing`. A
  member without one is not offered, but can still be typed.
- **The picker shows whenever there are two or more kinds**, `Nothing` counted:
  an empty string is not `Nothing`, and the picker is the explicit way to write
  `Nothing`. Choosing it writes `Nothing`, even when that is the default.
- **The initial kind** is the one matching the current value (a text literal is
  Text, a number Integer, a regex Regex), otherwise the first member of the
  union. The picker never contradicts the code.
- **Switching kind** writes the new kind's default value as one undoable edit.
- **No picker** when one kind is left, when every member is a plain dropdown
  (one merged list as `tagValues` does today; `Nothing` becomes an entry), or
  when an annotation applies.
- **`Vector T`** is a `Vector_Editor` of T's widget; each item gets its own
  picker when T is a union. `item_default` is the first option of a dropdown,
  otherwise blank. A bare `Vector` or `Array` stays with the GUI.
- **Engine side**: a new `Widget.Union kinds:(Vector (Pair Text Widget))`, so a
  type default or resolver can produce one too. GUI side: a new composite widget
  (working name `WidgetKindPicker`) wrapping the chosen kind's widget.

**Plan for PR 4 (2026-11-21, pending the owner's decisions in the plan):** the
GUI composes a declared union's picker from its members' cached type defaults;
`Widget.Union` has a second field `include_nothing:Boolean=False`. In a union
with a browser kind (`File_Browse`, `Folder_Browse`, `Secret_Browse`) the `Text`
member is dropped; members with equal widgets collapse. A set value that matches
no kind gets no picker. A `Vector T` item's default is the first option of a
dropdown, otherwise the first kind's default value (not a blank `_`, which would
make the list a function).

Of the 170 union-typed arguments in the standard libraries, most are
`T | Nothing` or a main type plus shorthand forms (`Text | Enso_Secret`,
`URI | Text`, `Index_Sub_Range | Range | Integer`). Selector unions
(`Vector | Text | Integer | Regex | By_Type`) are annotated and unaffected.

### 5. Column pickers by conversion

```
type Widget_Columns          # Standard.Base.Metadata.Widget_Columns
    Value (names : Vector Text) (kinds : Vector Column_Kind) (type_names : Vector Text)

Widget_Columns.from (that : Table) = …       # next to each table-like type

@column (..Column_Name kinds=[..Numeric])
@columns ..Column_Names
@on (..Column_Name from="right")
```

- **`Column_Kind`** (`Numeric`, `Textual`, `Logical`, `Date_Only`,
  `Date_And_Time`, `Time_Only`, `Other`) is a Base type. Visualization's
  identical `Viz_Kind` is replaced by it. `type_names` carries the library's own
  type name (`Value_Type.to_name`) for display.
- **Conversions** for Table, DB_Table and Row (and any table-like type in other
  libraries). They read **only the schema**, never rows; a database table's
  schema is already in memory, so no query is made.
- **Declarative pickers** (`Column_Name`, `Column_Names`, `Column_Vector`,
  `Order_By`, with `kinds` and `from`) are `Widget` constructors resolved by the
  system against `Widget_Columns.from self` (or `from` the named argument). They
  cover the plain pickers; resolvers remain for composite ones (join conditions,
  aggregates, `Simple_Expression`). Table-specific extras such as the
  `(expr '[A]')` option go into the library's own resolver or a flag on the
  picker.
- **The column list is sent once per answer.** The engine does not expand
  pickers: each answer carries the `Widget_Columns` it used once, and every
  picker in it, at any nesting depth, is a small reference the GUI expands
  locally. This is what removes the baseline's size problem.
- **The builders in `Table/Internal/Widget_Helpers.enso` are rewritten over
  `Widget_Columns`** in Base, and the Table, Database, DuckDB, Geo, XML and YXDB
  callers migrate to the declarative form.

**Plans for PRs 5a and 5b (2026-11-21, pending the owner's decisions in the
plans):** PR 5 is split into 5a (Base and libraries: `Column_Kind`,
`Widget_Columns`, the pickers, the `columns` block; invisible) and 5b (GUI
expansion, migration, benchmark). Annotations spell pickers with their type,
`@columns (Widget.Column_Names)`: an annotation has no expected type for `..`. A
database column whose SQL type is not known yet is kind `Other` rather than
queried (a computed column's type costs one query per column), and a picker
filtered by `kinds` always offers `Other` columns.

### 6. Queries, caching and performance

**Three levels**, each cached on what it really depends on:

| Level             | Example                     | Fetched         | Cache key                                                 | Dropped when                |
| ----------------- | --------------------------- | --------------- | --------------------------------------------------------- | --------------------------- |
| Type default      | `Widget.from Locale`        | once per type   | the type                                                  | the type's module changes   |
| Static annotation | `@case (..Single_Choice …)` | once per method | method + argument                                         | the method's module changes |
| Dynamic           | resolver, column picker     | per node        | method + argument + input values (for pickers the schema) | an input changes            |

**Entry points**, both in Base, called by method pointer (nothing compiled in
the user's module):

- `Widget.resolve_type T`: the type's widget, a `Resolver` descriptor, or
  "none".
- `Widget.resolve_call <method pointer> self <arguments by name> search=…`: for
  each argument, `{widget}`, `{resolver: dependencies, searchable}` or
  `{error}`. One call per node for all its arguments. The first answer tells the
  GUI which arguments are dynamic and what each depends on.

**Static knowledge.** With the suggestion database fix (§9, PR 0) recording a
`.type` source as `….Foo.type`, the GUI knows from the database which types have
a default, without asking. Type defaults and static annotations of a method are
prefetched when the component browser or a node first shows it.

**Argument values** reach a resolver by name. Under the hood the GUI passes
expression ids for the declared dependencies only; `resolve_call` looks them up
(`Runtime.value_for_uuid`).

**Time limits.** A resolver run is time-boxed at 2 s: past that the argument
shows its fallback with a "loading" marker, and the result replaces it when it
arrives (the run is not cancelled). A run over 10 s is logged at Warning.
`search` runs are debounced 250 ms, latest wins.

**Schema-keyed cache.** Dynamic results for column pickers are cached on the
`Widget_Columns` value (names and kinds), so a recomputed table and a database
table hit. `_with_table_cache`, `_table_key`, `TableValueCache` use for widgets,
and `With_JSON_Cache` are deleted.

**Targets** (500 columns, every backend in the baseline): every widget answer
under 50 KB and under 20 ms of engine time; type defaults evaluated once per
type per session. PR 1 adds timing of each widget query under the existing
performance-timings setting (#342), measuring engine time **and** the GUI's
parse-and-render time. The baseline bench becomes a checked-in benchmark, run
before and after.

### 7. Display in the front matter

`display` and `label` come off every `Widget` constructor. Whether an argument
shows on the collapsed node is the method's decision, written in its doc front
matter and carried statically by the suggestion database, like `group` and
`icon`:

```
## ---
   group: Standard.Base.Selections
   icon: join
   arguments:
     on: always
     join_kind: selected
   ---
join self right:Table on=… join_kind=… = …
```

- **Values**: `always` (shown on the collapsed node), `selected` (also shown
  while the node is selected), `when_modified` (shown once set, otherwise
  reached through the `…` menu; the default, rarely written).
- **An argument with no default** (or a `Missing_Argument` default) is always
  shown. `display` applies only to arguments with a default.
- **Checked**: an unknown argument name, or `display` on a required argument, is
  a compiler warning where the suggestion builder parses the front matter, and
  an error in the standard library build.
- **Known before the engine answers**, so an `always` argument no longer pops in
  late, and shows even when its widget query fails.
- `Display.Expanded_Only` is deleted. Widget `label` is deleted (Enso and the
  GUI schema); `Choice.Option`'s `label` stays.
- `selected` depends on #850 (selection no longer shows every hidden argument).

### 8. Query plumbing and the import

- `Standard.Visualization.Widgets` goes; the entry points live in Base
  (`Standard.Base.Metadata`). Widgets are metadata, not visualisation, and Base
  is always imported.
- The GUI calls the entry points by method pointer in every case, including the
  autoscoped/static fallback and nested autoscoped constructors (which today
  take the text path), and the dropped-file `format` query.
- The method is identified exactly (module, type, name), not by `.name` on the
  value, so static calls, extension methods and inherited methods get the right
  annotations.
- The new-project template, the samples and `samples.test.ts` drop
  `import Standard.Visualization`.

## Testing

- **Engine** (PR 0): runtime-integration tests for `X.type` conversions covering
  every spike case, extra arguments
  (`Widget.from Filter_Condition include_text=False`, directly and through a
  variable) and rejection of `SomeModule.type`; a SuggestionBuilder test that
  the source is recorded as `….Foo.type`.
- **Enso**, through the IDE's own entry points, in each library's suite:
  `Widget.resolve_type T` for every type with a default; `Widget.resolve_call`
  for methods, per-argument result shapes; resolvers as plain calls; errors with
  `should_fail_with`; `Widget_Columns.from` for Table, DB_Table, Row and DuckDB
  with SQL logging on, asserting no query.
- **Front matter**: the warning for unknown names and `display` on required
  arguments.
- **GUI** vitest: kind picker (initial kind from the value; switching is one
  undoable edit), column-reference expansion, cache invalidation on module and
  library reload.
- **GUI** Playwright: `Text | Nothing` choosing Nothing; `join`'s `on` updating
  when `right` changes; search-as-you-type; a failing resolver showing its error
  with a usable fallback and one Logs-panel entry; `display: selected`.
- **Performance**: the checked-in widget benchmark against the §6 targets.

## PRs

No outside users: no deprecation period. Each PR migrates every use in the
standard libraries in the same change.

| #   | PR                                                                                                                                                                                                                                                                                 | Depends on | Changelog |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| 0   | Engine: `X.type` conversions (proper eigentype metadata, not the spike's name check; reject modules) + suggestion database records `….X.type`                                                                                                                                      | none       | label     |
| 1   | Plumbing: `Widget.resolve_type` / `resolve_call` in Base by method pointer (nested autoscoped calls included); errors as results + logging; query timing. Existing annotations keep evaluating. Template, samples and `samples.test.ts` drop `import Standard.Visualization`       | none       | label     |
| 2   | Front-matter `display` (+ `selected`); migrate the 147 `display=` annotations; remove `display`/`label` from `Widget`; delete `Expanded_Only`                                                                                                                                      | 1, #850    | entry     |
| 3a  | Type defaults: `Widget.from` for 24 types of groups A and B; `Widget_Query.resolve_type`; call sites rewritten; `default_widget` deleted from them (group C keeps it until PR 6). No GUI change                                                                                    | 0, 1       | label     |
| 3b  | Group D conversions; `Date_Input` / `Date_Time_Input` / `Time_Input`; the GUI asks `resolve_type` once per type per session and drops its type guesses; annotations that repeat a type default deleted                                                                             | 3a         | entry     |
| 4   | Unions: `Widget.Union` + kind picker                                                                                                                                                                                                                                               | 3          | entry     |
| 5   | `Widget_Columns` + `Column_Kind` (replacing `Viz_Kind`); declarative pickers; column list sent once; schema cache; migrate Table, Database, DuckDB, Geo, XML and YXDB                                                                                                              | 1          | entry     |
| 6   | Resolvers with declared dependencies + `search`; group C conversions returning resolvers; migrate every `cache=` helper (join, filter, rename, fill, Google, Redshift, DuckDB, Hyper); delete `cache`, `_with_table_cache`, `With_JSON_Cache` and `Standard.Visualization.Widgets` | 5          | entry     |

PRs 0, 1 and 2 can run in parallel (2 once #850 is merged); 3 and 5 can follow
in parallel. Each gets its own plan.

## Non-goals

- Library-shipped widget components (Vue files in a library, as for
  visualizations). Possible later on top of this; not needed for any widget
  here.
- New widget kinds beyond `Widget.Union` and the three date/time inputs.
- Sharing the conversion index between `WidgetAnyToTarget` and the visualization
  picker (piece 1 note 13) beyond what PR 0's database fix needs.

## Risks

- **PR 0 is a language change.** The spike changed only name resolution, but a
  real PR must carry eigentype metadata through IR caches properly. If review
  finds a deeper problem, §2 falls back to a static method by convention with
  the same shape (one declaration per type, in its module) and the rest of the
  design is unchanged.
- **Removing the GUI's type guesses** (PR 3) can change a widget users see if a
  conversion's widget differs from the old guess. PR 3 compares screenshots of
  every group D type before and after.
- **The `…` menu and `selected`** rely on #850's behaviour; if #850 changes,
  §7's `selected` is redefined with it.
