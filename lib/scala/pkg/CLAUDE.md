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
  until recompiled). The definition is in its doc comment.

## Testing

`sbt pkg/test`.
