# A Standard Installer and Automatic Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom Rust Windows installer with electron-builder's NSIS
target, publish IDE-only GitHub Releases from the fork, and make the app update
itself with `electron-updater`.

**Architecture:** electron-builder produces every installer: NSIS on Windows,
AppImage on Linux, and dmg plus zip on macOS. It also writes `latest*.yml` and
blockmaps for releases. The build CLI uploads them to a draft GitHub Release
that `release.yml` publishes. In the Electron main process, an `Updater` class
wraps `electron-updater`. It talks to the GUI's version-check dialog over IPC,
and an `auto | manual` mode decides whether the app updates itself or falls back
to today's download link.

**Tech Stack:**

- **Packaging and updates:** electron-builder 26.8.1 (NSIS, AppImage, dmg/zip)
  and `electron-updater` 6.8.x, in TypeScript with vitest.
- **GUI:** Vue 3 with `@tanstack/vue-query`.
- **Build CLI and workflow generator:** Rust (`build_tools/build`, `ci_gen`,
  `build_tools/cli`).
- **CI:** GitHub Actions, plus PowerShell for the Windows smoke step.

**Spec:**
`docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md` (PR
#252). Read it before starting any task.

## Global Constraints

- **Install location:** per-user under `%LOCALAPPDATA%\Programs\`, in the same
  folder the Rust installer used. Windows paths are case-insensitive, so NSIS's
  `enso` and the Rust installer's `Enso` are the same folder. No admin rights.
- **Feed:** GitHub Releases on `jdunkerley/enso`, through the `github` provider.
  electron-builder never uploads; the build passes `publish: 'never'`.
- **Update UX:** ask, then download. `autoDownload: false`,
  `autoInstallOnAppQuit: true`.
- **Channels:** stable by default. The "Include prerelease versions" setting
  opts into GitHub prereleases. `-dev` builds are always `manual`.
- **Signing is optional everywhere.** Builds must succeed with no secrets. macOS
  is `auto` only when it was signed (`CSC_LINK` set); otherwise it is `manual`
  and no `.zip` or `latest-mac.yml` is produced.
- **Blockmaps and `latest*.yml` are produced only on release builds**, when
  `ENSO_BUILD_UPDATE_INFO=true`. PR builds skip them.
- **`release.yml` needs only `GITHUB_TOKEN`.** No AWS, ECR or cloud secrets
  remain in any release job.
- **Pins:** `electron-updater` is pinned exactly, to the 6.8.x release whose
  `builder-util-runtime` dependency matches electron-builder 26.8.1's (`9.5.x`).
  `electron-builder` stays at 26.8.1, which is pinned by its patch.
- **Repo rules** (root `CLAUDE.md`):
  - Use `corepack pnpm`.
  - Verify on Linux (WSL) as well as Windows.
  - Delete `*.tsbuildinfo` and `.eslintcache` before trusting a typecheck after
    a dependency change.
  - CHANGELOG entries only for PR 1 and PR 3; PR 2 takes the
    `CI: No changelog needed` label.
- **Merge gate:** each PR waits for the user's installer test before merging.
- **Workflows are generated.** Never edit
  `.github/workflows/{release,promote, nightly,ide-packaging}.yml` by hand.
  Change `build_tools/build/src/ci_gen*` and run
  `cargo run --package enso-build-ci-gen`, which needs `corepack pnpm` on PATH
  because it runs prettier.
- **Never use `git stash`.** Every task commits on its own branch.

## Branches and worktrees

Base everything on `origin/develop` **after** the local-only merge train (#251,
#246, #248, #250) has landed. `git log origin/develop` must show #250 before you
start.

| PR  | Branch                     | Worktree                    |
| --- | -------------------------- | --------------------------- |
| 1   | `feature/nsis-installer`   | `C:\Repos\Enso\ide-nsis`    |
| 2   | `feature/ide-only-release` | `C:\Repos\Enso\ide-release` |
| 3   | `feature/auto-update`      | `C:\Repos\Enso\ide-updater` |

PR 2 and PR 3 are each based on the previous PR's branch. Retarget each to
`develop` before merging its parent (memory: stacked-pr-merge-order).

In each new worktree, run `corepack pnpm install --frozen-lockfile` first. The
postinstall step generates parsers and icons the build needs.

## File map

**PR 1: NSIS replaces the Rust installer**

- Modify `app/electron-client/electron-builder-config.ts`: NSIS target,
  `publish`, blockmap switch, macOS zip, `publisherName`; remove the MSI and
  `enso-installer` extras.
- Create `app/electron-client/build/installer.nsh`: migration from the Rust
  installer.
- Create `app/electron-client/tests/headless/electronBuilderConfig.test.ts`.
- Modify `build_tools/build/src/ide/web.rs`: drop the bundler step and the
  `ENSO_BUILD_ELECTRON_BUILDER_CONFIG` env var.
- Modify `build_tools/build/Cargo.toml` and the root `Cargo.toml`: drop
  `enso-install*`.
- Delete `build_tools/install/` (4 crates).
- Modify `build_tools/ci_utils/src/env/known/electron_builder.rs` and delete
  `build_tools/ci_utils/src/programs/signtool.rs`, if they are only used by the
  bundler.
- Create `tools/ci/windows-installer-smoke.ps1`.
- Modify `build_tools/build/src/ci_gen/job.rs`: the smoke step in `PackageIde`
  on Windows, plus a test. Regenerate `ide-packaging.yml`.
- Docs: `app/electron-client/CLAUDE.md`, `build_tools/CLAUDE.md` (if it lists
  `install`), `CHANGELOG.md`.

**PR 2: the IDE-only `release.yml`**

- Modify `build_tools/build/src/project/ide.rs`: `Artifact::update_files`.
- Modify `build_tools/cli/src/lib.rs`: `upload_ide_assets` uploads the update
  files.
- Modify `build_tools/build/src/release.rs` and `release/manifest.rs`, and the
  `release-body.md` template: IDE-only publish, no S3 or ECR.
- Delete `build_tools/build/src/aws.rs`, `build_tools/build/src/aws/`, and
  `build_tools/build/src/repo/cloud.rs`.
- Modify `build_tools/build/src/lib.rs` (`pub mod aws`),
  `build_tools/build/Cargo.toml` (the `aws-*` deps), and
  `build_tools/cli/src/arg/release.rs` plus its dispatch (`DeployRuntime`,
  `DispatchBuildImage`).
- Modify `build_tools/build/src/ci_gen.rs` and `ci_gen/job.rs`: the new
  `add_release_steps`, removed jobs and secrets, and a test.
- Delete `.github/workflows/release-update-broken.yml`, the scripts in
  `tools/ci/releases/`, and `tools/ci/docker/engine/`, after checking nothing
  else uses them.
- Modify the root `CLAUDE.md`, which lists `tools/ci/docker/engine/Dockerfile`
  as a version site.

**PR 3: the updater**

- Create `app/common/src/updater.ts`: shared types.
- Create `app/electron-client/src/updater.ts`: the `Updater` class and
  `resolveUpdateMode`.
- Create `app/electron-client/src/updaterIpc.ts`: IPC wiring.
- Modify `app/electron-client/src/ipc.ts`, `src/preload.ts`, `src/electron.ts`,
  `buildInfo.ts`, `esbuildConfig.ts` and `package.json`.
- Create `app/electron-client/tests/headless/updater.test.ts`.
- Modify `build_tools/build/src/ide/web.rs`: `ENSO_IDE_UPDATES`, plus a test.
- Modify `app/gui/src/electronApi.ts`: `UpdaterApi`.
- Create `app/gui/src/providers/updateSettings.ts`.
- Create `app/gui/src/dashboard/layouts/Settings/UpdatesSettingsSection.vue`,
  and modify `Settings/tabs.ts` and `app/common/src/text/english.json`.
- Create `app/gui/src/versionChecker/appUpdate.ts`, and modify
  `VersionChecker.vue` and `__tests__/VersionChecker.test.ts`.
- Modify `CHANGELOG.md`.

---

## Phase 0: Spike (throwaway, nothing merged)

### Task 1: Measure NSIS with the real bundle

**Files:** none committed. Keep scratch output under `<scratchpad>/nsis-spike/`.

- [ ] **Step 1: Make a throwaway worktree off `origin/develop`**

```powershell
git -C C:\Repos\Enso\ide worktree add -b spike/nsis C:\Repos\Enso\ide-spike origin/develop
cd C:\Repos\Enso\ide-spike; corepack pnpm install --frozen-lockfile
```

- [ ] **Step 2: Switch the Windows target to NSIS, with blockmaps**

In `app/electron-client/electron-builder-config.ts`:

- Change `target: targetFor('win', 'dir')` to `targetFor('win', 'nsis')`.
- Replace the `nsis` block with
  `{ oneClick: true, perMachine: false, differentialPackage: true, runAfterFinish: false }`.
- Replace `publish: null` with
  `publish: { provider: 'github', owner: 'jdunkerley', repo: 'enso' }`.
- In `buildPackage`, add `publish: 'never'` to `cliOpts`.

- [ ] **Step 3: Build with timing**

Use the recipe from memory `local-windows-installer-build` (inside
`vcvars64.bat`, with `ENSO_LAUNCHER=native`), but keep the Rust bundler out of
it: comment out the `if TARGET_OS == OS::Windows { … }` block in
`build_tools/build/src/ide/web.rs`.

```
cmd /c "call "C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul && set ENSO_LAUNCHER=native&& cd /d C:\Repos\Enso\ide-spike && cargo run -p enso-build-cli -- ide build --backend-source build --gui-source build --gui-upload-artifact false"
```

Record:

- the wall time of the electron-builder step (from its log)
- the size of `dist/ide/enso-win-x64-*.exe`
- whether `dist/ide/enso-win-x64-*.exe.blockmap` and `dist/ide/latest.yml` exist

Then rebuild with `differentialPackage: false` and record the time again.

- [ ] **Step 4: Install over the current Rust-installed Enso, timed**

First close Enso. Then:

```powershell
Measure-Command { Start-Process dist\ide\enso-win-x64-*.exe -ArgumentList '/S' -Wait }
Get-ChildItem "$env:LOCALAPPDATA\Programs" | Where-Object Name -match 'enso'
Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object DisplayName -like 'Enso*' | Select-Object PSChildName, DisplayName, InstallLocation, QuietUninstallString
Get-ChildItem HKCU:\Software\Classes | Where-Object Name -match 'enso' | Select-Object Name
(Get-ItemProperty 'HKCU:\Software\Classes\.enso').'(default)'
```

Record:

- the install time (for comparison, the Rust installer took about 14 s on
  2026-10-18: see the timestamps in `%TEMP%\enso-installer-*.log`)
- the install folder name
- the uninstall key name and its `QuietUninstallString`
- the ProgID NSIS uses for `.enso`

- [ ] **Step 5: Measure the differential download**

1. Bump the version (`set ENSO_VERSION=2026.1.2-dev` or equivalent) and change
   one GUI string.
2. Rebuild, then compare the two blockmaps with `app-builder-lib`'s
   `computeBlockMapDifference` script. Alternatively, serve both builds with
   `npx http-server`, point a test copy of `app-update.yml` at it with
   `provider: generic`, and read `electron-updater`'s log line
   `Full: X MB, To download: Y MB`.
3. Record Y.

- [ ] **Step 6: Check the bundled main process loads `electron-updater`**

In the spike, add `import electronUpdater from 'electron-updater'` and
`console.info('[Updater] loaded', typeof electronUpdater.autoUpdater)` to
`app/electron-client/src/index.ts`, plus the dependency. Rebuild and run the
installed app. Then check `%APPDATA%\Enso\logs` for the line, and that no
`Cannot find module` error appears. The main process is bundled by esbuild and
`node_modules` is excluded from the asar, so this proves bundling works.

- [ ] **Step 7: Report and decide**

Write the numbers into the ledger
(`.superpowers/sdd/2026-10-18-standard-installer/progress.md` in the PR 1
worktree) and report them to the user.

**Stop and ask the user before Task 2** if any of these is true:

- install time is over 3× the Rust installer's
- blockmap generation adds over 20 minutes
- the differential download is over 50% of the full size
- the bundled `electron-updater` failed to load

Otherwise carry the measured ProgID name and uninstall key into Task 3. Then
remove the spike worktree and branch:
`git worktree remove --force C:\Repos\Enso\ide-spike; git branch -D spike/nsis`.

---

## PR 1: NSIS replaces the Rust installer

### Task 2: electron-builder config for NSIS, the update feed and blockmaps

**Files:**

- Modify: `app/electron-client/electron-builder-config.ts`
- Create: `app/electron-client/tests/headless/electronBuilderConfig.test.ts`

**Interfaces:**

- Produces: `createElectronBuilderConfig(args)` returns:
  - `win.target` `'nsis'` and `nsis.include` `'build/installer.nsh'`
  - `publish` set to `{ provider: 'github', owner: 'jdunkerley', repo: 'enso' }`
  - `nsis.differentialPackage === (process.env.ENSO_BUILD_UPDATE_INFO === 'true')`
  - macOS `target` is `['dmg', 'zip']` when `CSC_LINK` is set and `args.sign` is
    true, else `'dmg'`
- Produces: `buildPackage` passes `publish: 'never'`.
- Produces the env var `ENSO_BUILD_UPDATE_INFO`, which PR 2's release jobs set
  to `true`.

- [ ] **Step 1: Write the failing test**

`app/electron-client/tests/headless/electronBuilderConfig.test.ts`:

```ts
/** @file The electron-builder configuration: installer targets, the update feed and blockmaps. */
import * as electronBuilder from "electron-builder";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

type ConfigModule = typeof import("../../electron-builder-config");
let configModule: ConfigModule;

beforeAll(async () => {
  // `args` is parsed from `ENSO_BUILD_*` when the module loads, and these three are required.
  process.env.ENSO_BUILD_IDE = "dist/ide";
  process.env.ENSO_BUILD_GUI = "dist/gui";
  process.env.ENSO_BUILD_BACKEND = "dist/backend";
  configModule = await import("../../electron-builder-config");
});

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of [
    "ENSO_BUILD_UPDATE_INFO",
    "CSC_LINK",
    "ENSO_BUILD_WIN_PUBLISHER_NAME",
  ]) {
    if (savedEnv[key] == null) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, savedEnv[key]);
  }
});

