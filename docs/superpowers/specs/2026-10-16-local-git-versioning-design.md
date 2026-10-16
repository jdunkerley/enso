# Local projects versioned with git: design

Date: 2026-10-16. Status: approved in conversation; awaiting review of this
document.

## Goal

Give local projects a version history when the user has git installed:

1. **Versions are commits** in a git repository at (or above) the local root
   folder. If the root is not in a repository, the IDE offers to create one.
2. **A version is committed when a project is closed** (message "Saved on
   close"), including when the app quits with projects open.
3. **The user can save a version by hand**: Ctrl/Cmd+S saves at once with the
   comment "Saved"; Ctrl/Cmd+Shift+S or the save icon asks for a comment first.
4. **A "changed" indicator** shows when a project differs from its last version.
5. **The right panel's Versions tab works for local projects**: list, See
   changes, Compare, Restore, Duplicate, and editable comments.

Along the way, two tidy-ups:

- **Labels move from `.enso/project.json` into `package.yaml`**, so they are
  versioned with the project while `.enso/` stays ignored.
- **The engine's unused JGit-based VCS is removed.**

## Decisions

| Question                       | Decision                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which git                      | The user's git CLI, if installed; one repository at the root folder (or the repository the root is already inside).                                                               |
| What a version contains        | Everything in the project folder except `.enso/` (the engine's caches, `suggestions.db`, the old `.vcs/`, and `project.json`) and `*.bak`.                                        |
| Labels                         | Moved into `package.yaml` as a `labels` list, which the engine learns to preserve.                                                                                                |
| When versions are committed    | On close ("Saved on close"), on app quit (each open local project is closed properly first), and by hand (Ctrl+S "Saved"; Ctrl+Shift+S or the save icon with a comment).          |
| Offering `git init`            | In context, once: the first save or close of a local project when the root is in no repository. "Create", "Not now", "Don't ask again for this folder". Also in Settings → Local. |
| The changed indicator          | A dot beside the project name in the project view's top bar, a ● on its tab, and the save icon enabled only when there is something to save.                                      |
| Versions tab                   | List, See changes, Compare, Restore, Duplicate (and open), and comments editable afterwards through git notes. No tags.                                                           |
| Restore of an open project     | Close it (committing "Saved on close"), restore, reopen.                                                                                                                          |
| Where the git logic lives      | A `localVersioning` module in the project-manager shim, exposed as `/api/project-service/versioning/*` endpoints, as `localMetadata` is.                                          |
| The engine's VCS (`vcs/*` LSP) | Removed: the Scala manager, handlers, tests, protocol docs, the TypeScript wrappers, and JGit if nothing else uses it.                                                            |

Out of scope:

- tags on local versions (git tags are repository-wide, not per project);
- branches, remotes, push and pull, merge-conflict handling;
- versioning local files and folders that are not projects;
- offering `git init` for saved local directories outside the root (they are
  versioned only if already inside a repository);
- diffs of anything but `Main.enso` (the cloud's diff view shows only that).

## Background: what exists today

- **The engine autosaves.** Edits reach the Language Server through the ydoc
  server; the LS buffer writes to disk 6 s after the last edit
  (`MainModule.scala`, `withAutoSave(6.seconds)`), and closing a file flushes at
  once (`CollaborativeBuffer.scala`). Nothing in the GUI calls `text/save`, and
  there is no save, dirty state or `Mod+S` binding anywhere.
- **Closing a project** goes `openedProjects.closeProject` →
  `projectStates.closeProject` (stops the GUI scope and its ydoc connection
  first) → `LocalBackend.closeProject` → shim `project/close` →
  `OpenedProject.close()` (`ensoRunner.ts`): a graceful LS shutdown (newline on
  stdin, SIGKILL after 10 s), then its **shutdown hooks**. The HTTP response
  goes out after the hooks.
- **Quitting the app does not close local projects.** `beforeunload` in
  `openedProjects.ts` only waits for unsynced hybrid projects (with
  `SyncingProjectsModal.vue`); the LS processes lose their stdin.
- **Opening a project rewrites `.enso/project.json`** (`lastOpened`), and moving
  nodes rewrites `Main.enso`'s metadata block. The first is why `.enso/` is
  ignored; the second is accepted: a layout change counts as a change.
- **The engine's VCS is dead code.** `vcs/init|save|status|restore|list` are
  served by `languageserver/vcsmanager/` (JGit, one repo per project in
  `.enso/.vcs`, tracking `src/` only, authored as "Enso VCS"), wrapped in
  `ydoc-shared/src/languageServer.ts`, and called by nothing. Older projects on
  disk may still have `.enso/.vcs`; `.enso/` being ignored covers it.
- **The engine rewrites `package.yaml` from its own model.**
  `ProjectSettingsManager` (edition, prefer-local-libraries) saves through
  `Config.toYaml`, which writes only the fields `Config` knows, so an unknown
  key would be dropped.

## PR 1: labels in `package.yaml`

- **Engine:** `lib/scala/pkg`'s `Config` gains `labels: List[String]` (key
  `labels`, default empty, omitted from the YAML when empty), decoded and
  encoded like `authors`. The engine does nothing else with it.
- **Shim (`localMetadata`):** a project's labels are read from and written to
  `package.yaml`'s `labels` key, editing that key in place and leaving the rest
  of the file as it is (the `yaml` package's document API, which keeps comments
  and order). `filesystem-list` reads them from there.
- **Migration on read:** when `.enso/project.json` has `labels` and
  `package.yaml` has none, the labels are written to `package.yaml` and removed
  from `project.json`. If both have labels, `package.yaml` wins and
  `project.json`'s are removed.
- **Tombstones and definitions are unchanged**: the label list stays in
  `<userData>/labels.json`; `deletedNames` still filters names on read.
- Invisible to users (`CI: No changelog needed`).

## PR 2: remove the engine's VCS

- Delete `engine/language-server/.../vcsmanager/`, `requesthandler/vcs/`, their
  wiring in `MainModule`, `JsonConnectionController(Factory)`, `JsonRpc`,
  `BufferRegistry` and `Config` (`vcsManager` settings), and their tests
  (`GitSpec`, `VcsManagerTest`, and the VCS parts of the shared test bases).
- Delete the `vcs/*` sections of
  `docs/language-server/protocol-language-server.md` and the five wrappers and
  their types in `ydoc-shared`.
- Drop `org.eclipse.jgit` from `build.sbt` and `jgitVersion` from
  `project/Dependencies.scala` **only if no other project uses it** (it is
  listed in three projects and one module-path list); otherwise drop it from the
  language server alone. Regenerate the legal-review report and the
  `THIRD-PARTY` notices if JGit goes.
- Verification beyond `compile` (root `CLAUDE.md`): `Test/compile` and the
  language-server tests, `gatherLicenses`, `buildEngineDistribution`, and the
  JPMS module list.
- Invisible to users (`CI: No changelog needed`).

## PR 3: the shim's `localVersioning` module

### Running git

- `git` is found on `PATH` once per process (`git --version`); the result is
  cached. Git is run with the shim's existing spawn helper (`runCommand` in
  `ensoRunner.ts`, extracted to a shared helper), never through a shell, with
  `-C <repoRoot>`, `GIT_TERMINAL_PROMPT=0`, and `core.quotepath=false`.
- **One queue per repository**: every git call for a repository runs after the
  previous one finishes, so the IDE never races itself for `index.lock`.
- **Author:** the user's own git identity. If `git var GIT_AUTHOR_IDENT` fails
  (no identity configured), that one commit is made with
  `-c user.name=Enso -c user.email=noreply@enso.org`. The user's git config is
  never written.

### Endpoints (`/api/project-service/versioning/`)

All take a project path (or the root path) and return JSON-RPC results like
`localMetadata`'s routes.

| Endpoint      | Body                              | Result                                                                                                                     |
| ------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `status`      | `{ path }`                        | `{ git: boolean, repoRoot: string \| null, changed: boolean, lastVersion: { id, date } \| null, blocked: string \| null }` |
| `init`        | `{ rootPath }`                    | `{ repoRoot }`                                                                                                             |
| `commit`      | `{ path, message }`               | `{ id } \| { id: null }` (nothing to commit)                                                                               |
| `log`         | `{ path }`                        | `{ versions: { id, date, author, comment, isLatest }[] }`                                                                  |
| `fileAt`      | `{ path, id, relativePath }`      | the file's text at that version                                                                                            |
| `restore`     | `{ path, id }`                    | `{ id }` of the new "Restored version from …" commit                                                                       |
| `duplicateAt` | `{ path, id, title, parentPath }` | the new project's path and id                                                                                              |
| `setComment`  | `{ path, id, comment }`           | —                                                                                                                          |

- **`status`**: `changed` is `git status --porcelain -- <project>` being
  non-empty (untracked files included, ignored ones not). `blocked` is git's
  message when the repository is mid-merge, mid-rebase, or otherwise unusable;
  nothing is retried in a loop.
- **`init`**: `git init` in the root, then a root `.gitignore` with `**/.enso/`
  and `*.bak` **only if no `.gitignore` exists**. If one exists and does not
  ignore `.enso/`, the line is appended.
- **`commit`**: `git add -A -- <project>` then
  `git commit -m <message> -- <project>`, so a commit never includes another
  project's changes. Nothing to commit is not an error.
- **`log`**: `git log --format=… -- <project>`; `comment` is the version's git
  note (`refs/notes/enso`) if it has one, else the commit message.
- **`restore`**: refuses if the project is open (the GUI closes it first).
  Commits outstanding changes ("Saved before restore"), then
  `git restore --source=<id> --staged --worktree -- <project>`, which also
  removes files added since `<id>` (all tracked by then), then commits "Restored
  version from <date>". Nothing is ever lost.
- **`duplicateAt`**: writes the tree of `<project>` at `<id>` into a new project
  directory under `parentPath` (`git archive`), then gives it a new project id
  and name as the shim's `duplicateProject` does.
- **`setComment`**: `git notes --ref=enso add -f -m <comment> <id>`.

### Close and moves

- **A new shutdown hook, `'version-on-close'`**, runs after the graceful LS
  shutdown in `OpenedProject.close()` and commits "Saved on close" when the
  project is in a repository. A failure is logged and reported in the close
  response's warnings; it never fails the close.
- **Rename and move** (the shim's own `rename-project-directory` hook and
  `filesystem-move`): when both the old and the new path are in the same
  repository, the commit covers both paths, so the old path's removal is not
  left uncommitted.

## PR 4: saving in the GUI

### Provider

`$/providers/localVersioning` holds, per open local project, the `status`
result, refreshed every 5 s while the project is open, after every save, and
after the project's files change through the drive. Nothing is shown when
`status.git` is false.

### Saving

- **Flush first.** Before `commit`, the GUI asks the Language Server to write
  each open module (`text/save` with the buffer's current version, through the
  project's existing LS connection), so a save does not wait for the 6 s
  autosave.
- **Ctrl/Cmd+S** (`graph.saveVersion`) commits "Saved". **Ctrl/Cmd+Shift+S**
  (`graph.saveVersionWithComment`) and the save icon open a small dialog with an
  optional comment; Enter saves, an empty comment saves "Saved". Both are
  registered in `graphInputBindings.ts`, `project-view/providers/action.ts` and
  `keyboardShortcuts.ts`, with names in `english.json`.
- The save icon sits beside undo and redo in `TopBar.vue`. It is disabled when
  `changed` is false, and hidden when git is absent.

### The changed indicator

A dot beside the project name in `TopBar.vue`'s breadcrumbs, and a ● before the
title in `TabBar.vue`, while `changed` is true. Both have accessible names
("Changed since the last version").

### Offering a repository

- The first save or close of a local project whose root is in no repository (and
  git is present) asks: "Keep versions of your projects with git? This creates a
  repository in <root>." Buttons: **Create**, **Not now**, **Don't ask again for
  this folder**. The answer is remembered per root path in a persisted store.
  "Not now" asks again next session. It is never asked while the app is
  quitting.
- **Settings → Local** gains a "Versions" section: whether git was found, the
  repository's path or a **Create repository** button, and a reset of "Don't ask
  again".
- With no repository, saving offers the dialog again; closing behaves as today.

### Quitting

`beforeunload` (`openedProjects.ts`) also holds the quit while any local project
is open and in a repository: it closes each one properly (so each commits "Saved
on close") behind a "Saving versions…" dialog modelled on
`SyncingProjectsModal.vue`, then closes the window. A project that fails to
close within the shim's own timeout does not block the quit.

### Errors

A failed save shows a toast with git's message. A failed commit on close or quit
is a warning toast at most. `blocked` greys out the save icon with git's message
as its tooltip.

Feature PR: a changelog entry, screenshots, and the user's installer test before
it merges.

## PR 5: the local Versions tab

- **`LocalBackend` implements the version methods** over PR 3's endpoints:
  `listAssetVersions` (→ `log`), `resolveProjectAssetData` with a `versionId` (→
  `fileAt`), `restoreAsset` (→ `restore`), `duplicateProject` with a `versionId`
  (→ `duplicateAt`), and `updateAsset` with a `versionId` and `comment` (→
  `setComment`). A local version id is a commit hash, carried in the existing
  `S3ObjectVersionId` brand (to be renamed backend-neutrally in a later tidy-up,
  not here).
- **`AssetVersions.vue`** shows the list for a local project when versioning is
  available, instead of "local assets do not have versions". It passes the
  category's backend instead of always the remote one. Tags (`AddVersionTag`,
  `VersionTag`, the tag suggestions query) are hidden for local versions.
- **Restore of an open project:** close it (committing "Saved on close"),
  restore, reopen it.
- Folders and files in the local drive still show "local assets do not have
  versions" (the text is reworded to say only projects have them).

Feature PR: a changelog entry, screenshots, and the user's installer test before
it merges.

## PR 6: docs

`CLAUDE.md` files for the shim's `localVersioning`, the GUI provider, the
Versions tab, and `LocalBackend`; this spec marked implemented.

## Testing

- **Shim:** unit tests against real temporary repositories (git is on every CI
  runner): status before and after edits, init with and without an existing
  `.gitignore`, path-scoped commits with two projects changed, nothing to
  commit, no identity, a mid-merge repository, log with and without notes,
  `fileAt`, restore (files added, changed and removed since), duplicate at a
  version, and the close hook committing after the LS exits.
- **Engine:** `Config` round-trips `labels`; `ProjectSettingsManager` changes
  keep them. PR 2: the language-server test suite, `gatherLicenses`,
  `buildEngineDistribution`.
- **GUI unit tests:** the provider's refresh, the shortcuts, the save dialog,
  the init prompt's three answers, the Versions tab's gating.
- **Playwright:** a mocked versioning API in `integration-test/mock/localApi.ts`
  (as for labels and Recent): save with and without a comment, the indicator,
  the init prompt, the Versions tab's list, restore and duplicate.
- **By hand, on both hosts:** a real repository at the root, with git present
  and absent, before the feature PRs merge.

## Risks

- **OneDrive (or any sync tool) syncing `.git`** can corrupt a repository if two
  machines write at once. Documented, not designed around.
- **SIGKILL at the 10 s close timeout** may lose the last autosave; the close
  commit then records what is on disk.
- **Git notes are not pushed by default**: edited comments stay local unless the
  user pushes `refs/notes/enso`.
