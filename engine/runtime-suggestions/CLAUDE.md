# engine/runtime-suggestions

Turns a compiled module's IR into the IDE's suggestion database entries.
`SuggestionBuilder` builds the types, constructors, getters, methods,
conversions and locals of a module, with each argument's `reprType` and
`tagValues`; `ExportsBuilder`, `ExportsMap` and `ModuleExportsDiff` track what
each module exports; `SuggestionDiff` and `SimpleUpdate` describe the changes
between two versions. The runtime's analysis jobs (`runtime-instrument-common`)
call it; the language server forwards the result to the GUI.

## Conventions

- A type position's `reprType` comes from the `TypeNames` resolution of the
  name, never from its spelling. `X.type`, X's eigentype (Note [Eigentype
  References] in `runtime-compiler`'s `EigentypeReference.java`), is reported as
  `<X's qualified name>.type`, so the GUI's `conversionSources` index keeps a
  conversion from the type object apart from one from X's values.

## Tests

`SuggestionBuilderTest` lives in `engine/runtime-integration-tests`
(`org.enso.compiler.test.context`), not here:

    sbt "runtime-integration-tests/testOnly org.enso.compiler.test.context.SuggestionBuilderTest"