function configFor(platform: electronBuilder.Platform, sign = true) {
  return configModule.createElectronBuilderConfig({
    ...configModule.args,
    platform,
    sign,
  });
}

describe("Windows", () => {
  test("builds a per-user, one-click NSIS installer with the migration script", () => {
    const config = configFor(electronBuilder.Platform.WINDOWS);
    expect(config.win?.target).toBe("nsis");
    expect(config.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      include: "build/installer.nsh",
    });
  });

  test("writes blockmaps only for release builds", () => {
    expect(
      configFor(electronBuilder.Platform.WINDOWS).nsis?.differentialPackage,
    ).toBe(false);
    process.env.ENSO_BUILD_UPDATE_INFO = "true";
    expect(
      configFor(electronBuilder.Platform.WINDOWS).nsis?.differentialPackage,
    ).toBe(true);
  });

  test("verifies the update publisher only when one is configured", () => {
    expect(
      configFor(electronBuilder.Platform.WINDOWS).win?.signtoolOptions
        ?.publisherName,
    ).toBe(undefined);
    process.env.ENSO_BUILD_WIN_PUBLISHER_NAME = "Example Ltd";
    expect(
      configFor(electronBuilder.Platform.WINDOWS).win?.signtoolOptions
        ?.publisherName,
    ).toBe("Example Ltd");
  });
});

describe("macOS", () => {
  test("builds the update zip only when signed", () => {
    expect(configFor(electronBuilder.Platform.MAC).mac?.target).toBe("dmg");
    process.env.CSC_LINK = "certificate";
    expect(configFor(electronBuilder.Platform.MAC).mac?.target).toEqual([
      "dmg",
      "zip",
    ]);
    expect(configFor(electronBuilder.Platform.MAC, false).mac?.target).toBe(
      "dmg",
    );
  });
});

test("the update feed is the fork’s GitHub Releases", () => {
  expect(configFor(electronBuilder.Platform.LINUX).publish).toEqual({
    provider: "github",
    owner: "jdunkerley",
    repo: "enso",
  });
});

test("carries no metadata for the removed Rust installer", () => {
  const config = configFor(electronBuilder.Platform.WINDOWS);
  expect(config.extraMetadata).toEqual({ version: expect.any(String) });
  expect(config).not.toHaveProperty("msi");
});
```

- [ ] **Step 2: Run it and check it fails**

Run:
`cd app/electron-client && corepack pnpm exec vitest run tests/headless/electronBuilderConfig.test.ts`

Expected: FAIL, with `win.target` being `'dir'`, `publish` being `null`, and
`extraMetadata.installer` present.

- [ ] **Step 3: Implement**

In `app/electron-client/electron-builder-config.ts`:

1. Delete the `ExtendedFileAssociation` and `InstallerAdditionalConfig`
   interfaces and `getInstallerAdditionalConfig()`.
2. Rename `EXTENDED_FILE_ASSOCIATIONS` to `FILE_ASSOCIATIONS`, typed
   `electronBuilder.FileAssociation[]`. Drop the `progId` fields, and drop the
   comment about the MIME type being used by the `enso-installer`.
3. Make `getFileAssociations()` return `FILE_ASSOCIATIONS`.
4. In `createElectronBuilderConfig`:
   - Remove the MSI version-number block (`if (passedArgs.target === 'msi')`).
     Use `BUILD_INFO.version` directly.
   - Set `extraMetadata: { version: BUILD_INFO.version }`.
   - Simplify the `artifactName` comment, which mentioned MSI.
   - Set
     `mac.target: targetFor('mac', isMacSigned(passedArgs) ? ['dmg', 'zip'] : 'dmg') as any`,
     with this helper (`targetFor`'s `platformDefault` parameter widens to
     `string | string[]`):

     ```ts
     /** macOS updates need a signed app: build the update zip only when signing. */
     function isMacSigned(passedArgs: Arguments) {
       return (
         passedArgs.sign &&
         process.env.CSC_LINK != null &&
         process.env.CSC_LINK !== ""
       );
     }
     ```

   - Set `win` to:

     ```ts
     win: {
       target: targetFor('win', 'nsis'),
       icon: `./assets/icons/icon.ico`,
       // With a signing certificate, `electron-updater` refuses an update signed by anyone else.
       ...(process.env.ENSO_BUILD_WIN_PUBLISHER_NAME ?
         { signtoolOptions: { publisherName: process.env.ENSO_BUILD_WIN_PUBLISHER_NAME } }
       : {}),
     },
     ```

   - Delete the `msi` block. Replace the `nsis` block with:

     ```ts
     nsis: {
       // Per-user, so no admin rights; installs to `%LOCALAPPDATA%\Programs\enso`, the folder the
       // former Rust installer used.
       oneClick: true,
       perMachine: false,
       runAfterFinish: true,
       // Migrates an install made by the Rust installer (see the file).
       include: 'build/installer.nsh',
       // Blockmaps let `electron-updater` download only the changed blocks. They are needed only
       // for releases, and cost build time, so PR builds skip them.
       differentialPackage: process.env.ENSO_BUILD_UPDATE_INFO === 'true',
     },
     ```

   - Rewrite the `dmg` block's `writeUpdateInfo` comment: macOS updates come
     from the zip, not the dmg.
   - Replace `publish: null` with:

     ```ts
     // The update feed baked into the app (`app-update.yml`) and written as `latest*.yml`.
     // electron-builder never uploads: the build CLI does (see `buildPackage`).
     publish: { provider: 'github', owner: 'jdunkerley', repo: 'enso' },
     ```

5. In `buildPackage`, set
   `const cliOpts: electronBuilder.CliOptions = { config, targets: passedArgs.platform.createTarget(), publish: 'never' }`.
6. Remove the `ENSO_BUILD_ELECTRON_BUILDER_CONFIG` branch:
   `const configPath = \`${passedArgs.ideDist}/electron-builder-config.yaml\``. Update the comment on `dumpConfiguration`
   (now debugging only) and on that line.

- [ ] **Step 4: Run the test and the typecheck**

```bash
cd app/electron-client && corepack pnpm exec vitest run tests/headless/electronBuilderConfig.test.ts
corepack pnpm exec tsc --noEmit -p .
```

Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add app/electron-client/electron-builder-config.ts app/electron-client/tests/headless/electronBuilderConfig.test.ts
git commit -m "Build the Windows installer with NSIS and configure the GitHub update feed"
```

### Task 3: Migrate installs made by the Rust installer

**Files:**

- Create: `app/electron-client/build/installer.nsh`
- Modify: `app/electron-client/package.json`, only if `build/` is not already
  included in what electron-builder sees. It reads `include` relative to the
  project directory, so nothing should be needed.

**Interfaces:**

- Consumes: the `nsis.include` from Task 2, plus the spike's measured ProgID and
  install folder (Task 1, Step 4).

- [ ] **Step 1: Write the script**

`app/electron-client/build/installer.nsh`:

```nsis
; Migrates an install made by the Rust installer that NSIS replaced in 2026-10
; (docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md).
;
; The Rust installer wrote its own uninstall key, `App Paths` entry and ProgIDs, which NSIS does
; not know about. Its files must go before NSIS copies the new ones: the app finds its engine by
; globbing `resources\enso\dist\*\bin`, so a leftover `dist\<old version>` could start the wrong
; engine. User data lives elsewhere (`%APPDATA%\Enso`, `%LOCALAPPDATA%\enso`).

!define RUST_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Enso"

