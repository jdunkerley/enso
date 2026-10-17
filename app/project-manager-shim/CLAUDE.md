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

`LocalVersioning` stores snapshots of local projects as git commits, using the
user's own git CLI. Projects inside the same repository share its history, but
every commit is scoped to its own paths — changes to project A are never
recorded with project B's, and a change the user staged by hand elsewhere is
neither committed nor unstaged.

### Module and routes

- `src/localVersioning/index.ts`: `LocalVersioning` (constructed with a
  `VersioningConsent`) with `status`, `init`, `enable`, `disable`, `commit`,
  `commitIfEnabled`, `log`, `fileAt`, `setComment`, `restore`, `exportAt`,
  `commitMove`, and the lookup `repositoryOf`.
- `src/localVersioning/consent.ts`: `VersioningConsent`, the persisted record of
  enabled repositories (see _Consent_ below).
- `src/localVersioning/git.ts`: `findGit`, `runGit`, `findRepoRoot`,
  `repositoryKey`, `identityArgs` (see _Identity fallback_ below).
- Routes (POST to `/api/project-service/versioning/*`): `status`, `init`,
  `enable`, `disable`, `enable-if-inside`, `commit`, `log`, `file-at`,
  `restore`, `duplicate-at`, `set-comment`. `enableIfInside(repoRoot, rootPath)`
  enables a repository whose root is the GUI's local root or inside it,
  comparing `repositoryKey`s (real paths), unless the user opted out of it. See
  `handler/projectService.ts` for request/response shapes. `commit` with an
  empty or whitespace-only `message` saves as `Saved`. The `restore` route (not
  `LocalVersioning.restore`) refuses a running project.

### Consent: a repository is versioned only once it is enabled

`findRepoRoot` finds _any_ enclosing repository: a dotfiles repo in the user's
home, a work monorepo above the projects folder. Committing to it unasked would
put "Saved on close" commits on whatever branch is checked out. So the shim
versions a repository only once it is _enabled_.

- Consent is a per-repository record in `<userData>/versioning.json`
  (`{ version: 1, enabledRepositories: [...], disabledRepositories?: [...] }`,
  written by `VersioningConsent` through the `jsonFile.ts` helpers, so a corrupt
  or newer file is moved aside and read as empty, as for `labels.json`). It is
  never written into the user's repository or git configuration. Repositories
  are compared by real path, lowercased on Windows (`repositoryKey`, which the
  operation lock uses too).
- `disable` records an opt-out (`disabledRepositories` in `versioning.json`,
  still version 1); only `enable` clears it; `status` reports `optedOut`.
  `enableIfInside` never re-enables an opted-out repository.
- Hosts construct `LocalVersioning` with a store in `<userData>` (Electron:
  `app.getPath('userData')`; dev middleware: `DEV_USER_DATA_DIRECTORY`). A
  `LocalVersioning` without one must not exist outside tests.
- `status` reports `enabled` (`false` with no git or repository); `changed`,
  `lastVersion` and `blocked` are computed regardless, so the GUI can show a
  prompt. `init` enables the repository it creates. `enable(repoRoot)` rejects a
  path that is not a repository root.
- Not enabled: the close hook (`commitIfEnabled`) and `commitMove` skip silently
  (no warning); `commit`, `restore` and `setComment` reject with
  `Versioning is not enabled for the repository at <repoRoot>.`. `log`, `fileAt`
  and `exportAt` change nothing in the repository and work regardless.
- The check runs inside the locked operation, through `this.consent` (never a
  public locked method).

### Serialisation: an operation lock and a call queue

- **Operation lock.** Each public operation (`status`, `commit`, `log`,
  `fileAt`, `setComment`, `restore`, `exportAt`, `commitMove`) holds its
  repository's lock from its first git call to its last, so a commit's several
  calls, and the `rev-parse HEAD` that gives its id, never interleave with
  another operation; reads take it too, for a consistent snapshot. The lock is
  keyed by the repository's real path and shared by all instances. Operations
  call only the unlocked `…In` helpers (`restore` → `commitIn`, `setComment` →
  `logIn`), never a public method, so they cannot wait on themselves. A failing
  operation releases the lock.
- **Call queue.** Every git call also goes through
  `runGit(cwd, args, { queueKey: repoRoot })`, which runs one call per
  repository at a time, FIFO. Queues drain themselves; a failing call does not
  block later ones.

Both only order the IDE's own calls. The user's git, run at the same time, can
still hit `index.lock`; such a failure is reported (`blocked`, or a rejected
commit), never retried silently.

### How git is run

