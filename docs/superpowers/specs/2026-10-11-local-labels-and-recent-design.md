# Local labels and a local Recent list: design

Date: 2026-10-11. Status: approved.

## Goal

Bring two cloud-only drive features to the local drive:

1. **Labels on local projects.** The design leaves room for labels on files and
   folders later.
2. **A Recent category under Local** that lists the local projects opened
   recently.

## Decisions

| Question                     | Decision                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| What can be labelled         | Projects now. The store is designed so that a path-keyed index for files and folders can be added later.                                       |
| Where label definitions live | One list per machine, in `<userData>/labels.json`.                                                                                             |
| Where Recent appears         | A "Recent" category under Local in the sidebar, behaving like the cloud's Recent.                                                              |
| How opens are tracked        | Each successful open is recorded in `<userData>/recent.json`: capped at 20 entries, unique by project UUID, and checked when the list is read. |
| Architecture                 | Implement the existing Backend tag API and `filterBy: recent` in `LocalBackend`, backed by new project-manager-shim endpoints.                 |

Rejected alternatives:

- A GUI-only label store that bypasses `Backend` would give the label UI two
  code paths.
- A generic asset-metadata key/value service is more abstraction than two
  features need.
- A combined local and cloud Recent would mix two backends in one table.
- Scanning `lastOpened` would only find projects under the known folders, and
  would be slow with many projects.

## 1. Storage and the shim

### Files

- **`<userData>/labels.json`**:
  `{ "version": 1, "labels": [{ "id", "value", "color": { "lightness", "chroma", "hue", "alpha"? } }] }`.
  - `id` is a UUID, used as the `TagId`.
  - `value` is unique; names are case-sensitive, as in the cloud.
- **`<userData>/recent.json`**:
  `{ "version": 1, "entries": [{ "path", "projectId", "openedAt" }] }`.
  - Entries are newest first.
  - At most 20, unique by `projectId`.
- **Project labels**: an optional `labels: string[]` of label _names_ in the
  project's `.enso/project.json`.
  - Names travel with a copied project, and match how the cloud stores labels on
    assets.
  - **Fallback:** if the Scala project manager or the engine rejects unknown
    fields in `project.json`, store them instead in a sidecar,
    `.enso/labels.json` (`{ "version": 1, "labels": [...] }`). PR 1 decides
    which, by checking.
- **`<userData>`**:
  - In the packaged app, Electron's `app.getPath('userData')`, passed to the
    shim when it starts.
  - Under the dev-server middleware, a folder in the dev profile, never the real
    user data.

### Shim module `localMetadata`

The module lives in `app/project-manager-shim`.

**Writes:**

- Each write goes to a temporary file in the same directory, which is then
  renamed over the old one.
- Writes are serialised per file (a promise chain keyed by absolute path).
- Every write reads the current file first. For `project.json`, fields it
  doesn't know about are preserved; in particular, a `lastOpened` update keeps
  `labels`, and a labels update keeps `lastOpened`.

**Bad files:**

- A missing file reads as empty.
- A corrupt file is renamed to `<name>.corrupt-<timestamp>` and treated as
  empty.
- A file whose `version` is newer than this code understands is renamed to
  `<name>.newer-<timestamp>` and treated as empty.
- One warning is logged in each case.

**Endpoints** (under `/api/project-service/`, alongside the existing project
commands):

| Endpoint             | Input                        | Output                                         |
| -------------------- | ---------------------------- | ---------------------------------------------- |
| `labels/list`        | —                            | `Label[]`                                      |
| `labels/create`      | `{ value, color }`           | `Label` (rejects a duplicate `value`)          |
| `labels/delete`      | `{ id }`                     | —                                              |
| `project/set-labels` | `{ path, labels: string[] }` | —                                              |
| `recent/list`        | —                            | validated entries, see below                   |
| `recent/record`      | `{ path }`                   | — (reads the project UUID from `project.json`) |
| `recent/forget`      | `{ path }`                   | —                                              |

**Label rules:**

- **Lazy delete cascade.** Deleting a label removes it from `labels.json` only.
  Projects that still carry the name have it ignored when read, and dropped the
  next time their labels are written.
- **Unknown names added on read.** A name found on a project but missing from
  `labels.json` (for example, a project copied from another machine) is added on
  read, using `findLeastUsedColor`.

**Recent rules:**

- `recent/list` checks each entry: a project must exist at `path`, and its
  `project.json` `id` must equal `projectId`. Entries that fail are left out of
  the result.
- `recent/record` moves an existing entry to the top, enforces the cap, and
  prunes entries that fail the check.
- The shim's own project move and rename handlers update matching entries by
  UUID.
- Its delete handler forgets the entry.

The directory listing (`filesystem-list`) already reads each project's
`project.json`. It also returns the project's `labels`, with deleted names
already filtered out.

## 2. The Backend interface and `LocalBackend`

### Backend interface

- **New abstract method:** `supportsLabels(assetType: AssetType): boolean`.
  - `RemoteBackend` returns `true` for every type.
  - `LocalBackend` returns `true` for projects only.
- **Existing methods are unchanged:** `createTag`, `listTags`, `deleteTag`,
  `associateTag` and `listDirectory({ filterBy })`.

### `LocalBackend`

- **The tag methods call the shim:**
  - `createTag` calls `labels/create`, `listTags` calls `labels/list`, and
    `deleteTag` calls `labels/delete`.
  - `associateTag(assetId, names)` turns a local project id into its path and
    calls `project/set-labels`.
  - For any other asset type it throws "Labels are not supported for local files
    and folders yet".
