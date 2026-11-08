# src/providers/openedProjects/module/

The module store (`module.ts`, the open project's `Main.enso` as an AST) and the
import logic (`imports.ts`).

- `requiredImports` is what a suggestion entry needs; `addMissingImports` adds
  them, skipping covered and conflicting ones.
- `requiredImportsForTypeName` turns a widget option's `requires` (a type's
  qualified name, from the format dropdowns since #489) into the imports it
  needs: the suggestion entry (a catalogue entry counts), else the type its own
  library declares, else nothing (logged).
- `importedLibraries` is the set of libraries the module's imports name; the
  component browser ranks their entries first while searching.
- `missingImports` is the unresolved-name detector: the capitalised names a
  piece of code uses that no import covers, looked up among the suggestion
  database's types and then among the types the installed libraries declare
  (`public-types:` in their `package.yaml`, from the language server's
  `library/listPublicTypes`, loaded by the suggestion database store), which is
  how it finds a library the engine has not loaded. `addDetectedImports` runs it
  in an edit, so the imports are one undoable step with the change. It runs when
  a node's expression is committed (`graph.ts` `setNodeContent`,
  `nodeCreation.ts`), when a dropdown value without an entry is applied
  (`WidgetSelection/tags.ts`), and once when the module opens, after the
  suggestion database and the declared types have loaded (`importsAddedOnOpen`,
  shown by `GraphEditor/toasts.ts` only when imports were added). The code
  editor is not hooked: the next open covers its edits.
- Design:
  `docs/superpowers/specs/2026-10-30-postgres-sqlite-libraries-design.md`
  (section 3 and its Amendments).

## Carrying the module over a session replacement (#604)

When the project's ydoc server session is replaced, `reconnectProject`
(`$/providers/openedProjects`) makes the stores again. Before the old ones go it
takes `carryOverSnapshot()`: the module's text (`T_old`), its node metadata
(position, visualization, colour, display mode) with each AST's external id and
printed place (`saveAsts` in `carryOver.ts`), and `ownTexts`, the hashes of the
texts the module went through since the last transaction from the module doc's
`WebsocketProvider` (that update's text first; at most `OWN_TEXTS_LIMIT`). Once
the new stores have loaded the module (text `D_new`), `decideCarryOver`:

- `D_new == T_old` → `unchanged`: only the metadata is merged.
- `D_new` in `ownTexts` → `restore`: the file has nothing this client did not
  have, only its last edits are missing; `T_old` goes back as one undoable edit
  (`syncToCode`), with the metadata.
- anything else → `conflict`: the file is kept, and `FileChangedToast` offers
  "Restore my version" (the same edit).

The design on #604 compared `D_new` with the last server text only; that took
edits that had reached the file before the last unsynced ones for a conflict,
hence the set. When the text is `T_old`, the same text parses to the same tree,
so `planCarryOver` also finds a saved AST by its printed place (span, type,
index) and gives it its old external id back, unless another AST has it: node
ids, and so the carried selection, survive the fresh ids a new session's parse
may give.
