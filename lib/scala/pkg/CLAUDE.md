# lib/scala/pkg

The Enso package format: `Package` (a project or library root with its
`package.yaml`, `src/`, `polyglot/` and `.enso/` directories), `Config` (the
parsed `package.yaml`), `QualifiedName`, and the package manager that creates
and loads packages. Used by the compiler, the runtime and every CLI tool.

## Gotchas

- **IR caches are per user, not per package.** `ModuleCache`
  (`engine/runtime/.../caches/ModuleCache.java`) writes them under the
  distribution's `cache/ir` directory
  (`DistributionManager.LocallyInstalledDirectories.irCacheDirectory`), so
  `Package` has no IR cache directory. Bindings and suggestions caches are still
  per package, under `.enso/cache/`.
- **`Package.sourceHash` is a file format.** A library's `catalogue.json`
  records it and the language server compares it with the library on disk, so
  changing the definition makes every existing catalogue stale (they are skipped
  until recompiled). It also keys the library's bindings and suggestions caches
  (Note [Library Caches Are Keyed By The Sources] in the engine's
  `LibrarySourceHashes`), so changing it makes every user rebuild those once.
  The definition is in its doc comment.

- **The new-project template ships its full id map.**
  `src/main/resources/default/src/Main.enso` names every AST's id, so the first
  open of a new project needs no id-assigning edit (which would re-execute it).
  Regenerate the map with `UPDATE_TEMPLATE_ID_MAP=1` (see
  `app/ydoc-server/CLAUDE.md`) after changing the template's code. After
  removing or inserting lines, first shift the id map's spans and re-deflate the
  metadata `snapshot` (the id map resolves against it whenever it differs from
  the file), so the welcome node keeps its id; a regeneration after that changes
  no span and no code (it re-mints the other entries' random ids, which is why
  the shifted file is the one to commit).

## Testing

`sbt pkg/test`.
