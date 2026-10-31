# project-view/components/ComponentBrowser/

The component browser's list: what is shown and in which order.

- `filtering.ts` — `Filtering.filter` decides whether an entry matches and its
  score: methods only, not `private`, not in a standard library's `Internal`
  module unless a self type is known, the self type, and the search pattern
  (words, initials, aliases, owner). Lower scores are better.
- `component.ts` — `makeComponentLists` builds the groups' lists, ordered by
  `compareSuggestions`: score; then, while searching, entries of the libraries
  the module imports and of the project itself (`importedLibraries` in
  `module/imports.ts`); then group, kind, module and id. The main view (no
  search text) is not reordered by imports.
- `ComponentList.vue` — renders the lists; it reads the module's imports from
  the module store.
- `input.ts` — the browser's input and what accepting an entry inserts,
  including `requiredImports`.
