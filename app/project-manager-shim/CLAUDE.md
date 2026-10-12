# project-manager-shim

TypeScript Project Manager implementation used by **both the dev workflow and
the shipped Electron build**. The name "shim" is historical — this package began
as a dev-only stand-in for the Scala Project Manager under
`lib/scala/project-manager`, but the Scala PM is no longer wired into any build,
so this TS service is now the real thing.

## Why

The GUI needs a project manager socket for `pnpm dev:vite` and the packaged
Electron app. Running the old Scala/Java PM required a long build and a GraalVM
JDK. This package speaks the same protocol natively against a local engine
distribution — fast to iterate on, no JVM needed.

## Subpath exports

Consumers import by subpath (see `package.json#exports`):

- `project-manager-shim` — public helpers (`downloadEnsoEngine`,
  `findEnsoExecutable`, …).
- `project-manager-shim/fs` — filesystem glue.
- `project-manager-shim/handler` — JSON-RPC request handler.
- `project-manager-shim/localMetadata` — local labels and Recent store (see
  below).
- `project-manager-shim/projectService` — project-lifecycle service.

## Engine download

`scripts/download-engine.js` fetches a prebuilt engine distribution; cache is
under `~/.cache/enso` (or platform equivalent).

## Scope

Historically some advanced features (cloud projects, multi-engine, upgrade)
deferred to the old Scala PM. Those paths now need to live here or be served by
the language server / cloud directly — don't add Scala-PM back-references when
extending this package.

## Local metadata (`src/localMetadata/`)

`LocalMetadata` keeps what the local drive needs beyond the filesystem:

- `<userData>/labels.json` — label definitions,
  `{ version: 1, labels: Label[], deletedNames?: string[] }`. `deletedNames` are
  tombstones: a name on a project counts while it is a live label, is ignored
  while it is a tombstone, and is otherwise (a project from another machine)
  added as a new label when read.
- `<userData>/recent.json` — recently opened projects,
  `{ version: 1, entries: [{ path, projectId, openedAt }] }`, newest first, at
  most 20, unique by project UUID. Reads hide entries whose `project.json` `id`
  no longer matches; `recordRecent` prunes them.
- A project's labels — an optional `labels: string[]` in its
  `.enso/project.json`. Nothing in the engine reads that file (only this shim
  does), so the extra field is safe there.

`<userData>` is Electron's `app.getPath('userData')` in the app
(`app/electron-client/src/projectService.ts`), and `ENSO_DEV_USER_DATA_DIR` or
`app/gui/.dev-profile/userData` under the Vite middleware.

Rules worth keeping:

- **Write `project.json` only through `localMetadata/jsonFile.ts`**
  (`updateJsonFile`), which serialises writers per path and renames a temporary
  file into place. A plain `writeFile` of a fresh object drops `labels` (or
  `lastOpened`) written by someone else.
- A corrupt or newer `labels.json`/`recent.json` is renamed to
  `<name>.corrupt-<ts>`/`<name>.newer-<ts>` and treated as empty. A corrupt
  `project.json` is never moved: that would cost the project its UUID.
- Recent follows the shim's own changes: the generic `--filesystem-move-from`
  and `--filesystem-delete` commands rewrite or forget entries by path prefix
  (they also move whole folders), and `ProjectService` reports `project/rename`
  and `project/delete` by UUID through `ProjectLifecycleListener`.
- The endpoints are `labels/{list,create,delete}`, `project/set-labels` and
  `recent/{list,record,forget}` under `/api/project-service/`. Hosts pass the
  store to `handleProjectServiceRequest` and `handleFilesystemCommand`; without
  it, the routes answer with a JSON-RPC error and listings carry no labels.
