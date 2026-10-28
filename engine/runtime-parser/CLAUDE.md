# engine/runtime-parser

Java side of the parser: `EnsoParser` calls the Rust parser (JNI) and `TreeToIr`
translates its `Tree` into the compiler IR (`org.enso.compiler.core.ir`). The IR
classes are generated: a class annotated `@GenerateIR` extends a `…Gen`
superclass that `runtime-parser-processor` writes from its `@GenerateFields`
constructor.

## Conventions

- **Unsupported syntax becomes an IR error, not an exception.** `TreeToIr`
  returns `translateSyntaxError(tree, reason)` or throws `translateEntity(…)` (a
  `SyntaxException` that a caller turns into the error IR). A reason with a
  fixed message is a singleton class in `ir/expression/errors/Syntax.java`
  (`EmptyParentheses`, `TypeContextUnsupported`, …), so tests can compare it by
  identity.
- **IR persistance ids are explicit.** `ir/IrPersistance.java` registers each
  persisted IR class with `@Persistable(clazz = …, id = N)`. Not every IR class
  is persisted (`Type.Ascription` is not, for instance). Removing one does not
  shift the others; do not reuse a freed id. IR caches are keyed by the engine
  version (`BuildVersion.ensoVersion()`), so there is no separate cache version
  to bump.
- **`T in Ctx` in a type is a syntax error** (`Syntax.TypeContextUnsupported`);
  the `Type.Context` IR node was removed. `in` itself is not reserved.

## Tests

`EnsoParserTest` (in `src/test`) compiles snippets straight to IR:
`sbt runtime-parser/test`.
