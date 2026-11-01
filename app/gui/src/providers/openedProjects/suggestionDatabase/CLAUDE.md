# src/providers/openedProjects/suggestionDatabase/

The suggestion database: the GUI's copy of the language server's, behind the
component browser, the documentation panel and the widgets.

- `index.ts` — `SuggestionDb` (a `ReactiveDb` with indexes by path, owner, kind
  and constructor field) and `createSuggestionDbStore`, whose `Synchronizer`
  acquires `search/receivesSuggestionsDatabaseUpdates`, requests
  `search/getSuggestionsDatabase` as soon as it holds that capability (Note [The
  Suggestion Database Is Requested At Connect Time]) and applies every
  `search/suggestionsDatabaseUpdates` notification in order. The store loads the
  component groups after the first execution, and the libraries' declared public
  types.
- `lsUpdate.ts` — `SuggestionUpdateProcessor`: turns the language server's
  entries into `SuggestionEntry` objects and applies `Add`, `Remove` and
  `Modify` updates. A notification is applied as one batch.
- `entry.ts` — the entry types. `fromCatalogue` is set on an entry the language
  server inserted from the `catalogue.json` of an installed library that is not
  loaded yet; when the library loads, one notification removes it and adds the
  real entry (Note [Catalogue Entries In The Suggestions Database] in the
  language server's `SuggestionsHandler`). It behaves like any entry; spec 3 of
  the library system shows a download badge from it.
- `documentation.ts` — parses an entry's documentation (front matter: icon,
  group, aliases, `private`, …).
- `mockSuggestion.ts` — test entries, built through the update processor.
- Design: `docs/superpowers/specs/2026-10-31-library-catalogue-design.md`.
