# CI speed phase 3: the engine PR's critical path

Phase 3 of the CI speed design
(`docs/superpowers/specs/2026-10-29-ci-speed-design.md`, #417). Phases 1 and 2
have landed: an engine PR's push-to-green went from ~78 to 56.6 min (#440's
run). This spec replaces the design's phase 3 outline ("one shared engine
build").

## Why not the shared engine build

The outline proposed building the engine bundle once per OS for both the engine
tests and IDE packaging. Measured on #440's run (41024999010), IDE packaging
finished at 08:56 and the Engine workflow at 09:10: packaging is not on the
critical path, so sharing the build would not shorten time to green. It would
save ~50 runner-minutes per engine PR (the IDE's Build Backend: 31 min Windows,
19 Linux), but the repository is public, so hosted minutes are free; the only
limit is 20 concurrent jobs, and queueing is negligible (median ~5 s on engine
PRs, re-measure of 2026-10-30). The shared build stays a parked idea, revisited
only if queue times grow.

## Goal

An engine PR's median push-to-green **≤ 40 min** (the design's stretch target),
from ~57, with no change to what is tested. The safety-net rules of the CI speed
design stand: a PR skips only what its changed files cannot affect; develop runs
every job and every test project; every skip is visible.

## Where the time goes

Measured on #440's PR run 41024999010 (08:13:22–09:10:04, 56m42) and develop's
run 41034491721 (56m57). Run-to-run noise on identical code is 25–40 % (Windows
sbt build 26m51 in one run, 19m38 in the other).

**Critical path:** Windows Build Engine Distribution (32m36) → Windows Native
(Table) shard (23m47) = 56m25. **Second path:** Windows JVM Tests ends at 50m42,
only ~6 min earlier, so cutting the Table shard alone gains at most ~6 min.

Windows build step, sbt phases (PR run / develop run):

| Phase                                              | PR    | develop |
| -------------------------------------------------- | ----- | ------- |
| sbt start, meta-build, load                        | 1m24  | 0m54    |
| Scala/Java compile, with cargo and the ydoc bundle | 10m54 | 7m22    |
| ydoc server native image                           | 4m41  | 3m30    |
| `enso` native image (`-Ob -ea`)                    | 10m07 | 7m33    |
| Standard library indexes and IR caches             | 0m43  | 0m35    |
| After-build checks                                 | 0m09  | 0m14    |
| **sbt total**                                      | 26m51 | 19m38   |

The `clean` in `sbt "clean; all ciBuildEngineDistribution"` costs 3 s (a hosted
runner has no `target/`). It was inherited from the retired build CLI, which
also deleted `engine/runtime/target` to avoid a stale builtin-metadata
`ClassNotFoundException` under incremental compilation — a failure that appears
at run time, not compile time.

Native (Table) shard: test time 1287 s on Linux, 1100 s on Windows (JUnit). By
backend on Linux: PostgreSQL 36 %, SQLite File 35 %, SQLite In-Memory 22 %, the
rest ~7 %; on Windows (no PostgreSQL service): SQLite File 54 %, SQLite
In-Memory 36 %. One group, `(Column_Operations_Spec) Rounding numeric tests`,
takes 292–337 s on the native suite (32 cases per backend at 3–4 s each) and 190
s on the JVM suite. A shard job's fixed cost before its first test is ~3m40 on
Linux and ~5m20 on Windows.

The ydoc server native image is built only in the engine checks' Build Engine
Distribution job (`buildEngineDistributionNoIndex` in `build.sbt`). None of the
engine checks' consumers of the distribution uses it: the Standard Library
suites (Native and JVM) run `bin/enso`, and lint, the API check and the
benchmarks do not start the language server. IDE packaging builds its own
backend, ydoc image included, on every engine PR.

## The changes

Four changes, one PR each, in this order. Each records its before and after from
**two runs of each**, because of the noise above, and the queue time of its
runs.

### 3a: split `Table_Tests` by database backend

Estimated: Native (Table) from ~24 min to ~12 min (Linux) and ~15 min (Windows).

