# src/providers/openedProjects/module/

The module store (`module.ts`, the open project's `Main.enso` as an AST) and the
import logic (`imports.ts`).

- `requiredImports` is what a suggestion entry needs; `addMissingImports` adds
  them, skipping covered and conflicting ones.
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
