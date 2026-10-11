# Local labels and a local Recent list, PR 1: implementation plan

> **For agentic workers:** execute task by task with TDD (failing test, watch it
> fail, implement, watch it pass, commit). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the project-manager shim a `localMetadata` store (label
definitions, project labels, a Recent list), expose it as
`/api/project-service/` endpoints, return project labels from `filesystem-list`,
wire `<userData>` in Electron and the dev middleware, and add the matching
`ProjectManager` client methods. No UI.

**Architecture:** A new `app/project-manager-shim/src/localMetadata/` module.
`jsonFile.ts` owns atomic, per-path serialised JSON reads and writes and the
"move a corrupt or newer file aside" rule. `index.ts` owns the `LocalMetadata`
class, which keeps `labels.json` and `recent.json` in a user-data directory and
reads and writes the `labels` field of each project's `.enso/project.json`. The
HTTP handler (`handler/projectService.ts`) gains seven routes that call it; the
filesystem handler uses it to filter listing labels and to keep Recent entries
in step with moves and deletes; `ProjectService` notifies it of renames and
deletes. Every existing writer of `project.json` in the shim goes through the
same serialised read-merge-write, so `lastOpened` and `labels` never clobber
each other.

**Tech Stack:** TypeScript (Node, ESM), vitest, `enso-common` types.

**Spec:** `docs/superpowers/specs/2026-10-11-local-labels-and-recent-design.md`
(PR 1 of 4).

**Global Constraints:**

- No UI change; no CHANGELOG entry (`CI: No changelog needed`).
- `corepack pnpm` only. Never `git stash`, never `--no-verify`.
- Every package touched (shim, common, electron-client, gui) passes typecheck,
  `eslint --max-warnings=0` and its unit tests, after deleting `*.tsbuildinfo`
  and `.eslintcache`. `corepack pnpm -r compile` passes.
- The dev middleware never touches real Electron user data.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Engine compatibility finding (decides `project.json` vs sidecar)

- **The engine never reads `.enso/project.json`.**
  `git grep -n "project\.json" -- engine lib` finds one hit, a test fixture in
  `engine/language-server/src/test/.../GitSpec.scala`. The engine uses `.enso/`
  only as its data directory (`Package.internalDirName`, IR, bindings and
  suggestion caches in `lib/scala/pkg/.../Package.scala`; the VCS git dir via
  `ProjectDirectoriesConfig.DataDirectory` in the language server's
  `Config.scala`).
