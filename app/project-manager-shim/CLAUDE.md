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
- `project-manager-shim/localVersioning` — git-based versioning of local
  projects.
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
- A project's labels — an optional `labels: string[]` in its `package.yaml` (the
  engine preserves the key), read and written by `localMetadata/packageYaml.ts`.
  `readProjectLabels` moves labels that earlier versions wrote to
  `.enso/project.json` into `package.yaml` (whose own labels win) and strips
  them from `project.json`.

`<userData>` is Electron's `app.getPath('userData')` in the app
(`app/electron-client/src/projectService.ts`), and `ENSO_DEV_USER_DATA_DIR` or
`app/gui/.dev-profile/userData` under the Vite middleware.

Rules worth keeping:

- **Write `project.json` only through `localMetadata/jsonFile.ts`**
  (`updateJsonFile`), which serialises writers per path and renames a temporary
  file into place. A plain `writeFile` of a fresh object drops `lastOpened`
  written by someone else.
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

## Local versioning (`src/localVersioning/`)

`LocalVersioning` stores snapshots of local projects as git commits. Projects
versioned inside the same repository can share the same git history, with each
commit scoped to its own paths only — changes to project A are never recorded
with project B's. All git calls for a repository are serialized through
`runGit(queueKey: repoRoot)`, so commits are FIFO-sequenced and never race on
index.lock.

### Module and routes

- `src/localVersioning/index.ts`: `LocalVersioning` class with methods `status`,
  `init`, `commit`, `log`, `fileAt`, `setComment`, `restore`, `exportAt`,
  `commitMove`, and helper `repositoryOf`.
- `src/localVersioning/git.ts`: `findGit`, `runGit`, `findRepoRoot`,
  `identityArgs` (see _Identity fallback_ below).
- Routes (POST to `/api/project-service/versioning/*`): `status`, `init`,
  `commit`, `log`, `file-at`, `restore`, `duplicate-at`, `set-comment`. See
  `handler/projectService.ts` for request/response shapes.

### Serial queue

All git calls for a repository go through
`runGit(command, args, {queueKey: repoRoot})`. Each repository has its own
queue; calls are processed FIFO, so no race on `index.lock` within one repo.
Queues drain themselves (entries are cleaned when they complete); a failing call
does not block later ones.

### Identity fallback

`identityArgs` tries `git var GIT_AUTHOR_IDENT`. If unavailable (a minimal git
config or env override), it falls back to a hardcoded identity
(`Enso IDE <noreply@enso.org>`). Commits and notes always have an author.

### Ignore lines

Versioning appends two lines to `.gitignore`:

- `**/.enso/` — the IDE-generated project metadata (id, GUI settings)
- `*.bak` — backup files from restore Unless a `**/.enso/` line already exists
  (in which case `.gitignore` is left alone, even if `*.bak` is missing). The
  lines are added only when `init` is called; a repository's `.gitignore` is
  otherwise never touched. **The `.enso/` folder is excluded from all commits
  independently of `.gitignore`**, via pathspec, so a project can track `.enso/`
  if needed — it will not be versioned.

### Notes reference

Comments on versions are stored as git notes under `refs/notes/enso`. Each
commit can have one note; `setComment` overwrites any existing note. Notes are
never signed, even if the user's git config signs commits (via
`-c commit.gpgsign=false`).

### Close hook ordering

`ProjectService.openProject` registers a `'version-on-close'` shutdown hook
**before any other hook** (e.g. rename). It commits the project as
`Saved on close` if there are changes; a failure is logged and returned as
`versioningWarning` on the `closeProject` result, but the close still succeeds.

### Timeouts and robustness

- Callers that block (the close hook, `commitMove` on rename/move) bound their
  git call with `withinVersioningTimeout(15 s)`. If the timeout fires,
  `VERSIONING_TIMEOUT_MESSAGE` is raised, but **the git process keeps running**
  (it is not killed). Killing mid-commit can leave `index.lock`, blocking future
  operations, so a stuck process is preferred.
- Every commit and note passes `--no-verify` (bypasses user hooks) and
  `-c commit.gpgsign=false` (bypasses signing), so versioning never hangs on
  user configuration.
- `commit` skips paths with nothing tracked (no `HEAD`, not staged) and no
  changes on disk.

### Known limitation

Moving a project out of its repository (or to another repository) leaves the old
path's removal uncommitted. A future enhancement would detect this and make one
final commit at the old path before moving.