!macro customInit
  ReadRegStr $0 HKCU "${RUST_UNINSTALL_KEY}" "InstallLocation"
  ; Only ever the folder the Rust installer used (`StrCmp` ignores case).
  ${If} $0 != ""
  ${AndIf} $0 == "$LOCALAPPDATA\Programs\Enso"
    ; A running executable cannot be deleted, which makes this the "is Enso running?" check.
    ClearErrors
    Delete "$0\Enso.exe"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Please close Enso, then run the installer again." /SD IDOK
      Quit
    ${EndIf}
    RMDir /r "$0"
    DeleteRegKey HKCU "${RUST_UNINSTALL_KEY}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Enso.exe"
    DeleteRegKey HKCU "Software\Classes\Enso.Source"
    DeleteRegKey HKCU "Software\Classes\Enso.ProjectBundle"
  ${EndIf}
!macroend
```

If the spike found that NSIS registers its associations under the same ProgIDs
(`Enso.Source`, `Enso.ProjectBundle`), delete the two `Software\Classes\Enso.*`
lines; NSIS rewrites them. Otherwise keep them.

- [ ] **Step 2: Build and run the migration check**

1. Install the current Rust-built installer first:
   `C:\Repos\Enso\ide-lo4\dist\ide\enso-win-x64-2026.1.1-dev.exe` if it still
   exists, otherwise build one from `develop` with the recipe in memory
   `local-windows-installer-build`.
2. Build the NSIS installer with the same recipe, from this worktree.
3. With Enso **running**, run the NSIS installer. Expected: the "Please close
   Enso" message, and nothing changed.
4. Close Enso and run it again. Then check:

```powershell
Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object DisplayName -like 'Enso*' | Select-Object PSChildName, DisplayName
Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Enso'          # expected False
Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Enso.exe'     # expected False
(Get-ChildItem "$env:LOCALAPPDATA\Programs\enso\resources\enso\dist").Count         # expected 1
Test-Path "$env:LOCALAPPDATA\Programs\enso\enso-uninstaller.exe"                    # expected False
```

Expected: exactly one `Enso …` uninstall entry (the GUID-named one).

5. Open a `.enso` file from Explorer. Expected: it opens in Enso.

- [ ] **Step 3: Commit**

```bash
git add app/electron-client/build/installer.nsh
git commit -m "Migrate installs made by the Rust installer to NSIS"
```

### Task 4: Remove the Rust installer from the build

**Files:**

- Modify: `build_tools/build/src/ide/web.rs` (around 202–287)
- Modify: `build_tools/build/Cargo.toml`, root `Cargo.toml` (workspace members),
  `Cargo.lock`
- Delete: `build_tools/install/`
- Modify or delete: `build_tools/ci_utils/src/env/known/electron_builder.rs`
  (`WindowsSigningCredentials`) and
  `build_tools/ci_utils/src/programs/signtool.rs`

**Interfaces:**

- Produces: on Windows, `./run ide build` leaves
  `dist/ide/enso-win-x64-<ver>.exe` and its `.sha256` from electron-builder,
  written by `tasks/computeHashes.ts` as on the other platforms.

- [ ] **Step 1: Delete the bundler branch and the config env var**

In `build_tools/build/src/ide/web.rs` `dist()`:

- Delete
  `.set_env(enso_install_config::ENSO_BUILD_ELECTRON_BUILDER_CONFIG, &electron_config)?`.
- Delete the `let electron_config = output_path.join("electron-builder.json");`
  line if it is now unused.
- Delete the whole `// On Windows we build our own installer …`
  `if TARGET_OS == OS::Windows { … }` block, so that `dist()` ends with
  `.run_ok().await?; Ok(())`.
- Remove the now-unused imports (`WindowsSigningCredentials`,
  `store_sha256_checksum` if unused, `enso_install_config`).

- [ ] **Step 2: Delete the crates**

```bash
git rm -r build_tools/install
```

Then remove `enso-install-config` from `build_tools/build/Cargo.toml`, and the
four `build_tools/install*` members from the root `Cargo.toml`'s `[workspace]`
`members`.

- [ ] **Step 3: Remove the signing code only the bundler used**

```bash
git grep -n "WindowsSigningCredentials\|programs::signtool\|SignTool" -- build_tools
```

For each item with no remaining users:

- Delete `WindowsSigningCredentials` and its `impl` from
  `ci_utils/src/env/known/electron_builder.rs`.
- Delete `ci_utils/src/programs/signtool.rs` and its `pub mod signtool;` line.

Keep `CI_CSC_SECRETS`, `CscLink` and anything `RemoveEmptyCscEnvVars` or
`ci_gen` still uses. electron-builder signs Windows itself from `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD`.

- [ ] **Step 4: Build, test, lint**

```bash
cargo build -p enso-build-cli
cargo test -p enso-build -p ide-ci
cargo fmt -- --check
cargo clippy -p enso-build -p enso-build-cli -p ide-ci 2>&1 | grep -E "^(warning|error)" | sort | uniq -c
```

Expected:

- build and tests pass, except `ide-ci`'s known Windows failure
  `programs::tar::tests::test_directory_packing` (root `CLAUDE.md`)
- fmt is clean
- clippy reports no new warnings in the touched crates

Repeat the build and tests in WSL (root `CLAUDE.md` command, with its own
`CARGO_TARGET_DIR`).

- [ ] **Step 5: Full Windows build**

Run the build recipe from memory `local-windows-installer-build`, unchanged. Its
notes about the Rust bundler no longer apply. Expected:

- `dist/ide/enso-win-x64-<ver>.exe` and `.sha256` exist
- there is no `payload.tar.gz` and no `enso-uninstaller.exe` in `win-unpacked`

Then run Task 5's smoke script against it.

- [ ] **Step 6: Commit**

```bash
git add -A build_tools Cargo.toml Cargo.lock
git commit -m "Remove the custom Rust installer: electron-builder builds the Windows installer"
```

### Task 5: Windows installer smoke step in PR CI

**Files:**

- Create: `tools/ci/windows-installer-smoke.ps1`
- Modify: `build_tools/build/src/ci_gen/job.rs` (`PackageIde`, about 988–1069,
  and the `tests` module at about 1121)
- Regenerate: `.github/workflows/ide-packaging.yml`

**Interfaces:**

- Consumes: the installer at `dist/ide/enso-win-x64-*.exe` (Task 4).

- [ ] **Step 1: Write the script**

`tools/ci/windows-installer-smoke.ps1`:

```powershell
<#
.SYNOPSIS
  Installs the IDE silently, checks it is registered and starts, then uninstalls it.
  This is the check that would have caught the installer that exited on launch (#251).
#>
param([Parameter(Mandatory)] [string] $Installer)
$ErrorActionPreference = 'Stop'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'

function Get-EnsoUninstallEntry {
  Get-ChildItem $uninstallRoot | ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Enso*' } | Select-Object -First 1
}

$installer = (Resolve-Path $Installer).Path
Write-Host "Installing $installer"
$process = Start-Process $installer -ArgumentList '/S' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "The installer exited with $($process.ExitCode)." }

$entry = Get-EnsoUninstallEntry
if ($null -eq $entry) { throw 'The installer wrote no uninstall entry.' }
$exe = Join-Path $entry.InstallLocation 'Enso.exe'
if (-not (Test-Path $exe)) { throw "Enso.exe is missing: $exe" }

Write-Host "Starting $exe"
$app = Start-Process $exe -PassThru
Start-Sleep -Seconds 20
if ($app.HasExited) { throw "Enso exited during start-up with $($app.ExitCode)." }
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$($entry.InstallLocation)*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Uninstalling: $($entry.QuietUninstallString)"
Start-Process cmd.exe -ArgumentList '/c', $entry.QuietUninstallString -Wait
# The NSIS uninstaller re-launches itself from %TEMP%, so wait for it to finish.
for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw 'The uninstaller left Enso.exe behind.' }
if ($null -ne (Get-EnsoUninstallEntry)) { throw 'The uninstaller left its uninstall entry behind.' }
Write-Host 'Installer smoke test passed.'
```

- [ ] **Step 2: Run it locally against the Task 4 build**

```powershell
pwsh -File tools/ci/windows-installer-smoke.ps1 -Installer (Get-Item dist\ide\enso-win-x64-*.exe).FullName
```

Expected: `Installer smoke test passed.`, and the exit code is 0. Close any
running Enso first.

- [ ] **Step 3: Write the failing ci_gen test**

In the `tests` module of `build_tools/build/src/ci_gen/job.rs`, next to
`ide_jobs_need_no_cloud_account`, follow that test's way of serialising
`PackageIde` for a target:

```rust
#[test]
fn windows_packaging_smoke_tests_the_installer() {
    let windows = serialize_job(PackageIde, (OS::Windows, Arch::X86_64));
    assert!(windows.contains("tools/ci/windows-installer-smoke.ps1"), "{windows}");
    let linux = serialize_job(PackageIde, (OS::Linux, Arch::X86_64));
    assert!(!linux.contains("windows-installer-smoke"), "{linux}");
}
```

`serialize_job` stands for whatever the existing test uses to turn a job into
YAML. If that is inline code, extract it into a
`fn serialize_job(job: impl JobArchetype, target: Target) -> String` in the test
module and use it in both tests.

Run: `cargo test -p enso-build windows_packaging_smoke_tests_the_installer`.
Expected: FAIL.

- [ ] **Step 4: Add the step**

In `PackageIde::job`, on `target.0 == OS::Windows`, push a raw shell step after
the IDE build step and before the packaged-app tests:

- name `Smoke-test the installer`
- `shell: pwsh`
- run
  `./tools/ci/windows-installer-smoke.ps1 -Installer (Get-Item dist/ide/enso-win-x64-*.exe).FullName`

Build it the way the existing raw `run:` steps in `job.rs`/`step.rs` are built
(`git grep -n 'ENSO_IDE_VERSION=\$(date' build_tools` finds one).

- [ ] **Step 5: Run the test, regenerate, check the diff**

```bash
cargo test -p enso-build
cargo run --package enso-build-ci-gen
git diff --stat .github/workflows
```

Expected:

- the tests pass
- only `ide-packaging.yml` changed, with only the new step
- `release.yml` is unchanged in this PR

- [ ] **Step 6: Commit**

```bash
git add tools/ci/windows-installer-smoke.ps1 build_tools/build/src/ci_gen .github/workflows/ide-packaging.yml
git commit -m "CI: install, start and uninstall the Windows installer on every packaging run"
```

### Task 6: Docs, changelog, PR 1

**Files:**

- Modify: `app/electron-client/CLAUDE.md` (the stale update line, and how the
  installer is built)
- Modify: any doc that names `build_tools/install`, the Rust installer or
  `enso-installer`:
  `git grep -n -i "build_tools/install\|enso-installer\|enso-uninstaller\|Rust installer" -- ':!docs/superpowers'`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update each hit** so that it describes NSIS:
  - per-user install to `%LOCALAPPDATA%\Programs\enso`
  - `app/electron-client/build/installer.nsh` migrates Rust installs
  - `tools/ci/windows-installer-smoke.ps1` runs in CI

- [ ] **Step 2: Add the changelog entry**

Under `# Next Release` → `#### Enso IDE`:
`- [The Windows installer is a standard installer: it can install silently (\`/S\`)
and shows a single entry under installed
apps.][NNN]`Use the PR number once the PR is open, with a link definition`[NNN]:
https://github.com/jdunkerley/enso/pull/NNN`.

- [ ] **Step 3: Format and run the full checks**

