# Data.read adds the import of the format's library

Issue: #489. Status: design approved by the owner, 2026-11-03.

## Problem

Since the new-project template imports only the core libraries (#482), the IDE
adds a library's import when the code names one of its types (#466, #476).
`Database.connect` works because its choices insert a qualified name: SQLite's
option is `SQLite.From_File`, and the detector sees `SQLite`.

`Data.read`'s format dropdown inserts autoscoped constructors (`..SQLite`,
`..XML`, `..Delimited`). They name no type, so no import is added. With the
default `Auto_Detect` the user picks only a file, and nothing in the code names
the library that reads it. The value still works, because the engine finds the
format through service discovery (#465), but the module has no import for the
library. Its methods and conversions may not resolve when the user writes them,
and the code is not self-describing outside the IDE.

## Decisions (the owner's)

- **The format's library is enough.** The IDE never imports by a node's result
  type. The library that provides a format also provides what it returns.
- Picking a format in the dropdown adds its library's import. The inserted code
  stays the short `..X` form.
- With format left on `Auto_Detect`, choosing or typing a path adds the import
  of the library whose format would read that file.
- Imports are only ever added, never removed.

## Design

### 1. A widget option can name the type it needs

`Choice.Option`
(`distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso:59`) gains an
optional field `requires:Text=""`: the fully qualified name of a type whose
library the option needs, e.g. `"Standard.SQLite.SQLite_Format.SQLite_Format"`.
Its hand-written `to_json` (`:68`) emits `"requires"` only when the field is
non-empty, so existing widgets' JSON is unchanged.

The field is generic: any widget option can use it. `Database.connect`'s options
already work through the name detector, so leave them alone unless filling the
field there is free.

### 2. Format options carry their type and file patterns

`Data_Read_Helpers.format_widget_with_raw_response`
(`Internal/Data_Read_Helpers.enso:64`) builds the dropdown from
`[Auto_Detect, Raw_Response] + File_Format_SPI.get_types`, through each type's
`get_dropdown_options`. For each option it produces from a registered format
type, it fills in:

- `requires`: that format type's qualified name. `File_Format_SPI.get_types`
  already holds the type, so no format library changes.
- `patterns`: that type's `get_name_patterns` file-name patterns (e.g. `*.db`,
  `*.sqlite`, `*.xml`), the same patterns `Auto_Detect` uses
  (`System/File_Format.enso:99`, `:173`). They live in a new optional
  `patterns:(Vector Text)=[]` field on `Choice.Option`, emitted as `"patterns"`
  only when non-empty.

`Auto_Detect` and `Raw_Response` get neither field.

Every caller of this widget gets the behaviour: `Data.read`, `Data.fetch`,
`Data.post`, the `Network` extensions and `File.read` (`Data.enso:357`, `:496`,
`:587`, `:670`, `Network/Extensions.enso:52`, `:101`).

### 3. What the IDE does

`choiceSchema`
(`app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts:46`)
gains optional `requires: string` and `patterns: string[]`. `Choice` and
`FlattenedChoice` carry them through `flattenChoice`.

- **Picking an option with `requires`.** The dropdown's `ExpressionTag` gets
  `requiredImports` for that type, built with the existing `requiredImports` /
  `requiredImportsByProjectPath` helpers
  (`providers/openedProjects/module/imports.ts`) from the suggestion database or
  catalogue entry for the type. It is applied by `module.addMissingImports` in
  the same edit as the choice, so one undo removes both, the way other widget
  choices already work (`WidgetSelection/tags.ts:146-148`).
- **A path change with format on Auto_Detect.** When a call's path argument
  changes, through the file browser widget or typing, and its `format` argument
  is absent or `Auto_Detect`:
  1. the IDE takes the `format` parameter's widget configuration for that call;
  2. it matches the path's file name against each option's `patterns`, using the
     same glob semantics as `File_Name_Pattern`;
  3. if **exactly one** option matches, it adds that option's `requires` import
     in the same edit as the path change;
  4. if none or several match, it adds nothing.
- **Existing imports are left alone:** `addMissingImports` already skips an
  import that is present. Nothing is ever removed, including when the format or
  path changes later.

If the type in `requires` is not in the suggestion database or the catalogue,
e.g. its library is not installed, the IDE adds nothing and logs it at debug
level. The node still runs through service discovery, as today.

### 4. Out of scope

- Importing by a node's result type.
- Removing imports.
- Formats chosen in code written by hand: the name detector already covers
  qualified names, and `..X` typed by hand is not detected.

## Testing

- **Standard library (Base_Tests):** the format widget's JSON includes
  `requires` and `patterns` for registered formats (SQLite is a good case), and
  omits both for `Auto_Detect` and `Raw_Response`. `Choice.Option` without the
  fields serialises exactly as before.
- **GUI unit tests (vitest):**
  - parsing `requires` and `patterns`;
  - picking an option with `requires` yields the right `requiredImports`;
  - path matching: `.db` matches SQLite, an unknown extension matches nothing,
    an ambiguous match adds nothing, and an explicit non-`Auto_Detect` format
    adds nothing from the path;
  - case handling follows `File_Name_Pattern`.
- **Playwright:**
  - in a new project, put a `Data.read` node, choose SQLite in the format
    dropdown, and `from Standard.SQLite import SQLite_Format` (or the form
    `requiredImports` yields) appears;
  - with Auto_Detect, choose a `.db` file in the file browser, and the same
    import appears;
  - one undo removes both the choice and the import.
- **Before/after screenshots** of the code after each case, per the standing
  rule.

## Changelog

A visible feature, so it gets an entry under `#### Enso IDE`: "Choosing a file
format, or a file, in Data.read adds the import of the library that reads it."
It waits for the owner's OK.

## Risks

- **Glob semantics:** a pattern the GUI matches differently from Enso would add
  the wrong import, or none. Implement the subset `get_name_patterns` uses today
  (`*` and literal text, case-insensitive on extensions) and test against each
  shipped format's patterns.
- **Widget JSON size:** the patterns add a few strings per format. That is
  negligible.
