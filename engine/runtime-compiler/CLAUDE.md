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
- **`pass/lint/ArgumentDisplayCheck`** (`Warning.ArgumentDisplay`) checks the
  `arguments:` map of a definition's doc front matter (block form only): an
  unknown argument, an argument without a default, an unknown value (not
  `always`, `selected`, `when_modified`) or the flow form `{a: b}` is a warning.
  The standard library build runs `lintEnso` with `-Werror`, so a warning fails
  it. A doc on the first definition of a module without imports is the module's
  doc and is not checked.
- **`pass/lint/ResolverSignatureCheck`** (`Warning.ResolverSignature`) checks
  widget resolvers, the functions given as an argument's annotation: past the
  first (the subject), every open parameter must be an argument of the annotated
  method defaulted to `Nothing`, or `search` (a `Text` defaulted to `""`). It
  reads a lambda's parameters, or those of the module method the annotation's
  head resolves to (GlobalNames / MethodCalls metadata, or a synthetic self
  argument naming a module; the module being compiled is read from the pass's
  own IR, any other through its `Module.getIr`), minus the arguments the
  annotation applies. A head it cannot resolve to a module method (a
  constructor, a type's method such as `Widget.from`) is skipped; an application
  whose head is a lambda is reported as a computed resolver. The warning is
  attached to the method or constructor (annotations live in metadata, which
  diagnostics reporting does not walk) at the annotation's location. `lintEnso`
  runs it with `-Werror`, test projects included.
- Pass metadata that goes into IR caches is registered in
  `pass/analyse/PassPersistance.java` with explicit `@Persistable` ids.
- **`X.type` names X's eigentype in a type position** (a conversion's source, an
  ascription). `pass/resolve/EigentypeReference.java` resolves it once to a
  `BindingsMap.Resolution` of X with `isEigentype = true`; read the flag (or
  `Resolution.referencedName`), never the name's spelling. Note [Eigentype
  References] lists the consumers. Static analysis types an `X.type` ascription
  as the type object `X` (`TypeResolver`), but does not match a conversion from
  one: `StaticModuleScope` accepts an `ATOM_EIGEN_TYPE` source so the module
  still builds, but `MethodTypeResolver.findConversion` looks sources up as atom
  types only, so a conversion from a type object is never found statically (no
  inference for `W.from X`, rather than a wrong one).

## Tests

`sbt runtime-compiler/test` runs only the small unit tests in `src/test`. Most
pass tests (`…MegaPass`, `SugaredTypeFunctionsTest`, `TypeSignaturesTest`, …)
live in `engine/runtime-integration-tests`.
