# lib/scala/editions

The edition model and its YAML form (sbt project `editions`): `Editions` (`Raw`
and `Resolved` editions, libraries, repositories), `EditionResolver` (loads
parents through an `EditionProvider`), `EditionSerialization`, and
`DefaultEdition` (the bundled edition as a parent,
`BuildVersion.currentEdition`).

- `provider/FileSystemEditionProvider` looks an edition up in a list of
  directories, first hit wins. It can be told to ignore some names in some
  directories (`ignoredNames`); `edition-updater`'s `EditionManager` uses that
  for the user's cache.
- Compiling this project writes `distribution/editions/<currentEdition>.yaml`
  from `distribution/edition.template.yaml` (`project/Editions.scala`).

## Tests

`sbt editions/test`.
