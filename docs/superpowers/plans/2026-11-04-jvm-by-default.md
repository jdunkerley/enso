# JVM By Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The IDE opens projects on GraalVM's JDK in JVM mode by default, once
the Windows JVM open time is within about 1.5x of native, while the `enso` CLI
stays a native image; then the guest-JVM machinery is retired in its own plan.

**Architecture:** Thirteen PRs and three measurement steps, in the spec's five
stages. Stage 1 removes the JVM's open-time costs: an engine-mode resolver and
per-mode timeouts in the project-manager shim (PR A), a CDS archive in the
bundled JDK (PR B), a `jvm.options` file and `ENSO_JVM_OPTIONS` in the launcher
(PR C), the ydoc server moved out of the engine into a Node process over a new
Language Server channel socket (PRs D, E, F), measured JIT options (PR G,
measurement M1, PR H), and a per-user AOT cache trained in the background (PRs
I, J). Stage 2 changes the open-time harness to measure what users get (PR K)
and runs the measurement (M2). Stage 3 is a stop for the owner's gate decision,
then the one-line switch (PR L). Stage 4 is a check that nothing changed for the
CLI. The engine-hosted ydoc server is deleted one release after PR F (PR M), and
stage 5 starts its own plan.

**Tech Stack:** TypeScript (`app/project-manager-shim`, `app/ydoc-server`,
`app/ydoc-channel`, `app/electron-client` with Electron 41's `utilityProcess`,
`app/gui`'s Vite middleware; vitest), Scala and Java (`engine/language-server`
with akka-http 10.2 and its testkit, `engine/runner`; ScalaTest, JUnit 4), the
sbt meta-build (`project/SmallJDK.scala`, `project/DistributionPackage.scala`),
GitHub Actions YAML (`ide-packaging.yml`, `std-libs-benchmark.yml`) and the
workflow policy (`tools/ci/check-workflows.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-03-jvm-by-default-design.md` (merged
on develop as b05a12d8ba, PR #557), with its "Owner's answers (2026-11-04)". The
evidence it cites is in discussion #518.

## Global Constraints

Copied from the spec; every task's requirements include them.

- **Order is fixed:** levers (stage 1) → re-measure (stage 2) → Windows gate and
  switch (stage 3) → the CLI stays native (stage 4) → retire the guest JVM
  (stage 5). Native-image removal is not part of this plan; it is a separate
  design that starts after the JVM is the default.
- **"JVM" means GraalVM's JDK in JVM mode** (since Truffle 25.1 the optimising
  runtime needs it).
- **The gate:** the median of three per-dispatch ratios of Windows JVM to
  Windows native, for `welcomeShown` (welcome template) and `libraryShown`
  (`image` template). Both ≤ 1.5: pass. Between 1.5 and 1.6: "about 1.5x", the
  owner decides from the report. Either > 1.6: fail. Linux and macOS are
  reported, not gated; a Linux or macOS ratio worse than Windows' is traced
  before the switch.
- **RSS is reported, not gated** (owner's answer 3).
- **No Settings toggle** (owner's answer 1). The engine mode comes from, first
  match wins: the project's `package.yaml` `jvm: true|false`; Electron's
  `--engine-mode=native|jvm` (the old `--jvm` is an alias);
  `ENSO_ENGINE_MODE=native|jvm`; the built-in default, `native` until stage 3,
  then `jvm`.
- **The resolved mode decides three things:** whether the shim passes `--jvm`,
  the timeout column, and whether an AOT cache is used. It applies to `--server`
  and the IDE's `--run`. `--new`, `--version` and the filesystem commands stay
  native. The engine log panel's first line names the mode and its source.
- **Timeouts:**

  | Limit                                   | Native | JVM engine |
  | --------------------------------------- | -----: | ---------: |
  | Start-up: `/_health` passed             |   30 s |      120 s |
  | Terminate: exit after the stdin newline |   10 s |       30 s |
  | ydoc port wait (`DEFAULT_YDOC_WAIT_MS`) |    5 s |       30 s |

  `ENSO_ENGINE_STARTUP_TIMEOUT_MS` and `ENSO_ENGINE_TERMINATE_TIMEOUT_MS` still
  override both columns. The AOT training run has its own: 180 s to start, 5
  minutes to exit. Health polling stays 25 ms for the first second, 250 ms
  after.

- **ydoc host:** `ENSO_YDOC_HOST=engine|node`, default `node`, is the rollback
  switch for one release. The four channel kinds are `json`, `binary`,
  `vis-control`, `vis-data`, at `/channel/{kind}` on the Language Server's RPC
  port. Each engine gets a random token; the LS refuses a channel socket without
  it. `lib/java/ydoc-api` stays as the LS's channel interface.
- **AOT cache:** key = the app version, the engine distribution's real path, the
  bundled runtime's path, and a hash of `jvm.options`; the cache lives at
  `<userData>/jvm-aot/<key>/enso.aot`. Training at app launch, below-normal
  priority, only when JVM is the resolved default and no cache exists for the
  key; killed when an open starts, restarted 60 s after the last open was
  answered; one at a time (a lock file in `<userData>/jvm-aot/`). Use:
  `-XX:AOTCache=<cache> -Xlog:aot=warning,cds=warning:file=<key>/use.log`,
  `AOTMode` stays `auto`; a non-empty `use.log` naming a mismatch deletes the
  cache. No cache under macOS `AppTranslocation/`.
- **JIT options peak guard:** the Table and Vector benchmarks of
  `test/Benchmarks` through `std-libs-benchmark.yml`; no benchmark may regress
  by more than 5% against the JVM defaults.
  `-Dpolyglot.engine.Compilation=false`, `-XX:TieredStopAtLevel=1` and
  `-XX:-UseJVMCICompiler` stay rejected.
- **Measurement:** medians of 5 cold opens per engine per dispatch, three
  dispatches, every ratio taken within one dispatch (runners vary up to 2x
  between dispatches), never across dispatches. Every stage 1 PR that can move
  the JVM's open time gives before and after numbers in its description (section
  "Measurement protocol" below).
- **The GraalVM upgrade (#20/#36) is not in this plan,** but stage 3 must not
  ship before it, and the gate is confirmed on the GraalVM that ships.
- **Changelog:** a PR that changes behaviour users see or feel gets one entry
  under `#### Enso IDE` in `# Next Release`, in the `- [Description][NNN]` form
  with its link definition, and waits for the owner's installer test before
  merging (merge gate for features). Every other PR takes the
  `CI: No changelog needed` label when it is opened. Each PR below says which.
- **Verify on Linux as well as Windows.** WSL, in a clone under `~/` that the
  task deletes when done, sourcing the toolchain first:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && rm -rf ~/jvm-<task> && git clone --branch <branch> https://github.com/jdunkerley/enso.git ~/jvm-<task> && cd ~/jvm-<task> && export CARGO_TARGET_DIR=$HOME/enso-target && corepack pnpm install && <the task'"'"'s command>'
  wsl -e bash -lc 'rm -rf ~/jvm-<task>'
  ```

  Check free disk first (`wsl -e df -h ~`); agent clones filled the disk once.
  In a reused clone, run `corepack pnpm -r compile` before trusting a run.

- **Before any test or harness run,** unset every `ENSO_*` (except
  `ENSO_VERSION`/`ENSO_EDITION` when you set them), `AWS_*`, `SNOWFLAKE*`,
  `GOOGLE*`, `AZURE*` and `*_TOKEN` variable.
- **Checks per language:** Java and Scala pass
  `sbt "scalafmtCheckAll; javafmtCheckAll"` (run `scalafmtAll; javafmtAll`
  first). TypeScript passes the package's `typecheck`, `lint` and unit tests
  (`corepack pnpm --filter <package> run typecheck|lint|test:unit`; for `enso`,
  `corepack pnpm --filter enso exec vitest --run tests/headless`) and
  `corepack pnpm exec prettier --check <changed files>`. Workflow changes pass
  `node tools/ci/check-workflows.mjs`, `node --test tools/ci/*.test.mjs` and
  actionlint. A dependency change deletes `*.tsbuildinfo` and `.eslintcache`
  first (root `CLAUDE.md`).
- **Git rules:** never `git stash`, `git reset --hard`, force-push,
  `--no-verify` or `HUSKY=0`; never amend a pushed commit; never commit
  `.claude/settings*.json`; stage paths explicitly. Each PR is its own branch
  and worktree from `origin/develop`. PR bodies are written with the Write tool
  and passed with `--body-file`, end with the Claude Code line and the session
  URL, and say "Closes #N" for each finished issue. Commit messages end with
  exactly:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

- **Documentation:** each task updates the `CLAUDE.md` of every module it
  changes (the shim's, `electron-client`'s, `ydoc-server`'s,
  `ydoc-server-polyglot`'s, `app/CLAUDE.md`, `engine/language-server`'s,
  `engine/runner`'s, `project/`'s), in the same PR, so they never describe the
  old architecture.

## Rulings made while planning

Where the spec left a choice open or disagreed with the code, the plan rules as
follows. Each ruling is repeated in the task it affects.

1. **`LANGUAGE_SERVER_YDOC_PORT` "left unset" does not disable the embedded
   server today:** `application-ls.conf` defaults `port = 5976`. PR D makes the
   port optional with no default; the embedded server starts only when the
   variable is set. Only the shim sets it, and only for `ENSO_YDOC_HOST=engine`.
2. **`ENSO_JVM_OPTIONS` and paths with spaces.** Split on whitespace, as the
   spec says, would break a `-XX:AOTCache=` under `C:\Users\John Smith\…`, and
   `-Xlog:…:file=` needs its Windows path quoted (`C:` would end the option). PR
   C splits the value on newlines when it contains one, else on whitespace. The
   shim always writes one option per line, with the `-Xlog` file path in double
   quotes.
3. **The Node ydoc server is new code, not a reused path.** The Playwright mocks
   use `WSSharedDoc`/`YjsConnection` only, never `setupGatewayClient` with
   Language Server sessions; PR E tests that path in Node from scratch.
4. **An LS restart under the Node host.** The ydoc server no longer dies with
   the engine. When a listener's JSON channel to its Language Server closes
   without the ydoc side closing it, the listener closes every GUI socket it
   holds and forgets its session, so the GUI reconnects as it does after an
   engine restart today.
5. **The token** is `LANGUAGE_SERVER_CHANNEL_TOKEN` (beside
   `LANGUAGE_SERVER_YDOC_PORT`), a 32-byte random hex string per engine start,
   compared in constant time. An LS without a token refuses every channel
   socket.
6. **`VisualizationBridgeActor`** is in
   `engine/language-server/src/main/scala/org/enso/languageserver/runtime/VisualizationBridgeServer.scala`
   (the spec names the class, not the file).
7. **`jvm.options` lives in the engine package root** (`dist/<version>/`, beside
   `component/`); its source is `distribution/engine/jvm.options`.
8. **The engine log panel's first line** is emitted by the shim as a `stderr`
   line (`Engine mode: jvm (package.yaml)`) before the engine starts, through a
   new `EngineLogChannel.notice`; no new `EngineLogSource`.
9. **PR F (ydoc in Node) is a change users can feel** (every open, native too),
   so it takes a changelog entry and waits for the owner's installer test,
   although the spec's rollout lets stage 1 PRs merge on green.
10. **The peak guard's baseline and candidate run in one job,** one after the
    other on the same runner, since runners vary between dispatches. The
    candidate options reach JMH's forks through `std-benchmarks`' `javaOptions`
    (JMH forks inherit the host JVM's input arguments).
11. **The harness's `jvm-nocache` engine goes** in PR K: `jvm-first` (the shim's
    cache directory emptied) is the same measurement on the production path. The
    harness points the shim at its own cache root with a new `ENSO_JVM_AOT_DIR`,
    so a run never touches the user's real `userData`.
12. **The training's welcome node** is the one the template's `Main.enso`
    metadata marks with `visualization.show: true` (today
    `fcf199e6-d2b1-44b7-be92-a47545d6a593`); the driver reads it from the
    scratch project instead of hard-coding it.
13. **The `--run` training fallback** of stage 1d is not built: PR D (the
    channel socket) lands before PR I in this plan. Build it only if PR D is
    abandoned.
14. **RSS** is sampled from the process tree under Electron's main process: the
    engine is every process whose executable is `enso`/`enso.exe`/`java`/
    `java.exe` and its descendants; the ydoc utility process prints
    `ydoc host pid=<pid>` at start, which the harness reads.
15. **Develop's open-time job measures `jvm` after the switch** (PR L), not
    `native`, since that is what users get; `native` stays available by hand and
    with the `CI: Open perf` label.
16. **Stage 4 has no PR**, only a verification step. **Stage 5 is a separate
    plan** (as the spec says); this plan fixes its entry conditions and records
    the owner's answer 2 as its requirement.

## Merge order and PR chunks

| PR  | Stage     | Content                                                         | Depends on | Changelog              |
| --- | --------- | --------------------------------------------------------------- | ---------- | ---------------------- |
| A   | 1 (mode)  | `resolveEngineMode`, `--engine-mode`, per-mode timeouts, log    | –          | label                  |
| B   | 1b        | CDS archive in the bundled JDK + `-Xshare:on` check             | –          | label                  |
| C   | 1c        | `jvm.options`, `ENSO_JVM_OPTIONS`; harness options move to it   | –          | label                  |
| D   | 1a        | LS `/channel/{kind}` WebSocket adaptor, token, optional ydoc    | –          | label                  |
| E   | 1a        | ydoc-server Node transport (byte buffers, channel client, host) | –          | label                  |
| F   | 1a        | Node ydoc host in Electron and Vite; `ENSO_YDOC_HOST`           | A, D, E    | entry + installer test |
| G   | 1c        | `std-libs-benchmark.yml`: baseline + candidate JVM options      | –          | label                  |
| M1  | 1c        | Measure JIT options (no PR; numbers to #518)                    | C, F, G    | –                      |
| H   | 1c        | The measured JIT options into `jvm.options`                     | M1         | label                  |
| I   | 1d        | Per-user AOT cache: key, training driver, yielding, use         | A, C, D    | label                  |
| J   | 1d        | Linux AppImage path (experiment X1, then symlink or extraction) | I          | label                  |
| K   | 2         | Harness: `jvm` production path, `jvm-first`, RSS, gate script   | I          | label                  |
| M2  | 2         | The measurement; report to #518                                 | B–K, P     | –                      |
| P   | (upgrade) | GraalVM upgrade, own spec and plan (#20/#36)                    | –          | per its plan           |
| ⛔  | 3         | **Stop: the owner's gate decision with M2's numbers**           | M2         | –                      |
| L   | 3         | The switch: default `jvm`; CI covers both modes                 | gate, P    | entry + installer test |
| –   | 4         | Verify the CLI is unchanged (no PR)                             | L          | –                      |
| M   | 1a follow | Delete the engine-hosted ydoc server                            | F released | label                  |
| –   | 5         | Entry check; stage 5's own plan                                 | L released | –                      |

PRs A to E and G have no dependency on one another and can be worked in parallel
worktrees. Start the next ticket while a PR is in CI.

## Measurement protocol

Every measurement in this plan uses the open-time harness
(`app/electron-client/perf/openTime.ts`) through `ide-packaging.yml`, dispatched
by hand on GitHub's runners, Linux and Windows in the same dispatch.

**Dispatch** (from the repository root; `<ref>` is `develop` or the PR branch):

```bash
gh workflow run ide-packaging.yml --repo jdunkerley/enso --ref <ref> \
  -f build_backend=true -f open_perf=true \
  -f open_perf_engines=<engines> -f open_perf_template=<templates> \
  -f open_perf_runs=5 -f open_perf_budget=15 \
  [-f open_perf_jvm_options='<options>']
gh run list --repo jdunkerley/enso --workflow ide-packaging.yml --branch <ref> --limit 1 --json databaseId
```

When it finishes (watch with
`gh run view <id> --repo jdunkerley/enso --json status,conclusion --jq '.status + " " + .conclusion'`,
no `jq` binary, a time cap of 4 hours, stop on completion), download both
platforms:

```bash
gh run download <id> --repo jdunkerley/enso --name open-perf-linux \
  --dir <scratch>/<label>/<id>/linux
gh run download <id> --repo jdunkerley/enso --name open-perf-windows \
  --dir <scratch>/<label>/<id>/windows
```

**What to record,** per platform, per template, per dispatch: the first-open
median of every phase for every engine (from `open-time.md`), the number of
successful launches, and the ratio JVM/native of `welcomeShown` (welcome) or
`libraryShown` (`image`) inside that dispatch. After PR K, the gate script
computes the ratios (Task K3). Before PR K, compute them by hand from
`open-time.json`:
`median(first.welcomeShown of runs with engine jvm) / median(first.welcomeShown of runs with engine native)`.

**Per-PR before and after** (PRs B, C, F, H, I, J): one dispatch of `develop`
and one of the PR branch, both with `open_perf_engines=native,jvm-nocache,jvm`
and `open_perf_template=welcome,image` (after PR K: `native,jvm,jvm-first`).
Native is the in-run control: the PR description gives each phase's medians and
the JVM/native ratio of both dispatches, in this form:

```markdown
| Dispatch (run id) | Platform | Template | Engine | lsReady | firstNode | welcomeShown | libraryShown | JVM/native |
| ----------------- | -------- | -------- | ------ | ------: | --------: | -----------: | -----------: | ---------: |
| develop (123)     | Windows  | welcome  | native |         |           |              |            – |          – |
| develop (123)     | Windows  | welcome  | jvm    |         |           |              |            – |            |
| this branch (124) | Windows  | welcome  | native |         |           |              |            – |          – |
| this branch (124) | Windows  | welcome  | jvm    |         |           |              |            – |            |
```

with the Linux rows and the `image` rows likewise. A PR that cannot move the
JVM's open time (A, D, E, G, K, L, M) says so instead.

**Where the numbers go:** the PR description for per-PR numbers; a comment on
discussion #518 for M1 and M2 (post with
`gh api graphql -f query='mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{url}}}' -f id=<discussion node id> -F body=@<scratch>/report.md`,
the node id from
`gh api graphql -f query='{repository(owner:"jdunkerley",name:"enso"){discussion(number:518){id}}}' --jq .data.repository.discussion.id`).
The raw artifacts stay on the runs.

---

## PR A — Engine mode and per-mode timeouts (stage 1, the resolver; stage 1e)

Branch `jvm/engine-mode`. Label `CI: No changelog needed`: the default stays
native, and the new log line is diagnostic (ask the owner if in doubt). Read
`app/project-manager-shim/CLAUDE.md` and `app/electron-client/CLAUDE.md` first.

### Task A1: `resolveEngineMode` and the `package.yaml` `jvm:` key

**Files:**

- Modify: `app/project-manager-shim/src/localMetadata/packageYaml.ts` (add
  `readPackageJvmMode`)
- Create: `app/project-manager-shim/src/projectService/engineMode.ts`
- Test:
  `app/project-manager-shim/src/projectService/__tests__/engineMode.test.ts`
- Test:
  `app/project-manager-shim/src/localMetadata/__tests__/packageYaml.test.ts`
  (extend)

**Interfaces:**

- Produces:
  - `readPackageJvmMode(projectPath: string): Promise<boolean | undefined>` —
    the `jvm` key of `package.yaml` when it is a boolean, else `undefined`.
  - `type EngineMode = 'native' | 'jvm'`
  - `type EngineModeSource = 'package.yaml' | 'option' | 'environment' | 'default'`
  - `interface ResolvedEngineMode { readonly mode: EngineMode; readonly source: EngineModeSource }`
  - `const DEFAULT_ENGINE_MODE: EngineMode` — `'native'` until PR L.
  - `parseEngineMode(raw: string | undefined): EngineMode | undefined`
  - `resolveDefaultEngineMode(settings: EngineModeSettings): ResolvedEngineMode`
    — the mode ignoring `package.yaml` (the AOT cache's "resolved default").
  - `resolveEngineMode(projectPath: string, settings: EngineModeSettings): Promise<ResolvedEngineMode>`
  - `interface EngineModeSettings { readonly option?: EngineMode | undefined; readonly environment?: string | undefined; readonly defaultMode?: EngineMode }`
  - `describeEngineMode(resolved: ResolvedEngineMode): string` — the log line.

- [ ] **Step 1: Write the failing tests**

`packageYaml.test.ts` (append; it already has temp-directory helpers in
`testUtils.ts`, use them as the existing tests do):

```ts
describe("readPackageJvmMode", () => {
  test.each([
    ["jvm: true\n", true],
    ["jvm: false\n", false],
    ["name: P\n", undefined],
    ['jvm: "yes"\n', undefined],
    ["jvm: [\n", undefined],
  ])("%j gives %s", async (yamlText, expected) => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "package.yaml"), "name: P\n" + yamlText);
    expect(await readPackageJvmMode(dir)).toBe(expected);
  });
  test("a missing package.yaml gives undefined", async () => {
    expect(await readPackageJvmMode(await makeTempDir())).toBeUndefined();
  });
});
```

(If `testUtils.ts` names its helper differently, use its name; do not add a
second helper.)

`engineMode.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  describeEngineMode,
  parseEngineMode,
  resolveDefaultEngineMode,
  resolveEngineMode,
} from "../engineMode.js";

let project: string;
beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), "engine-mode-"));
});
afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true });
});
const writeYaml = (text: string) =>
  fs.writeFile(path.join(project, "package.yaml"), text);

describe("resolveEngineMode", () => {
  test("package.yaml jvm: true wins over everything", async () => {
    await writeYaml("name: P\njvm: true\n");
    expect(
      await resolveEngineMode(project, {
        option: "native",
        environment: "native",
        defaultMode: "native",
      }),
    ).toEqual({ mode: "jvm", source: "package.yaml" });
  });
  test("package.yaml jvm: false wins over everything", async () => {
    await writeYaml("name: P\njvm: false\n");
    expect(
      await resolveEngineMode(project, {
        option: "jvm",
        environment: "jvm",
        defaultMode: "jvm",
      }),
    ).toEqual({ mode: "native", source: "package.yaml" });
  });
  test("then the option", async () => {
    await writeYaml("name: P\n");
    expect(
      await resolveEngineMode(project, {
        option: "jvm",
        environment: "native",
      }),
    ).toEqual({
      mode: "jvm",
      source: "option",
    });
  });
  test("then the environment", async () => {
    expect(await resolveEngineMode(project, { environment: "jvm" })).toEqual({
      mode: "jvm",
      source: "environment",
    });
  });
  test("an unknown environment value is ignored", async () => {
    expect(
      await resolveEngineMode(project, {
        environment: "graal",
        defaultMode: "native",
      }),
    ).toEqual({
      mode: "native",
      source: "default",
    });
  });
  test("then the default", async () => {
    expect(await resolveEngineMode(project, { defaultMode: "jvm" })).toEqual({
      mode: "jvm",
      source: "default",
    });
    expect((await resolveEngineMode(project, {})).source).toBe("default");
  });
});

test("resolveDefaultEngineMode ignores the project", () => {
  expect(resolveDefaultEngineMode({ environment: "JVM" })).toEqual({
    mode: "jvm",
    source: "environment",
  });
});

test("parseEngineMode", () => {
  expect(parseEngineMode(" Native ")).toBe("native");
  expect(parseEngineMode("jvm")).toBe("jvm");
  expect(parseEngineMode("")).toBeUndefined();
  expect(parseEngineMode(undefined)).toBeUndefined();
  expect(parseEngineMode("espresso")).toBeUndefined();
});

test("describeEngineMode", () => {
  expect(describeEngineMode({ mode: "jvm", source: "package.yaml" })).toBe(
    "Engine mode: jvm (package.yaml)",
  );
  expect(describeEngineMode({ mode: "native", source: "environment" })).toBe(
    "Engine mode: native (ENSO_ENGINE_MODE)",
  );
  expect(describeEngineMode({ mode: "native", source: "option" })).toBe(
    "Engine mode: native (--engine-mode)",
  );
  expect(describeEngineMode({ mode: "native", source: "default" })).toBe(
    "Engine mode: native (default)",
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/engineMode.test.ts src/localMetadata/__tests__/packageYaml.test.ts`
Expected: FAIL, `engineMode.js` not found and `readPackageJvmMode` not exported.

- [ ] **Step 3: Implement**

In `packageYaml.ts`, beside `readPackageLabels`:

```ts
/**
 * The `jvm` key of the `package.yaml` in `projectPath`: `true` or `false` when it is a boolean,
 * `undefined` when the file, the key or a boolean value is missing (or the YAML is malformed).
 * The engine's own launcher reads the same key (`Main.isJvmModeEnabled`).
 */
export async function readPackageJvmMode(
  projectPath: string,
): Promise<boolean | undefined> {
  let text: string;
  try {
    text = await fs.readFile(
      path.join(projectPath, PACKAGE_METADATA_RELATIVE_PATH),
      "utf8",
    );
  } catch {
    return undefined;
  }
  try {
    const value: unknown = yaml.parse(text);
    if (value == null || typeof value !== "object" || !("jvm" in value))
      return undefined;
    const jvm = (value as { jvm: unknown }).jvm;
    return typeof jvm === "boolean" ? jvm : undefined;
  } catch {
    return undefined;
  }
}
```

`engineMode.ts`:

```ts
/** @file Which engine an opened or run project gets: the native image or GraalVM's JDK (spec "How the engine mode is chosen"). */
import { readPackageJvmMode } from "../localMetadata/packageYaml.js";

export type EngineMode = "native" | "jvm";
export type EngineModeSource =
  "package.yaml" | "option" | "environment" | "default";

export interface ResolvedEngineMode {
  readonly mode: EngineMode;
  readonly source: EngineModeSource;
}

export interface EngineModeSettings {
  /** Electron's `--engine-mode` (or `--jvm`). */
  readonly option?: EngineMode | undefined;
  /** The raw value of `ENSO_ENGINE_MODE`. */
  readonly environment?: string | undefined;
  /** The built-in default; {@link DEFAULT_ENGINE_MODE} when omitted. */
  readonly defaultMode?: EngineMode;
}

/** The built-in default. It becomes `jvm` in the switch (stage 3). */
export const DEFAULT_ENGINE_MODE: EngineMode = "native";

/** `native` or `jvm`, case and surrounding space ignored; anything else is `undefined`. */
export function parseEngineMode(
  raw: string | undefined,
): EngineMode | undefined {
  const value = raw?.trim().toLowerCase();
  return value === "native" || value === "jvm" ? value : undefined;
}

/** The mode without the project's own `jvm:` key: the AOT cache trains for this one. */
export function resolveDefaultEngineMode(
  settings: EngineModeSettings,
): ResolvedEngineMode {
  if (settings.option) return { mode: settings.option, source: "option" };
  const fromEnvironment = parseEngineMode(settings.environment);
  if (fromEnvironment) return { mode: fromEnvironment, source: "environment" };
  return {
    mode: settings.defaultMode ?? DEFAULT_ENGINE_MODE,
    source: "default",
  };
}

/** The mode for `projectPath`; the first match wins: package.yaml, option, environment, default. */
export async function resolveEngineMode(
  projectPath: string,
  settings: EngineModeSettings,
): Promise<ResolvedEngineMode> {
  const jvm = await readPackageJvmMode(projectPath);
  if (jvm != null)
    return { mode: jvm ? "jvm" : "native", source: "package.yaml" };
  return resolveDefaultEngineMode(settings);
}

const SOURCE_NAMES: Readonly<Record<EngineModeSource, string>> = {
  "package.yaml": "package.yaml",
  option: "--engine-mode",
  environment: "ENSO_ENGINE_MODE",
  default: "default",
};

/** The engine log panel's first line. */
export function describeEngineMode(resolved: ResolvedEngineMode): string {
  return `Engine mode: ${resolved.mode} (${SOURCE_NAMES[resolved.source]})`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/project-manager-shim/src/projectService/engineMode.ts app/project-manager-shim/src/projectService/__tests__/engineMode.test.ts app/project-manager-shim/src/localMetadata/packageYaml.ts app/project-manager-shim/src/localMetadata/__tests__/packageYaml.test.ts
git commit -m "Shim: resolve the engine mode from package.yaml, option, environment and default" -m "<trailers>"
```

(`<trailers>` stands for the two lines in Global Constraints, in every commit of
this plan.)

### Task A2: Timeout columns per mode

**Files:**

- Modify: `app/project-manager-shim/src/projectService/timeouts.ts`
- Modify: `app/project-manager-shim/src/projectService/ensoRunner.ts:49-58`
  (`DEFAULT_YDOC_WAIT_MS`), `:185-196` (`LANGUAGE_SERVER_STARTUP_TIMEOUT_MS`,
  `terminateTimeoutMs`)
- Test: `app/project-manager-shim/src/projectService/__tests__/timeouts.test.ts`
  (extend)

**Interfaces:**

- Consumes: `EngineMode` (A1).
- Produces:
  - `interface EngineTimeouts { readonly startupMs: number; readonly terminateMs: number; readonly ydocWaitMs: number }`
  - `const ENGINE_TIMEOUTS: Readonly<Record<EngineMode, EngineTimeouts>>` —
    native `{30_000, 10_000, 5_000}`, jvm `{120_000, 30_000, 30_000}`.
  - `engineTimeouts(mode: EngineMode, env?: NodeJS.ProcessEnv): EngineTimeouts`
    — the column, with `ENSO_ENGINE_STARTUP_TIMEOUT_MS` and
    `ENSO_ENGINE_TERMINATE_TIMEOUT_MS` overriding both columns.

- [ ] **Step 1: Write the failing test** (append to `timeouts.test.ts`):

```ts
import { ENGINE_TIMEOUTS, engineTimeouts } from "../timeouts.js";

describe("engineTimeouts", () => {
  test("native and JVM columns", () => {
    expect(engineTimeouts("native", {})).toEqual({
      startupMs: 30_000,
      terminateMs: 10_000,
      ydocWaitMs: 5_000,
    });
    expect(engineTimeouts("jvm", {})).toEqual({
      startupMs: 120_000,
      terminateMs: 30_000,
      ydocWaitMs: 30_000,
    });
    expect(ENGINE_TIMEOUTS.jvm.startupMs).toBe(120_000);
  });
  test("the environment overrides both columns", () => {
    const env = {
      ENSO_ENGINE_STARTUP_TIMEOUT_MS: "180000",
      ENSO_ENGINE_TERMINATE_TIMEOUT_MS: "60000",
    };
    for (const mode of ["native", "jvm"] as const) {
      expect(engineTimeouts(mode, env)).toMatchObject({
        startupMs: 180_000,
        terminateMs: 60_000,
      });
    }
  });
  test("a bad override falls back to the column", () => {
    expect(
      engineTimeouts("jvm", { ENSO_ENGINE_STARTUP_TIMEOUT_MS: "soon" })
        .startupMs,
    ).toBe(120_000);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/timeouts.test.ts`
Expected: FAIL, `engineTimeouts` is not exported.

- [ ] **Step 3: Implement** (append to `timeouts.ts`):

```ts
import type { EngineMode } from "./engineMode.js";

/** How long an engine has to start, to exit when asked, and for its ydoc port to accept. */
export interface EngineTimeouts {
  readonly startupMs: number;
  readonly terminateMs: number;
  readonly ydocWaitMs: number;
}

/**
 * The spec's stage 1e table. A JVM engine passes `/_health` at ~10 s uncached on the CI Windows
 * runner (a slow laptop is 3x that), its shutdown runs Akka's and the JIT's teardown, and until the
 * ydoc server leaves the engine its ydoc port came 5.3 s after `lsReady` on Windows.
 */
export const ENGINE_TIMEOUTS: Readonly<Record<EngineMode, EngineTimeouts>> = {
  native: { startupMs: 30_000, terminateMs: 10_000, ydocWaitMs: 5_000 },
  jvm: { startupMs: 120_000, terminateMs: 30_000, ydocWaitMs: 30_000 },
};

/** The column for `mode`; the two environment variables override both columns. */
export function engineTimeouts(
  mode: EngineMode,
  env: NodeJS.ProcessEnv = process.env,
): EngineTimeouts {
  const column = ENGINE_TIMEOUTS[mode];
  return {
    startupMs: timeoutFromEnv(
      env.ENSO_ENGINE_STARTUP_TIMEOUT_MS,
      column.startupMs,
    ),
    terminateMs: timeoutFromEnv(
      env.ENSO_ENGINE_TERMINATE_TIMEOUT_MS,
      column.terminateMs,
    ),
    ydocWaitMs: column.ydocWaitMs,
  };
}
```

In `ensoRunner.ts`, keep `DEFAULT_YDOC_WAIT_MS` and
`LANGUAGE_SERVER_STARTUP_TIMEOUT_MS` as aliases of
`ENGINE_TIMEOUTS.native.ydocWaitMs` / `.startupMs` (other modules import them),
and keep `terminateTimeoutMs()` for the no-launch path (tests), now defined as
`engineTimeouts('native').terminateMs`.

- [ ] **Step 4: Run the test to see it pass** — same command. Expected: PASS.

- [ ] **Step 5: Commit** `timeouts.ts`, `ensoRunner.ts`, `timeouts.test.ts`:
      "Shim: the engine's timeouts per mode".

### Task A3: The runner takes the mode with each open and each run

**Files:**

- Modify: `app/project-manager-shim/src/projectService/ensoRunner.ts` (`Runner`
  at `:80-109`, `OpenedProject` constructor/`create` at `:224-263`, the timers
  at `:392`, `:439`, `:463`, `:472`, `runProject` at `:573-600`, `openProject`
  at `:617-700`)
- Modify: `app/project-manager-shim/src/projectService/__tests__/testPorts.ts`
  (narrow the bands; add `ENGINE_MODE_PORT`, `JVM_AOT_TRAINER_PORT`,
  `YDOC_HOST_PORT`)
- Test:
  `app/project-manager-shim/src/projectService/__tests__/engineLaunch.test.ts`

**Interfaces:**

- Consumes: `ResolvedEngineMode` (A1), `EngineTimeouts` (A2).
- Produces:
  - `interface EngineLaunch { readonly mode: ResolvedEngineMode; readonly timeouts: EngineTimeouts; readonly jvmOptions?: readonly string[] }`
    (exported from `ensoRunner.ts`; `jvmOptions` is filled by PR I).
  - `Runner.openProject(projectPath, projectId, extraArgs?, extraEnv?, logSink?, launch?: EngineLaunch)`
  - `Runner.runProject(projectPath, extraEnv?, launch?: EngineLaunch)`
  - With `launch.mode.mode === 'jvm'` the runner puts `--jvm` first in the
    engine arguments; with `launch.jvmOptions` non-empty it sets
    `ENSO_JVM_OPTIONS` to the inherited value (if any) plus the options, joined
    with `\n` (ruling 2). Without `launch` the behaviour is today's.
  - `export const ENGINE_MODE_PORT`, `JVM_AOT_TRAINER_PORT`, `YDOC_HOST_PORT`
    from `testPorts.ts`.

- [ ] **Step 1: Narrow the port bands.** In `testPorts.ts`, set
      `BAND_SIZE = 2_000`, change the comment on `FIRST_BAND_START` to "ten
      bands end at 29,000", and append:

```ts
/** `engineLaunch.test.ts`. */
export const ENGINE_MODE_PORT = randomPortInBand(7);
/** `jvmAot/__tests__/trainer.test.ts`. */
export const JVM_AOT_TRAINER_PORT = randomPortInBand(8);
/** `ydocHost.test.ts`. */
export const YDOC_HOST_PORT = randomPortInBand(9);
```

- [ ] **Step 2: Write the failing test.** `engineLaunch.test.ts` uses a fake
      `enso` like `stdinClosed.test.ts` (copy its `fakeEnso` helper into this
      file: a `.bat` on Windows, a shell script elsewhere) whose script writes
      its arguments and `ENSO_JVM_OPTIONS` to `<project>.args.json`, answers
      `/_health` after `DELAY_MS` (from the environment), and exits on a stdin
      newline after `EXIT_DELAY_MS`:

```ts
const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const target = (args.includes('--run') ? value('--run') : value('--path')) + '.args.json'
fs.writeFileSync(target, JSON.stringify({ args, jvmOptions: process.env.ENSO_JVM_OPTIONS ?? null }))
if (args.includes('--run')) process.exit(0)
setTimeout(() => {
  http.createServer((_q, r) => r.end('OK')).listen(Number(value('--rpc-port')), '127.0.0.1')
}, Number(process.env.DELAY_MS ?? '0'))
process.stdin.on('data', () => setTimeout(() => process.exit(0), Number(process.env.EXIT_DELAY_MS ?? '0')))
`;

const jvm = (timeouts: Partial<EngineTimeouts> = {}): EngineLaunch => ({
  mode: { mode: "jvm", source: "environment" },
  timeouts: { ...ENGINE_TIMEOUTS.jvm, ydocWaitMs: 0, ...timeouts },
});

test("a JVM launch passes --jvm first, and native passes nothing", async () => {
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: ENGINE_MODE_PORT,
  });
  const a = path.join(root, "A");
  await runner.openProject(
    Path(a),
    "id-a",
    ["--log-level", "info"],
    undefined,
    undefined,
    jvm(),
  );
  expect(
    JSON.parse(await fs.readFile(a + ".args.json", "utf8")).args.slice(0, 2),
  ).toEqual(["--jvm", "--server"]);
  await runner.closeProject(Path(a));
  const b = path.join(root, "B");
  await runner.openProject(Path(b), "id-b", undefined, undefined, undefined, {
    mode: { mode: "native", source: "default" },
    timeouts: { ...ENGINE_TIMEOUTS.native, ydocWaitMs: 0 },
  });
  expect(
    JSON.parse(await fs.readFile(b + ".args.json", "utf8")).args,
  ).not.toContain("--jvm");
  await runner.closeProject(Path(b));
});

test("--run takes the mode too", async () => {
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: ENGINE_MODE_PORT,
  });
  const p = path.join(root, "R");
  expect(await runner.runProject(Path(p), undefined, jvm())).toBe(0);
  expect(
    JSON.parse(await fs.readFile(p + ".args.json", "utf8")).args.slice(0, 2),
  ).toEqual(["--jvm", "--run"]);
});

test("the JVM options reach ENSO_JVM_OPTIONS one per line, after an inherited value", async () => {
  vi.stubEnv("ENSO_JVM_OPTIONS", "-Dinherited=1");
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: ENGINE_MODE_PORT,
  });
  const p = path.join(root, "O");
  await runner.openProject(Path(p), "id-o", undefined, undefined, undefined, {
    ...jvm(),
    jvmOptions: ["-XX:AOTCache=C:\\Users\\John Smith\\enso.aot", "-Dx=y"],
  });
  expect(
    JSON.parse(await fs.readFile(p + ".args.json", "utf8")).jvmOptions,
  ).toBe("-Dinherited=1\n-XX:AOTCache=C:\\Users\\John Smith\\enso.aot\n-Dx=y");
  await runner.closeProject(Path(p));
});

test("a launch's startup timeout replaces the runner's", async () => {
  // The runner's own 1 s would kill an engine that passes its health check after 2 s.
  vi.stubEnv("DELAY_MS", "2000");
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: ENGINE_MODE_PORT,
    startupTimeoutMs: 1000,
  });
  const p = path.join(root, "S");
  await expect(
    runner.openProject(
      Path(p),
      "id-s",
      undefined,
      undefined,
      undefined,
      jvm({ startupMs: 10_000 }),
    ),
  ).resolves.toBeDefined();
  await runner.closeProject(Path(p));
});

test("a launch's terminate timeout replaces the 10 s default", async () => {
  vi.stubEnv("EXIT_DELAY_MS", "1500");
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: ENGINE_MODE_PORT,
  });
  const p = path.join(root, "T");
  await runner.openProject(
    Path(p),
    "id-t",
    undefined,
    undefined,
    undefined,
    jvm({ terminateMs: 500 }),
  );
  const started = Date.now();
  await runner.closeProject(Path(p));
  // Killed after 500 ms rather than waited for (1.5 s).
  expect(Date.now() - started).toBeLessThan(1400);
});
```

(`vi.stubEnv` values reach the fake through `process.env`, which the runner
spreads into the child's environment.)

- [ ] **Step 3: Run it to see it fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/engineLaunch.test.ts`
Expected: FAIL (no `EngineLaunch` export; `--jvm` missing).

- [ ] **Step 4: Implement.**
  - Export `EngineLaunch` from `ensoRunner.ts` and add the optional `launch`
    parameter to both `Runner` methods and to `EnsoRunner`'s.
  - Add a private helper:

```ts
/** `--jvm` for a JVM launch, nothing otherwise. */
function modeArgs(launch: EngineLaunch | undefined): readonly string[] {
  return launch?.mode.mode === "jvm" ? ["--jvm"] : [];
}

/** `ENSO_JVM_OPTIONS` with `launch`'s options appended one per line (ruling 2 of the plan). */
function jvmOptionsEnv(
  launch: EngineLaunch | undefined,
): Record<string, string> {
  const options = launch?.jvmOptions ?? [];
  if (options.length === 0) return {};
  const inherited = process.env.ENSO_JVM_OPTIONS?.trim();
  return {
    ENSO_JVM_OPTIONS: [...(inherited ? [inherited] : []), ...options].join(
      "\n",
    ),
  };
}
```

- `runProject`: `const args = [...modeArgs(launch), '--run', projectPath]` and
  the env gains `...jvmOptionsEnv(launch)` before `extraEnv`.
- `openProject`: `args` becomes `[...modeArgs(launch), '--server', …]`, env
  gains `...jvmOptionsEnv(launch)`, and `OpenedProject.create` receives
  `launch?.timeouts.startupMs ?? this.options.startupTimeoutMs ?? LANGUAGE_SERVER_STARTUP_TIMEOUT_MS`,
  `launch?.timeouts.ydocWaitMs ?? this.options.ydocWaitMs ?? 0` and a new last
  argument `launch?.timeouts.terminateMs ?? terminateTimeoutMs()`.
- `OpenedProject` stores `terminateMs` and uses it at the three places that call
  `terminateTimeoutMs()` today (`:439`, `:463`, `:472`).

- [ ] **Step 5: Run the whole shim suite**

Run: `corepack pnpm --filter project-manager-shim run test:unit` Expected: PASS
(the existing fake-engine tests still pass with the narrower bands).

- [ ] **Step 6: Commit** `ensoRunner.ts`, `testPorts.ts`,
      `engineLaunch.test.ts`: "Shim: each open and run takes its engine mode and
      timeouts".

### Task A4: ProjectService resolves the mode; the log names it

**Files:**

- Modify: `app/project-manager-shim/src/projectService/index.ts:110-140`
  (`ProjectService.default`), `:235-245` (`runProject`), `:251-300`
  (`openProject`)
- Modify: `app/project-manager-shim/src/engineLogs/channel.ts` (add `notice`)
- Test:
  `app/project-manager-shim/src/projectService/__tests__/engineLogging.test.ts`
  (extend: its `fakeRunner` records the `launch` argument)
- Test: `app/project-manager-shim/src/engineLogs/__tests__/channel.test.ts`
  (extend; use the existing test file for `EngineLogChannel` in that folder)

**Interfaces:**

- Consumes: A1, A2, A3.
- Produces:
  - `interface EngineSettings { readonly option?: EngineMode; readonly environment?: string }`
    (`index.ts`); `ProjectService`'s constructor and `ProjectService.default`
    take it as a new last parameter `engine?: EngineSettings` (PRs F and I add
    fields to it).
  - `ProjectService.default` no longer reads its start-up timeout itself; the
    runner gets it per launch.
  - `EngineLogChannel.notice(text: string): void` — one `stderr` line with
    `sessionId: null`, emitted at once.

- [ ] **Step 1: Write the failing tests.** In `engineLogging.test.ts`, change
      `fakeRunner` to push its sixth argument into `launches` and add:

```ts
test("the open resolves the mode: package.yaml first", async () => {
  await fs.writeFile(
    path.join(projectDir, "package.yaml"),
    "name: P\njvm: true\n",
  );
  const service = new ProjectService(
    fakeRunner(),
    [],
    console,
    undefined,
    undefined,
    undefined,
    {
      option: "native",
    },
  );
  await service.openProject(UUID("id-1"), Path(root));
  expect(launches.at(-1)).toMatchObject({
    mode: { mode: "jvm", source: "package.yaml" },
    timeouts: { startupMs: 120_000, terminateMs: 30_000, ydocWaitMs: 30_000 },
  });
});

test("the open takes the option when package.yaml says nothing", async () => {
  const service = new ProjectService(
    fakeRunner(),
    [],
    console,
    undefined,
    undefined,
    undefined,
    {
      option: "jvm",
    },
  );
  await service.openProject(UUID("id-1"), Path(root));
  expect(launches.at(-1)?.mode).toEqual({ mode: "jvm", source: "option" });
});

test("the engine log starts with the mode", async () => {
  const service = new ProjectService(
    fakeRunner(),
    [],
    console,
    undefined,
    undefined,
    undefined,
    {
      environment: "jvm",
    },
  );
  await service.openProject(UUID("id-1"), Path(root));
  const channel = service.engineLogs.get(projectDir);
  expect(channel?.bufferedLines()[0]).toBe(
    "Engine mode: jvm (ENSO_ENGINE_MODE)",
  );
});
```

(`projectDir` is the project the file's existing setup creates for `id-1`; use
the existing variable. If the hub has no `get`/`bufferedLines`, read the replay
buffer through the subscription API the existing channel tests use, and assert
the first `line` event's `text`.)

In the channel test file:

```ts
test("notice emits one stderr line before any session", () => {
  const channel = newChannel(); // the helper the file already uses
  const events = collect(channel); // likewise
  channel.notice("Engine mode: native (default)");
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "line",
      source: "stderr",
      sessionId: null,
      text: "Engine mode: native (default)",
    }),
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/engineLogging.test.ts src/engineLogs`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `channel.ts`:
    `notice(text: string): void { if (this.state !== 'open') return; this.emitLines('stderr', [text], null) }`.
  - `index.ts`: store `engine` on the service; in `openProject`, after
    `this.engineLogs.open(...)`:

```ts
const mode = await resolveEngineMode(project.path, this.engineModeSettings());
engineLog.notice(describeEngineMode(mode));
const launch: EngineLaunch = { mode, timeouts: engineTimeouts(mode.mode) };
```

    and pass `launch` as `runner.openProject`'s sixth argument; `runProject`
    resolves the same way and passes it to `runner.runProject`.
    `engineModeSettings()` returns
    `{ option: this.engine?.option, environment: this.engine?.environment ?? process.env.ENSO_ENGINE_MODE }`.

- `ProjectService.default`: drop the `startupTimeoutMs` computation (now per
  launch); keep `ydocWaitMs: DEFAULT_YDOC_WAIT_MS` for launches without a mode;
  take `engine?: EngineSettings` last and pass it to the constructor.

- [ ] **Step 4: Run the shim suite** —
      `corepack pnpm --filter project-manager-shim run test:unit`. Expected:
      PASS.

- [ ] **Step 5: Commit**: "Shim: the open and the run resolve the engine mode;
      the engine log names it".

### Task A5: Electron's `--engine-mode`, `--jvm` as its alias

**Files:**

- Modify: `app/common/src/options.ts:14` (add `engineMode`)
- Modify: `app/electron-client/src/configParser.ts:29` (add the flag)
- Modify: `app/electron-client/src/index.ts:332-342` (`createProjectService`)
- Modify: `app/electron-client/src/projectService.ts:87-121` (pass
  `EngineSettings`)
- Test: `app/electron-client/tests/headless/configParser.test.ts` (extend)

**Interfaces:**

- Consumes: `EngineSettings` (A4), `EngineMode`.
- Produces: `Options.engineMode: 'native' | 'jvm' | undefined`;
  `engineModeOption(args: Options): EngineMode | undefined` (exported from
  `configParser.ts`) = `args.engineMode ?? (args.useJvm ? 'jvm' : undefined)`;
  `setupProjectService(args, electron, electronIsDev, engine?: EngineSettings)`.

- [ ] **Step 1: Write the failing test** (append to `configParser.test.ts`):

```ts
import { engineModeOption } from "@/configParser";

test("--engine-mode, and --jvm as its alias", () => {
  expect(engineModeOption(parseArgs(["--engine-mode", "jvm"]))).toBe("jvm");
  expect(engineModeOption(parseArgs(["--engine-mode=native"]))).toBe("native");
  expect(engineModeOption(parseArgs(["--jvm"]))).toBe("jvm");
  expect(
    engineModeOption(parseArgs(["--jvm", "--engine-mode", "native"])),
  ).toBe("native");
  expect(engineModeOption(parseArgs([]))).toBeUndefined();
  expect(() => parseArgs(["--engine-mode", "graal"])).toThrow();
});
```

- [ ] **Step 2: Run it to see it fail** —
      `corepack pnpm --filter enso exec vitest --run tests/headless/configParser.test.ts`.
      Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `options.ts`: `engineMode: z.enum(['native', 'jvm']).optional(),` after
    `useJvm`.
  - `configParser.ts`: in `OPTIONS_META`,
    `engineMode: { flag: '--engine-mode <mode>', description: 'Engine mode: native or jvm (overrides ENSO_ENGINE_MODE; a project\'s package.yaml jvm: key wins)' },`
    and change `useJvm`'s description to `'Same as --engine-mode jvm'`; export
    `engineModeOption`. (If commander rejects an invalid value only through the
    zod parse, the `toThrow` still holds; if neither rejects it, add an
    `InvalidArgumentError` parser for this flag as the file does for others.)
  - `index.ts`: delete `backendJvmOpts`; call
    `setupProjectService(backendOpts, this.electron, this.electronIsDev, { option: engineModeOption(args) })`.
  - `projectService.ts`: thread `engine` to `ProjectService.default` in both
    `getProjectService` and `setupProjectService`.

- [ ] **Step 4: Run the electron headless tests and typecheck** —
      `corepack pnpm --filter enso exec vitest --run tests/headless` and
      `corepack pnpm --filter enso run typecheck`. Expected: PASS.

- [ ] **Step 5: Update docs.** `app/project-manager-shim/CLAUDE.md`, "Ports and
      the engine's health check": replace "within 30 s is killed;
      `ENSO_ENGINE_STARTUP_TIMEOUT_MS` lengthens that …" with the per-mode table
      and the override rule, and add a short "Engine mode" section (precedence,
      `jvm: false` now meaningful, the log line).
      `app/electron-client/CLAUDE.md`: under "Env vars of note", add
      `ENSO_ENGINE_MODE`.

- [ ] **Step 6: Verify on Linux** (Global Constraints' WSL recipe) with
      `corepack pnpm --filter project-manager-shim run test:unit && corepack pnpm --filter enso exec vitest --run tests/headless`.

- [ ] **Step 7: Commit, push, open PR A** ("Shim: engine mode resolution and
      per-mode timeouts"), label `CI: No changelog needed`. Body: what the mode
      decides, the precedence, "native stays the default", and "cannot move the
      JVM's open time by itself" (Measurement protocol).

---

## PR B — CDS in the bundled JDK (stage 1b)

Branch `jvm/cds-archive`. Label `CI: No changelog needed`. Read
`project/CLAUDE.md` first: the meta-build has no unit tests; loading the build
is the check, plus the run-time check below.

### Task B1: `--generate-cds-archive` and the `-Xshare:on` check

**Files:**

- Modify: `project/SmallJDK.scala:89-117` (`buildSmallJDKForRelease`)
- Modify: `build.sbt:292-318` (`buildEngineBundle`: run the check)
- Modify: `project/CLAUDE.md` (`SmallJDK.scala` line)

**Interfaces:**

- Produces: `SmallJDK.checkSharing(jdkDirectory: File, log: Logger): Unit` —
  runs `<jdk>/bin/java -Xshare:on -version`, throws on a non-zero exit.

- [ ] **Step 1: Show the check fails today.** Build the small JDK and run the
      check by hand:

```bash
sbt "buildSmallJdkForRelease target/cds-before"
target/cds-before/bin/java -Xshare:on -version; echo "exit $?"
```

Expected: a non-zero exit and "Unable to use shared archive" (there is no
`lib/server/classes.jsa`). Record the output for the PR body.

- [ ] **Step 2: Implement.** In `buildSmallJDKForRelease`, add
      `"--generate-cds-archive",` to `jlinkArgs` after `"--no-man-pages",` (the
      archive covers only the jlinked modules; `copyLibDirs` adds
      `lib/{graalvm,svm,truffle}` afterwards, which the AOT cache covers, so the
      order stays). Add:

```scala
  /** Fails the build when `jdkDirectory`'s `java` cannot map its CDS archive (spec stage 1b). */
  def checkSharing(jdkDirectory: File, log: Logger): Unit = {
    val java = jdkDirectory / "bin" / (if (Platform.isWindows) "java.exe" else "java")
    val output = new StringBuilder
    val exit = scala.sys.process
      .Process(Seq(java.getAbsolutePath, "-Xshare:on", "-version"))
      .!(scala.sys.process.ProcessLogger(l => output.append(l).append('\n')))
    if (exit != 0) {
      throw new RuntimeException(
        s"$java -Xshare:on -version exited $exit: the bundled JDK has no usable CDS archive.\n$output"
      )
    }
    log.info(s"CDS archive in $jdkDirectory maps (-Xshare:on).")
  }
```

In `build.sbt`'s `buildEngineBundle`, after
`SmallJDK.buildSmallJDKForRelease(smallJdk)`, add
`SmallJDK.checkSharing(smallJdk, log)`.

- [ ] **Step 3: Run the check again**

```bash
sbt "buildSmallJdkForRelease target/cds-after"
target/cds-after/bin/java -Xshare:on -version; echo "exit $?"
ls -la target/cds-after/lib/server/classes*.jsa
```

Expected: exit 0; `classes.jsa` and `classes_nocoops.jsa`, about 15 MB each.
Record the sizes. Repeat Steps 1 and 3 on Linux (WSL recipe). On Windows the
path is `target\cds-after\bin\java.exe`.

- [ ] **Step 4: Format and load-check** —
      `sbt "scalafmtCheckAll; scalafmtSbtCheck"`. Expected: PASS.

- [ ] **Step 5: Commit, push, open PR B** ("Bundled JDK: generate its CDS
      archive"). CI's `ide-packaging.yml` runs `buildEngineBundle`, so the check
      runs on both platforms there. Measure (protocol, per-PR before and after,
      `native,jvm-nocache,jvm`): the gain is expected on `jvm-nocache` (0.3 to
      0.8 s, estimate) and nothing on `jvm`; put both in the body with the
      archive sizes.

---

## PR C — `jvm.options` and `ENSO_JVM_OPTIONS` (stage 1c, the mechanism)

Branch `jvm/jvm-options`. Label `CI: No changelog needed`. Read
`engine/runner/CLAUDE.md` (native-image friendly code only) and `project/`'s.

### Task C1: The launcher reads `jvm.options` and `ENSO_JVM_OPTIONS`

**Files:**

- Create: `engine/runner/src/main/java/org/enso/runner/JvmOptions.java`
- Modify: `engine/runner/src/main/java/org/enso/runner/Main.java:1508-1510`
  (`launchJvm`, after the fixed list)
- Test: `engine/runner/src/test/java/org/enso/runner/JvmOptionsTest.java`

**Interfaces:**

- Produces:
  - `static List<String> JvmOptions.fromFile(File componentDir)` — the lines of
    `componentDir.getParentFile()/jvm.options`, trimmed, without blank lines and
    lines starting with `#`; empty when the file is missing.
  - `static List<String> JvmOptions.fromEnvironment(String value)` — `null` or
    blank gives none; a value containing `\n` is split on `\r?\n` (each line
    trimmed, blanks dropped); otherwise split on whitespace.
  - `static List<String> JvmOptions.all(File componentDir, String envValue)` —
    file first, then environment.

- [ ] **Step 1: Write the failing test**

```java
package org.enso.runner;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class JvmOptionsTest {
  @Rule public TemporaryFolder folder = new TemporaryFolder();

  private File component() throws Exception {
    var root = folder.newFolder("dist");
    var component = new File(root, "component");
    component.mkdirs();
    return component;
  }

  @Test
  public void readsTheFileBesideComponent() throws Exception {
    var component = component();
    Files.writeString(
        new File(component.getParentFile(), "jvm.options").toPath(),
        "# tuned for the open\n-Dpolyglot.engine.Mode=latency\n\n  -XX:CICompilerCount=2  \n");
    assertEquals(
        List.of("-Dpolyglot.engine.Mode=latency", "-XX:CICompilerCount=2"),
        JvmOptions.fromFile(component));
  }

  @Test
  public void noFileGivesNothing() throws Exception {
    assertEquals(List.of(), JvmOptions.fromFile(component()));
  }

  @Test
  public void environmentSplitsOnWhitespace() {
    assertEquals(List.of("-Da=1", "-Db=2"), JvmOptions.fromEnvironment("  -Da=1   -Db=2 "));
    assertEquals(List.of(), JvmOptions.fromEnvironment(null));
    assertEquals(List.of(), JvmOptions.fromEnvironment("  "));
  }

  @Test
  public void environmentWithNewlinesKeepsSpacesInsideAnOption() {
    var value =
        "-XX:AOTCache=C:\\Users\\John Smith\\enso.aot\r\n"
            + "-Xlog:aot=warning,cds=warning:file=\"C:\\Users\\John Smith\\use.log\"\n\n";
    assertEquals(
        List.of(
            "-XX:AOTCache=C:\\Users\\John Smith\\enso.aot",
            "-Xlog:aot=warning,cds=warning:file=\"C:\\Users\\John Smith\\use.log\""),
        JvmOptions.fromEnvironment(value));
  }

  @Test
  public void fileComesBeforeEnvironment() throws Exception {
    var component = component();
    Files.writeString(new File(component.getParentFile(), "jvm.options").toPath(), "-Dfrom=file\n");
    assertEquals(List.of("-Dfrom=file", "-Dfrom=env"), JvmOptions.all(component, "-Dfrom=env"));
  }
}
```

- [ ] **Step 2: Run it to see it fail** —
      `sbt "engine-runner/testOnly org.enso.runner.JvmOptionsTest"`. Expected:
      compilation failure, `JvmOptions` not found.

- [ ] **Step 3: Implement**

```java
package org.enso.runner;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The options {@link Main#launchJvm} adds to the JVM it starts, after its fixed list: the engine
 * distribution's {@code jvm.options} (beside {@code component/}, one option per line, {@code #}
 * comments), then {@code ENSO_JVM_OPTIONS}. See Note [JVM Options Of The Engine].
 */
final class JvmOptions {
  static final String FILE_NAME = "jvm.options";
  static final String ENVIRONMENT_VARIABLE = "ENSO_JVM_OPTIONS";

  private JvmOptions() {}

  static List<String> fromFile(File componentDir) {
    var file = new File(componentDir.getAbsoluteFile().getParentFile(), FILE_NAME);
    if (!file.isFile()) {
      return List.of();
    }
    try {
      var result = new ArrayList<String>();
      for (var line : Files.readAllLines(file.toPath())) {
        var option = line.trim();
        if (!option.isEmpty() && !option.startsWith("#")) {
          result.add(option);
        }
      }
      return result;
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read " + file, e);
    }
  }

  // Note [JVM Options Of The Engine]
  // ================================
  // A value with a newline is one option per line, so that an option may contain spaces (an AOT
  // cache under `C:\Users\John Smith\`, a quoted `-Xlog` file); the IDE's shim always writes it
  // that way. A value without one is split on whitespace, which is what a person types.
  static List<String> fromEnvironment(String value) {
    if (value == null || value.isBlank()) {
      return List.of();
    }
    var parts = value.contains("\n") ? value.split("\\r?\\n") : value.trim().split("\\s+");
    return Arrays.stream(parts).map(String::trim).filter(s -> !s.isEmpty()).toList();
  }

  static List<String> all(File componentDir, String environmentValue) {
    var result = new ArrayList<String>(fromFile(componentDir));
    result.addAll(fromEnvironment(environmentValue));
    return result;
  }
}
```

In `Main.launchJvm`, right after the three fixed `commandAndArgs.add(...)` lines
(`:1508-1510`) and before the `component.isDirectory()` check:

```java
    commandAndArgs.addAll(
        JvmOptions.all(component, System.getenv(JvmOptions.ENVIRONMENT_VARIABLE)));
```

(Both the JNI path and the `ProcessBuilder` path build from `commandAndArgs`,
and on the `ProcessBuilder` path the options precede `--module-path` and `-m`,
as the JVM needs.)

- [ ] **Step 4: Run the test** — same command. Expected: PASS. Then
      `sbt "engine-runner/test"` (the whole runner suite).

- [ ] **Step 5: Commit**: "Launcher: JVM options from jvm.options and
      ENSO_JVM_OPTIONS".

### Task C2: Ship `jvm.options` with native access

**Files:**

- Create: `distribution/engine/jvm.options`
- Modify: `project/DistributionPackage.scala:150-154` (copy it beside
  `component/`)
- Modify: `project/EngineDistributionChecks.scala` (fail when it is missing)

**Interfaces:**

- Produces: `dist/<version>/jvm.options` in every engine package and bundle.

- [ ] **Step 1: Write the file**

```
# Options for the JVM that `enso --jvm` starts (engine/runner JvmOptions.java), one per line,
# after the launcher's fixed list and before ENSO_JVM_OPTIONS. They are the engine's: the IDE
# and the CLI both get them, and the IDE's AOT cache key includes this file's hash.
#
# JDK 25 warns about these modules' restricted method calls; a later JDK makes them errors.
--enable-native-access=ALL-UNNAMED,org.enso.language.server
```

- [ ] **Step 2: Copy it.** In `createEnginePackage`, after the `THIRD-PARTY`
      copy:

```scala
    copyFilesIncremental(
      Seq(file("distribution/engine/jvm.options")),
      distributionRoot,
      cacheFactory.make("engine-jvm-options")
    )
```

In `EngineDistributionChecks.afterBuild`, add first:

```scala
    if (!(packageRoot / "jvm.options").isFile)
      throw new RuntimeException(s"${packageRoot / "jvm.options"} is missing (spec stage 1c).")
```

- [ ] **Step 3: Build and check the restricted-method warnings are gone**

```bash
sbt buildEngineDistribution
ls built-distribution/enso-engine-*/enso-*/jvm.options
cd test && ../built-distribution/enso-engine-*/enso-*/bin/enso --jvm --run "$PWD/../lib/scala/pkg/src/main/resources/default" 2>&1 | grep -i "restricted method" ; echo "grep exit $?"
```

Expected: the file exists; the grep finds nothing (`grep exit 1`). Run the same
on develop's build first and record that it does find the warning. If the JVM
rejects the duplicated `--enable-native-access` (the launcher's fixed one plus
the file's), the run fails at start-up with an "Unrecognized option" or
"duplicate" error: then move the fixed one into the file as well and say so in
the PR body.

- [ ] **Step 4: Commit**: "Engine package: ship jvm.options with native access".

### Task C3: The harness's `--jvm-options` goes through `ENSO_JVM_OPTIONS`

**Files:**

- Modify: `app/electron-client/perf/openTime.ts:677-685`, `:700-707`
- Modify: `app/electron-client/perf/jvmAotCache.ts` (the training gets the same
  options)
- Modify: `app/electron-client/perf/openTimeReport.ts:420-424`
  (`LAUNCHER_JVM_OPTIONS` stays the fixed list; add `JVM_OPTIONS_FILE_LINES`)
- Test: `app/electron-client/tests/headless/openTimeReport.test.ts:338-350`

**Interfaces:**

- Produces: an experiment's options reach the engine in `ENSO_JVM_OPTIONS`, for
  the AOT training as well as the measured launches (the cache must be trained
  with the options it is used with). Truffle diagnostics stay in
  `JAVA_TOOL_OPTIONS` (they are not engine options).

- [ ] **Step 1: Extend the drift test.** The existing
      `describe('LAUNCHER_JVM_OPTIONS')` reads `Main.java` and checks each
      option appears; add one that reads `distribution/engine/jvm.options` and
      checks the harness's `runProjectOnJvm` (which starts `java` itself, not
      through the launcher) passes the file's lines too. Expected to fail until
      Step 2.

- [ ] **Step 2: Implement.** In `openTime.ts`, the `--jvm-options` branch sets
      `ENSO_JVM_OPTIONS: options.jvmOptions` (instead of joining into
      `JAVA_TOOL_OPTIONS`); `createJvmAotCache` receives `options.jvmOptions`
      and puts the same variable on its training launches; the direct `java`
      launch in `jvmAotCache.ts:163` adds the `jvm.options` lines (read from
      `<component>/../jvm.options`) and the experiment options after
      `LAUNCHER_JVM_OPTIONS`.

- [ ] **Step 3: Run**
      `corepack pnpm --filter enso exec vitest --run tests/headless/openTimeReport.test.ts`
      and `corepack pnpm --filter enso run typecheck`. Expected: PASS.

- [ ] **Step 4: Update docs.** `app/electron-client/CLAUDE.md`, "Open-time
      harness": `--jvm-options` now sets `ENSO_JVM_OPTIONS` and applies to the
      training too. `engine/runner/CLAUDE.md`: a "JVM mode" section naming
      `jvm.options`, `ENSO_JVM_OPTIONS` and the newline rule.

- [ ] **Step 5: Verify on Linux** (WSL recipe):
      `sbt "engine-runner/testOnly org.enso.runner.JvmOptionsTest"` and the Step
      3 vitest run.

- [ ] **Step 6: Commit, push, open PR C** ("Launcher: jvm.options and
      ENSO_JVM_OPTIONS"). Measure per the protocol; the expected change is none
      beyond noise (the file holds only native access), which the body states
      with the numbers.

---

## PR D — The Language Server's channel socket (stage 1a, engine half)

Branch `jvm/ls-channel-socket`. Label `CI: No changelog needed` (nothing uses
the socket until PR F). Read `engine/language-server/CLAUDE.md`,
`lib/scala/json-rpc-server/CLAUDE.md` and `app/ydoc-channel/CLAUDE.md`
(`onClose` semantics, #369).

### Task D1: `WebSocketYjsChannel` and `YjsChannelEndpoint`

**Files:**

- Create:
  `engine/language-server/src/main/scala/org/enso/languageserver/http/server/YjsChannelEndpoint.scala`
- Test:
  `engine/language-server/src/test/scala/org/enso/languageserver/http/server/YjsChannelEndpointSpec.scala`

**Interfaces:**

- Consumes: `org.enso.ydoc.api.YjsChannel` and `YjsChannel.Server`
  (`lib/java/ydoc-api`), `org.enso.jsonrpc.Endpoint`.
- Produces:
  - `final class YjsChannelEndpoint(token: Option[String], servers: () => Map[String, YjsChannel.Server], outgoingBufferSize: Int = 10000)(implicit system: ActorSystem) extends Endpoint`
    — route `GET /channel/{kind}?token=<t>`: a wrong or missing token is `403`,
    an unknown kind `404`, else a WebSocket whose connection is handed to
    `servers()(kind).onConnect` as a `YjsChannel`.
  - `object YjsChannelEndpoint { val Kinds: Seq[String] = Seq("json", "binary", "vis-control", "vis-data") }`
  - The channel: `send(String)` is a text frame, `send(ByteBuffer)` a binary
    frame, anything else `IllegalArgumentException`; incoming text frames are
    `String`, binary frames `ByteBuffer`; messages before `subscribe` are
    buffered and delivered on subscribe; `onClose` runs once when the socket
    closes (at once if already closed).

- [ ] **Step 1: Write the failing spec**

```scala
package org.enso.languageserver.http.server

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.ws.BinaryMessage
import akka.http.scaladsl.testkit.{ScalatestRouteTest, WSProbe}
import akka.util.ByteString
import org.enso.ydoc.api.YjsChannel
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.ByteBuffer
import java.util.concurrent.{LinkedBlockingQueue, TimeUnit}

class YjsChannelEndpointSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private def endpoint(token: Option[String]) = {
    val connected = YjsChannelEndpoint.Kinds.map(_ -> new LinkedBlockingQueue[YjsChannel]()).toMap
    val servers: Map[String, YjsChannel.Server] =
      connected.map { case (kind, queue) => kind -> ((c: YjsChannel) => { queue.add(c); () }) }
    (new YjsChannelEndpoint(token, () => servers), connected)
  }

  private def poll[A](q: LinkedBlockingQueue[A]): A = {
    val a = q.poll(5, TimeUnit.SECONDS)
    a should not be null
    a
  }

  "YjsChannelEndpoint" should {
    "hand each kind's socket to its server, text both ways" in {
      val (e, connected) = endpoint(Some("t0k"))
      for (kind <- Seq("json", "vis-control")) {
        val ws = WSProbe()
        WS(s"/channel/$kind?token=t0k", ws.flow) ~> e.route ~> check {
          isWebSocketUpgrade shouldBe true
          val channel  = poll(connected(kind))
          val received = new LinkedBlockingQueue[Object]()
          ws.sendMessage("before subscribe")
          channel.subscribe(m => { received.add(m); () })
          poll(received) shouldBe "before subscribe"
          channel.send("to ydoc")
          ws.expectMessage("to ydoc")
          ws.sendCompletion()
        }
      }
    }

    "carry binary frames as ByteBuffers" in {
      val (e, connected) = endpoint(Some("t0k"))
      val ws             = WSProbe()
      WS("/channel/binary?token=t0k", ws.flow) ~> e.route ~> check {
        val channel  = poll(connected("binary"))
        val received = new LinkedBlockingQueue[Object]()
        channel.subscribe(m => { received.add(m); () })
        ws.sendMessage(BinaryMessage(ByteString(1, 2, 3)))
        val got = poll(received).asInstanceOf[ByteBuffer]
        val bytes = new Array[Byte](got.remaining()); got.get(bytes)
        bytes.toSeq shouldBe Seq[Byte](1, 2, 3)
        channel.send(ByteBuffer.wrap(Array[Byte](4, 5)))
        ws.expectMessage(ByteString(4, 5))
        ws.sendCompletion()
      }
    }

    "run onClose once when the socket closes" in {
      val (e, connected) = endpoint(Some("t0k"))
      val ws             = WSProbe()
      WS("/channel/vis-data?token=t0k", ws.flow) ~> e.route ~> check {
        val channel = poll(connected("vis-data"))
        val closes  = new LinkedBlockingQueue[String]()
        channel.onClose(() => closes.add("closed"))
        ws.sendCompletion()
        poll(closes) shouldBe "closed"
        closes.poll(500, TimeUnit.MILLISECONDS) shouldBe null
        val late = new LinkedBlockingQueue[String]()
        channel.onClose(() => late.add("late"))
        late.poll(0, TimeUnit.MILLISECONDS) shouldBe "late"
      }
    }

    "refuse a socket without the token, with a wrong one, or when none is configured" in {
      val (e, _) = endpoint(Some("t0k"))
      for (query <- Seq("", "?token=nope")) {
        WS(s"/channel/json$query", WSProbe().flow) ~> e.route ~> check {
          status shouldBe StatusCodes.Forbidden
        }
      }
      val (open, _) = endpoint(None)
      WS("/channel/json?token=anything", WSProbe().flow) ~> open.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "answer 404 for an unknown kind" in {
      val (e, _) = endpoint(Some("t0k"))
      WS("/channel/other?token=t0k", WSProbe().flow) ~> e.route ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
```

- [ ] **Step 2: Run it to see it fail** —
      `sbt "language-server/testOnly org.enso.languageserver.http.server.YjsChannelEndpointSpec"`.
      Expected: compilation failure, `YjsChannelEndpoint` not found.

- [ ] **Step 3: Implement**

```scala
package org.enso.languageserver.http.server

import akka.NotUsed
import akka.actor.{ActorRef, ActorSystem}
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.ws.{BinaryMessage, Message, TextMessage}
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.server.Route
import akka.stream.OverflowStrategy
import akka.stream.scaladsl.{Flow, Sink, Source}
import akka.util.ByteString
import com.typesafe.scalalogging.LazyLogging
import org.enso.jsonrpc.Endpoint
import org.enso.ydoc.api.YjsChannel

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.function.Consumer
import scala.collection.mutable
import scala.concurrent.duration._

/** The Language Server's end of the ydoc server's four channels, as WebSockets on the RPC port:
  * `/channel/{json,binary,vis-control,vis-data}?token=<t>`. Each connection becomes one
  * [[YjsChannel]] handed to the same `Server.onConnect` callbacks the engine-hosted ydoc server
  * calls in-process. See Note [The Channel Socket] below.
  */
final class YjsChannelEndpoint(
  token: Option[String],
  servers: () => Map[String, YjsChannel.Server],
  outgoingBufferSize: Int = 10000
)(implicit system: ActorSystem)
    extends Endpoint
    with LazyLogging {
  import system.dispatcher

  // Note [The Channel Socket]
  // =========================
  // Any loopback client can reach the RPC port, but only the ydoc host may drive these channels:
  // the shim gives the engine and its ydoc host the same random token
  // (`LANGUAGE_SERVER_CHANNEL_TOKEN`), compared here in constant time. An engine started without
  // one refuses every channel socket. Text frames carry strings and binary frames `ByteBuffer`s,
  // as the in-process channels do.

  override def route: Route =
    path("channel" / Segment) { kind =>
      parameter("token".optional) { given =>
        if (!authorised(given)) complete(StatusCodes.Forbidden)
        else
          servers().get(kind) match {
            case None         => complete(StatusCodes.NotFound)
            case Some(server) => handleWebSocketMessages(connect(kind, server))
          }
      }
    }

  private def authorised(given: Option[String]): Boolean =
    (token, given) match {
      case (Some(expected), Some(actual)) =>
        MessageDigest.isEqual(
          expected.getBytes(StandardCharsets.UTF_8),
          actual.getBytes(StandardCharsets.UTF_8)
        )
      case _ => false
    }

  private def connect(
    kind: String,
    server: YjsChannel.Server
  ): Flow[Message, Message, NotUsed] = {
    val channel = new YjsChannelEndpoint.WebSocketYjsChannel(kind)
    val incoming: Sink[Message, NotUsed] =
      Flow[Message]
        .mapAsync(1) {
          case t: TextMessage   => t.toStrict(10.seconds).map(m => m.text: Object)
          case b: BinaryMessage => b.toStrict(10.seconds).map(m => m.data.toByteBuffer: Object)
        }
        .watchTermination() { (_, done) =>
          done.onComplete(_ => channel.socketClosed())
          NotUsed
        }
        .to(Sink.foreach(channel.deliver))
    val outgoing: Source[Message, NotUsed] =
      Source
        .actorRef[Message](
          PartialFunction.empty,
          PartialFunction.empty,
          outgoingBufferSize,
          OverflowStrategy.fail
        )
        .mapMaterializedValue { out =>
          channel.attach(out)
          server.onConnect(channel)
          NotUsed
        }
    Flow.fromSinkAndSourceCoupled(incoming, outgoing)
  }
}

object YjsChannelEndpoint {
  val Kinds: Seq[String] = Seq("json", "binary", "vis-control", "vis-data")

  /** One channel socket as a [[YjsChannel]]. */
  final class WebSocketYjsChannel(kind: String) extends YjsChannel {
    private val lock                            = new Object
    private var out: Option[ActorRef]           = None
    private var handler: Option[Consumer[Object]] = None
    private val pending                         = mutable.Queue[Object]()
    private val closeHandlers                   = mutable.Buffer[Runnable]()
    private var closed                          = false

    private[server] def attach(ref: ActorRef): Unit = lock.synchronized { out = Some(ref) }

    override def send(message: Object): Unit = {
      val frame: Message = message match {
        case s: String     => TextMessage.Strict(s)
        case b: ByteBuffer => BinaryMessage.Strict(ByteString.fromByteBuffer(b.duplicate()))
        case other =>
          throw new IllegalArgumentException(
            s"Channel $kind sends a String or a ByteBuffer, not ${other.getClass.getName}"
          )
      }
      lock.synchronized(out).foreach(_ ! frame)
    }

    override def subscribe(messageHandler: Consumer[Object]): Unit = {
      val backlog = lock.synchronized {
        handler = Some(messageHandler)
        val b = pending.toList
        pending.clear()
        b
      }
      backlog.foreach(messageHandler.accept)
    }

    override def onClose(closeHandler: Runnable): Unit = {
      val runNow = lock.synchronized {
        if (!closed) closeHandlers += closeHandler
        closed
      }
      if (runNow) closeHandler.run()
    }

    private[server] def deliver(message: Object): Unit = {
      val target = lock.synchronized {
        if (handler.isEmpty) pending.enqueue(message)
        handler
      }
      target.foreach(_.accept(message))
    }

    private[server] def socketClosed(): Unit = {
      val toRun = lock.synchronized {
        if (closed) Nil
        else {
          closed = true
          val h = closeHandlers.toList
          closeHandlers.clear()
          h
        }
      }
      toRun.foreach(_.run())
    }
  }
}
```

(`Source.actorRef` with completion and failure matchers is the akka 2.6 form
`JsonRpcServer.newUser` uses; keep the two consistent.)

- [ ] **Step 4: Run the spec** — same command. Expected: PASS. Run it 5 times
      (`for i in 1 2 3 4 5; do sbt …; done`): a WebSocket test that passes once
      proves little.

- [ ] **Step 5: Commit**: "Language Server: the ydoc channels as WebSockets on
      the RPC port".

### Task D2: Wire it in; the embedded ydoc server only on request

**Files:**

- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/boot/MainModule.scala:509-567`
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/boot/config/YdocConfig.scala`,
  `ApplicationConfig.scala`
- Modify:
  `engine/language-server/src/main/resources/application-ls.conf:127-133`

**Interfaces:**

- Produces: `YdocConfig(hostname: String, port: Option[Int])`;
  `ApplicationConfig(ydoc: YdocConfig, channelToken: Option[String])`;
  `LANGUAGE_SERVER_CHANNEL_TOKEN` read as `language-server.channel-token`. The
  embedded ydoc server starts only when `LANGUAGE_SERVER_YDOC_PORT` is set
  (ruling 1).

- [ ] **Step 1: Configuration.** `application-ls.conf`:

```
language-server {
  ydoc {
    hostname = "localhost"
    hostname = ${?LANGUAGE_SERVER_YDOC_HOSTNAME}
    # No default: the engine-hosted ydoc server starts only when the shim asks for it
    # (ENSO_YDOC_HOST=engine). Otherwise the ydoc server runs in Node and reaches this
    # engine over /channel/{kind} on the RPC port.
    port = ${?LANGUAGE_SERVER_YDOC_PORT}
  }
  channel-token = ${?LANGUAGE_SERVER_CHANNEL_TOKEN}
}
```

`YdocConfig.scala`:
`case class YdocConfig(hostname: String, port: Option[Int])`.
`ApplicationConfig.scala`:
`case class ApplicationConfig(ydoc: YdocConfig, channelToken: Option[String])`.

- [ ] **Step 2: MainModule.** Load the config once
      (`private val applicationConfig = ApplicationConfig.load()`) before
      `jsonRpcServer`. Add, before `jsonRpcServer`:

```scala
  private val channelEndpoint =
    new YjsChannelEndpoint(
      applicationConfig.channelToken,
      () =>
        Map(
          "json"        -> jsonRpcServer.yjsChannelCallbacks,
          "binary"      -> binaryChannelCallbacks,
          "vis-control" -> visualizationBridge.controlCallbacks,
          "vis-data"    -> visualizationBridge.dataCallbacks
        )
    )(system)
```

(the closure runs per connection, after construction, so the later vals are
initialised), add `channelEndpoint` to the endpoint list at `:520`, and make the
ydoc block start the embedded server only when `applicationConfig.ydoc.port` is
defined:

```scala
  private val ydoc: Option[java.util.concurrent.ExecutorService] =
    applicationConfig.ydoc.port.map { port =>
      val ydocExecutor = Executors.newSingleThreadExecutor(r => { /* unchanged */ })
      ydocExecutor.execute(() =>
        org.enso.ydoc.api.YdocServerApi.launchYdocServer(
          applicationConfig.ydoc.hostname,
          port,
          jsonRpcServer.yjsChannelCallbacks,
          binaryChannelCallbacks,
          visualizationBridge.controlCallbacks,
          visualizationBridge.dataCallbacks
        )
      )
      ydocExecutor
    }
```

and `close()` calls `ydoc.foreach(_.shutdownNow())`.

- [ ] **Step 3: Run the Language Server suite** — `sbt "language-server/test"`.
      Expected: PASS. Any test that relied on the 5976 default fails here: give
      it `LANGUAGE_SERVER_YDOC_PORT` explicitly (grep `5976` under `engine/` and
      `lib/` first and list what you changed in the PR body).

- [ ] **Step 4: An end-to-end check by hand.** Build the distribution
      (`sbt buildEngineDistribution`), start an engine with a token and no ydoc
      port, and connect a socket:

```bash
cd test && LANGUAGE_SERVER_CHANNEL_TOKEN=abc ../built-distribution/enso-engine-*/enso-*/bin/enso \
  --server --root-id 00000000-0000-0000-0000-000000000001 --project-id x \
  --path "$PWD/../lib/scala/pkg/src/main/resources/default" --interface 127.0.0.1 --rpc-port 30700 &
node -e "const ws=new (require('ws'))('ws://127.0.0.1:30700/channel/json?token=abc');ws.on('open',()=>{ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'session/initProtocolConnection',params:{clientId:'00000000-0000-0000-0000-000000000002'}}))});ws.on('message',m=>{console.log(String(m).slice(0,120));process.exit(0)})"
```

(run the `node` line from `app/ydoc-inspect`, which has `ws`). Expected: a
JSON-RPC result for `session/initProtocolConnection`; and no process listening
on 5976 (`netstat -an | grep 5976` empty). Stop the engine with a newline on its
stdin. Do it on Windows and in WSL.

- [ ] **Step 5: Format** — `sbt "scalafmtAll; scalafmtCheckAll"`.

- [ ] **Step 6: Docs.** `engine/language-server/CLAUDE.md`: the GUI reaches the
      server through the ydoc server, which runs in Node and connects to
      `/channel/{kind}` (token), or in-process when `LANGUAGE_SERVER_YDOC_PORT`
      is set.

- [ ] **Step 7: Commit, push, open PR D** ("Language Server: ydoc channels over
      WebSockets"). Body: the four kinds, the token, ruling 1 (the port is now
      optional), "nothing uses the socket until PR F", "cannot move the JVM's
      open time by itself".

---

## PR E — The ydoc server's Node transport (stage 1a, app half)

Branch `jvm/ydoc-node-transport`. Label `CI: No changelog needed` (library code
not yet hosted). Read `app/ydoc-server/CLAUDE.md`,
`app/ydoc-server-polyglot/CLAUDE.md`, `app/ydoc-channel/CLAUDE.md`. Changes to
`app/ydoc-server` must keep the polyglot build working (`ydoc-server-polyglot`
still bundles it until PR M), so build both.

### Task E1: Byte buffers in Node

**Files:**

- Modify: `app/ydoc-server/src/YjsBinaryChannel.ts:12-47`
- Modify: `app/ydoc-server/src/inspect.ts:170-180`, `:265-270`
- Create: `app/ydoc-server/src/nodeByteBuffer.ts`
- Test: `app/ydoc-server/src/__tests__/nodeByteBuffer.test.ts`

**Interfaces:**

- Produces:
  - `JavaByteBufferClass` gains an optional
    `view?(buffer: JavaByteBuffer): Uint8Array`; when present, the codec and the
    inspector use it instead of `new Uint8Array(new ArrayBuffer(buffer))` (which
    only GraalJS understands).
  - `nodeByteBufferClass: JavaByteBufferClass` — `allocateDirect(n)` returns a
    `Uint8Array` of `n` bytes, `view(b)` returns it.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { JavaByteBufferCodec } from "../YjsBinaryChannel";
import { nodeByteBufferClass } from "../nodeByteBuffer";

test("the codec round-trips bytes with the Node byte buffer", () => {
  const codec = new JavaByteBufferCodec(nodeByteBufferClass);
  const stored = new Uint8Array([1, 2, 3]);
  const buffer = codec.decode(stored);
  expect(Array.from(nodeByteBufferClass.view!(buffer))).toEqual([1, 2, 3]);
  expect(Array.from(codec.encode(buffer))).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run it to see it fail** —
      `corepack pnpm --filter ydoc-server exec vitest run src/__tests__/nodeByteBuffer.test.ts`.
      Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** `nodeByteBuffer.ts`:

```ts
/** @file The byte buffer of the ydoc server's Node host: a `Uint8Array` where GraalJS has a Java `ByteBuffer`. */
import type { JavaByteBuffer, JavaByteBufferClass } from "./YjsBinaryChannel";

/** Bytes travel as `Uint8Array`s in Node; the brand only keeps them apart from numbers in the types. */
export const nodeByteBufferClass: JavaByteBufferClass = {
  allocateDirect: (capacity) =>
    new Uint8Array(capacity) as unknown as JavaByteBuffer,
  view: (buffer) => buffer as unknown as Uint8Array,
};
```

(The double cast is between this repository's own branded type and `Uint8Array`,
not a third-party API, so the root `CLAUDE.md` rule on `as unknown as` does not
apply; say so in a comment.) In `YjsBinaryChannel.ts`, add
`view?(buffer: JavaByteBuffer): Uint8Array` to the interface and use
`this.ByteBuffer.view?.(message) ?? new Uint8Array(new ArrayBuffer(message))` in
`encode`, and the same for `bb` in `decode`. Same change at `inspect.ts:176` and
`:269` (`byteBufferClass.view?.(…) ?? …`; the free function at `:269` takes the
class as a parameter if it does not have it).

- [ ] **Step 4: Run** `corepack pnpm --filter ydoc-server run test:unit` and
      `corepack pnpm --filter ydoc-server-polyglot run compile`. Expected: PASS,
      and the polyglot bundle still builds.

- [ ] **Step 5: Commit**: "ydoc-server: byte buffers in Node".

### Task E2: `YjsChannelServer` over a channel socket

**Files:**

- Create: `app/ydoc-server/src/remoteChannelServer.ts`
- Modify: `app/ydoc-server/package.json` (add `"ws": "^8.21.3"`, the version
  `ydoc-inspect` already uses)
- Test: `app/ydoc-server/src/__tests__/remoteChannelServer.test.ts`

**Interfaces:**

- Produces:
  - `type ChannelKind = 'json' | 'binary' | 'vis-control' | 'vis-data'`
  - `interface LanguageServerChannelAddress { readonly host: string; readonly port: number; readonly token: string }`
  - `channelUrl(address, kind): string` →
    `ws://<host>:<port>/channel/<kind>?token=<encodeURIComponent(token)>`
  - `remoteChannelServer<T>(address, kind, onUnexpectedClose?: () => void): YjsChannelServer<T>`
    — for each `onConnect(channel)` opens one socket; messages the channel
    receives (from the ydoc side) go to the socket, buffered until it opens;
    socket messages go to `channel.send` (binary frames as `Uint8Array`, text as
    `string`); `channel.onClose` closes the socket; a socket close that the
    channel did not cause closes the channel and calls `onUnexpectedClose`.

- [ ] **Step 1: Write the failing test** (a fake LS with `ws`'s
      `WebSocketServer` on port 0):

```ts
import * as Y from "yjs";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, expect, test, vi } from "vitest";
import { YjsChannel } from "ydoc-channel";
import { channelUrl, remoteChannelServer } from "../remoteChannelServer";

let lsServer: WebSocketServer | undefined;
afterEach(() => lsServer?.close());

async function fakeLanguageServer() {
  const sockets: { url: string; socket: WebSocket }[] = [];
  lsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  lsServer.on("connection", (socket, request) =>
    sockets.push({ url: request.url ?? "", socket }),
  );
  await new Promise((r) => lsServer!.once("listening", r));
  const port = (lsServer.address() as { port: number }).port;
  return { port, sockets };
}

test("channelUrl", () => {
  expect(
    channelUrl({ host: "127.0.0.1", port: 1, token: "a b" }, "vis-control"),
  ).toBe("ws://127.0.0.1:1/channel/vis-control?token=a%20b");
});

test("messages flow both ways, text and binary", async () => {
  const ls = await fakeLanguageServer();
  const doc = new Y.Doc();
  const lsEnd = new YjsChannel<string>(doc, "json");
  const ydocEnd = new YjsChannel<string>(doc, "json");
  const fromLs: string[] = [];
  ydocEnd.subscribe((m) => fromLs.push(m));
  remoteChannelServer<string>(
    { host: "127.0.0.1", port: ls.port, token: "t" },
    "json",
  ).onConnect(lsEnd);
  ydocEnd.send("early"); // before the socket is open: buffered
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1));
  expect(ls.sockets[0]!.url).toBe("/channel/json?token=t");
  const atLs: string[] = [];
  ls.sockets[0]!.socket.on("message", (d) => atLs.push(String(d)));
  await vi.waitFor(() => expect(atLs).toEqual(["early"]));
  ls.sockets[0]!.socket.send("reply");
  await vi.waitFor(() => expect(fromLs).toEqual(["reply"]));
});

test("a socket closed by the LS closes the channel and reports it", async () => {
  const ls = await fakeLanguageServer();
  const doc = new Y.Doc();
  const lsEnd = new YjsChannel<string>(doc, "json");
  const onUnexpectedClose = vi.fn();
  remoteChannelServer<string>(
    { host: "127.0.0.1", port: ls.port, token: "t" },
    "json",
    onUnexpectedClose,
  ).onConnect(lsEnd);
  const closed = vi.fn();
  lsEnd.onClose(closed);
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1));
  ls.sockets[0]!.socket.close();
  await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(onUnexpectedClose).toHaveBeenCalledOnce();
});

test("a channel closed by ydoc closes its socket, and is not reported", async () => {
  const ls = await fakeLanguageServer();
  const doc = new Y.Doc();
  const lsEnd = new YjsChannel<string>(doc, "json");
  const onUnexpectedClose = vi.fn();
  remoteChannelServer<string>(
    { host: "127.0.0.1", port: ls.port, token: "t" },
    "json",
    onUnexpectedClose,
  ).onConnect(lsEnd);
  await vi.waitFor(() => expect(ls.sockets).toHaveLength(1));
  const socketClosed = new Promise((r) =>
    ls.sockets[0]!.socket.once("close", r),
  );
  lsEnd.close();
  await socketClosed;
  expect(onUnexpectedClose).not.toHaveBeenCalled();
});
```

Add a binary test the same way with `YjsChannel<JavaByteBuffer, Uint8Array>` and
`new JavaByteBufferCodec(nodeByteBufferClass)` on both ends, sending
`nodeByteBufferClass.allocateDirect(…)` filled with `[7, 8]` and expecting the
LS to receive a binary frame `[7, 8]`, and the reverse.

(Which end receives what: a `YjsChannel` does not hear its own sends, so `lsEnd`
— handed to the server — hears `ydocEnd`'s sends, and the LS's replies are sent
as `lsEnd.send(...)` and heard by `ydocEnd`.)

- [ ] **Step 2: Run it to see it fail** —
      `corepack pnpm --filter ydoc-server exec vitest run src/__tests__/remoteChannelServer.test.ts`.
      Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** @file The ydoc server's Node host reaches the Language Server's channels over WebSockets (`/channel/{kind}`). */
import { WebSocket } from "ws";
import type { YjsChannel, YjsChannelServer } from "ydoc-channel";

export type ChannelKind = "json" | "binary" | "vis-control" | "vis-data";

export interface LanguageServerChannelAddress {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

/** The Language Server's URL for one channel kind. */
export function channelUrl(
  address: LanguageServerChannelAddress,
  kind: ChannelKind,
): string {
  return `ws://${address.host}:${address.port}/channel/${kind}?token=${encodeURIComponent(address.token)}`;
}

/**
 * A {@link YjsChannelServer} whose every channel is one socket to the Language Server. The channel
 * handed to `onConnect` is the Language Server's end: what it receives goes to the socket, what
 * the socket brings is sent on it.
 */
export function remoteChannelServer<T>(
  address: LanguageServerChannelAddress,
  kind: ChannelKind,
  onUnexpectedClose: () => void = () => {},
): YjsChannelServer<T> {
  return {
    onConnect<TStored>(channel: YjsChannel<T, TStored>) {
      const socket = new WebSocket(channelUrl(address, kind));
      socket.binaryType = "nodebuffer";
      const pending: T[] = [];
      let closedByChannel = false;
      socket.on("open", () => {
        for (const message of pending.splice(0))
          socket.send(message as string | Uint8Array);
      });
      channel.subscribe((message) => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(message as string | Uint8Array);
        else if (socket.readyState === WebSocket.CONNECTING)
          pending.push(message);
      });
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        const message = isBinary
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : data.toString("utf8");
        channel.send(message as T);
      });
      socket.on("error", (error) =>
        console.error(`Channel ${kind} to the Language Server failed:`, error),
      );
      socket.on("close", () => {
        if (closedByChannel) return;
        channel.close();
        onUnexpectedClose();
      });
      channel.onClose(() => {
        closedByChannel = true;
        socket.close();
      });
    },
  };
}
```

(The `as` casts narrow the generic message to what `ws` sends; text channels
carry strings and binary channels `Uint8Array`s, as `nodeByteBufferClass` makes
them.)

- [ ] **Step 4: Run the test** (install first: `corepack pnpm install`, the
      lockfile changes) — same command. Expected: PASS; run it 5 times.

- [ ] **Step 5: Commit** `remoteChannelServer.ts`, its test, `package.json`,
      `pnpm-lock.yaml`: "ydoc-server: channels to the Language Server over
      WebSockets".

### Task E3: `NodeYdocHost`: one listener per project

**Files:**

- Create: `app/ydoc-server/src/nodeHost.ts`
- Modify: `app/ydoc-server/src/index.ts` (export it)
- Test: `app/ydoc-server/src/__tests__/nodeHost.test.ts`

**Interfaces:**

- Consumes: `remoteChannelServer`, `nodeByteBufferClass`, `setupGatewayClient`,
  `docName` (from `ydoc.ts`/`index.ts`), `LanguageServerSession`.
- Produces:
  - `interface YdocListenRequest { readonly host: string; readonly port: number; readonly languageServer: LanguageServerChannelAddress }`
    — the same shape the shim's `YdocHost` interface declares (PR F); the two
    are kept structurally identical, and a type test in PR F checks it.
  - `class NodeYdocHost { listen(request: YdocListenRequest): Promise<void>; close(port: number): Promise<void>; closeAll(): Promise<void> }`
    — `listen` resolves once the port accepts connections; a second `listen` on
    a port already listening replaces the old listener; `close` of an unknown
    port is a no-op.
  - Ruling 4: when the listener's `json` channel socket closes unexpectedly,
    every GUI socket of that listener is closed.

- [ ] **Step 1: Write the failing tests.** A fake LS with `WebSocketServer` that
      answers `/channel/json` JSON-RPC: it echoes every request as a result `{}`
      except `session/initProtocolConnection`, which returns
      `{ contentRoots: [{ id: <uuid>, type: 'Project' }] }` (the shape the ydoc
      session needs; copy the fields the existing
      `languageServerSession.test.ts` mock returns, which is the reference for
      what `LanguageServerSession` asks first). Tests:

```ts
test("listen resolves once the port accepts, and close frees it", async () => {
  const host = new NodeYdocHost();
  const port = await freePort();
  await host.listen({
    host: "127.0.0.1",
    port,
    languageServer: { host: "127.0.0.1", port: ls.port, token: "t" },
  });
  await expect(connectTcp(port)).resolves.toBeUndefined();
  await host.close(port);
  await expect(connectTcp(port)).rejects.toThrow();
});

test("a GUI socket on /project/index reaches the LS json channel with the token", async () => {
  const host = new NodeYdocHost();
  const port = await freePort();
  await host.listen({
    host: "127.0.0.1",
    port,
    languageServer: { host: "127.0.0.1", port: ls.port, token: "t" },
  });
  const gui = new WebSocket(
    `ws://127.0.0.1:${port}/project/index?ls=ws://127.0.0.1:${ls.port}`,
  );
  await vi.waitFor(() => expect(ls.urls).toContain("/channel/json?token=t"));
  gui.close();
  await host.closeAll();
});

test("the LS going away closes the GUI sockets (ruling 4)", async () => {
  /* as above, then: */
  ls.closeAll(); // the fake LS closes its channel sockets
  await vi.waitFor(() => expect(gui.readyState).toBe(WebSocket.CLOSED));
});
```

(`freePort()` asks the OS for port 0 on a `net.Server` and releases it;
`connectTcp(port)` resolves when a `net.connect` succeeds. Put both in the test
file.)

- [ ] **Step 2: Run them to see them fail** —
      `corepack pnpm --filter ydoc-server exec vitest run src/__tests__/nodeHost.test.ts`.

- [ ] **Step 3: Implement**

```ts
/** @file The ydoc server hosted in Node: one WebSocket listener per opened project (spec stage 1a (b)). */
import { WebSocketServer, type WebSocket } from "ws";
import { nodeByteBufferClass } from "./nodeByteBuffer";
import {
  remoteChannelServer,
  type LanguageServerChannelAddress,
} from "./remoteChannelServer";
import { docName, setupGatewayClient, type YjsSocket } from "./ydoc";

export interface YdocListenRequest {
  readonly host: string;
  readonly port: number;
  readonly languageServer: LanguageServerChannelAddress;
}

interface Listener {
  readonly server: WebSocketServer;
  readonly clients: Set<WebSocket>;
}

/** Hosts a ydoc listener per project, each talking to its own Language Server's channels. */
export class NodeYdocHost {
  private readonly listeners = new Map<number, Listener>();

  /** Start listening on `request.port`; resolves once it accepts connections. */
  async listen(request: YdocListenRequest): Promise<void> {
    await this.close(request.port);
    const clients = new Set<WebSocket>();
    // Ruling 4: a Language Server that went away takes its GUI sockets with it, as an engine
    // restart did when the server lived inside it; the GUI reconnects.
    const dropClients = () => {
      for (const client of clients) client.close();
    };
    const json = remoteChannelServer<string>(
      request.languageServer,
      "json",
      dropClients,
    );
    const binary = remoteChannelServer(request.languageServer, "binary");
    const visControl = remoteChannelServer<string>(
      request.languageServer,
      "vis-control",
    );
    const visData = remoteChannelServer(request.languageServer, "vis-data");
    const server = new WebSocketServer({
      host: request.host,
      port: request.port,
    });
    server.on("connection", (socket, httpRequest) => {
      const url = new URL(
        httpRequest.url ?? "/",
        `ws://${request.host}:${request.port}`,
      );
      const doc = docName(url.pathname);
      const ls = url.searchParams.get("ls");
      if (doc == null || ls == null) {
        socket.close();
        return;
      }
      clients.add(socket);
      socket.on("close", () => clients.delete(socket));
      setupGatewayClient(
        socket as unknown as YjsSocket,
        ls,
        url.searchParams.get("data"),
        doc,
        nodeByteBufferClass,
        json,
        binary,
        visControl,
        visData,
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    this.listeners.set(request.port, { server, clients });
  }

  /** Stop the listener on `port` and close its sockets; a port with none is ignored. */
  async close(port: number): Promise<void> {
    const listener = this.listeners.get(port);
    if (!listener) return;
    this.listeners.delete(port);
    for (const client of listener.clients) client.terminate();
    await new Promise<void>((resolve) =>
      listener.server.close(() => resolve()),
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.listeners.keys()].map((port) => this.close(port)),
    );
  }
}
```

(`YjsSocket` was written as the subset of `ws`'s `WebSocket` the server uses; if
`ws`'s `WebSocket` is assignable to it, drop the cast — try that first, per the
root `CLAUDE.md` rule against `as unknown as` on a third-party type. If it is
not assignable, use `as YjsSocket` and fix whichever member differs.)

- [ ] **Step 4: Run the ydoc-server suite** —
      `corepack pnpm --filter ydoc-server run test:unit`, then 5 runs of the new
      file. Re-test the four historic socket races on this transport (#214 first
      message on open, #396 shared data channel, #409 double close, #494 local
      terminate): one test each in `nodeHost.test.ts`, each a loop of 50
      open/send/close cycles asserting no lost first message, no dead data
      channel after one socket closes, one `close` per socket, and no hang.

- [ ] **Step 5: Docs.** `app/ydoc-server/CLAUDE.md`: a "Node host" section
      (`NodeYdocHost`, the four channel sockets, the token, ruling 4); the
      "Running" section gains it.

- [ ] **Step 6: Verify on Linux** (WSL recipe) with
      `corepack pnpm --filter ydoc-server run test:unit`.

- [ ] **Step 7: Commit, push, open PR E** ("ydoc-server: run in Node against the
      Language Server's channel sockets"). Body: no host uses it yet; the
      polyglot bundle still builds; the four race re-tests.

---

## PR F — The ydoc server leaves the engine (stage 1a, the host)

Branch `jvm/ydoc-node-host`. **Changelog entry and the owner's installer test
before merge** (ruling 9). Depends on A, D, E merged. Read
`app/electron-client/CLAUDE.md`, the shim's, and
`app/gui/integration-test/CLAUDE.md` (the Playwright suite must stay unchanged).

### Task F1: The shim chooses the host and hands out tokens

**Files:**

- Create: `app/project-manager-shim/src/projectService/ydocHost.ts`
- Modify: `app/project-manager-shim/src/projectService/ensoRunner.ts:617-700`
  (`openProject`), `OpenedProject.close`
- Modify: `app/project-manager-shim/src/projectService/index.ts`
  (`EngineSettings.ydocHost`)
- Test: `app/project-manager-shim/src/projectService/__tests__/ydocHost.test.ts`

**Interfaces:**

- Produces (`ydocHost.ts`):
  - `type YdocHostKind = 'engine' | 'node'`
  - `ydocHostKind(env?: NodeJS.ProcessEnv): YdocHostKind` — `ENSO_YDOC_HOST`,
    default `node`, an unknown value is `node` with a warning.
  - `interface YdocListenRequest { readonly host: string; readonly port: number; readonly languageServer: { readonly host: string; readonly port: number; readonly token: string } }`
  - `interface YdocHost { listen(request: YdocListenRequest): Promise<void>; close(port: number): Promise<void> }`
  - `newChannelToken(): string` — 32 random bytes as hex.
- `EnsoRunner`'s constructor options gain `ydocHost?: YdocHost`. When the kind
  is `node` and a host is given: the runner creates a token, calls
  `ydocHost.listen({ host: '127.0.0.1', port: ydocPort, languageServer: { host: '127.0.0.1', port: jsonPort, token } })`
  before spawning, does not set `LANGUAGE_SERVER_YDOC_PORT`, sets
  `LANGUAGE_SERVER_CHANNEL_TOKEN`, skips the ydoc port wait, and calls
  `ydocHost.close(ydocPort)` when the project closes or its open fails. When the
  kind is `engine`, or no host is given (the tests' fakes), today's behaviour,
  plus the token.

- [ ] **Step 1: Write the failing test** (`ydocHost.test.ts`, with a fake `enso`
      as in A3 that records its environment, port band `YDOC_HOST_PORT`):

```ts
test("node: the host listens on the ydoc port before the engine starts, with the engine token", async () => {
  const calls: string[] = [];
  const host: YdocHost = {
    listen: async (r) =>
      void calls.push(
        `listen ${r.port} ls=${r.languageServer.port} token=${r.languageServer.token.length}`,
      ),
    close: async (port) => void calls.push(`close ${port}`),
  };
  vi.stubEnv("ENSO_YDOC_HOST", "node");
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: YDOC_HOST_PORT,
    ydocHost: host,
  });
  const p = path.join(root, "N");
  const sockets = await runner.openProject(Path(p), "id-n");
  const seen = JSON.parse(await fs.readFile(p + ".env.json", "utf8"));
  expect(seen.LANGUAGE_SERVER_YDOC_PORT).toBeUndefined();
  expect(seen.LANGUAGE_SERVER_CHANNEL_TOKEN).toMatch(/^[0-9a-f]{64}$/);
  expect(calls[0]).toBe(
    `listen ${sockets.ydocSocket.port} ls=${sockets.jsonSocket.port} token=64`,
  );
  await runner.closeProject(Path(p));
  expect(calls.at(-1)).toBe(`close ${sockets.ydocSocket.port}`);
});

test("engine: the engine gets the ydoc port, and the host is not used", async () => {
  vi.stubEnv("ENSO_YDOC_HOST", "engine");
  const host = { listen: vi.fn(), close: vi.fn() };
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: YDOC_HOST_PORT,
    ydocHost: host,
  });
  const p = path.join(root, "E");
  const sockets = await runner.openProject(Path(p), "id-e");
  expect(
    JSON.parse(await fs.readFile(p + ".env.json", "utf8"))
      .LANGUAGE_SERVER_YDOC_PORT,
  ).toBe(String(sockets.ydocSocket.port));
  expect(host.listen).not.toHaveBeenCalled();
  await runner.closeProject(Path(p));
});

test("ydocHostKind", () => {
  expect(ydocHostKind({})).toBe("node");
  expect(ydocHostKind({ ENSO_YDOC_HOST: "Engine" })).toBe("engine");
  expect(ydocHostKind({ ENSO_YDOC_HOST: "graal" })).toBe("node");
});

test("a failed open closes the listener", async () => {
  /* the fake exits 1 at once; expect close called */
});
```

- [ ] **Step 2: Run it to see it fail** —
      `corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/ydocHost.test.ts`.

- [ ] **Step 3: Implement** `ydocHost.ts` as the interface block above
      (`newChannelToken` = `crypto.randomBytes(32).toString('hex')`), and the
      runner changes. In `openProject`, inside the attempt loop, after
      `findServerPorts`:

```ts
const token = newChannelToken();
const nodeHost = ydocHostKind() === "node" ? this.options.ydocHost : undefined;
if (nodeHost) {
  await nodeHost.listen({
    host: "127.0.0.1",
    port: ydocPort,
    languageServer: { host: "127.0.0.1", port: jsonPort, token },
  });
}
const env = {
  ...process.env,
  ...(nodeHost ? {} : { LANGUAGE_SERVER_YDOC_PORT: ydocPort.toString() }),
  LANGUAGE_SERVER_CHANNEL_TOKEN: token,
  ...jvmOptionsEnv(launch),
  ...(extraEnv ? Object.fromEntries(extraEnv) : {}),
};
```

pass `nodeHost ? 0 : <today's ydocWaitMs>` as the wait (Note [Open Waits For The
Ydoc Port] gets a sentence: under the Node host the listener is up before the
engine starts, so there is nothing to wait for), register a shutdown hook
`'close-ydoc-listener'` (add it to `ShutdownHookRegistry`) that calls
`nodeHost.close(ydocPort)`, and call it in the `catch` of a failed attempt.

- [ ] **Step 4: Run the shim suite** —
      `corepack pnpm --filter project-manager-shim run test:unit`. Expected:
      PASS.

- [ ] **Step 5: Commit**: "Shim: the ydoc host, Node by default, with a channel
      token per engine".

### Task F2: The Electron utility process

**Files:**

- Create: `app/electron-client/src/ydocHost/main.ts` (the utility process)
- Create: `app/electron-client/src/ydocHost/client.ts`
  (`UtilityProcessYdocHost`, main-process side)
- Modify: `app/electron-client/esbuildConfig.ts:26` (entry point)
- Modify: `app/electron-client/src/projectService.ts` (pass the host)
- Modify: `app/electron-client/package.json` (add
  `"ydoc-server": "workspace:*"`)
- Test: `app/electron-client/tests/headless/ydocHostClient.test.ts`

**Interfaces:**

- Consumes: `NodeYdocHost` (E3), `YdocHost`/`YdocListenRequest` (F1).
- Produces:
  - Messages main → utility:
    `{ type: 'listen', id: number, request: YdocListenRequest }`,
    `{ type: 'close', id: number, port: number }`; utility → main:
    `{ type: 'done', id: number }` or
    `{ type: 'failed', id: number, message: string }`.
  - `class UtilityProcessYdocHost implements YdocHost` with
    `constructor(spawn: () => MessagePortLike)` (the `utilityProcess.fork`
    wrapper is injected so the unit test passes a fake), forking lazily on the
    first `listen`, restarting once if the process exits, and `dispose()`.
  - The utility process prints `ydoc host pid=<pid>` on start (ruling 14).

- [ ] **Step 1: Write the failing test** — a fake child (an `EventEmitter` with
      `postMessage`) that answers `listen` with `done` and records the requests:
      `listen` resolves on `done`, rejects with the message on `failed`, `close`
      likewise; one fork for many listens; a fork after the child exits.

- [ ] **Step 2: Run it** —
      `corepack pnpm --filter enso exec vitest --run tests/headless/ydocHostClient.test.ts`.
      Expected: FAIL.

- [ ] **Step 3: Implement.** `ydocHost/main.ts`:

```ts
/** @file The ydoc server's utility process (spec stage 1a (b)): Electron's own Node, off the main process. */
import { NodeYdocHost, type YdocListenRequest } from "ydoc-server";

type Request =
  | {
      readonly type: "listen";
      readonly id: number;
      readonly request: YdocListenRequest;
    }
  | { readonly type: "close"; readonly id: number; readonly port: number };

const host = new NodeYdocHost();
console.log(`ydoc host pid=${process.pid}`);
process.parentPort.on("message", (event) => {
  const message = event.data as Request;
  const work =
    message.type === "listen"
      ? host.listen(message.request)
      : host.close(message.port);
  work.then(
    () => process.parentPort.postMessage({ type: "done", id: message.id }),
    (error: unknown) =>
      process.parentPort.postMessage({
        type: "failed",
        id: message.id,
        message: String(error),
      }),
  );
});
```

`client.ts` implements the request/response map by `id`, and in Electron wires
`spawn` to
`utilityProcess.fork(path.join(import.meta.dirname, 'ydocHost', 'main.mjs'), [], { serviceName: 'Enso ydoc server', stdio: 'inherit' })`.
`esbuildConfig.ts`:
`entryPoints: ['src/index.ts', 'src/preload.ts', 'src/ydocHost/main.ts']` (the
existing `wasmLoader()` plugin handles `rust-ffi`'s WASM, as it does for the
main bundle). `projectService.ts` passes
`ydocHost: new UtilityProcessYdocHost(forkYdocHost)` in `EngineSettings` and
`ProjectService.default` forwards it to `EnsoRunner`. `before-quit` disposes it.

- [ ] **Step 4: Run** the headless tests and
      `corepack pnpm --filter enso run typecheck`; build the client
      (`corepack pnpm --filter enso run build` or the package's bundle script)
      and check `ydocHost/main.mjs` is in the output. If Electron 41 refuses the
      `.mjs` entry for `utilityProcess.fork`, add a second esbuild context for
      that entry with `format: 'cjs'` and `outExtension: { '.js': '.cjs' }`, and
      fork the `.cjs`.

- [ ] **Step 5: Commit**: "Electron: host the ydoc server in a utility process".

### Task F3: The Vite middleware hosts it in-process

**Files:**

- Modify: `app/gui/project-manager-shim-middleware/index.ts:102-113`
- Modify: `app/gui/vite.config.ts:17-20` (drop the `ws://__HOSTNAME__:5976`
  default)
- Modify: `app/ydoc-server/CLAUDE.md` "Running" (dev now hosts it)

**Interfaces:**

- Consumes: `NodeYdocHost` (E3), `EngineSettings.ydocHost` (F1).

- [ ] **Step 1: Implement.** `getProjectService` passes
      `{ ydocHost: new NodeYdocHost() }` as `ProjectService.default`'s `engine`
      argument. In `vite.config.ts`, remove the
      `ENSO_IDE_YDOC_SERVER_URL ||= 'ws://__HOSTNAME__:5976'` line (the GUI
      takes `languageServerYdocAddress` from `project/open`, see
      `projectStates.ts:182`); keep `ENSO_IDE_YDOC_LS_DEBUG`.

- [ ] **Step 2: Check by hand.** `corepack pnpm dev:vite` with a built engine
      distribution, open the default project, edit a node, and see the edit
      saved to `Main.enso`. Do this on Windows and in WSL (WSLg).

- [ ] **Step 3: Commit**: "dev:vite: host the ydoc server in Node".

### Task F4: Tests on the packaged IDE, measurement, changelog, PR

**Files:**

- Modify: `CHANGELOG.md` (`# Next Release`, `#### Enso IDE`)
- Modify: `app/CLAUDE.md` (`ydoc-server` and `ydoc-server-polyglot` bullets),
  `app/ydoc-server-polyglot/CLAUDE.md` ("the rollback host until PR M"),
  `app/electron-client/CLAUDE.md` (the utility process; `ENSO_YDOC_HOST`)

- [ ] **Step 1: Packaged tests.** Build the installer locally (`ide-local`, see
      the memory note "Local Windows installer build") and run
      `corepack pnpm -r --filter enso ide-integration-test` on Windows, and on
      Linux from CI's run. Both modes: once as built, once with
      `ENSO_YDOC_HOST=engine` set in the environment of the test run (the
      Electron fixture passes `process.env` through, `electronTest.ts:64`).
      Expected: PASS both ways.

- [ ] **Step 2: The GUI Playwright suite** runs unchanged in CI (it already uses
      the Node build's pieces through the mocks); confirm it is green.

- [ ] **Step 3: Measure** (protocol, per-PR, `native,jvm-nocache,jvm`, welcome
      and image). The expected change: on JVM, `lsReady`→`firstNode` shrinks by
      3.5 to 4.2 s (Linux) and 12 to 14.7 s (Windows); on native, an open 0.3 to
      0.5 s faster (no ydoc port wait). Record also the `guiConnected` phase,
      which the old wait moved.

- [ ] **Step 4: Changelog entry** under `#### Enso IDE`:

```markdown
- [Projects open faster: the collaborative-editing server now runs beside the
  engine instead of inside it][NNN]
```

with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`.

- [ ] **Step 5: Commit, push, open PR F** ("Run the ydoc server in Node, out of
      the engine"). Body: the host, the token, `ENSO_YDOC_HOST=engine` as the
      one-release rollback, the measurements, the packaged test runs in both
      modes. **Do not merge:** ask the owner for the installer test.

---

## PR G — Benchmarks with candidate JVM options (stage 1c, peak guard)

Branch `jvm/bench-jvm-options`. Label `CI: No changelog needed`. Read
`.github/CLAUDE.md` ("Checking a change").

### Task G1: `jvm-options` in `std-libs-benchmark.yml`

**Files:**

- Modify: `.github/workflows/std-libs-benchmark.yml` (input, two runs, two
  reports)

**Interfaces:**

- Produces: a hand dispatch with `bench-name` and `jvm-options` runs
  `std-benchmarks/benchOnly <bench-name>` twice in one job, first with the JVM
  defaults, then with the options appended to `std-benchmarks`' `javaOptions`
  (JMH forks inherit them, ruling 10), and uploads `bench-report-baseline.xml`
  and `bench-report-candidate.xml` as the artifact `benchmark-results`.

- [ ] **Step 1: Implement.** Add the input:

```yaml
jvm-options:
  description: >-
    JVM options to compare with the defaults (space-separated). When set, the
    benchmarks run twice in this job, without and then with them, and both
    reports are uploaded.
  required: false
  type: string
  default: ""
```

and replace the run step's script with:

```bash
task="std-benchmarks/bench"
if [ -n "$BENCH_NAME" ]; then task="std-benchmarks/benchOnly $BENCH_NAME"; fi
sbt "-Dbench.compileOnly=$JUST_CHECK" "-Dsbt.server.autostart=false" "$task"
if [ -n "$JVM_OPTIONS" ] && [ "$JUST_CHECK" != true ]; then
  mv std-bits/benchmarks/bench-report.xml std-bits/benchmarks/bench-report-baseline.xml
  opts=""
  for o in $JVM_OPTIONS; do opts="$opts\"$o\","; done
  sbt "-Dsbt.server.autostart=false" "set \`std-benchmarks\` / javaOptions ++= Seq(${opts%,})" "$task"
  mv std-bits/benchmarks/bench-report.xml std-bits/benchmarks/bench-report-candidate.xml
fi
```

with `JVM_OPTIONS: ${{ inputs.jvm-options }}` in the step's `env`, and the
upload's `path` listing `std-bits/benchmarks/bench-report*.xml`. Raise the job's
`timeout-minutes` from 240 to 300 and the step's from 150 to 280 only if a
`Table|Vector` run (Step 2) needs it (`.github/CLAUDE.md`: 1.5x headroom).

- [ ] **Step 2: Check** — `node tools/ci/check-workflows.mjs`,
      `node --test tools/ci/*.test.mjs`, actionlint. Push the branch and
      dispatch it once with `bench-name='Table|Vector'` and
      `jvm-options='-Dpolyglot.engine.Mode=latency'`; confirm both reports are
      uploaded and that both name Table and Vector benchmarks
      (`grep -c     '<label>' bench-report-*.xml` on the downloaded artifact;
      JMH's include is a regular expression). Record the job's duration.

- [ ] **Step 3: Commit, push, open PR G** ("Benchmarks: compare JVM options with
      the defaults in one job").

---

## M1 — Measure the JIT options (stage 1c, after PR F)

No PR. Needs PRs C, F, G merged. Numbers go to discussion #518.

### Task M1: Each option alone, then the best pair

**Candidates** (the spec's list; one string each for `open_perf_jvm_options`):

| Id  | Options                                                                |
| --- | ---------------------------------------------------------------------- |
| c0  | (none — the JVM defaults)                                              |
| c1  | `-Dpolyglot.engine.Mode=latency`                                       |
| c2  | `-Dpolyglot.engine.CompilerThreads=1`                                  |
| c3  | `-XX:CICompilerCount=2`                                                |
| c4  | `-XX:Tier4InvocationThreshold=20000 -XX:Tier4BackEdgeThreshold=160000` |
| c5  | the two of c1 to c4 with the lowest Windows median, together           |

(c4 is HotSpot's defaults, 5000 and 40000, raised 4x; check them first with
`<bundled java> -XX:+PrintFlagsFinal -version | grep Tier4` and scale what it
prints, if the defaults differ.)

- [ ] **Step 1: Dispatch** each of c0 to c4 three times on `develop` (protocol,
      `open_perf_engines=native,jvm`, `open_perf_template=welcome,image`,
      `open_perf_jvm_options` per candidate). The harness trains its AOT cache
      with the same options (PR C, Task C3).
- [ ] **Step 2: Record** for each candidate and dispatch: Windows and Linux
      `welcomeShown` and `libraryShown` first-open medians, native and jvm, and
      the ratio. A candidate's score is the median of its three Windows
      `welcomeShown` ratios.
- [ ] **Step 3: Pick the pair** (the two best of c1 to c4) and dispatch c5 three
      times.
- [ ] **Step 4: Peak guard.** For the candidate with the lowest Windows score
      (c1 to c5), dispatch `std-libs-benchmark.yml` with
      `bench-name='Table|Vector'` and its options. From the two reports, list
      each benchmark's baseline and candidate score and the change; the
      candidate passes when no benchmark is more than 5% worse. If it fails, try
      the next-best candidate. If none passes, ship no JIT options.
- [ ] **Step 5: Report** to discussion #518 (protocol): the candidate table
      (score, per-dispatch ratios, run ids), the peak-guard table, and the
      choice.

## PR H — The chosen JIT options (stage 1c)

Branch `jvm/jit-options`. Label `CI: No changelog needed` (only `--jvm` users
are affected before the switch). Skip this PR if M1 chose none, and say so on
#518.

### Task H1: Into `jvm.options`

**Files:**

- Modify: `distribution/engine/jvm.options`

- [ ] **Step 1: Add the chosen options** below the native-access line, under a
      comment naming M1's discussion comment URL and the peak-guard result.
- [ ] **Step 2: Measure** (protocol, per-PR, `native,jvm-nocache,jvm`; no
      `open_perf_jvm_options` this time — the file carries them) and check the
      result agrees with M1's within the noise.
- [ ] **Step 3: Commit, push, open PR H** ("jvm.options: JIT options for the
      open"), with the numbers and the link to M1's report.

---

## PR I — The per-user AOT cache (stage 1d)

Branch `jvm/aot-cache`. Label `CI: No changelog needed` (the cache trains only
when JVM is the resolved default, so nothing happens for users before the
switch). Depends on A, C, D. Read the shim's `CLAUDE.md` ("Child processes":
always an `'error'` listener on stdin; "Tests that start engines": a port band).

### Task I1: The key, the paths and the lock

**Files:**

- Create: `app/project-manager-shim/src/jvmAot/key.ts`
- Create: `app/project-manager-shim/src/jvmAot/lock.ts`
- Test: `app/project-manager-shim/src/jvmAot/__tests__/key.test.ts`,
  `lock.test.ts`

**Interfaces:**

- Produces:
  - `interface AotKeyInput { readonly appVersion: string; readonly engineRoot: string; readonly runtimeRoot: string; readonly jvmOptionsText: string }`
  - `aotKey(input: AotKeyInput): string` — the first 16 hex digits of SHA-256
    over the four fields joined by `\0`.
  - `interface EnginePaths { readonly engineRoot: string; readonly runtimeRoot: string }`
  - `enginePaths(ensoExecutable: string): Promise<EnginePaths | undefined>` —
    `engineRoot` = `realpath(dirname(dirname(ensoExecutable)))` (`dist/<ver>`);
    `runtimeRoot` = the one directory under `<engineRoot>/../../runtime/`;
    `undefined` when there is none (a dev build: no cache).
  - `readJvmOptionsText(engineRoot: string): Promise<string>` (`''` when
    missing).
  - `isTranslocated(engineRoot: string): boolean` — `/AppTranslocation/` in the
    path.
  - `acquireTrainingLock(root: string): Promise<(() => Promise<void>) | undefined>`
    — creates `<root>/train.lock` exclusively with this pid; takes over a lock
    whose pid is not alive (`process.kill(pid, 0)` throws `ESRCH`); returns the
    release function, or `undefined` when another live process holds it.

- [ ] **Step 1: Write the failing tests**

`key.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "vitest";
import { aotKey, enginePaths, isTranslocated } from "../key.js";

const base = {
  appVersion: "2026.2.0",
  engineRoot: "/a/dist/2026.2.0",
  runtimeRoot: "/a/runtime/g",
  jvmOptionsText: "-Dx=1\n",
};

test("the key is stable and moves with each input", () => {
  expect(aotKey(base)).toMatch(/^[0-9a-f]{16}$/);
  expect(aotKey({ ...base })).toBe(aotKey(base));
  for (const field of Object.keys(base) as (keyof typeof base)[]) {
    expect(aotKey({ ...base, [field]: base[field] + "x" })).not.toBe(
      aotKey(base),
    );
  }
});

test("enginePaths finds the engine root and the one runtime", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "aot-paths-")),
  );
  const bin = path.join(root, "enso", "dist", "1.0", "bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, "enso"), "");
  expect(await enginePaths(path.join(bin, "enso"))).toBeUndefined();
  await fs.mkdir(path.join(root, "enso", "runtime", "graalvm-x"), {
    recursive: true,
  });
  expect(await enginePaths(path.join(bin, "enso"))).toEqual({
    engineRoot: path.join(root, "enso", "dist", "1.0"),
    runtimeRoot: path.join(root, "enso", "runtime", "graalvm-x"),
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("isTranslocated", () => {
  expect(
    isTranslocated(
      "/private/var/folders/x/T/AppTranslocation/1234/d/Enso.app/Contents/Resources/enso/dist/1",
    ),
  ).toBe(true);
  expect(
    isTranslocated("/Applications/Enso.app/Contents/Resources/enso/dist/1"),
  ).toBe(false);
});
```

`lock.test.ts`:

```ts
test("one holder at a time; a dead holder is taken over", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aot-lock-"));
  const release = await acquireTrainingLock(root);
  expect(release).toBeDefined();
  expect(await acquireTrainingLock(root)).toBeUndefined();
  await release!();
  const again = await acquireTrainingLock(root);
  expect(again).toBeDefined();
  await again!();
  await fs.writeFile(path.join(root, "train.lock"), "999999");
  expect(await acquireTrainingLock(root)).toBeDefined();
  await fs.rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run them to see them fail** —
      `corepack pnpm --filter project-manager-shim exec vitest run src/jvmAot`.
- [ ] **Step 3: Implement** with `node:crypto`, `node:fs/promises`
      (`open(file, 'wx')`, `realpath`, `readdir`).
- [ ] **Step 4: Run them to see them pass**; commit: "Shim: the AOT cache's key,
      paths and training lock".

### Task I2: The headless training driver

**Files:**

- Create: `app/project-manager-shim/src/jvmAot/driver.ts`
- Test: `app/project-manager-shim/src/jvmAot/__tests__/driver.test.ts`

**Interfaces:**

- Consumes: the LS channel socket (PR D): `/channel/json` and
  `/channel/vis-control`, `/channel/vis-data` with the token; the `ws` package
  (add `"ws": "^8.21.3"` to the shim's dependencies).
- Produces:
  `driveOpen(options: { rpcPort: number; token: string; projectRoot: string; timeoutMs: number }): Promise<void>`
  — plays an IDE open:
  1. `session/initProtocolConnection` with a random `clientId`;
  2. `executionContext/create`, then `executionContext/push` with
     `{ type: 'ExplicitCall', methodPointer: { module: 'local.<Name>.Main', definedOnType: 'local.<Name>.Main', name: 'main' }, positionalArgumentsExpressions: [] }`
     (`<Name>` from `package.yaml` `name`);
  3. waits for the `executionContext/executionComplete` notification for that
     context;
  4. sends on `vis-control`
     `{ kind: 'attach', requestId: <uuid>, visualizationId: <uuid>, contextId, nodeExternalId: <welcome node>, request: { visualizationModule: 'Standard.Visualization.Table.Visualization', expression: { module: 'Standard.Visualization.Table.Visualization', definedOnType: 'Standard.Visualization.Table.Visualization', name: 'prepare_visualization' }, positionalArgumentsExpressions: ['1000'] } }`
     and waits for a `vis-data` frame or a `ready`/`failed` control message for
     that `requestId`. The welcome node is the id in `Main.enso`'s metadata
     whose `visualization.show` is `true` (ruling 12).
  - `welcomeNodeId(mainEnsoText: string): string | undefined` (exported for the
    test).
  - Throws on timeout or an `executionFailed`.

- [ ] **Step 1: Write the failing tests:** `welcomeNodeId` on the real template
      (`lib/scala/pkg/src/main/resources/default/src/Main.enso`, read from the
      repository root) gives `fcf199e6-d2b1-44b7-be92-a47545d6a593`; `driveOpen`
      against a fake LS (`WebSocketServer` on port 0 serving the three paths,
      checking the token, answering requests, emitting `executionComplete` 100
      ms after `push`, and a `vis-data` frame after `attach`) resolves, and
      sends exactly the four messages above in order; a fake that never
      completes makes it reject after `timeoutMs`.
- [ ] **Step 2: Run them to see them fail** —
      `corepack pnpm --filter project-manager-shim exec vitest run src/jvmAot/__tests__/driver.test.ts`.
- [ ] **Step 3: Implement** with JSON-RPC ids counting from 1 and one pending
      map; parse notifications by `method`.
- [ ] **Step 4: Run them to see them pass**; commit: "Shim: a headless driver
      that plays an IDE open for AOT training".

### Task I3: The trainer

**Files:**

- Create: `app/project-manager-shim/src/jvmAot/trainer.ts`
- Test: `app/project-manager-shim/src/jvmAot/__tests__/trainer.test.ts` (port
  band `JVM_AOT_TRAINER_PORT`)

**Interfaces:**

- Consumes: `driveOpen` (I2), `newChannelToken` (F1 — if PR F is not merged yet,
  move `newChannelToken` here and let F import it), `EnsoRunner`'s port search
  (expose `findServerPorts` as an exported function
  `findFreeServerPorts(startPort)` from `ensoRunner.ts` if it is private).
- Produces:
  - `interface Trainer { train(output: string, signal: AbortSignal): Promise<void> }`
  - `class EngineTrainer implements Trainer` with
    `constructor(options: { ensoExecutable: string; scratchRoot: string; firstPort?: number; startupTimeoutMs?: number; exitTimeoutMs?: number })`
    — defaults 180_000 and 300_000. `train`:
    1. deletes and recreates `scratchRoot`, runs
       `enso --new <scratchRoot>/Train --new-project-name Train` (native);
    2. finds ports, starts
       `enso --jvm --server --root-id <uuid> --project-id <uuid> --path <project> --interface 127.0.0.1 --rpc-port <port>`
       with `ENSO_JVM_OPTIONS=-XX:AOTCacheOutput=<output>.tmp`,
       `LANGUAGE_SERVER_CHANNEL_TOKEN=<token>`, no `LANGUAGE_SERVER_YDOC_PORT`,
       stdin piped (with an `'error'` listener), and lowers its priority
       (`os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL)`,
       ignoring a failure);
    3. polls `GET /_health` (25 ms for 1 s, then 250 ms) up to
       `startupTimeoutMs`;
    4. `driveOpen(...)`;
    5. writes `\n` to stdin and waits up to `exitTimeoutMs` for the exit;
    6. on exit code 0 and `<output>.tmp` present, renames it to `<output>`;
    7. on `signal` abort at any point: kills the engine, deletes `<output>.tmp`,
       and rejects with an `AbortError`;
    8. always deletes `scratchRoot` at the end.

- [ ] **Step 1: Write the failing tests** with a fake `enso` (as in A3) that:
      for `--new` creates the directory and a `package.yaml` with `name: Train`;
      for `--server` serves `/_health` and the channel paths (reuse the driver
      test's fake LS code by moving it to
      `jvmAot/__tests__/fakeLanguageServer.ts`), and on the stdin newline writes
      the file named in `ENSO_JVM_OPTIONS`'s `-XX:AOTCacheOutput=` and exits 0.
      Tests: a training writes `<output>` and removes the scratch directory; an
      abort during the drive kills the fake (its pid no longer alive), leaves no
      `<output>` and no `.tmp`; a fake that exits 1 rejects and leaves no
      `<output>`; the engine got `--jvm` and the env above.
- [ ] **Step 2: Run them to see them fail** —
      `corepack pnpm --filter project-manager-shim exec vitest run src/jvmAot/__tests__/trainer.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass**, 5 times; commit: "Shim: train a JDK
      AOT cache with an engine and the headless driver".

### Task I4: The cache manager: train at launch, yield to opens, use, invalidate

**Files:**

- Create: `app/project-manager-shim/src/jvmAot/index.ts`
- Modify: `app/project-manager-shim/package.json` (`"./jvmAot"` subpath export,
  as the others)
- Modify: `app/project-manager-shim/src/projectService/index.ts` (call it)
- Test: `app/project-manager-shim/src/jvmAot/__tests__/cache.test.ts`

**Interfaces:**

- Consumes: I1, I3, `resolveDefaultEngineMode` (A1), `EngineLaunch.jvmOptions`
  (A3).
- Produces:

```ts
export interface JvmAotCacheSettings {
  readonly rootDirectory: string; // <userData>/jvm-aot, or ENSO_JVM_AOT_DIR
  readonly appVersion: string;
  readonly ensoExecutable: string;
  readonly isJvmDefault: () => boolean; // resolveDefaultEngineMode(...).mode === 'jvm'
  readonly retrainDelayMs?: number; // 60_000
}
export class JvmAotCache {
  constructor(settings: JvmAotCacheSettings, trainer?: Trainer);
  /** At app launch: train when JVM is the default, there is no cache for the key, and no other window trains. */
  start(): Promise<void>;
  /** An open started: kill a running training (its files are deleted). */
  openStarted(): void;
  /** An open was answered: restart training retrainDelayMs after the last one, if still needed. */
  openAnswered(): void;
  /** The options for a JVM engine: AOTCache and the use log, or [] (no cache, translocated, dev build). */
  jvmOptions(): Promise<readonly string[]>;
  /** After an open: a use.log that names a mismatch deletes the cache (it retrains next launch). */
  checkUseLog(): Promise<void>;
  dispose(): Promise<void>;
  /** For tests and the harness: the current key's directory, once known. */
  keyDirectory(): Promise<string | undefined>;
}
```

- `jvmOptions()` returns
  `['-XX:AOTCache=<key>/enso.aot', '-Xlog:aot=warning,cds=warning:file="<key>/use.log"']`
  (two lines; ruling 2) when `<key>/enso.aot` exists.
- A successful training deletes every other directory under `rootDirectory`
  except `train.lock` (invalidation on upgrade: the new version's key differs).
- A mismatch in `use.log`: any line matching `/\[(error|warning)\]\[(aot|cds)/i`
  or `/mismatch|Unable to use|disabled/i` (the harness's `AOT_PROBLEM` pattern
  in `openTimeReport.ts`; move it to the shim and import it from there in the
  harness, so there is one copy).
- `ProjectService`: `EngineSettings` gains `jvmAot?: JvmAotCache`. `openProject`
  calls `openStarted()` before the engine starts and `openAnswered()` +
  `checkUseLog()` after it is answered (also after a failure); for a JVM launch
  it sets `launch.jvmOptions = await jvmAot.jvmOptions()`; `runProject` sets the
  same options for a JVM run.

- [ ] **Step 1: Write the failing tests** with a fake `Trainer` (resolves when
      told, honours the signal) and `vi.useFakeTimers()`. The core of the file:

```ts
class FakeTrainer implements Trainer {
  runs: { output: string; signal: AbortSignal; finish: () => Promise<void> }[] =
    [];
  train(output: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
      this.runs.push({
        output,
        signal,
        finish: async () => {
          await fs.mkdir(path.dirname(output), { recursive: true });
          await fs.writeFile(output, "cache");
          resolve();
        },
      });
    });
  }
}

/** A temp tree that `enginePaths` accepts: enso/dist/1.0/bin/enso, enso/runtime/g/, jvm.options. */
async function fakeBundle(): Promise<string> {
  /* as in key.test.ts */
}

test("trains at launch when the JVM is the default, and uses the cache after", async () => {
  const trainer = new FakeTrainer();
  const cache = new JvmAotCache(
    {
      rootDirectory: root,
      appVersion: "1",
      ensoExecutable: await fakeBundle(),
      isJvmDefault: () => true,
    },
    trainer,
  );
  await cache.start();
  expect(trainer.runs).toHaveLength(1);
  expect(await cache.jvmOptions()).toEqual([]);
  await trainer.runs[0]!.finish();
  await vi.waitFor(async () =>
    expect(await cache.jvmOptions()).toHaveLength(2),
  );
  const [aot, log] = await cache.jvmOptions();
  expect(aot).toMatch(/^-XX:AOTCache=.*enso\.aot$/);
  expect(log).toMatch(/^-Xlog:aot=warning,cds=warning:file=".*use\.log"$/);
});

test("no training when the default is native", async () => {
  const trainer = new FakeTrainer();
  await new JvmAotCache(
    {
      rootDirectory: root,
      appVersion: "1",
      ensoExecutable: await fakeBundle(),
      isJvmDefault: () => false,
    },
    trainer,
  ).start();
  expect(trainer.runs).toHaveLength(0);
});

test("an open kills the training; it restarts 60 s after the last answer", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const trainer = new FakeTrainer();
  const cache = new JvmAotCache(
    {
      rootDirectory: root,
      appVersion: "1",
      ensoExecutable: await fakeBundle(),
      isJvmDefault: () => true,
    },
    trainer,
  );
  await cache.start();
  cache.openStarted();
  expect(trainer.runs[0]!.signal.aborted).toBe(true);
  cache.openAnswered();
  await vi.advanceTimersByTimeAsync(30_000);
  cache.openStarted();
  cache.openAnswered();
  await vi.advanceTimersByTimeAsync(59_000);
  expect(trainer.runs).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(trainer.runs).toHaveLength(2);
});

test("a use.log naming a mismatch deletes the cache", async () => {
  /* train and finish as above, then: */
  const dir = (await cache.keyDirectory())!;
  await fs.writeFile(
    path.join(dir, "use.log"),
    "[0.012s][warning][aot] The AOT cache was created by a different version or build\n",
  );
  await cache.checkUseLog();
  expect(await cache.jvmOptions()).toEqual([]);
});

test("an info-only use.log keeps the cache", async () => {
  /* likewise with '[0.01s][info][aot] Opened AOT cache' */
});

test("a finished training deletes other keys' directories", async () => {
  await fs.mkdir(path.join(root, "oldkey"), { recursive: true });
  /* train and finish */
  await vi.waitFor(async () =>
    expect(await exists(path.join(root, "oldkey"))).toBe(false),
  );
});
```

and the remaining cases:

- `start()` trains when JVM is the default and no cache exists; not when the
  default is native; not when the cache exists; not when translocated; not when
  the lock is held by a live pid.
- `openStarted()` aborts the running training; `openAnswered()` restarts it
  after 60 s; a second open before the 60 s pushes the restart back to 60 s
  after that open's answer.
- `jvmOptions()` is `[]` without a cache and the two options with one; the
  use-log path is quoted.
- `checkUseLog()` deletes the cache on a mismatch line and keeps it for an empty
  log or `info` lines only.
- after a successful training, a directory of an older key is deleted.
- [ ] **Step 2: Run them to see them fail** —
      `corepack pnpm --filter project-manager-shim exec vitest run src/jvmAot/__tests__/cache.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the shim suite**; commit: "Shim: train the JDK AOT cache at
      launch, yield to opens, and use it for JVM engines".

### Task I5: Electron wiring, the real thing on both hosts, PR

**Files:**

- Modify: `app/electron-client/src/projectService.ts` (create and start the
  cache)
- Modify: `app/project-manager-shim/CLAUDE.md` (a "JDK AOT cache
  (`src/jvmAot/`)" section), `app/electron-client/CLAUDE.md`
  (`ENSO_JVM_AOT_DIR`)

- [ ] **Step 1: Wire it.** In `projectService.ts`, build
      `new JvmAotCache({ rootDirectory: process.env.ENSO_JVM_AOT_DIR ?? path.join(app.getPath('userData'), 'jvm-aot'), appVersion: app.getVersion(), ensoExecutable, isJvmDefault: () => resolveDefaultEngineMode({ option, environment: process.env.ENSO_ENGINE_MODE }).mode === 'jvm' })`,
      pass it in `EngineSettings`, call `start()` once the window is up, and
      `dispose()` on `before-quit`.
- [ ] **Step 2: Real training, Windows.** Build the installer (`ide-local`),
      start it with `ENSO_ENGINE_MODE=jvm` and stay on the dashboard. Record:
      the time from launch to `<userData>\jvm-aot\<key>\enso.aot`, its size, and
      that `train.lock` is gone after. Then open the welcome project and check
      `use.log` is empty and the engine log shows no AOT warning. Then open a
      project during a training and check the training's engine exits and its
      `.tmp` is gone. Repeat the size and time on Linux (an AppImage from CI's
      `ide-linux` artifact, in WSLg; PR J deals with the AppImage path — note
      here whether `use.log` reports a mismatch on the second launch).
- [ ] **Step 3: Measure** (protocol, per-PR): with `ENSO_ENGINE_MODE` the
      harness's `jvm` engine still builds its own cache until PR K, so the
      per-PR numbers here are taken by hand on this machine: 5 launches of the
      installer, first open of the welcome project, JVM with the shim's cache
      against JVM without (`ENSO_JVM_AOT_DIR` pointing at an empty directory),
      from the engine log's `Started server at json` and the welcome table. Say
      in the body that PR K moves this into the harness.
- [ ] **Step 4: Commit, push, open PR I** ("Shim: a per-user JDK AOT cache,
      trained in the background"). Body: the lifecycle, the size and training
      time on Windows and Linux, the numbers.

---

## PR J — The Linux AppImage path (stage 1d)

Branch `jvm/aot-appimage`. Label `CI: No changelog needed`. Depends on I.

### Task X1: The experiment

- [ ] **Step 1:** In WSLg with CI's AppImage (`ide-linux` artifact of a run of
      develop that includes PR I): run it with `ENSO_ENGINE_MODE=jvm`, wait for
      the cache, quit; run it again (a fresh `/tmp/.mount_*`), open the welcome
      project, and read `<userData>/jvm-aot/<key>/use.log`. Expected: a
      mismatch, since the module path changed (this is the problem).
- [ ] **Step 2:** Make the symlink by hand:
      `ln -sfn "$APPDIR/resources/enso" ~/.config/enso/engine/<version>`
      (`$APPDIR` from `/proc/<pid>/environ` of the running AppImage, or by
      extracting with `--appimage-extract` and pointing at that), start the
      engine through it
      (`ENSO_ENGINE_PATH=~/.config/enso/engine/<version>/dist/<version>/bin/enso`),
      train, remount, open, read `use.log`. Record whether the JVM accepted the
      cache.
- [ ] **Step 3:** If it did not, measure the extraction route: copy
      `dist/<version>/` and `runtime/` to `~/.config/enso/engine/<version>/`,
      record the size (`du -sh`) and the copy time, train, remount, open, read
      `use.log`.
- [ ] **Step 4:** Post the result (which route works, sizes, times) on #518 and
      in PR J's body.

### Task J1: The route the experiment chose

**Files:**

- Create: `app/project-manager-shim/src/jvmAot/stableEngine.ts`
- Modify: `app/electron-client/src/projectService.ts` (use it under
  `process.env.APPIMAGE`)
- Test: `app/project-manager-shim/src/jvmAot/__tests__/stableEngine.test.ts`

**Interfaces:**

- Produces:
  `stableEnginePath(options: { userData: string; version: string; bundleRoot: string; route: 'symlink' | 'extract' }): Promise<string>`
  — returns the `bin/enso` to run: for `symlink`, (re)creates
  `<userData>/engine/<version>` → `bundleRoot` and returns the path through it;
  for `extract`, copies `dist/` and `runtime/` once (a `.complete` marker file
  written last; an incomplete copy is deleted and redone), deletes other
  versions' directories, and returns the copy's `bin/enso`.

- [ ] **Step 1: Write the failing tests** on a temp tree for the route chosen
      (both if cheap): the path returned exists and resolves to the bundle's
      launcher; a second call reuses; a changed `bundleRoot` refreshes the link;
      for `extract`, an interrupted copy (no marker) is redone, an older
      version's directory is removed.
- [ ] **Step 2: Run them to see them fail; implement; run them to see them
      pass.**
- [ ] **Step 3: Wire it**: when `process.env.APPIMAGE` is set, the Electron side
      sets `ENSO_ENGINE_PATH` for the shim to the stable path before the project
      service is created (`findEnsoExecutable` honours it first). If neither
      route worked, do not wire anything: the AOT cache is then off on Linux
      AppImages (`JvmAotCache` returns no options when the engine root is under
      `/tmp/.mount_`), and Linux runs with CDS only — the spec's accepted
      fallback (~2 s per open, not gated). Write which in the shim's
      `CLAUDE.md`.
- [ ] **Step 4: Verify** with the experiment's Step 1 on the built AppImage: the
      second launch's `use.log` is empty.
- [ ] **Step 5: Commit, push, open PR J** ("Linux AppImage: a stable engine path
      for the AOT cache"), with the measurement (protocol, per-PR, Linux rows).

---

## PR K — The harness measures what users get (stage 2)

Branch `jvm/harness-stage2`. Label `CI: No changelog needed`. Depends on I (and
J for Linux). Read `app/electron-client/CLAUDE.md`, "Open-time harness".

### Task K1: `jvm` is the production path; `jvm-first`; the old cache goes

**Files:**

- Modify: `app/electron-client/perf/openTime.ts:620-690`
- Delete: `app/electron-client/perf/jvmAotCache.ts`
- Modify: `app/electron-client/perf/openTimeReport.ts:46` (`Engine`), the
  `jvmAot` report field
- Modify: `.github/workflows/ide-packaging.yml:33-38` (the `open_perf_engines`
  description)
- Test: `app/electron-client/tests/headless/openTimeReport.test.ts`

**Interfaces:**

- Produces:
  - `type Engine = 'native' | 'jvm' | 'jvm-first'` (ruling 11).
  - `jvm`: every launch gets `ENSO_ENGINE_MODE=jvm` and
    `ENSO_JVM_AOT_DIR=<out>/jvm-aot`; before the measured launches, one
    preparation launch idles on the dashboard until
    `<out>/jvm-aot/<key>/enso.aot` exists (poll every second, up to 10 minutes),
    recording `trainingMs` (launch to file) and `cacheBytes`. After each
    measured launch the harness checks the cache still exists; a cache the shim
    deleted (rejected) is a warning in the report.
  - `jvm-first`: the same variables, with `<out>/jvm-aot` deleted before each
    launch.
  - Report:
    `shimAot?: { trainingMs: number; cacheBytes: number; rejectedIn: readonly number[] }`
    replaces `jvmAot`; `open-time.md` prints it.

- [ ] **Step 1: Write the failing tests:**
      `parseEngines('native,jvm,jvm-first')` works and `jvm-nocache` is rejected
      with a message naming `jvm-first`; `renderMarkdown` prints the `shimAot`
      line.
- [ ] **Step 2: Run them to see them fail** —
      `corepack pnpm --filter enso exec vitest --run tests/headless/openTimeReport.test.ts`.
- [ ] **Step 3: Implement**, deleting `createJvmAotCache`, `runProjectOnJvm`,
      `measuredJvmToolOptions` and `LAUNCHER_JVM_OPTIONS`'s users (keep the
      `LAUNCHER_JVM_OPTIONS` drift test only if something still reads the
      constant; otherwise delete both). `--jvm-options` stays (sets
      `ENSO_JVM_OPTIONS`; the shim's training gets it through the inherited
      environment, since the shim appends to an inherited value).
- [ ] **Step 4: Run them to see them pass**; commit: "Open time: measure the JVM
      through the shim's own AOT cache; jvm-first".

### Task K2: RSS at `welcomeShown` and 30 s later

**Files:**

- Create: `app/electron-client/perf/processRss.ts`
- Modify: `app/electron-client/perf/openTime.ts` (sample on the first open)
- Modify: `app/electron-client/perf/openTimeReport.ts` (medians, markdown)
- Test: `app/electron-client/tests/headless/processRss.test.ts`

**Interfaces:**

- Produces:
  - `interface ProcessInfo { readonly pid: number; readonly ppid: number; readonly rssKb: number; readonly command: string }`
  - `listProcesses(): Promise<readonly ProcessInfo[]>` — Linux and macOS:
    `ps -axo pid=,ppid=,rss=,args=`; Windows:
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress"`
    (`WorkingSetSize` bytes / 1024).
  - `engineRssKb(processes, electronPid): number` — the sum over the descendants
    of `electronPid` whose executable's base name is `enso`, `enso.exe`, `java`
    or `java.exe`, and their descendants (ruling 14).
  - `processRssKb(processes, pid): number` — one process (the ydoc host, pid
    from the `ydoc host pid=` line).
  - Marks: `rss` with
    `{ phase: 'welcomeShown' | 'welcomeShown+30s', engineKb, ydocKb }`;
    `RunResult.rss?: { atWelcome: { engineKb: number; ydocKb: number }; after30s: { engineKb: number; ydocKb: number } }`.

- [ ] **Step 1: Write the failing tests** for `engineRssKb` and `processRssKb`
      on a hand-made process list (Electron → helper, Electron → `enso.exe` →
      `conhost.exe`, an unrelated `java`): the sum includes `enso.exe` and its
      child only. And for the report: the RSS medians row in `open-time.md`.
- [ ] **Step 2: Run them to see them fail; implement; run them to see them
      pass.** The harness waits 30 s after `welcomeShown` on the first open
      only, then takes the second sample.
- [ ] **Step 3: Commit**: "Open time: the engine's and the ydoc host's RSS".

### Task K3: The gate script

**Files:**

- Create: `app/electron-client/perf/gate.ts`
- Test: `app/electron-client/tests/headless/gate.test.ts`

**Interfaces:**

- Produces:
  - `dispatchRatio(report: OpenTimeReport, phase: 'welcomeShown' | 'libraryShown', engine: 'jvm' | 'jvm-first'): number | undefined`
    — median of the engine's first-open `phase` over median of native's, in one
    report.
  - `gateValue(ratios: readonly number[]): number` — their median.
  - `gateOutcome(welcome: number, library: number): 'pass' | 'owner decides' | 'fail'`
    — both ≤ 1.5 pass; either > 1.6 fail; otherwise "owner decides".
  - CLI: `corepack pnpm --filter enso exec vite-node perf/gate.ts -- <dir>...`
    where each `<dir>` is one dispatch's download
    (`<dir>/<os>/welcome/open-time.json`, `<dir>/<os>/image/open-time.json`),
    printing a markdown table per platform (per-dispatch ratios, gate value) and
    the outcome for Windows.

- [ ] **Step 1: Write the failing tests:** ratios from two small hand-made
      reports; `gateValue([1.4, 1.7, 1.5]) === 1.5`; the three outcomes at 1.5,
      1.55 and 1.61, and a mixed pair (1.4 welcome, 1.65 library → `fail`).
- [ ] **Step 2: Run them to see them fail; implement; run them to see them
      pass.**
- [ ] **Step 3: Docs.** `app/electron-client/CLAUDE.md`, "Open-time harness":
      the engines, `ENSO_JVM_AOT_DIR`, the RSS samples, the gate script; drop
      the paragraphs about `jvmAotCache.ts`.
- [ ] **Step 4: Verify** — the headless suite and a local
      `perf:open --engines native,jvm,jvm-first --runs 2 --out <scratch>/k` on
      Windows and in WSL (under `xvfb-run`), with a built installer.
- [ ] **Step 5: Commit, push, open PR K** ("Open time: measure the JVM users
      get, the first open, and RSS").

---

## M2 — Re-measure native against JVM (stage 2)

No PR. Needs every stage 1 PR merged (A to K; H skipped if M1 chose nothing),
and the GraalVM upgrade (P) for the gate run — see Step 6.

### Task M2: The measurement and the report

- [ ] **Step 1: Three dispatches on develop** (protocol),
      `open_perf_engines=native,jvm,jvm-first`,
      `open_perf_template=welcome,image`, `open_perf_runs=5`,
      `open_perf_budget=15`, `build_backend=true`. 15 launches per cell per
      platform.
- [ ] **Step 2: Gate numbers:**
      `corepack pnpm --filter enso exec vite-node perf/gate.ts -- <scratch>/m2/<id1> <scratch>/m2/<id2> <scratch>/m2/<id3>`.
- [ ] **Step 3: macOS** (owner-assisted: the self-hosted Mac): build the
      installer there and run
      `corepack pnpm --filter enso run perf:open --engines native,jvm --template welcome --runs 5 --out ~/m2-mac-welcome`
      and the same with `--template image`. Record the medians and ratios.
- [ ] **Step 4: Owner's machine:** on this Windows machine, an installer of the
      same develop commit,
      `corepack pnpm --filter enso run perf:open --engines native,jvm,jvm-first --template welcome --runs 10 --out <scratch>/m2-local-welcome`
      (and `image`), close every other IDE window first. Compare its ratio with
      the CI Windows ratio; a difference over 0.2 is called out.
- [ ] **Step 5: Mode switching:** open one project native → JVM → native
      (`ENSO_ENGINE_MODE` on three launches of the installer, the project's
      `package.yaml` untouched), with
      `ENSO_LOGSERVER_LOG_TO_FILE_LOG_LEVEL=debug`; in each session's log
      (`%LOCALAPPDATA%\enso\log\`), grep
      `Discarding the cache for|is corrupted on disk|failed to load`. Expected:
      no match. Do it on Linux too.
- [ ] **Step 6: The GraalVM that ships.** If the upgrade (P) merged after Step
      1, repeat Steps 1 and 2 on the upgraded develop: the gate is decided on
      the GraalVM that ships.
- [ ] **Step 7: Report** to discussion #518 (protocol), per platform: the
      first-open medians per phase per engine; the per-dispatch ratios and the
      gate value for `welcomeShown` and `libraryShown`; RSS (engine and ydoc, at
      `welcomeShown` and 30 s later, native against JVM); the AOT cache's size
      and training time; the `jvm-first` numbers; the macOS and owner's-machine
      runs; the mode-switching check; the GraalVM version. End with the gate
      outcome from the script. A Linux or macOS ratio worse than Windows' is
      traced (a debug-log open, as `app/electron-client/CLAUDE.md` describes)
      and the trace summarised before the report goes up.

---

## ⛔ Stage 3 gate — stop for the owner

- [ ] **Step 1:** Send the owner the report link and the outcome, and stop.
      Nothing in stage 3 starts until the owner answers.
  - **Pass** (both ≤ 1.5), and the GraalVM upgrade (P) is merged: the owner
    confirms, then PR L.
  - **About 1.5x** (1.5 to 1.6): the owner decides from the report.
  - **Fail** (either > 1.6): the spec's "If the gate fails" applies — stage 1
    stays, the default stays `native`, stage 5 does not start, and the next
    candidates (lazy stdlib module loading, fewer template imports) need their
    own measurement before another gate run. Nothing is reverted.

---

## PR L — The switch (stage 3)

Branch `jvm/default-jvm`. **Changelog entry and the owner's installer test
before merge.** Only after the gate passed (or the owner decided) and P is
merged.

### Task L1: The default, and both modes in CI

**Files:**

- Modify: `app/project-manager-shim/src/projectService/engineMode.ts`
  (`DEFAULT_ENGINE_MODE`)
- Modify:
  `app/project-manager-shim/src/projectService/__tests__/engineMode.test.ts`
- Modify: `.github/workflows/ide-packaging.yml:418-430` (a native run of the
  package tests), `:337-338` and `:335` (develop measures `jvm`, ruling 15)
- Modify: `CHANGELOG.md`
- Modify: `app/project-manager-shim/CLAUDE.md`, `app/electron-client/CLAUDE.md`

- [ ] **Step 1: The failing test.** Add to `engineMode.test.ts`:

```ts
test("the built-in default is the JVM", () => {
  expect(DEFAULT_ENGINE_MODE).toBe("jvm");
  expect(resolveDefaultEngineMode({})).toEqual({
    mode: "jvm",
    source: "default",
  });
});
```

Run
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/engineMode.test.ts`.
Expected: FAIL.

- [ ] **Step 2: The switch:**
      `export const DEFAULT_ENGINE_MODE: EngineMode = 'jvm'`. Run the shim
      suite. Expected: PASS (tests that assumed `native` from the default now
      name it explicitly).

- [ ] **Step 3: CI covers both modes.** After each "Run Package Tests" step in
      `ide-packaging.yml`, add one per OS:

```yaml
- if: matrix.os == 'linux'
  name: Run Package Tests (native engine)
  run:
    xvfb-run corepack pnpm -r --filter enso ide-integration-test
    tests/localWorkflow.spec.ts
  env:
    ENSO_ENGINE_MODE: native
    DEBUG: "pw:browser log:"
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

(and the Windows twin without `xvfb-run`). Change the open-time defaults so a
develop push measures `jvm`:
`OPEN_PERF_ENGINES: ${{ inputs.open_perf_engines || (inputs.open_perf_jvm && 'native,jvm' || 'jvm') }}`,
and give the default the JVM's timeouts (the `open_perf_jvm` values: 120 for the
job, 60 for the step), and update Note [Open Time In CI]. Run
`node tools/ci/check-workflows.mjs`, `node --test tools/ci/*.test.mjs`,
actionlint.

- [ ] **Step 4: Changelog** under `#### Enso IDE`:

```markdown
- [Projects now run on the JVM, which starts library code such as Image,
  Postgres and AWS faster; set `ENSO_ENGINE_MODE=native` or `jvm: false` in a
  project's `package.yaml` to go back][NNN]
```

- [ ] **Step 5: Docs.** Both `CLAUDE.md`s: the default is `jvm`; how to go back.

- [ ] **Step 6: The installer test.** Build the installer (`ide-local`) on
      Windows; open the welcome project and the `image` template project; check
      the engine log's first line says `Engine mode: jvm (default)`; set
      `ENSO_ENGINE_MODE=native`, relaunch, and check it says native. On Linux,
      the CI AppImage in WSLg, the same. Attach the two engine-log first lines
      to the PR.

- [ ] **Step 7: Commit, push, open PR L** ("The IDE's engine runs on the JVM by
      default"), with the gate report link and the owner's decision quoted. **Do
      not merge:** the owner's installer test decides.

---

## Stage 4 — The CLI stays native (no PR)

### Task S4: Check nothing changed for the CLI

- [ ] **Step 1:** On the built distribution of develop after PR L, on Windows
      and in WSL:

```bash
cd test && ../built-distribution/enso-engine-*/enso-*/bin/enso --version
cd test && JAVA_TOOL_OPTIONS= ../built-distribution/enso-engine-*/enso-*/bin/enso --run "$PWD/../lib/scala/pkg/src/main/resources/default"
```

Expected: `--version` reports the native runner (no JVM start), and the run
completes without starting HotSpot (`--jvm` and `jvm: true` still do). Record
the output in a comment on #518. If either changed, stop and report: stage 4 is
"no work" only while this holds.

---

## PR M — Delete the engine-hosted ydoc server (stage 1a follow-up)

Branch `jvm/remove-ydoc-polyglot`. Label `CI: No changelog needed`. Only after a
release has shipped with PR F (the one-release `ENSO_YDOC_HOST=engine` rollback)
and the owner has not asked for the rollback. It does not block the switch.

### Task M-1: Remove the code, the build and the switch

**Files:**

- Delete: `app/ydoc-server-polyglot/` (and its entry in `pnpm-workspace.yaml` if
  listed explicitly)
- Delete: `lib/java/ydoc-server/`, `lib/java/ydoc-polyfill/`,
  `lib/java/ydoc-server-registration/`
- Delete: `project/Ydoc.scala`
- Modify: `build.sbt` (the `ydoc-server`, `ydoc-polyfill`,
  `ydoc-server-registration` projects at `:1833-2010`, their entries at
  `:527-530`, `:667-670`, `:2297-2298`, `:2421-2440`, `:2492-2493`, the
  `engine-runner` dependency at `:4100` and `std-benchmarks`' at `:4670`
  (develop at b05a12d8ba; line numbers drift, so work from
  `grep -n "ydoc-server\|ydoc-polyfill\|ydoc-server-registration" build.sbt`);
  keep `ydoc-api`)
- Modify: `project/GraalVM.scala:25`, `:75` (the `-ydoc` launcher flag goes)
- Modify: `.github/workflows/engine-checks-platform.yml:131-138` (`-ydoc` goes
  from `ENSO_LAUNCHER`), `.github/workflows/ide-changed-files.yml:63-86` (Note
  [The Backend Reads The ydoc Server]: the ydoc packages are no longer backend
  inputs), `.github/CLAUDE.md` (the "App-only PRs" list)
- Modify: `engine/language-server/.../MainModule.scala` (the embedded ydoc block
  and `ydoc.port` go), `application-ls.conf`, `YdocConfig.scala`
- Modify: `app/project-manager-shim/src/projectService/ydocHost.ts` and
  `ensoRunner.ts` (`ENSO_YDOC_HOST` and the `engine` branch go; the ydoc wait
  goes with it)
- Modify: `lib/java/CLAUDE.md`, `app/CLAUDE.md`, `app/ydoc-server/CLAUDE.md`,
  `project/CLAUDE.md`, `engine/language-server/CLAUDE.md`

- [ ] **Step 1:**
      `git grep -n "ydoc-server-polyglot\|ydoc-polyfill\|ydoc-server-registration\|YdocServerImpl\|ENSO_YDOC_HOST\|LANGUAGE_SERVER_YDOC_PORT\|-ydoc"`
      and remove every hit's dependency on the deleted code (comments included).
      `lib/java/ydoc-api` stays.
- [ ] **Step 2:** The xxHash128 parity rule (#394) goes with `ydoc-polyfill`:
      remove its mention wherever the grep finds it.
- [ ] **Step 3:** Regenerate the third-party notices: `sbt gatherLicenses`,
      commit the `distribution/**/THIRD-PARTY/NOTICE` changes (not CI-checked,
      root `CLAUDE.md`).
- [ ] **Step 4:** `sbt compile "Test/compile"`, `sbt "language-server/test"`,
      `corepack pnpm -r compile`, the shim and ydoc-server suites, the workflow
      checks; `sbt buildEngineBundle` and check `component/` no longer has
      `org.enso.ydoc.server.*` (record the size saved). Linux too (WSL recipe).
- [ ] **Step 5: Commit, push, open PR M** ("Remove the engine-hosted ydoc
      server"). Body: what went, the bundle size saved, the NOTICE regeneration,
      and that this removes stage 5's ydoc blocker (`YdocServerImpl` and its
      `OtherJvmClassLoader` use).

---

## Stage 5 — Retire the guest JVM (its own plan)

### Task S5: The entry check, then a plan

- [ ] **Step 1: Check the entry conditions** (spec "It starts only when"), and
      record each with evidence on #518:
  1. The JVM default has shipped in a release and gone one full release cycle
     without being flipped back.
  2. No library needs native hosting in the IDE (true by construction under
     `--jvm`: `EnsoPolyglotJava.find`, `EnsoPolyglotJava.java:135-153`, and
     `isHostClassLoadingFor`'s non-AOT branch, `:170-178`). The native CLI's
     need is answered by requirement 2 below.
  3. #484 is closed as superseded.
  4. PR M is merged (`YdocServerImpl` and its `OtherJvmClassLoader` use are
     gone).
- [ ] **Step 2: Write stage 5's plan** with superpowers:writing-plans, from the
      spec's "What goes" and "What stays", with these requirements fixed by the
      owner:
  - **Owner's answer 2:** the native CLI switches to the JVM automatically, with
    a one-line notice, when a project uses a library whose Java is not in the
    native image (after the guest JVM is retired). The launcher decides this
    before it starts the guest path it no longer has (`Main.launch`,
    `Main.java:1611`), alongside `isJvmModeEnabled`.
  - The launcher's in-process JVM start (`JVM`, `PosixJVM`, `WindowsJVM`, the
    invocation subset of `JNI`) moves into `engine/runner`; it is not replaced
    by spawning `java`.
  - `EnsoLibraryFeature`, `markAotReady` and the `stdLibsJars` split stay
    (`build.sbt:3910-3930`).
  - Native-image removal is not part of it.

---

## Self-review

**Spec coverage.**

| Spec section                                 | Where                                  |
| -------------------------------------------- | -------------------------------------- |
| 1a (b): LS adaptor, token                    | PR D (D1, D2)                          |
| 1a (b): ydoc-server Node transport, buffers  | PR E (E1, E2, E3)                      |
| 1a (b): utilityProcess host, Vite host       | PR F (F2, F3)                          |
| 1a: `ENSO_YDOC_HOST` rollback, one release   | PR F (F1), PR M                        |
| 1a: follow-up deletions, NOTICE              | PR M                                   |
| 1a: #214 #396 #409 #494 re-tested            | E3 Step 4                              |
| 1b: CDS, `-Xshare:on` check                  | PR B                                   |
| 1c: `jvm.options`, `ENSO_JVM_OPTIONS`        | PR C (C1, C2)                          |
| 1c: native access line                       | C2                                     |
| 1c: harness `--jvm-options` → env            | C3                                     |
| 1c: JIT options measured after 1a, guard     | PR G, M1, PR H                         |
| 1d: key, location, training, yielding, lock  | PR I (I1–I4)                           |
| 1d: use, `use.log`, invalidation on upgrade  | I4                                     |
| 1d: AppImage symlink/extraction experiment   | X1, PR J                               |
| 1d: macOS translocation                      | I1 (`isTranslocated`), I4              |
| 1d: disk size on all platforms               | I5 Step 2, M2 Step 3/7                 |
| 1e: timeouts table, overrides, mode column   | A2, A3                                 |
| GraalVM upgrade order                        | Global Constraints, P, M2 Step 6, gate |
| 2: harness `jvm`, `jvm-first`, RSS           | PR K                                   |
| 2: dispatch inputs, 3 dispatches, macOS, own | M2                                     |
| 2: report contents to #518                   | M2 Step 7                              |
| 3: gate thresholds                           | K3, gate stop                          |
| 3: `resolveEngineMode` precedence            | A1, A4, A5                             |
| 3: mode → `--jvm`, timeouts, AOT; `--run`    | A3, A4, I4                             |
| 3: log panel first line                      | A4                                     |
| 3: the switch PR + changelog + installer     | PR L                                   |
| Testing: packaged tests both modes after 3   | L1 Step 3                              |
| Testing: Linux too                           | each PR's Linux step                   |
| Testing: mode switching, no cache refused    | M2 Step 5                              |
| 4: CLI stays native                          | S4                                     |
| 5: entry conditions, owner's answer 2        | S5                                     |
| Owner's answers 1 and 3                      | Global Constraints (no toggle; RSS)    |

**Placeholder scan.** `NNN` in the changelog entries is the PR number, known
only when the PR is opened (the repository's own convention). `<trailers>`,
`<branch>`, `<scratch>`, `<id>` are named in Global Constraints or the
measurement protocol. Tasks I2, I3, K2 and K3 give their test cases as precise
prose (inputs and expected results) rather than full code, because each is a
direct transcription of the interface block above it; the implementer writes
them test-first exactly as listed. Two choices are left to a measurement, by
design: which JIT options ship (M1) and which AppImage route (X1).

**Type consistency.** `EngineMode`, `ResolvedEngineMode`, `EngineTimeouts`,
`EngineLaunch` (A1–A3) are used unchanged in A4, F1, I4 and L1.
`YdocListenRequest` has the same shape in E3 and F1 (F2's type test). `Trainer`
(I3) is the parameter of `JvmAotCache` (I4). `Engine`
(`'native' | 'jvm' | 'jvm-first'`) in K1 is what K3's `dispatchRatio` takes.
`LANGUAGE_SERVER_CHANNEL_TOKEN`, `ENSO_YDOC_HOST`, `ENSO_ENGINE_MODE`,
`ENSO_JVM_OPTIONS`, `ENSO_JVM_AOT_DIR` are spelled the same everywhere.