- A shard in `tools/ci/stdlib-test-map.yaml` may carry a `filter` (a regex over
  test group names) and an `os` limit. `stdlib-test-plan` passes the filter on,
  and `stdlib-test` gains `--filter <regex>`, which becomes the argument of the
  project's `main` (`Table_Tests` already takes `main filter=Nothing` and
  matches it against group names).
- Linux: three Table shards, `^\[PostgreSQL\]`, `^\[SQLite File\]`, and
  everything else (a negative lookahead over the two). Windows: two,
  `^\[SQLite File\]` and everything else; a PostgreSQL shard there would run
  nothing.
- **Guard:** a filtered run in which no test ran (passed or failed) fails. Today
  a filter matching nothing exits 0 (root `CLAUDE.md`).
- The PR proves once that the shards' test counts sum to the unsplit run's (7588
  on Linux at #440). The "everything else" shard picks up new groups by
  construction.
- Shard job names and test report names stay unique.

### 3b: the slow Rounding tests

Estimated: the group is ~5 min of today's shard; after 3a splits it across the
backend shards, ~1.5–2.5 min off each (90–150 s per backend).

- A time-boxed investigation first: why each of the 32 cases takes 3–4 s
  natively and half that on the JVM.
- A performance bug in the library is fixed in its own PR (with a changelog
  entry if users would notice). A cost in the test itself is restructured
  without dropping cases.
- If neither is clear within the time box, the findings are recorded and the
  work is parked: 3a already limits the group's effect.

### 3c: no ydoc native image in the engine checks

Estimated: Windows build −3.5 to −4.5 min, so every Windows shard starts
earlier.

- A setting skips `ydoc-server/buildNativeImage` in
  `buildEngineDistributionNoIndex`; only the engine checks' Build Engine
  Distribution job sets it. Releases and IDE packaging keep building the image,
  so every engine PR still builds it once per OS, in packaging.
- Before switching, the plan checks every consumer of the engine distribution
  artifact, including the nightly (`engine-checks-nightly.yml`) and Mac
  (`macos-checks.yml`) callers.

### 3d: split JVM Tests (#433)

Estimated: Windows JVM Tests from ~51 to ~30–35 min after the run starts.

- `sbt test` splits into 2–3 jobs per OS (for example runtime-integration-tests
  | language server and project manager | the rest), balanced on per-project
  times from the job logs.
- Each job builds only what its projects need (the engine package only where
  tests read it, as `buildEngineDistributionNoIndex` does today), keeps the
  check that sbt printed one `[success] Total time` per command (#447, #448),
  and publishes its own test report.
- The PR proves the combined test counts still match develop's (1882 passed / 49
  skipped on Windows, 1888 / 43 on Linux, at #448).

## Expected result

| Path (Windows, minutes into the run) | Now | After 3a–3d     |
| ------------------------------------ | --- | --------------- |
| Build Engine Distribution            | 33  | ~29 (3c)        |
| → slowest Standard Library shard     | +24 | +12–15 (3a, 3b) |
| JVM Tests                            | 51  | ~30–35 (3d)     |
| **Push to green**                    | ~57 | **~39–44**      |

Estimates: ≤ 40 needs 3b to land on top of 3a, 3c and 3d, and is confirmed or
not by the re-measure.

## Concurrency

3a and 3d add ~5–7 jobs to an engine PR. Each PR records its runs' largest job
queue time, and the phase's re-measure checks that queueing has not grown. If it
has, the shared engine build (above) comes back as the remedy.

## Measuring the phase

After 3a–3d land: the re-measure already pending from phase 2 (`push to green`
medians over ~10 ordinary PRs, per scenario, with queue times), against ≤ 40 for
engine PRs.

## Out of scope

- Caching compiled output (`target/`) between runs and dropping the `clean`:
  perhaps 3–5 min off the build, but the retired CLI's stale-metadata failure
  shows only at run time.
- Running `Table_Tests` on the JVM suite only for PRs: it breaks the first
  safety-net rule.
- The shared engine build (parked; see above).
- The develop-only "Clean before" cost (1–3 min per Linux job, 2–7 min per
  Windows job on fresh runners): develop is not a gate.
