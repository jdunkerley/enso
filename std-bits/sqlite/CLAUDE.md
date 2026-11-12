# std-bits/sqlite

Packaging project for `Standard.SQLite` (`distribution/lib/Standard/SQLite/`).
It has no Java sources: `build.sbt`'s `std-sqlite` produces an empty
`std-sqlite.jar` and, as a side effect, thins the `sqlite-jdbc` driver into
`polyglot/java` (through `lib/java/sqlite-wrapper`) and puts its native library
in `polyglot/lib`. The JDBC plumbing is `std-bits/database`'s.

`Standard.SQLite` is deliberately **not** part of the GraalVM native image (it
used to be, with a native-image `Feature` here). Like `Standard.Microsoft`, it
runs on the JVM only, loading the driver and its native library from the bundle;
under the native launcher it fails with "Standard.SQLite's Java is not part of
the native engine" (Note [A Library's Java Must Be In The Native Image] in
`EnsoPolyglotJava`). Do not add a `native-image.properties` or reflect config
here: nothing reads it, and `sqlite-jdbc`'s own would break class loading in the
image if the jar ever returned to the image class path.
