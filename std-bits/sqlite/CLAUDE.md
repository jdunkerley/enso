# std-bits/sqlite

Java for `Standard.SQLite` (`distribution/lib/Standard/SQLite/`), packaged as
`std-sqlite.jar` with the `sqlite-jdbc` driver (thinned by
`lib/java/sqlite-wrapper`, whose natives go to `polyglot/lib`). Its only class
is `nativeimage/SqliteJdbcPatchedFeature`, the native-image feature
`build.sbt`'s `rebuildNativeImage` names; `stdLibsJars` puts this project's full
class path on the image class path for it. The JDBC plumbing is
`std-bits/database`'s.
