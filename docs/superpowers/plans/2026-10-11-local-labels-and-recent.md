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

# PR 2: local labels

> **For agentic workers:** execute task by task with TDD (failing test, watch it
> fail, implement, watch it pass, commit). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Labels on local projects: `Backend.supportsLabels`, the `LocalBackend`
tag methods over the PR 1 client, label filtering and search, the labels code
moved out of `src/cloud/`, and every "is this the cloud?" gate on labels
replaced by the capability. Changelog entry; waits for sign-off.

**Spec:** sections 2, 3 (Labels) and 4, rollout item 2.

**Base:** `feature/local-metadata` (PR 1, #225). PR 3 (local Recent) is stacked
on the same base in parallel, so edits to `LocalBackend.ts`, `localApi.ts` and
`backendQuery.ts` stay small and additive, away from the `filterBy` branch,
`openProject` and the `openProject` invalidation.

## Decisions taken while planning

1. **All or any.** The cloud's `listDirectory` and `searchDirectory` send one
   `label=<name>` query parameter per label (`RemoteBackend.ts`); the server is
   not in this repository, the cloud Playwright mock ignores the parameter, and
   the one label-filter spec (`assetSearchBar.spec.ts`, "labels") is skipped.
   The cloud's semantics therefore **cannot be determined** here. The task's
   fallback applied: "any". At sign-off the user chose **"all"**: an asset
   matches when it carries every requested label; an "any" filter waits for the
   search bar to be revisited. An empty or null `labels` filters nothing.
2. **Where `labelsQueryOptions` goes.** The spec moves it with the labels code
   to `src/dashboard/components/labels/`, and says the cloud imports it from
   there. But the cloud's Properties tab
   (`cloud/properties/AssetPropertiesContent.vue`) uses it too, and nothing
   outside `src/dashboard/` may import `#/` (`DASHBOARD_IMPORT_PATTERN`; the
   allowlist only shrinks). Closest faithful option: the query options, which
   are framework-free, go to **`src/utils/labelsQuery.ts`**
   (`$/utils/labelsQuery`), beside `backendQuery.ts`; the popover, the form,
   `labelChanges.ts`, `ColorPicker.vue`, `NotFoundLabel.vue` and
   `DriveLabel.vue` go to `src/dashboard/components/labels/`.
   `cloud/properties/queries.ts` keeps `datalinkQueryOptions` only.
3. **`labels` leaves `CLOUD_AREAS`** in `eslint.config.mjs`, since the area no
   longer exists.
4. **"Supports labels for any type"** is a free function in `enso-common`'s
   `Backend.ts`, `supportsAnyLabels(backend)`, over `Object.values(AssetType)`,
   so the column, the search chips and the `listTags` queries ask one thing.
5. **A mixed selection.** The column's edit button opens the popover for the
   whole selection when the row is in it. Locally the selection can hold folders
   and files, whose `associateTag` throws; the popover gets only the selected
   assets the backend can label (`labellableItems`), so a folder in the
   selection is left alone rather than producing an error per folder.
6. **`listTags` queries are disabled** (`enabled: false`) where the backend
   supports no labels; both backends support some, so this is a guard for the
   capability rather than a behaviour change today.
7. **Invalidation needs no change.** `INVALIDATION_MAP` keys by `backend.type`,
   so the local `createTag`/`deleteTag` refresh `listTags` and the local
   `associateTag` refreshes `listDirectory`, `searchDirectory` and
   `getAssetDetails`. A unit test pins this for the local backend.

## File structure

| File                                                                                                  | Change                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/common/src/services/Backend.ts`                                                                  | abstract `supportsLabels`; `supportsAnyLabels`; `doesAssetMatchQuery` matches `labels` (all).                                                     |
| `app/common/src/services/RemoteBackend.ts`                                                            | `supportsLabels` returns `true`.                                                                                                                  |
| `app/common/src/services/LocalBackend.ts`                                                             | `supportsLabels`; tag methods over the client; `labels` on project assets; `query.labels` filter.                                                 |
| `app/common/src/services/__tests__/LocalBackend.labels.test.ts`                                       | **new.**                                                                                                                                          |
| `app/common/src/services/__tests__/doesAssetMatchQuery.test.ts`                                       | **new.**                                                                                                                                          |
| `app/gui/src/utils/labelsQuery.ts`                                                                    | **new.** `labelsQueryOptions` (moved from `cloud/properties/queries.ts`).                                                                         |
| `app/gui/src/dashboard/components/labels/*`                                                           | **moved** from `src/cloud/labels/*` and `pages/dashboard/components/DriveLabel.vue`; new `labelSupport.ts` (`labellableItems`), tests, CLAUDE.md. |
| `columnUtils.ts`, `LabelsColumn.vue`, `AssetContextMenu.vue`, `AssetSearchBar.vue`, `AssetsTable.vue` | capability gates.                                                                                                                                 |
| `eslint.config.mjs`                                                                                   | drop `labels` from `CLOUD_AREAS`.                                                                                                                 |
| `app/gui/src/cloud/CLAUDE.md`, `app/gui/CLAUDE.md`                                                    | point at the new home.                                                                                                                            |
| `app/gui/integration-test/mock/localApi.ts`                                                           | label routes, `metadata.labels` in listings, `addLabel`.                                                                                          |
| `app/gui/integration-test/dashboard/localLabels.spec.ts`                                              | **new.**                                                                                                                                          |
| `CHANGELOG.md`                                                                                        | entry under `#### Enso IDE`.                                                                                                                      |

## Interfaces

```ts
// Backend.ts
export abstract class Backend {
  /** Whether assets of the given type can carry labels on this backend. */
  abstract supportsLabels(assetType: AssetType): boolean;
}
/** Whether the backend can label assets of at least one type. */
export function supportsAnyLabels(
  backend: Pick<Backend, "supportsLabels">,
): boolean;