- **There is no Scala project manager any more.** `lib/scala/project-manager` is
  a README and an `EmptyProjectManager.java` since "Remove project-manager
  (#14406)", `cc62deb9b5`. Even before that it decoded `project.json` with
  circe's `generic.auto` (`MetadataFileStorage` -> `JsonFileStorage.decode[A]`),
  which ignores unknown keys. It would have dropped them on its next write,
  which is moot now.
- **The only reader and writer is the TypeScript shim itself**
  (`projectRepository.ts`, `handler/filesystem.ts`, `projectManagement.ts`).
  `projectManagement.ts`'s import path already spreads the old metadata, so it
  keeps the field.
- **Decision: `labels` goes in `.enso/project.json`.** No sidecar.
- **Run-time check (cheap, no distribution build):** open a project whose
  `project.json` carries `labels` with an existing engine build and confirm it
  starts. Record the outcome in the PR.

## Where the code differs from the spec, and what this plan does

1. **"Deleted names filtered out" and "unknown names added on read" conflict.**
   A name deleted from `labels.json` is indistinguishable from a name that was
   never there. The plan adds tombstones: `labels.json` gains an optional
   `deletedNames: string[]` (still `version: 1`; additive).
   - `labels/delete` removes the label and adds its value to `deletedNames`.
   - On read, a project's name is kept if it is a live label, dropped if it is
     in `deletedNames`, and otherwise added as a new label with
     `findLeastUsedColor`.
   - `labels/create` removes the value from `deletedNames`, so re-creating a
     label brings it back on the projects that still carry it, as the spec
     wants.
   - A project copied from another machine that carries a name deleted here has
     that name ignored. That is acceptable.
2. **Moves do not go through a "project move handler".** The GUI moves projects
   (and folders that contain projects) with the generic
   `--filesystem-move-from/--filesystem-move-to` command, which is a plain
   `fs.rename`. The plan updates Recent entries there **by path prefix** (an
   entry at the old path, or under it, is rewritten to the new path). That is
   the same as matching by UUID for a single project, and also covers moving a
   folder. The `project/rename` handler, which knows the UUID, updates by UUID,
   including the deferred directory rename after a running project closes.
3. **Deletes come in two flavours.** `project/delete` forgets by UUID;
   `--filesystem-delete` forgets entries at or under the deleted path.
4. **`project.json` that is corrupt is not moved aside.** Moving it would cost
   the project its identity (the shim would mint a new UUID). The move-aside
   rule applies to `labels.json` and `recent.json`; a label write to a corrupt
   `project.json` fails with an error instead.
5. **Duplicating a project keeps its labels.** `copyProject` used to overwrite
   the copy's `project.json` with four fields; it now merges over the copied
   file, so labels (and any other unknown field) travel with the copy, as the
   spec says for copied projects.
6. **Empty labels are stored by removing the key**, so unlabelled projects'
   `project.json` stays byte-identical in shape to today's.

---

## File structure

| File                                                                   | Change                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `app/project-manager-shim/src/localMetadata/jsonFile.ts`               | **new.** Serialised atomic JSON I/O; move-aside for bad files.                                            |
| `app/project-manager-shim/src/localMetadata/index.ts`                  | **new.** `LocalMetadata` class and its types.                                                             |
| `app/project-manager-shim/src/localMetadata/__tests__/*.test.ts`       | **new.** Unit tests on temporary directories.                                                             |
| `app/project-manager-shim/package.json`                                | `./localMetadata` subpath export.                                                                         |
| `app/project-manager-shim/src/projectService/projectRepository.ts`     | `update` and `copyProject` read-merge-write through `jsonFile`.                                           |
| `app/project-manager-shim/src/projectService/index.ts`                 | Optional `ProjectLifecycleListener`; notify on rename and delete.                                         |
| `app/project-manager-shim/src/handler/projectService.ts`               | Seven new routes; `localMetadata` parameter.                                                              |
| `app/project-manager-shim/src/handler/filesystem.ts`                   | `labels` in listing; Recent follows move/delete; clash-resolution write goes through `jsonFile`.          |
| `app/project-manager-shim/CLAUDE.md`                                   | Short `localMetadata` section.                                                                            |
| `app/electron-client/src/projectService.ts`, `server.ts`, `index.ts`   | Create `LocalMetadata` on `app.getPath('userData')`; pass it to the service, the server and the handlers. |
| `app/gui/project-manager-shim-middleware/index.ts`, `.gitignore`       | `LocalMetadata` on a dev-profile folder.                                                                  |
| `app/common/src/services/ProjectManager/types.ts`, `ProjectManager.ts` | Types and client methods.                                                                                 |

---

## Interfaces (exact; PR 2 and PR 3 depend on these)

### Shim: `project-manager-shim/localMetadata`

```ts
import type {
  Label,
  LabelName,
  LChColor,
} from "enso-common/src/services/Backend";

export const LABELS_FILE_NAME = "labels.json";
export const RECENT_FILE_NAME = "recent.json";
export const RECENT_LIMIT = 20;

/** One entry of the Recent list, newest first. */
export interface RecentEntry {
  readonly path: string;
  readonly projectId: string;
  readonly openedAt: string; // RFC 3339
}

export interface LocalMetadataOptions {
  readonly userDataDirectory: string;
  readonly logger?: Pick<Console, "warn">;
  readonly now?: () => Date;
}

export interface ProjectLifecycleListener {
  projectMoved(projectId: string, newPath: string): Promise<void>;
  projectDeleted(projectId: string): Promise<void>;
}

export class LocalMetadata implements ProjectLifecycleListener {
  constructor(options: LocalMetadataOptions);
  listLabels(): Promise<readonly Label[]>;
  createLabel(value: LabelName, color: LChColor): Promise<Label>; // throws on duplicate value
  deleteLabel(id: string): Promise<void>;
  /** Live names among `names`; unknown ones are added to labels.json. */
  resolveLabelNames(names: Iterable<string>): Promise<ReadonlySet<string>>;
  setProjectLabels(
    projectPath: string,
    names: readonly string[],
  ): Promise<void>;
  listRecent(): Promise<readonly RecentEntry[]>;
  recordRecent(projectPath: string): Promise<void>;
  forgetRecent(projectPath: string): Promise<void>;
  pathMoved(from: string, to: string): Promise<void>;
  pathDeleted(deletedPath: string): Promise<void>;
  projectMoved(projectId: string, newPath: string): Promise<void>;
  projectDeleted(projectId: string): Promise<void>;
}
```

### Endpoints (`POST /api/project-service/<name>`, JSON-RPC envelope)

| Name                 | Body                                 | `result`                                       |
| -------------------- | ------------------------------------ | ---------------------------------------------- |
| `labels/list`        | `{}`                                 | `Label[]` (`{ id, value, color }`)             |
| `labels/create`      | `{ value: string, color: LChColor }` | `Label`; error on a duplicate or empty `value` |
| `labels/delete`      | `{ id: string }`                     | `null`                                         |
| `project/set-labels` | `{ path: string, labels: string[] }` | `null`                                         |
| `recent/list`        | `{}`                                 | `RecentEntry[]` (validated, newest first)      |
| `recent/record`      | `{ path: string }`                   | `null`; error when `path` holds no project     |
| `recent/forget`      | `{ path: string }`                   | `null`                                         |

### Listing

`filesystem-list` / `filesystem-list-recursive`: each `ProjectEntry.metadata`
gains `labels: string[]` (live names only, in the order stored on the project;
`[]` when none).

### `enso-common` client (`app/common/src/services/ProjectManager`)

`types.ts`:

```ts
export interface ProjectMetadata {
  /* … */ readonly labels?: readonly backend.LabelName[];
}
export interface CreateLabelParams {
  readonly value: backend.LabelName;
  readonly color: backend.LChColor;
}
export interface DeleteLabelParams {
  readonly id: backend.TagId;
}
export interface SetProjectLabelsParams {
  readonly projectPath: Path;
  readonly labels: readonly backend.LabelName[];
}
export interface RecentProjectEntry {
  readonly path: Path;
  readonly projectId: UUID;
  readonly openedAt: dateTime.Rfc3339DateTime;
}
```

`ProjectManager.ts`:

```ts
listLabels(): Promise<readonly backend.Label[]>
createLabel(params: CreateLabelParams): Promise<backend.Label>
deleteLabel(params: DeleteLabelParams): Promise<void>
setProjectLabels(params: SetProjectLabelsParams): Promise<void>
listRecentProjects(): Promise<readonly RecentProjectEntry[]>
recordRecentProject(projectPath: Path): Promise<void>
forgetRecentProject(projectPath: Path): Promise<void>
```

`listRecentProjects` normalises slashes in `path`, as `listDirectory` does.

---

## Tasks

### Task 1: `jsonFile` — serialised atomic JSON I/O

**Files:** create `src/localMetadata/jsonFile.ts`,
`src/localMetadata/__tests__/jsonFile.test.ts`.

Exports:

```ts
export function serialised<T>(
  filePath: string,
  action: () => Promise<T>,
): Promise<T>;
export function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void>;
export function updateJsonFile<T>(
  filePath: string,
  update: (current: unknown) => T | Promise<T>,
): Promise<T>; // serialised; reads (ENOENT -> undefined), writes atomically; throws on bad JSON
export type VersionedRead<T> = { readonly value: T | undefined };
export function readVersionedJson<T>(
  filePath: string,
  options: {
    readonly version: number;
    readonly parse: (json: unknown) => T | undefined;
    readonly logger: Pick<Console, "warn">;
    readonly now: () => Date;
  },
): Promise<T | undefined>; // NOT serialised itself; call inside `serialised`
```

- [ ] Tests first:
  - `writeJsonAtomic` leaves no `*.tmp-*` file behind and replaces existing
    content.
  - 50 concurrent `updateJsonFile` increments of `{ n }` end at `n: 50`.
  - `updateJsonFile` on a missing file passes `undefined`; on invalid JSON it
    rejects and leaves the file untouched.
  - `readVersionedJson`: missing -> `undefined`, no warning; invalid JSON ->
    `undefined`, file renamed to `labels.json.corrupt-<ts>`, one warning; a
    `version` of 2 -> renamed to `labels.json.newer-<ts>`, one warning; `parse`
    returning `undefined` counts as corrupt.
- [ ] Run, watch fail; implement; run, watch pass; commit.

Key test:

```ts
test("serialises concurrent updates", async () => {
  const file = path.join(dir, "counter.json");
  await Promise.all(
    Array.from({ length: 50 }, () =>
      updateJsonFile(file, (cur) => ({
        n: ((cur as { n?: number } | undefined)?.n ?? 0) + 1,
      })),
    ),
  );
  expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ n: 50 });
});
```

### Task 2: `LocalMetadata` labels

**Files:** create `src/localMetadata/index.ts`,
`src/localMetadata/__tests__/labels.test.ts`.

- [ ] Tests first (temp `userData` dir, temp project dir with `package.yaml` and
      `.enso/project.json`):
  - `createLabel` then `listLabels` round-trips; ids are UUIDs; a duplicate
    value rejects; case-different values are distinct.
  - `deleteLabel` removes it and `resolveLabelNames(['x'])` no longer returns
    it, without re-adding it; `createLabel('x')` again makes it live.
  - `resolveLabelNames(['new'])` adds `new` with the least-used colour.
  - `setProjectLabels` writes `labels`, keeps `lastOpened`, `id` and an unknown
    `extra` field; drops deleted names; empty list removes the key; a missing
    project rejects.
  - a corrupt `labels.json` is moved aside and reads as empty.
- [ ] Implement; pass; commit.

### Task 3: `LocalMetadata` Recent

**Files:** extend `src/localMetadata/index.ts`;
`src/localMetadata/__tests__/recent.test.ts`.

- [ ] Tests first:
  - `recordRecent` puts the newest first, de-duplicates by UUID (re-recording
    moves it to the top), and caps at 20.
  - `recordRecent` on a non-project rejects.
  - `listRecent` hides an entry whose folder is gone or whose `id` changed, but
    does not prune it; the next `recordRecent` prunes it.
  - `forgetRecent` removes the entry.
  - `pathMoved(folder, newFolder)` rewrites an entry under `folder`;
    `projectMoved(id, newPath)` rewrites by UUID; `pathDeleted` and
    `projectDeleted` forget.
  - a `recent.json` with `version: 2` is moved aside.
- [ ] Implement; pass; commit.

### Task 4: `project.json` writers preserve unknown fields

**Files:** `src/projectService/projectRepository.ts`,
`src/handler/filesystem.ts` (`resolveClashingProjectEntryIds`); test
`src/projectService/__tests__/projectRepository.test.ts` (new, no engine
needed).

- [ ] Tests first: `ProjectFileRepository.update` on a project whose
      `project.json` has `labels` keeps them; `copyProject` keeps them on the
      copy with the new `id`.
- [ ] Implement with `updateJsonFile`; pass; commit.

### Task 5: listing returns labels; Recent follows filesystem moves and deletes

**Files:** `src/handler/filesystem.ts`; extend
`src/handler/__tests__/filesystem.test.ts`.

`handleFilesystemCommand(cliArguments, request, localMetadata?: LocalMetadata)`.

- [ ] Tests first:
  - with a store, a project carrying `['a', 'gone', 'new']` where `gone` is
    deleted lists `labels: ['a', 'new']`, and `new` is now in `listLabels()`;
  - without a store, `labels` is absent;
  - `--filesystem-move-from` of a folder holding a recent project rewrites the
    entry; `--filesystem-delete` forgets it.
- [ ] Implement; pass; commit.

### Task 6: endpoints and `ProjectService` lifecycle notifications

**Files:** `src/handler/projectService.ts`, `src/projectService/index.ts`; test
`src/handler/__tests__/projectService.test.ts` (new; uses a real `http.Server`
on port 0 with a stub `getProjectService`).

`handleProjectServiceRequest(request, response, requestPath, getProjectService, headers, localMetadata?: LocalMetadata)`;
an unknown route or a missing store answers with a JSON-RPC error rather than
throwing. `ProjectService` constructor gains an optional fourth parameter
`lifecycle?: ProjectLifecycleListener`, and
`ProjectService.default(workDir, extraArgs, lifecycle?)`. `renameProject` calls
`projectMoved` after the directory rename (immediate or deferred);
`deleteProject` calls `projectDeleted`.

- [ ] Tests first: each of the seven routes round-trips over HTTP (create, list,
      delete, set-labels, record, list, forget), and a duplicate create returns
      a JSON-RPC `error`.
- [ ] Implement; pass; commit.

### Task 7: userData wiring

**Files:** `app/electron-client/src/projectService.ts` (`getLocalMetadata()`,
lazily `new LocalMetadata({ userDataDirectory: app.getPath('userData') })`,
passed to `ProjectService.default`), `server.ts` (`Server` takes and passes
`localMetadata` to both handlers), `index.ts`;
`app/gui/project-manager-shim-middleware/index.ts` (store on
`process.env.ENSO_DEV_USER_DATA_DIR ?? app/gui/.dev-profile/userData`), and
`app/gui/.gitignore` (`.dev-profile/`).

- [ ] Typecheck electron-client and gui; commit.

### Task 8: `ProjectManager` client methods

**Files:** `app/common/src/services/ProjectManager/types.ts`,
`ProjectManager.ts`; test
`app/common/src/services/ProjectManager/__tests__/localMetadata.test.ts` (stub
`fetch`, assert URL and body, and the JSON-RPC error path).

- [ ] Tests first; implement; pass; commit.

### Task 9: docs and verification

- [ ] `app/project-manager-shim/CLAUDE.md`: a `localMetadata` section (files,
      tombstones, which handlers keep Recent in step).
- [ ] Delete caches; per package typecheck, lint, unit tests;
      `corepack pnpm -r compile`; the dashboard Playwright suite once.
- [ ] Engine run-time check with an existing engine build.
- [ ] Push, open the PR with the label, do not merge.

---

## PR 2–4 outline

- **PR 2 (local labels)** consumes `ProjectManager.listLabels`, `createLabel`,
  `deleteLabel`, `setProjectLabels`, and `ProjectEntry.metadata.labels` from
  `listDirectory`. `LocalBackend.createTag/listTags/deleteTag/associateTag` map
  onto them; `associateTag(projectId, names)` resolves the project path with
  `extractTypeAndPath` and calls `setProjectLabels({ projectPath, labels })`.
  `listDirectory` copies `metadata.labels ?? []` into `ProjectAsset.labels`.
  Playwright mocks for the seven routes go into
  `app/gui/integration-test/mock/localApi.ts`.
- **PR 3 (local Recent)** consumes `listRecentProjects`, `recordRecentProject`
  (after a successful `openProject` in `LocalBackend`) and `forgetRecentProject`
  ("Remove from Recent"). Each `RecentProjectEntry.path` gives the asset id
  (`newProjectId(path)`) and the real `parentId`
  (`newDirectoryId(getFolderPath(path))`).
- **PR 4 (docs)** extends the shim CLAUDE.md written in Task 9 and adds the
  labels, categories and drive docs.

---

## PR 3

# Local labels and a local Recent list, PR 3 (local Recent): implementation plan

> **For agentic workers:** execute task by task with TDD (failing test, watch it
> fail, implement, watch it pass, commit). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A "Recent" category under Local in the drive's sidebar that lists the
local projects opened most recently, newest first, with an empty state, a
reduced context menu and "Remove from Recent".

**Architecture:** A new category type `localRecent` in
`app/gui/src/providers/category.ts`, mapped to the local backend. Every check
for the cloud's `'recent'` goes through a new `isRecentCategory(category)`, so
both Recents share paging, the Path column, the drop rules, the drive bar and
the context-menu limits. `LocalBackend.listDirectory` answers `filterBy: recent`
from `ProjectManager.listRecentProjects`; `LocalBackend.openProject` records
successful local opens; a new `LocalBackend.forgetRecentProject` backs "Remove
from Recent".

**Spec:** `docs/superpowers/specs/2026-10-11-local-labels-and-recent-design.md`
(sections 2, 3 "The local Recent category" and 4; PR 3 of 4).

**Global Constraints:**

- Stacked on PR 1 (#225). PR 2 is built in parallel: edits to the files it also
  touches (`AssetContextMenu.vue`, `AssetsTable.vue`, `columnUtils.ts`,
  `DriveBarToolbar.vue`, `localApi.ts`, `LocalBackend.ts`) stay additive and
  local; `isRecentCategory` replacements are one-line changes.
- The cloud's Recent keeps its behaviour (one deliberate exception, below).
- CHANGELOG entry under `#### Enso IDE` (a user-visible feature).
- `corepack pnpm` only. Never `git stash`, never `--no-verify`.

## Where the code differs from the spec, and what this plan does

1. **The cloud's Recent is not a `filterBy`.** It lists with `filterBy: null`
   and `recentProjects: true`. Local Recent lists with
   `CATEGORY_TO_FILTER_BY.localRecent = FilterBy.recent` and
   `recentProjects: true`; `LocalBackend.listDirectory` takes the Recent branch
   on either flag.
2. **The Recent categories have no home directory** (`categoryDirectoryId` is
   `null`), and the drive view falls back to the user's _cloud_ root as the
   location's root. For `localRecent` that would make the local backend fetch
   the details of a cloud directory id. `driveView.ts` falls back to the local
   root for local categories instead.
3. **Empty text.** `AssetsTable.vue`'s "This folder is empty" check compares the
   current directory with `categoryDirectoryId`, which is `null` for both
   Recents, so the Recent-specific empty text never showed. The check now
   compares with the location's root when the category has no home directory.
   This also makes the cloud's Recent show "You have no recent projects…" when
   it is empty: the one change to the cloud's Recent, and a fix.
4. **Two "Recent" buttons.** The local entry reuses `recentCategory` ("Recent")
   and the `history` icon, so the sidebar has two buttons named "Recent", one in
   each group. The Playwright helpers locate category buttons within their
   group.
5. **Hybrid opens are not recorded.** `openProject` with
   `openHybridProjectParameters` opens a cloud project's local copy; the spec
   says cloud projects are never recorded locally.
6. **Recording is best effort.** A failed `recordRecentProject` is logged and
   does not fail the open.
7. **Query invalidation needs no change.** `INVALIDATION_MAP.openProject`
   already invalidates every `listDirectory` query of the backend, Recent's
   included (the key is `[backendType, 'listDirectory', null, {…}]`). A unit
   test pins it.
8. **Metadata.** Recent assets are built by listing each distinct parent
   directory once through `LocalBackend.listDirectory` itself and keeping the
   recent projects' entries. That gives the same title, dates, state, paths and
   (after PR 2) labels as the folder view, with no second mapping to keep in
   step, and one `filesystem-list` per parent rather than per project.

## File structure

| File                                                           | Change                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `app/common/src/services/LocalBackend.ts`                      | Recent branch in `listDirectory`; record in `openProject`; `forgetRecentProject`. |
| `app/common/src/services/__test__/LocalBackend.recent.test.ts` | **new.** Unit tests for the three.                                                |
| `app/common/src/text/english.json`                             | `noRecentLocalProjects`, `removeFromRecentShortcut`.                              |
| `app/gui/src/providers/category.ts`                            | `localRecent`, `isRecentCategory`, sidebar order.                                 |
| `app/gui/src/providers/__tests__/category.test.ts`             | **new.** `isRecentCategory`, keys, backend, drop rules.                           |
| `app/gui/src/utils/driveQueries.ts`                            | `CATEGORY_TO_FILTER_BY.localRecent`; `recentProjects` via `isRecentCategory`.     |
| `app/gui/src/utils/transferBetweenCategories.ts`               | `localRecent` like `recent`.                                                      |
| `app/gui/src/dashboard/layouts/Drive/driveView.ts`             | Local root as the root of local categories without a home directory.              |
| Drive components (see Task 3)                                  | `isRecentCategory`; empty text; local Recent menu.                                |
| `app/gui/src/configurations/inputBindings.ts`                  | `removeFromRecent` action.                                                        |
| `app/gui/integration-test/mock/localApi.ts`                    | `recent/list`, `record`, `forget` mocks; moves and deletes keep them in step.     |
| `app/gui/integration-test/actions/DrivePageActions.ts`         | Category buttons located per group; `goToCategory.localRecent`.                   |
| `app/gui/integration-test/dashboard/localRecent.spec.ts`       | **new.**                                                                          |
| `CHANGELOG.md`                                                 | Entry.                                                                            |

## Interfaces

```ts
// category.ts
export interface PredefinedCategory {
  type: "cloud" | "recent" | "trash" | "local" | "localRecent";
}
/** Whether the category is a Recent list (the cloud's or the local one). */
export function isRecentCategory(category: Category | CategoryType): boolean;

// LocalBackend.ts
/** Remove a local project from the recently opened projects. */
forgetRecentProject(projectId: backend.ProjectId): Promise<void>;
```

## Tasks

### Task 1: `LocalBackend` Recent listing, recording and forgetting

**Files:** `app/common/src/services/LocalBackend.ts`; create
`app/common/src/services/__test__/LocalBackend.recent.test.ts`.

- [ ] Write tests with a stub `ProjectManager` (an object implementing only
      `listRecentProjects`, `recordRecentProject`, `forgetRecentProject`,
      `listDirectory`, `getProject`, `openProject`, `rootDirectory`); stub
      `location` for `baseUrl`:

```ts
it("lists recent projects newest first, with their real parent", async () => {
  pm.recent = [entry("/root/a/P2", ID2), entry("/root/P1", ID1)];
  pm.dirs.set("/root/a", [project("/root/a/P2", ID2, "P2")]);
  pm.dirs.set("/root", [project("/root/P1", ID1, "P1"), directory("/root/a")]);
  const { assets, paginationToken } =
    await backend().listDirectory(recentQuery);
  expect(assets.map((a) => [a.id, a.parentId, a.title])).toEqual([
    [newProjectId(Path("/root/a/P2")), newDirectoryId(Path("/root/a")), "P2"],
    [newProjectId(Path("/root/P1")), newDirectoryId(Path("/root")), "P1"],
  ]);
  expect(paginationToken).toBeNull();
});
// also: lists each parent directory once; leaves out entries whose project is
// not listed; still returns [] for other non-active filters (trashed);
// records a successful local open; records nothing when the open fails;
// records nothing for a hybrid open; a failed record does not fail the open;
// forgetRecentProject forgets the project path.
```

- [ ] Run `corepack pnpm exec vitest run LocalBackend.recent` in `app/common`;
      watch them fail.
- [ ] Implement: at the top of `listDirectory`, take the Recent branch when
      `query.recentProjects === true || query.filterBy === FilterBy.recent`. The
      private method groups entries by `getFolderPath(path)`, calls
      `this.listDirectory({ ...query, parentId: newDirectoryId(parent), filterBy: null, recentProjects: false, from: null, pageSize: null })`
      once per parent (`Promise.all`; a failing parent contributes nothing),
      keeps the recent order, sorts only if `sortExpression` is set, and returns
      `paginationToken: null`. In `openProject`, after a successful open with no
      hybrid parameters, record the path; a failed record is `console.warn`ed.
- [ ] Run the tests; watch them pass. Commit.

### Task 2: the `localRecent` category and `isRecentCategory`

**Files:** `category.ts`; create `providers/__tests__/category.test.ts`.

- [ ] Tests:

```ts
test("isRecentCategory", () => {
  expect(isRecentCategory({ type: "recent" })).toBe(true);
  expect(isRecentCategory({ type: "localRecent" })).toBe(true);
  expect(isRecentCategory("localRecent")).toBe(true);
  for (const type of ["cloud", "trash", "local"] as const)
    expect(isRecentCategory({ type })).toBe(false);
});
test("local Recent uses the local backend and round-trips its key", () => {
  expect(CATEGORY_BACKEND.localRecent).toBe(BackendType.local);
  expect(categoryFromKey(categoryKey({ type: "localRecent" }))).toEqual({
    type: "localRecent",
  });
  expect(categoryIcon("localRecent")).toBe("history");
});
test("nothing can be dropped into or out of either Recent", () => {
  expect(
    dropOperationBetweenCategories({ type: "local" }, { type: "localRecent" }),
  ).toBe("cancel");
  expect(
    dropOperationBetweenCategories({ type: "localRecent" }, { type: "cloud" }),
  ).toBe("cancel");
});
```

- [ ] Watch them fail; implement (type, `CATEGORY_BACKEND`, `categoryKey`,
      `categoryFromKey`, `categoryIcon`, `categoryLabel` (`recentCategory`),
      `categoryDirectoryId` (`null`), `localCategoriesList` = Local, Recent,
      saved folders, `dropOperationBetweenCategories`); fix the exhaustive
      switches `vue-tsc` reports. Pass; commit.

### Task 3: replace every `'recent'` check

- [ ] `driveQueries.ts`: `CATEGORY_TO_FILTER_BY.localRecent = FilterBy.recent`,
      `recentProjects: isRecentCategory(category)` (three sites). Unit test: the
      `localRecent` key has `filterBy: 'Recent'` and `recentProjects: true`.
- [ ] `backendQuery.test.ts`: `openProject` invalidates
      `[BackendType.local, 'listDirectory']`.
- [ ] One-line replacements: `AssetsTable.vue` (paging, drop rejection, empty
      text, drop zone), `AssetsTableContextMenu.vue`, `AssetContextMenu.vue`
      (`canAddToThisDirectory`), `DriveBarNavigation.vue` (three),
      `DriveBarToolbar.vue`, `columnUtils.ts` (Path column),
      `transferBetweenCategories.ts`.
- [ ] `driveView.ts`: local root as the root of local categories without a home
      directory. Empty text: `noRecentLocalProjects` for `localRecent`; the
      folder-empty check compares with the location's root.
- [ ] Typecheck, unit tests; commit.

### Task 4: the local Recent context menu

- [ ] `inputBindings.ts`:
      `removeFromRecent: { bindings: [], icon: 'history', rebindable: false, category: 'fileManagement' }`;
      text `removeFromRecentShortcut`: "Remove from Recent".
- [ ] `AssetContextMenu.vue`: in `localRecent`, keep only the entries `open`,
      `close`, `label`, `openInFileBrowser` and `copyId` of the normal list (so
      Label… lights up when PR 2's gate does), and append `removeFromRecent`,
      which calls `localBackend.forgetRecentProject(asset.id)` and invalidates
      `[BackendType.local, 'listDirectory']`.
- [ ] Covered by the Playwright spec (Task 5). Commit.

### Task 5: Playwright

- [ ] `localApi.ts`: a `recent` array; `recent/list` (validated: a project at
      `path` whose id is `projectId`), `recent/record` (error when no project;
      move to the top; cap 20), `recent/forget`; `filesystem-move-from` rewrites
      entries at or under the source; `filesystem-delete` forgets them. The open
      mock does not record: the GUI's `LocalBackend` does.
- [ ] `DrivePageActions.ts`: locate category buttons within the cloud or local
      group; `goToCategory.localRecent()`.
- [ ] `dashboard/localRecent.spec.ts`:
  - the empty state text;
  - open "Mock Project", close it, open a second project; Recent lists the
    second, then the first;
  - "Remove from Recent" on one; it disappears and the other stays;
  - move a recent project into a folder in Local; Recent still lists it.
- [ ] Run the spec on Windows (with the lock). Commit.

### Task 6: verification, PR, changelog, screenshots

- [ ] Delete caches; `corepack pnpm -r compile`; typecheck, lint
      (`--max-warnings=0`) and unit tests in common and gui; full Playwright
      suite on Windows.
- [ ] Push; open the PR (base `feature/local-metadata`); add the CHANGELOG entry
      with the real number; push.
- [ ] Screenshots on `pr-screenshots` under `pr-<N>/`; embed them in the PR
      body.
