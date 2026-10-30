# CI speed 2c: can JVM Tests start without the build? — finding

Task 8 of `docs/superpowers/plans/2026-10-30-ci-speed-phase-2.md` (spec 2c of
the CI speed design, #417). A spike: three CI runs on the throwaway branch
`ci/spike-jvm-tests-no-wait` (PR #437, closed unmerged).

**Decision: go.** `JVM Tests` drops `needs: [build-engine-distribution]` and
builds the engine package itself, in the same sbt session as the tests. Every
test passes as on develop, and on Windows the job ends ~54 min after the run
starts, not ~79. Implementation: #442.

## The question

On Windows, `JVM Tests` (43–55 min) waits for `Build Engine Distribution` (31–35
min), and that chain is the engine PR's critical path. Does `sbt test` (with the
parser self-tests) need anything from the build job beyond what sbt can build
itself? If not, the job can start at once.

## What reads the downloaded distribution

The job downloads the build's distribution and passes its `ENSO_VERSION`,
`ENSO_EDITION` and `ENSO_RELEASE_MODE` so that `engineDistributionRoot`
(`built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`) points
at it. Readers, from
`git grep -n "engineDistributionRoot\|built-distribution\|languageHome" -- build.sbt project "*/src/test/*"`
and the test sources:

| Reader                                                                                                                                    | What it reads                                                                                                                              | Needs the build job?                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `runtime-integration-tests` `Test / javaOptions`: `-Dpolyglot.enso.languageHomeOverride=<engineDistributionRoot>/component` (`build.sbt`) | Every polyglot context that does not set the option itself. `LanguageHome` requires the parent to exist and loads `lib/Standard/*` from it | No: `component/` and `lib/` come from `createEnginePackageNoIndex` |
| `std-benchmarks` annotation processor (`SpecCollector`), compiled by `test` and by the Linux benchmark step                               | `built-distribution/…/bin*` and the standard library, to run the benchmark specs                                                           | No: the package's `bin/` (shell launcher) is enough                |
| `runtime-benchmarks/bench` (Linux benchmark step)                                                                                         | `dependsOn(buildEngineDistribution)`: sbt builds it itself                                                                                 | No                                                                 |
| Tests using `ContextUtils`, `SerdeCompilerTest`, `InterpreterTest.languageHome`, `BaseServerTest`, `bench-processor` `Utils`              | The source tree's `distribution/component` (parent `distribution/`, libraries at `0.0.0-dev`)                                              | No                                                                 |
| `SerializationManagerTest`                                                                                                                | `interpreterContext.languageHome()/../lib/…` = the source tree                                                                             | No                                                                 |
| `DownloadLibraryTest`                                                                                                                     | `ENSO_VERSION`/`ENSO_EDITION` env, defaulting to `0.0.0-dev`                                                                               | No                                                                 |
| `os-environment` tests                                                                                                                    | Their own `Test / buildNativeImage` images                                                                                                 | No (already built in the job)                                      |
| `checkIRCacheSizes`, `bench`, `benchOnly`, `buildEngineBundle`, `ciBuildEngineDistribution`, `runEngineDistribution`                      | `dependsOn(buildEngineDistribution)`; none is part of `test`                                                                               | —                                                                  |

No `Test` task depends on a native image of the engine (`engine-runner`) or of
the ydoc server built by the build job, nor on the launcher. Nothing in the job
needs the build's version: with the variables gone, sbt uses `0.0.0-dev`, as a
local run does.

## The runs

Baseline: develop's run of the spike's merge base, b0e7031548 (run 40970911028),
which needed the build. The spike's runs are PR #437's.

| Run                               | What changed in `jvm-tests`                                                                                                    | Linux JVM Tests                                         | Windows JVM Tests                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| develop 40970911028 (baseline)    | — (waits for the build)                                                                                                        | 1888 passed, 43 skipped; starts 23.7 min in, lasts 52.4 | 1882 passed, 49 skipped; starts 25.7 min in, lasts 53.6                |
| spike 1, 40971607143 (65b671647a) | No `needs`, no download, no version variables                                                                                  | **failed**: 258 passed, then sbt aborted; 25.7 min      | **green but wrong**: 257 passed, 1 skipped, then sbt aborted; 28.5 min |
| spike 2, 40978687623 (fc0efc83e8) | + a step `sbt buildEngineDistributionNoIndex` (`ENSO_LAUNCHER=shell`) before the tests                                         | 1888 passed, 43 skipped; starts at 0, lasts 52.5        | 1882 passed, 49 skipped; starts at 0, lasts 59.9                       |
| spike 3, 40985218668 (bd05c2a15f) | The package built in the tests' sbt session: `"buildEngineDistributionNoIndex; set Global / parallelExecution := false; test"` | 1888 passed, 43 skipped; starts at 0, lasts 51.7        | 1882 passed, 49 skipped; starts at 0, lasts 53.75                      |

Counts are the "Engine Tests Report" badges; spikes 2 and 3 have no
`*** FAILED ***` line and the same `[success] Total time` lines as develop.
Every `JVM Tests` job of the spike started in the same second as the build jobs.

Inside the job (minutes):

| Step                                              | Linux develop | Linux spike 2 | Linux spike 3 | Windows develop | Windows spike 2 | Windows spike 3 |
| ------------------------------------------------- | ------------- | ------------- | ------------- | --------------- | --------------- | --------------- |
| Clean before + download                           | 3.5           | 0             | 0             | 6.7             | 0               | 0               |
| Install the library server's deps                 | 0.9           | 2.7           | 2.7           | 1.7             | 5.6             | 5.0             |
| Engine package (`buildEngineDistributionNoIndex`) | —             | 4.8           | (4.3 of next) | —               | 8.9             | (7.8 of next)   |
| `sbt test` step                                   | 31.7          | 27.9          | 32.0          | 41.7            | 40.3            | 44.1            |
| Benchmarks (Linux)                                | 7.0           | 7.7           | 7.7           | —               | —               | —               |

The package costs little on Linux (+0.3 min net in one session: most of its time
is the engine compilation `test` would do anyway) and ~2.4 min net on Windows
(copying the standard library and GraalPy's home is slow there). As a separate
sbt call it costs a further sbt start and resolution (spike 2). The develop
columns include develop's clean-build `Clean before` (3–7 min), which a PR does
not pay and which already installs `wasm-bindgen-cli`, so develop's
library-server install is short; on the spike's PR runs that step installed it
with `cargo install` (3.3 min Windows, 1.2 Linux), which #434 (task 6) has since
replaced with the prebuilt binary.

## Classification

Spike 1's differences, all in two projects:

| Difference                                                                                                                                                                                                                                              | Class                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `runtime-integration-tests` (`GlobalScopeTest`, `ImportsTest`, …): `Library [Standard.Base:0.0.0-dev] was not found` (Linux), `LanguageHome must exists D:\a\enso\enso\built-distribution\enso-engine-0.0.0-dev-windows-amd64\enso-0.0.0-dev` (Windows) | (a) — the package's `component/` and `lib/`; fixed in spike 2 |
| `std-benchmarks` compile: `SpecCollector: Cannot find bin* in …/built-distribution/…` (in `test`, and in the Linux benchmark step)                                                                                                                      | (a) — the package's `bin/`; fixed in spike 2                  |

No (b) (native image or launcher) and no (c) (flake). The rest of spike 1's
missing tests are those sbt never reached after the forked test JVM crashed
(`Fatal: Existing as unable to continue running tests`).

## Decision

**Go.** Every difference is (a), and with the package built in the same sbt
session (spike 3) Windows `JVM Tests` takes 53.75 min from the start of the run,
under the plan's bar of the Windows build plus the slowest Windows stdlib shard
(≈ 55). With #434's prebuilt `wasm-bindgen-cli` (−3.3 min in this job on
Windows) expect ~51.

## The change (#442)

In `.github/workflows/engine-checks-platform.yml`, job `jvm-tests`:

- delete `needs: [build-engine-distribution]` and the "Download the engine
  distribution" step;
- delete every `ENSO_VERSION`, `ENSO_EDITION` and `ENSO_RELEASE_MODE` line in
  the job;
- the "JVM tests" step runs
  `sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "buildEngineDistributionNoIndex; set Global / parallelExecution := false; test"`
  with `ENSO_LAUNCHER: shell` added to its `env` (the default outside release
  mode; explicit, so a release-mode environment cannot turn on native images);
- rewrite the job's comment block, and the "JVM Tests" row of
  `.github/CLAUDE.md`'s table (it no longer reads the build's distribution).

