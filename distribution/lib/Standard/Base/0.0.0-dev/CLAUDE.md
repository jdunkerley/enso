# Standard.Base

The foundational Enso standard library: core data types, I/O, networking, error
handling, and runtime utilities. Every other standard-library module imports
from `Standard.Base`. Most types here are imported automatically by
`from Standard.Base import all`.

## Main entry points

**Data types:** `Vector`, `Array`, `List`, `Map`, `Dictionary`, `Hashset`,
`Pair`, `Text`, `Numbers` (`Integer`, `Float`, `Decimal`), `Boolean`, `Nothing`,
`Date`, `Time_Of_Day`, `Date_Time`, `Duration`, `Range`, `Interval`.

**Collections & utilities:** `Ordering`, `Sort_Direction`, `Index_Sub_Range`,
`Locale`, `Encoding`, `Regex`.

**JSON & serialization:** `Json`, `JS_Object`, `parse_json`. XML is not here: it
is `Standard.XML`.

**I/O & file system:** `File`, `File_Format` (`JSON`, `Delimited`/CSV,
`Plain_Text`, …), `System.File`, `System.Process`, `System.Environment`.

**Networking:** `HTTP`, `URI`, `Email`, `Data.fetch`, `Data.post`.

**Error handling:** `Error`, `Panic`, common errors (`Missing_Argument`,
`Index_Out_Of_Bounds`, `Type_Error`, `Illegal_Argument`, …), `Problem_Behavior`.

**Runtime & reflection:** `Meta`, `Runtime`, `Random`, `Polyglot`, `Any`.

**Cloud:** `Enso_File`, `Enso_Secret`, `Enso_User`.

## Common usage

```
v = [1, 2, 3, 4, 5]
filtered = v.filter (x -> x > 2)
mapped = v.map (x -> x * 2)
total = v.fold 0 (+)

text = "foo, bar, baz"
parts = text.split ", "
trimmed = text.trim
ok = text.contains "bar"

table = Data.read "data.csv"

parsed = '[{"name":"Alice","age":30}]'.parse_json
first = parsed.first

result = "not a number".parse_integer.catch _-> 0
```

## Layout

- `src/Data/` — foundational types: `Vector`, `Array`, `Text`, `Numbers`,
  `Boolean`, `Date`/`Time`, `Map`, `Pair`, `Dictionary`, `Range`, `Interval`,
  `Json`, `Regex`.
- `src/System/` — file I/O, paths, environment, processes, file formats.
- `src/Errors/` — error type definitions, `Problem_Behavior`.
- `src/Network/` — HTTP, URI, Email.
- `src/Enso_Cloud/` — `Enso_File`, `Enso_Secret`, `Enso_User`.
- `src/Runtime/` — runtime utilities, contexts, debugging.
- `src/Meta/` — runtime type introspection.

## IDE entry points

- `Standard.Base.Metadata.Widget_Query.resolve_call` is the IDE's widget query
  (`src/Metadata/Widget_Query.enso`). It looks the method up exactly, by module,
  type and name, so static methods, extension methods and methods of `Any` get
  their own annotations. It answers
  `{"arguments":[[<name>,{"widget":…}|{"error":{"step","message"}}],…]}`: errors
  are results, one per argument, never a failed call. Each failure is logged
  once per engine process on the logger `Standard.Base.Metadata.Widget_Query`
  (WARN, with the cause chain and, for a panic, the stack), and each call is
  timed under `Standard.Base.Logging.Progress` (handle
  `Widget_Query.<type>.<method>`, the IDE's Performance timings). An error
  subject (a dataflow error as `value`, not `subject_is_type`) is the user's own
  error: every argument answers `{"widget":null}`, nothing is logged and no
  annotation runs. The GUI calls `resolve_call` for every widget query, by
  method pointer (`Standard.Base.Metadata.Widget_Query.resolve_call`, literal
  arguments, so nothing is compiled in the user's module); the one in-frame
  query, the dropped file's `format` options, goes through
  `Meta.call_module_method`, with the `Data` module as the value.
- **Widgets carry no display.** `Widget` constructors have no `display` or
  `label` (`Metadata.Display` is gone; `Choice.Option`'s `label` stays). Which
  arguments the node shows is the `arguments:` map in the method's doc front
  matter (`always`, `selected`, `when_modified`), beside `group` and `icon`;
  arguments with no default always show. The compiler's `ArgumentDisplayCheck`
  validates it and `lintEnso` fails the build on a mistake.
- **Type defaults.** A type's default widget is `Widget.from (that : X.type) …`
  in `X`'s module. Extra defaulted arguments are tweaks
  (`Widget.from Filter_Condition include_text=False`).
  `Standard.Base.Metadata.Widget_Query.resolve_type` answers it for the GUI
  (`{"widget":…}`, `{"widget":null}` for a type with no conversion, or an
  `{"error":{"step":"lookup"|"type_default","message"}}`); a call in a node's
  frame is
  `Meta.call_module_method 'Standard.Base.Metadata.Widget_Query' 'resolve_type' [] '<qualified type name>'`.
  Group C types keep `default_widget` until PR 6.
- `Meta.get_method_annotation`, `Meta.find_type_or_module` and
  `Meta.call_module_method` are for the IDE only (`private: true`); do not use
  them in library code.
- `Meta.call_module_method` is how an expression evaluated in a user's module
  reaches a library's entry point without importing the library. It applies the
  method to the value and all its arguments in one call
  (`CallModuleMethodNode`), and `value` is `@AcceptsError`: an error value goes
  to the method, which decides what it means (`resolve_call` answers no
  widgets).
- `Meta.Type.find` prefers a module to a type of the same name:
  `Standard.Table.Table.Table` finds the module. `Meta.find_type_or_module` asks
  for the type first and falls back to the module.

## Things to avoid in generated code

- `advanced: true` entities — these are escape hatches the IDE searcher hides.
  Use the regular API.
- Direct `polyglot java import` of internal classes — only the stdlib should
  reach across the polyglot boundary.
- `files.map Data.read` followed by a `union` — use
  `Data.read_many (Data.list "<dir>" name_filter="*.csv")` (or a Vector, Column
  or Table of paths). It unions the files into one table with a `Path` column
  and turns a failing file into a warning; `return=..With_New_Column` keeps one
  row per file instead.

## Doc comments

Doc comments follow the house style in the wiki's
[Style-Guide-Enso-Docs](https://github.com/jdunkerley/enso/wiki/Style-Guide-Enso-Docs):
a one-sentence summary, `## Arguments` bullets, and `## Examples` that paste
into the graph as nodes. The docs-site generator checks it for the modules in
`STYLE_CHECKED_MODULES` in `docs-site/generator/src/style.ts`; today that is
`Standard.Base.Data.Time.Date` and `Standard.Base.Data.Time.Time_Of_Day`
(`src/Data/Time/Date.enso` is the worked example). When you convert another
module, add it to that list in the same PR.

## Where to read more

- `src/Main.enso` — full public API list.
- `src/Data/Vector.enso` — vector methods (`map`, `filter`, `fold`, `zip`, …).
- `src/Data/Text.enso` — string operations.
- `src/Data/Numbers.enso` — numeric types and methods.
- `src/System/File.enso` — file operations.
- `test/Base_Tests/src/` — extensive working examples.
