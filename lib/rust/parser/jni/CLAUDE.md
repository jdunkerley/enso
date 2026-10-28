# enso-parser-jni

JNI `cdylib` that exposes `enso-parser` to the JVM. The output library name is
`enso_parser` (see `[lib] name` in `Cargo.toml`); the engine loads it via
`System.loadLibrary("enso_parser")`.

## What to keep in mind

- Only narrow FFI surface — each `JNIEnv`-facing function here must match a
  `private static native` declaration in
  `../generate-java/java/org/enso/syntax2/Parser.java` (plus its public static
  wrapper and `Worker` method).
- The snippet queries the GUI asks (`isIdentOrOperator`, `selfArgSeparator`,
  `isNumericLiteral`) are thin wrappers over `enso_parser::queries`, which the
  WASM binding (`app/rust-ffi`) calls too. Put logic there, not here. The
  JVM-hosted ydoc server reaches them through `lib/java/ydoc-polyfill`
  (`ParserPolyfill` + `parser.js`); a function added to
  `app/ydoc-server-polyglot/src/ffiPolyglot.ts` needs all three layers, and
  `ParserPolyfillTest.definesEveryFunctionFfiPolyglotExpects` fails until it has
  them (#360).
- Parsing produces a raw buffer; the Java side uses the generated deserializers
  from `parser/generate-java/` to inflate it. Keep both in sync.
- Returned byte buffers are owned by the JVM after transfer; don't leak Rust
  allocations — use `JNIEnv::new_byte_array` / `byte_array_from_slice`.
- Panics in Rust become `RuntimeException` in the JVM, which is bad UX.
  Propagate errors as normal `Result` in Rust code and convert at the boundary.

## Build

The engine's SBT build invokes `cargo build -p enso-parser-jni --release` and
places the shared library where the runtime expects it (see
`project/Cargo.scala`).