Everything else in the job stays. Tasks 4 and 5 of the plan edit the same job;
whichever merges last rebases. A separate benchmark job (task 5) that compiles
`std-benchmarks` needs the engine package too, from the build or built in the
job. The callers (`engine-checks.yml`, the nightly, the Mac) need no change;
`JVM Tests` simply no longer fails or skips with the build.

### Expected push-to-green (engine PR, minutes)

| Path                                | Phase 2 without 2c | With 2c                                        |
| ----------------------------------- | ------------------ | ---------------------------------------------- |
| Windows build → Windows JVM Tests   | ~78                | — (JVM Tests ~51, from the start of the run)   |
| Windows build → slowest Windows leg | ~54                | ~54                                            |
| Linux build → slowest Linux leg     | ~50                | ~50                                            |
| Linux JVM Tests                     | ~60 (after build)  | ~40 (tasks 4, 5 and #434 take ~13 off its 52)  |
| **Push to green**                   | **~78**            | **~55** (the Windows build and its stdlib leg) |

The ≤ 40 target for 2c in the plan is not reached by 2c alone: the Windows build
(31–35) plus its slowest stdlib shard (15–24) then sets the pace.

## Found on the way: Windows hides an aborted sbt run (#443)

In spike 1 the Windows `JVM tests` step exited **0** although sbt had stopped
mid-suite after dozens of failures (the forked test JVM's
`Fatal: Existing as unable to continue running tests`, no `[error] Total time`
line); the same crash on Linux exited 255. The reporter then published a green
"Engine Tests Report" of 257 tests against develop's 1882. That hazard exists on
develop today, independently of 2c, and is #443.
