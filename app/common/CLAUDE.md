# app/common

Published as package `enso-common`. Pure-TS utilities shared across the Electron
client, the GUI, and other app-side packages. Meant to be the boundary-crossing
neutral ground — anything Vue-specific belongs in its own package.

## Contents

- `src/services/` — the `Backend` interface and its two implementations:
  `RemoteBackend` (Enso Cloud over HTTPS) and `LocalBackend` (the local drive,
  over the project-manager shim's `ProjectManager` client). Shared helpers such
  as `doesAssetMatchQuery` and `compareAssets` live in `Backend.ts`.
- `src/text/`, `src/text.ts` — i18n text table + lookup helpers used by both
  dashboard and Electron UI.
- `src/download.ts` — HTTP download with progress.
- `src/options.ts` — command-line option parser used by the Electron shell.
- `src/utilities/` — generic TS helpers.
- `src/constants.ts` — app-wide constants (URLs, feature flags, version
  strings).

## `LocalBackend`: labels, Recent, and versioning

- **Labels are for projects only** (`supportsLabels`); the tag methods call the
  shim's `localMetadata` endpoints and throw for folders and files.
  `listDirectory` fills a project's `labels` from the shim's listing, and a
  `labels` query keeps the assets carrying **all** of them, as
  `doesAssetMatchQuery` does.
- **Recent** is `listDirectory` with `recentProjects` or `filterBy: recent`:
  `listRecentProjects` lists each recent project's parent directory once and
  returns that listing's own asset, so a row in Recent is the same asset as in
  the folder view (and a project that cannot be listed any more drops out).
  Unpaged, newest first unless a sort is asked for.
- **Opens are recorded** after a successful `openProject`, except a hybrid
  project's (a cloud project's local copy); a failure to record only warns.
  `forgetRecentProject` backs "Remove from Recent".
- **Versioning**: `LocalBackend.versioningStatus` is the read both the saving
  GUI and the Versions tab use; their writes are added by PR 4 and PR 5. The
  `ProjectManager` methods (`versioningStatus`, `initVersioning`,
  `commitVersion`, `listVersions`, `versionFileContent`, `restoreVersion`,
  `duplicateVersion`, `setVersionComment`) call the shim's `versioning/*`
  endpoints, which wrap `LocalVersioning` (git-based snapshots). The saving GUI
  uses the writes (`initVersioning`, `enableVersioning`, `disableVersioning`,
  `enableVersioningIfInside`, `commitVersion`) and
  `closeProjectReportingVersioning`, whose `versioningWarning` the GUI shows as
  a warning toast. The Versions tab's methods (`listAssetVersions`,
  `resolveProjectAssetData` with a version, `restoreAsset`,
  `copyAsset`/`duplicateProject` with a version, `updateAsset` with a version
  comment) call `log`, `file-at`, `restore`, `duplicate-at` and `set-comment`. A
  version id is a commit hash in the `S3ObjectVersionId` brand; only projects
  have versions; local versions have no tags.
- The store, its files and its rules (cap, validation, following moves, git) are
  the shim's; see `app/project-manager-shim/CLAUDE.md`.

## Rules

- No Vue, DOM, or Node-specific APIs at module top level (dynamic imports /
  runtime checks are OK).
- Every dep must be either isomorphic or explicitly scoped to a single entry
  point.
- Breaking changes ripple into `enso-gui` and `enso` (Electron client) — compile
  both before merging.
