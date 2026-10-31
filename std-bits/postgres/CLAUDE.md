# std-bits/postgres

Ships the `postgresql` JDBC driver (and its `checker-qual`) for
`Standard.Postgres` as `polyglot/java` jars; no Java of its own. The Postgres
code is Enso, in `distribution/lib/Standard/Postgres/`; the shared dialect is
`Standard.Database.Postgres_Family`.

These jars are not on the native image class path (`stdLibsJars` in
`build.sbt`): the library runs on the guest JVM, like `std-microsoft`.