// LocalBackend.ts
// supportsLabels: project only
// createTag(body)            -> projectManager.createLabel(body)
// listTags()                 -> projectManager.listLabels()
// deleteTag(tagId, value)    -> projectManager.deleteLabel({ id: tagId })
// associateTag(id, labels)   -> project id: setProjectLabels({ projectPath, labels });
//                               otherwise throws
//                               "Labels are not supported for local files and folders yet"

// dashboard/components/labels/labelSupport.ts
export function labellableItems<T extends { readonly type: AssetType }>(
  backend: Pick<Backend, "supportsLabels">,
  items: readonly T[],
): readonly T[];

// columnUtils.ts: one more parameter
export function getColumnList(
  userPlan: Plan,
  backendType: BackendType,
  category: CategoryType,
  isSearching: boolean,
  supportsLabels: boolean,
): readonly Column[];
```

## Tasks

### Task 1: `supportsLabels` and the `LocalBackend` tag methods

**Files:** `Backend.ts`, `RemoteBackend.ts`, `LocalBackend.ts`; test
`app/common/src/services/__tests__/LocalBackend.labels.test.ts`.

- [ ] Tests first, with a stub `ProjectManager` (`vi.fn()` per method,
      `rootDirectory`), `location` stubbed with `vi.stubGlobal`:
  - `supportsLabels` is `true` for `project` only; `supportsAnyLabels` is true.
  - `listTags` returns `listLabels()`; `createTag({ value, color })` calls
    `createLabel({ value, color })` and returns its label; `deleteTag(id, v)`
    calls `deleteLabel({ id })`.
  - `associateTag(newProjectId('/p/A'), ['x'], 'A')` calls
    `setProjectLabels({ projectPath: '/p/A', labels: ['x'] })`.
  - `associateTag` on a directory id or a file id rejects with "Labels are not
    supported for local files and folders yet" and calls nothing.
- [ ] Run (`corepack pnpm --filter enso-common test:unit`), watch fail;
      implement; pass; commit.

### Task 2: labels in the listing, the filter and search

**Files:** `LocalBackend.ts`, `Backend.ts`; tests in the same new file and
`__tests__/doesAssetMatchQuery.test.ts`.

- [ ] Tests first:
  - `listDirectory` copies `metadata.labels` onto project assets (`[]` when
    absent); directories and files keep `labels` undefined.
  - `listDirectory({ labels: ['a', 'b'] })` keeps projects carrying `a` _or_
    `b`, and drops folders, files and unlabelled projects; `labels: []` and
    `null` filter nothing.
  - `doesAssetMatchQuery({ labels: ['a'], … })` matches an asset with `a`, and
    rejects one without and one with no `labels`.
- [ ] Implement: in the `ProjectEntry` case add
      `labels: entry.metadata.labels ?? []`; after the entries are built, a
      separate label filter (before the sort); in `doesAssetMatchQuery` an "all"
      check (first written as "any"; the user chose "all" at sign-off). Pass;
      commit.

### Task 3: invalidation pin

- [ ] Add to `utils/__tests__/backendQuery.test.ts`: the local `associateTag`,
      `createTag` and `deleteTag` invalidate the `local` keys. (A verification
      test: it passes without a code change.) Commit.

### Task 4: move the labels code

- [ ] `git mv`
      `src/cloud/labels/{ColorPicker,ManageLabelsForm,ManageLabelsModal,NotFoundLabel}.vue`,
      `labelChanges.ts`, `__tests__/*`, `CLAUDE.md`, and
      `src/dashboard/pages/dashboard/components/DriveLabel.vue` to
      `src/dashboard/components/labels/`.
- [ ] New `src/utils/labelsQuery.ts` with `labelsQueryOptions`; remove it from
      `cloud/properties/queries.ts`; update `AssetPropertiesContent.vue`.
- [ ] Update every import (`AssetContextMenu.vue`, `LabelsColumn.vue`,
      `AssetSearchBar.vue`, `AssetsTable.vue`, the form); drop `labels` from
      `CLOUD_AREAS`; update the moved CLAUDE.md, `cloud/CLAUDE.md` and
      `app/gui/CLAUDE.md`.
- [ ] The moved tests pass; typecheck and lint pass; commit.

### Task 5: capability gates

**Files:** `labelSupport.ts` (+ test), `columnUtils.ts` (+ test
`columnUtils.test.ts`), `LabelsColumn.vue`, `AssetContextMenu.vue`,
`AssetSearchBar.vue`, `AssetsTable.vue`.

- [ ] Tests first:
  - `labellableItems(local, [project, folder, file])` gives `[project]`;
    `labellableItems(remote, …)` gives all.
  - `getColumnList(plan, local, 'local', false, true)` contains `Column.labels`;
    with `false` it does not; the cloud keeps it.
- [ ] Implement:
  - `getColumnList(…, supportsLabels)`: `supportsLabels && Column.labels`;
    `AssetsTable.vue` passes `supportsAnyLabels(backend)`.
  - `LabelsColumn.vue`: the edit button only when
    `backend.supportsLabels(item.type)`; the popover gets
    `labellableItems(backend, selection)`.
  - `AssetContextMenu.vue`: "Label…" when `backend.supportsLabels(asset.type)`
    and the category is not Trash.
  - `AssetSearchBar.vue`: chips under `supportsAnyLabels(backend)` instead of
    `isCloud`; its `listTags` query `enabled` on the same. `AssetsTable.vue`'s
    `listTags` likewise. The typed `label:` tag stays commented out.
- [ ] Pass; typecheck; lint; commit.

### Task 6: Playwright

**Files:** `integration-test/mock/localApi.ts`,
`integration-test/dashboard/localLabels.spec.ts`.

- [ ] Mocks, in their own block inside `mockLocalApi`: a `labels` array, a
      `deletedNames` set, routes `labels/list`, `labels/create` (a duplicate
      answers with a JSON-RPC error), `labels/delete` (adds a tombstone),
      `project/set-labels` (finds the project entry by `path`, sets
      `metadata.labels`); the `filesystem-list` case returns each project's
      `metadata.labels` minus deleted names (`[]` when none); `api.addLabel`.
- [ ] Spec (`setupApi.local` adds a label and a second project):
  1. Local category: the labels column is shown; "Mock Project" has no label.
  2. Right-click, "Label…", check the label, close: the row shows the pill.
  3. The search bar chip: the table lists only "Mock Project" (the unlabelled
     project disappears); toggle it off and both are back.
  4. Right-click the pill to remove it: the row has no label.
  5. A local folder offers no "Label…" in its context menu.
- [ ] Run it, the cloud label specs (`labelsPopover`, `assetsTableFeatures`),
      then the whole suite (Playwright lock). Commit.

### Task 7: docs, changelog, screenshots, PR

- [ ] Delete caches; `corepack pnpm -r compile`; typecheck, lint, unit tests in
      common and gui; full Playwright suite on Windows.
- [ ] Push; open the PR (base `feature/local-metadata`); add the changelog entry
      with the real number; push; grep for `[NNN]`.
- [ ] Screenshots (before: the local drive on PR 1's head; after: the labels
      column and the popover on a local project) on `pr-screenshots` under
      `pr-<N>/`; embed in the PR body.