```bash
corepack pnpm exec prettier --write app/electron-client/CLAUDE.md CHANGELOG.md
cd app/electron-client && corepack pnpm exec vitest run && corepack pnpm exec tsc --noEmit -p .
```

Expected: all electron-client tests pass (83 before this work, plus the new
ones).

- [ ] **Step 4: Commit, push, open PR 1**

```bash
git commit -am "Docs: the Windows installer is built by NSIS"
git push -u origin feature/nsis-installer
gh pr create --base develop --title "NSIS replaces the custom Rust Windows installer (PR 1 of the standard installer)" --body-file <scratchpad>/standard-installer/pr1-body.md --label "CI: Build IDE"
```

The body must say "Part of #252's design" and summarise the spike numbers. Then
add the changelog link with the real PR number and push.

- [ ] **Step 5: Hand the installer to the user**

1. Smoke-test the installer locally first (memory
   `local-windows-installer-build`, item 5).
2. Report its path and sha256.
3. Wait for the user's OK before merging (memory `merge-gate-features`).

---

## PR 2: the IDE-only `release.yml`

### Task 7: Upload the update files with the installer

**Files:**

- Modify: `build_tools/build/src/project/ide.rs` (`Artifact`, about 7–42)
- Modify: `build_tools/cli/src/lib.rs` (`upload_ide_assets`, about 563–585)

**Interfaces:**

- Produces: `Artifact::update_files(&self) -> Vec<PathBuf>`, returning those of
  the following that exist on disk:
  - `<image>.blockmap`
  - `<dist>/latest.yml`, `<dist>/latest-linux.yml` or `<dist>/latest-mac.yml`
    (the one for the target OS)
  - on macOS, `<dist>/enso-mac-<arch>-<ver>.zip` and `<…zip>.blockmap`
- `Artifact` gains the fields `dist_dir: PathBuf` and `target_os: OS`, which
  `Artifact::new` sets.

- [ ] **Step 1: Write the failing test**

In `build_tools/build/src/project/ide.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_files_are_the_existing_feed_and_blockmaps() -> Result {
        let dist = tempfile::tempdir()?;
        let version = Version::parse("2026.2.0")?;
        let artifact = Artifact::new(OS::Windows, Arch::X86_64, &version, dist.path());
        assert!(artifact.update_files().is_empty());

        let blockmap = dist.path().join("enso-win-x64-2026.2.0.exe.blockmap");
        let feed = dist.path().join("latest.yml");
        ide_ci::fs::write(&blockmap, "")?;
        ide_ci::fs::write(&feed, "")?;
        ide_ci::fs::write(dist.path().join("latest-linux.yml"), "")?;
        assert_eq!(artifact.update_files(), vec![blockmap, feed]);
        Ok(())
    }

    #[test]
    fn macos_update_files_include_the_zip() -> Result {
        let dist = tempfile::tempdir()?;
        let version = Version::parse("2026.2.0")?;
        let artifact = Artifact::new(OS::MacOS, Arch::AArch64, &version, dist.path());
        let zip = dist.path().join("enso-mac-arm64-2026.2.0.zip");
        let zip_blockmap = dist.path().join("enso-mac-arm64-2026.2.0.zip.blockmap");
        let feed = dist.path().join("latest-mac.yml");
        for path in [&zip, &zip_blockmap, &feed] {
            ide_ci::fs::write(path, "")?;
        }
        assert_eq!(artifact.update_files(), vec![feed, zip, zip_blockmap]);
        Ok(())
    }
}
```

Add `tempfile` to `[dev-dependencies]` of `build_tools/build/Cargo.toml` if it
is missing; use the workspace version if there is one.

Run: `cargo test -p enso-build update_files`. Expected: FAIL (no method
`update_files`).

- [ ] **Step 2: Implement**

```rust
impl Artifact {
    /// What `electron-updater` needs next to the image: the feed and the blockmaps (and on macOS,
    /// the zip it updates from). Only release builds write them (`ENSO_BUILD_UPDATE_INFO`), so
    /// missing files are skipped.
    pub fn update_files(&self) -> Vec<PathBuf> {
        let with_suffix = |path: &Path, suffix: &str| {
            let mut name = path.as_os_str().to_owned();
            name.push(suffix);
            PathBuf::from(name)
        };
        let candidates = match self.target_os {
            OS::Windows => vec![with_suffix(&self.image, ".blockmap"), self.dist_dir.join("latest.yml")],
            OS::Linux =>
                vec![with_suffix(&self.image, ".blockmap"), self.dist_dir.join("latest-linux.yml")],
            OS::MacOS => {
                let zip = self.image.with_extension("zip");
                let zip_blockmap = with_suffix(&zip, ".blockmap");
                vec![self.dist_dir.join("latest-mac.yml"), zip, zip_blockmap]
            }
            _ => vec![],
        };
        candidates.into_iter().filter(|path| path.exists()).collect()
    }
}
```

Set the `dist_dir` and `target_os` fields in `Artifact::new`, where `dist_dir`
is the `output_path` argument.

- [ ] **Step 3: Upload them**

In `build_tools/cli/src/lib.rs` `upload_ide_assets`, after the checksum upload,
add:

```rust
              for file in artifacts.update_files() {
                  release.upload_asset_file_with_custom_name(&file, add_prefix.clone()).await?;
              }
```

Because `add_prefix` is moved into the checksum call, change that call to
`add_prefix.clone()`, and pass `add_prefix` by clone in the loop.

- [ ] **Step 4: Test, build, commit**

```bash
cargo test -p enso-build && cargo build -p enso-build-cli && cargo fmt -- --check
git add build_tools/build/src/project/ide.rs build_tools/build/Cargo.toml build_tools/cli/src/lib.rs Cargo.lock
git commit -m "Upload the update feed and blockmaps with the IDE image"
```

### Task 8: Publish IDE-only releases, and remove the AWS release code

**Files:**

- Modify: `build_tools/build/src/release.rs`,
  `build_tools/build/src/release/manifest.rs`, and the release-body template the
  report places at `release-body.md` (`git ls-files | grep release-body`)
- Delete: `build_tools/build/src/aws.rs`, `build_tools/build/src/aws/`,
  `build_tools/build/src/repo/cloud.rs`
- Modify: `build_tools/build/src/lib.rs`, `build_tools/build/src/repo.rs`
  (`mod cloud`), `build_tools/build/Cargo.toml`,
  `build_tools/cli/src/arg/release.rs`, `build_tools/cli/src/lib.rs` (about
  747–779)

**Interfaces:**

- Produces: `release publish` turns the draft into a published release, marked
  as a prerelease when the version has a prerelease part, and uploads an
  IDE-only `assets.json`.
- `release` keeps the actions `create-draft`, `publish`, `promote` and
  `update-latest-version`.

- [ ] **Step 1: Write the failing test** for the manifest

In `build_tools/build/src/release/manifest.rs`, add a test that
`Assets::new(...)` (with the arguments the existing callers use, for a
`2026.2.0` version) yields only IDE assets: every asset's name starts with
`enso-` and ends with `.exe`, `.AppImage` or `.dmg`, and there are exactly
three. Run: `cargo test -p enso-build manifest`. Expected: FAIL (engine bundles
are included).

- [ ] **Step 2: Make the manifest IDE-only**

1. In `Assets::new`, stop adding `Asset::new_engine` entries. Delete
   `new_engine` and the `engine` field if nothing else uses them.
2. In the release-body template, delete the loop over `assets.engine`.
3. Run the test again. Expected: PASS.

- [ ] **Step 3: Rewrite `publish_release`**

Keep the start of the current function, which fetches the release by
`ENSO_RELEASE_ID` and checks it is a draft. Then:

- Delete the edition-file block: `edition_file_path`, the `ensure!`, and
  `crate::aws::update_manifest(...)`.
- Keep the upload of `assets.json` and `validate_release`.
- Make sure the release is published with
  `prerelease = !context.triple.versions.version.pre.is_empty()`. If
  `draft_a_new_release` already sets `prerelease` when it creates the draft,
  just confirm it and leave the publish call alone. Otherwise add
  `.prerelease(prerelease)` to the octocrab `update` builder used for
  publishing.

- [ ] **Step 4: Delete the AWS and cloud code**

```bash
git rm -r build_tools/build/src/aws.rs build_tools/build/src/aws build_tools/build/src/repo/cloud.rs
```

Then:

- **`release.rs`:** delete `get_engine_package`, `generate_runtime_image`,
  `deploy_runtime_to_ecr`, `put_files_gzipping` and `notify_cloud_about_gui`
  (with its ignored test), plus their now-unused imports (`Docker`, `SevenZip`,
  …).
- **`lib.rs`:** delete `pub mod aws;`. Also delete `mod cloud` from the `repo`
  module.
- **`build/Cargo.toml`:** delete `aws-config`, `aws-sdk-ecr` and `aws-sdk-s3`.
- **`cli/src/arg/release.rs`:** delete the `DeployRuntime` struct and the
  `DeployRuntime` and `DispatchBuildImage` variants. Delete their match arms in
  `cli/src/lib.rs`.
- **`build_tools/ci_utils/tests/reqwest_clients.rs:82`:** check whether its
  `aws_sdk_s3` mention still compiles or matters, and update it if it does.

- [ ] **Step 5: Build and test both hosts**

```bash
cargo build -p enso-build-cli && cargo test -p enso-build -p enso-build-cli && cargo fmt -- --check
```

Repeat in WSL. Expected: green, apart from the known Windows tar test.

- [ ] **Step 6: Commit**

```bash
git add -A build_tools Cargo.lock
git commit -m "Publish IDE-only releases; remove the S3, ECR and cloud release code"
```

### Task 9: Generate the IDE-only `release.yml`

**Files:**

- Modify: `build_tools/build/src/ci_gen.rs` (`add_release_steps` 649–690,
  `PublishRelease` 466–494, `UploadIde` 551–576, the secret constants 84–96,
  `CI_PRIVATE_TOKEN` 135)
- Modify: `build_tools/build/src/ci_gen/job.rs` (delete `UploadBackend`,
  `DeployRuntime`, `DispatchBuildImage`, and add a test)
- Regenerate: `.github/workflows/release.yml`, `promote.yml` (expected
  unchanged)
- Delete: `.github/workflows/release-update-broken.yml`,
  `tools/ci/releases/{add-release.js,is-broken.js,mark-broken.js}`,
  `tools/ci/docker/engine/`. First run
  `git grep -n "tools/ci/releases\|docker/engine\|release-update-broken"` and
  keep anything still referenced outside the deleted code.
- Modify: root `CLAUDE.md`, to remove the `tools/ci/docker/engine/Dockerfile`
  bullet under "Toolchain versions are duplicated all over".

**Interfaces:**

- Consumes: `ENSO_BUILD_UPDATE_INFO` (Task 2), `Artifact::update_files` (Task
  7), and IDE-only `release publish` (Task 8).

- [ ] **Step 1: Write the failing test**

