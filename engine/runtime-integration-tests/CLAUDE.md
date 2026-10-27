# engine/runtime-integration-tests

End-to-end engine tests (ScalaTest and JUnit) that run the compiler and the
interpreter through a live context. Compiler pass tests are here too, under
`src/test/scala/org/enso/compiler/test/`, not in `runtime-compiler`.

Run one class with
`sbt "runtime-integration-tests/testOnly org.enso.compiler.test.semantic.TypeSignaturesTest"`;
the whole project takes a long time.