- **`listDirectory`:**
  - sets `labels` on project assets from the listing;
  - honours `query.labels`, using the same rule (all or any) as the cloud's
    `listDirectory`; the cloud's behaviour is confirmed in PR 2;
  - with `filterBy: recent`, returns the validated recent projects as project
    assets with their real `parentId`, and no paging.
- **Search:** `doesAssetMatchQuery` matches labels, so the search bar's label
  chips work locally.
- **Recording opens:** `openProject` calls `recent/record` after a successful
  local open. A failed open records nothing. Every local open path in the GUI
  goes through `openProject`.
- **Query invalidation:** in `utils/backendQuery.ts`, a successful `openProject`
  refreshes the recent `listDirectory` query. `associateTag` already refreshes
  `listDirectory`, `searchDirectory` and `getAssetDetails`.

## 3. UI

### Labels

Every check that used to ask "is this the cloud?" now asks the backend's
capability instead.

- **Column** (`columnUtils.ts`): the labels column is shown when the backend
  supports labels for any asset type. `LabelsColumn.vue` shows the edit button
  only when `supportsLabels(asset.type)` is true; otherwise the cell is empty.
- **Context menu** (`AssetContextMenu.vue`): "Label…" is offered when
  `supportsLabels(asset.type)` is true and the category is not Trash.
- **Search** (`AssetSearchBar.vue`, `AssetsTable.vue`): the label chips are
  shown when the backend supports labels. The typed `label:` syntax stays
  disabled for both backends.
- **Properties tab:** stays cloud-only.
- **Code move:** `src/cloud/labels/*` (the popover, `ManageLabelsForm`,
  `labelChanges.ts`, `labelsQueryOptions`) and `DriveLabel.vue` move to
  `src/dashboard/components/labels/`. The cloud imports them from there, and
  their tests move with them.

### The local Recent category

- **New category type `localRecent`.** `CATEGORY_BACKEND` maps it to the local
  backend. The local list in the sidebar becomes: Local, Recent, then the saved
  local folders.
- **`isRecentCategory(category)`** replaces every `category.type === 'recent'`
  check. That covers paging, the Path column, the empty text, the context-menu
  limits, the drop rules, and the drive bar's navigation and toolbar. Local
  Recent behaves like the cloud's.
- **Empty state:** "No recently opened local projects".
- **Context menu in local Recent:** Open, Open in file explorer, Label…, and
  Remove from Recent (which calls `recent/forget`).

## 4. Edge cases and errors

**Labels:**

- **`project.json` can't be written:** the toast shows the error, and the row
  keeps its labels. There is no optimistic update.
- **Concurrent writers** (several windows): writes are serialised per file, and
  each write reads the file first, so updates aren't lost.
- **Copied project with unknown labels:** the labels are added to `labels.json`
  on read.
- **Deleted label still on projects:** ignored on read, and dropped on the next
  write. Re-creating a label with the same name brings it back on those
  projects. This is documented.
- **No label rename:** the Backend interface has none for either backend, so
  this design adds none.

**Recent:**

- **Project moved, renamed or deleted outside the IDE:** the entry is hidden
  when the list is read, and pruned when the next open is recorded.
- **Project on a drive that isn't connected:** the entry is hidden but not
  pruned on read. It goes when it drops out of the cap, or when a later open
  prunes it.
- **Cloud projects:** never recorded locally.

## 5. Testing

- **Shim unit tests** on a temporary directory:
  - atomic writes, and serialised writes under concurrent calls;
  - corrupt and newer files are moved aside;
  - unknown `project.json` fields are preserved;
  - the recent cap and de-duplication;
  - recent entries follow projects on move or rename, and are forgotten on
    delete;
  - deleted labels are filtered out, and unknown names are added on read.
- **Engine compatibility:** read how the Scala project manager and the engine
  parse `project.json`, and open a project carrying labels in a built
  distribution. Record the outcome in PR 1, and use the sidecar if needed.
- **`LocalBackend` unit tests:**
  - the label methods map ids to paths;
  - `supportsLabels` returns the right answers;
  - `associateTag` throws for a file;
  - `filterBy: recent` returns assets with the right `parentId`;
  - a successful open is recorded, and a failed one isn't.
- **GUI unit tests:** `isRecentCategory`, the capability gates with a local
  backend, and the moved labels components.
- **Playwright** (local backend, mocked shim):
  - label a local project, filter by that label, and remove it;
  - open two projects, then check Recent lists them newest first;
  - Remove from Recent;
  - moving a project keeps its Recent entry.

  The cloud label specs must stay green.

- **Screenshots** on every UI PR: the labels column, the popover, the sidebar
  with Recent, the Recent list, and the empty state.

## Rollout

The work goes in four stacked PRs:

1. **Shim `localMetadata`**, the endpoints, the listing returning labels, the
   userData wiring, and the engine compatibility check. No UI; merges on green.
2. **Local labels:** `supportsLabels`, the `LocalBackend` tag methods and label
   filtering, the labels code moved out of `src/cloud`, and the gates. Changelog
   entry; waits for sign-off.
3. **Local Recent:** `localRecent`, `isRecentCategory`, recording opens, and the
   sidebar and list. Changelog entry; waits for sign-off.
4. **Docs:** CLAUDE.md files for the shim, labels, categories and drive.

Out of scope:

- labels on local files and folders;
- the labels overflow popover (#209);
- a local properties panel;
- a combined local and cloud Recent;
- renaming labels.
