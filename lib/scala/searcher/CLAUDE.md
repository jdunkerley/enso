# lib/scala/searcher

The suggestions repository behind the language server's `search/*` endpoints
(`search/getSuggestionsDatabase`, `search/getSuggestionsDatabaseVersion`,
`search/invalidateSuggestionsDatabase` and the
`search/suggestionsDatabaseUpdates` notification). JPMS module
`org.enso.searcher`; see `src/main/java/module-info.java` for what it exports.

## Layout

- `SuggestionsRepo.scala` — the repository interface; `SuggestionEntry`,
  `Database`, `data/QueryResult` are its value types. `removeAll(ids)` removes
  entries by id (the language server's catalogue entries).
- `memory/InMemorySuggestionsRepo.scala` — the only implementation. The database
  is held in memory; there is no SQLite (or other) persistence.
- `sql/Tables.scala` — despite the package name, not SQL: it holds
  `SuggestionRowUniqueIndex` (the identity the in-memory repo deduplicates
  suggestions by) and the column constants it uses. The `sql` package name and
  the bench/test packages under it are leftovers from the SQLite era.

## Testing

`sbt searcher/test`; JMH benchmarks live in `src/bench/`.
