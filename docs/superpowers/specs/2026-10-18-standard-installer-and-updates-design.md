# A standard installer and automatic updates: design

Date: 2026-10-18. Status: draft, for review.

## Goal

Replace the custom Rust Windows installer with the standard Electron toolchain,
and give the IDE a real update process:

1. **Windows installs with electron-builder's NSIS target**, per-user and
   without admin rights, into the same folder as today.
2. **The app updates itself** on Windows, Linux (AppImage) and macOS, through
   `electron-updater` with GitHub Releases as the feed. The user is asked before
   anything downloads, and the update installs on restart.
3. **`release.yml` publishes IDE releases on the fork** with nothing but
   `GITHUB_TOKEN`: stable releases, and `rc`/`nightly` prereleases that users
   opt into.
4. **`build_tools/install` is deleted**: four crates, about 2.7k lines of Rust
   that only this project tests.

## Background

### Why the Rust installer exists

Upstream wrote it in 2024 (enso-org/enso#9815) because electron-builder's NSIS
and MSI installers failed on long paths, and an NSIS bug blocked the
electron-builder upgrade. enso-org/enso#9977 records that the longest installed
path was then 234 characters, through the nested `.enso/cache` directories of
the standard libraries, and that WiX v5 did not fix the long-path failures.

Both reasons have gone:

- The bundle no longer ships `.enso/cache`. The longest path in a current
  install is 206 characters (`%LOCALAPPDATA%\Programs\Enso\` plus 164), under
  the 260 limit with room for a long user name.
- The NSIS bug (electron-builder#6865: the running-app check matched any process
  whose name contained the product name, here the engine's `enso.exe`) was
  closed in May 2026.

### What the Rust installer does

All per-user (HKCU), in `build_tools/install`:

- Extracts a tar.gz payload into `%LOCALAPPDATA%\Programs\Enso`, after wiping
  the folder; there is no version comparison or migration.
- Refuses to run while any process from the install folder is running.
- Registers the `.enso` and project-bundle file associations with the ProgIDs
  `Enso.Source` and `Enso.ProjectBundle`, plus `App Paths\Enso.exe`.
- Writes the uninstall entry `…\CurrentVersion\Uninstall\Enso`.
- Creates Start Menu and Desktop shortcuts, then launches the app.
- Its uninstaller leaves the extension keys and `App Paths` behind.

On 2026-10-18 it shipped an installer that exited silently on launch (#251): it
embeds the electron-builder config at build time and fell back to an empty stub
when the config stopped parsing.

### Updates today

There is no update mechanism. `app/gui/src/utils/github.ts` queries the GitHub
Releases API once a day, and `VersionChecker.vue` offers to download the first
`.exe`, `.dmg` or `.AppImage` asset of a newer release. The user runs it by
hand.

### The fork's release state

The fork has no GitHub Releases and no CI secrets: no Windows certificate and no
Apple Developer ID. `release.yml` has never run on the fork. It is upstream's
combined engine and IDE release, and needs AWS (S3, ECR) and cloud secrets. The
last nightly runs, in May 2026, were all cancelled.

### Size

`win-unpacked` is 2,037 MB in 4,016 files: the GraalVM runtime (401 MB), the
engine distribution (1,230 MB) and Electron. The current installer is 902 MB.
Without differential downloads, every update would be close to 1 GB.

## Decisions

| Question              | Decision                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installer and updater | electron-builder NSIS (Windows), AppImage (Linux), dmg plus zip (macOS); `electron-updater` on all three. Rejected: keeping the Rust installer and adding a custom updater (no differential downloads, more custom code); MSI (admin rights, no `electron-updater` support); MSIX (cannot install unsigned outside Developer Mode). |
| Platforms             | All three.                                                                                                                                                                                                                                                                                                                          |
| Signing               | Designed for signing, shipped unsigned. Signing switches on when the secrets are added, with no code change. Unsigned macOS cannot update itself, so it keeps the download link until an Apple Developer ID exists.                                                                                                                 |
| Update UX             | Ask, then download: the daily check offers the update, the user clicks Update, it downloads in the background, then "Restart to update". It also installs on the next quit.                                                                                                                                                         |
| Channels              | Stable by default. A setting, "Include prerelease versions", opts into GitHub prereleases (`rc`, `nightly`). `-dev` builds never update themselves.                                                                                                                                                                                 |
| Feed                  | GitHub Releases on the fork, through `electron-updater`'s `github` provider.                                                                                                                                                                                                                                                        |
| Install location      | `%LOCALAPPDATA%\Programs\Enso`, as today, so upgrades land in place.                                                                                                                                                                                                                                                                |
| Release workflow      | `release.yml` is regenerated as an IDE-only release that needs only `GITHUB_TOKEN`. `promote.yml` and `nightly.yml` stay.                                                                                                                                                                                                           |

## Design

### Packaging

In `app/electron-client/electron-builder-config.ts`:

| Platform | Installs with                                                    | Updates with                                    | Feed               |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------- | ------------------ |
| Windows  | `enso-win-x64-<ver>.exe` (NSIS, `oneClick`, `perMachine: false`) | the same `.exe` and its `.blockmap`             | `latest.yml`       |
| Linux    | `enso-linux-x86_64-<ver>.AppImage`                               | the same `.AppImage` and its `.blockmap`        | `latest-linux.yml` |
| macOS    | `.dmg`                                                           | `.zip` and its `.blockmap` (signed builds only) | `latest-mac.yml`   |

- **NSIS:**
  - Installs per-user to `%LOCALAPPDATA%\Programs\Enso`.
  - Registers the existing file associations, and creates Start Menu and Desktop
    shortcuts.
  - `differentialPackage: true` on release builds only. The config's old comment
    says blockmap generation once took 30 minutes; the spike measures it, and PR
    builds skip it.
- **`publish`:** `{ provider: 'github', owner: 'jdunkerley', repo: 'enso' }`.
  electron-builder never uploads (the build passes `--publish never`). The
  setting only writes `app-update.yml` into the app and `latest*.yml` next to
  the artifacts.
- **Removed:** the `msi` block and the MSI version-number workaround,
  `extraMetadata.installer` and `getInstallerAdditionalConfig`, and the
  `electron-builder-squirrel-windows` pin if `app-builder-lib` no longer needs
  it.
- **Signing:** electron-builder signs from `WIN_CSC_LINK` /
  `WIN_CSC_KEY_PASSWORD` (or `CSC_*`) when set, and skips signing otherwise.
  When a Windows certificate is present, the build also sets
  `win.signtoolOptions.publisherName`, so `electron-updater` refuses an update
  signed by anyone else. macOS keeps its existing signing and notarisation
  hooks.

### Removals

- `build_tools/install` (`enso-install`, `enso-install-config`,
  `enso-installer`, `enso-uninstaller`) and their Cargo workspace entries.
- The Windows branch of `build_tools/build/src/ide/web.rs` that calls
  `bundler::bundle`. Windows then builds like the other platforms:
  electron-builder writes the installer.
- Code in `ci_utils` used only by the installer, such as the `signtool` wrapper
  and the Windows signing-credential plumbing, if nothing else uses it.

### Migrating existing installs

People who installed with the Rust installer have registry entries NSIS does not
know about. `app/electron-client/build/installer.nsh`, hooked into
electron-builder's `customInit`, checks for
`HKCU\…\CurrentVersion\Uninstall\Enso` (the Rust key; NSIS uses a GUID-named key
derived from `appId`). If it exists, the script:

1. **Deletes the install folder before NSIS copies files in.** This is required:
   the app finds its engine by globbing `resources/enso/dist/*/bin`, so a
   leftover `dist/<old-version>` could start the wrong engine. User data is
   outside the folder (`%APPDATA%\Enso`, `%LOCALAPPDATA%\enso`).
2. Deletes the Rust uninstall key and `App Paths\Enso.exe`.
3. Deletes `Enso.Source` and `Enso.ProjectBundle` if NSIS registers the
   associations under different ProgIDs (the spike finds out). The shortcuts
   have the same names, so NSIS overwrites them.

Existing users reach the new installer through their current download dialog,
which picks the first `.exe` asset of the latest release: the NSIS installer is
the only one. After that one manual install, updates are automatic. Later
NSIS-to-NSIS updates remove the previous version through NSIS's own uninstaller,
so `dist/*` stays unambiguous.

macOS and Linux need no migration: the app bundle and the AppImage are replaced
whole.

### The updater

`app/electron-client/src/updater.ts`, in the main process, wraps
`electron-updater`'s `autoUpdater`:

- `autoDownload: false`, `autoInstallOnAppQuit: true`.
- `allowPrerelease` comes from the setting.
- Logs to the existing Electron log (`%APPDATA%\Enso\logs` on Windows).

IPC to the GUI:

| Call               | Result                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| `check()`          | `{ mode: 'auto' \| 'manual', available, version, notes, downloadUrl }`       |
| `download()`       | starts the download, and emits `progress` and then `ready` or `error` events |
| `quitAndInstall()` | quits through the app's normal quit path, then installs                      |

**Mode.** The build writes `updates: 'auto' | 'manual'` into the build info:

- `manual` for `-dev` builds, and on macOS when the Apple secrets were absent
  (the `.zip` is then not built).
- At run time, Linux is `manual` unless `APPIMAGE` is set, and an unpackaged app
  is always `manual`.
- In `manual` mode, `check()` still reports a newer release, through
  `electron-updater`'s feed or the GitHub API, and the dialog shows today's
  Download link.

**Flow:**

1. The daily check, or "Check for updates", finds a newer version (semver
   against `app.getVersion()`). This replaces the hand-written comparison in
   `versionChecker.ts`.
2. The dialog shows the version and release notes, with **Update** and
   **Later**.
3. **Update** downloads, with progress in the dialog. `electron-updater`
   downloads only the changed blocks when both releases' blockmaps are
   available, and the whole file otherwise. The file is checked against the
   sha512 in `latest*.yml`.
4. **Restart to update** goes through the normal quit path, which closes
   projects and stops the language server and engine, then installs and
   relaunches. If the user picks Later, the update installs on the next quit.

**Errors:**

- A failed check is logged and retried the next day; it never interrupts the
  user.
- A failed download or checksum mismatch shows an error with **Retry** and
  **Download manually**.
- A failed install leaves the old version in place; it is logged, and the dialog
  offers the update again.

### GUI

- `VersionChecker.vue` and `utils/github.ts` call the updater over IPC instead
  of the GitHub API. The dialog gains downloading, ready and error states.
- Settings gains "Include prerelease versions", stored with the existing
  settings and passed to main.

### Release workflow

`promote.yml` (choose `stable`, `patch`, `rc` or `nightly`; it computes the
version) and `nightly.yml` (manual) stay as they are. `release.yml` is
regenerated by `build_tools/build/src/ci_gen` with:

| Job                                               | Change                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Build Script ×3                                   | kept                                                                                                                                      |
| Verify License Packages                           | kept                                                                                                                                      |
| Create a release draft                            | kept (`release create-draft`; GitHub only)                                                                                                |
| Build IDE ×3                                      | builds the engine itself (`--backend-source build`), then uploads the installer, blockmap and `latest*.yml` to the draft                  |
| Publish release                                   | rewritten: removes the draft flag, and marks `rc` and `nightly` as prereleases; the S3 edition-manifest update and the assets manifest go |
| Update the latest release version                 | kept (opens the `build-config.yaml` PR; skipped for prereleases)                                                                          |
| Upload Backend ×3                                 | removed: the engine ships inside the IDE, and nothing on the fork downloads standalone engine bundles                                     |
| Upload Runtime to ECR, Dispatch Cloud build-image | removed: cloud only                                                                                                                       |

- `electron-updater` ignores drafts, so a release appears all at once or not at
  all. A failed platform leaves the draft unpublished.
- Old releases are never deleted by the workflow. Differential updates read the
  previous release's blockmap; a deleted release only costs its users a full
  download.
- The AWS release code in `build_tools` (S3 edition manifest, ECR deploy) goes
  if nothing else uses it, and so does `release-update-broken.yml`, which marks
  releases broken in the S3 manifest.
- The upload step is a build-CLI command, so the job definitions stay in
  `ci_gen`.

### PR CI

- `ide-packaging.yml` builds the NSIS installer on Windows (without blockmaps).
  The packaged-app tests keep testing the unpacked app.
- **New smoke step on Windows:**
  1. Run the installer silently (`/S`) and check it exits with 0.
  2. Check that `Enso.exe` exists in the install folder and the uninstall entry
     exists.
  3. Start the app and quit it.
  4. Run the uninstaller silently and check the folder and keys are gone.

  This is the check that would have caught #251.

## Delivery

**Spike first** (throwaway, nothing merged). Build the NSIS installer from a
current bundle and measure:

- the build time with and without blockmaps
- the install time against the Rust installer's
- the differential download size between two builds
- the ProgIDs NSIS registers
- an install over a Rust-installed Enso, with the migration script

If the install time or blockmap generation is unacceptable, stop and revisit
this design before deleting anything.

Then three PRs. Each works on its own, and each waits for the user's installer
test before merging.

1. **NSIS replaces the Rust installer:** the NSIS target and `installer.nsh`,
   the removal of `build_tools/install` and the bundler step, and the smoke
   step. Changelog entry: the installer looks and behaves differently.
2. **The new `release.yml`:** the regenerated workflows, the `publish` config,
   the upload command and the removed AWS code. No changelog entry (CI only).
   Verified by running it on the fork with `designator: rc`.
3. **The updater:** `updater.ts` and its IPC, the reworked dialog, the
   prerelease setting and the `updates` build flag. Changelog entry.

## Testing

Automated:

- **Electron (vitest):** `updater.ts` as a state machine against a mocked
  `autoUpdater`, covering:
  - manual mode for `-dev`, unpackaged, unsigned macOS, and Linux without
    `APPIMAGE`
  - the prerelease setting
  - the error paths
  - `quitAndInstall` going through the normal quit path
- **GUI (vitest, Playwright):** the dialog's states (available, downloading,
  ready, error, manual) with the IPC mocked.
- **Rust:** a `ci_gen` test that `release.yml` has exactly the expected jobs.
  Regenerating the workflows must leave them unchanged.
- **CI:** the Windows smoke step on every packaging run.

Manual, before merging (Windows, and Linux in WSL):

- **Fresh install:** one uninstall entry, working file associations and
  shortcuts.
- **Upgrade over a Rust install:** the old uninstall entry is gone, there is one
  `dist/*` folder, and user projects and settings are intact.
- **Update:** install `rc.1` from the fork's releases, publish `rc.2`, and check
  that the dialog offers it. Then Update → progress → Restart, and check that
  the new version runs and the download was partial. With the prerelease setting
  off, `rc.2` must not be offered.
- **Linux:** the same update with the AppImage.
- **macOS:** without the Apple secrets, check that no `latest-mac.yml` is
  published. The manual fallback is covered by unit tests until a Mac is
  available.
- **Uninstall:** no Enso registry keys remain.

## Out of scope

- Obtaining certificates (Apple Developer ID, a Windows code-signing certificate
  or Azure Trusted Signing). The design switches signing on when the secrets
  appear.
- A scheduled nightly; `nightly.yml` stays manual.
- Staged rollouts (`stagingPercentage`), and downgrades.
- Linux formats other than AppImage (deb, rpm, Snap, Flatpak).
- Engine-only releases and the edition manifest.