`runGit` adds `-c core.quotepath=false`, `GIT_TERMINAL_PROMPT=0` and
`GIT_OPTIONAL_LOCKS=0` (read-only commands such as `status` must not take the
index lock just to refresh it; commands that change the index take it anyway),
and drops inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`,
`GIT_NAMESPACE` and `GIT_PREFIX` (a caller's own `env`, such as `exportAt`'s
`GIT_INDEX_FILE`, still applies). `findGit` caches only a git it found, so
installing git while the IDE runs needs no restart.

**Every path from data reaches git as a literal pathspec**: `literal(p)` gives
`:(literal)<p>`, `excludeEnso(p)` gives `:(exclude,literal)<p>/.enso`, and
`projectPathspecs(p)` is the pair, used by `status`, `log`, `add`, `reset`,
`diff`, `commit`, `restore`, `rm`, `clean`, `ls-files` and `ls-tree`. A plain
pathspec would read `*`, `?` and `[` in a folder name as a glob, matching a
sibling (`P [x]` matches a file `P x`) — and `clean` would delete it.
`GIT_LITERAL_PATHSPECS=1` is no alternative: it disables the exclude magic too.
`<id>:<path>` revisions are not pathspecs, and are resolved (`cat-file -e`)
before use.

### Version ids

`fileAt`, `setComment`, `restore` and `exportAt` accept only a full commit hash
(40 or 64 lowercase hex digits), so nothing from a caller can reach git as an
option (`--output=…`) or a revision expression (`HEAD~1`); abbreviated ids are
rejected. `setComment`, `restore` and `exportAt` also check the id is in the
project's own `log`.

### Identity fallback

`identityArgs` tries `git var GIT_AUTHOR_IDENT`. If git has no identity (a
minimal config), commits and notes use `-c` overrides for
`Enso <noreply@enso.org>`; nothing is written to the user's config.

### Ignore lines

`init` appends two lines to the root `.gitignore`, unless a `**/.enso/` line is
already there (then the file is left alone, even without `*.bak`):

- `**/.enso/` — the IDE-generated project metadata (id, GUI settings).
- `*.bak` — editor and backup files, ignored by convention.

A repository's `.gitignore` is otherwise never touched. **The `.enso/` folder is
excluded from every commit independently of `.gitignore`**, via pathspec, so it
is never versioned even in a repository that tracks it.

### Notes reference

Comments on versions are git notes under `refs/notes/enso`. Each commit has at
most one; `setComment` overwrites it. `log` shows the note, else the commit
message without any `Enso-Moved-From` trailer. An empty comment removes the note
(`notes remove`, with the identity fallback).

### Close hook and moves

`ProjectService.openProject` registers a `'version-on-close'` shutdown hook
before any rename hook, so a project is saved before its directory moves. The
runner runs shutdown hooks in registration order, and `remove-from-list` is
registered first (when the engine starts), so the project is no longer listed as
running while its close commit is made. The hook commits the project as
`Saved on close` if it changed and the repository is enabled; a failure is
logged and returned as `versioningWarning` on the `closeProject` result, and the
close still succeeds.

A rename (`renameProject`) or a filesystem move of a project directory commits
both paths together (`commitMove`), with an `Enso-Moved-From: <old path>`
trailer (repository-relative). `log` follows it, reading the commits at the
current path newest first up to the first one with a trailer:

- a trailer naming another path is a move _in_: that commit is listed, and the
  commits before it at the old path follow (at most 100 moves), so A → B → A
  lists all three stretches, and a reused name (B deleted, A renamed to B) shows
  A's history, not the deleted B's;
- a trailer naming the current path is a move _away_ by an earlier project:
  neither it nor anything older at that path is listed.

A trailer path that is not plain and repository-relative (absolute, with
empty/`.`/`..` segments, starting with `:` or `-`, or containing `\`) is
ignored, since anyone can write a commit message. Glob characters are allowed
(folders such as `Projects [2026]` are real): every pathspec is literal, see
_How git is run_. A project at the repository root never follows trailers; as
`git log -- .` lists every commit, its history starts at the commit that last
added the root `package.yaml`.

`fileAt`, `exportAt` and `restore` use the path the project had at the version,
and resolve `<id>:<path>` (`cat-file -e`) before using it, so a missing path
fails as such. A restore across a move replaces the current path's files with
the old path's tree (`rm --cached`, `read-tree --prefix`, `restore --worktree`,
`clean`). Every precondition is checked before the work tree or index changes;
if a step still fails, the index is reset to `HEAD` for the project (no deletion
stays staged).

### Timeouts and robustness

- The close hook and `commitMove` bound **all** their git work — the repository
  lookups included — with `withinVersioningTimeout` (15 s), then give up with
  `VERSIONING_TIMEOUT_MESSAGE`. **The git process is not killed** (killing it
  mid-commit can leave `index.lock`): it runs on, and its operation keeps the
  repository's lock until it ends, so later operations on that repository wait
  for it. That is the accepted cost.
- IDE commits and notes are automatic snapshots, so the user's configuration for
  hand-written commits never applies: `--no-verify` (skips `pre-commit` and
  `commit-msg`), `-c core.hooksPath=<null device>` (no hook at all runs,
  `post-commit` and auto-push hooks included) and `-c commit.gpgsign=false` (no
  signing prompt).
- A merge, rebase, cherry-pick, revert or bisect in progress blocks versioning
  (`blocked` in `status`; `commit` rejects). One `git rev-parse --git-path …`
  call finds every state's file.
- `commit` skips paths with nothing tracked (no `HEAD`, not staged) and no
  changes on disk.
- `exportAt` creates the target's parent if needed and claims the target with a
  non-recursive `mkdir` (an existing directory is rejected, never used or
  removed).

### Known limitations

- Moving a project out of its repository (or to another repository) leaves the
  old path's removal uncommitted.
- Deleting a project, or moving a folder that contains projects, leaves the
  removal uncommitted too; it shows in the user's `git status`.
- A restore across a move is refused when the repository tracks the project's
  `.enso/` both in the version's tree (at the old path) and in the index at the
  current path: `read-tree --prefix` would fail with
  `error: Entry '<path>/.enso/…' overlaps with '<path>/.enso/…'.  Cannot bind.`
  The check runs first, so nothing changes. A tracked `.enso/` on one side only
  does not block it.
- A project at the repository root can only be restored to a version recorded at
  `.` (which, as it never follows moves, is every version it lists); a version
  from another path is refused, never restored over the whole repository.
- At a move boundary `log` follows first parents only (`<move commit>^`): a move
  recorded in a merge commit follows its first parent.
- If a cross-move restore fails after its `restore --worktree` step, the index
  is reset but the work tree may hold part of the old version; `HEAD` (the
  `Saved before restore` commit) still has everything. Any restore that fails
  after that commit says so:
  `Restoring failed; your work was saved as the version 'Saved before restore' and can be restored from the list. (<git's message>)`.