In `build_tools/build/src/ci_gen.rs`, add:

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn release_is_ide_only_and_needs_no_cloud_secrets() {
        let workflow = super::release().unwrap();
        let yaml = serde_yaml::to_string(&workflow).unwrap();
        for gone in [
            "deploy-runtime",
            "dispatch-build-image",
            "upload-backend",
            "ARTEFACT_S3",
            "ECR_PUSH",
            "CI_PRIVATE_TOKEN",
            "Download Edition File",
            "--backend-source release",
        ] {
            assert!(!yaml.contains(gone), "release.yml still contains {gone}:\n{yaml}");
        }
        for kept in ["release create-draft", "release publish", "update-latest-version", "ide upload"] {
            assert!(yaml.contains(kept), "release.yml lacks {kept}:\n{yaml}");
        }
        assert!(yaml.contains("ENSO_BUILD_UPDATE_INFO"), "{yaml}");
    }
}
```

Run: `cargo test -p enso-build release_is_ide_only`. Expected: FAIL.

- [ ] **Step 2: Rewrite `add_release_steps`**

```rust
fn add_release_steps(workflow: &mut Workflow) -> Result {
    let prepare_job_id = workflow.add(PRIMARY_TARGET, DraftRelease);
    // The license-package check gates publishing.
    let license_check_job_id = workflow.add(PRIMARY_TARGET, job::VerifyLicensePackages);
    let mut publish_deps = vec![prepare_job_id.clone(), license_check_job_id];

    // Each platform builds its own engine and IDE and uploads the installer and the update feed
    // to the draft. The release is published only when all of them succeed.
    for target in RELEASE_TARGETS {
        let backend_job_id = workflow.add(target, job::BuildBackend { engine_launcher: job::EngineLauncher::Native });
        let build_ide_job_id =
            workflow.add_dependent(target, UploadIde, [&prepare_job_id, &backend_job_id]);
        publish_deps.push(build_ide_job_id);
    }

    let publish_job_id = workflow.add_dependent(PRIMARY_TARGET, PublishRelease, publish_deps);
    // Depends on the draft-release job as well, since that is what exposes `ENSO_VERSION`.
    let _update_latest_job_id = workflow.add_dependent(
        PRIMARY_TARGET,
        UpdateLatestReleaseVersion,
        [&prepare_job_id, &publish_job_id],
    );
    workflow.env("RUST_BACKTRACE", "full");
    Ok(())
}
```

Use the real names of `BuildBackend`'s launcher field and enum: copy them from
`ide_packaging()` (845–869), which builds the same job.

- [ ] **Step 3: Point `UploadIde` at the CI-built backend, and turn on update
      info**

`ide_packaging()` + `PackageIde` (job.rs 988–1069) show how a packaging job
downloads the `backend-<os>` artifact from `BuildBackend` and passes it to
`ide build`. In `UploadIde::job`:

- Replace `--backend-source release --backend-release ${{env.ENSO_RELEASE_ID}}`
  with exactly those backend arguments, and add the same artifact-download step
  `PackageIde` uses (inside `customize`).
- Keep `--sign-artifacts` and `RELEASE_CLEANING_POLICY`.
- Set the job env `ENSO_BUILD_UPDATE_INFO: "true"` (`job.env(...)` on the built
  job, as `PublishRelease` does with `AWS_REGION` today).
- Keep the Actions-artifact upload step.

- [ ] **Step 4: Make `PublishRelease` plain**

```rust
impl JobArchetype for PublishRelease {
    fn job(&self, target: Target) -> Job {
        RunStepsBuilder::new("release publish").build_job("Publish release", target)
    }
}
```

- [ ] **Step 5: Delete the dead jobs and secrets**

- Delete `job::UploadBackend`, `job::DeployRuntime` and
  `job::DispatchBuildImage` if nothing else uses them
  (`git grep -n "UploadBackend\|DeployRuntime\|DispatchBuildImage" build_tools`).
- In `ci_gen.rs`, delete the constants `ARTEFACT_S3_ACCESS_KEY_ID`,
  `ARTEFACT_S3_SECRET_ACCESS_KEY`, `ECR_PUSH_RUNTIME_ACCESS_KEY_ID`,
  `ECR_PUSH_RUNTIME_SECRET_ACCESS_KEY` and `CI_PRIVATE_TOKEN`, if they are now
  unused.
- Delete the `assert!(RELEASE_TARGETS…Linux…)` and its comment.
- Delete `crate::paths::EDITION_FILE_ARTIFACT_NAME` if it is now unused.

- [ ] **Step 6: Delete the hand-written S3 workflow and its scripts**

```bash
git rm .github/workflows/release-update-broken.yml tools/ci/releases/add-release.js tools/ci/releases/is-broken.js tools/ci/releases/mark-broken.js
git rm -r tools/ci/docker/engine
```

Skip any file the earlier `git grep` showed is still used. Then edit the root
`CLAUDE.md` bullet list.

- [ ] **Step 7: Test, regenerate, inspect**

```bash
cargo test -p enso-build
cargo run --package enso-build-ci-gen
git diff --stat .github/workflows
grep -n "name:" .github/workflows/release.yml | head -40
```

Expected: the tests pass, and `release.yml`'s jobs are:

- Build Script ×3
- Create a release draft
- Verify License Packages
- the backend build ×3
- Build IDE ×3
- Publish release
- Update the latest release version

`promote.yml` and `nightly.yml` are unchanged.

- [ ] **Step 8: Commit**

```bash
git add -A build_tools .github/workflows tools/ci CLAUDE.md
git commit -m "CI: release.yml publishes IDE-only GitHub releases with only GITHUB_TOKEN"
```

### Task 10: Run a real release on the fork, then open PR 2

**This publishes a public prerelease on `jdunkerley/enso`. Confirm with the user
before dispatching.**

- [ ] **Step 1: Push the branch and dispatch `promote.yml` with `rc`**

```bash
git push -u origin feature/ide-only-release
gh workflow run promote.yml --ref feature/ide-only-release -f designator=rc
```

`release.yml` and `promote.yml` already exist on `develop`, so dispatching from
the branch runs the branch's versions.

- [ ] **Step 2: Watch it to the end**

Use a background `gh run watch` loop, or poll with `gh run list --jq` (memory
`ci-watchers`: no `jq` binary, an iteration cap, and exit when done). Expected:

- every job is green
- a **prerelease** `…-rc.N` exists
- its assets are, for Windows: `.exe`, `.exe.sha256`, `.exe.blockmap`,
  `latest.yml`
- for Linux: `.AppImage`, `.AppImage.sha256`, `.AppImage.blockmap`,
  `latest-linux.yml`
- for macOS: `.dmg`, `.dmg.sha256`, and **no** `latest-mac.yml`
- and `assets.json`

```bash
gh release view <tag> --json isPrerelease,isDraft,assets --jq '{isPrerelease,isDraft,assets:[.assets[].name]}'
```

- [ ] **Step 3: Check the feed points at the uploaded file**

```bash
gh release download <tag> -p latest.yml -O - | head
```

Expected: `path:` and `url:` equal the `.exe` asset's name, and `version:`
equals the release version.

Record the tag format (with or without a leading `v`). Task 15 needs it.

- [ ] **Step 4: Ask the user** whether to keep this prerelease. It contains no
      updater, so it is only useful as a download. If they say delete:
      `gh release delete <tag> --yes --cleanup-tag`.

- [ ] **Step 5: Open PR 2**

Base `feature/nsis-installer`, label `CI: No changelog needed`, and include the
run link and the asset list in the body.

---

## PR 3: the updater

### Task 11: The `Updater` state machine

**Files:**

- Create: `app/common/src/updater.ts`
- Create: `app/electron-client/src/updater.ts`
- Create: `app/electron-client/tests/headless/updater.test.ts`
- Modify: `app/electron-client/package.json` (add `electron-updater`)

**Interfaces:**

- Produces, in `app/common/src/updater.ts`:

```ts
/** @file Types shared by the Electron updater and the GUI's update dialog. */

/** `auto`: the app updates itself. `manual`: it only links to the download (dev, unsigned macOS, …). */
export type UpdateMode = "auto" | "manual";

/** Where an automatic update has got to. */
export type UpdateStatus =
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "none" }
  | {
      readonly state: "available";
      readonly version: string;
      readonly releaseDate: string;
    }
  | {
      readonly state: "downloading";
      readonly version: string;
      readonly percent: number;
    }
  | { readonly state: "ready"; readonly version: string }
  | {
      readonly state: "error";
      readonly message: string;
      readonly version: string | null;
    };
```

- Produces, in `app/electron-client/src/updater.ts`:
  - `class Updater` with `constructor(deps: UpdaterDeps)`,
    `readonly mode: UpdateMode`, `status(): UpdateStatus`,
    `check(allowPrerelease: boolean): Promise<UpdateStatus>`,
    `download(): Promise<void>` and `quitAndInstall(): void`
  - `resolveUpdateMode(buildMode: UpdateMode, environment: { isPackaged: boolean; platform: NodeJS.Platform; appImage: string | undefined }): UpdateMode`

- [ ] **Step 1: Add the dependency**

```bash
cd app/electron-client
corepack pnpm view electron-updater@6.8 dependencies --json   # pick the newest 6.8.x whose builder-util-runtime is 9.5.x
corepack pnpm add --save-exact electron-updater@<that version>
```

- [ ] **Step 2: Write the failing tests**

`app/electron-client/tests/headless/updater.test.ts`:

```ts
/** @file The automatic-update state machine (`src/updater.ts`), against a fake `electron-updater`. */
import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

import type { UpdateStatus } from "enso-common/src/updater";
import {
  resolveUpdateMode,
  Updater,
  type UpdaterDeps,
} from "../../src/updater";

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  logger: unknown = null;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
}

function setup(mode: "auto" | "manual" = "auto") {
  const autoUpdater = new FakeAutoUpdater();
  const statuses: UpdateStatus[] = [];
  const deps: UpdaterDeps = {
    autoUpdater: autoUpdater as unknown as UpdaterDeps["autoUpdater"],
    mode,
    onStatus: (status) => statuses.push(status),
  };
  return { autoUpdater, statuses, updater: new Updater(deps) };
}

