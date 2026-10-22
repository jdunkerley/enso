# .github

GitHub Actions workflows, the composite actions they share, and repository
settings. Every workflow is hand-written YAML: the Rust generator
(`build_tools/ci-gen`) is retired (build simplification, Phase 1;
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
- `workflows/release.yml`, `promote.yml`, `nightly.yml` — releases. They are the
  generator's last output, kept unchanged until Phase 4 rewrites them; change
  them only together with an rc release test. `engine-checks-nightly.yml`,
  `extra-nightly-tests.yml` and `macos-checks.yml` are likewise kept in the
  generator's layout until Phase 4 (edit directly).
- `workflows/engine-benchmark.yml`, `std-libs-benchmark.yml`, `bench-upload.yml`
  — benchmarks, started by hand. `bench-upload.yml` keys on the other two by
  their `name:`; keep those names.
- `actions/` — composite actions: `build-script` (compile `./run`'s CLI once per
  platform), `setup-build-script` (use it in a job), `setup-node`, `setup-rust`,
  `setup-jvm` (GraalVM, sbt and optionally `flatc` at the `toolchain:` pins in
  `build-config.yaml`, plus the sbt dependency cache), `setup-msvc` (the MSVC
  developer environment on Windows, for native images and the runtime DLL copy),
  `git-clean`, `setup-build-scripts` (install `tools/build-scripts`'
  dependencies only), `download-engine-distribution`.
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
  name its shell, and on Windows `./run` and `tar` behave differently under Git
  Bash.
- **`ENSO_CI_CLEAN_BUILD`**, set at the top of a workflow, decides whether
  `git-clean` cleans: the `CI: Clean build required` label, a run on `develop`,
  or the `clean_build_required` input.
- **Actions are pinned by major tag** (`@v5`), as everywhere here; a new
  third-party action or image must be at least two weeks old. The actionlint
  image is pinned to an exact version.
- **A job that runs `sbt` itself uses `setup-jvm` first**, with a `cache-key` of
  its own. Quote `-D` arguments (`sbt "-Dsbt.server.autostart=false" …`): on
  Windows, PowerShell splits an unquoted one at its first dot.
  `tools/ci/check-workflows.mjs` fails a job that runs `sbt` before `setup-jvm`,
  and fails `build-config.yaml`'s pins if they drift from `graalVersion`,
  `graalMavenPackagesVersion`, `flatbuffersVersion`
  (`project/Dependencies.scala`) or `sbt.version` (`project/build.properties`).
  It counts `sbt` (and `sbt.bat`) as a command after inline `VAR=value`
  assignments and wrappers (`timeout`, `time`, `env`, `nice`, `xvfb-run`,
  `cmd /c`), inside `bash -c` and `pwsh -Command` scripts and local composite
  actions, and behind any `tools/build-scripts` command that starts sbt (one
  whose entry point imports `src/lib/sbt.ts`).

## What still goes through `./run`

Build simplification Phase 2 moves the steps where `./run` only wraps one sbt
call: the benchmarks (PR 2b) and the engine checks' Enso lint (PR 2c), both
done. The formatting and enso4igv jobs, which never went through `./run`, use
`setup-jvm` too. A moved step sets every variable `./run` set for it: the
Standard Library benchmarks keep `ENSO_LAUNCHER=native,-ls` (Note [Benchmarks
Call sbt Directly] in `engine-benchmark.yml`). The rest need logic that is still
in `./run`, and move in Phase 3 or 4. `./run` computes the version on every
call. A job that runs a distribution built by another job must therefore use
that job's version, not sbt's default `0.0.0-dev`: the Enso lint takes it from
the build job's outputs (Note [Lint Reads The Distribution's Version] in
`engine-checks-platform.yml`).

| Workflow › job                                           | Step                                                         | Goes through `./run`?                       |
| -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `formatting.yml`, `enso4igv.yml`                         | `sbt …`                                                      | No: `setup-jvm`                             |
| `engine-benchmark.yml`                                   | `sbt runtime-benchmarks/bench` (`benchOnly <name>`)          | No: `setup-jvm`                             |
| `std-libs-benchmark.yml`                                 | `sbt std-benchmarks/bench` (`benchOnly <name>`)              | No: `setup-jvm`                             |
| `engine-checks-platform.yml` › Enso Code Lint            | `sbt lintEnso` (version from the build job)                  | No: `setup-jvm`                             |
| `engine-checks-platform.yml` › Enso Code Lint            | `sbt checkEnsoSyntax`                                        | No: `setup-jvm`                             |
| `engine-checks-platform.yml` › Build Engine Distribution | `version`, then `sbt "clean; all ciBuildEngineDistribution"` | No: `setup-jvm`, `setup-msvc`               |
| `engine-checks-platform.yml` › JVM Tests                 | `./run backend test jvm`                                     | Yes: Phase 3                                |
| `engine-checks-platform.yml` › API check                 | `corepack pnpm --filter build-scripts run stdlib-api-check`  | No: `setup-build-scripts`                   |
| `engine-checks-platform.yml` › stdlib tests              | `./run backend test …`                                       | Yes: Phase 3 (`stdlib-test`)                |
| `changelog.yml`                                          | `actions/github-script` (`pulls.listFiles`)                  | No                                          |
| `ide-packaging.yml` › Build Backend                      | `./run backend get`                                          | Yes: Phase 3 (`buildEngineBundle`, version) |
| `ide-packaging.yml` › Package New IDE                    | `./run ide build`                                            | Yes: Phase 3 (version)                      |
| release, promote, nightly, nightly checks, macOS         | various                                                      | Yes: Phase 4                                |

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
