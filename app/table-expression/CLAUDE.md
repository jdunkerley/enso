# lezer-enso-table-expr

Lezer grammar for the **table-expression** mini-language shown in the Enso GUI's
node editor (e.g. filter expressions, calculated column formulas). Not a full
Enso parser — just the small subset used in inline widgets.

## Build

Grammar source is generated via `@lezer/generator` at compile time (see
`package.json` devDependency); the TypeScript wrapper in `src/index.ts` glues it
into a CodeMirror `LanguageSupport`.

## Scope

Keep this grammar minimal. If a new syntactic construct is needed here and the
full Enso parser already supports it, prefer consuming the Rust parser (via
`rust-ffi` / `ydoc-shared/ast`) rather than duplicating grammar logic.

## Autocomplete

`src/autocomplete/` tells the GUI what to offer at the cursor
(`completionTypeAt`). Inside a call's parentheses it answers `functionInfo` with
the argument index and, when the cursor is in an empty argument or at the end of
a `..Name`, where a value would start (`argumentAt` in `arguments.ts`, which
counts commas in the text so that a half-typed call still works). The GUI's
`completionSource.ts` offers that argument's `tagValues` there
(`cast([Value], ..Ch` lists the `Value_Type`s).
