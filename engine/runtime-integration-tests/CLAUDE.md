# engine/runtime-integration-tests

End-to-end JUnit and ScalaTest tests that run the whole engine in a live
polyglot context. Java tests live under `src/test/java/org/enso/interpreter/`,
Scala ones under `src/test/scala/`.

## Running

Run one or a few classes rather than the whole suite:

```bash
sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EqualsTest"
sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EqualsTest -- --tests=testUncachedEqualsAcrossConversion"
```

Tests run with Java assertions on (`-ea`), so Truffle's own checks, such as
"Node must be adopted by a RootNode", fire here.

## Writing tests

- `ContextUtils.createDefault()` (from `lib/java/test-utils`) as a `@ClassRule`
  gives a context that is already entered, so a test can call language-side
  nodes directly, including `SomeNode.getUncached()`.
- `ctxRule.createValue(expr, imports)` evaluates an Enso expression;
  `ctxRule.unwrapValue(value)` gets the runtime object behind it.
- Equality tests (`EqualsTest`, `EqualsConversionsTest`, `EqualsMultiValueTest`,
  `hash/HashCodeTest`) should cover both the cached node (through a
  `TestRootNode`) and `EqualsNode.getUncached()`: the uncached path runs
  different specializations and has diverged before (#67).