describe("Updater", () => {
  test("asks before downloading, and installs on quit", () => {
    const { autoUpdater } = setup();
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  test("reports an available update, honouring the prerelease setting", async () => {
    const { autoUpdater, updater } = setup();
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit("update-available", {
        version: "2026.2.0-rc.1",
        releaseDate: "2026-11-01",
      });
      return null;
    });
    const status = await updater.check(true);
    expect(autoUpdater.allowPrerelease).toBe(true);
    expect(status).toEqual({
      state: "available",
      version: "2026.2.0-rc.1",
      releaseDate: "2026-11-01",
    });
  });

  test("reports no update", async () => {
    const { autoUpdater, updater } = setup();
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit("update-not-available", { version: "2026.1.1" });
      return null;
    });
    expect(await updater.check(false)).toEqual({ state: "none" });
    expect(autoUpdater.allowPrerelease).toBe(false);
  });

  test("a failed check becomes an error status instead of throwing", async () => {
    const { autoUpdater, updater } = setup();
    autoUpdater.checkForUpdates.mockRejectedValue(new Error("offline"));
    expect(await updater.check(false)).toEqual({
      state: "error",
      message: "offline",
      version: null,
    });
  });

  test("downloads with progress, then is ready", async () => {
    const { autoUpdater, statuses, updater } = setup();
    autoUpdater.emit("update-available", {
      version: "2026.2.0",
      releaseDate: "",
    });
    autoUpdater.downloadUpdate.mockImplementation(async () => {
      autoUpdater.emit("download-progress", { percent: 42 });
      autoUpdater.emit("update-downloaded", { version: "2026.2.0" });
      return [];
    });
    await updater.download();
    expect(statuses).toContainEqual({
      state: "downloading",
      version: "2026.2.0",
      percent: 0,
    });
    expect(statuses).toContainEqual({
      state: "downloading",
      version: "2026.2.0",
      percent: 42,
    });
    expect(updater.status()).toEqual({ state: "ready", version: "2026.2.0" });
  });

  test("a failed download keeps the version so the dialog can retry", async () => {
    const { autoUpdater, updater } = setup();
    autoUpdater.emit("update-available", {
      version: "2026.2.0",
      releaseDate: "",
    });
    autoUpdater.downloadUpdate.mockRejectedValue(
      new Error("sha512 checksum mismatch"),
    );
    await updater.download();
    expect(updater.status()).toEqual({
      state: "error",
      message: "sha512 checksum mismatch",
      version: "2026.2.0",
    });
  });

  test("does not re-check while downloading or once ready", async () => {
    const { autoUpdater, updater } = setup();
    autoUpdater.emit("update-downloaded", { version: "2026.2.0" });
    expect(await updater.check(false)).toEqual({
      state: "ready",
      version: "2026.2.0",
    });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test("installs silently and relaunches", () => {
    const { autoUpdater, updater } = setup();
    updater.quitAndInstall();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test("manual mode never touches electron-updater", async () => {
    const { autoUpdater, updater } = setup("manual");
    expect(await updater.check(true)).toEqual({ state: "idle" });
    await updater.download();
    updater.quitAndInstall();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe("resolveUpdateMode", () => {
  const packaged = {
    isPackaged: true,
    platform: "win32" as const,
    appImage: undefined,
  };
  test.each([
    ["a packaged auto build", "auto", packaged, "auto"],
    ["a manual build", "manual", packaged, "manual"],
    ["an unpackaged run", "auto", { ...packaged, isPackaged: false }, "manual"],
    [
      "Linux outside an AppImage",
      "auto",
      { ...packaged, platform: "linux" as const },
      "manual",
    ],
    [
      "an AppImage",
      "auto",
      { ...packaged, platform: "linux" as const, appImage: "/a/Enso.AppImage" },
      "auto",
    ],
  ] as const)("%s", (_name, buildMode, environment, expected) => {
    expect(resolveUpdateMode(buildMode, environment)).toBe(expected);
  });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `corepack pnpm exec vitest run tests/headless/updater.test.ts`. Expected:
FAIL (module not found).

- [ ] **Step 4: Write `app/common/src/updater.ts`** (the code under Interfaces).
      Then write `app/electron-client/src/updater.ts`:

```ts
/**
 * @file Automatic updates through `electron-updater`, with GitHub Releases as the feed.
 *
 * The user is asked before anything downloads; a downloaded update installs on restart, or on the
 * next quit. See `docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md`.
 */
import type { AppUpdater } from "electron-updater";
import type { UpdateMode, UpdateStatus } from "enso-common/src/updater";

/** The slice of `electron-updater`'s `AppUpdater` the updater uses. */
export type AutoUpdaterLike = Pick<
  AppUpdater,
  "autoDownload" | "autoInstallOnAppQuit" | "allowPrerelease" | "logger" | "on"
> & {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

/** What the {@link Updater} needs. */
export interface UpdaterDeps {
  readonly autoUpdater: AutoUpdaterLike;
  readonly mode: UpdateMode;
  /** Called on every status change, to forward it to the GUI. */
  readonly onStatus: (status: UpdateStatus) => void;
}

/** Whether this run can update itself; see {@link UpdateMode}. */
export function resolveUpdateMode(
  buildMode: UpdateMode,
  environment: {
    isPackaged: boolean;
    platform: NodeJS.Platform;
    appImage: string | undefined;
  },
): UpdateMode {
  if (buildMode === "manual" || !environment.isPackaged) return "manual";
  // On Linux only an AppImage can replace itself.
  if (environment.platform === "linux" && environment.appImage == null)
    return "manual";
  return "auto";
}

/** Drives `electron-updater` and reports its progress as an {@link UpdateStatus}. */
export class Updater {
  readonly mode: UpdateMode;
  private current: UpdateStatus = { state: "idle" };

  /** Configures `autoUpdater` and subscribes to its events. */
  constructor(private readonly deps: UpdaterDeps) {
    this.mode = deps.mode;
    const updater = deps.autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.logger = console;
    updater.on("update-available", (info) => {
      this.set({
        state: "available",
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });
    updater.on("update-not-available", () => {
      this.set({ state: "none" });
    });
    updater.on("download-progress", (progress) => {
      this.set({
        state: "downloading",
        version: this.version() ?? "",
        percent: progress.percent,
      });
    });
    updater.on("update-downloaded", (info) => {
      this.set({ state: "ready", version: info.version });
    });
    updater.on("error", (error) => {
      this.set({
        state: "error",
        message: error.message,
        version: this.version(),
      });
    });
  }

  /** The latest status. */
  status(): UpdateStatus {
    return this.current;
  }

  /** Looks for a newer release; never throws. Does nothing while downloading or once ready. */
  async check(allowPrerelease: boolean): Promise<UpdateStatus> {
    if (this.mode === "manual") return this.current;
    if (this.current.state === "downloading" || this.current.state === "ready")
      return this.current;
    this.deps.autoUpdater.allowPrerelease = allowPrerelease;
    this.set({ state: "checking" });
    try {
      await this.deps.autoUpdater.checkForUpdates();
    } catch (error) {
      this.set({ state: "error", message: messageOf(error), version: null });
    }
    return this.current;
  }

  /** Downloads the available update; the outcome arrives as a status. Never throws. */
  async download(): Promise<void> {
    if (this.mode === "manual") return;
    const version = this.version();
    if (version == null) return;
    this.set({ state: "downloading", version, percent: 0 });
    try {
      await this.deps.autoUpdater.downloadUpdate();
    } catch (error) {
      this.set({ state: "error", message: messageOf(error), version });
    }
  }

  /** Quits through the normal quit path, installs silently, then relaunches. */
  quitAndInstall(): void {
    if (this.mode === "manual") return;
    console.info("[Updater] Restarting to install the update.");
    this.deps.autoUpdater.quitAndInstall(true, true);
  }

  private version(): string | null {
    return "version" in this.current ? this.current.version : null;
  }

  private set(status: UpdateStatus) {
    this.current = status;
    this.deps.onStatus(status);
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 5: Run the tests**

`corepack pnpm exec vitest run tests/headless/updater.test.ts && corepack pnpm exec tsc --noEmit -p .`

Expected: PASS. If tsc rejects the `on` overloads in `AutoUpdaterLike`, keep
`on` from `AppUpdater`'s typed events and type the fake through the
`as unknown as` in the test only. That is the test's stub, not a third-party
cast (root `CLAUDE.md`).

- [ ] **Step 6: Commit**

```bash
git add app/common/src/updater.ts app/electron-client/src/updater.ts app/electron-client/tests/headless/updater.test.ts app/electron-client/package.json pnpm-lock.yaml
git commit -m "Updater: drive electron-updater as an ask-then-download state machine"
```

### Task 12: IPC between the updater and the GUI

**Files:**

- Create: `app/electron-client/src/updaterIpc.ts`
- Modify: `app/electron-client/src/ipc.ts` (channels, before the closing `}` at
  about line 60)
- Modify: `app/electron-client/src/preload.ts` (an `updater` object, and add it
  to `api`)
- Modify: `app/electron-client/src/electron.ts` (call `initUpdaterIpc` in
  `initIpc`)
- Modify: `app/gui/src/electronApi.ts` (`UpdaterApi` and `ElectronApi.updater`)
- Test: add to `app/electron-client/tests/headless/updater.test.ts`

**Interfaces:**

- Consumes: `Updater` and `resolveUpdateMode` (Task 11), and
  `BUILD_INFO.updates` (Task 13; until then pass `'manual'`, which Task 13
  replaces).
- Produces: the GUI type

```ts
/** Automatic updates; see `app/electron-client/src/updater.ts`. */
export interface UpdaterApi {
  readonly mode: () => Promise<UpdateMode>;
  readonly check: (allowPrerelease: boolean) => Promise<UpdateStatus>;
  readonly download: () => Promise<void>;
  readonly quitAndInstall: () => Promise<void>;
  /** Subscribe to status changes. Returns a disposer. */
  readonly onStatus: (handler: (status: UpdateStatus) => void) => () => void;
}
```

- Channels: `updaterMode = 'updater-mode'`, `updaterCheck = 'updater-check'`,
  `updaterDownload = 'updater-download'`,
  `updaterQuitAndInstall = 'updater-quit-and-install'` (renderer → main), and
  `updaterStatus = 'updater-status'` (main → renderer).

- [ ] **Step 1: Write the failing test**

Append to `updater.test.ts`, following the `claudeAgent.test.ts` way of mocking
`electron`:

```ts
const { handleMock, sendMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  sendMock: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: { handle: handleMock },
  webContents: {
    getAllWebContents: () => [{ isDestroyed: () => false, send: sendMock }],
  },
}));

describe("initUpdaterIpc", () => {
  test("registers the four handlers and broadcasts status changes", async () => {
    const { initUpdaterIpc } = await import("../../src/updaterIpc");
    const { Channel } = await import("../../src/ipc");
    const autoUpdater = new FakeAutoUpdater();
    initUpdaterIpc(
      "auto",
      autoUpdater as unknown as UpdaterDeps["autoUpdater"],
    );
    const channels = handleMock.mock.calls.map(([channel]) => channel);
    expect(channels).toEqual([
      Channel.updaterMode,
      Channel.updaterCheck,
      Channel.updaterDownload,
      Channel.updaterQuitAndInstall,
    ]);
    autoUpdater.emit("update-downloaded", { version: "2026.2.0" });
    expect(sendMock).toHaveBeenCalledWith(Channel.updaterStatus, {
      state: "ready",
      version: "2026.2.0",
    });
  });
});
```

Run it. Expected: FAIL (no module `updaterIpc`).

- [ ] **Step 2: Implement `updaterIpc.ts`**

```ts
/** @file Exposes the {@link Updater} to the GUI over IPC. */
import { Channel } from "@/ipc";
import { resolveUpdateMode, Updater, type AutoUpdaterLike } from "@/updater";
import { app, ipcMain, webContents } from "electron";
import type { UpdateMode, UpdateStatus } from "enso-common/src/updater";

function broadcast(status: UpdateStatus) {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    try {
      contents.send(Channel.updaterStatus, status);
    } catch {
      // Renderer destroyed mid-send; the next status will skip it.
    }
  }
}

/** Creates the updater and registers its IPC handlers. `autoUpdater` is a parameter for tests. */
export function initUpdaterIpc(
  buildMode: UpdateMode,
  autoUpdater: AutoUpdaterLike,
) {
  const mode = resolveUpdateMode(buildMode, {
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
  });
  console.info(`[Updater] Mode: ${mode}.`);
  const updater = new Updater({ autoUpdater, mode, onStatus: broadcast });
  ipcMain.handle(Channel.updaterMode, () => updater.mode);
  ipcMain.handle(Channel.updaterCheck, (_event, allowPrerelease: boolean) =>
    updater.check(allowPrerelease === true),
  );
  ipcMain.handle(Channel.updaterDownload, () => updater.download());
  ipcMain.handle(Channel.updaterQuitAndInstall, () => {
    updater.quitAndInstall();
  });
}
```

In `electron.ts` `initIpc`, add:

```ts
import electronUpdater from "electron-updater";
import BUILD_INFO from "../buildInfo";
import { initUpdaterIpc } from "@/updaterIpc";
// …inside initIpc:
initUpdaterIpc(BUILD_INFO.updates, electronUpdater.autoUpdater);
```

Use the import style the spike proved works (Task 1, Step 6). If
`electron-updater`'s default export is not an object with `autoUpdater` under
esbuild, use `import { autoUpdater } from 'electron-updater'`.

Add the five channels to `ipc.ts`, each with a one-line JSDoc giving its
direction. Then add to `preload.ts`, mirroring `ai`:

```ts
const updater: ElectronApi["updater"] = {
  mode: () => electron.ipcRenderer.invoke(ipc.Channel.updaterMode),
  check: (allowPrerelease) =>
    electron.ipcRenderer.invoke(ipc.Channel.updaterCheck, allowPrerelease),
  download: () => electron.ipcRenderer.invoke(ipc.Channel.updaterDownload),
  quitAndInstall: () =>
    electron.ipcRenderer.invoke(ipc.Channel.updaterQuitAndInstall),
  onStatus: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: UpdateStatus,
    ) => handler(status);
    electron.ipcRenderer.on(ipc.Channel.updaterStatus, listener);
    return () => {
      electron.ipcRenderer.removeListener(ipc.Channel.updaterStatus, listener);
    };
  },
};
```

Add `updater` to the `api` object. In `app/gui/src/electronApi.ts`, add the
`UpdaterApi` interface from Interfaces (importing the types from
`enso-common/src/updater`), and add `readonly updater: UpdaterApi` to
`ElectronApi`.

- [ ] **Step 3: Run the tests and typecheck both packages**

```bash
cd app/electron-client && corepack pnpm exec vitest run && corepack pnpm exec tsc --noEmit -p .
cd ../gui && corepack pnpm exec vue-tsc --noEmit -p tsconfig.app.json
```

If the GUI uses a different typecheck command, use the one in
`app/gui/package.json` `scripts`. Expected: everything passes.

- [ ] **Step 4: Commit**

```bash
git add app/electron-client/src app/electron-client/tests app/gui/src/electronApi.ts
git commit -m "Updater: expose check, download and restart to the GUI over IPC"
```

### Task 13: The build-time `auto | manual` flag

**Files:**

- Modify: `app/electron-client/buildInfo.ts`,
  `app/electron-client/esbuildConfig.ts`
- Modify: `build_tools/build/src/ide/web.rs` (and the `env` module that defines
  `ENSO_IDE_VERSION`: `git grep -n "ENSO_IDE_VERSION" build_tools/build/src`)

**Interfaces:**

- Produces:
  - `BUILD_INFO.updates: UpdateMode`, which is `'auto'` only when
    `process.env.ENSO_IDE_UPDATES === 'auto'` at build time
  - the Rust
    `pub fn update_mode(version: &Version, target_os: OS, mac_signed: bool) -> &'static str`

- [ ] **Step 1: Write the failing Rust test**

In `build_tools/build/src/ide/web.rs`:

```rust
#[cfg(test)]
mod update_mode_tests {
    use super::*;

    #[test]
    fn dev_builds_and_unsigned_macos_are_manual() {
        let release = Version::parse("2026.2.0").unwrap();
        let rc = Version::parse("2026.2.0-rc.1").unwrap();
        let dev = Version::parse("2026.10.18-dev").unwrap();
        assert_eq!(update_mode(&release, OS::Windows, false), "auto");
        assert_eq!(update_mode(&rc, OS::Linux, false), "auto");
        assert_eq!(update_mode(&dev, OS::Windows, false), "manual");
        assert_eq!(update_mode(&release, OS::MacOS, false), "manual");
        assert_eq!(update_mode(&release, OS::MacOS, true), "auto");
    }
}
```

Run: `cargo test -p enso-build update_mode`. Expected: FAIL.

- [ ] **Step 2: Implement and pass the variable to both pnpm runs**

```rust
/// Whether the packaged app may update itself: not for dev builds, and on macOS only when signed
/// (an unsigned app cannot replace itself there).
pub fn update_mode(version: &Version, target_os: OS, mac_signed: bool) -> &'static str {
    let is_dev = version.pre.as_str().contains("dev");
    if is_dev || (target_os == OS::MacOS && !mac_signed) { "manual" } else { "auto" }
}
```

In `dist()`:

- Compute
  `let mac_signed = std::env::var("CSC_LINK").is_ok_and(|link| !link.is_empty()) && sign_artifacts;`
  and `let updates = update_mode(&version, target_os, mac_signed);`. Use the
  `Version` the function already has (the one behind `version_string`).
- Add `.set_env(env::ENSO_IDE_UPDATES, &updates)?` to **both** the `build:ide`
  and the `dist:ide` commands. `build:ide` is the step that bakes `BUILD_INFO`
  through esbuild.
- Define `ENSO_IDE_UPDATES` next to `ENSO_IDE_VERSION` in the same `env` module,
  with the same macro.

- [ ] **Step 3: The TS side**

`app/electron-client/buildInfo.ts`:

```ts
import type { UpdateMode } from "enso-common/src/updater";

export default {
  version: process.env.ENSO_IDE_VERSION ?? "0.0.0-dev",
  commit: process.env.ENSO_IDE_COMMIT_HASH ?? "<snapshot>",
  /** Set by the build (`update_mode` in `build_tools/build/src/ide/web.rs`); `manual` by default. */
  updates: (process.env.ENSO_IDE_UPDATES === "auto"
    ? "auto"
    : "manual") satisfies UpdateMode,
};
```

In `esbuildConfig.ts` `define`, add
`'process.env.ENSO_IDE_UPDATES': JSON.stringify(process.env.ENSO_IDE_UPDATES)`
next to the version.

- [ ] **Step 4: Test and commit**

```bash
cargo test -p enso-build update_mode && cargo fmt -- --check
cd app/electron-client && corepack pnpm exec tsc --noEmit -p . && corepack pnpm exec vitest run
git add build_tools/build/src app/electron-client/buildInfo.ts app/electron-client/esbuildConfig.ts
git commit -m "Build: record whether the app may update itself (manual for dev and unsigned macOS)"
```

### Task 14: The "Include prerelease versions" setting

**Files:**

- Create: `app/gui/src/providers/updateSettings.ts`
- Create: `app/gui/src/dashboard/layouts/Settings/UpdatesSettingsSection.vue`
- Modify: `app/gui/src/dashboard/layouts/Settings/tabs.ts`
  (`LOCAL_TAB.sections`)
- Modify: `app/common/src/text/english.json`
- Test: `app/gui/src/dashboard/layouts/Settings/__tests__/SettingsPage.test.ts`
  (or `localTab.test.ts`, whichever tests the Local tab's entries)

**Interfaces:**

- Produces `useIncludePrereleases(): ComputedRef<boolean>` and
  `setIncludePrereleases(value: boolean): void`, stored as
  `localStorage['enso-update-settings']`.

- [ ] **Step 1: Write the failing test**

In the Local-tab test file, following its existing style:

```ts
test("the Local tab has the prerelease-updates switch, off by default", async () => {
  // …open Settings → Local as the neighbouring tests do…
  expect(document.body.textContent).toContain(
    getText("includePrereleasesSetting"),
  );
  const { useIncludePrereleases } = await import("$/providers/updateSettings");
  expect(useIncludePrereleases().value).toBe(false);
});
```

Run:
`cd app/gui && corepack pnpm exec vitest run src/dashboard/layouts/Settings`.
Expected: FAIL.

- [ ] **Step 2: Implement**

`app/gui/src/providers/updateSettings.ts`:

```ts
/** @file The user's update preferences (Settings → Local). */
import { createPersistedStore } from "$/utils/persistedStore";
import { computed } from "vue";
import { z } from "zod";

interface UpdateSettings {
  readonly includePrereleases: boolean;
}

const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { includePrereleases: false };
const UPDATE_SETTINGS_SCHEMA = z.object({
  includePrereleases: z
    .boolean()
    .default(DEFAULT_UPDATE_SETTINGS.includePrereleases),
});

const updateSettingsStore = createPersistedStore<UpdateSettings>(
  () => ({ ...DEFAULT_UPDATE_SETTINGS }),
  {
    name: "enso-update-settings",
    version: 1,
    merge: (persistedState, currentState) => {
      const parsed = UPDATE_SETTINGS_SCHEMA.safeParse(persistedState);
      return parsed.success
        ? { ...currentState, ...parsed.data }
        : currentState;
    },
  },
);

/** Whether the updater offers prereleases (`rc`, `nightly`) as well as releases. */
export function useIncludePrereleases() {
  return computed(() => updateSettingsStore.state.value.includePrereleases);
}

/** Sets {@link useIncludePrereleases}. */
export function setIncludePrereleases(includePrereleases: boolean) {
  updateSettingsStore.setState({ includePrereleases });
}
```

`UpdatesSettingsSection.vue` is a copy of `CodeLigaturesSettingsSection.vue`
with the field name `includePrereleases`, these two functions, and the text keys
`includePrereleasesSetting` / `includePrereleasesSettingDescription`.

In `tabs.ts`, add a section to `LOCAL_TAB.sections`:

```ts
{
  nameId: 'updatesSettingsSection',
  entries: [
    {
      type: 'custom',
      aliasesId: 'updatesSettingsCustomEntryAliases',
      component: UpdatesSettingsSection,
    },
  ],
},
```

In `english.json`, next to the code-ligature keys, add:

```json
"updatesSettingsSection": "Updates",
"updatesSettingsCustomEntryAliases": "updates\nprerelease\nrelease candidate\nnightly",
"includePrereleasesSetting": "Include prerelease versions",
"includePrereleasesSettingDescription": "Also offer release candidates and nightly builds as updates. They are less tested than releases.",
```

If `nameId` keys must be declared elsewhere (for example a `SettingsSection` id
union), add the new one where the type error points.

- [ ] **Step 3: Run the tests and typecheck, then commit**

```bash
cd app/gui && corepack pnpm exec vitest run src/dashboard/layouts/Settings src/providers
git add app/gui/src/providers/updateSettings.ts app/gui/src/dashboard/layouts/Settings app/common/src/text/english.json
git commit -m "Settings: include prerelease versions in updates (off by default)"
```

### Task 15: The update dialog

**Files:**

- Create: `app/gui/src/versionChecker/appUpdate.ts`
- Modify: `app/gui/src/versionChecker/VersionChecker.vue`
- Modify: `app/gui/src/versionChecker/__tests__/VersionChecker.test.ts`
- Modify: `app/common/src/text/english.json`

**Interfaces:**

- Consumes: `window.api.updater` (Task 12) and `useIncludePrereleases` (Task
  14). The existing `getLatestRelease`, `getDownloadUrl`, `isNewerRelease` and
  `download` stay for manual mode and the browser (`UserMenu.vue` uses
  `getDownloadUrl`).
- Produces `useAutoUpdate()`, which returns
  `{ mode: Ref<UpdateMode | null>, status: Ref<UpdateStatus>, check(): Promise<void>, download(): Promise<void>, restart(): Promise<void> }`.
  `mode` is `null` until known, and always `'manual'` without
  `window.api?.updater`.

- [ ] **Step 1: Write the failing tests**

Add to `VersionChecker.test.ts`, keeping the existing manual-mode tests. A fake
`window.api.updater` drives the auto mode:

```ts
function fakeUpdater(initial: UpdateStatus) {
  let listener: ((status: UpdateStatus) => void) | null = null;
  const updater = {
    mode: vi.fn(async () => "auto" as const),
    check: vi.fn(async () => initial),
    download: vi.fn(async () => {
      listener?.({ state: "downloading", version: "2026.2.0", percent: 50 });
      listener?.({ state: "ready", version: "2026.2.0" });
    }),
    quitAndInstall: vi.fn(async () => {}),
    onStatus: vi.fn((handler: (status: UpdateStatus) => void) => {
      listener = handler;
      return () => (listener = null);
    }),
  };
  Object.assign(window, { api: { updater } });
  return updater;
}

describe("automatic updates", () => {
  afterEach(() => Reflect.deleteProperty(window, "api"));

  test("Update downloads, then Restart installs", async () => {
    const updater = fakeUpdater({
      state: "available",
      version: "2026.2.0",
      releaseDate: "2026-11-01",
    });
    await mountWithProviders(VersionChecker);
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    await userEvent.setup().click(button(getText("updateNow"))!);
    await vi.waitFor(() =>
      expect(button(getText("restartToUpdate"))).not.toBeNull(),
    );
    await userEvent.setup().click(button(getText("restartToUpdate"))!);
    expect(updater.quitAndInstall).toHaveBeenCalled();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  test("passes the prerelease setting to the check", async () => {
    setIncludePrereleases(true);
    const updater = fakeUpdater({ state: "none" });
    await mountWithProviders(VersionChecker);
    await vi.waitFor(() => expect(updater.check).toHaveBeenCalledWith(true));
    expect(dialog()).toBeNull();
  });

  test("a failed download offers Retry and Download manually", async () => {
    const updater = fakeUpdater({
      state: "available",
      version: "2026.2.0",
      releaseDate: "",
    });
    updater.download.mockImplementation(async () => {});
    await mountWithProviders(VersionChecker);
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    await userEvent.setup().click(button(getText("updateNow"))!);
    updater.onStatus.mock.calls[0]![0]({
      state: "error",
      message: "offline",
      version: "2026.2.0",
    });
    await vi.waitFor(() => expect(button(getText("retry"))).not.toBeNull());
    expect(button(getText("downloadManually"))).not.toBeNull();
  });
});
```

Import `UpdateStatus` from `enso-common/src/updater` and `setIncludePrereleases`
from `$/providers/updateSettings`. Reset the setting in `beforeEach` with
`setIncludePrereleases(false)`.

Run: `cd app/gui && corepack pnpm exec vitest run src/versionChecker`. Expected:
the new tests FAIL, and the existing ones pass.

- [ ] **Step 2: Implement `appUpdate.ts`**

```ts
/** @file Automatic updates through the Electron updater (see `app/electron-client/src/updater.ts`). */
import { useIncludePrereleases } from "$/providers/updateSettings";
import type { UpdateMode, UpdateStatus } from "enso-common/src/updater";
import { onScopeDispose, ref } from "vue";

/** Status and actions of the Electron updater; `mode` is `manual` outside Electron. */
export function useAutoUpdate() {
  const api = window.api?.updater;
  const includePrereleases = useIncludePrereleases();
  const mode = ref<UpdateMode | null>(api == null ? "manual" : null);
  const status = ref<UpdateStatus>({ state: "idle" });

  if (api != null) {
    void api.mode().then((value) => (mode.value = value));
    const dispose = api.onStatus((value) => (status.value = value));
    onScopeDispose(dispose);
  }

  return {
    mode,
    status,
    async check() {
      if (api != null) status.value = await api.check(includePrereleases.value);
    },
    async download() {
      await api?.download();
    },
    async restart() {
      await api?.quitAndInstall();
    },
  };
}
```

- [ ] **Step 3: Rework `VersionChecker.vue`**

Keep the existing manual path exactly as it is, behind `mode === 'manual'`: the
query, the stepper, `onDownload` and `remindLater`. Add the auto path:

- In `<script setup>`, add `const autoUpdate = useAutoUpdate()`.
- Add a `watch` on `autoUpdate.mode`: when it becomes `'auto'`, call
  `autoUpdate.check()` now and then every 24 h. Use `useIntervalFn` from
  `@vueuse/core` if the GUI already uses it, otherwise `setInterval` with
  `onScopeDispose`.
- Run `useQuery` only when the mode is `'manual'`: add
  `enabled: computed(() => autoUpdate.mode.value === 'manual')`. The query stays
  as it is.
- Add
  `const autoRelease = computed(() => { const s = autoUpdate.status.value; return s.state === 'available' || s.state === 'downloading' || s.state === 'ready' || (s.state === 'error' && s.version != null) ? s : null })`.
- Add a `watchEffect` that opens the dialog when `autoRelease` becomes non-null
  and the dialog is not open, as the existing one does for `release`.
- Make **Later** close the dialog and remember that version in a `ref`, so it
  does not reopen until the next check finds a different version.
- Show the release link as
  `https://github.com/${RELEASES_REPOSITORY}/releases/tag/<tag>`, using the tag
  format recorded in Task 10, Step 3. Import `RELEASES_REPOSITORY` from
  `$/utils/github`.

In the template, render the same `Dialog` when `release` (manual) **or**
`autoRelease` (auto) is set. For auto, show:

| `autoRelease.state` | Content                                                                                       | Buttons                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `available`         | `versionOutdatedPrompt`, `latestVersion(version, releaseDate)`, changelog link, `yourVersion` | `remindMeLater`, `updateNow` → `autoUpdate.download()`                                    |
| `downloading`       | `updateDownloading(percent)`, with a `<progress :value="percent" max="100">`                  | none (the dialog stays dismissable; the download continues)                               |
| `ready`             | `updateReady(version)`                                                                        | `remindMeLater` ("it installs when you quit"), `restartToUpdate` → `autoUpdate.restart()` |
| `error`             | `updateFailed(message)`                                                                       | `retry` → `autoUpdate.download()`, `downloadManually` → the existing `onDownload`         |

Add the text keys to `english.json` next to `versionOutdatedPrompt`. Follow the
placeholder style of `latestVersion` (`$0`, `$1`), and declare their replacement
types wherever `latestVersion`'s are declared
(`git grep -n '"latestVersion"\|latestVersion:' app/common/src/text`):

```json
"updateNow": "Update",
"updateDownloading": "Downloading the update… $0%",
"updateReady": "Enso $0 is ready. It installs when you restart, or the next time you quit.",
"restartToUpdate": "Restart to update",
"updateFailed": "The update failed: $0",
"downloadManually": "Download manually",
```

If `retry` does not already exist, add `"retry": "Retry"`.

- [ ] **Step 4: Run the tests, typecheck and lint**

```bash
cd app/gui && corepack pnpm exec vitest run src/versionChecker src/dashboard/layouts/Settings
corepack pnpm run typecheck   # or the GUI's typecheck script
corepack pnpm exec eslint src/versionChecker src/providers/updateSettings.ts
```

Expected: all pass. Then run the whole GUI vitest suite once:
`corepack pnpm exec vitest run`. That was 2,545 tests at the end of the
local-only work; no failures.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/versionChecker app/common/src/text/english.json
git commit -m "Update dialog: Update, download progress, Restart to update, with a manual fallback"
```

### Task 16: End-to-end update test, changelog, PR 3

**This publishes public prereleases on the fork. Confirm with the user first.**

- [ ] **Step 1: Changelog and docs**

1. Add a `CHANGELOG.md` entry under `#### Enso IDE`:
   `- [Enso updates itself: when a new version is out, it offers to download it and installs it on restart. Settings → Local can include prerelease versions.][NNN]`
2. Update `app/electron-client/CLAUDE.md` with one paragraph on `updater.ts`,
   `updaterIpc.ts` and the `auto | manual` mode.
3. Commit, push, and open PR 3 as a draft, based on `feature/ide-only-release`.

- [ ] **Step 2: Publish `rc.1` from the PR 3 branch**

Run `gh workflow run promote.yml --ref feature/auto-update -f designator=rc` and
wait for it to finish. Install its `.exe` on Windows. In Settings → Local, turn
on **Include prerelease versions**.

- [ ] **Step 3: Publish `rc.2` from the same branch**

Make any trivial commit first (for example a CLAUDE.md wording fix), so the
build differs. Then dispatch `promote.yml` again.

- [ ] **Step 4: Update from `rc.1`**

Restart the installed `rc.1`. Expected:

- The dialog offers `rc.2`.
- **Update** shows progress.
- `%APPDATA%\Enso\logs` contains `Full: X MB, To download: Y MB` with Y well
  below X.
- **Restart to update** relaunches into `rc.2` (check the version in the About
  or Settings screen).

- [ ] **Step 5: Check the prerelease setting**

Turn **Include prerelease versions** off and restart `rc.2`. Expected: no
dialog, because there is no newer _stable_ release.

- [ ] **Step 6: Linux**

In WSL with WSLg, `chmod +x` the `rc.1` AppImage and run it. Repeat Step 4. If
FUSE is unavailable, run it with `--appimage-extract-and-run` and note that
self-update then reports `manual`, which is correct because `APPIMAGE` is unset.
In that case record that the AppImage update is unverified locally.

- [ ] **Step 7: Uninstall**

From Settings → Apps, uninstall Enso. Then run:

```powershell
Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object DisplayName -like 'Enso*'
Test-Path "$env:LOCALAPPDATA\Programs\enso"
```

Expected: no entry, and `False`.

- [ ] **Step 8: Hand over**

1. Report the numbers and the run links.
2. Ask the user whether to keep or delete the two test prereleases.
3. Mark PR 3 ready, and wait for the user's installer test before merging
   (memory `merge-gate-features`).
4. Then merge in order: retarget PR 2 to `develop`, merge PR 1; retarget PR 3,
   merge PR 2; merge PR 3.
5. Close #252 with links to the three PRs.
