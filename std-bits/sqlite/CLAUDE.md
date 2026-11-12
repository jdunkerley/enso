# std-bits/sqlite

Packaging project for `Standard.SQLite` (`distribution/lib/Standard/SQLite/`).
It has no Java sources: `build.sbt`'s `std-sqlite` produces an empty
`std-sqlite.jar` and, as a side effect, thins the `sqlite-jdbc` driver into
`polyglot/java` (through `lib/java/sqlite-wrapper`) and puts its native library
in `polyglot/lib`. The JDBC plumbing is `std-bits/database`'s.

The engine runs only on the JVM since the native image went (#664): the
library loads the driver and its native library from the bundle. Do not add a
`native-image.properties` or reflect config here: nothing reads it.
