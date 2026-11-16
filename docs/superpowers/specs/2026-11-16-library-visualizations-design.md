# Library visualizations: a library ships its own visualization

Status: approved design (2026-11-16). Pilot: the Image visualization moves from
the GUI into `Standard.Image`.

## Goal

A library can provide a visualization by shipping Vue files in a
`visualizations/` folder beside `src/`. The GUI offers them once the library is
loaded, and a type's `Id.from` conversion can make one its default. The Image
visualization is the first to move; the GUI keeps no code that only one library
needs.

## Where we are

- The GUI already compiles Vue files at run time: a project's `visualizations/`
  folder is watched (`ls.watchFiles`), each `.vue` file is compiled in a web
  worker (`stores/visualization/compiler.ts`: `compiler-sfc` + `sucrase`) and
  registered as `{ kind: 'CurrentProject', name }`. Files are read through the
  data server with the custom address `enso-current-project:<path>`
  (`compilerMessaging.ts`).
- Visualization ids already have `{ kind: 'Library', name }`
  (`ydoc-shared/src/yjsModel.ts`); node metadata stores it, and the default
  visualization lookup (`visualizationData.ts`) already reads
  `{"library": {"name": ...}, "name": ...}`. Only loading is missing:
  `useVisualizationStore().get` logs "Library visualization support is not yet
  implemented".
- The language server adds a content root for every library it loads
  (`ContentRootManagerActor`, on `Api.LibraryLoaded`) and sends `file/rootAdded`
  with `{ root: { type: 'Library', id, namespace, name, version } }`. The GUI
  does not listen to it.
- `Standard.Image` already produces the data (`Image.to_js_object` gives
  `{mediaType, base64}`) and chooses the visualization (`Id.from (that:Image)`),
  but it returns `Id.Builtin "Image"` because #758 removed `Id.Library` (spec
  `2026-11-14-viz-id-conversion-and-viz-json-design.md`).
- Packaging keeps the folder without change: the distribution copies each
  library directory whole except `CLAUDE.md` (`DistributionPackage.scala`,
  `contributorOnlyFiles`), and `LibraryUploader` archives every file it does not
  ignore.

## Design

### Enso

1. `Standard.Visualization.Id` gets back a library constructor:
   `Id.Library library:Text name:Text`. `to_js_object` writes
   `{"library": {"name": library}, "name": name}`; `Id.Builtin` still writes
   `"library": null`.
2. `Standard.Image`:
   `Id.from (that:Image) = Id.Library "Standard.Image" "Image"`. `Id.image` is
   deleted.
3. `ImageBase64Visualization.vue` moves to
   `distribution/lib/Standard/Image/0.0.0-dev/visualizations/Image.vue`
   unchanged in behaviour: `name = 'Image'`, `icon = 'image'`,
   `inputType = 'Standard.Image.Image.Image'`, the default preprocessor.
4. `docs/api` of Visualization is regenerated for the `Id` change.

### GUI

1. **Library roots.** The visualization store listens to `file/rootAdded` (and
   reads the roots already in the session's `contentRoots`). For each root of
   type `Library` it calls `ls.watchFiles(root.id, ['visualizations'], …)`. A
   library without the folder is skipped quietly (the same `FILE_NOT_FOUND`
   check as for the project, without the console message).
2. **One code path for project and library folders.** The current `onFileEvent`
   is generalised to take the root and the module (`{ kind: 'CurrentProject' }`
   or `{ kind: 'Library', name: '<namespace>.<name>' }`). The per-path maps and
   abort controllers are keyed by root and path. Added and modified files
   compile; removed files are unregistered. Live reload therefore works for a
   local library being edited under `~/enso/libraries`, as it does for a
   project.
3. **Reading library files.** `currentProjectProtocol` is replaced by a general
   `enso-root:<rootId>/<path>` address; the worker's fetch handler reads
   `{ rootId, segments }` from the data server for any root. Style elements are
   tagged with the full address, so removal still finds them.
4. **Loading a library visualization.** In `get()`, the `Library` branch returns
   the compiled module once it is registered. A request that arrives before the
   library's root or its files are compiled waits for them, up to a time limit
   (10 s); after that it rejects, and `visualizationData.ts` shows the existing
   "was not found in the library" error.
5. **Offering.** Library visualizations go into the same
   `VisualizationMetadataDb` as the others, so `byType` offers them by
   `inputType`/`dataType` as now. They appear only once something imports the
   library; an Image node needs that import anyway.
6. **Old saved ids.** A node saved with `{ kind: 'Builtin', name: 'Image' }` is
   read as `{ kind: 'Library', name: 'Standard.Image' }, name: 'Image'`. The
   mapping is one table of moved ids in the store, applied where a
   `VisualizationIdentifier` is resolved (`get`, `icon`), so saved projects keep
   their image view and the metadata is rewritten only when the user changes the
   visualization.
7. `ImageBase64Visualization.vue` leaves the built-in list and the GUI.

### What a library visualization can use

The same as a project visualization: `vue`, `d3` and the GUI's `builtins` module
(`useVisualizationConfig`, `defineKeybinds`), plus scripts it lists in
`scripts`. This design does not widen that set; Image needs nothing more.

### Security

A library's visualization runs its JavaScript inside the IDE window. This adds
no new trust: importing a library already runs its Enso and Java code on the
user's machine.

## Testing

- **Every shipped library visualization compiles and mounts.** A GUI unit test
  finds `distribution/lib/Standard/*/0.0.0-dev/visualizations/*.vue`, compiles
  each with the run-time compiler and mounts it with sample data. It replaces
  the type-checking the file loses by leaving the GUI build; it runs in the GUI
  unit job, so `gui-changed-files.yml` gains the path
  `distribution/lib/**/visualizations/**` (today it does not list
  `distribution/`).
- **Store tests** with a mocked language server: a library root added after
  start registers its visualizations under the library id; a `get` before the
  root arrives waits and then resolves; one with no library rejects after the
  limit; a file removed is unregistered; the old `Builtin "Image"` id resolves
  to the library one.
- **Enso:** `Visualization_Tests` checks `Id.Library` JSON and that an `Image`
  gives `{"library": {"name": "Standard.Image"}, "name": "Image"}`.
- **Engine:** `RuntimeVisualizationsTest` ("be able to use external libraries…")
  is checked for a dependence on `Id.image`.
- **Hand test (installer):** an image node opens in the Image view; a project
  saved before the change keeps it; a local library with a `visualizations/`
  folder appears and reloads on edit.

## Not in scope

- Moving the Geo map (to `Standard.Geo`) or the SQL view (to
  `Standard.Database`): follow-ups once Image proves the path.
- Pre-built JS modules from libraries, and a wider `builtins` API.
- Showing a library's visualizations before the library is imported.

## Delivery

One PR: the Enso change, the move and the GUI loader land together (the GUI
alone would lose the Image view; the Enso alone would point at nothing). It is a
feature, so it waits for the owner's installer test, takes a changelog entry
("Libraries can provide their own visualizations"), and carries before/after
screenshots of an image node (which should look the same).
