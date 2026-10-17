# A local-only IDE: taking Enso Cloud out

Status: design, awaiting review. Date: 2026-10-17.

## Goal

The desktop IDE runs with no Enso Cloud. It has no login, no cloud drive and no
remote backend. It starts straight into the local drive and is otherwise the
same app: the same local projects, labels, Recent, local git versioning, graph
editor and AI components.

## Scope

- **In scope:** the IDE. That means `app/gui`, `app/common`,
  `app/electron-client` and `app/project-manager-shim`, plus the IDE's parts of
  `build_tools/` and the generated CI workflows.
- **Out of scope:** the engine and the standard library. That covers
  `Enso_Cloud`, `Enso_Secret`, `Enso_File`, `test/Cloud_Tests` and their CI
  jobs. They keep working. Once the IDE stops writing `~/.enso/credentials`,
  they simply see no cloud credentials. Removing them is a possible later
  phase.

## Decisions

1. **Remove, don't hide.** Cloud code is deleted, not feature-flagged. The one
   exception is the secrets screens (decision 5).
2. **Four PRs, staged.** The app works after each one, and each gets an
   installer test before it merges, because they are features.
3. **Keep the abstract `Backend`.** `Backend`/`BackendType` stay, with
   `LocalBackend` as the only implementation. Cloud-only methods and data types
   are deleted. Folding `Backend` into `LocalBackend` is a possible later
   tidy-up, not part of this work.
4. **These third-party services stay:** Mapbox, the update checker
   (`versionChecker`, which checks GitHub releases), Sentry and Google
   Analytics. They are configured only by build-time variables
   (`ENSO_IDE_MAPBOX_API_TOKEN`, `ENSO_IDE_SENTRY_DSN`,
   `ENSO_IDE_GOOGLE_ANALYTICS_TAG`), never by a cloud config fetch. A build
   without a value runs without that service, as it does today.
   - Mapbox currently gets its token through the cloud (`providers/mapboxToken.ts`).
     It switches to the build-time token alone.
5. **Keep the secrets screens, dormant, for local secrets later.**
   - **What moves:** `UpsertSecretForm`/`UpsertSecretModal`, the per-service
     credential forms (Google, MS365, Salesforce, Snowflake, Strava) and the
     graph editor's `UpsertSecretPanel` move from `src/cloud/credentials` and
     `src/cloud/serviceCredentials` to core, under `app/gui/src/secrets/`.
   - **What still works:** they keep compiling and keep their unit tests. The
     `Backend` secret methods (`createSecret`, `getSecret`, `updateSecret`,
     `listSecrets`) stay in the trimmed interface, where `LocalBackend` already
     rejects them as invalid operations.
   - **Hidden:** no UI entry point opens them while the local backend can't
     store secrets.
   - **For later:** the OAuth credential forms took their client ids from the
     remote config. Local secrets will need another source for them, such as
     build-time variables. That is recorded here, not solved.
6. **Datalinks:** the datalink editor (`src/cloud/datalinks`) and the cloud
   datalink asset are removed, since the local backend can't store either.
   Enso code can still read `.datalink` files from disk through the standard
   library.
7. **The Versions tab is core.** `src/cloud/versions` now serves local git
   versioning. It moves to core (`app/gui/src/versions/`). Its cloud branches
   (tags, schedules, the executions calendar, S3 versions) are removed in PR 3.
8. **Projects downloaded from the cloud** (`cloud-<projectId>/` under the
   projects root) are left on disk untouched. The IDE no longer treats them
   specially, so they list like any other local folder.

## Starting point

- Cloud UI is mostly fenced into `app/gui/src/cloud/`: 177 files, about 12k
  lines without tests. The only way in is `registerCloud(router)` in
  `entrypoint.ts`, and ESLint keeps core from importing it.
