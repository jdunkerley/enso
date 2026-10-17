# Local-only IDE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop IDE runs with no Enso Cloud: no login, no cloud drive, no
remote backend. It keeps the local drive, labels, Recent, git versioning, the
graph editor, AI components, the update checker, Sentry, Analytics and Mapbox
(with a user-supplied token). It gains local datalinks.

**Architecture:** Five staged PRs, each leaving a working app:

1. make the existing local-only mode the only mode;
2. delete the cloud UI and authentication, moving what stays to core;
3. (PR 2b) add local `.datalink` files;
4. (PR 3) remove `RemoteBackend` and the cloud halves of the shared types;
5. (PR 4) prune what's left: tests, dependencies, environment variables and CI.

The abstract `Backend` class stays, with `LocalBackend` as its only
implementation.

**Tech Stack:** Vue 3 + TypeScript (app/gui), app/common, Electron
(app/electron-client), Node project-manager shim, vitest, Playwright, Rust
build_tools (CI generator).

**Spec:** `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`

## Global Constraints

- The scope is the IDE only. Do not change the engine, the standard library
  (`Enso_Cloud`, `Enso_Secret`, `Enso_File`), `test/Cloud_Tests` or their CI
  jobs.
- Delete cloud code; don't feature-flag it. The exceptions are the dormant
  secrets screens (`app/gui/src/secrets/`, decision 5) and the datalink editor
  (`app/gui/src/datalinks/`), which is dormant from PR 2 until PR 2b enables it.
- Keep the abstract `Backend`. Keep its secret methods (`createSecret`,
  `getSecret`, `updateSecret`, `listSecrets`) and its datalink methods and
  types.
- **Third-party services:**
  - The update checker, Sentry and Google Analytics stay. They are configured
    only by build-time variables (`ENSO_IDE_SENTRY_DSN`,
    `ENSO_IDE_GOOGLE_ANALYTICS_TAG`), never by a cloud config fetch.
  - Mapbox takes no build-time token. The user enters it in Settings → Local →
    Maps, and it is never sent anywhere except Mapbox.
- Leave `cloud-<projectId>/` folders on disk untouched.
- **Every PR must:**
  - pass `corepack pnpm -r --if-present run compile`, the GUI typecheck, ESLint
    and Prettier on touched files, and the vitest suites for the GUI, common and
    shim;
  - pass the GUI Playwright suite on Linux (WSL; source `~/.enso-toolchain.sh`
    first);
  - get green CI, including `Package New IDE` on Linux and Windows.
- PRs 1, 2b and any other user-visible feature PR need a CHANGELOG entry and
  before/after screenshots (via the orphan `pr-screenshots` branch), and wait
  for the user's installer test before merge. Invisible PRs take the
  `CI: No changelog needed` label.
- In worktrees: run `corepack pnpm install` and
  `corepack pnpm -r --if-present run compile` before Playwright (a stale dist
  hangs on "Loading Enso..."). Regenerate icons with
  `corepack pnpm --dir app/gui run generate-icons` if icon types fail.
- **Never:**
  - `git stash`;
  - change git config;
  - skip hooks (`--no-verify`);
  - copy anything from `app/gui/.dev-env`, which holds real production
    identifiers.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01VXUBZRT2NT9f6Rydjo36F6`
- Line numbers in this plan are against develop 4a504bf4d9. Re-locate by symbol
  name if they have moved.

## Execution order and rulings made while planning

**Order:**

- Tasks run in this order: PR 1 (Tasks 1–9), PR 2 (10–17), PR 2b (20–28), then
  PR 3. PR 3 runs **Tasks 40–43 first**, then 30–39. PR 4 is Tasks 44–49.
- Why Tasks 40–43 come first: they port the Playwright specs to the local mock
  and delete `integration-test/mock/cloudApi.ts`, the cloud-only specs and the
  login fixtures. The mock imports the remote-backend files PR 3 deletes, and
  the integration tests are typechecked, so PR 3 cannot typecheck while it
  exists. Those tasks use `git rm --ignore-unmatch`, so they hold wherever they
  land.

**Rulings:**

- **R1 (PR 1).** The Mapbox token's value lives in a persisted local store in
  `providers/mapboxToken.ts` (key `enso-mapbox-settings`). The Maps field is
  declared in `Settings/tabs.ts`, like every other entry.
- **R2 (PR 1).** Hide the permanently disabled cloud-only drive toolbar buttons
  (New Secret, New Credential, New Datalink). PR 2b brings back New Datalink.
- **R3 (PR 1).** Hide the right panel's "Exclusive to Cloud" Description tab; PR
  3 deletes it. Leave the cloud keyboard shortcuts until PR 3 deletes their
  actions.
- **R4 (PR 1).** The cloud-driven drive checks in `accessibility.spec.ts` are
  skipped until PR 4 ports them.
- **R5 (PR 2).** PR 2 takes the `CI: No changelog needed` label, since PR 1's
  entry covers what users see.
- **R6 (PR 2).** The datalink path picker uses the system file dialog
  (`window.api.fileBrowser.openFileBrowser`). PR 2b then deletes
  `FilePathInput.vue` (R12).
- **R7 (PR 2).** Electron's `backend.ts` (`createRemoteBackend`) and the
  headless `enso:` branch are deleted in PR 2, because the token source they
  need is deleted there. This is pulled forward from PR 3.
- **R8 (PR 2).** Empty `security.ts`'s `TRUSTED_HOSTS`. **Before doing so, the
  implementer confirms the list only gates navigation and new windows.** It must
  not block the update checker's GitHub fetch, Mapbox tiles or Sentry. If it
  does, keep exactly the hosts those three need.
- **R9 (PR 2 → PR 3).** `$/secrets/serviceCredentials/utilities.ts` imports
  `getOauthCallbackPath` from `remoteBackendPaths`. PR 3 moves that helper into
  `src/secrets/` before deleting `remoteBackendPaths`.
- **R10 (PR 2b).** A datalink is updated by `LocalBackend.createDatalink` with a
  non-null `datalinkId`, which rewrites the file in place. There is no new
  abstract `updateDatalink`.
- **R11 (PR 2b).** In the editor, `SecureValue` fields hide the "Enso Secret"
  choice and say that Enso secrets are not available yet. A file that already
  refers to a secret keeps the reference, shown read-only. The schema and
  validator are unchanged.
- **R12 (PR 2b).** Hide the "Enso File" datalink type, and delete
  `FilePathInput.vue`.
- **R13 (PR 2b).** A datalink that can't be read is listed, but opening it shows
  an error toast and no editor, so its content is never overwritten. Renaming
  keeps the `.datalink` extension. Only read dialogs that already have file-type
  filters get a "Datalink" filter.
- **R14 (PR 3).** Remove `BackendType.remote`, leaving `BackendType` as
  `{ local }`. Keep a minimal `User` (`userId`, `name`, `email`), or delete
  `Backend.User` if PR 2 gave the local session its own type.
- **R15 (PR 3).** Delete the shim's project watcher (`handler/watcher.ts`,
  `fs.ts`, `chokidar`, `/api/watcher/*`), **after the implementer confirms that
  nothing local uses it.** Also delete:
  - the dev server's `/api/cloud/*` routes;
  - Electron's skipped `tests/headless/writeFile.test.ts`;
  - the right panel's Schedule tab.
- **R16 (PR 3).** Saved tabs that point at cloud or hybrid projects fail to load
  once, and the app then starts with no restored tabs; that's accepted. Text
  strings used only by deleted code are pruned in PR 4.
- **R17 (PR 4).** Delete `copyInstead.spec.ts`, `exportAsset.spec.ts` and
  `welcomeProject.spec.ts`, plus the tests the local backend can't support
  (`copy`/`copy (keyboard)`, `Asset Panel Decription`, `download app`).
  - Keep `ENSO_IDE_HOST`, which builds the contact URL.
  - Keep the dormant secret forms' `ENSO_IDE_API_URL` parameter, which reads
    `undefined` once the variable is gone.

---

## PR 1: always local-only

The user-visible switch (spec "PR 1", decisions 4 and 8): the IDE stops fetching
the remote configuration, always runs on the offline session, no longer calls
`registerCloud`, lists only the local drive categories, drops the cloud entry
points from menus and toolbars, and takes the Mapbox token from a new Settings →
Local → Maps field instead of the cloud. No cloud code is deleted yet (PR 2/3 do
that); this PR only stops reaching it. Branch:
`feature/local-only-always-local`. It is a feature: it gets a `CHANGELOG.md`
entry (no `CI: No changelog needed` label), before/after screenshots on the
orphan `pr-screenshots` branch (startup drive, left bar, context menu, Settings
→ Local with Maps, the map visualisation's empty state), and a Windows installer
test by the user before merge (merge gate for features).

Work in `C:\Repos\Enso\ide-cld` (or a fresh worktree off `develop`). Before any
Playwright run: `corepack pnpm -r --if-present run compile` (the specs read
`enso-common`'s `dist/`, including the new text keys).

### Task 1: The remote configuration is never fetched

**Files**

- Modify: `app/gui/src/providers/config.ts` (whole `createConfigStore`,
  ~l.33–118)
- Modify: `app/gui/src/router/router.ts` (first `router.beforeEach`, ~l.94–99)
- Modify: `app/gui/src/providers/__tests__/config.test.ts` (replace the re-fetch
  tests)

**Interfaces**

- Consumes: nothing from earlier PRs (PR 1 is first).
- Produces: `useConfig()` with `params` (unchanged),
  `remoteConfig: RemoteConfig` (always the frozen empty object) and
  `waitForRemoteConfig(): Promise<RemoteConfig>` (resolves at once).
  `isFetching` and `isError` are removed (their only reader, `useAuthDisabled`,
  goes in Task 2). `RemoteConfig` stays exported as an interface, so the dormant
  credential forms (`src/cloud/credentials/*CredentialsForm.vue`) and
  `providers/backends.ts` (`config.remoteConfig?.ENSO_IDE_API_URL ?? ''`) keep
  compiling unchanged.

- [ ] **Step 1: Write the failing test.** Replace the body of
      `providers/__tests__/config.test.ts` (delete `createMemoryStorage`,
      `persistConfigFromPreviousRun`, `settle` and the four re-fetch tests)
      with:

  ```ts
  /** @file The IDE is local-only: the remote configuration is empty, and nothing is fetched for it. */
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

  describe("the configuration store", () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    beforeEach(() => {
      vi.stubGlobal("fetch", fetchMock);
      vi.resetModules();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockClear();
    });

    it("has an empty remote configuration, and fetches nothing for it", async () => {
      const { useConfig } = await import("../config");
      const config = useConfig();
      expect(config.remoteConfig).toEqual({});
      await expect(config.waitForRemoteConfig()).resolves.toEqual({});
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("needs no query client: it can be created outside a Vue app", async () => {
      const { useConfig } = await import("../config");
      expect(() => useConfig()).not.toThrow();
    });
  });
  ```

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/config.test.ts`
      — expected FAIL: `useQuery` throws
      `vue-query hooks can only be used inside setup() function...` outside an
      app, and the first test sees one `fetch` of `https://mock/utils/config`.

- [ ] **Step 3: Implement.** In `providers/config.ts` drop the imports of
      `waitForData`, `sentry`, `useQuery`, `CONFIGURATION_PATH`, `watch`,
      `watchEffect`, `z`, `HTTP_STATUS_BAD_REQUEST`, `SESSION_START`,
      `REMOTE_CONFIG_SCHEMA`, and replace the store with:

  ```ts
  /**
   * The keys the Enso Cloud's remote configuration used to carry. The IDE is local-only
   * (`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`): nothing is fetched, and the
   * configuration is always empty. The type stays while the dormant secrets forms read it (decision
   * 5); PR 4 removes it with the cloud variables.
   */
  export interface RemoteConfig {
    readonly ENSO_IDE_ENVIRONMENT?: string;
    readonly ENSO_IDE_API_URL?: string;
    readonly ENSO_IDE_AUTH_ENDPOINT?: string;
    readonly ENSO_IDE_STRIPE_KEY?: string;
    readonly ENSO_IDE_COGNITO_USER_POOL_ID?: string;
    readonly ENSO_IDE_COGNITO_USER_POOL_WEB_CLIENT_ID?: string;
    readonly ENSO_IDE_COGNITO_DOMAIN?: string;
    readonly ENSO_IDE_COGNITO_REGION?: string;
    readonly ENSO_IDE_GOOGLE_OAUTH_CLIENT_ID?: string;
    readonly ENSO_IDE_STRAVA_OAUTH_CLIENT_ID?: string;
    readonly ENSO_IDE_MS365_OAUTH_CLIENT_ID?: string;
    readonly ENSO_IDE_SALESFORCE_OAUTH_CLIENT_ID?: string;
  }

  const EMPTY_REMOTE_CONFIG: RemoteConfig = Object.freeze({});

  export type ConfigStore = ReturnType<typeof createConfigStore>;

  function createConfigStore() {
    return proxyRefs({
      params: computed(() =>
        parseWebAppOptionsFromSearchParams(
          new URLSearchParams(window.location.search),
        ),
      ),
      remoteConfig: computed((): RemoteConfig => EMPTY_REMOTE_CONFIG),
      waitForRemoteConfig: () => Promise.resolve(EMPTY_REMOTE_CONFIG),
    });
  }

  export const useConfig = createGlobalState(createConfigStore);
  ```

  The Sentry `tracePropagationTargets`/`beforeSend` watch (keyed on the cloud
  API URL) goes with the fetch: Sentry stays configured only by
  `ENSO_IDE_SENTRY_DSN` in `entrypoint.ts` (decision 4). In `router/router.ts`
  delete the first `router.beforeEach` (the one awaiting
  `config.waitForRemoteConfig()`) and the now-unused `useConfig` import.

- [ ] **Step 4: Run tests.**
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/config.test.ts`
      — PASS. `corepack pnpm --dir app/gui run typecheck` will still fail in
      `authentication/service.ts` (`isFetching`/`isError`): fixed in Task 2,
      which lands in the same commit series; do not commit a red typecheck —
      continue to Task 2 Step 3 before committing this task, or commit both
      together.

- [ ] **Step 5: Commit** (together with Task 2, see its Step 5).

### Task 2: Authentication is always disabled

**Files**

- Modify: `app/gui/src/authentication/service.ts` (`useInitAuthService`
  ~l.127–151; delete `RemoteConfigState`, `useAuthDisabled`, `loadAmplifyConfig`
  ~l.153–247)
- Modify (rewrite): `app/gui/src/authentication/__tests__/service.test.ts`
  (today it tests only `useAuthDisabled`)
- Modify: `app/gui/src/providers/__tests__/session.test.ts` (delete the test
  "keeps the local stand-in session while a failed remote configuration is
  re-fetched", ~l.140–185, and the `useAuthDisabled`/`RemoteConfig` imports,
  l.11–12)

**Interfaces**

- Consumes: Task 1's `useConfig()` (no longer read here).
- Produces: `useInitAuthService(): AuthService` with `cognito: Ref<undefined>`
  and `authDisabled: ComputedRef<true>`; `useSession().isAuthDisabled === true`
  and `useSession().session` is `makeOfflineSession()` from the first query.
  `AmplifyConfig`, `toNestedAmplifyConfig` and `setDeepLinkHandler` stay (still
  used by `cognito.ts` and the deep-link IPC; PR 2 deletes the module).

- [ ] **Step 1: Write the failing test.** Replace
      `authentication/__tests__/service.test.ts` with:

  ```ts
  /** @file The IDE is local-only: authentication is always disabled, and there is no Cognito. */
  import { useInitAuthService } from "$/authentication/service";
  import { withSetup } from "@/util/testing";
  import { expect, test, vi } from "vitest";

  vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

  test("authentication is disabled from the start, with no Cognito client", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = withSetup(() => useInitAuthService());
    expect(service.authDisabled.value).toBe(true);
    expect(service.cognito.value).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  ```

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/authentication/__tests__/service.test.ts`
      — expected FAIL: `authDisabled.value` is `false` (after Task 1 the config
      has no `isFetching`/ `isError`, so the old predicate never settles).

- [ ] **Step 3: Implement.** In `authentication/service.ts`:

  ```ts
  export function useInitAuthService(): AuthService {
    const router = useRouter();
    // The IDE is local-only (`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`): there
    // is no Cognito, so authentication is disabled and the session is always the offline stand-in
    // (`makeOfflineSession` in `$/providers/session`). PR 2 deletes this module.
    const cognito = shallowRef<Cognito | undefined>(undefined);
    const authDisabled = computed(() => true);
    if (detect.isOnElectron()) {
      setDeepLinkHandler((url) => void router.push(url), cognito);
    }
    return {
      cognito,
      authDisabled,
      registerAuthEventListener: listen.registerAuthEventListener,
    };
  }
  ```

  Delete `RemoteConfigState`, `useAuthDisabled` and `loadAmplifyConfig`, then
  the imports they leave unused (`useConfig`, `RemoteConfig`, `useFeatureFlag`,
  `ToValue`, `toRef`, `toValue`, `saveAccessTokenModule` only if `AmplifyConfig`
  no longer names it — it does, keep that one, `common` from
  `enso-common/src/constants` if unused). Update the `authDisabled` doc comment
  on `AuthService` to "Always `true`: the IDE is local-only." No change to
  `providers/session.ts` or `providers/auth.ts`: their `authDisabled` branches
  already give the offline session and the synthetic "working locally" user
  (`getText('offlineUserName')`).

- [ ] **Step 4: Run tests.**
      `corepack pnpm --dir app/gui exec vitest run src/authentication src/providers/__tests__/session.test.ts src/providers/__tests__/config.test.ts src/providers/__tests__/auth.test.ts`
      — PASS. `corepack pnpm --dir app/gui run typecheck` — PASS.
      `grep -rn "useAuthDisabled\|waitForRemoteConfig().catch\|isFetching: remoteConfig" app/gui/src`
      — empty.

- [ ] **Step 5: Commit.**
      `git add app/gui/src/providers/config.ts app/gui/src/router/router.ts app/gui/src/providers/__tests__/config.test.ts app/gui/src/authentication/service.ts app/gui/src/providers/__tests__/session.test.ts app/gui/src/authentication/__tests__/service.test.ts`
      —
      `git commit -m "Always run on the offline session: no remote configuration fetch"`

### Task 3: Stop registering the cloud; the Versions tab registers from the core

**Files**

- Create: `app/gui/src/registerCore.ts`
- Create: `app/gui/src/__tests__/registerCore.test.ts`
- Modify: `app/gui/src/entrypoint.ts` (l.6 import, l.43 `registerCloud(router)`)
- Modify: `app/gui/src/cloud/index.ts` (file comment only),
  `app/gui/src/cloud/CLAUDE.md` ("`index.ts`" bullet and the Rules' first
  bullet), `app/gui/CLAUDE.md` (add a "Local-only" note)

**Interfaces**

- Consumes: `contributeRightPanelTab(tab, load)` /
  `rightPanelTabContribution(tab)` (`$/providers/rightPanelContributions`);
  `AssetVersions.vue` at its current path `$/cloud/versions/AssetVersions.vue`
  (PR 2 moves it to `$/versions/` and rewrites this one import).
- Produces: `registerCore(): void` — contributes only `'versions'`. `'settings'`
  (Properties) and `'executionsCalendar'` (Schedule) are contributed by nothing,
  so `providers/rightPanel.ts` hides them
  (`hidden: () => rightPanelTabContribution(...) == null`). `registerCloud`
  stays defined and tested (`cloud/__tests__/registerCloud.test.ts`) but
  uncalled until PR 2 deletes it.

What disappears with `registerCloud` (checked against `cloud/index.ts`): the
auth routes (`registerAuthRoutes`; `ProtectedLayout`'s `LOGIN_PATH` redirect
only fires with a `null` session, which the offline session never is, and
`/login` etc. fall to the catch-all `redirect: '/'`), the
Account/Organization/Billing settings sections (the Account tab keeps the core
`OfflineUserSettingsSection`; the cloud tabs have no sections and are not
listed), the subscription/payments routes, `CLOUD_DISABLED_ROUTE`
(`requireCloudBrowserEnabled` already checks `router.hasRoute`), the agreements
gate (`hasAgreementsGate()` is `false`, so `requireUserAgreements` returns
`false`), the four app-container modals (`loadAppContainerModals()` resolves
`undefined`), the Properties tab and the devtools (`devtools()` is `undefined`;
`ProtectedLayout` renders `v-if="displayDevTools && Devtools"`). None of these
is reached by a name or route the core needs.

- [ ] **Step 1: Write the failing test**
      `app/gui/src/__tests__/registerCore.test.ts`:

  ```ts
  /** @file The core's own contributions: the Versions tab, now that the cloud is not registered. */
  import { registerCore } from "$/registerCore";
  import {
    resetRightPanelContributions,
    rightPanelTabContribution,
  } from "$/providers/rightPanelContributions";
  import { afterEach, expect, test } from "vitest";

  afterEach(resetRightPanelContributions);

  test("contributes the Versions tab, and neither Properties nor Schedule", async () => {
    registerCore();
    const load = rightPanelTabContribution("versions");
    expect(load).toBeTypeOf("function");
    const loaded = await load!();
    const component = "default" in loaded ? loaded.default : loaded;
    expect((component as { __name?: string }).__name).toBe("AssetVersions");
    expect(rightPanelTabContribution("settings")).toBeUndefined();
    expect(rightPanelTabContribution("executionsCalendar")).toBeUndefined();
  });
  ```

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/__tests__/registerCore.test.ts`
      — expected FAIL: `Failed to resolve import "$/registerCore"`.

- [ ] **Step 3: Implement** `app/gui/src/registerCore.ts`:

  ```ts
  /**
   * @file The core's contributions to the app's registries, made by `entrypoint.ts` before the
   * router starts. Since the IDE became local-only (PR 1 of
   * `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`) `registerCloud` is no longer
   * called, but the Versions tab serves local git versioning (decision 7), so the core registers it.
   */
  import { contributeRightPanelTab } from "$/providers/rightPanelContributions";

  /** Contribute the core's right-panel tabs. Call it before the router's first navigation. */
  export function registerCore() {
    // The tab moves to `$/versions/` in PR 2; until then it lives under `src/cloud/`. A dynamic
    // `import()` is outside `no-restricted-imports` (static imports only), so the core boundary
    // rule does not flag it.
    contributeRightPanelTab(
      "versions",
      () => import("$/cloud/versions/AssetVersions.vue"),
    );
  }
  ```

  ESLint 10 reports unused disable directives, so add none here. In
  `entrypoint.ts`: replace `import { registerCloud } from '$/cloud'` with
  `import { registerCore } from '$/registerCore'` and `registerCloud(router)`
  with `registerCore()`. Docs: in `cloud/index.ts`'s file comment and
  `cloud/CLAUDE.md`'s `index.ts` bullet add "Not called since the IDE became
  local-only (PR 1); PR 2 deletes this folder."; in `app/gui/CLAUDE.md` add
  under its overview: "**Local-only.** The IDE runs with no Enso Cloud: no
  remote configuration fetch, always the offline session (`makeOfflineSession`),
  no `registerCloud`; core contributions are in `src/registerCore.ts`. See
  `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`."

- [ ] **Step 4: Run tests.**
      `corepack pnpm --dir app/gui exec vitest run src/__tests__/registerCore.test.ts src/cloud/__tests__/registerCloud.test.ts src/providers/__tests__/rightPanelContributions.test.ts`
      — PASS.
      `corepack pnpm --dir app/gui exec eslint src/registerCore.ts src/entrypoint.ts`
      — clean.
      `grep -rn "registerCloud(" app/gui/src --include=*.ts | grep -v "cloud/"`
      — empty.

- [ ] **Step 5: Commit.**
      `git add app/gui/src/registerCore.ts app/gui/src/__tests__/registerCore.test.ts app/gui/src/entrypoint.ts app/gui/src/cloud/index.ts app/gui/src/cloud/CLAUDE.md app/gui/CLAUDE.md`
      —
      `git commit -m "Stop registering the cloud; register the Versions tab from the core"`

### Task 4: The drive lists only Local, Recent and the added folders

**Files**

- Modify: `app/gui/src/providers/category.ts` (`createCategoriesStore`
  ~l.150–287: delete `teamCategories`, `cloudCategoriesList`;
  `getCategoryByDirectoryId` searches `localCategoriesList` only; the returned
  object loses `cloudCategoriesList`)
- Modify: `app/gui/src/providers/drive.ts` (`defaultCategory` ~l.54–62,
  `currentCategory.get` ~l.64, the list `watch` ~l.90)
- Modify: `app/gui/src/components/AppContainer/LeftPanel.vue` (first
  `.categories` block ~l.130–138; `cloudDisabledReason`, `isOnline`, `auth`
  ~l.52–63 and their imports)
- Modify: `app/gui/src/providers/__tests__/category.test.ts`,
  `app/gui/src/providers/__tests__/drive.test.ts`

**Interfaces**

- Consumes: nothing new.
- Produces: `CategoriesStore` without `cloudCategoriesList`;
  `localCategoriesList` unchanged
  (`[{type:'local'}, {type:'localRecent'}, ...localDirectories]`). `Category`,
  `CategoryType`, `CATEGORY_BACKEND`, `isCloudCategory`,
  `categoryLabel`/`categoryDirectoryId` cases for
  `cloud`/`recent`/`trash`/`team` stay until PR 3.
  `useDriveLocation().currentCategory` never returns a cloud category: a stored
  `cloud`/`recent`/`trash`/`team-…` key reads as `{type:'local'}`.

- [ ] **Step 1: Write the failing tests.** In `category.test.ts`, add to the
      first describe:

  ```ts
  test("only the local categories are listed", () => {
    const categories = useCategories();
    expect(categories).not.toHaveProperty("cloudCategoriesList");
    expect(
      categories.localCategoriesList.map((category) => category.type),
    ).toEqual(["local", "localRecent"]);
  });
  ```

  In `drive.test.ts`, drop `cloudCategoriesList` from the `useCategories` mock
  and add:

  ```ts
  test("a cloud category saved by an earlier version reads as Local", () => {
    LocalStorage.getInstance().set("driveDisplay", {
      currentCategory: "cloud",
      currentDirectoryId: null,
    });
    expect(mountDriveLocation().currentCategory).toEqual({ type: "local" });
  });

  test("with nothing saved, the drive starts on Local", () => {
    expect(mountDriveLocation().currentCategory).toEqual({ type: "local" });
  });
  ```

- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/category.test.ts src/providers/__tests__/drive.test.ts`
      — expected FAIL: `cloudCategoriesList` is present; the saved `cloud` key
      reads as `{type:'cloud'}`.

- [ ] **Step 3: Implement.** `category.ts`: delete `teamCategories` and
      `cloudCategoriesList` (keep `groupById`, used by the `team`
      label/directory cases); `getCategoryByDirectoryId` becomes
      `localCategoriesList.value.find(...)`. `drive.ts`:

  ```ts
  // The IDE is local-only: the drive starts on Local, and a cloud category saved by an earlier
  // version (or a team's) is not shown, since nothing lists it.
  const defaultCategory: Category = { type: 'local' }

  const currentCategory = computed({
    get: () => {
      const stored = categoryFromKey(storedDriveDisplay.value?.currentCategory)
      return stored != null && !isCloudCategory(stored) ? stored : defaultCategory
    },
    set: /* unchanged */
  })
  ```

  and the watch becomes `watch(() => categories.localCategoriesList, …)`. Drop
  the `useAuth` import if unused. `LeftPanel.vue`: delete the first
  `<div class="categories">` (the `cloudCategoriesList` loop) and
  `cloudDisabledReason`; keep `localDisabledReason`.

- [ ] **Step 4: Run tests.** Same vitest command — PASS; plus
      `corepack pnpm --dir app/gui exec vitest run src/components/AppContainer`
      and `corepack pnpm --dir app/gui run typecheck` — PASS.
      `grep -rn "cloudCategoriesList" app/gui/src` — empty.

- [ ] **Step 5: Commit.**
      `git add app/gui/src/providers/category.ts app/gui/src/providers/drive.ts app/gui/src/components/AppContainer/LeftPanel.vue app/gui/src/providers/__tests__/category.test.ts app/gui/src/providers/__tests__/drive.test.ts`
      — `git commit -m "List only the local drive categories"`

### Task 5: Remove the cloud entry points from menus, toolbar, columns and right panel

**Files**

- Modify: `app/gui/src/dashboard/layouts/AssetContextMenu.vue` (the
  `uploadToCloud` entry ~l.331–342, `canUploadToCloud` ~l.190,
  `uploadFileToCloud`, the `isUploadableAsset` import from
  `$/cloud/uploadToCloud` if no longer used — it is still used by
  `downloadToLocal`, so keep it)
- Modify: `app/gui/src/dashboard/layouts/AssetsTableContextMenu.vue` (entry
  ~l.201–210, `canUploadToCloud` ~l.75, `canUploadAllProjectsToCloud` ~l.91,
  `uploadFilesToCloud` ~l.106, `useUploadFileToCloud`)
- Modify:
  `app/gui/src/dashboard/pages/dashboard/Drive/DriveBar/DriveBarToolbar.vue`
  (New Secret / New Credential / New Datalink buttons ~l.246–272)
- Modify:
  `app/gui/src/dashboard/pages/dashboard/components/column/columnUtils.ts`
  (`getColumnList` ~l.86) and its test `…/column/__tests__/columnUtils.test.ts`
- Modify: `app/gui/src/providers/rightPanel.ts` (the `description` tab ~l.90–96)

**Interfaces**

- Consumes: Task 4 (no cloud category is reachable, so the `isCloud` branches —
  "Open in Cloud" (`run`), `runAsTask`, `downloadToLocal`, `share`, Trash
  entries, cross-category drags ("Move to cloud") — are already unreachable;
  they are deleted in PR 3 with the remote categories).
- Produces: no `uploadToCloud` menu entry and no `isUnderPaywall` entry anywhere
  in the drive menus; `getColumnList` never returns `Column.sharedWith`; the
  right panel's Description tab is hidden outside a cloud category. The
  `uploadToCloud` input binding, `useUploadFileToCloud` and the paywall
  composables stay (PR 2 deletes `composables/paywall/`, PR 3 the transfer
  code).

- [ ] **Step 1: Write the failing test** (`columnUtils.test.ts`):

  ```ts
  describe("getColumnList: sharing", () => {
    test('there is no "Shared with" column, even for an enterprise cloud folder', () => {
      for (const plan of [Plan.free, Plan.enterprise]) {
        expect(
          getColumnList(plan, BackendType.remote, "team", false, true),
        ).not.toContain(Column.sharedWith);
        expect(
          getColumnList(plan, BackendType.local, "local", false, true),
        ).not.toContain(Column.sharedWith);
      }
    });
  });
  ```

  The menu, toolbar and right-panel changes are checked end to end by Task 8's
  `localOnly.spec.ts` (no "Export to Cloud" in the project's context menu, no
  "New Secret" or "New Credential" button, no Description/Properties/Schedule
  tab); there is no component test for either context menu to extend.

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/dashboard/pages/dashboard/components/column`
      — expected FAIL for `Plan.enterprise` + `team`.

- [ ] **Step 3: Implement.**
  - `columnUtils.ts`: delete the `Column.sharedWith` line from `columns` (the
    enum member and its CSS/icon maps stay until PR 3), and the now-unused
    `isEnterprise`/`isRoot` locals.
  - Both context menus: delete the `uploadToCloud` entry objects and the helpers
    listed above.
  - `DriveBarToolbar.vue`: on each of the three buttons replace
    `:isDisabled="!isCloud"` with `v-if="isCloud"` and the
    `:aria-label="isCloud ? … : getText('…cloudOnly')"` ternaries with the plain
    `getText('newSecret')`/`getText('newCredential')`/`getText('newDatalink')`.
    **Ruling needed:** the spec's PR 1 list does not name these three, but each
    is a permanently disabled "cloud only" button in a local-only app, and
    decision 5 says no UI entry point may open the secrets screens. Recommended
    default: hide all three now; PR 2b re-adds "New datalink" for the local
    drive.
  - `rightPanel.ts`: give the `description` tab
    `hidden: () => !isCloudDirectoryView.value`. **Ruling needed:** not in the
    spec's list, but it is a disabled "Exclusive to Cloud" tab on every local
    asset. Recommended default: hide it now (one line); PR 3 deletes it.
  - The cloud-only shortcuts (`uploadToCloud`, `run`, `runAsTask`, `share`,
    `switchOrganization`, …) still appear in Settings → Keyboard shortcuts.
    **Ruling needed:** recommended default: leave them until PR 3 deletes the
    actions; filtering the shortcut list now would touch the `keyboardShortcuts`
    registry and its equality test for no lasting gain.

- [ ] **Step 4: Run tests.**
      `corepack pnpm --dir app/gui exec vitest run src/dashboard src/providers`
      — PASS. `corepack pnpm --dir app/gui run typecheck` — PASS.
      `grep -rn "action: 'uploadToCloud'\|isUnderPaywall: " app/gui/src/dashboard/layouts`
      — empty.

- [ ] **Step 5: Commit.**
      `git add app/gui/src/dashboard/layouts/AssetContextMenu.vue app/gui/src/dashboard/layouts/AssetsTableContextMenu.vue app/gui/src/dashboard/pages/dashboard/Drive/DriveBar/DriveBarToolbar.vue app/gui/src/dashboard/pages/dashboard/components/column/columnUtils.ts app/gui/src/dashboard/pages/dashboard/components/column/__tests__/columnUtils.test.ts app/gui/src/providers/rightPanel.ts`
      —
      `git commit -m "Remove the cloud entry points from the drive's menus, toolbar and columns"`

### Task 6: The Mapbox token comes from Settings → Local → Maps

**Files**

- Modify: `app/gui/src/providers/mapboxToken.ts` (rewrite)
- Modify: `app/gui/src/providers/__tests__/mapboxToken.test.ts` (rewrite)
- Modify: `app/gui/src/dashboard/layouts/Settings/tabs.ts`
  (`LOCAL_TAB.sections`, after `localVersionsSettingsSection`)
- Modify: `app/gui/src/dashboard/layouts/Settings/__tests__/localTab.test.ts`
  (one test)
- Modify: `app/common/src/text/english.json` (new keys next to
  `localVersionsSettingsSection`, ~l.1090)
- Modify: `app/gui/src/dashboard/layouts/Settings/CLAUDE.md` ("Local
  directories" → add a "Maps" paragraph)

**Interfaces**

- Consumes: `createPersistedStore` (`$/utils/persistedStore`),
  `settingsFormEntryData` (`$/configurations/settings`).
- Produces:
  `mapboxSettingsStore: PersistedStore<{ accessToken: string | null }>`
  (localStorage key `enso-mapbox-settings`, version 1);
  `useMapboxToken(): ComputedRef<string | null>`;
  `setMapboxToken(token: string): void` (trims; blank clears to `null`). The old
  `createMapboxTokenStore`/`acquire` API is removed;
  `RemoteBackend.getMapboxToken` stays unused until PR 3 deletes it. Text keys:
  `mapsSettingsSection` "Maps", `mapboxTokenSettingsInput` "Mapbox access
  token", `mapboxTokenSettingsInputDescription` "Map visualizations use it to
  load maps from Mapbox, and it is sent nowhere else. Create one at
  account.mapbox.com.", `mapboxTokenMissing` "Maps need a Mapbox access token",
  `mapboxTokenMissingDescription` "Add your own Mapbox access token in Settings
  to show this map.", `openMapboxTokenSetting` "Open Settings".

**Ruling needed:** the spec says the token is stored in "the IDE's local
settings store (`configurations/settings.ts`)", but that file is the settings
page's declarative model, not a store. Recommended default: the model there
declares the field (in `tabs.ts`, as every other entry), and the value lives in
a `createPersistedStore` in `providers/mapboxToken.ts`, the idiom of the other
local settings (`providers/codeFont.ts`, `providers/localDirectories.ts`). There
is one local user, so "per user" is "per browser profile", as for those.

- [ ] **Step 1: Write the failing tests.**
      `providers/__tests__/mapboxToken.test.ts`:

  ```ts
  /** @file The Mapbox token is the user's own, from Settings: stored locally, never fetched. */
  import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

  const KEY = "enso-mapbox-settings";

  async function load() {
    vi.resetModules();
    return await import("../mapboxToken");
  }

  describe("the Mapbox token", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      localStorage.clear();
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    test("is absent until the user enters one, and nothing is fetched for it", async () => {
      const { useMapboxToken } = await load();
      expect(useMapboxToken().value).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("is saved trimmed, and survives a restart", async () => {
      const { setMapboxToken, useMapboxToken } = await load();
      const token = useMapboxToken();
      setMapboxToken("  pk.abc  ");
      expect(token.value).toBe("pk.abc");
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
        state: { accessToken: "pk.abc" },
        version: 1,
      });
      expect((await load()).useMapboxToken().value).toBe("pk.abc");
    });

    test("a blank value clears it", async () => {
      const { setMapboxToken, useMapboxToken } = await load();
      setMapboxToken("pk.abc");
      setMapboxToken("   ");
      expect(useMapboxToken().value).toBeNull();
    });

    test("a malformed saved value is ignored", async () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ state: { accessToken: 42 }, version: 1 }),
      );
      expect((await load()).useMapboxToken().value).toBeNull();
    });
  });
  ```

  `localTab.test.ts`, inside `describe('the Local settings tab')` (extend the
  `input` helper's union with `'mapboxTokenSettingsInput'`):

  ```ts
  test("the Maps section saves the Mapbox token to the local store", async () => {
    const { mapboxSettingsStore } = await import("$/providers/mapboxToken");
    mapboxSettingsStore.setState({ accessToken: null });
    await openLocalTab();
    expect(document.body.textContent).toContain(getText("mapsSettingsSection"));
    const user = userEvent.setup();
    await user.type(input("mapboxTokenSettingsInput"), " pk.typed ");
    await user.click(button(getText("save")));
    await flushPromises();
    expect(mapboxSettingsStore.getState().accessToken).toBe("pk.typed");
  });
  ```

- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/mapboxToken.test.ts src/dashboard/layouts/Settings/__tests__/localTab.test.ts`
      — expected FAIL: `setMapboxToken` is not exported; no Maps section.

- [ ] **Step 3: Implement** `providers/mapboxToken.ts`:

  ```ts
  /**
   * @file The user's Mapbox access token, which the map visualization (`GeoMapVisualization.vue`)
   * gives to Mapbox GL. The user enters it in Settings → Local → Maps (decision 8 of
   * `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`); it is kept in `localStorage` and
   * sent nowhere but Mapbox. There is no fetch and no refresh: it is the user's own token.
   */
  import { createPersistedStore } from "$/utils/persistedStore";
  import { computed } from "vue";
  import { z } from "zod";

  /** The Maps settings. */
  export interface MapboxSettings {
    /** `null` while the user has entered none. */
    readonly accessToken: string | null;
  }

  const MAPBOX_SETTINGS_SCHEMA = z.object({
    accessToken: z.string().min(1).nullable().default(null),
  });

  export const mapboxSettingsStore = createPersistedStore<MapboxSettings>(
    () => ({ accessToken: null }),
    {
      name: "enso-mapbox-settings",
      version: 1,
      merge: (persistedState, currentState) => {
        const parsed = MAPBOX_SETTINGS_SCHEMA.safeParse(persistedState);
        return parsed.success
          ? { ...currentState, ...parsed.data }
          : currentState;
      },
    },
  );

  /** The user's Mapbox access token, or `null`. Reactive. */
  export function useMapboxToken() {
    return computed(() => mapboxSettingsStore.state.value.accessToken);
  }

  /** Save the token; a blank one clears it. */
  export function setMapboxToken(token: string) {
    const trimmed = token.trim();
    mapboxSettingsStore.setState({
      accessToken: trimmed === "" ? null : trimmed,
    });
  }
  ```

  `tabs.ts`, a third section of `LOCAL_TAB`:

  ```ts
  {
    nameId: 'mapsSettingsSection',
    entries: [
      settingsFormEntryData({
        type: 'form',
        schema: z.object({ mapboxToken: z.string() }),
        getValue: () => ({ mapboxToken: mapboxSettingsStore.state.value.accessToken ?? '' }),
        onSubmit: (_, { mapboxToken }) => {
          setMapboxToken(mapboxToken)
        },
        inputs: [
          {
            nameId: 'mapboxTokenSettingsInput',
            name: 'mapboxToken',
            autoComplete: 'off',
            descriptionId: 'mapboxTokenSettingsInputDescription',
          },
        ],
      }),
    ],
  },
  ```

  with
  `import { mapboxSettingsStore, setMapboxToken } from '$/providers/mapboxToken'`.
  Add the six text keys to `english.json`. `GeoMapVisualization.vue` is fixed in
  Task 7; until then typecheck fails there, so commit Tasks 6 and 7 together
  (Task 7 Step 5).

- [ ] **Step 4: Run tests.** `corepack pnpm --filter enso-common run compile`,
      then the Step 2 command — PASS.

- [ ] **Step 5: Commit** with Task 7.

### Task 7: The map visualisation's empty state

**Files**

- Create:
  `app/gui/src/project-view/components/visualizations/GeoMapVisualization/MapboxTokenMissing.vue`
- Modify:
  `app/gui/src/project-view/components/visualizations/GeoMapVisualization.vue`
  (`<script setup>` ~l.61–86, the class constructor ~l.172–203, `onMounted`
  ~l.340–352, template)
- Create:
  `app/gui/src/project-view/components/visualizations/__tests__/GeoMapVisualization.test.ts`

**Interfaces**

- Consumes: Task 6's `useMapboxToken()`; `SEARCH_PARAMS_PREFIX` (`$/appUtils`),
  `SettingsTabType` (`$/configurations/settingsTabs`); the `settings` route name
  (`router/router.ts`), whose `openTab` guard (`router/dashboardGuards.ts`)
  opens the Settings tab.
- Produces: `MapboxTokenMissing.vue` (no props): a `Result` (`status="info"`)
  titled `mapboxTokenMissing` with `mapboxTokenMissingDescription`, and a button
  `openMapboxTokenSetting` that pushes
  `{ name: 'settings', query: { ...route.query, 'cloud-ide_SettingsTab': '"local"' } }`.
  `GeoMapVisualization.vue` no longer has a top-level `await`; it builds the map
  only while a token is set, and rebuilds it when the token changes.

- [ ] **Step 1: Write the failing test**
      `…/visualizations/__tests__/GeoMapVisualization.test.ts`:

  ```ts
  /** @file The map visualization needs the user's Mapbox token, and says where to set it. */
  import { mapboxSettingsStore } from "$/providers/mapboxToken";
  import { useText } from "$/providers/text";
  import { mountWithProviders } from "$/utils/testing/mountWithProviders";
  import { flushPromises } from "@vue/test-utils";
  import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
  import GeoMapVisualization from "../GeoMapVisualization.vue";

  vi.mock("@/util/visualizationBuiltins", () => ({
    useVisualizationConfig: () => ({
      size: { x: 200, y: 200 },
      setToolbarOverlay: vi.fn(),
    }),
  }));

  const { getText } = useText();
  const MapMock = vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, {
      on: vi.fn(),
      remove: vi.fn(),
      resize: vi.fn(),
      setTerrain: vi.fn(),
    });
  });
  const mapboxgl = { Map: MapMock, Popup: vi.fn(() => ({})), accessToken: "" };
  const DATA = { df_latitude: [1], df_longitude: [2] };

  beforeEach(() => {
    vi.stubGlobal("mapboxgl", mapboxgl);
    mapboxSettingsStore.setState({ accessToken: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    MapMock.mockClear();
  });

  describe("the map visualization", () => {
    test("without a token, says maps need one and builds no map", async () => {
      const { wrapper } = await mountWithProviders(GeoMapVisualization, {
        props: { data: DATA },
      });
      expect(wrapper.text()).toContain(getText("mapboxTokenMissing"));
      expect(MapMock).not.toHaveBeenCalled();
    });

    test("the empty state opens Settings on the Local tab", async () => {
      const { wrapper, router } = await mountWithProviders(
        GeoMapVisualization,
        {
          props: { data: DATA },
          routes: [
            {
              name: "settings",
              path: "/settings",
              component: { render: () => null },
            },
          ],
        },
      );
      await wrapper.get("button").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("settings");
      expect(router.currentRoute.value.query["cloud-ide_SettingsTab"]).toBe(
        '"local"',
      );
    });

    test("with a token, builds the map with it, and rebuilds it when the token changes", async () => {
      mapboxSettingsStore.setState({ accessToken: "pk.one" });
      await mountWithProviders(GeoMapVisualization, { props: { data: DATA } });
      expect(MapMock).toHaveBeenCalledTimes(1);
      expect(mapboxgl.accessToken).toBe("pk.one");
      mapboxSettingsStore.setState({ accessToken: "pk.two" });
      await flushPromises();
      expect(MapMock).toHaveBeenCalledTimes(2);
      expect(mapboxgl.accessToken).toBe("pk.two");
    });
  });
  ```

  (If `Button`'s `@press` does not fire on a synthetic `click` in jsdom, use
  `userEvent.setup().click(wrapper.get('button').element)` as `localTab.test.ts`
  does.)

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/project-view/components/visualizations/__tests__/GeoMapVisualization.test.ts`
      — expected FAIL: `mapboxTokenStore.acquire is not a function` (Task 6
      removed it).

- [ ] **Step 3: Implement.** `MapboxTokenMissing.vue`:

  ```vue
  <script setup lang="ts">
  /**
   * @file The map visualization's empty state: maps need the user's own Mapbox access token, set in
   * Settings → Local → Maps (`$/providers/mapboxToken`).
   */
  import { SEARCH_PARAMS_PREFIX } from "$/appUtils";
  import Button from "$/components/Button/Button.vue";
  import Result from "$/components/Result/Result.vue";
  import SettingsTabType from "$/configurations/settingsTabs";
  import { useText } from "$/providers/text";
  import { useRoute, useRouter } from "vue-router";

  const { getText } = useText();
  const router = useRouter();
  const route = useRoute();

  function openSetting() {
    void router.push({
      name: "settings",
      query: {
        ...route.query,
        [`${SEARCH_PARAMS_PREFIX}SettingsTab`]: JSON.stringify(
          SettingsTabType.local,
        ),
      },
    });
  }
  </script>

  <template>
    <Result
      class="MapboxTokenMissing"
      status="info"
      centered
      :title="getText('mapboxTokenMissing')"
      :subtitle="getText('mapboxTokenMissingDescription')"
    >
      <Button variant="outline" @press="openSetting">{{
        getText("openMapboxTokenSetting")
      }}</Button>
    </Result>
  </template>
  ```

  `GeoMapVisualization.vue` `<script setup>`: replace the
  `mapboxTokenStore`/`await acquire()`/ `watchEffect` block, the module-level
  `const scope = effectScope()` and the `onMounted` block with:

  ```ts
  /**
   * The user's Mapbox access token (Settings → Local → Maps), or `null`. API limits:
   * https://docs.mapbox.com/api/#rate-limits
   */
  const mapboxToken = useMapboxToken();
  const mapNode = useTemplateRef("mapNode");

  // One map per token: the map node is keyed on it, so a new token replaces the node and the map.
  let mapScope: EffectScope | undefined;
  watch(
    mapNode,
    (node) => {
      mapScope?.stop();
      mapScope = undefined;
      const token = mapboxToken.value;
      if (node == null || token == null) return;
      (mapboxgl as any).accessToken = token;
      const scope = effectScope();
      mapScope = scope;
      const map = new GeoMapVisualizationMap(node, scope);
      scope.run(() =>
        watch(
          () => config.size,
          () => map.map.resize(),
        ),
      );
    },
    { flush: "post", immediate: true },
  );
  onScopeDispose(() => mapScope?.stop());
  ```

  The class takes the scope:
  `constructor(container: HTMLElement, private readonly scope: EffectScope)`,
  with its two `scope.run(...)` calls becoming `this.scope.run(...)`. Imports:
  drop `onMounted`, `watchEffect`; add `type EffectScope`; add
  `MapboxTokenMissing from './GeoMapVisualization/MapboxTokenMissing.vue'`.
  Template: `<MapboxTokenMissing v-if="mapboxToken == null" />` before the map
  `div`, which gets `v-else :key="mapboxToken"`.
  `config.setToolbarOverlay(true)` stays.

- [ ] **Step 4: Run tests.**
      `corepack pnpm --dir app/gui exec vitest run src/project-view/components/visualizations src/providers/__tests__/mapboxToken.test.ts src/dashboard/layouts/Settings`
      — PASS. `corepack pnpm --dir app/gui run typecheck` — PASS.
      `grep -rn "getMapboxToken\|acquire()" app/gui/src --include=*.vue --include=*.ts | grep -v "__tests__"`
      — no hit in `app/gui/src` (only `app/common`'s `RemoteBackend`, deleted in
      PR 3).

- [ ] **Step 5: Commit.**
      `git add app/gui/src/providers/mapboxToken.ts app/gui/src/providers/__tests__/mapboxToken.test.ts app/gui/src/dashboard/layouts/Settings/tabs.ts app/gui/src/dashboard/layouts/Settings/__tests__/localTab.test.ts app/gui/src/dashboard/layouts/Settings/CLAUDE.md app/common/src/text/english.json app/gui/src/project-view/components/visualizations/GeoMapVisualization.vue app/gui/src/project-view/components/visualizations/GeoMapVisualization/MapboxTokenMissing.vue app/gui/src/project-view/components/visualizations/__tests__/GeoMapVisualization.test.ts`
      —
      `git commit -m "Take the Mapbox token from Settings, with an empty state on the map"`

### Task 8: Playwright: local-only startup, cloud-only specs skipped

**Files**

- Create: `app/gui/integration-test/dashboard/localOnly.spec.ts`
- Modify: `app/gui/integration-test/setup.ts`
- Modify: `app/gui/integration-test/base.ts` (export `CLOUD_ONLY`)
- Modify: `app/gui/integration-test/actions/DrivePageActions.ts`
  (`locateCategoryButton` ~l.81–86)
- Modify: `app/gui/integration-test/dashboard/localModeSettings.spec.ts`
  (`openLocalOnly` ~l.22–41)
- Modify: the specs listed in Step 3

**Interfaces**

- Consumes: Tasks 1–7 (no config fetch, offline session, local categories, no
  cloud entries).
- Produces: `CLOUD_ONLY: string` in `integration-test/base.ts`, the reason every
  skipped cloud test carries, which PR 4 greps for
  (`git grep -n CLOUD_ONLY app/gui/integration-test`).

- [ ] **Step 1: Write the failing spec**
      `integration-test/dashboard/localOnly.spec.ts`:

  ```ts
  /**
   * @file The IDE is local-only (PR 1 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`):
   * it starts on the local drive, with no login, offers no cloud entry points, and asks Enso Cloud
   * for nothing. Every request to the cloud fails here, so one that is made also breaks the app.
   */
  import { expect, test, type Page } from "integration-test/base";
  import { registerMocks } from "integration-test/mock/registerMocks";
  import { TEXT } from "../actions";
  import BaseActions from "../actions/BaseActions";

  /** The mocked Enso Cloud (`mock/cloudApi.ts`), the real one, and Cognito/Stripe. */
  const CLOUD_URL =
    /^https:\/\/(mock\/|api\.cloud\.enso\.org\/|[^/]*(cognito|amazonaws|stripe)[^/]*\/)/;

  // A fresh install: no saved state.
  test.use({ storageState: { cookies: [], origins: [] } });

  /** Fail every Enso Cloud request, and record it. */
  async function failCloudRequests(page: Page) {
    const requests: string[] = [];
    await page.route(CLOUD_URL, async (route) => {
      requests.push(`${route.request().method()} ${route.request().url()}`);
      await route.abort("failed");
    });
    return requests;
  }

  test("starts on the local drive with no login, and asks Enso Cloud for nothing", async ({
    page,
    localApi,
    appConfig,
  }) => {
    // Only the local mock: the cloud mock is not registered, so nothing answers a cloud request.
    const _ = { localApi };
    await registerMocks(page, {}, { appConfig });
    const cloudRequests = await failCloudRequests(page);
    await page.goto("/");

    const drive = page.getByTestId("drive-view");
    await expect(drive).toBeVisible();
    await expect(drive).toHaveAttribute("data-category", "local");
    await expect(page.getByPlaceholder(TEXT.emailPlaceholder)).toHaveCount(0);
    await expect(page.getByTestId("agreements-modal")).toHaveCount(0);

    const categories = page.locator(".LeftPanel .leftBar .categories");
    for (const name of ["Cloud", "Trash"]) {
      await expect(
        categories.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      categories.getByRole("button", { name: "Local", exact: true }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: TEXT.newSecret }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: TEXT.newCredential }),
    ).toHaveCount(0);

    await expect(page.getByRole("tab", { name: TEXT.versions })).toBeVisible();
    for (const name of [
      TEXT.properties,
      TEXT.executionsCalendar,
      "Description",
    ]) {
      await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
    }

    await page
      .getByTestId("asset-row-name")
      .filter({ hasText: "Mock Project" })
      .click({ button: "right" });
    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    await expect(menu).not.toContainText(TEXT.uploadToCloudShortcut);
    await page.keyboard.press("Escape");

    await BaseActions.press(page, "Mod+,");
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await page
      .getByTestId("settings-panel")
      .locator("aside")
      .getByRole("button", { name: TEXT.localSettingsTab, exact: true })
      .click();
    await expect(page.getByTestId("settings-panel")).toContainText(
      TEXT.mapsSettingsSection,
    );

    expect(cloudRequests).toEqual([]);
  });
  ```

- [ ] **Step 2: Run it** on Linux (WSL) against the branch _before_ Tasks 1–7 to
      see it fail, then after:
      `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-cld && corepack pnpm -r --if-present run compile && corepack pnpm --dir app/gui exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/dashboard/localOnly.spec.ts'`
      — before: FAIL (`GET https://mock/utils/config` recorded, and a Cloud
      button). After Tasks 1–7 it still fails until Step 3's `setup.ts` change,
      because the `Setup` project's `loginPage.login()` finds no login form.

- [ ] **Step 3: Implement.**
  - `base.ts`:
    `export const CLOUD_ONLY = 'Cloud-only: the IDE is local-only since PR 1 of docs/superpowers/specs/2026-10-17-local-only-ide-design.md; PR 4 deletes or ports this test.'`
  - `setup.ts`: replace the body with `await loginPage.loginIfNeeded()` then
    `await page.context().storageState({ path: authFilePath })` (no login form
    exists; the offline session needs none; the stored state file stays because
    both integration projects name it — PR 4 removes the `Setup` project).
  - `DrivePageActions.ts` `locateCategoryButton`: drop
    `.nth(group === 'cloud' ? 0 : 1)` — there is one `.categories` group now,
    and its "Recent" is unique. Keep `CategoryGroup` and the `group` parameters
    (PR 4 prunes them).
  - `localModeSettings.spec.ts`: delete the `page.route(CONFIGURATION_URL, …)`
    line, `CONFIGURATION_URL`, and the `&& url !== CONFIGURATION_URL` clause;
    update its file comment ("nothing asks Enso Cloud for anything, not even a
    configuration").
  - **Local parts of mixed specs keep running:** delete the `.cloud()` hop where
    it is immediately followed by `.goToCategory.local()` —
    `createAsset.spec.ts` "create folder (local)", `delete.spec.ts` "delete
    (local)" and "cannot delete opened project (local)". The hop is the only
    cloud use in those tests.
  - **Skip whole files** with a file-level `test.skip(true, CLOUD_ONLY)` after
    the imports: `activityLogSettings`, `assetSearchBar`, `assetsTableFeatures`,
    `authPreserveEmail`, `billing`, `contextMenu`, `copy`, `copyInstead`,
    `dataLinkEditor`, `degradedAuth`, `driveView`, `editAssetName`,
    `labelsPopover`, `loginLogout`, `loginScreen`, `organizationSettings`,
    `pageSwitcher`, `rightPanel`, `signUp`, `sort`, `userGroupsSettings`,
    `userSettings`, `welcomeProject` (all under `integration-test/dashboard/`).
    Each drives a cloud category, a login/sign-up form, a cloud settings tab or
    cloud-mock state in every test.
  - **Skip single tests** (first statement of the test body:
    `test.skip(true, CLOUD_ONLY)`; for a `test.describe` block put it first in
    the block): `createAsset` "create folder (remote)", "create project
    (remote)", "upload file (remote)", "create secret (remote)"; `delete` every
    "(remote)" test; `exportAsset` "export from local to remote (local+remote)"
    and "… (drag) (local+remote)" (the two `test.skip` remote→local ones stay as
    they are); `localVersions` the test at ~l.290 using `cloudApi.addDirectory`
    / `goToCategory.cloud()`; `userMenu` "signed in to the cloud: …" and the
    `download app` describe (it needs `enableLocalBackend: false`, a cloud-only
    web build); `accessibility` the `logged out` describe, "drive: …", "drive
    table: a grid …", "drive table: dragging rows …", "asset panel: …";
    `project-view/editorPanels` "Enso links" (opens a cloud project).
  - **Then classify every remaining failure** of a full Linux run (Step 4): a
    failure is skipped with `CLOUD_ONLY` only if the test uses
    `goToCategory.cloud()/recent()/trash()`, `setupApi.cloud`, `cloudApi.*`, the
    login/sign-up/forgot-password actions or a cloud settings tab; any other
    failure is a regression to fix in Tasks 1–7, not to skip. List each added
    skip in the PR body.

- [ ] **Step 4: Run tests.** Linux (WSL), whole suite, then the touched specs 5×
      each:
      `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-cld && find app -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && corepack pnpm -r --if-present run compile && corepack pnpm --dir app/gui exec cross-env NODE_ENV=production playwright test --workers=2'`
      — expected: all green apart from skipped tests; `localOnly.spec.ts` passes
      with `cloudRequests` empty. Then
      `… playwright test --repeat-each=5 --workers=2 integration-test/dashboard/localOnly.spec.ts integration-test/dashboard/localModeSettings.spec.ts integration-test/dashboard/createAsset.spec.ts integration-test/dashboard/delete.spec.ts integration-test/dashboard/localRecent.spec.ts integration-test/dashboard/localVersions.spec.ts`
      and compare against `develop`'s rates for the same specs (root CLAUDE.md:
      a single run proves nothing). Also on Windows:
      `corepack pnpm --dir app/gui exec cross-env NODE_ENV=production playwright test integration-test/dashboard/localOnly.spec.ts`.
      `corepack pnpm --dir app/gui run typecheck` (covers `tsconfig.node.json`,
      i.e. the specs) — PASS.

- [ ] **Step 5: Commit.** `git add app/gui/integration-test` —
      `git commit -m "Integration tests: local-only startup with no cloud request; skip the cloud-only specs"`

### Task 9: Verify, changelog, and open the PR

**Files**

- Modify: `CHANGELOG.md` (`# Next Release` → `#### Enso IDE`, plus a link
  definition)

**Interfaces**

- Consumes: Tasks 1–8.
- Produces: the PR. PR 2 consumes: `registerCore()` in `src/registerCore.ts` (it
  rewrites the `$/cloud/versions/AssetVersions.vue` import to `$/versions/…`),
  the uncalled `registerCloud`, the always-true `authDisabled`, and `CLOUD_ONLY`
  skips (for PR 4).

- [ ] **Step 1: Changelog.** Add at the end of `#### Enso IDE`:
      `- [The IDE is local-only: no Enso Cloud login or cloud drive][NNN]. It starts straight into the local drive, and map visualizations use your own Mapbox access token, set in Settings → Local → Maps.`
      and `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` with the other
      link definitions (fill `NNN` after `gh pr create`, then amend in a
      follow-up commit).

- [ ] **Step 2: Full verification** (spec "Verification (each PR)"; caches
      cleared first, root CLAUDE.md):
  - `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete; find . -name '.eslintcache' -not -path '*/node_modules/*' -delete`
  - `corepack pnpm -r --if-present run compile`
  - `corepack pnpm --dir app/gui run typecheck`
  - `corepack pnpm --dir app/gui run lint`;
    `corepack pnpm --dir app/common run lint`
  - `corepack pnpm exec prettier --check` on every touched file
    (`git diff --name-only develop`)
  - `corepack pnpm --dir app/gui run test:unit`;
    `corepack pnpm --dir app/common run test:unit`;
    `corepack pnpm --dir app/project-manager-shim run test:unit` (unchanged,
    still run)
  - Playwright on Linux (WSL) per Task 8 Step 4, and the touched specs on
    Windows.
  - `git grep -n "waitForRemoteConfig().catch\|registerCloud(router)\|cloudCategoriesList" -- app/gui/src`
    — empty.
  - CI: `Package New IDE` on Linux and Windows (the Electron e2e
    `localWorkflow.spec.ts` already handles a login-less start via
    `loginAsTestUser`; `cloudWorkflow.spec.ts` stays skipped without
    `ENSO_TEST_CLOUD=1`).

- [ ] **Step 3: Screenshots.** Before (develop) and after, pushed to the orphan
      `pr-screenshots` branch and linked in the body: startup drive with the
      left bar, the local project's context menu, the drive toolbar, Settings →
      Local (Maps section), a Geo Map visualization with no token (empty state)
      and with one.

- [ ] **Step 4: Open the PR.**
      `git push -u origin feature/local-only-always-local`;
      `gh pr create --base develop --title "Always local-only: no Enso Cloud login or cloud drive (PR 1 of the local-only IDE)"`.
      Body outline: Summary (what the user sees: no login, starts on Local, no
      cloud categories or entries, Maps setting); How (no config fetch,
      `authDisabled` always true, `registerCore` instead of `registerCloud`,
      local categories, removed entries, Mapbox store); Rulings taken (the four
      **Ruling needed** items above and the answers); Not in this PR (deletions:
      PR 2/3; test pruning and `ENSO_IDE_MAPBOX_API_TOKEN` removal: PR 4); Tests
      (new unit tests, `localOnly.spec.ts`, the list of `CLOUD_ONLY` skips by
      file and test, Linux 5× rates vs develop); Screenshots; Installer
      checklist for the user (no login screen; starts on Local; projects open,
      save and version; Settings has no cloud sections and has Maps; a map works
      with a token and shows the empty state without; with the network
      disconnected no cloud request is made and nothing errors); "Part of" the
      local-only epic. No `CI: No changelog needed` label. End with the
      attribution lines.

- [ ] **Step 5: Hold for the installer test.** Build the Windows installer
      (memory: local Windows installer build recipe), hand it to the user, merge
      only on their OK after CI is green.

## PR 2: delete the cloud UI and authentication

Goal: with PR 1 merged (the app always runs on the offline session,
`registerCloud` is no longer called, cloud categories are gone from the lists),
delete the code that can no longer run: the cloud areas under
`app/gui/src/cloud/`, `src/authentication/`, the paywall composables, the
Electron sign-in/deep-link/credentials plumbing and the graph editor's cloud
file browser. The parts that are still needed move to core: `src/versions/`,
`src/versionChecker/`, and dormant `src/secrets/` and `src/datalinks/`, which
keep compiling and keep their unit tests. `providers/auth.ts` and
`providers/session.ts` shrink to one local user and session. Branch:
`feature/local-only-delete-cloud-ui`, off `develop` once PR 1 has merged. PR
rules: before/after screenshots on the orphan `pr-screenshots` branch (the file
widget's dropdown without "Choose file in cloud…", the local drive toolbar
without the disabled New Secret / New Credential / New Datalink buttons, the
Info menu without "Logout"); a Windows installer test by the user before merge
(decision 2). **Ruling needed:** changelog. Recommended default: the
`CI: No changelog needed` label, because PR 1's entry ("The IDE is local-only:
no Enso Cloud login or cloud drive") already describes everything a user can
notice here, and a second line would only restate it.

Conventions for every task: run commands from `C:\Repos\Enso\ide` (the PR's
worktree). "Typecheck" means
`corepack pnpm -r --if-present run compile && corepack pnpm --dir app/gui run typecheck`.
Before trusting a typecheck after a move or deletion, clear the caches:
`find app -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete`. ESLint
is `corepack pnpm exec eslint --max-warnings=0 <files>` and Prettier
`corepack pnpm exec prettier --check <files>`, both from the repo root on the
task's touched files.

### Task 10: Move versions, the version checker, secrets and datalinks to core

**Files**

- Move (`git mv`): `app/gui/src/cloud/versions/` → `app/gui/src/versions/`;
  `app/gui/src/cloud/versionChecker/` → `app/gui/src/versionChecker/`;
  `app/gui/src/cloud/datalinks/` → `app/gui/src/datalinks/`; every file of
  `app/gui/src/cloud/credentials/` (including `__tests__/` and `CLAUDE.md`) →
  `app/gui/src/secrets/`; `app/gui/src/cloud/serviceCredentials/` →
  `app/gui/src/secrets/serviceCredentials/`;
  `app/gui/src/project-view/components/UpsertSecretPanel.vue` →
  `app/gui/src/secrets/UpsertSecretPanel.vue`.
- Modify: `app/gui/src/App.vue`, `app/gui/src/entrypoint.ts` (PR 1's Versions
  registration import), `app/gui/src/dashboard/layouts/AssetContextMenu.vue`,
  `app/gui/src/dashboard/layouts/Drive/driveActions.ts`,
  `app/gui/src/dashboard/layouts/Drive/globalContextMenuEntries.ts`,
  `app/gui/src/dashboard/pages/dashboard/Drive/DriveBar/DriveBarToolbar.vue`,
  `app/gui/src/project-view/components/widgets/FileBrowserWidget.vue`, every
  moved file that imports `$/cloud/serviceCredentials/…` or
  `$/cloud/versionChecker/…`, the moved `CLAUDE.md` files
  (`src/versions/CLAUDE.md`, `src/secrets/CLAUDE.md`,
  `src/datalinks/CLAUDE.md`), `eslint.config.mjs` (drop `'datalinks'` and
  `'versions'` from `CLOUD_AREAS`), `app/gui/src/cloud/CLAUDE.md` (delete the
  moved areas' bullets).

**Interfaces**

- Consumes: PR 1's core registration of the Versions tab: `entrypoint.ts` calls
  `registerVersionsTabs()` (today in `src/cloud/versions/rightPanel.ts`,
  contributing `versions` and `executionsCalendar` through
  `contributeRightPanelTab`).
- Produces: `$/versions/rightPanel` (`registerVersionsTabs`),
  `$/versions/schedule` (`usePreferredTimeZone`),
  `$/versionChecker/versionChecker` (`useVersionCheckerEnabled`,
  `isNewerRelease`, `getVersionNumber`), `$/versionChecker/VersionChecker.vue`;
  `$/secrets/UpsertSecretForm.vue`, `$/secrets/UpsertSecretModal.vue`,
  `$/secrets/CreateCredentialModal.vue`, `$/secrets/credentialInfos`,
  `$/secrets/serviceCredentials/{logic,types,google,ms365,salesforce,snowflake,strava,utilities}`,
  `$/secrets/UpsertSecretPanel.vue`; `$/datalinks/UpsertDatalinkModal.vue`,
  `$/datalinks/DatalinkFormInput.vue`, `$/datalinks/JSONSchemaInput.vue`,
  `$/datalinks/FilePathInput.vue`. Note for PR 3:
  `$/secrets/serviceCredentials/utilities.ts` imports `getOauthCallbackPath`
  from `enso-common/src/services/Backend/remoteBackendPaths`, which PR 3
  deletes; PR 3 must move that one helper next to it.

- [ ] **Step 1: Move the folders.** Behaviour does not change, so the existing
      tests are the test.
  ```bash
  cd app/gui/src
  git mv cloud/versions versions
  git mv cloud/versionChecker versionChecker
  git mv cloud/datalinks datalinks
  mkdir secrets
  git mv cloud/credentials/* secrets/        # includes __tests__/ and CLAUDE.md
  git mv cloud/serviceCredentials secrets/serviceCredentials
  git mv project-view/components/UpsertSecretPanel.vue secrets/UpsertSecretPanel.vue
  ```
- [ ] **Step 2: Rewrite the imports.**
  ```bash
  cd app/gui
  grep -rl "\$/cloud/\(versions\|versionChecker\|datalinks\|credentials\|serviceCredentials\)" src \
    | xargs sed -i \
      -e 's#\$/cloud/versions/#$/versions/#g' \
      -e 's#\$/cloud/versionChecker/#$/versionChecker/#g' \
      -e 's#\$/cloud/datalinks/#$/datalinks/#g' \
      -e 's#\$/cloud/credentials/#$/secrets/#g' \
      -e 's#\$/cloud/serviceCredentials/#$/secrets/serviceCredentials/#g'
  sed -i "s#'@/components/UpsertSecretPanel.vue'#'\$/secrets/UpsertSecretPanel.vue'#" \
    src/project-view/components/widgets/FileBrowserWidget.vue
  ```
  Then fix the prose that names the old homes: `App.vue` (the comment above
  `VersionChecker`: "core code, `$/versionChecker/`"),
  `secrets/UpsertSecretPanel.vue`'s `@file` ("The file browser's "New Secret"
  panel, over `$/secrets/UpsertSecretForm.vue`. Dormant: secrets are cloud-only
  until local secrets exist, decision 5 of
  `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`."), and the three
  moved `CLAUDE.md` files' first paragraphs (new path; `secrets/` and
  `datalinks/` say "dormant: no UI entry point opens them; their unit tests are
  the guard against rot"). The check, which must print nothing:
  ```bash
  grep -rn "cloud/\(versions\|versionChecker\|datalinks\|credentials\|serviceCredentials\)\|components/UpsertSecretPanel" app/gui/src app/gui/integration-test eslint.config.mjs
  ```
- [ ] **Step 3: ESLint list.** In `eslint.config.mjs` delete `'datalinks',` and
      `'versions',` from `CLOUD_AREAS` (about line 80; the whole rule goes in
      Task 13).
- [ ] **Step 4: Verify.** Clear `*.tsbuildinfo`, typecheck (expect 0 errors),
      then
      `corepack pnpm --dir app/gui exec vitest run src/versions src/versionChecker src/secrets src/datalinks src/project-view/components/widgets`
      (expect the same pass count as these files had under `src/cloud/` on
      `develop`: `AssetVersions`, `ProjectExecutionsCalendar`, `VersionChecker`,
      `CreateCredentialModal`, `UpsertSecretForm`, `UpsertSecretModal`,
      `DatalinkInput`, `UpsertDatalinkModal`, all green), and ESLint + Prettier
      on the touched files.
- [ ] **Step 5: Commit.**
      `git add -A app/gui/src eslint.config.mjs && git commit -m "Move versions, the version checker, secrets and datalinks out of src/cloud"`

### Task 11: The graph editor browses local files only

**Files**

- Delete:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/cloudBrowser.ts`,
  `app/gui/src/project-view/components/widgets/FileBrowserWidget.vue` and the
  whole `app/gui/src/project-view/components/widgets/FileBrowserWidget/` folder
  (the cloud browser: `ensoPath.ts` with its `enso://Users/...` paths,
  `userFiles.ts`, `pathBrowsing.ts`, `fileBrowser.ts`, …, and its `__tests__/`).
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser.vue`,
  `app/gui/src/datalinks/FilePathInput.vue`,
  `app/gui/src/datalinks/__tests__/DatalinkInput.test.ts`,
  `app/gui/src/datalinks/__tests__/UpsertDatalinkModal.test.ts`,
  `app/gui/integration-test/project-view/widgets.spec.ts`,
  `app/common/src/text/english.json`.
- Create: `app/gui/src/datalinks/__tests__/FilePathInput.test.ts`.

**Interfaces**

- Consumes:
  `window.api.fileBrowser.openFileBrowser(kind, defaultPath?, filters?)`
  (`app/gui/src/electronApi.ts`, `FileBrowserApi`), as `localBrowser.ts` uses
  it.
- Produces: `FilePathInput.vue` keeps its props (`readOnly`, `value`,
  `validationErrorClass`, `error`) and its `change: [value: string]` event; it
  gains a "Browse…" button (new text id `datalinkFilePathBrowse`: `"Browse…"` in
  `app/common/src/text/english.json`, next to `browseForNewLocalRootDirectory`)
  shown only when `window.api` exists. `browsableTypes.ts` is unchanged: its
  secret handling drives "Provide secret as text" (`useTextSecrets`), which
  needs no cloud. `UpsertSecretPanel.vue` has no importer left: dormant.

**Ruling needed:** the datalink editor's path field used the cloud browser.
Recommended default: replace it with the system file dialog now (a few lines),
so `src/datalinks/` keeps compiling without the cloud browser and PR 2b inherits
a working local picker.

- [ ] **Step 1: Failing tests.** In `widgets.spec.ts` (about line 70) change the
      options to the local ones:
  ```ts
  const CHOOSE_LOCAL_FILE = "Choose file…";
  const CHOOSE_FILE_OPTIONS = [CHOOSE_LOCAL_FILE];
  ```
  delete `CHOOSE_CLOUD_FILE`, and in "File browser widget" (about line 437)
  expect `['Choose directory…']`. Make the assertions exact: change both
  `expectVisibleWithOptions` calls in that test and in "File Browser widget"
  (about line 762) to also assert
  `await expect(pathDropdown.items.filter({ hasText: 'in cloud' })).toHaveCount(0)`.
  Create `FilePathInput.test.ts`:
  ```ts
  import FilePathInput from "$/datalinks/FilePathInput.vue";
  import { mountWithProviders } from "$/utils/testing/mountWithProviders";
  import { flushPromises } from "@vue/test-utils";
  import { afterEach, expect, test, vi } from "vitest";

  const openFileBrowser = vi.fn(async () => ["/data/input.csv"]);
  afterEach(() => {
    delete (window as { api?: unknown }).api;
    openFileBrowser.mockClear();
  });

  test("Browse… sets the path from the system file dialog", async () => {
    Object.defineProperty(window, "api", {
      value: { fileBrowser: { openFileBrowser } },
      configurable: true,
    });
    const wrapper = await mountWithProviders(FilePathInput, {
      props: { value: "/old.csv" },
    });
    await wrapper
      .get('button[data-testid="file-path-browse"]')
      .trigger("click");
    await flushPromises();
    expect(openFileBrowser).toHaveBeenCalledWith("file", "/old.csv");
    expect(wrapper.emitted("change")).toEqual([["/data/input.csv"]]);
  });

  test("without the desktop app, there is no Browse… button", async () => {
    const wrapper = await mountWithProviders(FilePathInput, {
      props: { value: "" },
    });
    expect(
      wrapper.find('button[data-testid="file-path-browse"]').exists(),
    ).toBe(false);
  });
  ```
  (If `mountWithProviders` returns the mounted wrapper under another name,
  follow its signature at `src/utils/testing/mountWithProviders.ts:107`.)
- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/gui exec vitest run src/datalinks/__tests__/FilePathInput.test.ts`
      — expect both to fail (no such button). The Playwright spec fails too, on
      the extra cloud item; run it on Linux (Step 6).
- [ ] **Step 3: Delete the cloud browser.**
  ```bash
  cd app/gui/src/project-view/components
  git rm GraphEditor/widgets/WidgetFileBrowser/cloudBrowser.ts
  git rm -r widgets/FileBrowserWidget.vue widgets/FileBrowserWidget
  ```
  In `WidgetFileBrowser.vue` delete the `useCloudBrowser` import (line 20), the
  `cloudBrowserItems` constant (line 89) and `...cloudBrowserItems.value,` from
  `items`.
- [ ] **Step 4: Local picker in `FilePathInput.vue`.** Remove the
      `FileBrowserWidget` import, the `FILE_BROWSER_STYLES`,
      `isFileBrowserOpened`, `hasPathBeenChanged`, `fileBrowserPath` and
      `onFocusOut` logic and the `<FileBrowserWidget>` element; rewrite the
      `@file` comment ("A path to a file, typed or chosen with the system file
      dialog. Dormant until local datalinks, PR 2b."). New logic:
  ```ts
  const canBrowse = window.api?.fileBrowser != null;
  async function browse() {
    const selected = await window.api?.fileBrowser.openFileBrowser(
      "file",
      value,
    );
    const path = selected?.[0];
    if (path != null) emit("change", path);
  }
  ```
  and beside the text input, keeping its classes:
  ```vue
  <Button
    v-if="canBrowse && !readOnly"
    size="small"
    variant="outline"
    data-testid="file-path-browse"
    @press="browse"
  >{{ getText('datalinkFilePathBrowse') }}</Button>
  ```
  (import `Button` from `$/components/Button/Button.vue`, as
  `JSONSchemaInput.vue` does). Delete the
  `vi.mock('@/components/widgets/FileBrowserWidget.vue', …)` blocks from
  `DatalinkInput.test.ts` (line 29) and `UpsertDatalinkModal.test.ts` (line 19),
  and any assertion on the mocked browser.
- [ ] **Step 5: Unit tests.**
      `corepack pnpm --dir app/gui exec vitest run src/datalinks src/project-view/components/GraphEditor`
      — expect all to pass. This check must print nothing:
      `grep -rn "FileBrowserWidget\|cloudBrowser\|useCloudBrowser\|in cloud…" app/gui/src`.
- [ ] **Step 6: Playwright on Linux.**
  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && corepack pnpm -r compile && corepack pnpm --dir app/gui exec playwright test integration-test/project-view/widgets.spec.ts'
  ```
  Expect it green; run it 3 times (timing-sensitive suite). Typecheck, ESLint,
  Prettier.
- [ ] **Step 7: Commit.**
      `git add -A app/gui/src/project-view app/gui/src/datalinks app/gui/integration-test/project-view/widgets.spec.ts app/common/src/text/english.json && git commit -m "Graph editor: browse local files only; datalink paths use the system dialog"`

### Task 12: Detach the core from the cloud-only areas

Every core file that still imports an area that is about to be deleted stops
doing so, while `src/cloud/` still exists, so this commit typechecks on its own.
PR 1 removed some of these entry points already; each step says what must be
gone, and the closing grep is the check.

**Files**

- Modify: `app/gui/src/dashboard/pages/dashboard/UserBar/UserBar.vue`,
  `UserMenu.vue`, `UserBar/__tests__/UserBar.test.ts`;
  `app/gui/src/dashboard/pages/dashboard/components/column/AssetColumnCell.vue`;
  `app/gui/src/dashboard/layouts/AssetContextMenu.vue`,
  `AssetsTableContextMenu.vue`, `AssetsTable.vue`, `Drive/driveActions.ts`,
  `Drive/globalContextMenuEntries.ts`;
  `app/gui/src/dashboard/pages/dashboard/Drive/DriveBar/DriveBarToolbar.vue`;
  `app/gui/src/dashboard/pages/dashboard/components/column/SecretNameColumn.vue`;
  `app/gui/src/composables/transferBetweenCategories.ts`,
  `app/gui/src/utils/transferBetweenCategories.ts`;
  `app/gui/src/dashboard/layouts/Settings/tabs.ts`,
  `Settings/__tests__/SettingsPage.test.ts`; `app/gui/src/router/router.ts`,
  `app/gui/src/router/routeNames.ts`.
- Delete: `app/gui/src/dashboard/layouts/Settings/__tests__/accountTab.test.ts`,
  `billingTab.test.ts`, `cloudTabs.test.ts`, `organizationTabs.test.ts` (they
  test the cloud's sections, deleted next).

**Interfaces**

- Consumes: PR 1's removal of "Upload to cloud", "Move to cloud" and the cloud
  categories.
- Produces: no core file imports
  `$/cloud/{auth,account,agreements,billing,organization,properties,browserDisabled,devtools}`,
  `$/cloud/uploadToCloud`, `$/cloud/validation`, `$/cloud/parseUserEmails` or
  `$/cloud/permissionsClasses`. `transferBetweenCategories` from a local
  category to a cloud one does nothing. `SETTINGS_DATA` lists Account, Local,
  Appearance and Keyboard shortcuts only. `SettingsTabType`'s cloud members and
  their `goTo…Settings` bindings stay until PR 3 trims the organization types
  (removing them here would cascade into `inputBindings.ts` and
  `DashboardPage.vue` for no visible change).

- [ ] **Step 1: Failing tests.** In `UserBar.test.ts` replace the cloud cases
      ("signed in to the cloud on the free plan…" line 201, "an organization
      admin on the free plan gets "Upgrade"" line 265) with:
  ```ts
  test('no trial, "Invite" or "Upgrade", whatever the plan', async () => {
    auth.session = {
      ...auth.session,
      user: { ...USER, plan: Plan.free, isOrganizationAdmin: true },
    };
    await mountBar();
    expect(screen.queryByText(getText("upgrade"))).toBeNull();
    expect(screen.queryByText(getText("invite"))).toBeNull();
    expect(document.querySelector(".TrialProgress")).toBeNull();
  });
  ```
  (use the file's existing `auth`, `USER`, `mountBar`/mount helper and `screen`
  names; the case sets `isAuthDisabled: false` on purpose, proving the bar no
  longer depends on it). In `SettingsPage.test.ts` replace "lists the
  organization's tabs once the cloud fills them" (line 187), "lists Billing &
  Plans only for an admin…" (line 300) and "the search finds Billing & Plans by
  its aliases" (line 377) with:
  ```ts
  test("lists only the local tabs, whatever is contributed", async () => {
    contributeSettingsSections(
      SettingsTabType.organization,
      section("organizationSettingsSection"),
    );
    await mountPage();
    const tabs = [
      ...document.querySelectorAll(
        '[data-testid="settings-sidebar"] [role="tab"]',
      ),
    ];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      getText("accountSettingsTab"),
      getText("localSettingsTab"),
      getText("appearanceSettingsTab"),
      getText("keyboardShortcutsSettingsTab"),
    ]);
  });
  ```
  (match the sidebar selector to the one "lists the visible tabs in their
  groups" at line 126 uses).
- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/gui exec vitest run src/dashboard/pages/dashboard/UserBar src/dashboard/layouts/Settings/__tests__/SettingsPage.test.ts`
      — expect the two new tests to fail (Upgrade shown; Organization tab
      listed).
- [ ] **Step 3: User bar and menu.** `UserBar.vue`: delete the `TrialProgress`,
      `UpgradeButton`, `InviteUsersButton` imports and elements,
      `useIsFeatureUnderPaywall`, `Plan`, `shouldShowInviteButton`,
      `shouldShowUpgradeButton`, and the `@file` paragraph about cloud parts.
      `UserMenu.vue`: delete the `upgradePlanEntry`, `OrganizationSwitcher`,
      `useOrganizationSwitcherEntries` imports, `organizationEntries`, the
      `<OrganizationSwitcher>` element, the `toggleEnsoDevtools` entry and
      `useDevtoolsStore` (the devtools are deleted in Task 13), and the
      `upgradePlanEntry(...)` entry.
- [ ] **Step 4: Drive.** `AssetColumnCell.vue`: delete the `PermissionDisplay`
      import, the `sharedWith` computed and the `Column.sharedWith` branch; the
      `Column.createdBy` branch becomes
      `<Text v-else-if="column === Column.createdBy" nowrap>{{ item.createdBy?.name }}</Text>`;
      drop the now-unused `getAssetPermissionId`, `getAssetPermissionName`,
      `PermissionAction` imports. `AssetContextMenu.vue`: delete the
      `isUploadableAsset` and `usePreferredTimeZone` imports, the `runAsTask`
      entry (lines ~280–300, with `createProjectExecution`, `preferredTimeZone`
      and their now-unused imports), the `uploadToCloud` and `downloadToLocal`
      entries (lines ~330–350, with `uploadFileToCloud`, `uploadFileToLocal`,
      `canUploadToCloud`); every one is cloud-gated or cloud-bound.
      `AssetsTableContextMenu.vue`: delete its `uploadToCloud` entry and
      `useUploadFileToCloud`. `driveActions.ts`: delete `useUploadFileToCloud`,
      the `$/cloud/uploadToCloud` import and its mention in the `@file`, and
      `useEditSecret` with its `UpsertSecretModal` import; delete its uses in
      `AssetsTable.vue` (line 679, `editSecret`) and `SecretNameColumn.vue`
      (line 29; the name column then only renames).
      `globalContextMenuEntries.ts`: delete the three `isCloud && …` entries
      `newSecret`, `newCredential`, `newDatalink` (lines ~76–110) and their
      imports and mutations. `DriveBarToolbar.vue`: delete the New Secret, New
      Credential and New Datalink buttons (lines ~245–272),
      `openNewSecret`/`openNewCredential`/`openNewDatalink`,
      `openedModals`/`isOpened`, `newSecret`/`newCredential`/`newDatalink` and
      the three modal imports (decision 5: no entry point opens the secrets
      screens; PR 2b adds New datalink back for the local drive).
- [ ] **Step 5: Transfers.** `utils/transferBetweenCategories.ts`: delete the
      `UploadFileToCloudOptions` import, the `uploadToCloud` member of
      `TransferBetweenCategoriesContext`, and in the
      `'local'`/`'localDirectory'` case replace the upload with
      `if (isCloudCategory(to)) return`; fix the doc comment's list ("from a
      local category to the cloud, nothing happens").
      `composables/transferBetweenCategories.ts`: delete the
      `uploadAssetsToCloud` import, the `uploadToCloud` property and the
      now-unused `httpClient`, `uploads`, `toasts`, `getMessageOrToString`. (PR
      3 deletes both files.)
- [ ] **Step 6: Settings and routes.** `Settings/tabs.ts`: delete
      `ORGANIZATION_TAB`, `BILLING_AND_PLANS_TAB`, `MEMBERS_TAB`,
      `USER_GROUPS_TAB`, `ACTIVITY_LOG_TAB`, `API_KEYS_TAB`, `USAGE_TAB`, the
      `isUserOnPlanWithMultipleSeats` import, and from `SETTINGS_DATA` the
      `accessSettingsTabSection`, `securitySettingsTabSection` and
      `usageSettingsTabSection` groups; `generalSettingsTabSection` lists
      `[ACCOUNT_TAB, LOCAL_TAB]`; rewrite the `@file` and the Account tab's
      comment (its one section is the local user). `git rm` the four cloud tab
      test files listed above; delete "hides the organization's tabs when the
      cloud does not fill them" (line 172) from `SettingsPage.test.ts`.
      `router.ts`: delete `requireCloudBrowserEnabled`, its `beforeEnter`, the
      `CLOUD_DISABLED_ROUTE` and `flagsStore` imports, and the comment block
      above `routes`; `routeNames.ts`: delete `CLOUD_DISABLED_ROUTE` and the
      `$/cloud/…` mentions in its comments.
- [ ] **Step 7: Verify.** This check must print only `src/entrypoint.ts` lines,
      if any:
  ```bash
  cd app/gui && grep -rn "\$/cloud" src --include=*.ts --include=*.vue | grep -v "^src/cloud/"
  ```
  `corepack pnpm --dir app/gui exec vitest run src/dashboard src/composables src/utils src/router`
  — all pass. Typecheck, ESLint, Prettier on the touched files.
- [ ] **Step 8: Commit.**
      `git add -A app/gui/src && git commit -m "Detach the core from the cloud-only areas"`

### Task 13: Delete src/cloud, registerCloud and the CLOUD_AREAS boundary

**Files**

- Delete: all of `app/gui/src/cloud/` (left after Task 10: `auth/`, `account/`,
  `agreements/`, `billing/`, `organization/`, `properties/`, `browserDisabled/`,
  `devtools/`, `uploadToCloud.ts`, `validation.ts`, `parseUserEmails.ts`,
  `permissionsClasses.ts`, `index.ts`, `__tests__/` (`registerCloud`,
  `validation`, `parseUserEmails` tests), `CLAUDE.md`).
- Modify: `app/gui/src/entrypoint.ts`, `eslint.config.mjs`, `app/gui/CLAUDE.md`,
  `app/gui/src/dashboard/CLAUDE.md`,
  `app/gui/src/dashboard/layouts/Settings/CLAUDE.md`,
  `app/gui/src/components/__tests__/ProtectedLayout.test.ts` (its `@file` names
  `$/cloud/agreements/`; the file is rewritten in Task 15, so only the comment
  changes here).

**Interfaces**

- Consumes: Task 12 (no core importer left).
- Produces: no `$/cloud` path anywhere; the registries stay, with no contributor
  but the Versions tab: `$/providers/rightPanelContributions` (`versions`,
  `executionsCalendar`), `$/providers/settingsContributions` and
  `$/providers/layoutContributions` (empty). Their docs move to
  `app/gui/CLAUDE.md`.

- [ ] **Step 1: Delete.** `git rm -r app/gui/src/cloud`. In `entrypoint.ts`
      delete any remaining `import { registerCloud } from '$/cloud'` (PR 1
      removed the call).
- [ ] **Step 2: ESLint.** In `eslint.config.mjs` delete the `CLOUD_AREAS`
      constant and its doc comment (lines ~76–91) and the whole "The core must
      not depend on cloud-only code" block (lines ~359–385). The "Shared code
      must not depend on the dashboard" block (line ~347) stays: it still
      applies `RESTRICTED_IMPORT_PATHS` and `DASHBOARD_IMPORT_PATTERN` to all of
      `app/gui`.
- [ ] **Step 3: Docs.** In `app/gui/CLAUDE.md` replace the `src/cloud/` bullet
      (lines ~106–122) with bullets for the new homes and a "Contribution
      registries" paragraph carried over from the deleted `src/cloud/CLAUDE.md`
      "Rules" section: what each registry does (`contributeRightPanelTab` in
      `$/providers/rightPanelContributions`, which the Versions and Schedule
      tabs use; `contributeSettingsSections` in
      `$/providers/settingsContributions`; `contributeAppContainerModals` in
      `$/providers/layoutContributions`), that a contribution is a loader so it
      stays out of the initial chunk, and that a tab or modal nothing
      contributes is hidden. New bullets:
  - `src/versions/` — the right panel's Versions tab over local git versions
    (and, until PR 3, the cloud's versions and the Schedule tab);
    `registerVersionsTabs`, called by `entrypoint.ts`.
  - `src/versionChecker/` — the "new version available" dialog (GitHub
    releases), mounted by `App.vue`.
  - `src/secrets/` — dormant: the secret and per-service credential forms and
    the project view's `UpsertSecretPanel`, kept compiling and tested for local
    secrets later (decision 5); nothing opens them.
  - `src/datalinks/` — dormant until PR 2b: the datalink editor and its dialog.
    Also fix the "Dashboard ↔ backend" paragraph's "AWS Amplify + Cognito"
    sentence to "The Dashboard talks to the local Project Manager shim; the
    remote backend that remains until PR 3 is never reached." In
    `src/dashboard/CLAUDE.md` (lines 25, 33) and `Settings/CLAUDE.md` (lines
    24–34) replace the `$/cloud/…` references with the new homes or delete them
    where the area is gone.
- [ ] **Step 4: Verify.** The check must print nothing:
      `grep -rn "\$/cloud\|src/cloud\|registerCloud\|CLOUD_AREAS" app/gui/src app/gui/CLAUDE.md eslint.config.mjs`.
      Clear `*.tsbuildinfo`; typecheck (0 errors);
      `corepack pnpm --dir app/gui exec vitest run` (all green; the count drops
      only by the deleted cloud test files);
      `corepack pnpm --dir app/gui run lint`.
- [ ] **Step 5: Commit.**
      `git add -A app/gui eslint.config.mjs && git commit -m "Delete src/cloud, registerCloud and the CLOUD_AREAS boundary"`

### Task 14: Delete the paywall

**Files**

- Delete: `app/gui/src/composables/paywall/` (`FeaturesConfiguration.ts`,
  `paywall.ts`, `index.ts`),
  `app/gui/src/dashboard/layouts/Drive/PaywallModal.vue`,
  `app/gui/src/dashboard/layouts/Drive/__tests__/PaywallModal.test.ts`.
- Modify: `app/gui/src/providers/devTools.ts`,
  `app/gui/src/providers/rightPanel.ts`,
  `app/gui/src/providers/settingsContributions.ts`,
  `app/gui/src/configurations/settings.ts`,
  `app/gui/src/dashboard/layouts/Settings/SettingsPage.vue`,
  `app/gui/src/dashboard/layouts/Settings/__tests__/SettingsPage.test.ts`,
  `app/gui/src/dashboard/components/contextMenuEntry.ts`,
  `app/gui/src/dashboard/components/ContextMenu.vue`,
  `app/gui/src/dashboard/layouts/AssetContextMenu.vue`.

**Interfaces**

- Consumes: Task 13 (the billing area, the paywall's other consumer, is gone).
- Produces: `useDevtoolsStore()` is
  `reactive({ showVersionChecker: boolean | null })` only (`VersionChecker.vue`
  and its test use it). `ContextMenuEntry` loses `isUnderPaywall` and `feature`.
  `SettingsTabData` loses `feature`; `settingsContributions.ts` loses
  `contributeSettingsPaywall`, `settingsPaywall`, `SettingsPaywallComponent`,
  `SettingsPaywallLoader`. The Schedule tab's `enabled` is `enabledInCloudOnly`
  alone (PR 3 removes the tab).

- [ ] **Step 1: Failing test.** In `src/providers/__tests__/` add
      `devTools.test.ts`:
  ```ts
  import { createDevtoolsStore } from "$/providers/devTools";
  import { expect, test } from "vitest";

  test("the devtools store only carries the version checker override", () => {
    expect(Object.keys(createDevtoolsStore())).toEqual(["showVersionChecker"]);
  });
  ```
  `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/devTools.test.ts`
  — fails (`showEnsoDevtools`, `paywallFeatures`, `setPaywallFeature` present).
- [ ] **Step 2: Implement.**
  ```ts
  /** @file A store with the developer overrides that outlived the Enso devtools panel. */
  import { createGlobalState } from "@vueuse/core";
  import { reactive } from "vue";

  /** A store keeping the developer overrides. */
  export type EnsoDevtoolsStore = ReturnType<typeof createDevtoolsStore>;

  /** Create an {@link EnsoDevtoolsStore}. */
  export function createDevtoolsStore() {
    return reactive({ showVersionChecker: false as boolean | null });
  }

  export const useDevtoolsStore = createGlobalState(createDevtoolsStore);
  ```
  Then
  `git rm -r app/gui/src/composables/paywall app/gui/src/dashboard/layouts/Drive/PaywallModal.vue app/gui/src/dashboard/layouts/Drive/__tests__/PaywallModal.test.ts`
  and fix each consumer: `rightPanel.ts` (delete `useIsFeatureUnderPaywall`,
  line 67; the `executionsCalendar` `enabled` becomes
  `computed(() => enabledInCloudOnly.value)`); `settingsContributions.ts`
  (delete the paywall loader, its exports and the `paywallLoader` branch of
  `loadSettingsContributions`, which becomes
  `Promise.all(loaders.map(...)).then((results) => { … loaded.value = byTab })`);
  `configurations/settings.ts` (delete `feature` from `SettingsTabData`, line
  ~267, and the import); `SettingsPage.vue` (delete `useIsFeatureUnderPaywall`,
  `paywallFeature`, `settingsPaywall` and the
  `<template v-if="paywallFeature != null">` branch at line ~260, rendering the
  sections unconditionally); `SettingsPage.test.ts` (delete "shows the
  contributed paywall in place of a tab the user's plan lacks", line 240, and
  the `vi.mock('$/composables/paywall', …)` at line 47); `contextMenuEntry.ts`
  (delete `isUnderPaywall`, `feature` and the import); `ContextMenu.vue` (delete
  the `PaywallModal` import, the `isUnderPaywall` branch at line ~135, and the
  lock icon / `upgradeToUseCloud` tooltip ternaries at lines ~175–176, keeping
  `entry.icon` and `entry.tooltip`); `AssetContextMenu.vue` (delete
  `isFeatureUnderPaywall`, line 79, if Task 12 left it).
- [ ] **Step 3: Verify.** Must print nothing:
      `grep -rn "composables/paywall\|PaywallModal\|isUnderPaywall\|PaywallFeatureName\|paywallFeatures\|showEnsoDevtools" app/gui/src`.
      `corepack pnpm --dir app/gui exec vitest run src/providers src/dashboard src/versionChecker`
      — all pass. Typecheck, ESLint, Prettier.
- [ ] **Step 4: Commit.**
      `git add -A app/gui/src && git commit -m "Delete the paywall"`

### Task 15: One local user and session, no authentication

**Files**

- Delete: `app/gui/src/authentication/` (`cognito.ts`, `cognito.mock.ts`,
  `listen.ts`, `listen.mock.ts`, `service.ts`, `__tests__/cognito.test.ts`,
  `__tests__/service.test.ts`); `app/gui/src/providers/session/` (`backoff.ts`,
  `constants.ts`, `unauthorizedRecoveryHandlers.ts`,
  `unauthorizedRecoveryState.ts`, `useUnauthorizedRecovery.ts`);
  `app/gui/src/components/SessionOverlays.vue`,
  `app/gui/src/components/__tests__/SessionOverlays.test.ts`;
  `app/gui/src/router/sessionResolution.ts`,
  `app/gui/src/router/__tests__/sessionResolution.test.ts`.
- Rewrite: `app/gui/src/providers/session.ts`, `app/gui/src/providers/auth.ts`,
  `app/gui/src/providers/__tests__/session.test.ts`,
  `app/gui/src/providers/__tests__/auth.test.ts`,
  `app/gui/src/components/ProtectedLayout.vue`,
  `app/gui/src/components/__tests__/ProtectedLayout.test.ts`.
- Modify: `app/gui/src/router/router.ts`,
  `app/gui/src/router/dashboardGuards.ts`,
  `app/gui/src/providers/layoutContributions.ts`, `app/gui/src/entrypoint.ts`,
  `app/gui/src/components/InfoBar/InfoMenu.vue`,
  `InfoBar/__tests__/InfoBar.test.ts`,
  `app/gui/src/dashboard/pages/dashboard/UserBar/UserMenu.vue`, `UserBar.vue`,
  `UserBar/__tests__/UserBar.test.ts`,
  `app/gui/src/components/AppContainer/AppContainer.vue`,
  `app/gui/src/dashboard/layouts/DriveView.vue`,
  `app/gui/src/configurations/settings.ts`,
  `app/gui/src/dashboard/layouts/Settings/SettingsPage.vue`,
  `Settings/__tests__/SettingsPage.test.ts`,
  `Settings/__tests__/localTab.test.ts`, `app/gui/src/appUtils.ts`,
  `app/gui/src/utils/analytics/index.ts`.

**Interfaces**

- Consumes: Task 13 (the auth pages, the only callers of sign-in/sign-up/MFA,
  are gone).
- Produces (`$/providers/session`):

  ```ts
  export interface UserSession {
    readonly email: string;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly refreshUrl: string;
    readonly expireAt: Rfc3339DateTime;
    readonly clientId: string;
  }
  export const LOCAL_SESSION_EMAIL = "local@enso.localhost";
  export function makeLocalSession(now?: number): UserSession;
  export const useSession: () => {
    readonly session: UserSession | null;
    readonly isAuthDisabled: boolean;
  };
  ```

  The token fields stay, always empty, only because
  `providers/openedProjects/projectStates.ts:205` (the hybrid open, deleted in
  PR 3) reads them; PR 3 drops them. (`$/providers/auth`):

  ```ts
  export interface UserSession extends session.UserSession {
    readonly user: backendModule.User;
    readonly isCloudDataUnavailable: boolean;
    readonly isAuthDisabled: boolean;
  }
  export function makeLocalUser(name: string): backendModule.User;
  export function makeLocalUserSession(
    session: session.UserSession,
    name: string,
  ): UserSession;
  export type AuthStore = {
    readonly session: UserSession | null;
    readonly isCloudDataUnavailable: boolean;
    readonly isAuthDisabled: boolean;
    readonly waitForSession: () => Promise<void>;
  };
  export const useAuth: () => AuthStore;
  ```

  `session` is typed nullable and the flags `boolean`, though they are constant
  (`session` set, both flags `true`): narrowing them now would make the 52
  existing `?.`/`isCloudDataUnavailable` checks fail
  `@typescript-eslint/no-unnecessary-condition`; PR 3 narrows them as it removes
  `isCloudDataUnavailable`. Gone: `useInitAuthService`, `useAuthDisabled`,
  `createUsersMeQuery`, `isUsersMeQueryKey`, `makeSyntheticUser` (renamed
  `makeLocalUser`), `makeOfflineSession` (renamed `makeLocalSession`),
  sign-in/out, MFA, password, username and user deletion/restoration,
  `refetchSession`, `setUser`, 401 recovery and backoff, Sentry `setUser`, the
  `onAuthenticated` injection,
  `SettingsContext.changePassword`/`accessToken`/`updateUser`/`updateOrganization`,
  `RouteMeta.access`, `LOGIN_PATH` and the other auth page paths, the agreements
  gate and devtools contributions in `layoutContributions.ts`.

- [ ] **Step 1: Failing tests.** Replace `providers/__tests__/session.test.ts`
      with:
  ```ts
  import { LOCAL_SESSION_EMAIL, makeLocalSession } from "$/providers/session";
  import { expect, test } from "vitest";

  test("the local session has no tokens and lasts a year", () => {
    const now = Date.UTC(2026, 9, 17);
    const session = makeLocalSession(now);
    expect(session).toMatchObject({
      email: LOCAL_SESSION_EMAIL,
      accessToken: "",
      refreshToken: "",
      refreshUrl: "",
      clientId: "local",
    });
    expect(new Date(session.expireAt).getTime()).toBe(
      now + 365 * 24 * 60 * 60 * 1000,
    );
  });
  ```
  Replace `providers/__tests__/auth.test.ts` with:
  ```ts
  import { makeLocalUser, makeLocalUserSession } from "$/providers/auth";
  import { makeLocalSession } from "$/providers/session";
  import { Plan } from "enso-common/src/services/Backend";
  import { expect, test } from "vitest";

  test("the local user is named, unlicensed and on no organization", () => {
    const user = makeLocalUser("Working locally");
    expect(user).toMatchObject({
      name: "Working locally",
      isEnabled: false,
      isOrganizationAdmin: false,
      plan: Plan.free,
      isEnsoTeamMember: false,
    });
    expect(user.userId).toBe("user-local");
  });

  test("the local user session is never cloud-backed", () => {
    const session = makeLocalUserSession(makeLocalSession(), "Working locally");
    expect(session.isAuthDisabled).toBe(true);
    expect(session.isCloudDataUnavailable).toBe(true);
    expect(session.user.name).toBe("Working locally");
  });
  ```
  Replace `components/__tests__/ProtectedLayout.test.ts` with:
  ```ts
  /** @file The protected layout: the page under it shows, with no access check or redirect. */
  import ProtectedLayout from "$/components/ProtectedLayout.vue";
  import { mountWithProviders } from "$/utils/testing/mountWithProviders";
  import { flushPromises } from "@vue/test-utils";
  import { expect, test, vi } from "vitest";
  import { h, type Component } from "vue";

  vi.mock("$/composables/appTitle", () => ({ useAppTitle: () => {} }));
  const Page: Component = { render: () => h("div", { "data-testid": "page" }) };

  test("shows the page, marked as signed in, for a route with no access level", async () => {
    await mountWithProviders(ProtectedLayout, {
      routes: [{ path: "/", component: Page }],
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="page"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="after-auth-layout"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="content-not-allowed"]'),
    ).toBeNull();
  });
  ```
  In `InfoBar.test.ts` replace "signed in: Logout signs out, then goes to the
  login page" (line 61) with "the info menu has no Logout" (open the menu as the
  first test does; assert no entry named `getText('signOutShortcut')` ("Logout")
  is present), and drop the `$/providers/session` mock. In `UserBar.test.ts`
  replace "Settings, About and Logout close the menu and act" (line 215) so it
  no longer expects Logout or `signOut`, and drop that mock.
- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/session.test.ts src/providers/__tests__/auth.test.ts src/components/__tests__/ProtectedLayout.test.ts src/components/InfoBar src/dashboard/pages/dashboard/UserBar`
      — expect failures: `makeLocalSession`/`makeLocalUser` not exported,
      ProtectedLayout logs the missing access level and loads `SessionOverlays`,
      Logout still listed.
- [ ] **Step 3: `session.ts`.**
  ```ts
  /**
   * @file The local session. There is no sign-in: the app always runs as the one local user
   * (decision 1 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`).
   */
  import { createGlobalState } from "@vueuse/core";
  import { Rfc3339DateTime } from "enso-common/src/utilities/data/dateTime";

  /** A session. Its token fields are always empty; only the hybrid open (PR 3) still reads them. */
  export interface UserSession {
    /* the six fields listed under Interfaces, with their docs */
  }

  export const LOCAL_SESSION_EMAIL = "local@enso.localhost";
  const LOCAL_SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

  /** The session of the local user. */
  export function makeLocalSession(now = Date.now()): UserSession {
    return {
      email: LOCAL_SESSION_EMAIL,
      accessToken: "",
      refreshToken: "",
      refreshUrl: "",
      expireAt: Rfc3339DateTime(
        new Date(now + LOCAL_SESSION_LIFETIME_MS).toJSON(),
      ),
      clientId: "local",
    };
  }

  /** The current session: always the local one. */
  export const useSession = createGlobalState(() => {
    const session: UserSession | null = makeLocalSession();
    return { session, isAuthDisabled: true as boolean };
  });
  ```
- [ ] **Step 4: `auth.ts`.**
  ```ts
  /** @file The signed-in user: always the local user, named "Working locally". */
  import { proxyRefs } from "$/utils/reactivity";
  import { createGlobalState } from "@vueuse/core";
  import * as backendModule from "enso-common/src/services/Backend";
  import { computed } from "vue";
  import { useSession, type UserSession as LocalSession } from "./session";
  import { useText } from "./text";

  /** The local user's session, with the user. */
  export interface UserSession extends LocalSession {
    readonly user: backendModule.User;
    /** Always `true`: there is no Enso Cloud. Removed with its uses in PR 3. */
    readonly isCloudDataUnavailable: boolean;
    /** Always `true`: there is no authentication. Removed with its uses in PR 3. */
    readonly isAuthDisabled: boolean;
  }

  /** The local user: a user without a licence or an organization. */
  export function makeLocalUser(name: string): backendModule.User {
    return {
      userId: backendModule.UserId("user-local"),
      organizationId: backendModule.OrganizationId(
        "organization-00000000000000000000000000",
      ),
      rootDirectoryId: backendModule.DirectoryId("directory-local"),
      name,
      email: backendModule.EmailAddress(LOCAL_SESSION_EMAIL),
      isEnabled: false,
      isOrganizationAdmin: false,
      userGroups: null,
      plan: backendModule.Plan.free,
      groups: [],
      isEnsoTeamMember: false,
    };
  }

  /** The local user's session. */
  export function makeLocalUserSession(
    session: LocalSession,
    name: string,
  ): UserSession {
    return {
      ...session,
      user: makeLocalUser(name),
      isCloudDataUnavailable: true,
      isAuthDisabled: true,
    };
  }

  function createAuthStore(
    { getText } = useText(),
    { session } = useSession(),
  ) {
    const userSession = computed(
      (): UserSession | null =>
        session && makeLocalUserSession(session, getText("offlineUserName")),
    );
    return proxyRefs({
      session: userSession,
      isCloudDataUnavailable: computed((): boolean => true),
      isAuthDisabled: computed((): boolean => true),
      waitForSession: () => Promise.resolve(),
    });
  }

  export type AuthStore = ReturnType<typeof createAuthStore>;
  /** A provider of the current user. */
  export const useAuth = createGlobalState(createAuthStore);
  ```
  (import `LOCAL_SESSION_EMAIL` from `./session`.) `rootDirectoryId` changes
  from `directory-cloud-unavailable` to `directory-local`: check with
  `grep -rn "cloud-unavailable" app/gui/src app/gui/integration-test` and update
  any test that matches the old ids.
- [ ] **Step 5: Delete authentication and the session machinery.**
  ```bash
  cd app/gui/src
  git rm -r authentication providers/session components/SessionOverlays.vue \
    components/__tests__/SessionOverlays.test.ts router/sessionResolution.ts \
    router/__tests__/sessionResolution.test.ts
  ```
- [ ] **Step 6: ProtectedLayout and the router.** `ProtectedLayout.vue` becomes
      one `<script setup>`: `useAuth`,
      `useAppTitle(computed(() => auth.session))`, the `debugHoverAreas` class,
      and the template's `before-auth-layout`/`after-auth-layout` markers (the
      Playwright login helpers still look for them until PR 4) followed by
      `<RouterView />`. Gone: the module script with `RouteMeta.access`,
      `routeAllowed`, `redirect` (the login redirect), `requireUserAgreements`,
      `loadUserAgreements`, `dataLoader`, the `watch` on `allowed`, the logout
      `watchPostEffect`, the agreements modal, `SessionOverlays`, devtools and
      `content-not-allowed`. `router.ts`: the protected layout route uses
      `component: () => import('$/components/ProtectedLayout.vue')`; delete
      `meta: { access: 'anyLoggedIn' }`, both `beforeEach` hooks that wait on
      the config and the session, and the `useAuth`, `useConfig`,
      `shouldWaitForResolvedSession` imports. `dashboardGuards.ts`: delete the
      two `await auth.waitForSession()` lines (47, 111) and `useAuth` if unused.
      `layoutContributions.ts`: delete `UserAgreements`, `AgreementsGate`,
      `contributeAgreementsGate`, `hasAgreementsGate`, `loadAgreementsGate`,
      `agreementsModal`, `contributeDevtools`, `devtools` and their state and
      reset lines; rewrite the `@file` (`contributeAppContainerModals` remains).
      `entrypoint.ts`: delete
      `imNotSureButPerhapsFixingRefreshingWithAuthentication`, `INITIAL_URL_KEY`
      and `app.provide('onAuthenticated', …)`.
- [ ] **Step 7: Sign-out and settings.** `InfoMenu.vue`: delete the `signOut`
      entry, `useSession`, `useRouter`, `LOGIN_PATH`, `onSignOut`.
      `UserMenu.vue`: delete `tailEntries`' `signOut` entry (and `tailEntries`
      if empty), `useSession`, `emit('signOut')` and `defineEmits`;
      `UserBar.vue` and `AppContainer.vue` (line 120) drop the `signOut` event.
      `DriveView.vue`: delete the `cloud-unavailable` status and its `<Result>`
      (lines ~140–149, the only `auth.refetchSession` caller) and
      `hasExplicitCategory`. `configurations/settings.ts`: delete `accessToken`
      from `SettingsBaseContext` and `changePassword`, `updateUser`,
      `updateOrganization` from `SettingsContext`, with their imports;
      `SettingsPage.vue` stops building them (lines ~121–135, `sessionStore`,
      the two mutations); `SettingsPage.test.ts` and `localTab.test.ts` drop
      their `$/providers/session` mocks. `appUtils.ts`: delete `LOGIN_PATH`,
      `REGISTRATION_PATH`, `PAYMENTS_SUCCESS_PATH`, `CONFIRM_REGISTRATION_PATH`,
      `RESTORE_USER_PATH`, `FORGOT_PASSWORD_PATH`, `RESET_PASSWORD_PATH`,
      `ALL_PATHS_REGEX`, `OPEN_IDE_DEEPLINK`, `getUpgradeURL`,
      `ORGANIZATION_NAME_*`, `USER_GROUP_NAME_MAX_LENGTH`, keeping only names
      something still imports (`SUBSCRIBE_PATH` stays while `DriveView.vue`'s
      not-enabled stub uses it, until PR 3). `utils/analytics/index.ts`: delete
      `createUser`, `cloudSignUp`, `cloudSignOut`, `signIn`, `AuthProvider` and
      `checkout`.
- [ ] **Step 8: Verify.** Must print nothing:
  ```bash
  cd app/gui && grep -rnE "\\\$/authentication|providers/session/|SessionOverlays|sessionResolution|useInitAuthService|useAuthDisabled|makeOfflineSession|makeSyntheticUser|LOGIN_PATH|meta\.access|onAuthenticated|signOut\(|refetchSession|aws-amplify" src --include=*.ts --include=*.vue
  ```
  (`aws-amplify` stays in `package.json` until PR 4.) Run
  `corepack pnpm --dir app/gui exec vitest run` — all pass, including
  `src/secrets`, `src/datalinks`, `src/versions` (they mock `useAuth` as
  `{ session: { user } }`, which still fits). Clear `*.tsbuildinfo`; typecheck;
  `corepack pnpm --dir app/gui run lint`; Prettier.
- [ ] **Step 9: Commit.**
      `git add -A app/gui/src && git commit -m "One local user and session: delete authentication"`

### Task 16: Electron without sign-in, deep links or credentials

**Files**

- Delete: `app/electron-client/src/authentication.ts`,
  `app/electron-client/src/urlAssociations.ts`,
  `app/electron-client/src/backend.ts`, `app/common/src/accessToken.ts`.
- Modify: `app/electron-client/src/index.ts`,
  `app/electron-client/src/preload.ts`, `app/electron-client/src/ipc.ts`,
  `app/electron-client/src/security.ts`,
  `app/electron-client/src/configParser.ts`, `app/electron-client/src/paths.ts`,
  `app/electron-client/electron-builder-config.ts`,
  `app/electron-client/CLAUDE.md`, `app/common/src/options.ts`,
  `app/common/src/constants.ts`, `app/gui/src/electronApi.ts`,
  `app/gui/integration-test/mock/registerMocks.ts`.

**Interfaces**

- Consumes: Task 15 (nothing in the GUI calls `window.api.authentication` any
  more).
- Produces: `ElectronApi` without `authentication`; `Channel` without
  `openUrlInSystemBrowser`, `openDeepLink`, `saveAccessToken`; `OptionsSchema`
  and `PASS_TO_WEB` without `authentication.*`; no
  `--authentication.enabled`/`--authentication.email` flags; no `enso://` OS
  protocol registration; `TRUSTED_HOSTS` empty. Kept: `handleProjectProtocol`
  and `electron.protocol.handle('enso', …)` in `index.ts` (the in-app
  project-asset protocol, not a deep link), the single-instance lock and file
  associations. The IDE no longer writes `~/.enso/credentials`; the standard
  library's `Enso_Cloud` simply finds no credentials.

**Ruling needed:** `backend.ts`'s `createRemoteBackend` (headless
`--startup.project enso://…`) gets its token from `getUpToDateAccessToken`,
which this task deletes. Recommended default: delete `backend.ts` and the
headless `enso:` branch of `App.run` here (PR 3's spec item), since without the
credentials file it can only fail; PR 3's Electron step then shrinks to
`assetManagement.ts` and the `server.ts` middleware, and the shim's
`runHybridProjectByUrl` export stays until PR 3. **Ruling needed:**
`TRUSTED_HOSTS` in `security.ts`. Recommended default: empty it, since every
entry (Google, GitHub, Cognito, `execute-api`, S3) exists for cloud sign-in or
the cloud API; the window then never navigates off its own origin, and external
links still open through `TRUSTED_EXTERNAL_PROTOCOLS`.

- [ ] **Step 1: Failing test.** Add
      `app/electron-client/tests/headless/configParser.test.ts`:
  ```ts
  import { parseArgs } from "@/configParser";
  import { PASS_TO_WEB } from "enso-common/src/options";
  import { expect, test } from "vitest";

  test("there are no authentication options", () => {
    expect(() => parseArgs(["--authentication.enabled"])).toThrow();
    expect(
      [...PASS_TO_WEB].filter((key) => key.startsWith("authentication.")),
    ).toEqual([]);
    expect(parseArgs([])).not.toHaveProperty("authentication");
  });
  ```
  (if `parseArgs` reports unknown flags without throwing, assert on its error
  result instead, as its implementation in `src/configParser.ts` does). Run
  `corepack pnpm --dir app/electron-client exec vitest run tests/headless/configParser.test.ts`
  — expect it to fail.
- [ ] **Step 2: Delete the modules.**
      `git rm app/electron-client/src/authentication.ts app/electron-client/src/urlAssociations.ts app/electron-client/src/backend.ts app/common/src/accessToken.ts`
- [ ] **Step 3: `index.ts`.** Delete the `createRemoteBackend`,
      `initAuthentication` and `urlAssociations.js` imports, `DEEP_LINK_SCHEME`,
      `runHybridProjectByUrl`, `EnsoPath`; `registerAssociations(...)` in
      `runElectronApp`; `urlToOpen` from `requestSingleInstanceLock`,
      `handleItemOpening`, `processArguments` (and the `ParsedArguments` type)
      and `run`; the `isWin`/`ensoLinkInArgs` block in the `second-instance`
      handler (keep the focus/restore part); `initAuthentication(...)` and its
      comment in `main`; and in `run` the
      `projectToOpen.startsWith(\`${DEEP_LINK_SCHEME}:\`)`branch, so headless opens`runLocalProjectByPath`only and the usage message reads`'Usage:
      \`--headless --startup.project <project path>\`'`.
- [ ] **Step 4: The rest.** `preload.ts`: delete the deep-link handler (lines
      ~86–96), the `authentication` object (lines ~98–141), its `accessToken`
      import and `authentication,` in `api`. `ipc.ts`: delete the three
      channels. `security.ts`: `const TRUSTED_HOSTS: string[] = []` with the
      comment "Hosts the main window may navigate to, beyond its own origin:
      none." `configParser.ts`: delete the two `authentication.*` entries.
      `common/src/options.ts`: delete `authentication` from `OptionsSchema` and
      the two `PASS_TO_WEB` keys. `paths.ts`: delete `CREDENTIALS_PATH` (and
      `homedir`/`PRODUCT_NAME` imports if unused). `electron-builder-config.ts`:
      delete the `protocols` array and its doc comment (lines ~200–218).
      `common/src/constants.ts`: delete `DEEP_LINK_SCHEME` and its comment.
      `gui/src/electronApi.ts`: delete `AuthenticationApi`, `authentication` in
      `ElectronApi` and the `accessToken` import. `registerMocks.ts`: delete the
      `authentication: {…}` stub (lines 87–91). `electron-client/CLAUDE.md`:
      delete or rewrite the paragraphs on `authentication.ts`, deep links and
      `~/.enso/credentials` (find them with
      `grep -n "authentication\|deep link\|credentials" app/electron-client/CLAUDE.md`;
      the test-user notes stay for PR 4).
- [ ] **Step 5: Verify.** Must print nothing:
  ```bash
  grep -rnE "DEEP_LINK_SCHEME|accessToken'|saveAccessToken|openDeepLink|openUrlInSystemBrowser|CREDENTIALS_PATH|urlAssociations|initAuthentication|createRemoteBackend|getUpToDateAccessToken|authentication\.(enabled|email)" app/electron-client/src app/electron-client/electron-builder-config.ts app/common/src app/gui/src app/gui/integration-test
  ```
  Then `corepack pnpm --dir app/electron-client exec vitest run tests/headless`
  (all pass, the new test included),
  `corepack pnpm --dir app/common run test:unit`,
  `corepack pnpm --dir app/electron-client run typecheck`,
  `corepack pnpm --dir app/common run typecheck`, the GUI typecheck, and
  `corepack pnpm --dir app/electron-client run lint`.
- [ ] **Step 6: Commit.**
      `git add -A app/electron-client app/common app/gui/src/electronApi.ts app/gui/integration-test/mock/registerMocks.ts && git commit -m "Electron: no sign-in, deep links or credentials file"`

### Task 17: Verify and open the PR

**Files**

- None changed, unless a check below fails (fix it in its own commit with the
  task it belongs to).

**Interfaces**

- Consumes: Tasks 10–16.
- Produces: PR "Local-only IDE, PR 2: delete the cloud UI and authentication"
  against `develop`.

- [ ] **Step 1: Clean build and static checks.**
      `rm -rf node_modules && corepack pnpm install` is not needed (no
      dependency changes); do clear caches:
      `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete; find . -name '.eslintcache' -not -path '*/node_modules/*' -delete`.
      Then `corepack pnpm -r --if-present run compile`,
      `corepack pnpm --dir app/gui run typecheck`,
      `corepack pnpm --dir app/gui run lint`,
      `corepack pnpm --dir app/electron-client run lint`,
      `corepack pnpm --dir app/common run lint`, and
      `corepack pnpm exec prettier --check app/gui/src app/electron-client/src app/common/src eslint.config.mjs`.
- [ ] **Step 2: Unit tests.** `corepack pnpm --dir app/gui run test:unit`,
      `corepack pnpm --dir app/common run test:unit`,
      `corepack pnpm --dir app/project-manager-shim run test:unit`,
      `corepack pnpm --dir app/electron-client exec vitest run tests/headless`.
      Confirm the dormant code's tests ran (not just compiled):
      `corepack pnpm --dir app/gui exec vitest run src/secrets src/datalinks src/versions src/versionChecker`
      reports the `CreateCredentialModal`, `UpsertSecretForm`,
      `UpsertSecretModal`, `DatalinkInput`, `UpsertDatalinkModal`,
      `FilePathInput`, `AssetVersions`, `ProjectExecutionsCalendar` and
      `VersionChecker` files, all green.
- [ ] **Step 3: Leftovers.** Each must print nothing:
  ```bash
  git grep -nE "\\\$/cloud|src/cloud/|registerCloud|CLOUD_AREAS|\\\$/authentication|composables/paywall" -- app eslint.config.mjs ':!docs'
  git grep -n "amazoncognito\|execute-api" -- app/electron-client/src
  ```
- [ ] **Step 4: Playwright on Linux, then Windows.** On WSL:
  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && corepack pnpm -r compile && corepack pnpm --dir app/gui exec playwright test'
  ```
  Compare the pass/skip counts with the same run on `develop` after PR 1 (the
  cloud-only specs PR 1 skipped stay skipped; no new failures). Run
  `widgets.spec.ts`, `localModeSettings.spec.ts`, `driveView.spec.ts` and PR 1's
  "starts local, no cloud request" spec 3 times each on both branches; then the
  same touched specs on Windows with
  `corepack pnpm --dir app/gui exec playwright test <spec>`.
- [ ] **Step 5: Screenshots.** Before (`develop`) and after: the `Data.read`
      path dropdown, the local drive's toolbar, the Info menu and the user menu.
      Commit them to the orphan `pr-screenshots` branch under `pr-<N>/` and
      embed them in the PR body.
- [ ] **Step 6: Open the PR.**
      `git push -u origin feature/local-only-delete-cloud-ui`, then
      `gh pr create --base develop --label "CI: No changelog needed"` (per the
      changelog ruling above) with a body outlining: Summary (what was deleted;
      what moved to `src/versions`, `src/versionChecker`, dormant `src/secrets`,
      dormant `src/datalinks`); what users see (no "Choose file in cloud…", no
      disabled secret/credential/datalink buttons, no Logout); Electron (no
      sign-in IPC, no `enso://` registration, no `~/.enso/credentials` writer,
      headless is local-only); the rulings taken (datalink path picker,
      `TRUSTED_HOSTS`, `backend.ts` pulled forward from PR 3, changelog label);
      what was not verified (`Package New IDE` runs in CI; the installer is the
      user's test); screenshots; "Part of the local-only IDE (spec
      `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`), after PR 1;
      next is PR 2b."; and the attribution lines.
- [ ] **Step 7: CI and installer.** Watch CI with a time-capped `gh pr checks`
      loop (`--jq`, exit on completion). `Package New IDE` must pass on Linux
      and Windows. Build a Windows installer and hand it to the user with the
      spec's checks: no login screen; starts on Local; projects open, save and
      version; Settings has no cloud sections (Account, Local, Appearance,
      Keyboard shortcuts only); with the network disconnected, no cloud request
      and no error; additionally, the `Data.read` path widget offers only
      "Choose file…", and opening a `.enso-project` file still works
      (single-instance lock and file association kept). Merge only on the user's
      OK.

## PR 2b: local datalinks

Goal (spec decision 6, section "PR 2b"): a local datalink is a `<name>.datalink`
file holding the same JSON `Data.read` already reads. The shim lists such files
as datalinks and reads, creates, updates and deletes them atomically;
`LocalBackend` implements the datalink methods over those routes; the drive gets
"New Datalink", opening/editing a datalink shows the editor, download and export
copy the file; secret fields take plain values only; the graph editor's file
widget offers `.datalink` files. Branch `feature/local-only-datalinks`, off
`develop` after PR 2 merged. It is a feature: one `CHANGELOG.md` entry under
`# Next Release` → `#### Enso IDE`; before/after screenshots of the drive
toolbar, the create dialog, the edit dialog and the secret note, pushed to the
orphan `pr-screenshots` branch and embedded in the PR body; a Windows installer
test by the user before merge (merge gate for features).

State consumed from PR 2: the editor lives in `app/gui/src/datalinks/`
(`JSONSchemaInput.vue`, `DatalinkInput.vue`, `DatalinkFormInput.vue`,
`UpsertDatalinkModal.vue`, `SchemaTextInput.vue`, `FilePathInput.vue`,
`focusRing.ts`, `variants.ts`, `CLAUDE.md`, `__tests__/`), imported as
`$/datalinks/…`; `src/cloud/` (with `properties/`, the Properties tab and its
`DatalinkConfiguration`) is gone; the graph editor's cloud browser
(`WidgetFileBrowser/cloudBrowser.ts`) is gone, so the file widget offers only
`useLocalBrowser`'s "Choose file…"; the drive's toolbar and global context menu
still gate "New Datalink" on `isCloud` (always false since PR 1). Where PR 2
removed a gated entry outright instead of leaving it disabled, the task below
re-adds it with the code shown.

### Task 20: Shim datalink file module

**Files**

- Create `app/project-manager-shim/src/datalinks.ts`
- Create `app/project-manager-shim/src/__tests__/datalinks.test.ts`

**Interfaces**

- Consumes: `serialised`, `writeJsonAtomic`, `errorCode`, `isRecord` from
  `app/project-manager-shim/src/localMetadata/jsonFile.ts` (the same
  temp-file-and-rename write that `packageYaml.ts`'s `writePackageLabels` and
  `updateJsonFile` use; `renameWithRetry` covers Windows locks).
- Produces: `DATALINK_EXTENSION = '.datalink'`;
  `isDatalinkPath(filePath: string): boolean`;
  `readDatalink(filePath: string): Promise<unknown>`;
  `createDatalink(filePath: string, value: unknown): Promise<void>`;
  `updateDatalink(filePath: string, value: unknown): Promise<void>`;
  `deleteDatalink(filePath: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** `src/__tests__/datalinks.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createDatalink,
  deleteDatalink,
  isDatalinkPath,
  readDatalink,
  updateDatalink,
} from "../datalinks.js";

const S3 = { type: "S3", libraryName: "Standard.AWS", uri: "s3://bucket/key" };
let root: string;
let file: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "datalinks-"));
  file = path.join(root, "Sales.datalink");
});
afterEach(async () => {
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

test.each([
  ["/a/Sales.datalink", true],
  // The standard library compares the extension case-sensitively (`data_link_extension`).
  ["/a/Sales.DATALINK", false],
  ["/a/.datalink", false],
  ["/a/Sales.datalink.bak", false],
])("isDatalinkPath(%s) is %s", (p, expected) =>
  expect(isDatalinkPath(p)).toBe(expected),
);

describe("datalink files", () => {
  test("create writes the JSON and read returns it", async () => {
    await createDatalink(file, S3);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(S3);
    expect(await readDatalink(file)).toEqual(S3);
  });

  test("create refuses an existing file and leaves it untouched", async () => {
    await fs.writeFile(file, '{"kept":true}');
    await expect(createDatalink(file, S3)).rejects.toThrow(
      "'Sales.datalink' already exists.",
    );
    expect(await fs.readFile(file, "utf8")).toBe('{"kept":true}');
  });

  test("create refuses a missing folder rather than creating it", async () => {
    const nested = path.join(root, "missing", "Sales.datalink");
    await expect(createDatalink(nested, S3)).rejects.toThrow(
      /folder .* does not exist/,
    );
    expect(await fs.readdir(root)).toEqual([]);
  });

  test("update replaces the content and leaves no temporary file", async () => {
    await createDatalink(file, S3);
    await updateDatalink(file, { ...S3, uri: "s3://bucket/other" });
    expect(await readDatalink(file)).toMatchObject({
      uri: "s3://bucket/other",
    });
    expect(await fs.readdir(root)).toEqual(["Sales.datalink"]);
  });

  test("concurrent updates are serialised: the last one wins", async () => {
    await createDatalink(file, S3);
    await Promise.all(
      ["a", "b", "c"].map((k) =>
        updateDatalink(file, { ...S3, uri: `s3://${k}` }),
      ),
    );
    expect(await readDatalink(file)).toMatchObject({ uri: "s3://c" });
  });

  test("update refuses a missing file; a non-object value is refused", async () => {
    await expect(updateDatalink(file, S3)).rejects.toThrow(
      "'Sales.datalink' does not exist.",
    );
    await expect(createDatalink(file, "text")).rejects.toThrow(
      "A datalink must be a JSON object.",
    );
    await expect(createDatalink(file, [S3])).rejects.toThrow(
      "A datalink must be a JSON object.",
    );
  });

  test("invalid JSON is reported with the file name, and the file is kept", async () => {
    await fs.writeFile(file, "{ not json");
    await expect(readDatalink(file)).rejects.toThrow(
      /^'Sales\.datalink' is not valid JSON: /,
    );
    expect(await fs.readFile(file, "utf8")).toBe("{ not json");
  });

  test("delete removes the file, and refuses a folder named like a datalink", async () => {
    await createDatalink(file, S3);
    await deleteDatalink(file);
    expect(await fs.readdir(root)).toEqual([]);
    await fs.mkdir(file);
    await expect(deleteDatalink(file)).rejects.toThrow(
      "'Sales.datalink' is not a file.",
    );
  });

  test("every operation refuses a path that is not an absolute .datalink path", async () => {
    for (const bad of [path.join(root, "x.json"), "Sales.datalink"]) {
      await expect(readDatalink(bad)).rejects.toThrow(
        /is not an absolute path to a '\.datalink'/,
      );
      await expect(createDatalink(bad, S3)).rejects.toThrow(/'\.datalink'/);
      await expect(deleteDatalink(bad)).rejects.toThrow(/'\.datalink'/);
    }
  });
});
```

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/project-manager-shim exec vitest run src/__tests__/datalinks.test.ts`
      — fails: `Failed to resolve import "../datalinks.js"`.
- [ ] **Step 3: Implement** `src/datalinks.ts`:

```ts
/**
 * @file Local datalinks: `<name>.datalink` files holding a datalink's JSON, the format the standard
 * library reads with `Data.read`. Writes go through a temporary file renamed into place
 * (`writeJsonAtomic`), serialised per path, as `package.yaml` and `project.json` writes are.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  errorCode,
  isRecord,
  serialised,
  writeJsonAtomic,
} from "./localMetadata/jsonFile.js";

/** The extension of a datalink file. The standard library compares it case-sensitively. */
export const DATALINK_EXTENSION = ".datalink";

/** Whether `filePath` names a datalink file: a non-empty name ending in exactly `.datalink`. */
export function isDatalinkPath(filePath: string): boolean {
  const name = path.basename(filePath);
  return (
    name.length > DATALINK_EXTENSION.length && name.endsWith(DATALINK_EXTENSION)
  );
}

function requireDatalinkPath(filePath: string): void {
  if (!path.isAbsolute(filePath) || !isDatalinkPath(filePath)) {
    throw new Error(
      `'${filePath}' is not an absolute path to a '${DATALINK_EXTENSION}' file.`,
    );
  }
}

function requireObject(value: unknown): void {
  if (!isRecord(value)) throw new Error("A datalink must be a JSON object.");
}

async function statOrNull(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * The parsed JSON of the datalink file. It is not checked against the datalink schema: the GUI's
 * editor validates what it shows.
 * @throws {Error} when the file is missing, or is not valid JSON (the file is left as it is).
 */
export async function readDatalink(filePath: string): Promise<unknown> {
  requireDatalinkPath(filePath);
  const text = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `'${path.basename(filePath)}' is not valid JSON: ${reason}`,
      { cause: error },
    );
  }
}

/**
 * Create a datalink file in an existing folder.
 * @throws {Error} when the file already exists, or its folder does not.
 */
export function createDatalink(
  filePath: string,
  value: unknown,
): Promise<void> {
  requireDatalinkPath(filePath);
  requireObject(value);
  return serialised(filePath, async () => {
    const folder = path.dirname(filePath);
    if (!(await statOrNull(folder))?.isDirectory()) {
      throw new Error(`The folder '${folder}' does not exist.`);
    }
    if ((await statOrNull(filePath)) != null) {
      throw new Error(`'${path.basename(filePath)}' already exists.`);
    }
    await writeJsonAtomic(filePath, value);
  });
}

/**
 * Replace the content of an existing datalink file.
 * @throws {Error} when the file does not exist.
 */
export function updateDatalink(
  filePath: string,
  value: unknown,
): Promise<void> {
  requireDatalinkPath(filePath);
  requireObject(value);
  return serialised(filePath, async () => {
    if (!(await statOrNull(filePath))?.isFile()) {
      throw new Error(`'${path.basename(filePath)}' does not exist.`);
    }
    await writeJsonAtomic(filePath, value);
  });
}

/**
 * Delete a datalink file.
 * @throws {Error} when the path is not a file.
 */
export function deleteDatalink(filePath: string): Promise<void> {
  requireDatalinkPath(filePath);
  return serialised(filePath, async () => {
    if (!(await statOrNull(filePath))?.isFile()) {
      throw new Error(`'${path.basename(filePath)}' is not a file.`);
    }
    await fs.rm(filePath);
  });
}
```

`writeJsonAtomic` creates the folder with `mkdir -p`; `createDatalink` checks
the folder first so a create into a deleted folder fails instead of re-creating
it.

- [ ] **Step 4: Run tests.** Same command — 13 passed. Then
      `corepack pnpm --dir app/project-manager-shim run compile` and
      `corepack pnpm --dir app/project-manager-shim run lint` — clean.
- [ ] **Step 5: Commit.**
      `git add app/project-manager-shim/src/datalinks.ts app/project-manager-shim/src/__tests__/datalinks.test.ts`;
      `git commit -m "Shim: read and write local datalink files atomically"`.

### Task 21: Shim listing reports datalinks; datalink routes

**Files**

- Modify `app/project-manager-shim/src/handler/filesystem.ts` (`FileSystemEntry`
  ~l.72, `FileSystemEntryType` ~l.75, entry interfaces ~l.81–103,
  `readFileSystemEntry` ~l.458)
- Modify `app/project-manager-shim/src/handler/projectService.ts` (route tables
  ~l.19–115, `handleProjectServiceRequest` ~l.177)
- Modify `app/project-manager-shim/src/handler/__tests__/filesystem.test.ts`
- Modify `app/project-manager-shim/src/handler/__tests__/projectService.test.ts`
- Modify `app/project-manager-shim/CLAUDE.md` (new section "Local datalinks",
  and the `handler/projectService.ts` endpoint list)

**Interfaces**

- Consumes: Task 20's `isDatalinkPath`, `readDatalink`, `createDatalink`,
  `updateDatalink`, `deleteDatalink`.
- Produces: `FileSystemEntryType.DatalinkEntry = 'DatalinkEntry'`;
  `interface DatalinkEntry { type: FileSystemEntryType.DatalinkEntry; path: string; attributes: Attributes }`;
  routes `POST /api/project-service/datalink/read` `{ path }` → the JSON;
  `datalink/create` `{ path, value }` → `null`; `datalink/update`
  `{ path, value }` → `null`; `datalink/delete` `{ path }` → `null`; failures
  are JSON-RPC errors `datalink/<op> failed: <message>`. No host change:
  Electron (`server.ts`) and the Vite middleware already pass every
  `/api/project-service/` POST to `handleProjectServiceRequest`.

- [ ] **Step 1: Write the failing tests.** Append to `filesystem.test.ts`:

```ts
describe("datalink entries", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "filesystem-datalink-"),
    );
  });
  afterEach(async () => {
    await fsPromises.rm(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 1000,
    });
  });

  test("a .datalink file lists as a DatalinkEntry, other files as FileEntry", async () => {
    await fsPromises.writeFile(
      path.join(tmpDir, "Sales.datalink"),
      '{"type":"S3"}',
    );
    await fsPromises.writeFile(path.join(tmpDir, "notes.txt"), "x");
    const entries = (await listEntries(tmpDir)) as {
      type: string;
      path: string;
    }[];
    expect(
      entries.map(({ type, path: p }) => [type, path.basename(p)]).sort(),
    ).toEqual([
      ["DatalinkEntry", "Sales.datalink"],
      ["FileEntry", "notes.txt"],
    ]);
  });

  test("a datalink with invalid JSON is still listed, not dropped", async () => {
    await fsPromises.writeFile(
      path.join(tmpDir, "Broken.datalink"),
      "{ not json",
    );
    expect(await listEntries(tmpDir)).toEqual([
      expect.objectContaining({
        type: "DatalinkEntry",
        path: path.join(tmpDir, "Broken.datalink"),
      }),
    ]);
  });
});
```

Append to `projectService.test.ts`:

```ts
describe("datalink routes", () => {
  const VALUE = {
    type: "HTTP",
    libraryName: "Standard.Base",
    uri: "https://x",
    method: "GET",
  };

  test("create, read, update and delete", async () => {
    const file = path.join(root, "Web.datalink");
    expect(
      (await call("datalink/create", { path: file, value: VALUE })).result,
    ).toBeNull();
    expect((await call("datalink/read", { path: file })).result).toEqual(VALUE);
    const changed = { ...VALUE, uri: "https://y" };
    expect(
      (await call("datalink/update", { path: file, value: changed })).result,
    ).toBeNull();
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(changed);
    expect((await call("datalink/delete", { path: file })).result).toBeNull();
    await expect(fs.stat(file)).rejects.toThrow();
  });

  test("invalid JSON is reported as an error naming the file", async () => {
    const file = path.join(root, "Broken.datalink");
    await fs.writeFile(file, "{ not json");
    const read = await call("datalink/read", { path: file });
    expect(read).not.toHaveProperty("result");
    expect(read.error).toMatchObject({
      message: expect.stringMatching(
        /^datalink\/read failed: 'Broken\.datalink' is not valid JSON/,
      ),
    });
  });

  test("a malformed body or an existing file is an error", async () => {
    const file = path.join(root, "Web.datalink");
    expect((await call("datalink/create", { path: file })).error).toBeDefined();
    expect((await call("datalink/read", { path: 3 })).error).toBeDefined();
    await call("datalink/create", { path: file, value: VALUE });
    const again = await call("datalink/create", { path: file, value: VALUE });
    expect(again.error).toMatchObject({
      message: expect.stringContaining("already exists"),
    });
  });
});
```

- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/project-manager-shim exec vitest run src/handler/__tests__/filesystem.test.ts src/handler/__tests__/projectService.test.ts`
      — the new tests fail: entries are `FileEntry`; the routes answer
      `Unknown project service request /api/project-service/datalink/create`.
- [ ] **Step 3: Implement.** In `filesystem.ts`:

```ts
import { isDatalinkPath } from "../datalinks.js";
// …
/** Metadata for an arbitrary file system entry. */
export type FileSystemEntry =
  DatalinkEntry | DirectoryEntry | FileEntry | ProjectEntry;

export enum FileSystemEntryType {
  DirectoryEntry = "DirectoryEntry",
  ProjectEntry = "ProjectEntry",
  FileEntry = "FileEntry",
  DatalinkEntry = "DatalinkEntry",
}

/**
 * Metadata for a datalink: a `<name>.datalink` file. Its content is not read while listing, so a
 * datalink that is not valid JSON is still listed; reading it reports the problem.
 */
export interface DatalinkEntry {
  readonly type: FileSystemEntryType.DatalinkEntry;
  readonly path: string;
  readonly attributes: Attributes;
}
```

and in `readFileSystemEntry`'s `stat.isFile()` branch:
`type: isDatalinkPath(entryPath) ? FileSystemEntryType.DatalinkEntry : FileSystemEntryType.FileEntry`
(the object literal keeps `path` and `attributes`; annotate it
`entry: FileEntry | DatalinkEntry`). In `projectService.ts`:

```ts
import * as datalinkFiles from "../datalinks.js";
// …
/** The `datalink/` routes. Their "store" is the module itself, which needs no host state. */
const DATALINK_ROUTES: Readonly<
  Record<string, RouteHandler<typeof datalinkFiles>>
> = {
  "datalink/read": (files, body) =>
    files.readDatalink(requireString(body, "path")),
  "datalink/create": async (files, body) => {
    await files.createDatalink(
      requireString(body, "path"),
      requireValue(body, "value"),
    );
    return null;
  },
  "datalink/update": async (files, body) => {
    await files.updateDatalink(
      requireString(body, "path"),
      requireValue(body, "value"),
    );
    return null;
  },
  "datalink/delete": async (files, body) => {
    await files.deleteDatalink(requireString(body, "path"));
    return null;
  },
};

function requireValue(body: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(body, key)) throw new Error(`'${key}' is required.`);
  return body[key];
}
```

and in `handleProjectServiceRequest`, inside `if (request.method === 'POST')`,
after the versioning block:

```ts
if (Object.hasOwn(DATALINK_ROUTES, routeName)) {
  return handleStoreRequest(
    request,
    response,
    routeName,
    DATALINK_ROUTES[routeName]!,
    datalinkFiles,
    "Datalinks are not available in this host.",
    headers,
  );
}
```

Update the function's doc comment ("…and the `datalink/` routes by
`datalinks.ts`"). `CLAUDE.md`: add `## Local datalinks (src/datalinks.ts)` — a
`.datalink` file (exact, case- sensitive extension, as the standard library's
`data_link_extension`) lists as `DatalinkEntry` without being parsed; the four
routes and their bodies; writes are `writeJsonAtomic` under `serialised`, create
refuses an existing file or a missing folder, update a missing file, delete
anything but a file; values must be JSON objects; schema validation is the
GUI's.

- [ ] **Step 4: Run tests.** Same command — all pass; then the whole package:
      `corepack pnpm --dir app/project-manager-shim run test:unit`,
      `… run compile`, `… run lint`.
- [ ] **Step 5: Commit.**
      `git add app/project-manager-shim/src/handler/filesystem.ts app/project-manager-shim/src/handler/projectService.ts app/project-manager-shim/src/handler/__tests__/filesystem.test.ts app/project-manager-shim/src/handler/__tests__/projectService.test.ts app/project-manager-shim/CLAUDE.md`;
      `git commit -m "Shim: list .datalink files as datalinks and serve datalink/* routes"`.

### Task 22: `LocalBackend` datalinks

**Files**

- Modify `app/common/src/services/ProjectManager/types.ts` (`FileSystemEntry`
  ~l.103)
- Modify `app/common/src/services/ProjectManager/ProjectManager.ts`
  (`deleteFile`'s `switch` ~l.338–358; new methods after `forgetRecentProject`
  ~l.469)
- Modify `app/common/src/services/Backend.ts` (`AssetTypeAndId` ~l.59–68,
  `extractTypeAndPath` ~l.70–92)
- Modify `app/common/src/services/LocalBackend.ts` (id helpers ~l.44–75,
  `listDirectory`'s `switch` ~l.180–222, `deleteAsset` ~l.623, `updateAsset`
  ~l.805, `download` ~l.990–1036, the three `invalidOperation` datalink stubs
  ~l.1221–1234)
- Modify `app/common/src/services/__test__/localBackendTestUtils.ts` (optional
  `downloader`)
- Create `app/common/src/services/__test__/LocalBackend.datalinks.test.ts`
- Create
  `app/common/src/services/ProjectManager/__tests__/ProjectManager.datalinks.test.ts`
- Modify `app/common/CLAUDE.md` (a "Datalinks" bullet under the `LocalBackend`
  section)

**Interfaces**

- Consumes: Task 21's `DatalinkEntry` listing shape and `datalink/*` routes.
- Produces: in `types.ts`,
  `interface DatalinkEntry { type: 'DatalinkEntry'; path: Path; attributes: Attributes }`
  in the `FileSystemEntry` union;
  `ProjectManager.readDatalink(path: Path): Promise<unknown>`,
  `createDatalink(path: Path, value: unknown): Promise<void>`,
  `updateDatalink(path: Path, value: unknown): Promise<void>`,
  `deleteDatalink(path: Path): Promise<void>`; `extractTypeAndPath` accepts
  `datalink-<encoded path>`; `LocalBackend.ts` exports `DATALINK_ID_PREFIX`,
  `DATALINK_EXTENSION = '.datalink'`, `newDatalinkId(path: Path): DatalinkId`;
  `LocalBackend.createDatalink(body)` creates `<parent>/<name>.datalink` when
  `body.datalinkId` is `null` and **rewrites the existing file in place when it
  is set** (the cloud's "new version" semantics, so no new abstract
  `updateDatalink` is needed while `RemoteBackend` still exists);
  `getDatalink(id)` → the file's JSON; `deleteDatalink(id)` and
  `deleteAsset(<datalink id>)` delete it. A datalink asset's `title` is the file
  name without `.datalink` (as cloud datalinks were titled;
  `FileBrowserWidget.chooseEntry` and the drive append the extension back).

- [ ] **Step 1: Write the failing tests.** `LocalBackend.datalinks.test.ts`:

```ts
/** @file Local datalinks: listing, create/update/read/delete, rename and download by file path. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rfc3339DateTime } from "../../utilities/data/dateTime";
import { AssetType, extractTypeAndPath } from "../Backend";
import { newDatalinkId, newDirectoryId, newFileId } from "../LocalBackend";
import { Path } from "../ProjectManager/types";
import { makeLocalBackend } from "./localBackendTestUtils";

const ATTRIBUTES = {
  creationTime: Rfc3339DateTime("2026-01-01T00:00:00.000Z"),
  lastAccessTime: Rfc3339DateTime("2026-01-01T00:00:00.000Z"),
  lastModifiedTime: Rfc3339DateTime("2026-01-02T00:00:00.000Z"),
  byteSize: 12,
};
const LINK = Path("/root/Sales.datalink");
const VALUE = { type: "S3", libraryName: "Standard.AWS", uri: "s3://b/k" };
const LIST_QUERY = {
  filterBy: null,
  labels: null,
  recentProjects: false,
  from: null,
  pageSize: null,
  sortDirection: null,
  sortExpression: null,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("local datalinks", () => {
  it("a datalink id round-trips its path", () => {
    expect(extractTypeAndPath(newDatalinkId(LINK))).toEqual({
      type: AssetType.datalink,
      path: LINK,
    });
  });

  it("lists a DatalinkEntry as a datalink asset titled without its extension", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "listDirectory").mockResolvedValue([
      { type: "DatalinkEntry", path: LINK, attributes: ATTRIBUTES },
    ]);
    const { assets } = await localBackend.listDirectory({
      ...LIST_QUERY,
      parentId: newDirectoryId(Path("/root")),
    });
    expect(assets).toEqual([
      expect.objectContaining({
        type: AssetType.datalink,
        id: newDatalinkId(LINK),
        title: "Sales",
        modifiedAt: ATTRIBUTES.lastModifiedTime,
        parentId: newDirectoryId(Path("/root")),
      }),
    ]);
  });

  it("creates <name>.datalink in the parent folder", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    const create = vi
      .spyOn(projectManager, "createDatalink")
      .mockResolvedValue();
    const info = await localBackend.createDatalink({
      name: "Sales",
      value: VALUE,
      parentDirectoryId: newDirectoryId(Path("/root")),
      datalinkId: null,
    });
    expect(create).toHaveBeenCalledExactlyOnceWith(LINK, VALUE);
    expect(info).toEqual({ id: newDatalinkId(LINK) });
  });

  it("with a datalinkId, rewrites that file in place", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    const update = vi
      .spyOn(projectManager, "updateDatalink")
      .mockResolvedValue();
    const create = vi.spyOn(projectManager, "createDatalink");
    const id = newDatalinkId(LINK);
    expect(
      await localBackend.createDatalink({
        name: "Sales",
        value: VALUE,
        parentDirectoryId: null,
        datalinkId: id,
      }),
    ).toEqual({ id });
    expect(update).toHaveBeenCalledExactlyOnceWith(LINK, VALUE);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a name with a path separator", async () => {
    const { localBackend } = makeLocalBackend();
    await expect(
      localBackend.createDatalink({
        name: "a/b",
        value: VALUE,
        parentDirectoryId: null,
        datalinkId: null,
      }),
    ).rejects.toThrow("A datalink's name cannot contain '/' or '\\'.");
  });

  it("reads and deletes by path, through deleteDatalink and deleteAsset alike", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "readDatalink").mockResolvedValue(VALUE);
    const remove = vi
      .spyOn(projectManager, "deleteDatalink")
      .mockResolvedValue();
    expect(
      await localBackend.getDatalink(newDatalinkId(LINK), "Sales"),
    ).toEqual(VALUE);
    await localBackend.deleteDatalink(newDatalinkId(LINK), "Sales");
    await localBackend.deleteAsset(
      newDatalinkId(LINK),
      { force: true },
      "Sales",
    );
    expect(remove.mock.calls).toEqual([[LINK], [LINK]]);
  });

  it("renaming keeps the extension", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    const move = vi.spyOn(projectManager, "moveFile").mockResolvedValue();
    await localBackend.updateAsset(newDatalinkId(LINK), {
      title: "Revenue",
      parentDirectoryId: null,
      description: null,
      metadataId: null,
    });
    expect(move).toHaveBeenCalledExactlyOnceWith(
      LINK,
      Path("/root/Revenue.datalink"),
    );
  });

  it("downloads the file itself, by its file id", async () => {
    const downloader = vi.fn();
    const { localBackend } = makeLocalBackend({ downloader });
    const details = vi.spyOn(localBackend, "getFileDetails").mockResolvedValue({
      file: { fileId: newFileId(LINK), fileName: "Sales.datalink", path: "" },
      metadata: { size: 12 },
      url: "files/x/download",
    } as never);
    await localBackend.download(newDatalinkId(LINK), "Sales", null);
    expect(details).toHaveBeenCalledExactlyOnceWith(
      newFileId(LINK),
      "Sales",
      true,
    );
    expect(downloader).toHaveBeenCalledExactlyOnceWith({
      url: "files/x/download",
      name: "Sales.datalink",
      electronOptions: { path: null, showFileDialog: true },
    });
  });
});
```

(The rename body is the one `renameAssetVariables` in
`app/gui/src/utils/driveQueries.ts` ~l.305 builds.)
`ProjectManager.datalinks.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { ProjectManager } from "../ProjectManager";
import { Path } from "../types";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["readDatalink", "datalink/read", [], { a: 1 }],
  ["createDatalink", "datalink/create", [{ a: 1 }], null],
  ["updateDatalink", "datalink/update", [{ a: 1 }], null],
  ["deleteDatalink", "datalink/delete", [], null],
] as const)("%s posts to %s", async (method, route, rest, result) => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const pm = new ProjectManager(Path("/root"));
  const returned = await (
    pm[method] as (...args: unknown[]) => Promise<unknown>
  )(Path("/root/a.datalink"), ...rest);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    `/api/project-service/${route}`,
    {
      method: "POST",
      body: JSON.stringify({
        path: "/root/a.datalink",
        ...(rest.length ? { value: rest[0] } : {}),
      }),
    },
  );
  if (method === "readDatalink") expect(returned).toEqual(result);
});

it("a JSON-RPC error becomes a thrown Error with its message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            error: { code: 0, message: "datalink/read failed: bad" },
          }),
        ),
    ),
  );
  await expect(
    new ProjectManager(Path("/root")).readDatalink(Path("/root/a.datalink")),
  ).rejects.toThrow("datalink/read failed: bad");
});
```

- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/common exec vitest run src/services/__test__/LocalBackend.datalinks.test.ts src/services/ProjectManager/__tests__/ProjectManager.datalinks.test.ts`
      — fails: `newDatalinkId` is not exported;
      `pm.readDatalink is not a function`.
- [ ] **Step 3: Implement.** `types.ts`: add `DatalinkEntry` (doc: "a
      `<name>.datalink` file") to the union. `ProjectManager.ts`: in
      `deleteFile`'s `removeChildren` switch add `case 'DatalinkEntry':` beside
      `case 'FileEntry':`; add

```ts
  /**
   * The JSON of the datalink file at `path`.
   * @throws {Error} when it is missing or is not valid JSON.
   */
  async readDatalink(path: Path): Promise<unknown> {
    return this.runProjectServiceCommand('datalink/read', { path })
  }

  /** Create the datalink file `path`; its folder must exist and the file must not. */
  async createDatalink(path: Path, value: unknown): Promise<void> {
    await this.runProjectServiceCommand('datalink/create', { path, value })
  }

  /** Replace the content of the existing datalink file `path`. */
  async updateDatalink(path: Path, value: unknown): Promise<void> {
    await this.runProjectServiceCommand('datalink/update', { path, value })
  }

  /** Delete the datalink file `path`. */
  async deleteDatalink(path: Path): Promise<void> {
    await this.runProjectServiceCommand('datalink/delete', { path })
  }
```

`Backend.ts`: add
`| (DatalinkId extends Id ? AssetTypeAndIdRaw<AssetType.datalink> : never)` to
`AssetTypeAndId` and `case AssetType.datalink:` to `extractTypeAndPath`'s
path-bearing cases (import `DatalinkId` as a type if it is not already in scope;
it is imported at ~l.17). `LocalBackend.ts`:

```ts
export const DATALINK_ID_PREFIX = `${backend.AssetType.datalink}-`;
/** The extension of a local datalink file (compared case-sensitively, as the standard library does). */
export const DATALINK_EXTENSION = ".datalink";

/** Create a {@link backend.DatalinkId} from the path of a `.datalink` file. */
export function newDatalinkId(path: Path) {
  return backend.DatalinkId(`${DATALINK_ID_PREFIX}${encodeURIComponent(path)}`);
}

/** A datalink's title: its file name without `.datalink`, as the cloud titled datalinks. */
function datalinkTitle(path: Path) {
  return getFileName(path).slice(0, -DATALINK_EXTENSION.length);
}
```

`listDirectory`'s switch:

```ts
            case 'DatalinkEntry': {
              return {
                ...shared,
                type: backend.AssetType.datalink,
                id: newDatalinkId(entry.path),
                title: datalinkTitle(entry.path),
                modifiedAt: entry.attributes.lastModifiedTime,
                createdAt: entry.attributes.creationTime,
                parentId,
              } satisfies backend.DatalinkAsset
            }
```

Replace the three stubs:

```ts
  /**
   * Create `<parent>/<name>.datalink`, or, with `body.datalinkId`, replace that datalink's content
   * (the cloud's "new version"; a local datalink has no versions).
   * @throws {Error} when the name contains a path separator, or the shim refuses the write.
   */
  override async createDatalink(body: backend.CreateDatalinkRequestBody): Promise<backend.DatalinkInfo> {
    if (body.datalinkId != null) {
      await this.projectManager.updateDatalink(backend.extractTypeAndPath(body.datalinkId).path, body.value)
      return { id: body.datalinkId }
    }
    if (/[/\\]/.test(body.name)) throw new Error("A datalink's name cannot contain '/' or '\\'.")
    const parentPath =
      body.parentDirectoryId == null ?
        this.projectManager.rootDirectory
      : backend.extractTypeAndPath(body.parentDirectoryId).path
    const path = joinPath(parentPath, `${body.name}${DATALINK_EXTENSION}`)
    await this.projectManager.createDatalink(path, body.value)
    return { id: newDatalinkId(path) }
  }

  /** The datalink file's JSON. */
  override async getDatalink(datalinkId: backend.DatalinkId): Promise<backend.Datalink> {
    // A `Datalink` is opaque JSON; the editor validates it.
    return (await this.projectManager.readDatalink(backend.extractTypeAndPath(datalinkId).path)) as backend.Datalink
  }

  /** Delete the datalink file. */
  override async deleteDatalink(datalinkId: backend.DatalinkId): Promise<void> {
    await this.projectManager.deleteDatalink(backend.extractTypeAndPath(datalinkId).path)
  }
```

`deleteAsset`: add
`case backend.AssetType.datalink: { await this.projectManager.deleteDatalink(path); return }`.
`updateAsset`, in `newParentDirectoryPath`'s closure:
`const fileName = title == null ? getFileName(currentParentDirectoryPath) : type === backend.AssetType.datalink ? `${title}${DATALINK_EXTENSION}` : title`
(moves without a title already keep the full file name). `download`: replace the
`datalink` arm of the throwing case with

```ts
      case backend.AssetType.datalink: {
        // A local datalink is a file: download the file itself, byte for byte.
        const { path } = backend.extractTypeAndPath(asset.id)
        const details = await this.getFileDetails(newFileId(path), title, true)
        if (details.url == null) throw new Error('The download URL of the datalink must be present.')
        await this.downloader({
          url: details.url,
          name: details.file.fileName ?? `${title}${DATALINK_EXTENSION}`,
          electronOptions: { path: targetPath, showFileDialog: true },
        })
        break
      }
```

`localBackendTestUtils.ts`:
`makeLocalBackend({ downloader = () => {} }: { downloader?: (o: DownloadOptions) => void } = {})`
passing `downloader` to the constructor (existing callers unchanged).
`app/common/CLAUDE.md`: bullet "**Datalinks** are `.datalink` files: the shim
lists them as `DatalinkEntry`; the id is `datalink-<encoded path>`, the title
the name without the extension; `createDatalink` with a `datalinkId` rewrites in
place; download goes through the file's own details."

- [ ] **Step 4: Run tests.** Same command — all pass. Then
      `corepack pnpm --dir app/common run test:unit`,
      `corepack pnpm -r --if-present run compile` (the shim middleware and the
      localApi mock import the widened `FileSystemEntry`),
      `corepack pnpm --dir app/gui run typecheck`.
- [ ] **Step 5: Commit.**
      `git add app/common/src/services/ProjectManager/types.ts app/common/src/services/ProjectManager/ProjectManager.ts app/common/src/services/Backend.ts app/common/src/services/LocalBackend.ts app/common/src/services/__test__/localBackendTestUtils.ts app/common/src/services/__test__/LocalBackend.datalinks.test.ts app/common/src/services/ProjectManager/__tests__/ProjectManager.datalinks.test.ts app/common/CLAUDE.md`;
      `git commit -m "LocalBackend: datalinks as .datalink files through the shim"`.

### Task 23: Export a datalink in an archive

**Files**

- Modify `app/electron-client/src/server.ts`
  (`AssetTypeAndId`/`extractTypeAndPath` ~l.106–141, `apiArchiveStream`'s
  `addFile`/`addAsset` ~l.752–808)
- Modify `app/gui/project-manager-shim-middleware/index.ts`
  (`apiArchiveStream`'s `addFile`/`addAsset` ~l.475–530)

**Interfaces**

- Consumes: Task 22's `datalink-` ids (the drive's Export passes selected asset
  ids to `exportArchive`) and the common `extractTypeAndPath` accepting them
  (the middleware imports it).
- Produces: a selected datalink is added to the export zip as its `.datalink`
  file.

- [ ] **Step 1: Implement.** `server.ts`: add `DatalinkId` to the type imports,
      the
      `| (DatalinkId extends Id ? AssetTypeAndIdRaw<AssetType.datalink> : never)`
      arm, and `case AssetType.datalink:` beside `file` in its
      `extractTypeAndPath`. In both `apiArchiveStream`s: widen
      `addFile = async (id: FileId | DatalinkId, rootPath?: string)` and split
      the trailing case:

```ts
        // A local datalink is a `.datalink` file.
        case AssetType.datalink: {
          const error = await addFile(typeAndId.id, rootPath)
          if (error) {
            return error
          }
          break
        }
        // Secrets are not present on the Local Backend; listed to keep the switch exhaustive.
        case AssetType.secret: {
          return
        }
```

(Folder exports already include `.datalink` files: `apiListDirectory` reads the
disk directly and maps every file to a file asset.)

- [ ] **Step 2: Verify.** No unit test covers `apiArchiveStream` in either host
      (there is none to extend; both are exercised end to end). Run
      `corepack pnpm --dir app/electron-client run typecheck`,
      `corepack pnpm --dir app/gui run typecheck`,
      `corepack pnpm --dir app/electron-client run lint`; the installer test
      (Task 28) exports a datalink and opens the zip.
- [ ] **Step 3: Commit.**
      `git add app/electron-client/src/server.ts app/gui/project-manager-shim-middleware/index.ts`;
      `git commit -m "Export local datalinks as their .datalink files"`.

### Task 24: Editor: plain values for secret fields, and an edit mode

**Files**

- Modify `app/gui/src/datalinks/JSONSchemaInput.vue` (imports ~l.23–40; secrets
  query ~l.62–83; `anyOf` ~l.166–210; template `enso-secret`/`enso-file`
  branches ~l.237–273; `Dropdown` ~l.360)
- Modify `app/gui/src/datalinks/DatalinkInput.vue`
- Modify `app/gui/src/datalinks/UpsertDatalinkModal.vue`
- Delete `app/gui/src/datalinks/FilePathInput.vue`
- Modify `app/gui/src/datalinks/__tests__/DatalinkInput.test.ts`
- Modify `app/gui/src/datalinks/__tests__/UpsertDatalinkModal.test.ts`
- Modify `app/gui/src/datalinks/CLAUDE.md`
- Modify `app/common/src/text/english.json`

**Interfaces**

- Consumes: the schema `app/gui/src/utils/datalinkSchema.json` and
  `validateDatalink`/`AJV` from `$/utils/datalinkValidator` unchanged — files
  stay exactly what the standard library reads.
- Produces: `JSONSchemaInput` prop
  `unavailable?: ReadonlyMap<string, TextId | null>` (a `$ref` → note shown
  where it is left out), passed down recursively; `DatalinkInput`'s
  `UNAVAILABLE_SCHEMAS`; `UpsertDatalinkModal` prop
  `existing?: { readonly name: string; readonly value: unknown } | undefined`
  (edit mode); text keys `editDatalink` ("Edit Datalink"),
  `datalinkSecretsUnavailable` ("Enso secrets are not available yet. This value
  is saved as plain text in the datalink file.").

**The plain-value rule, concretely.** Every secret-capable field in the schema
is a `SecureValue`
(`anyOf: [{ "title": "Text", "type": "string" }, { "$ref": "#/$defs/EnsoSecret" }]`):
AWS access key id and secret key, and the username/password of Postgres,
Snowflake and all SQL Server credential kinds (l.85–89, 182–186, 230–234,
307–311, 339–343, 355–359). So: the `EnsoSecret` member is left out of every
such list, the field is a plain text field, and the note shows under it. A file
that already holds `{ "type": "secret", "secretPath": … }` (copied from the
cloud) keeps it: the member stays listed while it is the chosen one, its path
shows read-only with the note, and saving writes it back unchanged; choosing
"Text" replaces it. The `Enso File` datalink type is left out the same way (no
note): its `path` must match `^enso://(?:Users|Teams)/`, an Enso Cloud path.
**Ruling needed:** hiding `Enso File` and deleting `FilePathInput.vue` (its only
user, and the last mount of `FileBrowserWidget` outside the project view) —
recommended, since no local path can satisfy that schema; an existing
`Enso_File` file still opens, its path as plain text.

- [ ] **Step 1: Write the failing tests.** In `DatalinkInput.test.ts`: delete
      the `listSecrets` hoist, both
      `vi.mock('$/providers/backends'…)`/`vi.mock('$/providers/auth'…)`, the
      `FileBrowserWidget` mock and `listSecrets.mockReset()…`; drop
      `'Enso File'` from the first test's expected type list; replace the tests
      "a secret is chosen…", "an invalid secret shows…" and "a file path opens
      the file browser…" with:

```ts
test("a secure value offers Text only, and says secrets are not available", async () => {
  await mountEditor();
  await chooseType("Postgres Database Connection");
  const options = [...element().querySelectorAll('[role="option"]')].map((o) =>
    o.textContent?.trim(),
  );
  expect(options).toContain("Text");
  expect(options).not.toContain("Enso Secret");
  expect(element().textContent).toContain(
    getText("datalinkSecretsUnavailable"),
  );
});

const WITH_SECRET = {
  type: "Postgres_Connection",
  libraryName: "Standard.Database",
  host: "db",
  port: 5432,
  database_name: "sales",
  credentials: {
    username: "me",
    password: { type: "secret", secretPath: "enso://Users/me/pw" },
  },
};

test("an existing secret reference is kept, shown read-only, and can be replaced by text", async () => {
  const { value } = await mountEditor(WITH_SECRET);
  const secretPath = [
    ...element().querySelectorAll<HTMLInputElement>("input"),
  ].find((input) => input.value === "enso://Users/me/pw")!;
  expect(secretPath.readOnly).toBe(true);
  expect(value.value).toEqual(WITH_SECRET);
  const passwordList = element().querySelectorAll(
    `[role="listbox"][aria-label="${getText("options")}"]`,
  )[2]!;
  await userEvent
    .setup()
    .click(
      [...passwordList.querySelectorAll('[role="option"]')].find(
        (o) => o.textContent?.trim() === "Text",
      )!,
    );
  expect(value.value).toMatchObject({
    credentials: { username: "me", password: "" },
  });
  expect(
    [...passwordList.querySelectorAll('[role="option"]')].map((o) =>
      o.textContent?.trim(),
    ),
  ).toEqual(["Text"]);
});

test("an existing Enso File datalink opens, its path as plain text", async () => {
  const link = {
    type: "Enso_File",
    libraryName: "Standard.Base",
    path: "enso://Users/me/a.csv",
  };
  await mountEditor(link);
  expect(
    [...element().querySelectorAll<HTMLInputElement>("input")].some(
      (i) => i.value === link.path,
    ),
  ).toBe(true);
});
```

(The list index of the password's `SecureValue` follows the rendering order —
type, username, password; confirm it with a `console.log` of the listboxes'
option texts while writing the test, then remove the log.) In
`UpsertDatalinkModal.test.ts`: remove the backends/auth/FileBrowserWidget mocks;
let `mountModal(props = {})` spread extra props; add:

```ts
test('edit mode: "Edit Datalink", the name read-only, the value loaded, and Save', async () => {
  const existing = {
    name: "my link",
    value: {
      type: "S3",
      libraryName: "Standard.AWS",
      uri: "s3://b/old",
      auth: { type: "aws_auth", subType: "default" },
    },
  };
  const { doCreate, onClose } = await mountModal({ existing });
  expect(dialog().querySelector("h2")!.textContent).toBe(
    getText("editDatalink"),
  );
  expect(nameInput().value).toBe("my link");
  expect(nameInput().readOnly).toBe(true);
  const uri = dialog().querySelector<HTMLInputElement>(
    `input[placeholder="${getText("enterText")}"]`,
  )!;
  expect(uri.value).toBe("s3://b/old");
  const user = userEvent.setup();
  await user.clear(uri);
  await user.type(uri, "s3://b/new");
  await user.click(button(getText("save"))!);
  await flushPromises();
  expect(doCreate).toHaveBeenCalledExactlyOnceWith("my link", {
    ...existing.value,
    uri: "s3://b/new",
  });
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run them.**
      `corepack pnpm --dir app/gui exec vitest run src/datalinks/__tests__/DatalinkInput.test.ts src/datalinks/__tests__/UpsertDatalinkModal.test.ts`
      — fails: `Enso Secret` and `Enso File` are offered, the note text key is
      unknown (`getText('datalinkSecretsUnavailable')` is `undefined`), the
      dialog has no edit mode.
- [ ] **Step 3: Implement.** `english.json`: add
      `"editDatalink": "Edit Datalink"` after `"createDatalink"` and
      `"datalinkSecretsUnavailable": "…"` (the text above) after
      `"datalinkNamePlaceholder"`. `DatalinkInput.vue`:

```ts
import type { TextId } from "enso-common/src/text";
/**
 * Schema members the local IDE cannot offer yet, with the note shown where one is left out.
 * `EnsoSecret`: there are no local secrets yet, so a secure value is plain text.
 * `EnsoFileDataLink`: its path is an Enso Cloud path (`enso://Users/…`).
 */
const UNAVAILABLE_SCHEMAS: ReadonlyMap<string, TextId | null> = new Map([
  ["#/$defs/EnsoSecret", "datalinkSecretsUnavailable"],
  ["#/$defs/EnsoFileDataLink", null],
]);
```

passed as `:unavailable="UNAVAILABLE_SCHEMAS"`. `JSONSchemaInput.vue`: remove
`useAuth`, `useBackends`, `useQuery`, `backendBaseOptions`, `backendQueryKey`,
`ComboBox`, `Form`, `FilePathInput` imports, `secretsQuery`, `userPathPrefix`,
`secretAutocompleteItems`; add the prop
`unavailable?: ReadonlyMap<string, TextId | null> | undefined` (default
`new Map()`), pass `:unavailable="unavailable"` to every recursive
`JSONSchemaInput`; replace the `anyOf` dropdown data with

```ts
const isUnavailable = (schema: object) =>
  "$ref" in schema &&
  typeof schema.$ref === "string" &&
  props.unavailable.has(schema.$ref);
/** The members offered: the available ones, and an unavailable one while it is the chosen one. */
const offeredMembers = computed(() =>
  (anyOfSchemas.value ?? []).flatMap((schema, index) =>
    index === selectedChildIndex.value || !isUnavailable(schema)
      ? [{ schema, index }]
      : [],
  ),
);
/** The note for this list's unavailable members, if any has one. */
const unavailableNote = computed(() => {
  for (const schema of anyOfSchemas.value ?? []) {
    const note =
      "$ref" in schema && typeof schema.$ref === "string"
        ? props.unavailable.get(schema.$ref)
        : null;
    if (note != null) return getText(note);
  }
  return null;
});
```

and in the template `:items="offeredMembers.map((member) => member.schema)"`,
`:selectedIndex="offeredMembers.findIndex((member) => member.index === selectedChildIndex)"`,
`@update:selectedIndex="(i: number | null) => selectChild(i == null ? null : (offeredMembers[i]?.index ?? null))"`,
and after the selected member's editor
`<Text v-if="unavailableNote != null" variant="body-sm" class="px-2">{{ unavailableNote }}</Text>`.
Validator paths keep the schema's own indices
(`${path}/anyOf/${selectedChildIndex}`), so AJV is untouched. Replace the
`enso-secret` branch with
`<SchemaTextInput v-if="schemaFormat === 'enso-secret'" type="text" :readOnly="true" :value="value" :validationErrorClass="validationErrorClass" :error="error" @change="onChange" />`
and delete the `enso-file` branch (it falls to the plain `SchemaTextInput`);
`partCount`'s string arm becomes `count += 1`; update the file comment
(`enso-secret`: shown read-only, no local secrets; `enso-file`: plain text).
`git rm app/gui/src/datalinks/FilePathInput.vue`;
`git grep -n "FilePathInput" app/gui/src` must come back empty.
`UpsertDatalinkModal.vue`: add the `existing` prop;
`:title="existing ? getText('editDatalink') : getText('createDatalink')"`;
`:defaultValues="{ name: existing?.name ?? '', value: existing?.value ?? INITIAL_DATALINK_VALUE }"`;
the name `Input` gets `:readOnly="existing != null"` and
`:autoFocus="existing == null"`; the submit text is
`existing ? getText('save') : getText('create')`; the file comment says the edit
mode keeps the name (renaming is the name cell's). **Ruling needed:** name
read-only when editing — recommended, because a rename is a file move the drive
already does (with uniqueness checking by `titleSchema`), and a save that also
moves the file could half-fail. `CLAUDE.md`: drop `FilePathInput`, describe
`UNAVAILABLE_SCHEMAS` and the edit mode, and that the Properties tab is gone
(the dialog is the only editor).

- [ ] **Step 4: Run tests.** Same command — pass; then
      `corepack pnpm --filter enso-common run compile`,
      `corepack pnpm --dir app/gui run typecheck`,
      `corepack pnpm --dir app/gui exec eslint src/datalinks` and
      `corepack pnpm --dir app/gui exec prettier --check src/datalinks ../common/src/text/english.json`.
- [ ] **Step 5: Commit.**
      `git add -A app/gui/src/datalinks app/common/src/text/english.json`;
      `git commit -m "Datalink editor: plain values for secret fields locally, and an edit mode"`.

### Task 25: Drive: New Datalink, open and edit

**Files**

- Create `app/gui/src/dashboard/layouts/Drive/datalinkActions.ts`
- Create `app/gui/src/dashboard/layouts/Drive/__tests__/datalinkActions.test.ts`
- Modify
  `app/gui/src/dashboard/pages/dashboard/Drive/DriveBar/DriveBarToolbar.vue`
  (`newDatalink` ~l.95, `openNewDatalink` ~l.129, the `connector_add` button
  ~l.264–272)
- Modify `app/gui/src/dashboard/layouts/Drive/globalContextMenuEntries.ts`
  (`newDatalink` ~l.48, entry ~l.98–108)
- Modify `app/gui/src/dashboard/layouts/AssetContextMenu.vue` (the `edit` entry
  ~l.388–405)
- Modify `app/gui/src/dashboard/layouts/AssetsTable.vue` (Enter/Space on a
  datalink ~l.745)
- Modify
  `app/gui/src/dashboard/pages/dashboard/components/column/DatalinkNameColumn.vue`

**Interfaces**

- Consumes: Task 22's `LocalBackend.createDatalink`/`getDatalink`; Task 24's
  `existing` prop; `useMutationCallback`, `useToastAndLog` (`driveActions.ts`),
  `backendMutationOptions`, `backendQueryOptions` (`$/utils/backendQuery`;
  `createDatalink` already invalidates `listDirectory`, `searchDirectory`,
  `getDatalink`, `getAssetDetails`), `useModals`.
- Produces:
  `useNewDatalink(backend: MaybeRefOrGetter<Backend>): (parentId: DirectoryId) => { key: number }`
  and
  `useEditDatalink(backend: MaybeRefOrGetter<Backend>): (asset: DatalinkAsset) => Promise<void>`.

- [ ] **Step 1: Write the failing test** `datalinkActions.test.ts`:

```ts
/** @file "New Datalink" and opening a datalink: the dialog's props, and what a save writes. */
import { useModals } from "$/providers/modals";
import { mountWithProviders } from "$/utils/testing/mountWithProviders";
import {
  AssetType,
  BackendType,
  DatalinkId,
  DirectoryId,
  type Backend,
  type DatalinkAsset,
} from "enso-common/src/services/Backend";
import { afterEach, expect, test, vi } from "vitest";
import { defineComponent } from "vue";
import { useEditDatalink, useNewDatalink } from "../datalinkActions";

const VALUE = { type: "S3", libraryName: "Standard.AWS", uri: "s3://b/k" };
const ASSET = {
  type: AssetType.datalink,
  id: DatalinkId("datalink-%2Froot%2FSales.datalink"),
  title: "Sales",
  parentId: DirectoryId("directory-%2Froot"),
} as DatalinkAsset;

async function setup(backend: Partial<Backend>) {
  let actions!: {
    edit: ReturnType<typeof useEditDatalink>;
    create: ReturnType<typeof useNewDatalink>;
  };
  const full = { type: BackendType.local, ...backend } as Backend;
  await mountWithProviders(
    defineComponent({
      setup() {
        actions = { edit: useEditDatalink(full), create: useNewDatalink(full) };
        return () => null;
      },
    }),
  );
  return actions;
}
const topProps = () =>
  useModals().stack.value.at(-1)!.props as Record<string, any>;

afterEach(() => {
  useModals().closeAll();
  vi.restoreAllMocks();
});

test("opening reads the file, and saving rewrites that datalink", async () => {
  const createDatalink = vi.fn().mockResolvedValue({ id: ASSET.id });
  const { edit } = await setup({
    getDatalink: vi.fn().mockResolvedValue(VALUE),
    createDatalink,
  });
  await edit(ASSET);
  expect(topProps().existing).toEqual({ name: "Sales", value: VALUE });
  await topProps().doCreate("Sales", { ...VALUE, uri: "s3://b/new" });
  expect(createDatalink).toHaveBeenCalledExactlyOnceWith({
    name: "Sales",
    value: { ...VALUE, uri: "s3://b/new" },
    parentDirectoryId: ASSET.parentId,
    datalinkId: ASSET.id,
  });
});

test("a datalink that cannot be read opens no dialog, and says why", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { edit } = await setup({
    getDatalink: vi
      .fn()
      .mockRejectedValue(new Error("'Sales.datalink' is not valid JSON")),
  });
  await edit(ASSET);
  expect(useModals().stack.value).toEqual([]);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("is not valid JSON"),
  );
});

test("New Datalink creates in the given folder", async () => {
  const createDatalink = vi.fn().mockResolvedValue({ id: ASSET.id });
  const { create } = await setup({ createDatalink });
  create(ASSET.parentId);
  expect(topProps().existing).toBeUndefined();
  await topProps().doCreate("Sales", VALUE);
  expect(createDatalink).toHaveBeenCalledExactlyOnceWith({
    name: "Sales",
    value: VALUE,
    parentDirectoryId: ASSET.parentId,
    datalinkId: null,
  });
});
```

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/dashboard/layouts/Drive/__tests__/datalinkActions.test.ts`
      — fails: `Failed to resolve import "../datalinkActions"`.
- [ ] **Step 3: Implement** `datalinkActions.ts`:

```ts
/**
 * @file Creating a datalink and opening one: both show the datalink dialog on the modal stack. An
 * opened datalink is read first; one that cannot be read (missing, or not valid JSON) shows an
 * error toast and no dialog, so a save never overwrites what could not be shown.
 */
import UpsertDatalinkModal from "$/datalinks/UpsertDatalinkModal.vue";
import { useModals } from "$/providers/modals";
import {
  backendMutationOptions,
  backendQueryOptions,
} from "$/utils/backendQuery";
import { useQueryClient } from "@tanstack/vue-query";
import type {
  Backend,
  DatalinkAsset,
  DirectoryId,
} from "enso-common/src/services/Backend";
import { toValue, type MaybeRefOrGetter } from "vue";
import { useMutationCallback, useToastAndLog } from "./driveActions";

/** A function opening the "Create Datalink" dialog for a folder; it returns the modal's key. */
export function useNewDatalink(backend: MaybeRefOrGetter<Backend>) {
  const modals = useModals();
  const createDatalink = useMutationCallback(() =>
    backendMutationOptions(toValue(backend), "createDatalink"),
  );
  return (parentId: DirectoryId) =>
    modals.open(UpsertDatalinkModal, {
      doCreate: async (name: string, value: unknown) => {
        await createDatalink([
          { name, value, parentDirectoryId: parentId, datalinkId: null },
        ]);
      },
    });
}

/** A function opening a datalink in the dialog; saving writes the same datalink. */
export function useEditDatalink(backend: MaybeRefOrGetter<Backend>) {
  const modals = useModals();
  const queryClient = useQueryClient();
  const toastAndLog = useToastAndLog();
  const saveDatalink = useMutationCallback(() =>
    backendMutationOptions(toValue(backend), "createDatalink"),
  );
  return async (asset: DatalinkAsset) => {
    let value: unknown;
    try {
      value = await queryClient.fetchQuery({
        ...backendQueryOptions(toValue(backend), "getDatalink", [
          asset.id,
          asset.title,
        ]),
        staleTime: 0,
      });
    } catch (error) {
      toastAndLog("getDatalinkBackendError", error, asset.title);
      return;
    }
    modals.closeAll();
    modals.open(UpsertDatalinkModal, {
      existing: { name: asset.title, value },
      doCreate: async (_name: string, newValue: unknown) => {
        await saveDatalink([
          {
            name: asset.title,
            value: newValue,
            parentDirectoryId: asset.parentId,
            datalinkId: asset.id,
          },
        ]);
      },
    });
  };
}
```

Wiring (each replaces the old code at the cited lines):

- `DriveBarToolbar.vue`: drop the `UpsertDatalinkModal` import and
  `newDatalink`; add `const newDatalink = useNewDatalink(backend)`;
  `openNewDatalink` becomes
  `const { key } = newDatalink(currentDirectoryId.value); openedModals.value = { ...openedModals.value, datalink: key }`;
  the `connector_add` button loses `:isDisabled="!isCloud"` and gets
  `:aria-label="getText('newDatalink')"`.
- `globalContextMenuEntries.ts`: drop the import and the `newDatalink` mutation;
  add `const newDatalink = useNewDatalink(options.backend)`; the entry is
  `{ action: 'newDatalink', doAction: () => { modals.closeAll(); newDatalink(target()) } }`
  with no `isCloud &&`; update the file comment.
- `AssetContextMenu.vue`: split the `edit` entry: a datalink gets
  `asset.type === backendModule.AssetType.datalink && canEditThisAsset.value && { action: 'edit', doAction: () => void editDatalink(asset) }`
  with `const editDatalink = useEditDatalink(() => driveView.location.backend)`
  (or the menu's own backend computed, whichever it already uses for
  `deleteAssets`); a secret keeps whatever PR 2 left for it.
- `AssetsTable.vue`: the `AssetType.datalink` arm calls
  `void editDatalink(item)` instead of `rightPanel.setTemporaryTab('settings')`,
  with `const editDatalink = useEditDatalink(backend)`.
- `DatalinkNameColumn.vue`: a double click calls `void editDatalink(item)` with
  `const editDatalink = useEditDatalink(() => driveView.location.backend)`
  (`useDriveView` from `#/layouts/Drive/driveView`); remove `useRightPanelData`;
  the file comment says "A double click opens it in the datalink dialog."

- `app/common/src/text/english.json`: delete `"newDatalink.cloudOnly"`.

`git grep -n "newDatalink.cloudOnly" app` must come back empty, and
`git grep -n "setTemporaryTab('settings')" app/gui/src/dashboard/pages/dashboard/components/column/DatalinkNameColumn.vue`
too; the AssetsTable `datalink` arm no longer mentions `rightPanel`.

- [ ] **Step 4: Run tests.** Same command — 3 passed; then
      `corepack pnpm --dir app/gui exec vitest run src/dashboard`,
      `corepack pnpm --dir app/gui run typecheck`,
      `corepack pnpm --dir app/gui exec eslint src/dashboard/layouts src/dashboard/pages/dashboard`,
      and prettier on the touched files.
- [ ] **Step 5: Commit.**
      `git add app/gui/src/dashboard/layouts/Drive/datalinkActions.ts app/gui/src/dashboard/layouts/Drive/__tests__/datalinkActions.test.ts app/gui/src/dashboard/pages/dashboard/Drive/DriveBar/DriveBarToolbar.vue app/gui/src/dashboard/layouts/Drive/globalContextMenuEntries.ts app/gui/src/dashboard/layouts/AssetContextMenu.vue app/gui/src/dashboard/layouts/AssetsTable.vue app/gui/src/dashboard/pages/dashboard/components/column/DatalinkNameColumn.vue app/common/src/text/english.json`;
      `git commit -m "Drive: New Datalink and opening a datalink in the local drive"`.

### Task 26: Graph editor: the file widget offers `.datalink` files

**Files**

- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/localBrowser.ts`
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/__tests__/localBrowser.test.ts`

**Interfaces**

- Consumes: `FileType`
  (`$/providers/openedProjects/widgetRegistry/configuration`), `FileFilter`
  (`@/util/fileFilter`);
  `window.api.fileBrowser.openFileBrowser(kind, defaultPath, filters)`
  (Electron's native dialog, `app/electron-client/src/electron.ts` ~l.119).
- Produces: `DATALINK_FILE_FILTER: FileFilter` and
  `dialogFileFilters(fileTypes: FileType[] | undefined, write: boolean): FileFilter[] | undefined`.

  After PR 2 the widget's only browser is the native dialog. With no
  `file_types` it lists every file, `.datalink` included, already; with
  `file_types` (e.g. `File_Browse file_types=[…]`) the dialog hides everything
  else. A read dialog with filters therefore gets a `Datalink` filter (the
  standard library reads a datalink as its target); a write dialog does not.
  **Ruling needed:** reads only — recommended, since writing through a datalink
  is the `save_as_data_link` flow, whose own widgets already filter on
  `["datalink"]`.

- [ ] **Step 1: Write the failing test** `localBrowser.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import {
  DATALINK_FILE_FILTER,
  dialogFileFilters,
  useLocalBrowser,
} from "../localBrowser";

afterEach(() => vi.unstubAllGlobals());

const CSV = [{ label: "Delimited", extensions: ["csv", "tsv"] }];

test.each([
  ["no file types: every file is listed", undefined, false, undefined],
  [
    "a read adds the datalink filter",
    CSV,
    false,
    [{ name: "Delimited", extensions: ["csv", "tsv"] }, DATALINK_FILE_FILTER],
  ],
  [
    "a write does not",
    CSV,
    true,
    [{ name: "Delimited", extensions: ["csv", "tsv"] }],
  ],
  [
    "a filter naming datalinks is kept as it is",
    [{ label: "DataLink", extensions: ["datalink"] }],
    false,
    [{ name: "DataLink", extensions: ["datalink"] }],
  ],
  [
    'an "all files" filter needs none',
    [{ label: "All", extensions: ["*"] }],
    false,
    [{ name: "All", extensions: ["*"] }],
  ],
] as const)("%s", (_, fileTypes, write, expected) => {
  expect(dialogFileFilters(fileTypes as never, write)).toEqual(expected);
});

test("choosing a file passes the filters, and sets the chosen .datalink path", async () => {
  const openFileBrowser = vi
    .fn()
    .mockResolvedValue(["/home/me/Sales.datalink"]);
  // jsdom's `window` is `globalThis`, so this is `window.api`.
  vi.stubGlobal("api", { fileBrowser: { openFileBrowser } });
  const setPath = vi.fn();
  const items = useLocalBrowser({
    dialogKind: "file",
    write: false,
    currentPath: undefined,
    setPath,
    fileTypes: CSV,
  });
  await (items.value[0]!.onClick as () => Promise<void>)();
  expect(openFileBrowser).toHaveBeenCalledExactlyOnceWith("file", undefined, [
    { name: "Delimited", extensions: ["csv", "tsv"] },
    DATALINK_FILE_FILTER,
  ]);
  expect(setPath).toHaveBeenCalledExactlyOnceWith(
    "file",
    "/home/me/Sales.datalink",
  );
});
```

- [ ] **Step 2: Run it.**
      `corepack pnpm --dir app/gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/__tests__/localBrowser.test.ts`
      — fails: `DATALINK_FILE_FILTER` / `dialogFileFilters` are not exported.
- [ ] **Step 3: Implement** in `localBrowser.ts`:

```ts
/** Lets a read dialog pick a datalink, which the standard library reads as its target. */
export const DATALINK_FILE_FILTER: FileFilter = {
  name: "Datalink",
  extensions: ["datalink"],
};

/**
 * The native dialog's filters for the widget's file types. Without file types it lists every
 * file. A dialog reading a file also offers datalinks, unless a filter already admits them.
 */
export function dialogFileFilters(
  fileTypes: FileType[] | undefined,
  write: boolean,
): FileFilter[] | undefined {
  if (fileTypes == null) return undefined;
  const filters = fileTypesToFileFilters(fileTypes);
  if (write || filters.length === 0) return filters;
  const admitsDatalinks = filters.some(
    ({ extensions }) =>
      extensions === "all" ||
      extensions.includes("*") ||
      extensions.includes("datalink"),
  );
  return admitsDatalinks ? filters : [...filters, DATALINK_FILE_FILTER];
}
```

and in `openFileBrowser`:
`const filters = rawKind === 'file' ? dialogFileFilters(toValue(fileTypes), toValue(write)) : undefined`
(replacing the `fileTypes_`/`filters` lines; a directory dialog takes no file
filters).

- [ ] **Step 4: Run tests.** Same command — 6 passed; then
      `corepack pnpm --dir app/gui exec vitest run src/project-view/components/GraphEditor/widgets`,
      typecheck, eslint and prettier on the two files.
- [ ] **Step 5: Commit.**
      `git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/localBrowser.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/__tests__/localBrowser.test.ts`;
      `git commit -m "File widget: a read dialog with file types also offers datalinks"`.

### Task 27: Playwright: local datalinks end to end

**Files**

- Modify `app/gui/integration-test/mock/localApi.ts` (entry types ~l.86–102,
  helpers ~l.258–282, `datalink/*` routes beside `labelRoute` ~l.399–420, the
  returned `api` ~l.856)
- Modify `app/gui/integration-test/actions/NewDataLinkModalActions.ts`
- Create `app/gui/integration-test/dashboard/localDatalinks.spec.ts`
- Create `app/gui/integration-test/project-view/localDatalinkWidget.spec.ts`

**Interfaces**

- Consumes: Tasks 21–26; `TEXT` (`integration-test/actions`, from
  `enso-common`'s compiled `dist/`, so
  `corepack pnpm --filter enso-common run compile` after Task 24's keys).
- Produces: `MockLocalApi.addDatalink({ path: Path; value: unknown }): void`,
  `MockLocalApi.datalinkValue(path: string): unknown` (parsed content,
  `undefined` when absent); the mock lists `DatalinkEntry`s and serves
  `datalink/{read,create,update,delete}` with the shim's error messages;
  `NewDataLinkModalActions` locates the dialog by `TEXT.createDatalink` or
  `TEXT.editDatalink`.

- [ ] **Step 1: Extend the mock.** In `localApi.ts`:

```ts
type DatalinkEntryWithData = {
  type: "DatalinkEntry";
  entry: DatalinkEntry;
  content: string;
};
type FileSystemEntryWithData =
  | DatalinkEntryWithData
  | DirectoryEntryWithData
  | ProjectEntryWithData
  | FileEntryWithData;
// …
const addDatalink = ({ path, value }: { path: Path; value: unknown }) => {
  const entry: DatalinkEntry = {
    type: "DatalinkEntry",
    path,
    attributes: createAttributes(),
  };
  addEntry(path, {
    type: "DatalinkEntry",
    entry,
    content: JSON.stringify(value, null, 2),
  });
};
const datalinkValue = (path: string): unknown => {
  const entry = fileSystem.get(path);
  return entry?.type === "DatalinkEntry"
    ? JSON.parse(entry.content)
    : undefined;
};
// … inside 'Mock Local API', after the label routes:
const datalinkName = (path: string) => posix.basename(path);
await labelRoute("datalink/read", ({ path }) => {
  const entry = fileSystem.get(String(path));
  if (entry?.type !== "DatalinkEntry")
    return toJSONRPCError(`datalink/read failed: no such file`);
  try {
    return toJSONRPCResult(JSON.parse(entry.content));
  } catch (error) {
    return toJSONRPCError(
      `datalink/read failed: '${datalinkName(String(path))}' is not valid JSON: ${String(error)}`,
    );
  }
});
await labelRoute("datalink/create", ({ path, value }) => {
  if (fileSystem.has(String(path))) {
    return toJSONRPCError(
      `datalink/create failed: '${datalinkName(String(path))}' already exists.`,
    );
  }
  addDatalink({ path: Path(String(path)), value });
  return toJSONRPCResult(null);
});
await labelRoute("datalink/update", ({ path, value }) => {
  const entry = fileSystem.get(String(path));
  if (entry?.type !== "DatalinkEntry") {
    return toJSONRPCError(
      `datalink/update failed: '${datalinkName(String(path))}' does not exist.`,
    );
  }
  entry.content = JSON.stringify(value, null, 2);
  return toJSONRPCResult(null);
});
await labelRoute("datalink/delete", ({ path }) => {
  removeEntry(Path(String(path)));
  return toJSONRPCResult(null);
});
```

(import `type DatalinkEntry` from
`enso-common/src/services/ProjectManager/types`; add `addDatalink` and
`datalinkValue` to `api`; `labelRoute` is a generic POST helper despite its name
— rename it `projectServiceRoute` in the same edit.) In
`NewDataLinkModalActions.ts`, `locateNewDataLinkModal` filters by
`page.getByText(TEXT.createDatalink).or(page.getByText(TEXT.editDatalink))`.

- [ ] **Step 2: Write the specs.** `dashboard/localDatalinks.spec.ts`:

```ts
/**
 * @file Local datalinks: creating one from the toolbar and the context menu, opening and saving it,
 * and the plain-value rule for secret fields.
 */
import { Path } from "enso-common/src/services/Backend";
import { expect, test, type Page } from "integration-test/base";
import { TEXT } from "../actions";

const S3 = {
  type: "S3",
  libraryName: "Standard.AWS",
  uri: "s3://bucket/old",
  auth: { type: "aws_auth", subType: "default" },
};
const EXISTING = "Warehouse";

test.use({
  setupApi: {
    local: (localApi) =>
      localApi.addDatalink({
        path: Path(`${localApi.rootPath}/${EXISTING}.datalink`),
        value: S3,
      }),
  },
});

const rows = (page: Page) =>
  page.getByTestId("drive-view").getByRole("grid").getByTestId("asset-row");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const dialog = (page: Page, title: string) =>
  page.getByRole("dialog").filter({ hasText: title });
const uriInput = (page: Page, title: string) =>
  dialog(page, title).getByPlaceholder(TEXT.enterText).first();

test("create a datalink from the toolbar", async ({ drivePage, localApi }) => {
  await drivePage.goToCategory.local().do(async (page) => {
    await expect(row(page, EXISTING)).toBeVisible();
    await page.getByRole("button", { name: TEXT.newDatalink }).click();
    const created = dialog(page, TEXT.createDatalink);
    await created.getByPlaceholder(TEXT.datalinkNamePlaceholder).fill("Sales");
    await uriInput(page, TEXT.createDatalink).fill("s3://bucket/sales.csv");
    await created.getByRole("button", { name: TEXT.create }).click();
    await expect(created).toBeHidden();
    await expect(row(page, "Sales")).toBeVisible();
    expect(
      localApi.datalinkValue(`${localApi.rootPath}/Sales.datalink`),
    ).toMatchObject({
      type: "S3",
      uri: "s3://bucket/sales.csv",
    });
  });
});

test("create a datalink from the context menu", async ({
  drivePage,
  localApi,
}) => {
  await drivePage.goToCategory
    .local()
    // The directory's own menu: right-click the drive view below the rows (a datalink's row menu
    // has no "New …" entries, as for any non-folder asset).
    .withDriveView(async (view) => {
      const box = (await view.boundingBox())!;
      await view.click({
        button: "right",
        position: { x: 20, y: box.height - 20 },
      });
    })
    .contextMenu.newDataLink()
    .do(async (page) => {
      await dialog(page, TEXT.createDatalink)
        .getByPlaceholder(TEXT.datalinkNamePlaceholder)
        .fill("Menu");
      await uriInput(page, TEXT.createDatalink).fill("s3://bucket/menu.csv");
      await dialog(page, TEXT.createDatalink)
        .getByRole("button", { name: TEXT.create })
        .click();
      await expect(row(page, "Menu")).toBeVisible();
      expect(
        localApi.datalinkValue(`${localApi.rootPath}/Menu.datalink`),
      ).toBeDefined();
    });
});

test("open a datalink, edit it and save it", async ({
  drivePage,
  localApi,
}) => {
  await drivePage.goToCategory.local().do(async (page) => {
    await row(page, EXISTING).getByText(EXISTING).dblclick();
    const edited = dialog(page, TEXT.editDatalink);
    await expect(
      edited.getByPlaceholder(TEXT.datalinkNamePlaceholder),
    ).toHaveValue(EXISTING);
    await expect(uriInput(page, TEXT.editDatalink)).toHaveValue(
      "s3://bucket/old",
    );
    await uriInput(page, TEXT.editDatalink).fill("s3://bucket/new");
    await edited.getByRole("button", { name: TEXT.save }).click();
    await expect(edited).toBeHidden();
    await expect
      .poll(() =>
        localApi.datalinkValue(`${localApi.rootPath}/${EXISTING}.datalink`),
      )
      .toMatchObject({ uri: "s3://bucket/new" });
  });
});

test("secret fields take plain values only", async ({ drivePage }) => {
  await drivePage.goToCategory.local().do(async (page) => {
    await page.getByRole("button", { name: TEXT.newDatalink }).click();
    const created = dialog(page, TEXT.createDatalink);
    await created
      .getByRole("option", { name: "Postgres Database Connection" })
      .click();
    await expect(
      created.getByRole("option", { name: "Enso Secret" }),
    ).toHaveCount(0);
    await expect(
      created.getByText(TEXT.datalinkSecretsUnavailable).first(),
    ).toBeVisible();
    await expect(
      created.getByRole("option", { name: "Enso File" }),
    ).toHaveCount(0);
  });
});
```

`project-view/localDatalinkWidget.spec.ts`:

```ts
/**
 * @file The file widget picks a `.datalink` file. The native dialog cannot be driven, so its stand-in
 * (`window.api.fileBrowser`, mocked in `mock/registerMocks.ts`) records its filters and returns a
 * datalink.
 */
import { expect, test } from "integration-test/base";
import { mockMethodCallInfo } from "./expressionUpdates";
import * as locate from "./locate";

const LINK = "/home/user/enso/enso-projects/Sales.datalink";

test("the file widget sets a chosen .datalink path", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  await page.evaluate((link) => {
    const calls: unknown[][] = [];
    Object.assign(window, { __fileBrowserCalls: calls });
    window.api!.fileBrowser.openFileBrowser = async (...args: unknown[]) => {
      calls.push(args);
      return [link];
    };
  }, LINK);
  await mockMethodCallInfo(page, "data", {
    methodPointer: {
      module: "Standard.Base.Data",
      definedOnType: "Standard.Base.Data",
      name: "read",
    },
    notAppliedArguments: [0, 1, 2],
  });
  const pathArg = locate
    .graphNodeByBinding(page, "data")
    .locator(".WidgetTopLevelArgument")
    .filter({ hasText: "path" });
  await pathArg.click();
  await page.getByText("Choose file…").click();
  await expect(pathArg.getByTestId("widget-text-content")).toHaveText(LINK);
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __fileBrowserCalls: unknown[][] })
        .__fileBrowserCalls,
  );
  expect(calls).toHaveLength(1);
  // `Data.read`'s path has no file types here, so the dialog lists every file, datalinks included.
  expect(calls[0]![2]).toBeUndefined();
});
```

(If the mocked `window.api` property is non-writable, replace `openFileBrowser`
in `registerMocks.ts`'s `mockElectronApi` with a function delegating to
`window.__fileBrowserOverride ?? (async () => ['/path/to/some/mock/file'])` and
set that from the spec instead.)

- [ ] **Step 3: Run on Windows, then on Linux.**
      `corepack pnpm -r --if-present run compile`, then
      `corepack pnpm --dir app/gui exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/dashboard/localDatalinks.spec.ts integration-test/project-view/localDatalinkWidget.spec.ts`
      — before Tasks 21–26 land these fail (no `New Datalink` button enabled; no
      `datalink/*`); with them, 5 passed. On WSL:
      `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && corepack pnpm -r --if-present run compile && corepack pnpm --dir app/gui exec cross-env NODE_ENV=production playwright test --project="Integration Tests" --repeat-each=5 --workers=2 integration-test/dashboard/localDatalinks.spec.ts integration-test/project-view/localDatalinkWidget.spec.ts'`
      — 25 passed. Also rerun `integration-test/dashboard/accessibility.spec.ts`
      and `integration-test/project-view/widgets.spec.ts` (the toolbar's
      datalink button changes its accessible name and enabled state; update an
      aria snapshot only if it pins that button, with the reason in the PR).
- [ ] **Step 4: Lint.**
      `corepack pnpm --dir app/gui exec eslint integration-test/mock/localApi.ts integration-test/actions/NewDataLinkModalActions.ts integration-test/dashboard/localDatalinks.spec.ts integration-test/project-view/localDatalinkWidget.spec.ts`
      (floating promises are errors here), prettier `--check` on the same, and
      `corepack pnpm --dir app/gui run typecheck` (the specs are in
      `tsconfig.node.json`).
- [ ] **Step 5: Commit.**
      `git add app/gui/integration-test/mock/localApi.ts app/gui/integration-test/actions/NewDataLinkModalActions.ts app/gui/integration-test/dashboard/localDatalinks.spec.ts app/gui/integration-test/project-view/localDatalinkWidget.spec.ts`
      (plus `mock/registerMocks.ts` if Step 2's fallback was needed);
      `git commit -m "Integration tests: local datalinks in the drive and the file widget"`.

### Task 28: Verify and open the PR

**Files**

- Modify `CHANGELOG.md` (`# Next Release` → `#### Enso IDE`)

**Interfaces**

- Consumes: Tasks 20–27.
- Produces: the PR, with a changelog entry and so without the
  `CI: No changelog needed` label.

- [ ] **Step 1: Changelog.** Add under `#### Enso IDE`:
      `- [Datalinks work in the local drive: create and edit .datalink files, and pick them in the file widget][NNN]`
      with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` beside the
      section's other link definitions (`NNN` = the PR number, filled in once
      the PR exists, in a follow-up commit).
      `git add CHANGELOG.md && git commit -m "Changelog: local datalinks"`.
- [ ] **Step 2: Full verification** (spec "Verification (each PR)"), deleting
      caches first:
      `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete` and
      the same for `.eslintcache`; then
      `corepack pnpm -r --if-present run compile`;
      `corepack pnpm --dir app/gui run typecheck`;
      `corepack pnpm --dir app/gui run lint`;
      `corepack pnpm --dir app/project-manager-shim run lint`;
      `corepack pnpm --dir app/electron-client run lint`;
      `corepack pnpm exec prettier --check` on every touched file; unit tests
      `corepack pnpm --dir app/gui run test:unit`,
      `corepack pnpm --dir app/common run test:unit`,
      `corepack pnpm --dir app/project-manager-shim run test:unit`. The shim
      tests also on Linux:
      `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && corepack pnpm --dir app/project-manager-shim run test:unit'`
      (rename/permissions differ). The GUI Playwright suite on Linux (WSL),
      whole:
      `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && corepack pnpm --dir app/gui exec cross-env NODE_ENV=production playwright test --project="Integration Tests"'`,
      compared against `develop` for any failing spec before attributing it; the
      touched specs on Windows. The Electron package tests run in CI
      (`Package New IDE`, Linux and Windows).
- [ ] **Step 3: Screenshots.** Before (develop: the disabled "New Datalink
      (Exclusive to Cloud)" button) and after (enabled button; create dialog;
      edit dialog; a Postgres password with the "secrets are not available"
      note; a datalink row with its icon) — push to the orphan `pr-screenshots`
      branch and embed in the PR body.
- [ ] **Step 4: Open the PR** with
      `gh pr create --base develop --head feature/local-only-datalinks`. Body
      outline: **Summary** (spec decision 6; PR 2b of the local-only IDE);
      **What changes** — shim (`DatalinkEntry`, `datalink/*`, atomic writes),
      `LocalBackend` (ids, CRUD, rename keeps the extension, download/export as
      the file), editor (plain-value rule, edit mode, `FilePathInput` removed),
      drive (toolbar, context menu, double click/Enter/Edit), file widget
      filter; **Rulings** (update = `createDatalink` with `datalinkId`;
      `EnsoSecret`/`Enso File` hidden; unreadable datalinks open no editor; name
      read-only when editing; datalink filter on read dialogs); **Known
      limitations** — a `.datalink` uploaded through "Upload files" is listed as
      a datalink but `UploadedFile.id` is a `FileId`, so it is not auto-selected
      after the upload; secret values are stored in plain text by design until
      local secrets exist; **Tests** (new unit files, the two specs,
      `--repeat-each` result); **Screenshots**; **Installer checks** for the
      user: the spec's five checks, plus: create a datalink in a folder, reopen
      and save it, rename it and see `<new>.datalink` on disk, read it with
      `Data.read` in a project (an HTTP datalink to a public CSV), pick it in a
      `Data.read` file widget, export a folder containing it and find the file
      in the zip, open a hand-corrupted `.datalink` and get the error toast;
      `Closes #N` for the PR 2b ticket; the PR-description attribution footer.
- [ ] **Step 5: Merge gate.** Fill in `NNN`, push; merge only after green CI
      **and** the user's OK on the installer test.

## PR 3: remove the remote backend

Goal: delete `RemoteBackend` and everything that only exists to talk to it,
across `app/common`, `app/gui`, `app/project-manager-shim` and
`app/electron-client`, leaving `Backend`/`BackendType` with `LocalBackend` as
the only implementation (decision 3). Secrets methods stay (decision 5),
datalink methods stay (decision 6), the Versions tab keeps its local half
(decision 7), and `cloud-<projectId>/` folders become ordinary folders (decision
9). Branch: `feature/local-only-remove-remote-backend`, off `develop` after PR
2b has merged. PR rules: this PR removes code that PR 1 already made
unreachable, so it takes the `CI: No changelog needed` label, not a CHANGELOG
entry. It still touches UI files, so attach before/after screenshots of the
drive sidebar, a project's context menu and the Versions tab (they should match)
through the orphan `pr-screenshots` branch. It is part of the staged feature
(decision 2), so it waits for the user's installer test before merge.

Ordering rule for the tasks: consumers stop using a thing before the thing is
deleted, so every task's commit passes
`corepack pnpm -r --if-present run compile` and the GUI typecheck on its own.
Tasks 30–33 empty the GUI of `remoteBackend`; 34–35 do the same for Electron and
the shim; 36 deletes the remote modules; 37 trims `Backend.ts`; 38 removes
`BackendType.remote`.

**Ruling needed (the integration-test mock):** `app/gui/integration-test/` is
typechecked by `tsconfig.node.json`, and `integration-test/mock/cloudApi.ts`
(1585 lines, deleted in PR 4) imports `RemoteBackend/ids`, `remoteBackendPaths`
and about 60 `Backend` symbols, roughly half of which this PR deletes.
Recommended default: freeze them for the mock. Tasks 36 and 37 move the deleted
code into `app/gui/integration-test/mock/cloud/` (`git mv` for whole files; cut
and paste for the deleted `Backend.ts` declarations into
`mock/cloud/cloudTypes.ts`), behind a barrel `mock/cloud/backend.ts` that
`cloudApi.ts` and the specs import instead of `enso-common`. PR 4 deletes the
folder with `cloudApi.ts`. The alternative is to move PR 4's spec porting ahead
of this PR; that would make PR 3 bigger still and change the spec's order.

**Ruling needed (`BackendType.remote`): remove it.** The count on develop
(outside `src/cloud/`, which PR 2 deletes), with `ydoc-shared`'s unrelated
`'remote'` origin left out:

- About 22 production sites in 17 files: `providers/category.ts` (5),
  `providers/container.ts` (2), `providers/backends.ts`,
  `providers/rightPanel.ts`, `providers/openedProjects/projectStates.ts`,
  `utils/driveMutations.ts`, `utils/transferBetweenCategories.ts` (3, deleted in
  Task 30), `project-view/providers/asyncResources/resolve.ts`,
  `column/columnUtils.ts`, `column/ProjectNameColumn.vue`,
  `components/ProjectIcon.vue`, `DriveBar/DriveBarToolbar.vue`,
  `layouts/DriveView.vue`, `Drive/globalContextMenuEntries.ts`,
  `utils/testing/mountWithProviders.ts` (2), and `Backend.ts`
  (`projectSessionBackendType`).
- About 35 test sites in 12 files.
- None in the shim, Electron, the engine or the standard library.

Tasks 30–33 already edit every one of those production files, so by Task 38 the
remaining sites are tests and a few dead comparisons. The cascade stays inside
this PR. `BackendType` stays as `enum BackendType { local = 'local' }`, as
decision 3 asks, and is only a query-key and `backend.type` tag from then on.

**Backend.ts: deleted versus kept** (Task 37 carries this out):

- _Abstract methods deleted:_ `listUsers`, `createUser`, `updateUser`,
  `restoreUser`, `deleteUser`, `removeUser`, `uploadUserPicture`,
  `changeUserGroup`, `inviteUser`, `listInvitations`, `deleteInvitation`,
  `resendInvitation`, `acceptInvitation`, `declineInvitation`,
  `getOrganization`, `updateOrganization`, `uploadOrganizationPicture`,
  `createPermission`, `usersMe`, `undoDeleteAsset`, `createProjectExecution`,
  `getProjectExecutionDetails`, `updateProjectExecution`,
  `deleteProjectExecution`, `listProjectExecutions`, `listExecutionsSummary`,
  `syncProjectExecution`, `uploadImage`, `listAssetVersionTags`,
  `createUserGroup`, `deleteUserGroup`, `listUserGroups`,
  `createCheckoutSession`, `cancelSubscription`, `getLogEvents`, `logEvent`,
  `createCustomerPortalSession`, `getPaymentsConfig`, `listApiKeys`,
  `createApiKey`, `deleteApiKey`, `getMapboxToken`.
- _Methods kept:_
  - drive and projects: `rootPath`, `rootDirectoryId` (both lose their
    `user`/`organization` parameters), `listDirectory`, `searchDirectory`,
    `createDirectory`, `updateDirectory`, `updateAsset`, `deleteAsset`,
    `copyAsset`, `createProject`, `closeProject`, `duplicateProject`,
    `getProjectDetails`, `getAssetDetails`, `openProject`, `updateProject`,
    `getMainFileContent`, `resolveEnsoPath`, `resolveProjectAssetData`;
  - project sessions and logs: `listProjectSessions`, `getProjectSessionLogs`,
    `downloadProjectSessionLogs`;
  - local versions: `listAssetVersions`, `restoreAsset`;
  - files, upload and export: `uploadFileStart`, `uploadFileChunk`,
    `uploadFileEnd`, `updateFile`, `getFileDetails`, `download`,
    `exportArchive`;
  - datalinks: `createDatalink`, `getDatalink`, `deleteDatalink`, and whatever
    update method PR 2b added;
  - secrets: `createSecret`, `createCredential`, `getSecret`, `updateSecret`,
    `listSecrets`;
  - labels: `supportsLabels`, `createTag`, `listTags`, `associateTag`,
    `deleteTag`;
  - the protected HTTP helpers and `throw`.
- _Types and values deleted:_
  - users, organisations, groups and plans: `UserInfo`, `UserGroup`,
    `CognitoCredentials`, `Plan`, `PLANS`, `isPlan`, `OrganizationInfo`,
    `UserGroupInfo`;
  - billing: `CheckoutSession`, `Card`, `PaymentsConfig`, `Subscription`,
    `CreateCheckoutSessionRequestBody`, `PlanBillingPeriod`,
    `CreateCustomerPortalSessionResponse`;
  - permissions: `UserPermission`, `UserGroupPermission`, `AssetPermission`,
    `isUserPermission(And)`, `isUserGroupPermission(And)`,
    `getAssetPermissionName`, `getAssetPermissionId`, `compareAssetPermissions`,
    `CreatePermissionRequestBody`, and `Asset`'s `permissions` and `createdBy`
    fields;
  - responses and request bodies: `RemoteBackendError`, `ListApiKeysResponse`,
    `ListUsersResponseBody`, `ListTagsResponseBody`, `CreateUserRequestBody`,
    `UpdateUserRequestBody`, `ChangeUserGroupRequestBody`,
    `UpdateOrganizationRequestBody`, `InviteUserRequestBody`,
    `ListInvitationsResponseBody`, `Invitation`, `CreateUserGroupRequestBody`;
  - user helpers: `isUserOnPlanWithMultipleSeats`, `userHasUserAndTeamSpaces`;
  - audit log: `AuditLogEvent`, `EventType`, `EVENT_TYPES`, `EventMetadata`,
    `GetLogEventsRequestParams`;
  - API keys: `CreateApiKeyRequestBody`, `ApiKey`, `ApiKeyExpiresIn`,
    `API_KEY_EXPIRES_IN_VALUES`;
  - project executions and schedules: `PROJECT_PARALLEL_MODES` and the five
    `PARALLEL_MODE_*`/`PROJECT_EXECUTION_*` maps, `ProjectParallelMode`, every
    `ProjectExecution*` type, `CreateProjectExecutionRequestBody`,
    `UpdateProjectExecutionRequestBody`, `ListExecutionsRequestParams`,
    `ListExecutionsSummaryRequestParams`, the three `ExecutionUsageSummary*`
    types;
  - version tags and images: `UpdateAssetVersionTag`, `CreateTagRequestBody`'s
    cloud-only fields (if any), `S3ObjectVersion.tags`, `UploadedImages`,
    `UploadPictureRequestParams`;
  - hybrid projects: `OpenHybridProjectParameters`,
    `HYBRID_PROJECT_DIRECTORY_MASK`,
    `ProjectState.hybridOpenInProgress`/`hybridOpened`, and from
    `OpenProjectRequestBody` the `cognitoCredentials` and
    `openHybridProjectParameters` fields;
  - Mapbox: `MAPBOX_TOKEN_SCHEMA`, `MapboxToken`;
  - cloud paths: `projectSessionBackendType`, `isRemoteAssetPath`, and
    `organizationId` on `BaseProject`/`UpdatedProject`;
  - from `Backend/types.ts`: `OrganizationId`, `isOrganizationId`,
    `UserGroupId`, `isUserGroupId`, `ProjectExecutionId`, `SubscriptionId`,
    `ApiKeyId`, `Ami`, `UserPermissionIdentifier`, once nothing else uses them.
- _Kept:_
  - the asset model: `AssetType` and everything about assets (with `secret`;
    decision 5);
  - IDs: `UserId`, `EmailAddress`, `OtherUser`;
  - versions: `S3ObjectVersion`, `S3ObjectVersionId`, `AssetVersions` (local git
    versions use them; renaming them is the later tidy-up);
  - upload: the `Upload*`/`S3MultipartPart`/`S3FilePath` types `LocalBackend`'s
    upload uses;
  - datalinks and secrets: `Datalink*`, `Secret*`, `Credential*`,
    `CreateSecretRequestBody`, `CreateCredentialRequestBody`,
    `CredentialConfig`, `CredentialInput`, `isAssetCredential`;
  - labels: `Label`, `LChColor`, `COLORS` and the colour helpers;
  - the project types without `organizationId`, `ProjectSession*`,
    `UpdateAssetVersionComment`, and `NetworkError`/`NotAuthorizedError`.

**Ruling needed (`User`):** keep a minimal `User` in `Backend.ts`
(`{ readonly userId: UserId; readonly name: string; readonly email: EmailAddress }`,
the offline user's shape), because the local session, Settings and the
categories store still name a user. If PR 2 already gave the local session its
own user type, delete `Backend.User` instead and point its remaining users at PR
2's type.

### Task 30: Drive categories, transfers and uploads are local only

**Files:**

- Modify: `app/gui/src/providers/category.ts`,
  `app/gui/src/providers/upload.ts`,
  `app/gui/src/dashboard/layouts/Drive/driveActions.ts`,
  `app/gui/src/components/AppContainer/CategoryButton.vue`,
  `app/gui/src/dashboard/layouts/AssetContextMenu.vue`,
  `app/gui/src/dashboard/layouts/AssetsTableContextMenu.vue`,
  `app/gui/src/dashboard/layouts/DriveView.vue`,
  `app/gui/src/providers/rightPanel.ts`,
  `app/gui/src/configurations/inputBindings.ts`,
  `app/gui/src/dashboard/pages/dashboard/UserBar/NotificationTray/notifications.ts`,
  `app/gui/src/project-view/composables/upload.ts`,
  `app/gui/src/providers/__tests__/category.test.ts`,
  `app/gui/src/providers/__tests__/uploadFiles.test.ts`,
  `app/gui/src/dashboard/pages/dashboard/UserBar/__tests__/UserBar.test.ts`
- Create: `app/gui/src/composables/moveAssets.ts`,
  `app/gui/src/composables/__tests__/moveAssets.test.ts`
- Delete: `app/gui/src/utils/transferBetweenCategories.ts`,
  `app/gui/src/composables/transferBetweenCategories.ts`,
  `app/gui/src/composables/__tests__/transferBetweenCategories.test.ts`,
  `app/gui/src/providers/__tests__/upload.test.ts`

**Interfaces:**

- Consumes: PR 1's category lists (`cloudCategoriesList` empty or gone), and PR
  2's removal of `$/cloud/uploadToCloud` (PR 2 rewired
  `transferBetweenCategories` to compile without it).
- Produces:
  - `type Category = PredefinedCategory | LocalDirectory` with
    `PredefinedCategory = { type: 'local' | 'localRecent' }`;
  - `CATEGORY_BACKEND: Record<CategoryType, BackendType>` with local entries
    only;
  - `categoryFromKey('cloud' | 'recent' | 'trash' | 'team-…') === null`;
  - `dropOperationBetweenCategories(from, to, parentId?): 'cancel' | 'move'`;
  - `useMoveAssets(): (from: Category, to: Category, assets: Iterable<TransferrableAsset>, newParentId?: DirectoryId | null, method?: 'copy' | 'move') => Promise<unknown>`;
  - `UploadFilesContext` without `uploadToCloud`; no `useUploadsToCloudStore`,
    `createUploadsStore`, `UploadKind` or `OngoingUpload`.
  - `isCloudCategory` is gone.

- [ ] **Step 1: Write the failing tests.** In
      `providers/__tests__/category.test.ts`, replace the cloud cases with:

```ts
test("every category is local, and the removed cloud keys parse to nothing", () => {
  expect(Object.keys(CATEGORY_BACKEND).sort()).toEqual([
    "local",
    "localDirectory",
    "localRecent",
  ]);
  for (const value of Object.values(CATEGORY_BACKEND))
    expect(value).toBe(BackendType.local);
  for (const key of ["cloud", "recent", "trash", "team-usergroup-a"]) {
    expect(categoryFromKey(key)).toBeNull();
  }
});

test("dropping moves between local folders, and cancels into the same folder or Recent", () => {
  const dir: Category = { type: "localDirectory", path: Path("/a") };
  expect(dropOperationBetweenCategories({ type: "local" }, dir)).toBe("move");
  expect(dropOperationBetweenCategories(dir, dir)).toBe("cancel");
  expect(
    dropOperationBetweenCategories(dir, dir, newDirectoryId(Path("/a/b"))),
  ).toBe("move");
  expect(dropOperationBetweenCategories(dir, { type: "localRecent" })).toBe(
    "cancel",
  );
});
```

Create `composables/__tests__/moveAssets.test.ts`, mocking
`$/providers/backends` with `mockBackends({ localBackend: local })`, where
`local` has `copyAsset`/`updateAsset` `vi.fn`s, and mocking
`$/providers/category`'s `useCategories` so `{ type: 'local' }` maps to
`directory-local-root`, with the deleted `transferBetweenCategories.test.ts`'s
`setup()` helper (a `defineComponent` probe that calls `useMoveAssets()` in
`setup`, mounted with `mountWithProviders`):

```ts
test("moving into a local folder updates each asset’s parent on the local backend", async () => {
  const move = await setup();
  await move({ type: "local" }, LOCAL_DIR, [asset("file-a")], null, "move");
  expect(local.updateAsset).toHaveBeenCalledWith(
    "file-a",
    expect.objectContaining({ parentDirectoryId: LOCAL_DIR_ID }),
    "file-a",
  );
});
test("copy asks the local backend to copy", async () => {
  const move = await setup();
  await move({ type: "local" }, LOCAL_DIR, [asset("file-a")], null, "copy");
  expect(local.copyAsset).toHaveBeenCalledWith("file-a", LOCAL_DIR_ID);
});
test("a drop into Recent does nothing", async () => {
  const move = await setup();
  await move({ type: "local" }, { type: "localRecent" }, [asset("file-a")]);
  expect(local.updateAsset).not.toHaveBeenCalled();
});
```

In `uploadFiles.test.ts`, drop `uploadToCloud` from `context()` and delete the
cloud cases.

- [ ] **Step 2: Run them.** Run
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/category.test.ts src/composables/__tests__/moveAssets.test.ts`.
      Expected: the category tests fail (`categoryFromKey('cloud')` returns
      `{ type: 'cloud' }`), and `moveAssets.test.ts` fails to import
      `$/composables/moveAssets`.
- [ ] **Step 3: Implement `category.ts`.**
  - Delete `TeamDirectory`, `TEAM_CATEGORY_KEY_PREFIX`, the
    `cloud`/`recent`/`trash`/`team` cases in `categoryKey`, `categoryFromKey`,
    `categoryIcon`, `categoryLabel`, `categoryDirectoryId` and
    `categoryRootPath`, and `cloudCategoriesList` with its consumers.
  - Delete `isCloudCategory`, and the
    `isUserGroupId`/`UserGroupId`/`organizationIdToDirectoryId` imports.
  - `createCategoriesStore` takes no `userData`.
  - `isRecentCategory` becomes `type === 'localRecent'`.
  - `dropOperationBetweenCategories` becomes:

```ts
export function dropOperationBetweenCategories(
  from: Category,
  to: Category,
  parentId: DirectoryId | null = null,
): "cancel" | "move" {
  if (categoryEq(from, to) && parentId == null) return "cancel";
  if (isRecentCategory(to) || isRecentCategory(from)) return "cancel";
  return "move";
}
```

- [ ] **Step 4: Create `composables/moveAssets.ts`.**

```ts
/** @file Moving or copying assets between the local drive's folders, with the app's stores. */
export function useMoveAssets() {
  const queryClient = useQueryClient();
  const backends = useBackends();
  const categories = useCategories();
  return async (
    from: Category,
    to: Category,
    assets: Iterable<TransferrableAsset>,
    newParentId: DirectoryId | null = null,
    method: "copy" | "move" = "move",
  ): Promise<unknown> => {
    if (dropOperationBetweenCategories(from, to, newParentId) === "cancel")
      return;
    const target = newParentId ?? categories.categoryDirectoryId(to);
    const { localBackend } = backends;
    if (target == null || localBackend == null) return;
    const ids = Array.from(assets, (asset) => asset.id);
    return method === "copy"
      ? executeMutation(queryClient, copyAssetsMutationOptions(localBackend), [
          ids,
          target,
        ])
      : executeMutation(
          queryClient,
          moveAssetsMutationOptions(localBackend, resolveDuplications),
          [ids, target],
        );
  };
}
```

- [ ] **Step 5: Rewire the callers and delete the cloud upload.**
  - `CategoryButton.vue` and `driveActions.ts` call `useMoveAssets()` in place
    of `useTransferBetweenCategories()`.
  - Delete `driveActions.ts`'s cloud-to-local download action (its line 235
    call) and its `useUploadsToCloudStore` uses.
  - Run
    `git rm app/gui/src/utils/transferBetweenCategories.ts app/gui/src/composables/transferBetweenCategories.ts app/gui/src/composables/__tests__/transferBetweenCategories.test.ts app/gui/src/providers/__tests__/upload.test.ts`.
  - In `providers/upload.ts`, delete `createUploadsStore`,
    `useUploadsToCloudStore`, `UploadKind`, `OngoingUpload`, `RETRIES`,
    `CLEAR_PROGRESS_DELAY_MS` and `UploadFilesContext.uploadToCloud`.
    `uploadFiles` always calls `uploadLocally`.
  - `project-view/composables/upload.ts`'s `useUpload` returns
    `useUploadLocally(backend)`.
  - `notifications.ts` drops its uploads entries.
  - Delete the `uploadToCloud` menu entries in `AssetContextMenu.vue` and
    `AssetsTableContextMenu.vue` (if PR 1 left them), the `uploadToCloud`
    binding in `inputBindings.ts`, and the `isCloudCategory` branches in
    `DriveView.vue`, `rightPanel.ts` and the Versions tab (Task 32 rewrites the
    rest of that tab).
  - `git grep -nE "isCloudCategory|useUploadsToCloudStore|uploadToCloud|transferBetweenCategories|TeamDirectory|'team'|'trash'" -- app/gui/src`
    must come back empty, apart from unrelated text ids in `english.json`.
- [ ] **Step 6: Run the tests.**
      `corepack pnpm --dir app/gui exec vitest run src/providers src/composables src/dashboard src/components`,
      then `corepack pnpm --dir app/gui run typecheck`. Expected: all pass, and
      the typecheck reports 0 errors.
- [ ] **Step 7: Commit.** Run
      `git add -A app/gui/src && git commit -m "Drive categories, transfers and uploads are local only"`.

### Task 31: Projects open only locally: no hybrid or cloud states, local welcome project

**Files:**

- Modify:
  - project state: `app/gui/src/providers/openedProjects/projectStates.ts`,
    `app/gui/src/providers/openedProjects/projectInfo.ts`,
    `app/gui/src/providers/openedProjects.ts`;
  - tabs and routing: `app/gui/src/providers/container.ts`,
    `app/gui/src/providers/featureFlags.ts`,
    `app/gui/src/components/AppContainer/TabBar.vue`,
    `app/gui/src/router/dashboardGuards.ts`;
  - resources and logs: `app/gui/src/project-view/providers/asyncResources.ts`,
    `app/gui/src/project-view/providers/asyncResources/resolve.ts`,
    `app/gui/src/project-view/providers/asyncResources/upload.ts`,
    `app/gui/src/project-view/providers/asyncResources/AsyncResource.ts`,
    `app/gui/src/components/ProjectLog/projectLogData.ts`;
  - tests: `app/gui/src/router/__tests__/dashboardGuards.test.ts`,
    `app/gui/src/providers/openedProjects/__tests__/closeProject.test.ts`.
- Create: `app/gui/src/providers/openedProjects/__tests__/projectInfo.test.ts`

**Interfaces:**

- Consumes: Task 30's `providers/upload.ts`, which no longer exports
  `useUploadsToCloudStore`.
- Produces:
  - `ProjectInfo['mode']` is `'local'`, and `RunMode = 'local'`;
  - `RUNNING_PROJECT_INFO_SCHEMA = PROJECT_INFO_SCHEMA`, with no hybrid fields;
  - `ProjectState` (the GUI union) has no `HybridOpened`, `HybridDownloaded`,
    `HybridLocallyClosed` or `HybridUploaded`;
  - `welcomeProjectPath(cliStartupProject: string | undefined, backends: { localBackend: BackendAPI<LocalBackend> | null }): Promise<string | undefined>`;
  - `useResourceUpload(openedProjects, queryClient)` has no cloud branch.

- [ ] **Step 1: Write the failing tests.** Create `projectInfo.test.ts`:

```ts
import {
  PROJECT_INFO_SCHEMA,
  RUNNING_PROJECT_INFO_SCHEMA,
} from "../projectInfo";
import { expect, test } from "vitest";

const info = {
  id: "project-/root/P",
  parentId: "directory-/root",
  title: "P",
  ensoPath: "/root/P",
};

test("a project runs only locally", () => {
  expect(
    RUNNING_PROJECT_INFO_SCHEMA.safeParse({ ...info, mode: "local" }).success,
  ).toBe(true);
  for (const mode of ["cloud", "hybrid"]) {
    expect(PROJECT_INFO_SCHEMA.safeParse({ ...info, mode }).success).toBe(
      false,
    );
  }
});
```

In `dashboardGuards.test.ts`, drop `USER`, `Plan` and `remoteBackend` from
`mockBackends`, and replace the plan tables with:

```ts
test("a fresh install opens the local welcome project", async () => {
  expect(await welcomeProjectPath(undefined, mockBackends())).toBe(
    LOCAL_WELCOME_PROJECT,
  );
});
test("a local home with more than Samples opens nothing", async () => {
  const home = [{ type: AssetType.project, title: "Mine" }];
  expect(
    await welcomeProjectPath(undefined, mockBackends(home)),
  ).toBeUndefined();
});
test("a project named on the command line opens from the local root", async () => {
  expect(await welcomeProjectPath("Name", mockBackends())).toBe(
    `${LOCAL_ROOT_PATH}/Name`,
  );
  expect(
    await welcomeProjectPath(
      "file:///home/user/Name.enso-project",
      mockBackends(),
    ),
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run them.** Run
      `corepack pnpm --dir app/gui exec vitest run src/providers/openedProjects/__tests__/projectInfo.test.ts src/router/__tests__/dashboardGuards.test.ts`.
      Expected: `projectInfo` fails (`cloud` and `hybrid` parse), and
      `dashboardGuards` fails with `TypeError` (the old third parameter is
      undefined).
- [ ] **Step 3: Implement.**
  - **`projectInfo.ts`:** `mode: z.literal('local')`. Delete
    `RUNNING_NATIVE_PROJECT_INFO_SCHEMA`/`RUNNING_HYBRID_PROJECT_INFO_SCHEMA`,
    and export `RUNNING_PROJECT_INFO_SCHEMA = PROJECT_INFO_SCHEMA`.
  - **`projectStates.ts`:**
    - Delete the four hybrid interfaces and their union members, and
      `openRemoteProject`, `closeRemoteProject`
      (`backendMutationOptions(…, backends.remoteBackend)`).
    - Delete the `'cloud'` and `'hybrid'` cases of `openProject`, and
      `downloadHybridProject`, `openLocalVersionOfHybridProject*`,
      `reopenLocalVersionOfHybridProject` and `uploadHybridProject`.
    - Delete the `'cloud'`/`'hybrid'` cases in `getProjectDetails` (around
      line 496) and close (around line 594), the `hybridNotSynced` logic (around
      730), the `useUploadsToCloudStore` use and
      `networkMode: backend.type === BackendType.remote ? …` (it becomes
      `'always'`).
    - `openProject` is non-overloaded:
      `(project: NotOpened) => Promise<Result<Opened>>`.
    - `openProject` mutation bodies become `{ executeAsync: false }` once Task
      37 trims `OpenProjectRequestBody`. Until then pass
      `cognitoCredentials: null, openHybridProjectParameters: null`.
  - **`openedProjects.ts`:** delete the hybrid sync loop (around lines 298–315).
  - **`container.ts`:**
    - `useModesForBackend` becomes
      `locally: { [BackendType.local]: backends.localBackend != null ? 'local' : null }`,
      with `natively` the same.
    - Delete the `enableCloudExecution`/`Plan` check, and the `'hybrid-closed'`
      case at line 307.
    - Delete `enableCloudExecution` from `featureFlags.ts`.
    - Persisted `openedTabs` with a cloud or hybrid `runningProject` now fail
      the schema, and the app starts with no restored tabs. That is accepted: PR
      1 already stops creating such entries, and the next close rewrites the
      key.
  - **`TabBar.vue`:** drop the `mode === 'cloud'` branch.
  - **`dashboardGuards.ts`:**
    - Delete `CLOUD_WELCOME_PROJECT_RELATIVE_PATH`, the `user`/`remoteBackend`
      parameters and the `isRemoteAssetPath` branch of `redirectFromPath` (it
      always uses `localBackend`).
    - `shouldOpenWelcomeProject(localBackend)` lists only the local home.
    - In `openTab`, `isLocalProjectId(id) ? localBackend : remoteBackend`
      becomes `localBackend`.
  - **`resolve.ts` and `asyncResources.ts`:** delete the `remoteBackend` context
    field and the "unopened remote project" branch (around lines 68 and 140).
    `useResourceUpload` drops its `backend: RemoteBackend` parameter,
    `uploadResourceToCloud` and the `uploading: 'remote'` path.
    `AsyncResource.ts` drops the `'remote'` value of `uploading` and
    `remoteUploadFinished`.
  - **`projectLogData.ts`:** use `backends.localBackend` instead of
    `backendForType(projectSessionBackendType(…))`.
  - `git grep -nE "hybrid|Hybrid|mode === 'cloud'|enableCloudExecution|remoteUploadFinished" -- app/gui/src`
    must come back empty.
- [ ] **Step 4: Run the tests.**
      `corepack pnpm --dir app/gui exec vitest run src/providers src/router src/project-view/providers src/components`,
      then `corepack pnpm --dir app/gui run typecheck`. Expected: pass, with 0
      errors.
- [ ] **Step 5: Commit.** Run
      `git add -A app/gui/src && git commit -m "Open projects only locally: drop hybrid and cloud project states"`.

### Task 32: Versions tab without its cloud branches; Schedule tab removed

**Files:**

- Modify:
  - in `app/gui/src/versions/` (PR 2's location): `AssetVersions.vue`,
    `AssetVersion.vue`, `AssetVersionList.vue`, `queries.ts`, `version.ts`,
    `rightPanel.ts`, `CLAUDE.md`, `__tests__/AssetVersions.test.ts`;
  - elsewhere: `app/gui/src/providers/rightPanel.ts`,
    `app/gui/src/providers/rightPanelContributions.ts`,
    `app/gui/src/providers/__tests__/rightPanelContributions.test.ts`,
    `app/gui/src/components/AppContainer/RightPanel.vue`.
- Delete:
  - in `app/gui/src/versions/`: `AddVersionTag.vue`,
    `NewProjectExecutionForm.vue`, `ProjectExecution.vue`,
    `ProjectExecutionsCalendar.vue`, `ProjectExecutionsCalendarContent.vue`,
    `schedule.ts`, `__tests__/ProjectExecutionsCalendar.test.ts`;
  - `app/gui/src/dashboard/layouts/Settings/__tests__/cloudTabs.test.ts`, if PR
    2 left it.

**Interfaces:**

- Consumes: PR 2's `app/gui/src/versions/` and its core registration (here
  called `registerVersionsTabs`; use PR 2's name); Task 30's categories (local
  only).
- Produces:
  - `ContributedRightPanelTab = 'settings' | 'versions'`, and
    `registerVersionsTab()` contributes only `versions`;
  - `AssetVersions.vue` reads versions from `useBackends().localBackend` only;
  - `queries.ts` has no `versionTagsQueryOptions`, `useAddVersionTag` or
    `useRemoveVersionTag`.

- [ ] **Step 1: Write the failing tests.** In `rightPanelContributions.test.ts`,
      replace the `executionsCalendar` case with:

```ts
test("only Settings and Versions can be contributed", () => {
  expectTypeOf<ContributedRightPanelTab>().toEqualTypeOf<
    "settings" | "versions"
  >();
});
```

In `AssetVersions.test.ts`:

- make the default `backend` fixture the local backend (`type: 'local'`, no
  `listAssetVersionTags`);
- delete "a cloud project: lists its versions from the cloud" and "a hybrid
  project…", and the cloud tag tests under "the list";
- in "in a project tab", add:

```ts
test("the opened project’s versions come from the local backend, without asset details", async () => {
  await mountVersions({
    openedProject: { id: LOCAL_PROJECT_ID, mode: "local" },
  });
  expect(localBackend.listAssetVersions).toHaveBeenCalledWith(LOCAL_PROJECT_ID);
  expect(localBackend.getAssetDetails).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them.** Run
      `corepack pnpm --dir app/gui exec vitest run src/providers/__tests__/rightPanelContributions.test.ts src/versions`
      and `corepack pnpm --dir app/gui run typecheck` (vue-tsc checks the
      `expectTypeOf` assertion; vitest alone does not). Expected: the type
      assertion fails (`'executionsCalendar'` is still in the union), and the
      fixture change fails while `AssetVersions.vue` still reads
      `remoteBackend`.
- [ ] **Step 3: Implement.**
  - Run
    `git rm app/gui/src/versions/AddVersionTag.vue app/gui/src/versions/NewProjectExecutionForm.vue app/gui/src/versions/ProjectExecution.vue app/gui/src/versions/ProjectExecutionsCalendar.vue app/gui/src/versions/ProjectExecutionsCalendarContent.vue app/gui/src/versions/schedule.ts app/gui/src/versions/__tests__/ProjectExecutionsCalendar.test.ts`.
  - `rightPanel.ts` (versions) drops the `executionsCalendar` contribution.
  - `providers/rightPanel.ts` drops the `executionsCalendar` tab definition
    (around line 136) and its plan check.
  - `RightPanel.vue` drops the `'executionsCalendar'` case, and
    `rightPanelContributions.ts` drops it from the union.
  - **`AssetVersions.vue`:**
    - `openedProject` resolves to `{ id, backend: localBackend ?? null }`.
    - Delete the `isCloudCategory(category)` branch (around line 143), the
      cloud/hybrid `getAssetDetails` fetch and the "outside the cloud"
      placeholder.
    - Every route goes through `localProjectState`.
  - **`AssetVersion.vue`:** delete `hasTags`, `tagsQuery`, `removeVersionTag`,
    `<AddVersionTag>` and the `onDelete` of tags. `VersionTag.vue` stays for
    "Latest".
  - **`queries.ts`:** delete `versionTagsQueryOptions`, `mapVersionTags`,
    `useUpdateVersionTag`, `useAddVersionTag` and `useRemoveVersionTag`.
    `version.ts` keeps `tags` for "Latest".
  - Rewrite `versions/CLAUDE.md`: drop the Schedule tab and the cloud/hybrid
    bullets, and the note that the cloud mock has no versions endpoint. It now
    describes a local-only tab.
  - Also delete `preferredTimeZone` if nothing else reads it once `schedule.ts`
    is gone: `git grep -n preferredTimeZone -- app/gui/src` (it registers in
    `App.vue` and is used by `SettingsPage.vue`, so expect it to stay).
  - `git grep -nE "executionsCalendar|ProjectExecution|listAssetVersionTags|AddVersionTag" -- app/gui/src`
    must come back empty.
- [ ] **Step 4: Run the tests.** Run
      `corepack pnpm --dir app/gui exec vitest run src/versions src/providers src/components`,
      then `corepack pnpm --dir app/gui run typecheck`. Expected: pass, with 0
      errors.
- [ ] **Step 5: Commit.** Run
      `git add -A app/gui/src && git commit -m "Versions tab: drop the cloud's tags and the Schedule tab"`.

### Task 33: The GUI has only the local backend

**Files:**

- Modify:
  - providers: `app/gui/src/providers/backends.ts`,
    `app/gui/src/providers/auth.ts`, `app/gui/src/providers/session.ts`,
    `app/gui/src/providers/drive.ts`, `app/gui/src/providers/mapboxToken.ts`;
  - app shell and settings: `app/gui/src/components/AppContainerLayout.vue`,
    `app/gui/src/components/AppContainer/LeftPanel.vue`,
    `app/gui/src/components/DashboardPage.vue`,
    `app/gui/src/configurations/settings.ts`,
    `app/gui/src/dashboard/layouts/Settings/SettingsPage.vue`,
    `app/gui/src/dashboard/layouts/Settings/tabs.ts`;
  - drive: `app/gui/src/dashboard/layouts/DriveView.vue`,
    `app/gui/src/dashboard/layouts/AssetContextMenu.vue`
    (`TEAMS_DIRECTORY_ID`/`USERS_DIRECTORY_ID`),
    `app/gui/src/dashboard/layouts/AssetsTable.vue` (`RemoteBackend/ids`);
  - project view: `app/gui/src/project-view/composables/backend.ts`,
    `app/gui/src/project-view/components/widgets/FileBrowserWidget.vue`;
  - test utilities: `app/gui/src/utils/testing/mountWithProviders.ts`,
    `app/gui/src/utils/testing/__tests__/mountWithProviders.test.ts`, and every
    test that passes `remoteBackend` to `mockBackends`/`mountWithProviders`
    (find them with `git grep -ln "remoteBackend" -- app/gui/src`).

**Interfaces:**

- Consumes: Tasks 30–32; PR 1's `useMapboxToken` reading the setting; PR 2's
  reduced `auth.ts`.
- Produces:
  - `useBackends(): { localBackend: LocalBackend | null; backendForType(type: BackendType): LocalBackend }`,
    which throws an `invariant` when `localBackend` is null;
  - `useBackend(): { query, fetch, ensureQueryData, mutation }`, with no `which`
    argument and the local backend;
  - `mockBackends({ localBackend? })`;
  - `UserSession`/`SettingsBaseContext` have no `isCloudDataUnavailable`,
    `organization` or `backend: RemoteBackend`.

- [ ] **Step 1: Write the failing test.** In
      `utils/testing/__tests__/mountWithProviders.test.ts`, replace the remote
      cases with:

```ts
test("the backends store holds only the local backend", () => {
  const backends = mockBackends({
    localBackend: { rootPath: () => Path("/r") },
  });
  expect(Object.keys(backends)).not.toContain("remoteBackend");
  expect(backends.backendForType(BackendType.local)).toBe(
    backends.localBackend,
  );
});
```

- [ ] **Step 2: Run it.** Run
      `corepack pnpm --dir app/gui exec vitest run src/utils/testing/__tests__/mountWithProviders.test.ts`.
      Expected: FAIL, because `remoteBackend` is a key.
- [ ] **Step 3: Implement.**
  - **`backends.ts`:** delete the `RemoteBackend` construction,
    `downloadCloudProject`, `getProjectArchive`, both `watch`es on
    `ENSO_IDE_API_URL`, the remote `setGetText`, the
    `useConfig`/`HttpClient`/`DirectoryId`/`extractIdFromDirectoryId` imports
    and the `remote` case. Return `proxyRefs({ localBackend, backendForType })`.
  - **`mountWithProviders.ts`:** `mockBackends` takes `{ localBackend? }` only.
    Update its callers.
  - **`isCloudDataUnavailable`:**
    - In the offline session it is always `true`, so keep the `true` branch and
      delete the flag.
    - `LeftPanel.vue:57` keeps its branch body unconditionally.
    - Delete `DashboardPage.vue`'s organisation query (`enabled` was always
      false), `AppContainerLayout.vue`'s `cloudDataUnavailable` and the
      `remoteBackend.logEvent` `open_app`/`close_app` calls (lines 48, 116–118).
    - `DriveView.vue:77` loses the condition, and `drive.ts:59`'s branch goes
      (it needed `!isAuthDisabled`).
    - Delete `tabs.ts:115`'s tab, the field from `configurations/settings.ts`
      and `SettingsPage.vue`, and every `isCloudDataUnavailable:` key in the
      Settings tests.
  - **`SettingsPage.vue`:** delete `organizationQuery`, `updateUserMutation`,
    `updateOrganizationMutation` and the `backend`/`organization`/`updateUser`/
    `updateOrganization`/`changePassword` context fields that PR 2 left,
    together with their declarations in `configurations/settings.ts`. Delete
    those tabs' tests (`accountTab.test.ts`, `organizationTabs.test.ts`,
    `billingTab.test.ts`) if PR 2 left them.
  - **`auth.ts`/`session.ts`:** delete any `remoteBackend`, `usersMe`,
    `createUser`, `updateUser`, `deleteUser` or `restoreUser` use that PR 2
    left.
  - **`mapboxToken.ts`:** delete `createMapboxTokenStore` if PR 1 left it.
  - **`project-view/composables/backend.ts`:** `useBackend()` uses
    `localBackend`. Update `FileBrowserWidget.vue` (`useBackend('remote')`
    becomes `useBackend()`).
  - **`AssetContextMenu.vue`/`AssetsTable.vue`:** delete the Users/Teams
    virtual-directory branches and the `RemoteBackend/ids` import.
  - `git grep -nwE "RemoteBackend|remoteBackend|isCloudDataUnavailable" -- app/gui/src`
    must come back empty.
- [ ] **Step 4: Run the tests.** Run
      `corepack pnpm --dir app/gui exec vitest run`, then
      `corepack pnpm --dir app/gui run typecheck`, then
      `corepack pnpm --dir app/gui exec eslint src --max-warnings=0`. Expected:
      all green.
- [ ] **Step 5: Commit.** Run
      `git add -A app/gui/src && git commit -m "GUI: the local backend is the only backend"`.

### Task 34: Electron and the dev middleware: no remote backend, cloud routes or project watcher

**Files:**

- Modify: `app/electron-client/src/index.ts`,
  `app/electron-client/src/server.ts`,
  `app/gui/project-manager-shim-middleware/index.ts`,
  `app/common/src/services/LocalBackend.ts`
- Delete: `app/electron-client/src/backend.ts`,
  `app/electron-client/src/assetManagement.ts`,
  `app/electron-client/tests/headless/writeFile.test.ts` (`test.skip`'d,
  cloud-only, imports `RemoteBackend`)

**Interfaces:**

- Consumes: PR 2's Electron changes. PR 2 deletes `src/authentication.ts`, which
  `backend.ts` imports (`getUpToDateAccessToken`), so PR 2 may already have
  removed or stubbed `createRemoteBackend`. Delete whatever is left.
- Produces:
  - `--headless --startup.project <path>` runs only local projects. An `enso:`
    URL exits 1 with "Cloud projects are not supported; pass a local project
    path.";
  - `LocalBackend` has no `startWatchingHybridProject`,
    `stopWatchingHybridProject` or `getStateOfWatchedHybridProject`;
  - neither server routes `/api/watcher/*`, `/api/cloud/download-project` or
    `/api/cloud/get-project-archive`.

- [ ] **Step 1: Write the failing check.** The headless entry point runs at
      import time (`await app.run()`), so no unit test can reach it. The check
      is the grep that ends Step 3. Before the change, run
      `git grep -nE "createRemoteBackend|runHybridProjectByUrl|handleWatcherRequest|isWatcherRequest|downloadCloudProject|httpCloud|/cloud/|WatchingHybridProject" -- app/electron-client/src app/gui/project-manager-shim-middleware app/common/src`.
      Expected: hits in `index.ts`, `backend.ts`, `server.ts`,
      `assetManagement.ts`, the middleware and `LocalBackend.ts`.
- [ ] **Step 2: Implement `index.ts`.** Replace the `enso:` branch (around lines
      541–556) with:

```ts
      if (projectToOpen.startsWith(`${DEEP_LINK_SCHEME}:`)) {
        console.error('Cloud projects are not supported; pass a local project path.')
        return this.exit(1)
      } else if (projectToOpen) {
```

Drop `runHybridProjectByUrl`, `createRemoteBackend` and `EnsoPath` from the
imports (if PR 2 deleted `DEEP_LINK_SCHEME`, test
`projectToOpen.startsWith('enso:')` inline instead).

- [ ] **Step 3: Implement the servers and `LocalBackend`.**
  - Run
    `git rm app/electron-client/src/backend.ts app/electron-client/src/assetManagement.ts app/electron-client/tests/headless/writeFile.test.ts`.
  - **`server.ts`:** delete the `watchers` field (line 188), the
    `isWatcherRequest` branch (around line 292), the `/cloud/download-project`
    and `/cloud/get-project-archive` cases (299–306), `httpCloudDownloadProject`
    and `httpCloudGetProjectArchive` (around 468–535), and the `Watcher`,
    `handleWatcherRequest`, `isWatcherRequest` and `downloadCloudProject`
    imports.
  - **The middleware's `index.ts`:** delete the `/api/cloud/` block (lines
    124–200), the `watchers` field, the watcher branch (215–216) and their
    imports.
  - **`LocalBackend.ts`:** delete the three
    `*WatchedHybridProject`/`*WatchingHybridProject` methods (lines 1066–1126).
  - Re-run the Step 1 grep. Expected: empty, apart from a line that rejects
    `enso:` in `index.ts`.
- [ ] **Step 4: Run the checks.** Run
      `corepack pnpm --dir app/electron-client run typecheck`,
      `corepack pnpm --dir app/common run typecheck`,
      `corepack pnpm --dir app/gui run typecheck` and
      `corepack pnpm --dir app/electron-client exec vitest run`. Expected: 0
      errors, and the remaining headless tests pass.
- [ ] **Step 5: Commit.** Run
      `git add -A app/electron-client app/gui/project-manager-shim-middleware app/common/src/services/LocalBackend.ts && git commit -m "Electron: headless runs local projects only; drop cloud routes and the project watcher"`.

### Task 35: Shim: no hybrid open, cloud environment, watcher or cloud upload

**Files:**

- Modify:
  - `app/project-manager-shim/src/runProjects.ts`,
    `app/project-manager-shim/src/projectService/index.ts`,
    `app/project-manager-shim/src/handler/projectService.ts`,
    `app/project-manager-shim/src/handler/index.ts`;
  - `app/project-manager-shim/package.json` (drop the `./fs` export and
    `chokidar`), and `pnpm-lock.yaml` through `corepack pnpm install`;
  - `app/common/src/services/ProjectManager/types.ts` (`CloudParams`, `cloud?`),
    `app/common/src/services/ProjectManager/ProjectManager.ts`,
    `app/common/src/services/LocalBackend.ts` (`openProject`'s hybrid spread),
    `app/common/src/services/__test__/LocalBackend.recent.test.ts`;
  - `app/project-manager-shim/src/handler/__tests__/projectService.test.ts`,
    `app/project-manager-shim/CLAUDE.md`, `app/common/CLAUDE.md` (the "except a
    hybrid project's" line).
- Delete: `app/project-manager-shim/src/handler/watcher.ts`,
  `app/project-manager-shim/src/upload.ts`,
  `app/project-manager-shim/src/fs.ts`,
  `app/project-manager-shim/src/__tests__/fs.test.ts`

**Interfaces:**

- Consumes: Task 34, which leaves no importers of `handleWatcherRequest`,
  `project-manager-shim/fs` or `runHybridProjectByUrl`.
- Produces:
  - `ProjectService.runProject(projectId, projectsDirectory)` and
    `ProjectService.openProject(projectId, projectsDirectory)`, with no `cloud`
    parameter;
  - `projectEnvVars` always returns
    `ENSO_LOCAL_PROJECT_ID`/`ENSO_LOCAL_PROJECT_SESSION_ID`;
  - `runLocalProjectByUuid(projectId, projectsDirectory)`;
  - `LocalBackend.openProject` always records the project as recent.

- [ ] **Step 1: Write the failing tests.** In
      `handler/__tests__/projectService.test.ts`:

```ts
describe("project/open", () => {
  test("a stray `cloud` parameter is ignored", async () => {
    const open = vi
      .spyOn(projectService, "openProject")
      .mockResolvedValue({} as never);
    await call("project/open", {
      projectId: "id-1",
      projectsDirectory: root,
      cloud: { cloudProjectId: "x", cloudApiUrl: "https://example.com" },
    });
    expect(open).toHaveBeenCalledExactlyOnceWith("id-1", root);
  });
});
```

In `LocalBackend.recent.test.ts`, replace "records nothing for a hybrid open"
with:

```ts
it("records every successful open", async () => {
  vi.spyOn(projectManager, "openProject").mockResolvedValue(
    {} as Awaited<ReturnType<ProjectManager["openProject"]>>,
  );
  await makeBackend().openProject(PROJECT_ID, { executeAsync: false }, "P1");
  expect(projectManager.recordRecentProject).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run them.** Run
      `corepack pnpm --dir app/project-manager-shim exec vitest run src/handler/__tests__/projectService.test.ts`.
      Expected: FAIL, because the spy is called with 3 arguments. The
      `LocalBackend` case passes already; it keeps the behaviour pinned once the
      hybrid branch is gone.
- [ ] **Step 3: Implement.**
  - Run
    `git rm app/project-manager-shim/src/handler/watcher.ts app/project-manager-shim/src/upload.ts app/project-manager-shim/src/fs.ts app/project-manager-shim/src/__tests__/fs.test.ts`.
  - Remove `export * from './watcher.js'` from `handler/index.ts`.
  - **`runProjects.ts`:** delete `runHybridProjectByUrl` and the
    `RemoteBackend`, `EnsoPath`, `AssetType`, `extractTypeAndPath`,
    `ProjectAsset` and `CloudParams` imports. `runLocalProjectByUuid` drops
    `cloudParams`.
  - **`projectService/index.ts`:** delete `CloudParams` and the `cloud`
    parameters, and `projectEnvVars` becomes:

```ts
  private async projectEnvVars(
    projectId: UUID,
    projectsDirectory: Path,
  ): Promise<readonly (readonly [string, string])[]> {
    const localSessionId = `localprojectsession-${KSUID.randomSync().string}`
    const localProjectKey = await makeProjectTelemetryKey(projectsDirectory, projectId)
    return [
      ['ENSO_LOCAL_PROJECT_ID', localProjectKey],
      ['ENSO_LOCAL_PROJECT_SESSION_ID', localSessionId],
    ]
  }
```

- **`handler/projectService.ts`:** `Body` loses `cloud`, and the call is
  `projectService.openProject(body.projectId, body.projectsDirectory)`.
- **`ProjectManager/types.ts`/`ProjectManager.ts`:** delete `CloudParams` and
  `cloud?`. `LocalBackend.openProject` drops the `openHybridProjectParameters`
  spread and the "hybrid" condition, and always calls `recordRecentProject`.
- **`package.json`:** remove the `"./fs"` export and `"chokidar"`. Run
  `corepack pnpm install` and stage `pnpm-lock.yaml`.
- **Docs:** in `project-manager-shim/CLAUDE.md` and `common/CLAUDE.md`, drop the
  "cloud projects" and "hybrid project" sentences.
- `git grep -nE "CloudParams|ENSO_CLOUD_|setHybridOpen|runHybridProjectByUrl|downloadCloudProject|uploadFile\(|chokidar|handleWatcherRequest" -- app ':!**/node_modules/**' ':!app/gui/integration-test/mock/cloud*'`
  must come back empty.
- [ ] **Step 4: Run the tests.** Run
      `corepack pnpm --dir app/project-manager-shim run compile`,
      `corepack pnpm --dir app/project-manager-shim exec vitest run src/handler src/projectService/__tests__/lifecycle.test.ts`,
      `corepack pnpm --dir app/common run test:unit` and
      `corepack pnpm -r --if-present run compile`. Expected: all green.
      `ProjectService.test.ts` needs a built engine, so it runs in CI.
- [ ] **Step 5: Commit.** Run
      `git add -A app/project-manager-shim app/common pnpm-lock.yaml && git commit -m "Shim: drop hybrid opening, cloud environment, the project watcher and cloud upload"`.

### Task 36: Delete `RemoteBackend`, its ID helpers, its paths and project executions

**Files:**

- Delete: `app/common/src/services/RemoteBackend.ts`,
  `app/common/src/services/Backend/projectExecution.ts`,
  `app/common/src/services/Backend/__test__/projectExecution.test.ts`
- Move (`git mv`, frozen for the cloud mock until PR 4):
  `app/common/src/services/RemoteBackend/ids.ts` goes to
  `app/gui/integration-test/mock/cloud/ids.ts`, and
  `app/common/src/services/Backend/remoteBackendPaths.ts` goes to
  `app/gui/integration-test/mock/cloud/remoteBackendPaths.ts`
- Create: `app/common/src/services/Backend/localBackendPaths.ts`,
  `app/gui/integration-test/mock/cloud/backend.ts`
- Modify: `app/common/src/services/Backend.ts` (import),
  `app/common/src/services/LocalBackend.ts`,
  `app/electron-client/src/server.ts`,
  `app/gui/project-manager-shim-middleware/index.ts`,
  `app/gui/src/providers/config.ts` (`CONFIGURATION_PATH`, if PR 1 left it),
  `app/gui/src/secrets/serviceCredentials/utilities.ts` (PR 2's location),
  `app/gui/integration-test/mock/cloudApi.ts`,
  `app/gui/integration-test/dashboard/copyInstead.spec.ts`, plus any other
  `integration-test` file the typecheck flags

**Interfaces:**

- Consumes: Tasks 33–35, after which no `src` code imports `RemoteBackend`.
- Produces:
  - `localBackendPaths.ts` exports `downloadProjectPath`,
    `DOWNLOAD_PROJECT_REGEX`, `getFileDetailsPath`, `GET_FILE_DETAILS_REGEX`,
    `downloadFilePath` and `EXPORT_ARCHIVE_PATH` (plus any datalink route
    constant PR 2b put in `remoteBackendPaths.ts`);
  - `getOauthCallbackPath(service: CredentialInput['type']): HttpsUrl` lives in
    `src/secrets/serviceCredentials/utilities.ts`;
  - `integration-test/mock/cloud/backend.ts` re-exports
    `enso-common/src/services/Backend` and `./cloudTypes` (Task 37).

- [ ] **Step 1: Write the failing check.** Run
      `corepack pnpm --dir app/common exec vitest run src/services/Backend/__test__/projectExecution.test.ts`.
      Expected: PASS before the change. It is deleted with its subject: project
      executions are a cloud scheduler feature, and nothing local uses them.
- [ ] **Step 2: Implement.**
  - Run
    `git rm app/common/src/services/RemoteBackend.ts app/common/src/services/Backend/projectExecution.ts app/common/src/services/Backend/__test__/projectExecution.test.ts`.
  - Run
    `git mv app/common/src/services/RemoteBackend/ids.ts app/gui/integration-test/mock/cloud/ids.ts`.
  - Run
    `git mv app/common/src/services/Backend/remoteBackendPaths.ts app/gui/integration-test/mock/cloud/remoteBackendPaths.ts`.
  - Rewrite the two moved files' imports to `enso-common/src/services/Backend`,
    and give each a file comment: "Frozen for `cloudApi.ts`; deleted with it in
    PR 4."
  - Create `localBackendPaths.ts` with the six exports above, copied verbatim
    (with their doc comments, re-worded "…of the local backend's servers
    (Electron and the dev middleware)").
  - Rewrite the imports in `Backend.ts:14`, `LocalBackend.ts:25`,
    `server.ts:59–64` and the middleware's `index.ts:34–37` to
    `./Backend/localBackendPaths.js` or
    `enso-common/src/services/Backend/localBackendPaths`.
  - Move `getOauthCallbackPath` into
    `src/secrets/serviceCredentials/utilities.ts` as a local function.
  - Create `mock/cloud/backend.ts`:

```ts
/**
 * @file The cloud mock's `Backend`: the shared module, plus the cloud-only declarations PR 3
 * removed from it (`./cloudTypes`). Deleted with `cloudApi.ts` in PR 4.
 */
export * from "enso-common/src/services/Backend";
export * from "./cloudTypes";
```

- Start `mock/cloud/cloudTypes.ts` as `export {}`. Task 37 fills it.
- Repoint `cloudApi.ts` (`import * as backend from './cloud/backend'`,
  `./cloud/remoteBackendPaths`, `./cloud/ids`), `copyInstead.spec.ts`, and every
  other integration-test import the typecheck flags.
- `git grep -nE "RemoteBackend(/ids)?'|remoteBackendPaths|Backend/projectExecution" -- app ':!app/gui/integration-test/mock/cloud*'`
  must come back empty.
- [ ] **Step 3: Run the checks.** Run
      `corepack pnpm -r --if-present run compile`,
      `corepack pnpm --dir app/gui run typecheck`,
      `corepack pnpm --dir app/electron-client run typecheck` and
      `corepack pnpm --dir app/common run test:unit`. Expected: 0 errors, and
      the tests pass.
- [ ] **Step 4: Commit.** Run
      `git add -A app/common app/gui app/electron-client && git commit -m "Delete RemoteBackend, its paths and project executions"`.

### Task 37: Trim `Backend.ts` to the local drive, datalinks and secrets

**Files:**

- Modify:
  - common: `app/common/src/services/Backend.ts`,
    `app/common/src/services/Backend/types.ts`,
    `app/common/src/services/LocalBackend.ts`,
    `app/common/src/utilities/permissions.ts`,
    `app/common/src/services/__test__/Backend.test.ts`;
  - GUI: `app/gui/src/utils/backendQuery.ts` (`BackendMutationMethod`,
    `STALE_TIME_MAP`, `INVALIDATION_MAP`), `app/gui/src/utils/driveMutations.ts`
    (`restoreAssets*`, `downloadAssetsMutationOptions` if only Task 30's deleted
    code used it), `app/gui/src/project-view/composables/backend.ts`, the drive
    columns (`column/columnUtils.ts`, `column/AssetColumnCell.vue`,
    `column/ProjectNameColumn.vue`, `columnHeading/ColumnHeading.vue`,
    `components/AssetRow.vue`), `providers/auth.ts`, `providers/session.ts`,
    `providers/category.ts`, `configurations/settings.ts`;
  - shim, Electron and the middleware: `app/electron-client/src/server.ts` and
    `app/gui/project-manager-shim-middleware/index.ts` (asset literals'
    `permissions`);
  - test data:
    `app/gui/src/project-view/components/widgets/FileBrowserWidget/__tests__/mockData.ts`,
    `app/gui/src/components/Drive/__tests__/DuplicateAssetsModal.test.ts`, and
    every other file the typecheck flags;
  - mock: `app/gui/integration-test/mock/cloud/cloudTypes.ts`,
    `mock/cloud/backend.ts`, `integration-test/dashboard/rightPanel.spec.ts`.
- Delete: `app/common/src/utilities/permissions.ts`, if only cloud permissions
  remain in it (its remaining GUI users are the permission columns PR 1 hid).
  Otherwise trim it.

**Interfaces:**

- Consumes: Task 36; the method and type lists at the top of this section.
- Produces:
  - the trimmed `Backend` abstract class, with `rootPath(): string` and
    `rootDirectoryId(): DirectoryId | null`;
  - `OpenProjectRequestBody = { readonly executeAsync: boolean }`;
  - `Asset` without `permissions`/`createdBy`;
  - the minimal `User` (see the ruling);
  - `LocalBackend` without the overrides of the deleted methods.

- [ ] **Step 1: Write the failing test.** Add to
      `app/common/src/services/__test__/Backend.test.ts`:

```ts
import { LocalBackend } from "../LocalBackend";

test("the local backend has no cloud-only methods", () => {
  const removed = [
    "usersMe",
    "listUsers",
    "getOrganization",
    "listUserGroups",
    "createPermission",
    "inviteUser",
    "undoDeleteAsset",
    "listProjectExecutions",
    "uploadImage",
    "listAssetVersionTags",
    "createCheckoutSession",
    "getLogEvents",
    "logEvent",
    "listApiKeys",
    "getMapboxToken",
  ];
  for (const name of removed)
    expect(name in LocalBackend.prototype, name).toBe(false);
  for (const name of [
    "createSecret",
    "getSecret",
    "updateSecret",
    "listSecrets",
    "createDatalink",
    "getDatalink",
    "deleteDatalink",
  ]) {
    expect(name in LocalBackend.prototype, name).toBe(true);
  }
});
```

- [ ] **Step 2: Run it.** Run
      `corepack pnpm --dir app/common exec vitest run src/services/__test__/Backend.test.ts`.
      Expected: FAIL on `usersMe`.
- [ ] **Step 3: Implement.**
  - **`Backend.ts`:** delete exactly the abstract methods and types listed at
    the top. Before deleting each declaration, cut it into
    `integration-test/mock/cloud/cloudTypes.ts`, but only for those
    `cloudApi.ts` or a spec uses. Run
    `corepack pnpm --dir app/gui run typecheck` after each group: users, orgs,
    plans, permissions, executions, API keys, audit log.
    - For kept-but-trimmed names the mock still builds in full (`Asset`, `User`,
      `Project`), put the pre-trim declaration in `cloudTypes.ts` under the same
      name, and add an explicit
      `export type { Asset, User, … } from './cloudTypes'` to
      `mock/cloud/backend.ts` (an explicit re-export shadows the star export).
      `cloudApi.ts` then compiles with no change beyond its imports.
    - `rootPath(user)` becomes `rootPath(): string`, and
      `rootDirectoryId(user, organization)` becomes
      `rootDirectoryId(): DirectoryId | null`. Update `LocalBackend` and
      `project-view/components/widgets/FileBrowserWidget/userFiles.ts`'s
      `UserFilesBackend`.
    - Delete `ProjectState.hybridOpenInProgress`/`hybridOpened` from the enum
      and from `IS_OPENING`/`IS_OPENING_OR_OPENED`.
  - **`types.ts`:** delete `OrganizationId`, `isOrganizationId`, `UserGroupId`,
    `isUserGroupId`, `ProjectExecutionId`, `SubscriptionId`, `ApiKeyId`, `Ami`
    and `UserPermissionIdentifier`. The compiler shows which still have users;
    anything only `cloudApi.ts` uses moves to `cloudTypes.ts`.
  - **`LocalBackend.ts`:** delete the overrides of every deleted method (lines
    700–780, 913–918, 1186–1218, 1285–1290, 1311–1407 for the deleted subset),
    the `organizationId:` fields in its project literals (lines 341, 482, 501,
    577, 603, 613), and `permissions: []` (line 172).
  - **`backendQuery.ts`:** remove the deleted names from `BackendMutationMethod`
    (the `DefineBackendMethods` constraint flags each one), and their
    `STALE_TIME_MAP` and `INVALIDATION_MAP` entries. `ACCOUNT_STALE_TIME_MS`
    goes if nothing else reads it.
  - **GUI callers:** each error from `corepack pnpm --dir app/gui run typecheck`
    is either code PR 1 hid (delete it) or a literal with a removed field (drop
    the field). The known sites:
    - the `permissions` and `createdBy` columns in `columnUtils.ts`,
      `AssetColumnCell.vue`, `ProjectNameColumn.vue`, `ColumnHeading.vue` and
      `AssetRow.vue`;
    - `Plan` in `AppContainerLayout.vue`, `appTitle.ts`, `UserBar.vue`,
      `AssetContextMenu.vue`, `AssetsTableContextMenu.vue` and `auth.ts`'s
      `makeSyntheticUser`, if PR 2 left them;
    - `organizationId` in `auth.ts` and `session.ts`.
  - **`openProject` callers:** pass `{ executeAsync: false }`
    (`projectStates.ts` and its tests).
  - Delete `MAPBOX_TOKEN_SCHEMA`/`MapboxToken`. PR 1's settings-based token has
    its own type.
  - `git grep -nwE "usersMe|listUsers|getOrganization|OrganizationInfo|Plan|AssetPermission|UserGroupInfo|listUserGroups|undoDeleteAsset|uploadImage|listAssetVersionTags|getLogEvents|logEvent|ApiKey|getMapboxToken|OpenHybridProjectParameters|cognitoCredentials|hybridOpened|hybridOpenInProgress|CheckoutSession|PaymentsConfig" -- app/common/src app/gui/src app/electron-client/src app/project-manager-shim/src app/gui/project-manager-shim-middleware ':!app/common/src/text*'`
    must come back empty.
- [ ] **Step 4: Run the checks.** Run
      `corepack pnpm --dir app/common run test:unit`,
      `corepack pnpm -r --if-present run compile`,
      `corepack pnpm --dir app/gui run typecheck`,
      `corepack pnpm --dir app/gui exec vitest run`,
      `corepack pnpm --dir app/project-manager-shim exec vitest run src/handler`
      and `corepack pnpm --dir app/electron-client run typecheck`. Expected: all
      green.
- [ ] **Step 5: Commit.** Run
      `git add -A app && git commit -m "Trim Backend to the local drive, datalinks and secrets"`.

### Task 38: `BackendType` has only `local`

**Files:**

- Modify:
  - common: `app/common/src/services/Backend.ts`;
  - GUI: `app/gui/src/providers/category.ts`,
    `app/gui/src/providers/container.ts`, `app/gui/src/providers/rightPanel.ts`,
    `app/gui/src/utils/driveMutations.ts`, `app/gui/src/utils/backendQuery.ts`;
  - drive:
    `app/gui/src/dashboard/pages/dashboard/components/column/columnUtils.ts`,
    `.../column/ProjectNameColumn.vue`, `.../components/ProjectIcon.vue`,
    `.../Drive/DriveBar/DriveBarToolbar.vue`,
    `app/gui/src/dashboard/layouts/DriveView.vue`,
    `app/gui/src/dashboard/layouts/Drive/globalContextMenuEntries.ts`;
  - tests: `driveMutations.test.ts`, `backendQuery.test.ts`, `auth.test.ts`,
    `uploadFiles.test.ts`, `session.test.ts`, `ProjectSessions.test.ts`,
    `DuplicateAssetsModal.test.ts`, `columnUtils.test.ts`,
    `ManageLabelsModal.test.ts`, `category.test.ts` (under
    `app/gui/src/**/__tests__/`).

**Interfaces:**

- Consumes: Tasks 30–37.
- Produces: `enum BackendType { local = 'local' }`; no `isCloud` locals;
  `rightPanel.ts`'s `{ backendType, id, title }` always local.

- [ ] **Step 1: Write the failing test.** Add to
      `app/common/src/services/__test__/Backend.test.ts`:

```ts
test("the local backend is the only backend type", () => {
  expect(Object.values(BackendType)).toEqual(["local"]);
});
```

- [ ] **Step 2: Run it.** Run
      `corepack pnpm --dir app/common exec vitest run src/services/__test__/Backend.test.ts`.
      Expected: FAIL (`['local', 'remote']`).
- [ ] **Step 3: Implement.** Delete `remote = 'remote'` from `BackendType`, then
      fix each typecheck error:
  - `const isCloud = … === BackendType.remote` becomes `false`, and its branches
    are deleted, in `globalContextMenuEntries.ts:55`, `columnUtils.ts:75`,
    `DriveBarToolbar.vue:64`, `ProjectNameColumn.vue:52`, `ProjectIcon.vue:69`
    and `DriveView.vue:124`;
  - `driveMutations.ts:269` keeps only the
    `[BackendType.local, 'listDirectory']` key;
  - `rightPanel.ts:195` becomes `backendType: BackendType.local`;
  - `container.ts`'s `modesForBackend` records lose the `remote` key;
  - `backendQuery.ts:380` becomes `networkMode: 'always'`;
  - in the tests, `BackendType.remote` fixtures become local, or the case is
    deleted when it tested a cloud-only path.

  Then run
  `git grep -nE "BackendType\.remote|type: 'remote'" -- app ':!app/gui/integration-test/mock/cloud*' ':!app/gui/integration-test/mock/cloudApi.ts'`.
  Expected: empty.

- [ ] **Step 4: Run the checks.** Run
      `corepack pnpm --dir app/common run test:unit`,
      `corepack pnpm --dir app/gui run typecheck` and
      `corepack pnpm --dir app/gui exec vitest run`. Expected: all green.
- [ ] **Step 5: Commit.** Run
      `git add -A app && git commit -m "BackendType: local is the only backend"`.

### Task 39: Verify and open PR 3

**Files:** none new. If formatting has to change any file, it goes in a final
`chore: format` commit.

**Interfaces:** Consumes: Tasks 30–38. Produces: the PR.

- [ ] **Step 1: Run the final greps.** Each must come back empty:

```bash
git grep -nwE "RemoteBackend|remoteBackend|createRemoteBackend|runHybridProjectByUrl" -- app ':!app/gui/integration-test/mock/cloud*' ':!app/gui/integration-test/mock/cloudApi.ts'
git grep -nE "BackendType\.remote|isCloudCategory|isCloudDataUnavailable|HybridOpened|HybridDownloaded|hybrid-opened|openHybridProjectParameters|CloudParams|ENSO_CLOUD_|setHybridOpen|downloadCloudProject|useUploadsToCloudStore|transferBetweenCategories|remoteBackendPaths|RemoteBackend/ids|Backend/projectExecution|listAssetVersionTags|getMapboxToken|cloud/download-project|get-project-archive|api/watcher|projectSessionBackendType|isRemoteAssetPath|executionsCalendar" -- app ':!app/gui/integration-test/mock/cloud*' ':!app/gui/integration-test/mock/cloudApi.ts' ':!app/common/src/text*'
git grep -n "ENSO_LOCAL_PROJECT_ID" -- app/project-manager-shim/src   # must NOT be empty: kept
```

The unused cloud strings in `app/common/src/text.ts`/`english.json`
(`*BackendError` ids of the deleted methods, the schedule and billing texts) are
left out of the grep on purpose and pruned in PR 4 with the rest of the cloud
configuration.

- [ ] **Step 2: Do a clean rebuild and run the full verification** (spec
      "Verification (each PR)").
  - Clear the caches first, as the root CLAUDE.md says:
    `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete; find . -name '.eslintcache' -not -path '*/node_modules/*' -delete`.
  - On Windows, in order:
    1. `corepack pnpm -r --if-present run compile`;
    2. `corepack pnpm --dir app/gui run typecheck`;
    3. `corepack pnpm --dir app/electron-client run typecheck`;
    4. `corepack pnpm --dir app/common run typecheck`;
    5. `corepack pnpm -r --if-present run lint`;
    6. `corepack pnpm exec prettier --check app/common/src app/gui/src app/gui/integration-test app/gui/project-manager-shim-middleware app/electron-client/src app/project-manager-shim/src`;
    7. `corepack pnpm --dir app/gui exec vitest run`;
    8. `corepack pnpm --dir app/common run test:unit`;
    9. `corepack pnpm --dir app/project-manager-shim run test:unit`;
    10. `corepack pnpm --dir app/electron-client exec vitest run`.
  - On Linux (WSL), where the screenshots are compared:
    `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && corepack pnpm -r compile && corepack pnpm --dir app/gui exec playwright test'`.
    Also run the touched local specs (`localDirectories`, `localRecent`,
    `localVersions`, `localVersioningSettings`, `localLabels`, `createAsset`,
    `driveView`) on Windows, several times each on this branch and on `develop`,
    and compare the pass rates.
- [ ] **Step 3: Test by hand, then the installer.**
  - In `corepack pnpm --dir app/gui run dev:vite`:
    - the app starts on Local;
    - drag a project into an added folder (it moves), and copy and paste it (it
      copies);
    - upload a file;
    - a project opens, saves and closes, and its Versions tab lists versions
      with comments and "Latest" and no tag button;
    - the right panel has no Schedule tab;
    - DevTools Network shows no request to `api.cloud` or `/api/cloud/`.
  - Build the Windows installer for the user's installer test, with the five
    spec checks: no login screen, starts on Local, projects open/save/version,
    Settings has no cloud sections, and no cloud request or error when offline.
    Also run `Enso.exe --headless --startup.project <a local project>`: it
    exits 0. With `enso://…` it exits 1 with the message from Task 34.
- [ ] **Step 4: Push and open the PR.** Run
      `git push -u origin feature/local-only-remove-remote-backend`, then
      `gh pr create --base develop --label "CI: No changelog needed" --title "Local-only IDE, PR 3: remove the remote backend"`.
      The body covers:
  - **Summary:** what is deleted from each package, with the method and type
    lists from this section.
  - **Rulings:** the integration-test mock frozen under
    `integration-test/mock/cloud/` until PR 4; `BackendType.remote` removed (the
    counts); the minimal `User`; restored tabs from a cloud/hybrid project are
    dropped once.
  - **Behaviour:** none visible beyond PR 1, plus headless `enso:` URLs now
    refused.
  - **Not verified here:** `ProjectService.test.ts` needs a built engine (it
    runs in CI); the `Package New IDE` jobs on Linux and Windows are CI's.
  - **Screenshots:** before/after of the drive sidebar, a context menu and the
    Versions tab, via `pr-screenshots`.
  - **Closes:** the PR 3 ticket of the local-only epic.
  - It waits for the user's installer test (merge gate for features) before
    merge.

## PR 4: prune tests, dependencies and build configuration

Goal: take the last traces of Enso Cloud out of the IDE's tests, dependencies,
build-time configuration and CI (spec "PR 4", decision 4). The cloud Playwright
mock (`integration-test/mock/cloudApi.ts`, 1,585 lines), the login fixtures and
the `Setup` project go. Every spec that still has local value moves to the local
mock (`mock/localApi.ts`). `aws-amplify` and `amazon-cognito-identity-js` leave
the dependency tree. The cloud `ENSO_IDE_*` variables,
`ENSO_IDE_MAPBOX_API_TOKEN` included, leave `.env`, `$config`, Electron,
`web.rs` and the generated workflows. The standard library cloud test jobs
(`enable_cloud_tests`, `cloud_tests/`, `extra-nightly-tests.yml`) are left
exactly as they are.

Branch: `feature/local-only-prune`, from `develop` after PR 3 has merged. PR
rules: users can see none of this (tests, dependencies, build configuration, CI
and docs), so the PR takes the `CI: No changelog needed` label and gets no
CHANGELOG entry. Add the label when the PR is opened. There is no UI change, so
no screenshots, but accessibility baselines and ARIA snapshots do change, and
the PR body explains each one. Decision 2 still requires a Windows installer
test by the user before merge. Add the `CI: Build IDE` label so that
`Package New IDE` runs on Linux and Windows even if the changed-files filters
would skip it.

**Ordering hazard (Ruling needed):** PR 3 deletes
`services/Backend/remoteBackendPaths.ts` and `services/RemoteBackend/ids.ts` and
trims `Backend.ts`. `mock/cloudApi.ts` imports all three (lines 2–8), and
`tsconfig.node.json` type-checks it, so PR 3's `typecheck` cannot pass while
that file exists. **Recommended default:** run Tasks 40–43 at the start of PR 3.
They touch nothing PR 3 changes except the local mock's
`/api/cloud/download-project` route, which they delete too. The rest of PR 4
then follows as written. Every `git rm` below uses `--ignore-unmatch`, so the
tasks are still correct if PR 3 has already deleted some of these files.

### Task 40: Local mock helpers and a suite-wide cloud-request guard

**Files**

- Modify: `app/gui/integration-test/mock/localApi.ts`
- Modify: `app/gui/integration-test/mock/registerMocks.ts`
- Modify: `app/gui/integration-test/base.ts`
- Create: `app/gui/integration-test/dashboard/cloudRequestGuard.spec.ts`

**Interfaces**

- Consumes:
  - from PR 1, the app starts on the local drive with no login, and its startup
    spec makes no cloud request;
  - from PR 3, nothing calls `/api/cloud/download-project` any more.
- Produces:
  - `MockLocalApi.addRootDirectory(title: string, options?: { parent?: Path; attributes?: Partial<Attributes> }): Path`
  - `MockLocalApi.addRootFile(title: string, options?: { parent?: Path; content?: string; attributes?: Partial<Attributes> }): Path`
  - `MockLocalApi.addRootProject(title: string, options?: { attributes?: Partial<Attributes> }): Path`
  - `MockLocalApi.addProjectSources(projectPath: Path): void`
  - tracked calls `moveFile: { from: string; to: string }[]`,
    `deletePath: { path: string }[]` and
    `duplicateProject: { projectId: string }[]`
  - a `/api/project-service/project/duplicate` route
  - `CLOUD_URL: RegExp` and `recordCloudRequests(page): Promise<string[]>` in
    `registerMocks.ts`
  - an auto fixture `cloudRequests: string[]` in `base.ts`
- Removes: the `downloadCloudProject` tracked call and the
  `/api/cloud/download-project?*` route (`localApi.ts` ~L626).

- [ ] **Step 1: Write the failing guard spec** in
      `dashboard/cloudRequestGuard.spec.ts`:

```ts
/** @file Every spec fails if the app asks Enso Cloud for anything (`cloudRequests`, `base.ts`). */
import { expect, test } from "integration-test/base";

test("a request to Enso Cloud is blocked and recorded", async ({
  drivePage,
  page,
  cloudRequests,
}) => {
  await drivePage;
  const outcome = await page.evaluate(() =>
    fetch("https://mock/users/me").then(
      () => "answered",
      () => "blocked",
    ),
  );
  expect(outcome).toBe("blocked");
  expect(cloudRequests).toEqual(["GET https://mock/users/me"]);
  // The fixture fails any test that leaves a cloud request recorded; this one made it on purpose.
  cloudRequests.splice(0);
});
```

- [ ] **Step 2: Run it and see it fail.** In WSL (`. ~/.enso-toolchain.sh`), run
      `corepack pnpm --dir app/gui exec playwright test --project="Integration Tests" integration-test/dashboard/cloudRequestGuard.spec.ts`.
      It fails at `vue-tsc`/fixture resolution: `cloudRequests` is not a
      fixture.
- [ ] **Step 3: Add the guard** to `registerMocks.ts`, after the imports:

```ts
/** Enso Cloud, its test mocks and its identity provider: a local-only IDE requests none of them. */
export const CLOUD_URL =
  /^https:\/\/(?:mock|mock-s3-bucket\.com|mock-cognito\.com|(?:[^/]+\.)?cloud\.enso\.org|[^/]+\.amazoncognito\.com|[^/]+\.amazonaws\.com)(?:[:/]|$)/;

/** Abort every request to {@link CLOUD_URL}, and record it as `METHOD url`. */
export async function recordCloudRequests(page: Page): Promise<string[]> {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (CLOUD_URL.test(request.url()))
      requests.push(`${request.method()} ${request.url()}`);
  });
  await page.route(CLOUD_URL, (route) => route.abort("blockedbyclient"));
  return requests;
}
```

In `base.ts`, add `cloudRequests: string[]` to the fixture type, and this entry:

```ts
  cloudRequests: [
    async ({ page }, use) => {
      const requests = await recordCloudRequests(page)
      await use(requests)
      expect(requests, 'requests to Enso Cloud').toEqual([])
    },
    { auto: true },
  ],
```

`expect` is declared below `test` in `base.ts`, so the fixture uses
`baseExpect`, which is already imported.

- [ ] **Step 4: Add the helpers** to `localApi.ts`:
  - Change `FileEntryWithData.content` (L100) and `FileEntryOptions.content` to
    `string | Buffer`.
  - `filesystem-read-path` answers with
    `succeed(file.content, mimeTypeFor(file.entry.path))`, where `mimeTypeFor`
    returns `'image/png'` for `.png` and `'text/plain'` otherwise.
  - In `filesystem-move-from`, call
    `called('moveFile', { from: sourcePath, to: destinationPath })`.
  - In `filesystem-delete`, call `called('deletePath', { path })`.
  - Add the three keys to `INITIAL_CALLS_OBJECT`, remove `downloadCloudProject`
    and its route, and add these helpers:

```ts
const MOCK_PROJECT_DIR = fileURLToPath(new URL("./project", import.meta.url));

/** Add a folder (under the root unless `parent` is given), by title. */
const addRootDirectory = (
  title: string,
  options: { parent?: Path; attributes?: Partial<Attributes> } = {},
) => {
  const path = Path(posix.join(options.parent ?? ROOT_PATH, title));
  addDirectory({
    path,
    ...(options.attributes ? { attributes: options.attributes } : {}),
  });
  return path;
};
/** Add a file (under the root unless `parent` is given), by title. */
const addRootFile = (
  title: string,
  options: {
    parent?: Path;
    content?: string;
    attributes?: Partial<Attributes>;
  } = {},
) => {
  const path = Path(posix.join(options.parent ?? ROOT_PATH, title));
  addFile({
    path,
    content: options.content ?? "",
    ...(options.attributes ? { attributes: options.attributes } : {}),
  });
  return path;
};
/** Add a project under the root, by title; returns its directory. */
const addRootProject = (
  title: string,
  options: { attributes?: Partial<Attributes> } = {},
) =>
  addProject({
    metadata: {
      id: UUID(uuidv4()),
      name: title,
      namespace: "local",
      created: toRfc3339(new Date()),
    },
    ...(options.attributes ? { attributes: options.attributes } : {}),
  }).entry.path;
/** Give `projectPath` the sources in `mock/project/` (docs with "Project Goal", and an image). */
const addProjectSources = (projectPath: Path) => {
  for (const relative of ["src/Main.enso", "src/ea.png"]) {
    addFile({
      path: Path(posix.join(projectPath, relative)),
      content: readFileSync(posix.join(MOCK_PROJECT_DIR, relative)),
    });
  }
};
```

Also add a `project/duplicate` route next to `project/create`. It reads
`{ projectId, projectsDirectory }`, records `duplicateProject`, finds the
`ProjectEntry` under `projectsDirectory` whose `metadata.id` equals `projectId`
(or answers `toJSONRPCError('Project not found')`), and adds a project named
`` `${name} (copy)` `` the way `project/create` does. That is the shim's naming
(`getNameForDuplicatedProject`). The route returns
`{ projectId, projectName, projectNormalizedName, projectPath }`. Add all four
helpers to `api`.

- [ ] **Step 5: Remove what the electron and cloud mocks no longer need from
      `registerMocks.ts`.** Delete `authentication` from `mockElectronApi`,
      because PR 2 removed the preload API. Delete the
      `ensoanalytics.com/eula.json` and `privacy.json` routes and their bodies,
      because PR 2 removed the agreements.
- [ ] **Step 6: Run the tests.** Rerun Step 2's spec; it passes. Then run the
      whole suite once to see whether a non-cloud spec trips the guard:
      `corepack pnpm --dir app/gui exec playwright test --project="Integration Tests" --workers=2`.
      Every failure must be in a spec that Task 41, 42 or 43 handles. Then run
      `corepack pnpm --dir app/gui run typecheck` and
      `corepack pnpm --dir app/gui exec eslint integration-test/mock integration-test/base.ts integration-test/dashboard/cloudRequestGuard.spec.ts`.
- [ ] **Step 7: Commit.**
      `git add app/gui/integration-test/mock/localApi.ts app/gui/integration-test/mock/registerMocks.ts app/gui/integration-test/base.ts app/gui/integration-test/dashboard/cloudRequestGuard.spec.ts`,
      then
      `git commit -m "Integration tests: local mock helpers and a suite-wide guard against cloud requests"`.

### Task 41: Port the drive specs to the local mock

**Files** (all under `app/gui/integration-test/`)

- Modify: `dashboard/contextMenu.spec.ts`, `dashboard/copy.spec.ts`,
  `dashboard/createAsset.spec.ts`, `dashboard/delete.spec.ts`,
  `dashboard/driveView.spec.ts`, `dashboard/editAssetName.spec.ts`,
  `dashboard/sort.spec.ts`, `dashboard/assetSearchBar.spec.ts`,
  `dashboard/assetsTableFeatures.spec.ts`, `dashboard/labelsPopover.spec.ts`,
  `dashboard/pageSwitcher.spec.ts`
- Delete: `dashboard/copyInstead.spec.ts` and `dashboard/exportAsset.spec.ts`.
  Every path they drive is gone after PR 3: team folders, the "copy instead"
  restore from Trash, and cloud↔local export. The spec lists both as mixed, but
  neither has a local part.

**Interfaces**

- Consumes: Task 40's helpers and tracked calls; `goToCategory.local()`.
- Produces: no spec under `dashboard/` that uses `cloudApi` or
  `goToCategory.cloud()/recent()/trash()`, except those deleted in Task 43.

The ports follow these rules. Each `goToCategory.cloud()` becomes `.local()`.
Each `cloudApi.addX({ title })` becomes `localApi.addRootX(title)`, in
`setupApi.local` or in the test body with the `localApi` fixture. A spec whose
row counts assumed an empty drive sets
`test.use({ setupApi: { addDefaultProject: false } })`. A cloud secret becomes a
file. The table says what happens to each test.

| Spec                | Tests kept (ported)                                                                                                                       | Tests deleted, and why                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contextMenu         | `drive view` (no default project; drop the label setup)                                                                                   | none                                                                                                                                                    |
| copy                | `move`, `move (drag)`, `move (keyboard)`, `cut (keyboard)`, `duplicate`, `duplicate (keyboard)` (projects)                                | `copy` and `copy (keyboard)`: local `copyAsset` copies only projects, within their folder (`LocalBackend.ts` ~L657). `move to trash`: there is no Trash |
| createAsset         | the three `(local)` tests; `create folder (local)` drops its leading `.cloud()`                                                           | the four `(remote)` tests, including the secret                                                                                                         |
| delete              | `delete (local)`, `cannot delete opened project (local)`                                                                                  | every `(remote)` and trash test (6)                                                                                                                     |
| driveView           | `drive view`, with `contextMenu.delete()` in place of `moveToTrash()` and no default project                                              | none                                                                                                                                                    |
| editAssetName       | all 11 tests, with `calls.updateAsset` → `localApi.trackCalls().moveFile`                                                                 | none                                                                                                                                                    |
| sort                | `sort`: the two secrets become files `f file` and `H file`; `modifiedAt` becomes `attributes.lastModifiedTime: toRfc3339(date)`           | none                                                                                                                                                    |
| assetSearchBar      | `tags (positive)`, `tags (negative)`, `suggestions`, `suggestions (keyboard)`, `complex flows` (secrets become files; no default project) | `labels (…not supported in search)`: already skipped; the cloud labels                                                                                  |
| assetsTableFeatures | `extra columns should stick…`: 100 files `a 0` … `a 99`, since local paths must be unique                                                 | `navigate to parent… in Trash`, `can't run a project in browser` (`browserDisabled` was deleted in PR 2), `opened by another user`                      |
| labelsPopover       | the one test: `localApi.addLabel`, then right-click `Mock Project` (labels are for projects only, `supportsLabels`)                       | none                                                                                                                                                    |
| pageSwitcher        | `page switcher`: `.local().newEmptyProject()`, without the `enableCloudExecution` flag                                                    | none                                                                                                                                                    |

- [ ] **Step 1: Port `copy.spec.ts`'s `move (drag)` first.** It is the failing
      test that exercises the new helpers:

```ts
test("move (drag)", async ({ drivePage, localApi }) => {
  localApi.addRootDirectory("New Folder 1");
  localApi.addRootDirectory("New Folder 2");
  await drivePage.goToCategory
    .local()
    .driveTable.dragRowToRow("New Folder 2", "New Folder 1")
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^New Folder 1/, /^Mock Project/]);
    })
    .driveTable.openDirectory("New Folder 1")
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^New Folder 2/]);
    });
});
```

- [ ] **Step 2: Run it.** In WSL, run
      `corepack pnpm --dir app/gui exec playwright test --project="Integration Tests" integration-test/dashboard/copy.spec.ts -g "move \(drag\)"`.
      Before Task 40 it would fail on the missing `addRootDirectory`; with Task
      40 in place it passes. If it fails on the row order, fix the order, not
      the app. The drive groups folders before projects.
- [ ] **Step 3: Port the rest by the table.** The rename assertions in
      `editAssetName.spec.ts` change like this:

```ts
const calls = localApi.trackCalls();
await nameEl.press("Enter");
await expect(row).toHaveText(new RegExp("^" + NEW_NAME));
expect(calls.moveFile).toMatchObject([
  { to: posix.join(localApi.rootPath, NEW_NAME) },
]);
```

The cancel and blank-name tests keep the "no call" assertion, now as
`expect(calls.moveFile).toEqual([])`. In `sort.spec.ts`, the four sorted
expectations change only in the two names. Sorting by name or date is not
grouped by type, so each file keeps its secret's position. The default ("grouped
by type") expectation becomes the local listing's insertion order within each
group. The local mock appends children (`addEntry` → `children.push`), whereas
the cloud mock reversed them:

```ts
await expect(rows).toHaveText([
  /^a directory 1/,
  /^a directory 10/,
  /^a directory 2/,
  /^a directory 11/,
  /^G directory/,
  /^C project/,
  /^b project/,
  /^H file/,
  /^d file/,
  /^f file/,
  /^e file/,
]);
```

If the first Linux run shows a different default order, that is the local
backend's real listing order (`LocalBackend.listDirectory`). Record it with a
comment saying so, and leave the sorted expectations alone.

- [ ] **Step 4: Delete the two specs:**
      `git rm --ignore-unmatch app/gui/integration-test/dashboard/copyInstead.spec.ts app/gui/integration-test/dashboard/exportAsset.spec.ts`.
- [ ] **Step 5: Check that nothing is left behind, and run the tests.** This
      must print nothing:
      `git grep -n "cloudApi\|goToCategory\s*\.\s*\(cloud\|recent\|trash\)()\|\.cloud()" -- app/gui/integration-test/dashboard/{contextMenu,copy,createAsset,delete,driveView,editAssetName,sort,assetSearchBar,assetsTableFeatures,labelsPopover,pageSwitcher}.spec.ts`.
      Then, in WSL, run these 11 specs three times each with
      `--workers=2 --repeat-each=3`. All must pass. Run the same specs once on
      Windows. Finish with `corepack pnpm --dir app/gui run typecheck` and
      ESLint on the touched files.
- [ ] **Step 6: Commit.** `git add app/gui/integration-test/dashboard`, then
      `git commit -m "Integration tests: run the drive specs against the local mock"`.

### Task 42: Port the panel, settings, menu and editor specs; update the accessibility baselines

**Files**

- Modify (under `app/gui/integration-test/`): `dashboard/rightPanel.spec.ts`,
  `dashboard/accessibility.spec.ts`, `dashboard/userMenu.spec.ts`,
  `dashboard/localModeSettings.spec.ts`, `dashboard/localVersions.spec.ts` and
  `project-view/editorPanels.spec.ts`
- Modify: `accessibility-baseline/drive.json`,
  `accessibility-baseline/settings.json` and
  `accessibility-baseline/asset-panel.json` (regenerated)
- Delete: `accessibility-baseline/login.json`

**Interfaces**

- Consumes: Task 40's `addProjectSources` and `cloudRequests`; from PR 1, the
  user menu's local items and the Settings tabs (Account, Local, Appearance,
  Keyboard shortcuts), with the Properties tab gone.
- Produces: no spec, except those deleted in Task 43, that names `cloudApi`,
  `loginPage`, `storageState` or `https://mock`.

- [ ] **Step 1: Port `rightPanel.spec.ts`.** Keep
      `Asset Panel documentation view` and `Assets Panel docs images`, each
      starting from
      `localApi.addProjectSources(posix.join(localApi.rootPath, 'Mock_Project'))`
      on the default project, with
      `.local().driveTable.clickRow('Mock Project')`. Delete
      `asset panel contents`, because owner and permissions lived on the
      Properties tab. Delete `Asset Panel Decription` too:
      `LocalBackend.updateAsset` does not store descriptions (~L825). Remove the
      now-unused `EmailAddress`/`UserId`/`PermissionAction` imports and the
      owner and description locators.
- [ ] **Step 2: Run**
      `…playwright test --project="Integration Tests" integration-test/dashboard/rightPanel.spec.ts`.
      It fails until the docs route serves the sources, so fix `mimeTypeFor` or
      the path until both tests pass.
- [ ] **Step 3: Port `accessibility.spec.ts`.**
  - Delete the `logged out` describe block and run
    `git rm --ignore-unmatch app/gui/integration-test/accessibility-baseline/login.json`.
  - The three drive tests use `localApi.addRootDirectory('Folder')`,
    `addRootProject('Project')` and `addRootFile('File')`, with
    `addDefaultProject: false` so that there are still three rows, and
    `.local()`.
  - In `dragging rows is announced`, delete the second half, the drop on `Trash`
    and its announcement. The drop-into-folder half stays.
  - `asset panel` clicks `Mock Project` (with `addProjectSources`), opens it
    with `toggleDocsAssetPanel()` in place of `togglePropertiesAssetPanel()`,
    waits for `documentation-editor-content`, then scans `right-panel`.
  - The `settings` sidebar snapshot becomes:

```ts
await expect(sidebar).toMatchAriaSnapshot(`
      - heading "General" [level=1]
      - button "Account"
      - button "Local"
      - heading "Look and feel" [level=1]
      - button "Appearance"
      - button "Keyboard shortcuts"
    `);
```

- For `user menu tree`, delete the `Upgrade Plan` and `Logout` lines, and the
  `Solo` plan text. Then regenerate it with
  `--update-snapshots --update-source-method=overwrite -g "user menu tree"` and
  check that the result lists only `Settings` and `About Enso` as buttons, under
  the offline user's name.
- [ ] **Step 4: Regenerate the axe baselines** on Linux:
      `UPDATE_AXE_BASELINE=true corepack pnpm --dir app/gui exec playwright test --project="Integration Tests" integration-test/dashboard/accessibility.spec.ts`.
      Review `git diff app/gui/integration-test/accessibility-baseline/`. A
      removed entry is a cloud-only control that has gone. Any added entry needs
      a reason in the PR body, or a fix. `asset-panel.json` will change most,
      because it now scans the Docs tab. Then run the spec
      `--repeat-each=10 --workers=2` (integration-test/CLAUDE.md) and check that
      it is stable.
- [ ] **Step 5: Port the remaining four specs.**
  - `userMenu.spec.ts`: keep `user menu`. Port `local mode` →
    `no "Upgrade Plan" or "Logout"` to `async ({ drivePage, page })`, with no
    config route, no `storageState` and no reload. Delete `download app` (the
    browser download entry is not a local item) and `signed in to the cloud…`.
  - `localModeSettings.spec.ts`: delete `CLOUD_API_URL`, `CONFIGURATION_URL`,
    `openLocalOnly`, `storageState` and the `cloudApi`/`appConfig` parameters.
    Both tests start `async ({ drivePage, page })`, `await drivePage`, and drop
    `expect(cloudRequests).toEqual([])`, which the auto fixture now checks for
    every test. Reword the file comment: the IDE is always local-only, and there
    is no remote configuration.
  - `localVersions.spec.ts`: delete `the cloud Versions tab still works…`
    (~L289).
  - `project-view/editorPanels.spec.ts`: delete the `setupApi.cloud` block
    (~L74) and the `Enso links` test, because PR 2 removed the
    `enso://Users/...` form. The link in `mock/lsHandler.ts` (L76) stays: it is
    only Markdown, and other tests count the `a` elements in the docs.
- [ ] **Step 6: Check and run.** This must print nothing:
      `git grep -n "cloudApi\|loginPage\|storageState\|https://mock" -- app/gui/integration-test ':!app/gui/integration-test/mock/cloudApi.ts' ':!app/gui/integration-test/dashboard/{activityLogSettings,authPreserveEmail,billing,dataLinkEditor,degradedAuth,loginLogout,loginScreen,organizationSettings,signUp,userGroupsSettings,userSettings,welcomeProject}.spec.ts' ':!app/gui/integration-test/setup.ts' ':!app/gui/integration-test/base.ts' ':!app/gui/integration-test/dashboard/cloudRequestGuard.spec.ts' ':!app/gui/integration-test/mock/registerMocks.ts'`.
      Then run the six specs in WSL with `--workers=2 --repeat-each=3` and once
      on Windows, and finish with the typecheck.
- [ ] **Step 7: Commit.** `git add app/gui/integration-test`, then
      `git commit -m "Integration tests: port the panel, settings and menu specs to local; refresh the accessibility baselines"`.

### Task 43: Delete the cloud mock, the cloud-only specs and the login helpers

**Files** (under `app/gui/integration-test/` unless stated)

- Delete:
  - `mock/cloudApi.ts`, `setup.ts`;
  - `dashboard/` specs: `activityLogSettings`, `authPreserveEmail`, `billing`,
    `dataLinkEditor`, `degradedAuth`, `loginLogout`, `loginScreen`,
    `organizationSettings`, `signUp`, `userGroupsSettings`, `userSettings` and
    `welcomeProject` (`.spec.ts`);
  - `actions/`: `LoginPageActions.ts`, `RegisterPageActions.ts`,
    `ForgotPasswordPageActions.ts`, `SettingsAccountFormActions.ts`,
    `SettingsChangePasswordFormActions.ts`, `SettingsFormActions.ts`,
    `SettingsOrganizationFormActions.ts`, `SettingsOrganizationTabActions.ts`,
    `SettingsMembersTabActions.ts`, `SettingsUserGroupsTabActions.ts`,
    `SettingsActivityLogTabActions.ts` and
    `SettingsBillingAndPlansTabActions.ts`.
- Modify:
  - `base.ts`, `actions/DrivePageActions.ts`, `actions/contextMenuActions.ts`,
    `actions/gotoSettingsTabActions.ts`, `actions/userMenuActions.ts`,
    `actions/SettingsAccountTabActions.ts`, `actions/utilities.ts`;
  - `app/gui/playwright.config.ts` and the root `.gitignore`.
- Keep: `actions/NewDataLinkModalActions.ts`,
  `DrivePageActions.openDataLinkModal` and `contextMenu.newDataLink`. PR 2b's
  local datalink spec uses them.

**Interfaces**

- Consumes: Tasks 41–42, after which no remaining spec uses these files; PR 2b's
  datalink page objects.
- Produces:
  - in `base.ts`: `drivePage` loads the app directly, through the exported
    `waitForAppLoaded(page)`; there is no `loginPage` or `cloudApi` fixture, and
    `setupApi` is `{ local?, addDefaultProject? }`;
  - `DrivePageActions.goToCategory` is `{ local, localRecent }`;
  - `GoToSettingsTabActions` is `{ account, local, keyboardShortcuts }`;
  - `UserMenuActions` is `{ settings }`;
  - there is no `Setup` Playwright project.

- [ ] **Step 1: Delete the files:** `git rm --ignore-unmatch` on every path in
      the Delete list (full paths, from the repo root).
- [ ] **Step 2: Rewrite `base.ts`'s fixtures.** Remove the `LoginPageActions`
      and `cloudApi` imports and the fixtures, and import `DrivePageActions` as
      a value:

```ts
/** Wait for the app to load: no loading screen, and the drive (or a project) on screen. */
export async function waitForAppLoaded(page: Page) {
  await page.waitForLoadState()
  await baseExpect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 30_000 })
  await baseExpect(page.getByTestId('drive-view').or(page.locator('.ProjectView')).first()).toBeVisible({ timeout: 30_000 })
}

  drivePage: async ({ page, localApi, featureFlags, aiAvailable, appConfig }, use) => {
    // Only make sure that the local API mock is registered; the spec uses it through `localApi`.
    const _ = { localApi }
    await registerMocks(page, featureFlags, { aiAvailable, appConfig })
    await page.goto('/')
    await waitForAppLoaded(page)
    await use(new DrivePageActions(page, {}))
  },
```

`before-auth-layout`/`after-auth-layout` are no longer awaited, because PR 2
reduced `ProtectedLayout`. In `registerMocks.ts`, drop `enableCloudExecution`
and `enableAdvancedProjectExecutionOptions` from the default flags if
`git grep -n "enableCloudExecution\|enableAdvancedProjectExecutionOptions" app/gui/src`
is empty after PR 3. Otherwise leave them, and note in the PR body that the dead
flags remain.

- [ ] **Step 3: Prune the page objects.**
  - `DrivePageActions`: remove the `cloud`, `recent` and `trash` categories,
    `clearTrash`, `expectTrashPlaceholderRow`, `createSecret`, and the
    `locateUpsertSecretModal`/`locateSecretNameInput`/`locateSecretValueInput`
    helpers.
  - `locateCategoryButton(page, category)` loses its group argument. The
    `CategoryGroup` type and `categoryGroup` are deleted, and every caller
    (`goToCategoryNamed`, `expectCategory`, `dragRowToCategory`) drops it too.
    After PR 1 the sidebar has a single `.categories` list, so use
    `page.locator('.LeftPanel .leftBar .categories').getByRole('button', { name: category, exact: true })`.
  - `contextMenuActions`: remove `exportToCloud`, `exportToLocal`,
    `moveToTrash`, `restoreFromTrash`, `share` and `newSecret`.
  - `gotoSettingsTabActions`: keep `account`, `local` and `keyboardShortcuts`.
  - `SettingsAccountTabActions`: remove `accountForm`, `changePasswordForm` and
    `uploadProfilePicture`.
  - `userMenuActions`: keep `settings`, and remove `downloadApp` and `logout`.
  - `utilities.ts`: remove `INVALID_PASSWORD`, `VALID_PASSWORD` and
    `VALID_EMAIL`.
- [ ] **Step 4: Remove the `Setup` project** from `playwright.config.ts`
      (~L162). Both integration projects also lose their
      `dependencies: ['Setup']` and `storageState` entries. Delete
      `playwright/.auth/` from the root `.gitignore` (L192), now that nothing
      writes one. Task 44 removes the Electron writer.
- [ ] **Step 5: Verify.** Each of these must print nothing:
  - `git grep -n "mock/cloudApi\|MockCloudApi\|LoginPageActions\|loginIfNeeded\|playwright/.auth\|project=Setup" -- app/gui`
  - `git grep -n "VALID_PASSWORD\|VALID_EMAIL\|newSecret\|moveToTrash\|exportToCloud" -- app/gui/integration-test`

  Then:
  - run `corepack pnpm --dir app/gui run typecheck`. If it fails with TS6307,
    trim `tsconfig.node.json`'s `include` only for files that are no longer
    reached, and never widen it;
  - run
    `corepack pnpm --dir app/gui exec eslint integration-test playwright.config.ts`;
  - run the whole suite in WSL 3 times with `--workers=2`, and compare the
    per-spec pass rates with `develop`'s, as integration-test/CLAUDE.md
    describes;
  - run the touched specs once on Windows.

- [ ] **Step 6: Commit.**
      `git add -A app/gui/integration-test app/gui/playwright.config.ts .gitignore`,
      then
      `git commit -m "Integration tests: delete the cloud mock, the cloud-only specs and the login fixtures"`.

### Task 44: Electron e2e without a cloud account

**Files**

- Delete: `app/electron-client/tests/cloudWorkflow.spec.ts`
- Modify:
  - `app/electron-client/tests/electronTest.ts`;
  - the specs `aiChallenges`, `aiNode`, `gettingStarted` and `localWorkflow`
    (`.spec.ts`, under `app/electron-client/tests/`);
  - `app/electron-client/tests/README.md` and
    `app/electron-client/src/globals.d.ts`.

**Interfaces**

- Consumes: from PR 2, there is no login screen and no `window.passwordOverride`
  reader in `LoginPage.vue`.
- Produces: `waitForDashboard(page: Page): Promise<void>` in place of
  `loginAsTestUser`; `credentials` is no longer exported.

- [ ] **Step 1: Delete the spec:**
      `git rm --ignore-unmatch app/electron-client/tests/cloudWorkflow.spec.ts`.
- [ ] **Step 2: Rewrite `electronTest.ts`.** Delete `TEST_USER_FILE`, the
      `credentials` export, and the `passwordOverride` `evaluate` in the `app`
      fixture (~L111). Replace `loginAsTestUser` with:

```ts
/** Wait until the app has loaded: the drive, or the welcome project's tab on a first start. */
export async function waitForDashboard(page: Page) {
  const dashboardReady = page
    .getByTestId("drive-view")
    .or(page.getByRole("tab", { name: "Getting Started with Enso Analytics" }));
  await expect(dashboardReady.first()).toBeVisible({ timeout: 60000 });
}
```

Delete `TEXT` and the `TEXTS` import if ESLint reports them unused.

- [ ] **Step 3: Rewrite the call sites.** `loginAsTestUser` becomes
      `waitForDashboard` in the 4 specs (9 call sites:
      `git grep -n loginAsTestUser -- app/electron-client`). In `globals.d.ts`,
      delete `readonly ENSO_TEST_USER?: string` (L59). In `tests/README.md`,
      delete the "Test account" section.
- [ ] **Step 4: Verify.** This must print nothing:
      `git grep -n "loginAsTestUser\|ENSO_TEST_USER\|ENSO_TEST_CLOUD\|passwordOverride\|playwright/.auth" -- app/electron-client`.
      Then run `corepack pnpm --dir app/electron-client run typecheck`,
      `corepack pnpm --dir app/electron-client run lint` and
      `corepack pnpm --dir app/electron-client exec vitest run tests/headless`.
      The packaged e2e runs in CI in Task 49. To run it locally, use
      `corepack pnpm -r --filter enso ide-integration-test tests/localWorkflow.spec.ts`
      after `./run ide build`.
- [ ] **Step 5: Commit.**
      `git add -A app/electron-client/tests app/electron-client/src/globals.d.ts`,
      then
      `git commit -m "Electron e2e: no cloud account; replace loginAsTestUser with waitForDashboard"`.

### Task 45: Remove `aws-amplify` and `amazon-cognito-identity-js`

**Files**

- Modify: `app/gui/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` and
  `app/gui/vite.config.ts`
- Delete: `patches/@aws-amplify__auth.patch`

**Interfaces**

- Consumes: from PR 2, `src/authentication/` and the Amplify types in
  `providers/session.ts` are gone.
- Produces: a dependency tree with no `aws-amplify`, `@aws-amplify/*` or
  `amazon-cognito-identity-js`.

- [ ] **Step 1: Check that nothing imports them any more:**
      `git grep -n "aws-amplify\|amazon-cognito-identity-js" -- app ':!**/CLAUDE.md'`
      must print only `app/gui/package.json` (L84–85). If source still imports
      them, PR 2 is incomplete. Stop and report it.
- [ ] **Step 2: Remove them.** Run
      `corepack pnpm --dir app/gui remove aws-amplify amazon-cognito-identity-js`.
      In `pnpm-workspace.yaml`, delete the `"@aws-amplify/auth"` entries under
      `packageExtensions` (~L82) and `patchedDependencies` (~L109). Then run
      `git rm patches/@aws-amplify__auth.patch`. Run
      `corepack pnpm why -r @aws-crypto/sha256-browser`, and if it reports
      nothing, delete that `packageExtensions` entry (~L91) too. In
      `vite.config.ts`, delete the
      `define: { 'global.TYPED_ARRAY_SUPPORT': true }` block (~L98–101). Its
      comment says it exists only for aws-amplify.
- [ ] **Step 3: Reinstall from clean** (root CLAUDE.md: a broken install is not
      repaired by re-running install). Run
      `rm -rf node_modules app/*/node_modules && corepack pnpm install`, then
      check that
      `grep -c "aws-amplify\|amazon-cognito\|@aws-amplify" pnpm-lock.yaml`
      prints `0`, and that `corepack pnpm install --frozen-lockfile` succeeds.
- [ ] **Step 4: Verify.**
  - Delete the caches first:
    `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete`, and
    the same for `.eslintcache`.
  - Then run `corepack pnpm -r --if-present run compile`,
    `corepack pnpm --dir app/gui run typecheck`,
    `corepack pnpm --dir app/gui exec vitest run` and
    `corepack pnpm --dir app/gui run build`. The build checks that removing the
    `define` breaks nothing in the bundle.
  - Mapbox (`mapbox-gl`) and Sentry (`@sentry/vue`, `@sentry/vite-plugin`) stay,
    by decision 4:
    `git grep -n '"mapbox-gl"\|"@sentry/vue"' app/gui/package.json` still lists
    both.
- [ ] **Step 5: Commit.**
      `git add app/gui/package.json pnpm-workspace.yaml pnpm-lock.yaml app/gui/vite.config.ts patches`,
      then `git commit -m "Remove aws-amplify and amazon-cognito-identity-js"`.

### Task 46: Remove the cloud build-time variables from the GUI and Electron

**Files**

- Create: `app/gui/src/__tests__/localOnlyConfig.test.ts`
- Modify:
  - `app/gui/.env`, `app/gui/.env.testing`, `app/gui/src/config.ts`,
    `app/gui/src/entrypoint.ts`, `app/gui/src/providers/config.ts` and
    `app/gui/package.json`;
  - `app/electron-client/src/guiConfig.ts`.
- Unchanged (verified by grep): `app/electron-client/src/configParser.ts` (PR 2
  removed `--authentication.*`); `buildInfo.ts`, `esbuildConfig.ts` and
  `macos/build-dmg.mjs` (they read only
  `ENSO_IDE_VERSION`/`ENSO_IDE_COMMIT_HASH`); and `vite.config.ts`,
  `vitest.config.ts` and `playwright.config.ts` (they load `ENSO_IDE_*`
  generically from `.env.testing`).
- Not touched: `app/gui/.dev-env`, a private submodule (`.gitmodules`), so it is
  not in this repo. The spec says not to copy its identifiers anywhere.

**Interfaces**

- Consumes:
  - from PR 1, `providers/config.ts` makes no fetch;
  - from PR 3, `backends.ts` no longer reads `remoteConfig?.ENSO_IDE_API_URL`,
    and `electron-client/src/backend.ts` no longer reads `API_URL`.
- Produces: `$Config` without `API_URL` or `CLOUD_BUILD`; `GUI_CONFIG_KEYS`
  without them; the npm script `build-cloud` is gone.

- [ ] **Step 1: Write the failing test**
      `app/gui/src/__tests__/localOnlyConfig.test.ts`:

```ts
/** @file A local-only build takes no Enso Cloud configuration (local-only IDE, PR 4). */
import { $config } from "$/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const CLOUD_KEYS = [
  "API_URL",
  "AUTH_ENDPOINT",
  "CHAT_URL",
  "CLOUD_BUILD",
  "COGNITO_DOMAIN",
  "COGNITO_REGION",
  "COGNITO_USER_POOL_ID",
  "COGNITO_USER_POOL_WEB_CLIENT_ID",
  "MAPBOX_API_TOKEN",
  "STRIPE_KEY",
];

function envKeys(file: string): string[] {
  const text = readFileSync(
    fileURLToPath(new URL(`../../${file}`, import.meta.url)),
    "utf8",
  );
  return text
    .split("\n")
    .flatMap((line) => /^ENSO_IDE_([A-Z0-9_]+)=/.exec(line)?.slice(1) ?? []);
}

describe("no cloud configuration", () => {
  test.each([".env", ".env.testing"])("%s sets no cloud variable", (file) => {
    expect(envKeys(file).filter((key) => CLOUD_KEYS.includes(key))).toEqual([]);
  });
  test("$config has no cloud key", () => {
    expect(
      Object.keys($config).filter((key) => CLOUD_KEYS.includes(key)),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run**
      `corepack pnpm --dir app/gui exec vitest run src/__tests__/localOnlyConfig.test.ts`.
      It fails: `.env` lists 10 keys, `.env.testing` lists 2, and `$config` has
      `API_URL` and `CLOUD_BUILD`.
- [ ] **Step 3: Implement.**
  - `.env`: delete the `ENSO_IDE_API_URL`, `CHAT_URL`, `CLOUD_BUILD`,
    `COGNITO_DOMAIN`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`,
    `COGNITO_USER_POOL_WEB_CLIENT_ID`, `MAPBOX_API_TOKEN`, `STRIPE_KEY` and
    `AUTH_ENDPOINT` lines.
  - `.env.testing`: delete `ENSO_IDE_API_URL` and `ENSO_IDE_CLOUD_BUILD`.
  - `src/config.ts`: delete `API_URL` and `CLOUD_BUILD` from `DEFAULT_CONFIG`.
  - `entrypoint.ts` `getRootDirPath` (~L121): use
    `const supportsLocalBackend = window.overrideFeatureFlags?.enableLocalBackend ?? true`.
  - `providers/config.ts`:
    - delete any remaining `$config.API_URL` use (L36 before PR 1);
    - delete `ENSO_IDE_API_URL`, `ENSO_IDE_AUTH_ENDPOINT`, `ENSO_IDE_STRIPE_KEY`
      and the four `ENSO_IDE_COGNITO_*` keys from `REMOTE_CONFIG_SCHEMA`, if PR
      1 kept the schema;
    - delete the Sentry `tracePropagationTargets` watch on `ENSO_IDE_API_URL`
      (~L85–108);
    - keep the four `*_OAUTH_CLIENT_ID` keys (decision 5, "for later").
  - `src/secrets/*CredentialsForm.vue` (moved there by PR 2): each
    `config.remoteConfig?.ENSO_IDE_API_URL` argument becomes `undefined`.
    **Ruling needed** below.
  - `app/gui/package.json`: delete the `build-cloud` script (L37).
  - `electron-client/src/guiConfig.ts`: delete `'API_URL'` and `'CLOUD_BUILD'`
    from `GUI_CONFIG_KEYS`. The `_AssertAllGuiConfigKeysCovered` check enforces
    this at compile time.
  - Keep `ENSO_IDE_HOST` / `$config.HOST`. The spec does not list it, and
    `appUtils.ts` (L51) builds the contact URL from it.
- [ ] **Step 4: Run the tests and checks.**
  - Step 2's test passes.
  - This must print nothing:
    `git grep -n "ENSO_IDE_API_URL\|ENSO_IDE_CLOUD_BUILD\|ENSO_IDE_AUTH_ENDPOINT\|ENSO_IDE_COGNITO_\|ENSO_IDE_STRIPE_KEY\|ENSO_IDE_CHAT_URL\|ENSO_IDE_MAPBOX_API_TOKEN\|CLOUD_BUILD\|\$config.API_URL" -- app ':!app/gui/src/__tests__/localOnlyConfig.test.ts' ':!**/CLAUDE.md'`
  - Then run `corepack pnpm -r --if-present run compile`,
    `corepack pnpm --dir app/gui run typecheck`,
    `corepack pnpm --dir app/electron-client run typecheck`,
    `corepack pnpm --dir app/gui exec vitest run` and
    `corepack pnpm --dir app/common run test:unit`, and ESLint and Prettier on
    the touched files.
  - Rerun the Playwright suite once in WSL. `appConfig` comes from
    `.env.testing`, so the injected config shrinks too.
- [ ] **Step 5: Commit.**
      `git add app/gui/.env app/gui/.env.testing app/gui/src app/gui/package.json app/electron-client/src/guiConfig.ts`,
      then
      `git commit -m "Remove the Enso Cloud build-time variables from the GUI and Electron"`.

### Task 47: Build tools and CI: drop the cloud variables and the e2e test account

**Files**

- Modify:
  - `build_tools/build/src/ide/web.rs` (L45–46, L71–72);
  - `build_tools/build/src/ci_gen/job.rs` (L143–146, L1040–1055, L1085–1098, and
    a new `mod tests`);
  - `build_tools/build/src/ci_gen.rs` (`variables`, L151–174).
- Modify (regenerated): `.github/workflows/ide-packaging.yml`,
  `.github/workflows/release.yml`, and whatever else `enso-build-ci-gen`
  rewrites.
- Unchanged: `enable_cloud_tests` (L289), its callers (L394, L704), the
  `secret::ENSO_CLOUD_*` constants it uses, `cloud_tests/`, `enso.rs` and
  `extra-nightly-tests.yml`. These are the standard library cloud jobs, which
  are out of scope.

**Interfaces**

- Consumes: Task 44 (nothing reads `playwright/.auth/user.json`) and Task 46
  (the GUI reads no `ENSO_IDE_MAPBOX_API_TOKEN`).
- Produces: `PackageIde`'s `Package New IDE` job has no `Prepare Package Tests`
  or `Remove Credentials File` step. No GUI build step sets
  `ENSO_IDE_MAPBOX_API_TOKEN`.

- [ ] **Step 1: Write the failing test** at the end of `ci_gen/job.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// The IDE is local-only: packaging and its e2e tests need no Enso Cloud account or token.
    #[test]
    fn ide_jobs_need_no_cloud_account() -> Result {
        for job in [PackageIde.job((OS::Linux, Arch::X86_64)), GuiBuild.job((OS::Linux, Arch::X86_64))] {
            let yaml = serde_yaml::to_string(&job)?;
            for forbidden in [
                "ENSO_TEST_USER",
                "ENSO_CLOUD_TEST_ACCOUNT",
                ".enso/credentials",
                "playwright/.auth",
                "MAPBOX",
            ] {
                assert!(!yaml.contains(forbidden), "`{}` still mentions {forbidden}", job.name);
            }
        }
        Ok(())
    }
}
```

- [ ] **Step 2: Run** `cargo test -p enso-build ci_gen::job::tests`. It fails on
      `ENSO_TEST_USER` in `Package New IDE`. If `serde_yaml` or `Arch` is not in
      scope, add `use ide_ci::prelude::*` or the crate's own import, whichever
      `ci_gen.rs` already uses for them.
- [ ] **Step 3: Implement.**
  - `web.rs`: delete `ENSO_IDE_API_URL` and `ENSO_IDE_MAPBOX_API_TOKEN`, each
    with its doc comment, from `define_env_var!`. Change `ENSO_IDE_HOST`'s doc
    to "The Enso web host, for the contact page link."
  - `job.rs`: in `expose_gui_vars`, delete the `ENSO_MAPBOX_API_TOKEN` exposure.
    In `PackageIde`, delete `test_prepare_step` (L1040–1055) and the
    `cleanup_credentials_step` block with its comment (L1085–1098). Change
    `prepare_packaging_steps`' doc bullet "exposing variables defining cloud
    environment for dashboard" to "exposing the GUI's build variables (host,
    Sentry, Analytics, AG Grid)".
  - `ci_gen.rs` `variables`: delete the constants nothing reads
    (`ENSO_CLOUD_ENVIRONMENT`, `ENSO_CLOUD_API_URL`, `ENSO_CLOUD_CHAT_URL`,
    `ENSO_CLOUD_STRIPE_KEY`, `ENSO_CLOUD_AUTH_ENDPOINT`, the four
    `ENSO_CLOUD_COGNITO_*` and `ENSO_MAPBOX_API_TOKEN`). First confirm with
    `git grep -n "variables::ENSO_CLOUD_\(ENVIRONMENT\|API_URL\|CHAT_URL\|STRIPE_KEY\|AUTH_ENDPOINT\|COGNITO\)\|variables::ENSO_MAPBOX" -- build_tools`
    that it prints nothing. The `secret::ENSO_CLOUD_*` constants stay.
- [ ] **Step 4: Regenerate the workflows** with
      `cargo run --package enso-build-ci-gen`, the command in every workflow's
      preamble. It also runs the workflow formatter. Then check
      `git diff --stat .github/workflows`: only `ide-packaging.yml` (both
      packaging jobs lose the `ENSO_IDE_MAPBOX_API_TOKEN` env line, the
      `Prepare Package Tests` step and the `Remove Credentials File` step) and
      `release.yml` (it loses the three `ENSO_IDE_MAPBOX_API_TOKEN` lines)
      change. If any other workflow changes, find out why before committing.
      This must print nothing:
      `git grep -n "ENSO_IDE_MAPBOX_API_TOKEN\|ENSO_TEST_USER\|playwright/.auth" -- .github build_tools`.
- [ ] **Step 5: Run the tests and checks.**
  - `cargo test -p enso-build` passes, and so does `cargo fmt -- --check`.
  - `cargo clippy -p enso-build -p enso-build-ci-gen` adds no new warnings. This
    is a convention; CI has no clippy job.
  - The Windows `ide-ci` tar failure is known (root CLAUDE.md), so run the
    workspace tests in WSL:
    `wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && export CARGO_TARGET_DIR=$HOME/enso-target && cargo test -p enso-build'`.
- [ ] **Step 6: Commit.** `git add build_tools/build/src .github/workflows`,
      then
      `git commit -m "CI: drop the Mapbox token, the cloud test account and the credentials cleanup from IDE packaging"`.

### Task 48: Docs: a local-only IDE, and decision 6b superseded

**Files**

- Modify:
  - the `CLAUDE.md` files: root, `app/gui`, `app/gui/integration-test`,
    `app/gui/src/dashboard`, `app/electron-client` and `app/common`;
  - `app/electron-client/tests/README.md`, if Task 44 left anything in it;
  - `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.

**Interfaces**

- Consumes: the end state of PRs 1–3 and Tasks 40–47. Each sentence below
  describes what is now true; check it against the code before writing it.
- Produces: docs with no instructions for the cloud, Cognito, the login fixtures
  or the test account.

- [ ] **Step 1: Make the edits.**
  - **Root `CLAUDE.md`, L11:** "a dashboard for project/cloud management" → "a
    dashboard for local projects (the IDE has no Enso Cloud since the local-only
    work; the engine and standard library still support it)".
  - **`app/gui/CLAUDE.md`:**
    - the intro: "served by Electron (desktop) or a static host (cloud)" →
      "served by Electron";
    - Scripts: delete `build-cloud` and the `ENSO_IDE_CLOUD_BUILD` mention;
    - "Dashboard ↔ backend": delete the Enso Cloud / Amplify / Cognito sentence,
      and list the categories as Local, Recent and the added folders;
    - delete any `src/cloud/` paragraph PR 2 left.
  - **`integration-test/CLAUDE.md`:**
    - `mock/`: "Mocks for the local backend (`localApi.ts`), the Language
      Server, feature flags and the Electron API". `base.ts`'s line no longer
      says "auth'd page";
    - delete `--project=Setup` from Run;
    - delete the "mocked Cognito can ask for a one-time code" caveat;
    - the accessibility section lists three screens (drive, settings, asset
      panel, the asset panel now scanned on the Documentation tab), and the ARIA
      snapshot paragraph says the user menu holds only local items;
    - add a bullet under Writing tests: "**No cloud requests.** The auto fixture
      `cloudRequests` (`base.ts`) aborts every request matching `CLOUD_URL`
      (`mock/registerMocks.ts`) and fails the test that made it. Local data
      comes from `localApi` (`addRootDirectory`, `addRootFile`,
      `addRootProject`, `addProjectSources`)";
    - in the `data-testid` list, delete `agreements-modal` and
      `upsert-secret-modal`;
    - in the Electron e2e flows of the port checklist, delete the login form,
      the terms dialog, the Cloud category button, the Members tab and every
      `cloudWorkflow.spec.ts` reference, and rename `loginAsTestUser` to
      `waitForDashboard`.
  - **`src/dashboard/CLAUDE.md`:**
    - L3–4 intro: "settings and the local drive";
    - replace the "Auth / cloud" section (L55–61) with one paragraph: "There is
      no sign-in. The session is the local user (`$/providers/session`)";
    - delete the `src/cloud/<area>/` bullets (~L96–99).
  - **`app/electron-client/CLAUDE.md`:**
    - delete L26's `enso://` protocol bullet;
    - in the submodule paragraph (L56–66), delete the Cognito, staging-cloud and
      login-screen failure text, and say only that `.dev-env` is a private
      submodule which a fresh worktree must initialise for the
      `.env.staging`/`.env.production` symlinks;
    - L79: drop "when running against a cloud backend" from
      `ENSO_POLYGLOT_YDOC_SERVER` if PR 3 left no cloud use of it (check with
      `git grep -n ENSO_POLYGLOT_YDOC_SERVER -- app`);
    - L607–611: "(dashboard → project → graph editor)", `waitForDashboard`, and
      no credentials prerequisite.
  - **`app/common/CLAUDE.md`:**
    - delete the `accessToken.ts` bullet if PR 2/3 deleted the file;
    - `src/services/` has `Backend` and its single implementation `LocalBackend`
      (decision 3);
    - delete "except a hybrid project's (a cloud project's local copy)".
  - **The foundations spec:** in the Summary table's 6b row, change the status
    cell to "Superseded 2026-10-17 by `2026-10-17-local-only-ide-design.md` (the
    cloud code was deleted, not separated)". Under
    `### 6b. Keeping cloud-only ports separable` (L566), insert:

```md
> **Superseded (2026-10-17).** The IDE no longer has Enso Cloud: the cloud-only
> areas were deleted, not split out
> (`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`, decision 1).
> `src/cloud/`, `registerCloud` and the `CLOUD_AREAS` lint boundary are gone;
> the text below is kept as the record of the earlier decision.
```

- [ ] **Step 2: Verify.** This must print only the root `CLAUDE.md`'s Engine
      lines (`Cloud_Tests` fixtures) and the foundations spec's historical text:
      `git grep -n -i "cognito\|amplify\|loginAsTestUser\|registerCloud\|src/cloud/\|build-cloud" -- '*.md' ':!docs/superpowers/specs/2026-10-17-local-only-ide-design.md' ':!CHANGELOG.md' ':!docs/superpowers/plans'`.
      Then run `corepack pnpm exec prettier --check` on the touched `.md` files.
- [ ] **Step 3: Commit.**
      `git add CLAUDE.md app/gui/CLAUDE.md app/gui/integration-test/CLAUDE.md app/gui/src/dashboard/CLAUDE.md app/electron-client/CLAUDE.md app/electron-client/tests/README.md app/common/CLAUDE.md docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`,
      then
      `git commit -m "Docs: the IDE is local-only; mark foundations decision 6b superseded"`.

### Task 49: Verify, open the PR, and get it installer-tested

**Files**: none.

**Interfaces**

- Consumes: Tasks 40–48 (or 44–48 if Tasks 40–43 went into PR 3, per the
  ordering ruling).
- Produces: a PR to `develop` with the `CI: No changelog needed` and
  `CI: Build IDE` labels.

- [ ] **Step 1: Run the spec's verification list ("Verification (each PR)").**
  - Delete the `*.tsbuildinfo` and `.eslintcache` caches.
  - Then run `corepack pnpm -r --if-present run compile`,
    `corepack pnpm run ci:typecheck`, `corepack pnpm run ci:lint` and
    `corepack pnpm run ci:prettier`.
  - Run the unit tests: `corepack pnpm --dir app/gui exec vitest run`,
    `corepack pnpm --dir app/common run test:unit` and
    `corepack pnpm --dir app/project-manager-shim run test:unit`.
  - Playwright, on Linux in WSL with `. ~/.enso-toolchain.sh`, after
    `corepack pnpm -r --if-present run compile` (stale `dist/` trap): run
    `corepack pnpm --dir app/gui run test:integration` 3 times. Compare the
    per-spec pass rates with `develop`'s, measured the same way, and
    accessibility must pass. Then run the touched specs once on native Windows.
  - Rust: `cargo fmt -- --check`, and in WSL `cargo test --workspace` with its
    own `CARGO_TARGET_DIR`.
  - Check that the workflows are current: rerunning
    `cargo run --package enso-build-ci-gen` must leave `git status` clean.
  - Run the `git grep` for each removed variable and each old name from Tasks
    41–47 again, over the whole repo. Each must print nothing outside the
    standard library, the engine, `CHANGELOG.md`, `docs/cloud/` and the specs.
- [ ] **Step 2: Push and open the PR.** Run
      `git push -u origin feature/local-only-prune`, then
      `gh pr create --base develop --title "Local-only IDE, PR 4: prune cloud tests, dependencies and build configuration" --label "CI: No changelog needed" --label "CI: Build IDE"`.
      The body (ending with the attribution lines) covers:
  - **Summary**, one paragraph per area: tests, dependencies, configuration, CI,
    docs.
  - **Specs**: the classification from Tasks 41–43 (ported, deleted with the
    reason, kept), and why `copyInstead` and `exportAsset` are deleted though
    the spec listed them as mixed.
  - **Accessibility**: the baseline diff, per screen, with every added entry
    explained; `login.json` deleted; and the three ARIA snapshot changes (user
    menu, settings sidebar, the asset panel now on Docs).
  - **CI**: the regenerated workflow diff. The `ENSO_MAPBOX_API_TOKEN`
    repository variable and the `ENSO_CLOUD_TEST_ACCOUNT_*` secrets can be
    removed from the repository settings once the standard library cloud jobs
    stop needing the secrets. For now they still do, so the secrets stay.
  - **What this did not verify** (root CLAUDE.md): the stdlib cloud test jobs
    (left untouched), and the release workflow, which runs only on release.
  - "Closes" lines for the PR 4 ticket, and the epic sweep (memory: close
    tickets on merge).
- [ ] **Step 3: Watch CI** with `gh` and `--jq`, time-capped, exiting on
      completion. `Package New IDE` must pass on Linux and Windows, with no
      `Prepare Package Tests` step. If a Playwright shard fails, check whether
      `develop` fails the same way before blaming the PR. While CI runs, start
      the next ticket (memory: work while CI runs).
- [ ] **Step 4: Installer test (decision 2).** Build a Windows installer
      (memory: local Windows installer build). Hand it to the user with this
      checklist:
  - no login screen;
  - the app starts on Local;
  - projects open, save and version;
  - Settings has no cloud sections;
  - with the network disconnected, no cloud request is made and nothing errors;
  - a GeoMap visualisation shows the Mapbox-token empty state until a token is
    set in Settings → Local → Maps.

  Merge only after the user's OK, retargeting any stacked child first.
