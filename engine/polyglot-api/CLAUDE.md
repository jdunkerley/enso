# engine/polyglot-api

The **wire format** crossing the Truffle language ↔ embedder boundary. Message
types here are serialized with `enso-persistance` (see `lib/java/persistance/`)
and flow between `language-server/` (embedder-side) and the
`RuntimeServerInstrument` inside `runtime/`.

Every wire message here (the types that cross the boundary) must be:

- **Serializable** by `enso-persistance`. Add a `@Persistable` annotation or
  matching `Persistance` instance.
- **Truffle-safe.** No references to `TruffleLanguage`/`Node` subclasses; no
  capturing of `Value`s.
- **Stable.** Removing or renaming a field breaks wire compat for in-flight
  sessions and for IR caches.

The exceptions are two JSON helpers that are not wire messages. `SuggestionJson`
is the one JSON form of `Suggestion`: the language server's `search/*` wire form
and a library's `catalogue.json` (`LibraryCatalogue`) both use it (circe,
`provided`, as in `pkg`). Change it and both change.

## Companion crate

`polyglot-api-macros/` — annotation processor that emits `Persistance`
boilerplate. Prefer it over hand-rolling.

## Naming

Messages are namespaced by domain (Runtime, Api, Suggestions, Expressions, …).
One message type per concern — don't bundle.
