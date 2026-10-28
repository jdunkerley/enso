# engine/runtime-compiler

The compiler: `Compiler`, the pass pipeline (`Passes.scala`) and the passes in
`org.enso.compiler.pass` (`desugar`, `resolve`, `analyse`, `lint`, `optimise`).
The IR itself lives in `engine/runtime-parser`.

## Conventions

- **A new IR node has to be handled in several passes.** Typing-related nodes
  (`Type.Function`, `Type.Error`, `type.Set.*`) are built by
  `pass/resolve/TypeFunctions.scala` from applications of the operator names in
  its `knownTypingFunctions`, walked by `pass/analyse/DataflowAnalysis.scala`,
  and read by `pass/analyse/types/TypeCheckAlgorithm.java`. Grep for an existing
  node's name to find every site.
- Pass metadata that goes into IR caches is registered in
  `pass/analyse/PassPersistance.java` with explicit `@Persistable` ids.

## Tests

`sbt runtime-compiler/test` runs only the small unit tests in `src/test`. Most
pass tests (`…MegaPass`, `SugaredTypeFunctionsTest`, `TypeSignaturesTest`, …)
live in `engine/runtime-integration-tests`.
