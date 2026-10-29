# lib/scala/edition-updater

Locates editions on disk and, if asked, downloads new ones (sbt project
`edition-updater`).

- `EditionManager.makeEditionProvider(…, updating)` gives a
  `FileSystemEditionProvider` (language home, `ENSO_EDITION_PATH` and the
  cache), or, when `updating`, an `UpdatingEditionProvider`. The updating one
  downloads a missing edition on lookup, and on `findAvailableEditions(true)` it
  fetches every edition from the `edition-providers` URLs in the global config.
  There is no default URL: `GlobalConfig.Default` has no edition providers, so
  nothing is downloaded until the user lists one. With the plain provider the
  `update` flag does nothing.
- `EditionManager.apply` defaults to `updating = false`. The language server
  passes `true` (for `editions/listAvailable`), and so does the runner's
  `DependencyPreinstaller`.
- `EditionUpdater` logs a failed source as a warning and carries on, so being
  offline means fewer editions, not an error.

## Tests

`sbt edition-updater/test` serves an `ExampleRepository` from
`library-manager`'s test sources, through the Node
`tools/simple-library-server`. Each suite takes a free port from
`DummyRepository.freePort()`, never a fixed one.
