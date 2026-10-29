# .github

GitHub Actions workflows, the composite actions they share, and repository
settings. Every workflow is hand-written YAML (build simplification;
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`).

## Layout

- `workflows/*-pull-request.yml` — the entry points for pull requests and
  `develop` pushes (✨ Engine, ✨ GUI, ✨ IDE, ✨ WASM, 🍎 macOS). Each runs its
  `*-changed-files.yml` gate, calls the matching checks workflow, and ends in an
  aggregator job.
- `workflows/*-changed-files.yml` — path gating: which files start which checks.
- `workflows/engine-checks.yml` + `engine-checks-platform.yml`,
  `ide-packaging.yml`, `gui-checks.yml`, `wasm-checks.yml`, `macos-checks.yml` —
  the checks, callable (`workflow_call`) and mostly startable by hand
  (`workflow_dispatch`).
- `workflows/changelog.yml`, `std-libs-labels.yml`, `formatting.yml`,
  `enso4igv.yml`, `workflow-lint.yml`, `build-scripts.yml` — single-purpose
  pull-request workflows. `build-scripts.yml` type-checks, lints and tests
  `tools/build-scripts`.
- `workflows/release.yml`, `promote.yml`, `nightly.yml` — releases.
  `promote.yml` (by hand, or from `nightly.yml`'s daily cron) computes the
  version and calls `release.yml`, which drafts the release, builds and uploads
  the installers and publishes it with `tools/build-scripts`' `release` command
  (Note [Where The Release Logic Lives] in `release.yml`). Change them only
  together with an rc release test. `engine-checks-nightly.yml` (by hand) adds
  macOS and Oracle GraalVM to the engine checks, `extra-nightly-tests.yml` (by
  hand) the suites that need the Snowflake and Enso Cloud secrets, and
  `macos-checks.yml` the self-hosted Mac's checks for `macos-pull-request.yml`;
  all three call `engine-checks-platform.yml`.
- `workflows/engine-benchmark.yml`, `std-libs-benchmark.yml` — benchmarks,
  started by hand. Their artifacts are the only output: the upstream
  `bench-upload.yml` was removed (#307), as the fork has no results repository.
- `actions/` — composite actions: `setup-node`, `setup-rust`, `setup-jvm`
  (GraalVM CE, or Oracle GraalVM with `edition: oracle`, sbt, optionally `flatc`
  and GraalPy at the `toolchain:` pins in `build-config.yaml` and the
  `rust-toolchain.toml` Rust toolchain, plus the sbt dependency cache),
  `setup-msvc` (the MSVC developer environment on Windows, for native images and
  the runtime DLL copy), `git-clean`, `setup-build-scripts` (install
  `tools/build-scripts`' dependencies only), `download-engine-distribution`.
- `actionlint.yaml` — actionlint's configuration; each ignore says why it stays.
- `settings.yml`, `mergify.yml` — inherited from upstream. Neither is live on
  this fork: the branch rules are a repository ruleset, which requires no status
  check.

## Conventions

- **Keep the aggregator names verbatim:** "Engine Required Checks", "GUI
  Required Checks", "IDE Required Checks", "WASM Required Checks". They are what
  a reviewer (or a ruleset) looks for.
- **Every `pull_request` trigger ignores `docs/superpowers/**`** (or uses a
  `paths` whitelist that leaves it out). `tools/ci/check-workflows.mjs` fails
  any workflow that forgets.
- **A new workflow or composite action used by the engine checks goes on the
  list in `engine-changed-files.yml`**, or a change to it will not run them.
  `ide-changed-files.yml` already covers all of `.github/**`.
- **App-only PRs package with develop's backend.** When no engine file changed,
  `ide-pull-request.yml` passes `build_backend: false` and `ide-packaging.yml`
  downloads the `backend-<os>` artifacts of the newest develop run whose commit
  is an ancestor of the PR head (`find-backend`). The `CI: Build IDE` label or
  any engine change builds the backend instead; develop and releases always do.
- **One OS/arch set is one `strategy.matrix`**, with `fail-fast: false`. Where a
  platform's failure must not skip or delay the other platform's jobs, the
  platform is a reusable workflow called with a matrix (`engine-checks.yml`);
  where waiting costs no wall-clock time, legs use `if: ${{ !cancelled() }}`
  (see Note [Platform Legs Run Despite The Other Platform's Failure] in
  `ide-packaging.yml`).
- **A reusable workflow called with a matrix has no `concurrency:`**: its legs
  would share the group and cancel each other.
- **Composite actions keep the shell a step had**: PowerShell on Windows, bash
  elsewhere, as two steps with `runner.os` conditions. A composite step must
  name its shell, and on Windows `tar` behaves differently under Git Bash.
- **`ENSO_CI_CLEAN_BUILD`**, set at the top of a workflow, decides whether
  `git-clean` cleans: the `CI: Clean build required` label, a run on `develop`,
  or the `clean_build_required` input.
- **Actions are pinned by major tag** (`@v5`), as everywhere here; a new
  third-party action or image must be at least two weeks old. The actionlint
  image is pinned to an exact version.
- **A job that runs `sbt` itself uses `setup-jvm` first.** Jobs that resolve the
  same build share a `cache-key` (`engine` for the engine build, JVM tests, lint
  and the IDE's backend), so that one ~830 MB entry per OS serves them all: the
  repository's Actions cache is capped at 10 GB. Give a distinct key only to
  jobs that resolve different dependencies. A job whose sbt tasks compile the
  Rust parser passes `rust: "true"`. Quote `-D` arguments
  (`sbt "-Dsbt.server.autostart=false" …`): on Windows, PowerShell splits an
  unquoted one at its first dot. `tools/ci/check-workflows.mjs` fails a job that
  runs `sbt` before `setup-jvm`, and fails `build-config.yaml`'s pins if they
  drift from `graalVersion`, `graalMavenPackagesVersion`, `flatbuffersVersion`
  (`project/Dependencies.scala`) or `sbt.version` (`project/build.properties`).
  It counts `sbt` (and `sbt.bat`) as a command after inline `VAR=value`
  assignments and wrappers (`timeout`, `time`, `env`, `nice`, `xvfb-run`,
  `cmd /c`), inside `bash -c` and `pwsh -Command` scripts and local composite
  actions, and behind any `tools/build-scripts` command that starts sbt (one
  whose entry point imports `src/lib/sbt.ts`), run as a package script or with
  plain node.

## Where the build logic lives

Workflows call sbt directly for the engine, and `tools/build-scripts` for what
needs more than one tool. A job that runs a distribution built by another job
uses that job's version, from its outputs, not sbt's default `0.0.0-dev`: see
Note [Lint Reads The Distribution's Version] in `engine-checks-platform.yml`.

| Workflow › job                                           | Step                                                                                                       | Set up by                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `formatting.yml`, `enso4igv.yml`                         | `sbt …`                                                                                                    | `setup-jvm`                                      |
| `engine-benchmark.yml`                                   | `sbt runtime-benchmarks/bench` (`benchOnly <name>`)                                                        | `setup-jvm`                                      |
| `std-libs-benchmark.yml`                                 | `sbt std-benchmarks/bench` (`benchOnly <name>`)                                                            | `setup-jvm`                                      |
| `engine-checks-platform.yml` › Enso Code Lint            | `sbt lintEnso` (version from the build job), `sbt checkEnsoSyntax`                                         | `setup-jvm`                                      |
| `engine-checks-platform.yml` › Build Engine Distribution | `version`, then `sbt "clean; all ciBuildEngineDistribution"`                                               | `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
| `engine-checks-platform.yml` › JVM Tests                 | `sbt …` steps                                                                                              | `setup-jvm`, `setup-msvc`                        |
| `engine-checks-platform.yml` › API check                 | `corepack pnpm --filter build-scripts run stdlib-api-check`                                                | `setup-build-scripts`                            |
| `engine-checks-platform.yml` › stdlib tests              | `corepack pnpm --filter build-scripts run stdlib-test <suite>`                                             | `setup-jvm` (GraalPy), `setup-build-scripts`     |
| `changelog.yml`                                          | `actions/github-script` (`pulls.listFiles`)                                                                | —                                                |
| `ide-packaging.yml` › Build Backend                      | `version`, then `sbt "clean; all buildEngineBundle"`                                                       | `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
| `ide-packaging.yml` › Find develop's backend             | `gh api` (artifact list, compare); no build                                                                | —                                                |
| `ide-packaging.yml` › Package New IDE                    | `corepack pnpm --filter build-scripts run ide-build`                                                       | `setup-build-scripts`                            |
| `release.yml`                                            | `release create-draft`, `upload-ide`, `publish`, `update-latest-version`; `buildEngineBundle`; `ide-build` | `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
| `promote.yml`                                            | `release promote <designator>`                                                                             | `setup-build-scripts`                            |
| `engine-checks-nightly.yml`, `macos-checks.yml`          | calls of `engine-checks-platform.yml`                                                                      | —                                                |
| `extra-nightly-tests.yml`                                | `engine-checks-platform.yml`, then `stdlib-test <suite>`                                                   | `setup-jvm` (GraalPy), `setup-build-scripts`     |

## Checking a change

- `actionlint` (Linux, from WSL): download the pinned release once, then run it
  from the repository root with shellcheck:

  ```bash
  wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck'
  ```

- `node tools/ci/check-workflows.mjs` and `node --test tools/ci/*.test.mjs` —
  the workflow policy (the rules the generator's tests enforced) and its tests.
- A pull request from a branch of this repository runs **its own** workflow
  files and composite actions, so the PR's checks are the test of a workflow
  change. A workflow that only runs by hand is tested with
  `gh workflow run <file> --ref <branch>`, which runs the branch's version.