- 28 core files still import from `$/cloud` (listed in PR 2).
- A local-only mode already exists (917d47be20, #3, #72, #73, #134, #186). When
  the remote config has no Cognito ids, `useAuthDisabled()` is true and the
  app runs on the offline session (`makeOfflineSession`) as the "working
  locally" user, landing on the local drive. Billing, Upgrade, Invite and Usage
  are hidden. PR 1 makes this the only mode.

## PR 1: always local-only

The user-visible switch. It should be small enough to ship and test on its own.

- **Startup and auth.** Don't fetch the remote config:
  - `providers/config.ts` stops calling `${API_URL}/<CONFIGURATION_PATH>`, and
    `waitForRemoteConfig` resolves straight away with an empty config.
  - `useAuthDisabled()` is always true, so the session is always the offline
    session.
  - `router.beforeEach` no longer waits on the remote config.
- **Cloud contributions.** `entrypoint.ts` no longer calls `registerCloud`.
  That takes away the auth routes, account, organisation and billing settings,
  the agreements gate, the app-container modals (set up organisation, accept
  invitation, trial ended, plan downgraded), the Properties tab and devtools.
  - The Versions tab is still needed, so its registration moves to a core
    registration call made by `entrypoint.ts`. The file moves happen in PR 2.
- **Drive categories.** `category.ts` lists only Local, Recent (local) and the
  added folders. The Cloud, Recent (cloud), Trash and Team categories are
  removed from the lists, though their types stay until PR 3.
- **Entry points.** Remove these from menus and toolbars:
  - "Upload to cloud", "Open in cloud", "Move to cloud";
  - share and permissions columns;
  - the paywall checks;
  - billing, upgrade and invite entries.
  - The user menu shows only local items.
- **Tests.** Mark the cloud-only Playwright specs as skipped, with a pointer to
  PR 4. Specs that mix cloud and local keep their local parts.
  - New: an integration test that the app starts on the local drive with no
    login and no request to the cloud API. The mock fails any `api.cloud` or
    `https://mock` request.
- **Changelog.** A CHANGELOG entry ("The IDE is local-only: no Enso Cloud
  login or cloud drive"), plus before/after screenshots.

## PR 2: delete the cloud UI and authentication

- **Delete from `src/cloud/`:** `auth`, `account`, `agreements`, `billing`,
  `organization`, `datalinks`, `properties`, `browserDisabled`, `devtools`,
  `uploadToCloud.ts`, `validation.ts`, `parseUserEmails.ts`,
  `permissionsClasses.ts` and their tests.
- **Move to core:** `versions/` to `src/versions/`; `versionChecker/` to
  `src/versionChecker/`; `credentials/`, `serviceCredentials/` and
  `UpsertSecretPanel` to `src/secrets/` (dormant, per decision 5).
  - Then remove `src/cloud/` itself, the `registerCloud` function, the
    `CLOUD_AREAS` ESLint boundary and `src/cloud/CLAUDE.md`. Move the
    registries' docs into `app/gui/CLAUDE.md`.
- **Authentication:** delete `src/authentication/` (`cognito.ts`, `listen.ts`,
  `service.ts` and their mocks) and the paywall composables
  (`composables/paywall/`).
  - Reduce `providers/auth.ts` and `providers/session*` to the local user and
    session: one user, never signed out, no tokens, no 401 recovery or backoff.
  - Remove `ProtectedLayout`'s access levels and its login redirect.
- **Core importers of `$/cloud`:** fix each one: `App.vue`,
  `ProtectedLayout.vue`, `composables/transferBetweenCategories.ts`,
  `configurations/settings.ts`, `providers/backends.ts`,
  `utils/transferBetweenCategories.ts`, `router/router.ts`,
  `router/routeNames.ts`, Drive's `AssetContextMenu`/`driveActions`/
  `globalContextMenuEntries`/`PaywallModal`, `AssetColumnCell`,
  `DriveBarToolbar`, `UserBar`, `UserMenu`, `Settings/OfflineUserSettingsSection`,
  `Settings/tabs`, `project-view/components/UpsertSecretPanel.vue`, and their
  tests.
- **Electron.** Delete:
  - `src/authentication.ts`: the system-browser OAuth IPC, the access-token
    save and refresh, and the `~/.enso/credentials` writer;
  - the `authentication` preload API;
  - the `enso://` deep-link handling in `urlAssociations.ts` and the
    `protocols` entry in `electron-builder-config.ts`;
  - the Cognito hosts in `security.ts`;
  - the `--authentication.*` flags.
  - Keep `handleProjectProtocol` (the project-asset protocol in `index.ts`),
    which is not cloud.
- **Graph editor.** Delete the cloud file browser
  (`WidgetFileBrowser/cloudBrowser.ts` and the cloud part of `browsableTypes`
  and `FileBrowserWidget`), so the file widget browses local files only. The
  `enso://Users/...` path form is no longer offered.

## PR 3: remove the remote backend

- **`app/common`:**
  - Delete `services/RemoteBackend.ts`, `services/RemoteBackend/ids.ts`,
    `services/Backend/remoteBackendPaths.ts` and
    `services/Backend/projectExecution.ts`.
  - Trim `services/Backend.ts` of the cloud-only data types and methods: users,
    groups, organisations, plans, subscriptions, checkout, API keys,
    invitations, audit log, permissions and sharing, project executions and
    schedules, S3 versions and tags, datalinks, and cloud-only asset types.
  - Keep the secret methods (decision 5).
  - `BackendType` keeps both values only if removing `remote` would cascade
    beyond this PR. Otherwise `remote` goes too. The implementer reports which,
    and the plan records the ruling.
- **GUI:**
  - `providers/backends.ts` returns only the local backend.
  - Delete the remote category types, `CATEGORY_BACKEND`'s remote entries and
    `isCloudCategory`.
  - Delete `utils/transferBetweenCategories.ts` and its composable (only
    moves within local folders remain), and the cloud upload in
    `providers/upload.ts`.
  - Remove the hybrid states (`HybridOpened`, `HybridDownloaded` and sync) from
    `providers/openedProjects/projectStates.ts`, and the cloud paths from
    `router/dashboardGuards.ts`: the welcome project is always local.
  - Remove `isCloudDataUnavailable` (23 uses).
  - Remove the Versions tab's cloud branches.
- **Shim:**
  - Remove the hybrid open flow (`runProjects.ts`
    `setHybridOpenInProgress`) and the `CloudParams` and `ENSO_CLOUD_*` env
    vars in `projectService/index.ts`.
  - Remove `downloadCloudProject` in `handler/watcher.ts`, the `cloud?`
    parameter in `handler/projectService.ts`, and `upload.ts`.
  - Keep `ENSO_LOCAL_PROJECT_ID`/`ENSO_LOCAL_PROJECT_SESSION_ID`.
- **Electron:** remove `backend.ts`'s `createRemoteBackend` (headless mode
  becomes local only), `assetManagement.ts`, and the `/cloud/download-project`
  and `/cloud/get-project-archive` middleware in `server.ts`.

## PR 4: prune tests, dependencies and build configuration

- **Tests:**
  - Delete `integration-test/mock/cloudApi.ts` and the cloud-only specs:
    activityLogSettings, authPreserveEmail, billing, dataLinkEditor,
    degradedAuth, loginLogout, loginScreen, organizationSettings, signUp,
    userGroupsSettings, userMenu (cloud parts), userSettings and
    welcomeProject (cloud path).
  - Move the mixed specs (contextMenu, copy, copyInstead, createAsset, delete,
    driveView, exportAsset, labelsPopover, pageSwitcher, rightPanel, sort and
    others) to the local mock.
  - Remove the login and cloud helpers from `integration-test/actions/`, and
    update the accessibility baselines.
  - Delete `electron-client/tests/cloudWorkflow.spec.ts` and
    `loginAsTestUser`.
- **Dependencies:** remove `aws-amplify` and `amazon-cognito-identity-js` from
  `app/gui/package.json`. Keep Sentry and Mapbox.
- **Configuration:**
  - Remove `ENSO_IDE_API_URL`, `ENSO_IDE_CLOUD_BUILD`, `ENSO_IDE_AUTH_ENDPOINT`,
    `ENSO_IDE_COGNITO_*`, `ENSO_IDE_STRIPE_KEY` and `ENSO_IDE_CHAT_URL`. They go
    from `app/gui/.env`, `.env.testing`, `src/config.ts`,
    `electron-client/src/guiConfig.ts`/`configParser.ts`/`buildInfo.ts`/
    `esbuildConfig.ts`, `vite.config.ts`, `vitest.config.ts` and
    `playwright.config.ts`.
  - Update `app/gui/.dev-env` only if it is in this repo. It contains real
    production identifiers, so don't copy them anywhere.
- **Build and CI:**
  - In `build_tools/build/src/ide/web.rs`, remove the cloud variables above.
  - In the CI generator (`build_tools/build/src/ci_gen*`), drop the
    `ENSO_TEST_USER`/`ENSO_CLOUD_TEST_ACCOUNT_*` environment of the IDE
    packaging jobs and the IDE e2e job's `~/.enso/credentials` step, then
    regenerate the workflows.
  - Leave the standard library cloud test jobs and `cloud_tests/` alone (out of
    scope).
- **Docs:** update `app/gui/CLAUDE.md`, `app/electron-client/CLAUDE.md`,
  `app/common/CLAUDE.md` and the root `CLAUDE.md`, and mark the React-to-Vue
  foundations spec's section 6b ("keeping cloud-only ports separable") as
  superseded.

## Verification (each PR)

- `corepack pnpm -r --if-present run compile`, then the GUI typecheck
  (`vue-tsc`), ESLint and Prettier.
- Unit tests (vitest) for the GUI, common and the shim.
- The GUI Playwright suite on Linux (WSL), where its screenshots are compared,
  and the touched specs on Windows.
- The Electron package tests in CI (`Package New IDE` on Linux and Windows).
- A Windows installer, tested by the user before merge. The checks:
  - no login screen;
  - the app starts on Local;
  - projects open, save and version;
  - Settings has no cloud sections;
  - with the network disconnected, no cloud request is made and nothing
    errors.

## Risks

- **PR 3 is the large one** (about 100 files reference the remote backend).
  It's split into tasks by package, and the type checker finds the
  call sites.
- **Hidden assumptions.** Code that silently assumes a remote backend exists
  will show up as runtime errors once PR 1 stops creating a session from the
  cloud. That is why PR 1 ships and gets tested first.
- **Playwright porting.** The suite leans on the cloud mock, so PR 4 is real
  porting work, not only deletion. The local mock (`localApi.ts`) already
  covers the drive.
- **Secrets drift.** Dormant code can rot. Keeping the secrets screens'
  unit tests running is the guard.
