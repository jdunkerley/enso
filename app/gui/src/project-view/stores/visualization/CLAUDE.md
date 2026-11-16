# stores/visualization/

The visualization store: which visualizations exist, which one a node opens, and
the run-time compiler that turns a `.vue` file shipped by a project or a library
into a visualization the GUI can mount. The built-in visualizations
(`components/visualizations/`) are registered here too; everything else is found
in a `visualizations/` folder.

## Modules

- `index.ts` — the store (`provideVisualizationStore` /
  `useVisualizationStore`): `byType` (what to offer for a type), `get` (the
  module for an id), `icon`. Registers the built-ins, starts one folder watcher
  per content root, and holds the library wait.
- `folderLoader.ts` — `watchVisualizationFolder`: watches one root's
  `visualizations/` folder with `ls.watchFiles`, compiles each `.vue` file on
  add/modify, unregisters it on removal. A newer event for a file aborts the
  older compilation. The same code serves project and library folders.
- `compilerMessaging.ts` — main-thread side of the compiler worker: sends
  compile requests, answers the worker's `fetch` requests from the data server,
  adds styles and imports to the page.
- `compiler.ts` — the Web Worker: fetches a file, compiles it with
  `compiler-sfc` and `sucrase`, rewrites and recursively compiles its imports.
  The header comment describes the message protocol.
- `compileSfc.ts` — the Vue-SFC and TypeScript compile steps, shared by the
  worker and the tests.
- `rootAddress.ts` — the `enso-root:` address (below). Imported by the worker
  and the main thread, so it must stay free of the DOM.
- `movedVisualizations.ts` — the table of visualizations that moved out of the
  GUI (below).
- `metadata.ts` — `VisualizationMetadataDb`: id →
  `{ name, inputType, dataType, icon }`, and the lookup of visualizations by
  type (`visualizationsForTypes`, which also follows `Id.from` conversions).
- `runtimeTypes.ts` — the shape of a compiled visualization module (`name`,
  `inputType`, `icon`, `scripts`, …) and `InvalidVisualizationModuleError`.

## Project and library folders

A visualization is a `.vue` file in a `visualizations/` folder beside `src/`:

- **Project**: `<project>/visualizations/`, registered as
  `{ kind: 'CurrentProject', name }`. A project without the folder is told how
  to add one (console info).
- **Library**: `<library>/visualizations/` (for `Standard.Image` that is
  `distribution/lib/Standard/Image/0.0.0-dev/visualizations/`), registered as
  `{ kind: 'Library', name: '<namespace>.<name>' }`, e.g. `Standard.Image`. The
  folder is optional; a library without it is skipped quietly. Packaging copies
  it with the rest of the library.

The store watches the project root, every content root of type `Library` the
connection has recorded (`ls.contentRoots`), and every later `file/rootAdded`.
`LanguageServer` records the roots itself, from its construction: those of each
initialization reply and each `file/rootAdded`, deduplicated by root id. The
store is created only when the graph editor mounts, which can be after the first
execution has already loaded a library (e.g. `Standard.Image`), so a root
announced in that gap must not depend on anyone listening at the time. A library
therefore contributes its visualizations once the language server has loaded it
(when something imports it), and editing a `.vue` file under a local library
(`~/enso/libraries`) reloads the open view, as for a project.

**Limitation:** the language server's `PathWatcher` stays in its initialized
stage when the watched path does not exist, so a `visualizations/` folder
created _after_ the watch started (for a project or a library) is not noticed
until the project is reopened. Editing files in a folder that already existed
reloads as usual.

A visualization's name is the `name` it exports, not its file name. A file that
exports no `name`/`inputType` is not a visualization (it may be a dependency of
one) and is logged at info level.

## The `enso-root:` address and the same-root import rule

The worker reads files through the data server, addressed as
`enso-root:<rootId>/<segment>/<segment>` (`rootAddress`, `parseRootAddress`).
There is no slash after the colon: the form is an opaque path, so `new URL`
leaves it alone and `resolveRelativeImport` does the `.`/`..` resolution itself.
It replaced the old `enso-current-project:` address, which could only name the
project.

**An import from a file in a root must stay in that root.**
`resolveRelativeImport` throws for `../../<other root id>/x.vue`, and
`parseRootAddress` refuses segments of `.`, `..` or holding `/` or `\`, so a
library's visualization cannot read another library's (or the project's) files.
The error is reported as a compile error of the importing file. Style elements
carry the address in `data-style-path` so a change removes exactly its own.

## Waiting for a library

`get()` for a `Library` id that is not registered yet (the library's root has
not arrived, or its files are still being read) waits for it, up to
`LIBRARY_WAIT_MS` (10 s). The wait ends when the visualization registers; after
the limit it rejects with

> `The library 'Standard.Image' has no visualization 'Image'.`

which `visualizationData.ts` catches and shows with the rejection's own text (it
is not the "was not found in the library" error). A rejected wait is dropped
from the cache, so a later request tries again.

## Moved ids

A node saves its visualization id in its metadata. When a built-in moves to a
library, `movedVisualizations.ts` maps the old id to the new one, and
`canonicalVisualizationId` is applied in `get` and `icon`, so projects saved
before the move keep their view. The saved metadata is rewritten only when the
user changes the visualization.

| Old id            | Now                                      |
| ----------------- | ---------------------------------------- |
| `Builtin` `Image` | `Library` `Standard.Image`, name `Image` |

Add a row when another built-in moves (Geo map → `Standard.Geo`, SQL Query →
`Standard.Database` are planned).

## What a library visualization can use

The same as a project visualization: `vue`, `d3`, the GUI's `builtins` module
(`useVisualizationConfig`, `defineKeybinds`), and scripts listed in `scripts`.
Nothing wider; it runs in the IDE window with the trust of the library's own
Enso and Java code.

## Tests

- `__tests__/folderLoader.test.ts`, `libraryVisualizations.test.ts` — the
  watcher and the store, against a mocked language server (library root added
  later, `get` before the root arrives, the 10 s limit, removal, moved ids).
- `__tests__/rootAddress.test.ts`, `movedVisualizations.test.ts`,
  `metadata.test.ts`, `availability.test.ts`, `compileSfc.test.ts`.
- `__tests__/shippedVisualizations.test.ts` — finds every
  `distribution/lib/Standard/*/0.0.0-dev/visualizations/*.vue`, compiles it with
  the run-time compiler and mounts the Image one with sample data. A library's
  visualization leaves the GUI's type-checking, so this is its only compile
  check. `.github/workflows/gui-changed-files.yml` lists
  `distribution/lib/Standard/*/0.0.0-dev/visualizations/**`, so the GUI unit job
  runs when only such a file changes.

Run from `app/gui`:
`CI=true corepack pnpm exec vitest run src/project-view/stores/visualization`
(without `CI=true`, missing snapshots are written silently).

## On the Enso side

`Standard.Visualization.Id` names the visualization a type opens with:
`Id.Builtin name` (GUI-implemented) or `Id.Library library name`
(`{"library": {"name": library}, "name": name}`), which the GUI resolves here.
`Standard.Image` answers `Id.Library "Standard.Image" "Image"`. See
`distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`.
