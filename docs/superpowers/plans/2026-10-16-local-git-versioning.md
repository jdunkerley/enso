# Local projects versioned with git: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version local projects as git commits at the local root folder: commit
on close and by hand, show a changed indicator, and serve the Versions tab for
local projects. Move labels into `package.yaml`, and remove the engine's unused
VCS.

**Architecture:** The git logic is a new `localVersioning` module in the
project-manager shim, running the user's git CLI and exposed as
`/api/project-service/versioning/*` JSON-RPC routes beside `localMetadata`'s.
`ProjectManager` and `LocalBackend` (in `enso-common`) are its client. The GUI
adds a provider, the save action and indicator, and the local Versions tab.

**Tech stack:** TypeScript (Node, Vue 3, vitest, Playwright), Scala (sbt,
ScalaTest), the git CLI.

**Spec:** `docs/superpowers/specs/2026-10-16-local-git-versioning-design.md`.
Read it first; this plan argues from it.

## Global constraints

- Commit messages, verbatim: `Saved` (Ctrl+S), `Saved on close`,
  `Saved before restore`, `Restored version from <date>`, where `<date>` is the
  version's ISO-8601 date.
- The fallback identity is `-c user.name=Enso -c user.email=noreply@enso.org`,
  used only when `git var GIT_AUTHOR_IDENT` fails. Never write the user's git
  config.
- The root `.gitignore` lines: `**/.enso/` and `*.bak`. An existing `.gitignore`
  is never overwritten; only a missing `**/.enso/` line is appended.
- Notes ref: `refs/notes/enso` (`git notes --ref=enso`).
- Every commit is path-scoped (`-- <project>`, or both paths for a move).
- Git failures never fail a close.
- Git runs without a shell, with `GIT_TERMINAL_PROMPT=0`, and serially per
  repository.
- Rust/TS/Scala house rules: `docs/style-guide/`, the `typescript-guidelines`
  skill, `app/project-manager-shim/CLAUDE.md`. Use `corepack pnpm`, not bare
  `pnpm`.
- Changelog: PRs 1, 2, 3 and 6 take the `CI: No changelog needed` label; PRs 4
  and 5 take an entry under `#### Enso IDE`.
- PRs 4 and 5 are features: they wait for the user's installer test before
  merging. PRs 1, 2, 3 and 6 merge on green.
- Before trusting a Playwright run in a reused worktree, run
  `corepack pnpm -r --if-present run compile` (stale workspace `dist/`).

## Rollout

| PR  | Branch                           | Stacked on    | Content                                           |
| --- | -------------------------------- | ------------- | ------------------------------------------------- |
| 1   | `feature/labels-in-package-yaml` | `develop`     | Engine `labels` field; shim reads/writes/migrates |
| 2   | `chore/remove-engine-vcs`        | `develop`     | Remove `vcsmanager`, its LSP methods, JGit        |
| 3   | `feature/local-versioning-shim`  | PR 1          | `localVersioning` module, routes, client, hooks   |
| 4   | `feature/local-versioning-save`  | PR 3          | GUI: save, indicator, init prompt                 |
| 5   | `feature/local-versions-tab`     | PR 3          | GUI: local Versions tab                           |
| 6   | `docs/local-versioning`          | after 4 and 5 | `CLAUDE.md` files; spec marked implemented        |

PRs 1 and 2 are independent and can run in parallel. PR 3 needs PR 1 only
because both edit `localMetadata`'s neighbours; if PR 1 merges first, PR 3 is
retargeted to `develop`. PRs 4 and 5 run in parallel after PR 3, and will
conflict in `localApi.ts` (union) and in this plan file.

This file details PRs 1–3. PRs 4–6 are outlined; each is detailed into this file
(its own `## PR N` section) when it starts, against PR 3's merged interfaces.

---

## PR 1: labels in `package.yaml`

### File structure

- Modify `lib/scala/pkg/src/main/scala/org/enso/pkg/Config.scala`: the `labels`
  field, its key, decoder and encoder.
- Modify `lib/scala/pkg/src/test/scala/org/enso/pkg/ConfigSpec.scala`.
- Modify
  `engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/StaticAnalysisTest.java:100-112`
  (the one Java `new Config(...)`, which cannot use a default argument).
- Create `app/project-manager-shim/src/localMetadata/packageYaml.ts`: read and
  write `labels` in `package.yaml`, keeping the rest of the document.
- Modify `app/project-manager-shim/src/localMetadata/index.ts`
  (`setProjectLabels`, the migration).
- Modify `app/project-manager-shim/src/handler/filesystem.ts:160-175` (where a
  listing reads a project's labels).
- Tests:
  `app/project-manager-shim/src/localMetadata/__tests__/packageYaml.test.ts`,
  `labels.test.ts`.

### Task 1: the engine keeps `labels` in `package.yaml`

**Files:** `Config.scala`, `ConfigSpec.scala`, `StaticAnalysisTest.java`.

**Interfaces:** Produces `Config.labels: List[String]` (default `Nil`), YAML key
`labels`, omitted when empty.

- [ ] **Step 1: Write the failing tests** in `ConfigSpec.scala`, inside
      `"Config" should { … }`:

```scala
    "keep labels through a round trip" in {
      val yaml =
        """name: example
          |namespace: local
          |labels:
          |  - finance
          |  - draft
          |""".stripMargin
      val config = Config.fromYaml(yaml).get
      config.labels shouldEqual List("finance", "draft")
      Config.fromYaml(config.toYaml()).get.labels shouldEqual List(
        "finance",
        "draft"
      )
    }

    "omit labels from the YAML when there are none" in {
      val config = Config.fromYaml("name: example\n").get
      config.labels shouldEqual Nil
      config.toYaml() should not include "labels"
    }

    "keep labels when another setting changes" in {
      val config = Config.fromYaml("name: example\nlabels:\n  - a\n").get
      val updated = config.copy(preferLocalLibraries = true)
      Config.fromYaml(updated.toYaml()).get.labels shouldEqual List("a")
    }
```

- [ ] **Step 2: Run them and watch them fail** (compile error: no `labels`).

```bash
sbt "pkg/testOnly org.enso.pkg.ConfigSpec"
```

- [ ] **Step 3: Implement.** In `Config.scala`:
  - add `* @param labels names of the labels the IDE shows on the project` to
    the Scaladoc;
  - append `labels: List[String] = Nil` as the case class's last parameter;
  - in `JsonFields` add `val Labels: String = "labels"`;
  - in `yamlDecoder` add, after `jvmMode`:

```scala
            labels <- clazzMap
              .get(JsonFields.Labels)
              .map(implicitly[YamlDecoder[List[String]]].decode)
              .getOrElse(Right(Nil))
```

    and pass `labels` as the last argument of `Config(…)`;

- in `encoderSnake` add, before `toMap(elements)`:

```scala
        if (value.labels.nonEmpty) {
          elements.add(
            (
              JsonFields.Labels,
              implicitly[YamlEncoder[List[String]]].encode(value.labels)
            )
          )
        }
```

    (If `YamlDecoder[List[String]]`/`YamlEncoder[List[String]]` are not in
    scope, they come from `org.enso.scala.yaml`; check how `List[Contact]` is
    derived there and import the same way.)

- In `StaticAnalysisTest.java`, add
  `, CollectionConverters.asScala(List.<String>of()).toList()` as the last
  argument of `new Config(…)`.

- [ ] **Step 4: Run the tests and the other compile sites.**

```bash
sbt "pkg/testOnly org.enso.pkg.ConfigSpec" "runtime-integration-tests/Test/compile" "language-server/compile"
```

Expected: PASS; both compiles succeed. Also run
`sbt "scalafmtCheckAll; javafmtCheckAll"`.

- [ ] **Step 5: Commit.** `Engine: keep a project's labels in package.yaml`.

### Task 2: the shim reads and writes labels in `package.yaml`

**Files:** create `localMetadata/packageYaml.ts` and its test.

**Interfaces:** Produces:

```ts
/** The `labels` list of the `package.yaml` in `projectPath`; `[]` when absent or malformed. */
export async function readPackageLabels(projectPath: string): Promise<string[]>;
/**
 * Replace the `labels` list in `projectPath`'s `package.yaml`, keeping every other key, its
 * order and comments. An empty list removes the key.
 * @throws {Error} when the file is missing or is not a YAML mapping.
 */
export async function writePackageLabels(
  projectPath: string,
  labels: readonly string[],
): Promise<void>;
```

- [ ] **Step 1: Write the failing tests** (`__tests__/packageYaml.test.ts`;
      reuse `testUtils.ts`'s temp-directory helper, as `labels.test.ts` does):

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { readPackageLabels, writePackageLabels } from "../packageYaml.js";
import { withTempDirectory } from "./testUtils.js";

const PACKAGE =
  "# A comment\nname: Example\nnamespace: local\nversion: 0.0.1\n";

async function project(dir: string, content = PACKAGE) {
  await fs.writeFile(path.join(dir, "package.yaml"), content);
  return dir;
}

describe("package.yaml labels", () => {
  test("a package without labels has none", () =>
    withTempDirectory(async (dir) => {
      expect(await readPackageLabels(await project(dir))).toEqual([]);
    }));

  test("writing labels keeps the other keys, their order and comments", () =>
    withTempDirectory(async (dir) => {
      await writePackageLabels(await project(dir), ["b", "a"]);
      const text = await fs.readFile(path.join(dir, "package.yaml"), "utf8");
      expect(text).toBe(`${PACKAGE}labels:\n  - b\n  - a\n`);
      expect(await readPackageLabels(dir)).toEqual(["b", "a"]);
    }));

  test("an empty list removes the key", () =>
    withTempDirectory(async (dir) => {
      await writePackageLabels(await project(dir), ["a"]);
      await writePackageLabels(dir, []);
      expect(await fs.readFile(path.join(dir, "package.yaml"), "utf8")).toBe(
        PACKAGE,
      );
    }));

  test("non-string labels are ignored on read", () =>
    withTempDirectory(async (dir) => {
      await project(dir, `${PACKAGE}labels:\n  - a\n  - 3\n`);
      expect(await readPackageLabels(dir)).toEqual(["a"]);
    }));

  test("writing to a missing package.yaml throws", () =>
    withTempDirectory(async (dir) => {
      await expect(writePackageLabels(dir, ["a"])).rejects.toThrow();
    }));
});
```

(If `testUtils.ts` names its helper differently, use its name; do not add a
second helper.)

- [ ] **Step 2: Run and watch them fail.**
      `corepack pnpm -C app/project-manager-shim exec vitest run src/localMetadata/__tests__/packageYaml.test.ts`

- [ ] **Step 3: Implement** `packageYaml.ts` with the `yaml` package's document
      API (`yaml.parseDocument`, `doc.get('labels')`, `doc.set('labels', …)`,
      `doc.delete('labels')`, `doc.toString()`), so the rest of the file
      round-trips. Write atomically with the module's existing
      `writeFileAtomic`-style helper from `jsonFile.ts` if one is exported for
      text; otherwise write to `package.yaml.tmp` and `fs.rename`. Reject a
      document whose contents are not a `YAMLMap`.

- [ ] **Step 4: Run the tests.** Expected: PASS. If the exact-text assertion
      differs only in how `yaml` indents sequences, set the document's
      `toString({ indentSeq: true })` option to match the engine's output
      (`  - a`) rather than loosening the test.

- [ ] **Step 5: Commit.**
      `Shim: read and write a project's labels in package.yaml`.

### Task 3: labels move from `project.json` to `package.yaml`

**Files:** `localMetadata/index.ts`, `handler/filesystem.ts`,
`localMetadata/__tests__/labels.test.ts`, and the filesystem listing test that
covers labels (find it with
`grep -rln "labels" app/project-manager-shim/src/**/__tests__`).

**Interfaces:** Consumes Task 2's functions. Produces:

```ts
/**
 * The project's label names, from `package.yaml`. Labels still in `.enso/project.json` (written
 * before labels moved) are moved into `package.yaml` first; when both have labels,
 * `package.yaml`'s win. `project.json` loses its `labels` either way.
 */
export async function readProjectLabels(projectPath: string): Promise<string[]>;
```

exported from `localMetadata/packageYaml.ts` and used by both
`LocalMetadata.setProjectLabels` and the filesystem listing.

- [ ] **Step 1: Write the failing tests** in `labels.test.ts`:

```ts
test("setProjectLabels writes package.yaml, not project.json", async () => {
  // Set up a project dir with package.yaml and .enso/project.json (as the file's other tests do).
  await store.setProjectLabels(projectPath, ["a"]);
  expect(await readPackageLabels(projectPath)).toEqual(["a"]);
  expect(
    JSON.parse(await fs.readFile(projectJsonPath, "utf8")),
  ).not.toHaveProperty("labels");
});

test("labels left in project.json move to package.yaml on read", async () => {
  await writeProjectJson({ id, kind: "UserProject", labels: ["old"] });
  expect(await readProjectLabels(projectPath)).toEqual(["old"]);
  expect(await readPackageLabels(projectPath)).toEqual(["old"]);
  expect(
    JSON.parse(await fs.readFile(projectJsonPath, "utf8")),
  ).not.toHaveProperty("labels");
});

test("package.yaml's labels win over project.json's", async () => {
  await writePackageLabels(projectPath, ["new"]);
  await writeProjectJson({ id, kind: "UserProject", labels: ["old"] });
  expect(await readProjectLabels(projectPath)).toEqual(["new"]);
  expect(
    JSON.parse(await fs.readFile(projectJsonPath, "utf8")),
  ).not.toHaveProperty("labels");
});
```

Use the existing fixtures' names for `projectPath`, `projectJsonPath`, and the
project-creating helper; add `writeProjectJson` only if no equivalent exists.
Update any existing test that asserts labels in `project.json`, so it asserts
them in `package.yaml`.

- [ ] **Step 2: Run and watch them fail.**
      `corepack pnpm -C app/project-manager-shim exec vitest run src/localMetadata`

- [ ] **Step 3: Implement.**
  - `readProjectLabels` in `packageYaml.ts`: read `project.json`; if it has a
    `labels` array, then if `readPackageLabels` is empty write those labels with
    `writePackageLabels`; in both cases rewrite `project.json` without `labels`
    (with `updateJsonFile` from `jsonFile.ts`). Return `readPackageLabels`.
  - `setProjectLabels`: keep `assertProjectDirectory` and the name resolution;
    replace the `updateJsonFile(projectJsonPath, …)` block with
    `await writePackageLabels(projectPath, labels)` followed by stripping
    `labels` from `project.json` if present. Update its doc comment and the
    class comment ("Each project's labels are an optional `labels: string[]` of
    label names in its `package.yaml`…").
  - `handler/filesystem.ts`: where labels are read from the project JSON (lines
    ~160-175), call `readProjectLabels(entryPath)` instead.

- [ ] **Step 4: Run the shim's whole suite and typecheck.**

```bash
corepack pnpm -C app/project-manager-shim exec vitest run
corepack pnpm -C app/project-manager-shim exec tsc --noEmit -p .
```

Expected: PASS.

- [ ] **Step 5: Commit.**
      `Shim: move project labels from project.json into package.yaml`.

### Task 4: the GUI still sees labels; docs; PR

**Files:** `app/project-manager-shim/CLAUDE.md`,
`app/gui/src/dashboard/components/labels/CLAUDE.md`, `app/common/CLAUDE.md`
(wherever they say labels live in `.enso/project.json`).

- [ ] **Step 1:** `grep -rn "project.json" --include=CLAUDE.md app` and update
      every statement about where labels are stored.
- [ ] **Step 2: Run the labels Playwright specs** (their mock
      `integration-test/mock/localApi.ts` does not read files, so they should
      pass unchanged; this checks nothing else assumed `project.json`):

```bash
corepack pnpm -r --if-present run compile
cd app/gui && NODE_ENV=production corepack pnpm exec playwright test integration-test/dashboard/localLabels.spec.ts integration-test/dashboard/labelsPopover.spec.ts --workers=2
```

- [ ] **Step 3: Commit, push, open the PR** with the `CI: No changelog needed`
      label. In the description, say which verifications ran (ConfigSpec,
      `Test/compile`, shim suite, the two specs) and that `gatherLicenses` and
      the full engine test suite were left to CI.

---

## PR 2: remove the engine's VCS

### File structure

Delete:

- `engine/language-server/src/main/scala/org/enso/languageserver/vcsmanager/`
  (all 9 files);
- `engine/language-server/src/main/scala/org/enso/languageserver/requesthandler/vcs/`
  (5 handlers);
- `engine/language-server/src/test/scala/org/enso/languageserver/vcsmanager/GitSpec.scala`;
- `engine/language-server/src/test/scala/org/enso/languageserver/websocket/json/VcsManagerTest.scala`.

Modify (remove VCS wiring only):

- `engine/language-server/src/main/scala/org/enso/languageserver/boot/MainModule.scala`
  (`VcsManagerConfig`, `Git.withEmptyUserConfig`, the VCS actor);
- `.../data/Config.scala` (`VcsManagerConfig` and the `vcsManager` field);
- `.../protocol/json/JsonConnectionController.scala`,
  `JsonConnectionControllerFactory.scala`, `JsonRpc.scala`;
- `.../text/BufferRegistry.scala` (its VCS messages);
- test bases: `boot/resource/RepoInitializationSpec.scala`,
  `filemanager/ContentRootManagerSpec.scala`,
  `runtime/ContextEventsListenerSpec.scala`,
  `search/SuggestionsHandlerSpec.scala`,
  `websocket/binary/BaseBinaryServerTest.scala`,
  `websocket/json/BaseServerTest.scala`, `websocket/json/FileManagerTest.scala`;
- `docs/language-server/protocol-language-server.md` (the `vcs/*` sections, the
  VCS types, and their table-of-contents entries);
- `app/ydoc-shared/src/languageServer.ts:372-395` and `languageServerTypes.ts`
  (the five wrappers and their types);
- `build.sbt`, `project/Dependencies.scala` (JGit, if unused elsewhere).

### Task 5: delete the VCS from the language server

- [ ] **Step 1: Baseline.** On a clean tree:
      `sbt "language-server/Test/compile"`; note that it passes.
- [ ] **Step 2: Delete** the directories and two test files above.
- [ ] **Step 3: Remove the wiring.** Compile
      (`sbt language-server/Test/compile`) and remove each reference the
      compiler reports, in the files listed above, until it compiles. Remove
      only VCS code: the `vcsManager` constructor parameters, the `vcs/*` method
      registrations in `JsonRpc`, the request-handler cases in
      `JsonConnectionController`, and the VCS notifications in `BufferRegistry`
      (check what `BufferRegistry` does with them first; if it reloads buffers
      after `vcs/restore`, the whole branch goes).
- [ ] **Step 4: Verify** nothing else names the VCS:

```bash
git grep -n -i "vcsmanager\|VcsManager\|VcsApi\|vcs/init\|vcs/save\|vcs/status\|vcs/restore\|vcs/list\|\.vcs\b" -- engine lib
```

Expected: no output.

- [ ] **Step 5: Run the language-server tests** that touched the VCS bases:

```bash
sbt "language-server/testOnly org.enso.languageserver.websocket.json.FileManagerTest org.enso.languageserver.filemanager.ContentRootManagerSpec org.enso.languageserver.boot.resource.RepoInitializationSpec"
```

Expected: PASS.

- [ ] **Step 6: Commit.**
      `Language server: remove the unused VCS manager and its vcs/* methods`.

### Task 6: drop JGit, the protocol docs and the TS wrappers

- [ ] **Step 1: Find JGit's other users.**

```bash
git grep -n "org.eclipse.jgit" -- '*.scala' '*.java' build.sbt project
```

If only `build.sbt`/`Dependencies.scala` remain, remove JGit from all three
projects in `build.sbt` (lines ~497, ~2181, ~2196), from the module list at
~3973, and `jgitVersion` from `Dependencies.scala`. If another project's code
imports `org.eclipse.jgit`, remove it only from `language-server`'s
dependencies, and say so in the PR.

- [ ] **Step 2:** Delete the `vcs/*` sections from
      `docs/language-server/protocol-language-server.md` and its contents
      entries; delete `vcsInit`, `vcsSave`, `vcsStatus`, `vcsRestore`, `vcsList`
      and their types from `app/ydoc-shared`. Confirm nothing in `app/` uses
      them: `git grep -n "vcs[A-Z]" -- app` is empty.
- [ ] **Step 3: Verify more than compile** (root `CLAUDE.md`):

```bash
sbt "language-server/Test/compile" "runtime-integration-tests/Test/compile" gatherLicenses buildEngineDistribution
sbt "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck"
corepack pnpm -C app/ydoc-shared exec tsc --noEmit -p .
```

Check the logs for `[JPMSUtils/...] Not all modules ... were found`. If JGit
left the legal-review report, commit the regenerated report and
`distribution/**/THIRD-PARTY/NOTICE` changes.

- [ ] **Step 4: Commit, push, open the PR** with `CI: No changelog needed`. The
      description lists what was verified and what was left to CI (the full
      engine test suite, native image).

---

## PR 3: the shim's `localVersioning` module

### File structure

- Create `app/project-manager-shim/src/childProcess/runCommand.ts`: the spawn
  helper (extracted from `ensoRunner.ts`, generalised to return stdout).
- Create `app/project-manager-shim/src/localVersioning/`:
  - `git.ts` — finding git, running it in a repository, the per-repository
    queue, identity fallback;
  - `index.ts` — the `LocalVersioning` class (status, init, commit, log, fileAt,
    restore, duplicateAt, setComment, commitMove);
  - `__tests__/git.test.ts`, `__tests__/localVersioning.test.ts`,
    `__tests__/testRepo.ts`.
- Modify `app/project-manager-shim/package.json` (export `./localVersioning`).
- Modify `app/project-manager-shim/src/handler/projectService.ts` (routes).
- Modify `app/project-manager-shim/src/projectService/ensoRunner.ts` (the
  `'version-on-close'` hook type; use the extracted helper) and
  `projectService/index.ts` (register the hook on open; move commits).
- Modify `app/electron-client/src/projectService.ts`, `server.ts`, and
  `app/gui/project-manager-shim-middleware/index.ts` (construct and pass a
  `LocalVersioning`).
- Modify `app/common/src/services/ProjectManager/ProjectManager.ts` (client
  methods) and `types.ts` beside it.
- Modify `app/project-manager-shim/CLAUDE.md`.

### Task 7: a reusable `runCommand`

**Interfaces:** Produces:

```ts
/** The result of a finished command. */
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}
/** A command that exited with a non-zero code. */
export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stdout: string,
    readonly stderr: string,
  )
}
/**
 * Run `command` with `args` (no shell) and collect its output.
 * @throws {CommandError} when it exits non-zero; an `Error` when it cannot be spawned.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly input?: string },
): Promise<CommandResult>
```

- [ ] **Step 1: Failing tests**
      (`src/childProcess/__tests__/runCommand.test.ts`), using
      `process.execPath` (node) as a portable command:

```ts
test("collects stdout", async () => {
  const { stdout } = await runCommand(process.execPath, [
    "-e",
    'process.stdout.write("hi")',
  ]);
  expect(stdout).toBe("hi");
});
test("a non-zero exit throws a CommandError with the output", async () => {
  const error = await runCommand(process.execPath, [
    "-e",
    'console.error("bad"); process.exit(3)',
  ]).catch((e) => e);
  expect(error).toBeInstanceOf(CommandError);
  expect(error.code).toBe(3);
  expect(error.stderr).toContain("bad");
});
test("input is written to stdin", async () => {
  const { stdout } = await runCommand(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { input: "x" },
  );
  expect(stdout).toBe("x");
});
test("a missing command rejects", async () => {
  await expect(
    runCommand("definitely-not-a-command-xyz", []),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Watch them fail. Step 3: Implement** with
      `childProcess.spawn(command, args, { cwd, env, shell: false, windowsHide: true })`.
      Then make `ensoRunner.ts`'s private `runCommand` delegate to it (keeping
      its `.bat`/`cmd.exe` handling in `runProcess`, and its error message shape
      for existing callers). **Step 4:** shim suite passes. **Step 5: Commit.**
      `Shim: a shared runCommand helper`.

### Task 8: running git (`git.ts`)

**Interfaces:** Produces:

```ts
/** The git executable, or `null` when git is not installed. Found once and cached. */
export function findGit(): Promise<string | null>;
/** For tests: forget the cached result. */
export function resetGitCache(): void;
/**
 * Run git in `cwd` after every earlier call queued for the same `queueKey` (a repository root)
 * has finished. Adds `GIT_TERMINAL_PROMPT=0` and `-c core.quotepath=false`.
 * @throws {GitUnavailableError} when git is not installed; {@link CommandError} on failure.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  options?: {
    readonly queueKey?: string;
    readonly input?: string;
    /** Extra environment variables, e.g. `GIT_INDEX_FILE`. */
    readonly env?: Readonly<Record<string, string>>;
  },
): Promise<string>;
/** The repository containing `dir` (its `--show-toplevel`), or `null`. */
export function findRepoRoot(dir: string): Promise<string | null>;
/** `-c` arguments for the fallback identity, or `[]` when the user has an identity in `repoRoot`. */
export function identityArgs(repoRoot: string): Promise<readonly string[]>;
export class GitUnavailableError extends Error {}
```

- [ ] **Step 1: Failing tests** (`__tests__/git.test.ts`). Create
      `__tests__/testRepo.ts` with:

```ts
/** A fresh temporary directory, removed after `body`. `git init` it when `init` is true. */
export async function withTempRepo<T>(
  body: (dir: string) => Promise<T>,
  options?: { init?: boolean },
): Promise<T>;
/** Write `files` (relative path → content) under `dir`, creating directories. */
export async function writeFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void>;
```

Tests set `GIT_CONFIG_GLOBAL` to an empty temp file and `GIT_CONFIG_NOSYSTEM=1`
(in `beforeEach`, restored in `afterEach`) so the developer's own config does
not leak in. Cases:

- `findGit` returns a path on a machine with git (CI has it);
- `findRepoRoot` is `null` outside a repository and the root inside one,
  including from a subdirectory (compare with `fs.realpath`, because macOS temp
  dirs are symlinks);
- `identityArgs` returns the fallback with no identity configured, and `[]`
  after `git config user.name A` and `user.email a@b.c` in that repository;
- `runGit` serialises: mock `runCommand`
  (`vi.mock('../../childProcess/runCommand.js')`) so the first call resolves
  only when the test releases a deferred; start two `runGit` calls on the same
  `queueKey`, assert the mock was called once, release the first, await both,
  and assert the second call started only after the first resolved. Two calls on
  different `queueKey`s both start at once.

- [ ] **Step 2: Watch them fail. Step 3: Implement.** `findGit` runs
      `git --version` via `runCommand('git', …)` and caches the outcome (`'git'`
      or `null`). `runGit` keeps a `Map<string, Promise<unknown>>` of queue
      tails. `identityArgs` runs `git var GIT_AUTHOR_IDENT` and returns
      `['-c', 'user.name=Enso', '-c', 'user.email=noreply@enso.org']` if it
      throws. **Step 4:** passes. **Step 5: Commit.**
      `Shim: run git serially per repository`.

### Task 9: `LocalVersioning` status, init and commit

**Interfaces:** Produces (in `localVersioning/index.ts`):

```ts
export interface VersionSummary {
  readonly id: string;
  /** ISO-8601, the commit's committer date. */
  readonly date: string;
}
export interface VersioningStatus {
  readonly git: boolean;
  readonly repoRoot: string | null;
  readonly changed: boolean;
  readonly lastVersion: VersionSummary | null;
  /** Git's message when the repository cannot be used (mid-merge, locked, …). */
  readonly blocked: string | null;
}
export const ENSO_IGNORE_LINES: readonly string[] = ["**/.enso/", "*.bak"];
export class LocalVersioning {
  status(projectPath: string): Promise<VersioningStatus>;
  /** `git init` in `rootPath`, and the root `.gitignore`. Returns the repository root. */
  init(rootPath: string): Promise<{ readonly repoRoot: string }>;
  /** Commit everything under `paths` (all in one repository). `null` when nothing changed. */
  commit(
    paths: readonly string[],
    message: string,
  ): Promise<{ readonly id: string | null }>;
}
```

- [ ] **Step 1: Failing tests** (`__tests__/localVersioning.test.ts`), each in
      `withTempRepo`, with two projects `A/` and `B/` (each `package.yaml`,
      `src/Main.enso`, `.enso/project.json`):
  - `status` without git (`vi.mock` `findGit` → `null`):
    `{ git: false, repoRoot: null, changed: false, lastVersion: null, blocked: null }`;
  - `status` outside a repository: `git: true, repoRoot: null`;
  - after `init`: `.gitignore` is exactly `**/.enso/\n*.bak\n`, and `A` is
    `changed: true`, `lastVersion: null`;
  - `init` with an existing `.gitignore` of `node_modules/\n`: it becomes
    `node_modules/\n**/.enso/\n*.bak\n`; with one already ignoring `**/.enso/`,
    it is untouched;
  - `commit(['<root>/A'], 'Saved')`: returns an id; `A` is then `changed: false`
    with `lastVersion.id` equal to it; `B` is still `changed: true` and
    `git show --stat <id>` lists no `B/` file;
  - committing again with nothing changed returns `{ id: null }`;
  - `.enso/` changes never make a project changed;
  - with no identity configured the commit's author is
    `Enso <noreply@enso.org>`;
  - a repository mid-merge (`git merge` of two branches that conflict in
    `A/src/Main.enso`): `status(A).blocked` is a non-empty string, and `commit`
    rejects.

- [ ] **Step 2: Watch them fail. Step 3: Implement.**
  - `status`: `findGit`; `findRepoRoot(projectPath)`;
    `git status --porcelain=v1 --untracked-files=all -- <rel>` → `changed`;
    `git log -1 --format=%H%x00%cI -- <rel>` → `lastVersion`; `blocked` when
    `.git/MERGE_HEAD`, `.git/rebase-merge` or `.git/rebase-apply` exists
    (`git rev-parse --git-path MERGE_HEAD` etc.), or when a git call fails with
    `index.lock` in its stderr. Paths given to git are relative to the
    repository root, with `/` separators.
  - `init`: `git init` in `rootPath`, then the `.gitignore` rule from the global
    constraints.
  - `commit`: refuse when `blocked`; `git add -A -- <rels…>`; if
    `git diff --cached --quiet -- <rels…>` exits 0, return `{ id: null }`; else
    `git <identityArgs> commit -m <message> -- <rels…>` and return
    `git rev-parse HEAD`.

- [ ] **Step 4:** passes. **Step 5: Commit.**
      `Shim: version status, init and commit`.

### Task 10: log, fileAt, setComment

**Interfaces:** Produces, on `LocalVersioning`:

```ts
export interface VersionEntry extends VersionSummary {
  readonly author: { readonly name: string; readonly email: string }
  /** The version's `refs/notes/enso` note if it has one, else its commit message. */
  readonly comment: string
  readonly isLatest: boolean
}
log(projectPath: string): Promise<readonly VersionEntry[]>
/** The text of `relativePath` (relative to the project) at version `id`. */
fileAt(projectPath: string, id: string, relativePath: string): Promise<string>
setComment(projectPath: string, id: string, comment: string): Promise<void>
```

- [ ] **Step 1: Failing tests:** three commits of `A` with messages
      `one`/`two`/`three` interleaved with a `B` commit: `log(A)` returns three
      entries newest first, only the first `isLatest`, comments
      `three`/`two`/`one`; after `setComment(A, <two's id>, 'Edited')`, its
      comment is `Edited` and the others are unchanged;
      `fileAt(A, <one's id>,     'src/Main.enso')` is the first content;
      `fileAt` of a missing file rejects.
- [ ] **Step 2: Watch them fail. Step 3: Implement** `log` with
      `git log --format=%H%x00%cI%x00%an%x00%ae%x00%B%x1e -- <rel>` (split on
      `\x1e` then `\x00`, trim the message), and one `git notes --ref=enso list`
      to map commit → note blob, reading each note with
      `git notes --ref=enso show <id>`. `fileAt`:
      `git show <id>:<rel>/<relativePath>`. `setComment`:
      `git notes --ref=enso add -f -m <comment> <id>`.
- [ ] **Step 4:** passes. **Step 5: Commit.**
      `Shim: version log, file contents and comments`.

### Task 11: restore and duplicateAt

**Interfaces:** Produces, on `LocalVersioning`:

```ts
/** Restore the project to version `id`. The project must be closed. Returns the new version's id. */
restore(projectPath: string, id: string): Promise<{ readonly id: string }>
/**
 * Write the project as it was at version `id` into a new directory `targetPath` (which must not
 * exist). The caller gives it a new project id and name.
 */
exportAt(projectPath: string, id: string, targetPath: string): Promise<void>
```

`duplicateAt` (the route) is `exportAt` followed by the shim's existing
duplicate post-processing (new id in `.enso/project.json`, name in
`package.yaml`); find that in `projectService/index.ts`'s duplicate code and
reuse it, extracting a function if it is inline.

- [ ] **Step 1: Failing tests:** version 1 of `A` has `src/Main.enso` = `v1` and
      `data/x.csv`; version 2 changes `Main.enso` to `v2`, deletes `data/x.csv`,
      adds `data/y.csv`; then an uncommitted edit `v3`. `restore(A, v1)`: the
      log gains `Saved before restore` (holding `v3`) then
      `Restored version from <v1's date>`; on disk `Main.enso` is `v1`, `x.csv`
      exists, `y.csv` does not; `B` is untouched.
      `exportAt(A, v1,     <tmp>/A-copy)`: `A-copy/src/Main.enso` is `v1`,
      `A-copy/data/x.csv` exists, and `.enso/` is absent (ignored files are not
      in the tree).
- [ ] **Step 2: Watch them fail. Step 3: Implement** `restore` per the spec:
      `commit([project], 'Saved before restore')`;
      `git restore --source=<id> --staged --worktree -- <rel>`;
      `commit([project], 'Restored version from <date>')`. `exportAt` uses a
      throwaway index, so neither the repository's index nor its work tree is
      touched: with `env: { GIT_INDEX_FILE: <tmpDir>/index }`, run
      `git read-tree <id>:<rel>` then
      `git --work-tree=<targetPath> checkout-index --all --force` (`targetPath`
      created first with `fs.mkdir`, and `<tmpDir>` removed in a `finally`).
      Reject if `targetPath` already exists.
- [ ] **Step 4:** passes. **Step 5: Commit.**
      `Shim: restore and export a project version`.

### Task 12: routes and the client

**Interfaces:** Consumes Tasks 9–11. Produces routes, in
`handler/projectService.ts`, served like `LOCAL_METADATA_ROUTES` (same error
shape, `'Local versioning is not available in this host.'` when absent):

| Route                     | Body                              | Handler                                         |
| ------------------------- | --------------------------------- | ----------------------------------------------- |
| `versioning/status`       | `{ path }`                        | `status(path)`                                  |
| `versioning/init`         | `{ rootPath }`                    | `init(rootPath)`                                |
| `versioning/commit`       | `{ path, message }`               | `commit([path], message)`                       |
| `versioning/log`          | `{ path }`                        | `{ versions: log(path) }`                       |
| `versioning/file-at`      | `{ path, id, relativePath }`      | `fileAt(…)`                                     |
| `versioning/restore`      | `{ path, id }`                    | `restore(…)`; refuses if the project is running |
| `versioning/duplicate-at` | `{ path, id, title, parentPath }` | `exportAt` + duplicate post-processing          |
| `versioning/set-comment`  | `{ path, id, comment }`           | `setComment(…)`                                 |

and `ProjectManager` client methods
(`app/common/src/services/ProjectManager/ProjectManager.ts`, types in
`types.ts`):

```ts
versioningStatus(path: Path): Promise<VersioningStatus>
initVersioning(rootPath: Path): Promise<{ readonly repoRoot: Path }>
commitVersion(path: Path, message: string): Promise<{ readonly id: string | null }>
listVersions(path: Path): Promise<{ readonly versions: readonly VersionEntry[] }>
versionFileContent(path: Path, id: string, relativePath: string): Promise<string>
restoreVersion(path: Path, id: string): Promise<{ readonly id: string }>
duplicateVersion(path: Path, id: string, title: string, parentPath: Path): Promise<DuplicatedProject>
setVersionComment(path: Path, id: string, comment: string): Promise<void>
```

(`VersioningStatus` and `VersionEntry` are re-declared in `types.ts` with `Path`
for paths; the shim and `enso-common` do not import each other's types.)

- [ ] **Step 1: Failing tests:** a handler test per route in the style of the
      existing `localMetadata` route tests (find them with
      `grep -rln "labels/list" app/project-manager-shim/src`): a `status` round
      trip, a missing `path` giving `'path' must be a string.`, and the
      unavailable-host error. Client tests in
      `app/common/src/services/__test__/` in the style of the Recent client
      tests (`LocalBackend.recent.test.ts` mocks `fetch`): each method posts to
      its route with its body.
- [ ] **Step 2: Watch them fail. Step 3: Implement.** Generalise
      `handleLocalMetadataRequest` into a handler taking the store, so both
      route tables share it. Export `./localVersioning` from the shim's
      `package.json` (copy the `./localMetadata` entry's shape). Construct one
      `LocalVersioning` in `electron-client/src/projectService.ts` (beside
      `getLocalMetadata`) and in the dev middleware, and pass it to
      `handleProjectServiceRequest`.
- [ ] **Step 4:** shim, common and electron-client typecheck and tests pass:

```bash
corepack pnpm -C app/project-manager-shim exec vitest run
corepack pnpm -C app/common exec vitest run
corepack pnpm -r --filter enso --filter project-manager-shim --filter enso-common exec tsc --noEmit -p .
```

(Use each package's own `typecheck` script if it has one.)

- [ ] **Step 5: Commit.**
      `Shim: versioning routes, and their ProjectManager client`.

### Task 13: commit on close, and on moves

**Interfaces:** Consumes `LocalVersioning.commit`. Produces the
`'version-on-close'` shutdown hook and move commits.

- [ ] **Step 1: Failing tests** in the shim's project-service tests (find the
      file testing `rename-project-directory`):
  - opening then closing a project inside a repository leaves a `Saved on close`
    commit touching only that project (use the existing fake runner the tests
    use for `EnsoRunner`, so no engine starts);
  - closing a project outside any repository creates no repository and succeeds;
  - a `commit` that throws is logged, the close still resolves, and its result
    carries `versioningWarning` with the error's message;
  - renaming an open project, then closing it: the last commit includes both the
    old path's removal and the new path's files.
- [ ] **Step 2: Watch them fail. Step 3: Implement.**
  - Add `'version-on-close': true` to `ShutdownHookRegistry`.
  - `ProjectService` takes an optional `versioning?: LocalVersioning`
    (constructor and `ProjectService.default`, beside `lifecycle`). In
    `openProject`, after the runner reports the project running, register
    `'version-on-close'` → `versioning.commit([projectPath], 'Saved on close')`,
    catching and logging errors. A caught error's message is kept and returned
    by `closeProject` as an optional `versioningWarning: string` on the close
    result (add the field to the shim's close result and to `ProjectManager`'s
    `closeProject` return type), so PR 4 can show it as a warning toast.
    Register it **before** any rename hook, so it runs first (the hooks map
    keeps insertion order).
  - In the `rename-project-directory` hook, after the directory move, call
    `versioning.commit([oldPath, newPath], 'Saved on close')` when both are in
    the same repository (`findRepoRoot`). In `filesystem-move` of a project
    directory, do the same with message `Moved <old name> to <new path>`. Errors
    are logged, never thrown.
- [ ] **Step 4:** passes. **Step 5: Commit.**
      `Shim: commit a version when a project closes or moves`.

### Task 14: docs and PR

- [ ] Add a `localVersioning` section to `app/project-manager-shim/CLAUDE.md`:
      the module, its routes, the serial queue, the identity fallback, the
      ignore lines, notes ref, and the close hook's ordering.
- [ ] Run the whole shim, common and GUI unit suites and typechecks once more.
- [ ] Commit, push, open the PR (base: PR 1's branch, or `develop` if PR 1 has
      merged) with `CI: No changelog needed`.

### Task 15: consent before versioning an existing repository

Added after the whole-branch review, on the decision "Ask first": `findRepoRoot`
finds any enclosing repository, so a home-folder dotfiles repository or a work
monorepo above the projects folder would get "Saved on close" commits unasked.

- [x] `localVersioning/consent.ts`: `VersioningConsent`
      (`isEnabled`/`enable`/`disable`), persisted in
      `<userData>/versioning.json` through the `jsonFile.ts` helpers; compared
      by real path (lowercased on Windows) through `repositoryKey` in `git.ts`,
      which the operation lock now uses too.
- [x] `LocalVersioning` takes `{ consent }`; `status.enabled`; `init` enables
      (and now runs under the new repository's lock); `enable` (rejects a path
      that is not a repository root) and `disable`; `commitIfEnabled` for the
      close hook; `commitMove` skips silently; `commit`, `restore`, `setComment`
      reject with
      `Versioning is not enabled for the repository at     <repoRoot>.`; `log`,
      `fileAt`, `exportAt` need no consent.
- [x] Routes `versioning/enable`, `versioning/disable`; client
      `enableVersioning`, `disableVersioning`, `VersioningStatus.enabled`; the
      Electron host and the dev middleware construct the store in `<userData>`.
- [x] Existing tests enable their repository first (`init` or `enable`); a
      `createVersioning`/`versioningFor` helper in `testRepo.ts` gives tests a
      store in a temporary directory.

### Task 15b: shared foundations for PRs 4 and 5

Added after the pre-flight review of PRs 4 and 5, so that neither adds these
again.

- [x] Consent records an opt-out: `disable` writes `disabledRepositories` (file
      still version 1), only `enable` clears it, `status.optedOut`.
- [x] `LocalVersioning.enableIfInside`, route `versioning/enable-if-inside`,
      client `enableVersioningIfInside`; never re-enables an opted-out
      repository.
- [x] `LocalBackend.versioningStatus`; `__test__/localBackendTestUtils.ts`.
- [x] `gui/src/utils/localVersioningQuery.ts` (nullable path); `mockBackends`
      takes a `Partial<LocalBackend>`.
- [x] Playwright mock: `mock/jsonRpc.ts`, `mock/localVersioning.ts` (git absent
      by default) and empty `mock/versioning/{saveRoutes,historyRoutes}.ts`.

---

## PR 4: saving in the GUI

Branch `feature/local-versioning-save`. It starts from the commit Task 15b
(`plan-task15b.md`) makes on PR 3's branch (`feature/local-versioning-shim`, PR
#232). That base already contains PR 1 and PR 2, merged in through `develop`
(`cc3aa68ba9`).

From Task 15b it **uses, and must not add again**:

- consent's opt-out (`optedOut` on `VersioningStatus`);
- `versioning/enable-if-inside` and `ProjectManager.enableVersioningIfInside`;
- `LocalBackend.versioningStatus`;
- `localBackendTestUtils.ts`;
- `app/gui/src/utils/localVersioningQuery.ts`;
- the `mockBackends` widening;
- the Playwright versioning mock (`mock/localVersioning.ts`, default
  `git: false`).

PR 4 adds its mocked routes only in `mock/versioning/saveRoutes.ts`. **Merge
order: PR 4 first, then PR 5.**

Read the spec's "PR 4: saving in the GUI", "Testing" and "Decisions" sections
first, and the "Local versioning" section of
`app/project-manager-shim/CLAUDE.md`.

**Revision (after `preflight-pr4-pr5.md`).** The pre-flight review and the
controller's rulings changed the following:

- **Task 16** keeps only `LocalBackend`'s write methods and
  `closeProjectReportingVersioning`. The shim route and the client method moved
  to Task 15b.
- **Task 17 is replaced** (Ruling 20). Instead of a new language-server request,
  the ydoc session flushes its own modules. The GUI asks it to over the existing
  ydoc socket, with a state-vector handshake.
- **Every test is written out.** Tasks keep their numbers 16–25.

**The flush, and why not `text/save` from the GUI (spec correction).** The
spec's "Flush first" has the GUI send `text/save` through its own LS connection.
That cannot work:

- The Language Server accepts `text/save` only from the client that holds the
  buffer's write lock (`CollaborativeBuffer.saveFile`, `hasLock`), and only for
  the buffer's exact version.
- For a local project, that client is the ydoc server. It runs **inside the
  engine's JVM**: `MainModule.scala` launches `YdocServerApi`, which runs
  `ydoc.cjs` from `app/ydoc-server-polyglot` through `lib/java/ydoc-server`. Its
  `ModulePersistence` opens every module (`ls.openTextFile`).
- The GUI's `createLsRpcConnection` is a separate client and opens no file.

So the ydoc session saves (Task 17):

1. The GUI sends `flush` on a new channel, `ydoc:control`, on the index doc. The
   message carries the state vector of each module doc it has.
2. For each module, the session waits until its shared doc covers that state
   vector. This proves the GUI's last edit has arrived over the module's own
   socket.
3. It drains that edit to the Language Server (`applyEdit` settles).
4. It checks that the file has not changed on disk.
5. It sends `text/save` with the version it holds.

On failure:

- A **declined** save (the file changed on disk, or the module is not in sync)
  is a failure and sends nothing, so the Language Server's pending auto-save is
  untouched.
- A `text/save` that **fails** is retried once after the auto-save delay, so the
  edits are not left unsaved.
- If the ydoc server does not answer (an older engine), the GUI waits for the
  engine's 6 s auto-save, which is the timeout fallback.

**Engine bundle.** `ydoc.cjs` is packed into the engine jar
(`project/Ydoc.scala` builds `app/ydoc-server-polyglot`, `build.sbt` packs it
into `ydoc-server`). Task 17 therefore reaches users only through a rebuilt
engine, and **the installer test needs an engine rebuilt from this branch**. The
memory note "`--backend-source local` ships a stale engine" applies; follow the
"Local Windows installer build" recipe.

### File structure

| Path                                                                                                                          | Task           | What                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------- |
| `app/common/src/services/LocalBackend.ts`                                                                                     | 16             | write methods; `closeProjectReportingVersioning`   |
| `app/common/src/services/__test__/LocalBackend.versioning.test.ts` (new)                                                      | 16             | their tests                                        |
| `app/ydoc-shared/src/ydocControl.ts` (new), `app/ydoc-shared/src/__tests__/ydocControl.test.ts` (new)                         | 17             | the control channel's messages; state-vector cover |
| `app/ydoc-server/src/languageServerSession.ts`                                                                                | 17             | the session's `flush`; `ModulePersistence.flush`   |
| `app/ydoc-server/src/__tests__/languageServerSession.test.ts`                                                                 | 17             | flush tests                                        |
| `app/gui/src/providers/openedProjects/project/flush.ts` (new), `.../project/__tests__/flush.test.ts` (new)                    | 17             | the GUI's side                                     |
| `app/gui/src/providers/openedProjects/project/project.ts`                                                                     | 17             | `flushModules` on the project store                |
| `app/gui/src/providers/localVersioning.ts` (new), `app/gui/src/providers/__tests__/localVersioning.test.ts` (new)             | 18, 19, 20, 22 | the provider                                       |
| `app/gui/src/providers/openedProjects/projectStates.ts`                                                                       | 18, 22         | watch on open; prompt and warning on close         |
| `app/gui/src/components/LocalVersioning/RepositoryPromptModal.vue`, `SaveVersionModal.vue` (new), `__tests__/*.test.ts` (new) | 19, 20         | the dialogs                                        |
| `app/gui/src/configurations/graphInputBindings.ts`, `__tests__/keyboardShortcuts.test.ts`                                     | 20             | the two shortcuts                                  |
| `app/gui/src/project-view/providers/action.ts`, `__tests__/action.test.ts`                                                    | 20             | the actions                                        |
| `app/gui/src/project-view/components/GraphEditor.vue`                                                                         | 20             | handlers                                           |
| `app/gui/src/project-view/assets/icons.svg`, `util/iconMetadata/iconName.ts` (generated)                                      | 20             | `save` icon                                        |
| `app/gui/src/project-view/components/ChangedIndicator.vue` (new), `__tests__/ChangedIndicator.test.ts` (new), `TopBar.vue`    | 21             | the dot, the save button                           |
| `app/gui/src/components/AppContainer/TabBar.vue`, `__tests__/TabBar.test.ts` (new)                                            | 21             | the ●                                              |
| `app/gui/src/components/SyncingProjectsModal.vue`, `DashboardPage.vue`, `__tests__/DashboardPage.test.ts`                     | 23             | "Saving versions…"                                 |
| `app/gui/src/dashboard/layouts/Settings/LocalVersionsSettingsSection.vue` (new), `tabs.ts`, `__tests__/localTab.test.ts`      | 24             | Settings → Local → Versions                        |
| `app/common/src/text/english.json`                                                                                            | 19–24          | strings, after `"syncingProjectsMessage"`          |
| `app/gui/integration-test/mock/versioning/saveRoutes.ts`, `mock/lsHandler.ts`                                                 | 25             | mocked routes; the mocked ydoc control channel     |
| `app/gui/integration-test/project-view/localVersioning.spec.ts`, `dashboard/localVersioningSettings.spec.ts` (new)            | 25             | Playwright                                         |
| `CHANGELOG.md`, `app/gui/CLAUDE.md`, `app/ydoc-server` docs, the spec                                                         | 17, 25         | docs                                               |

**Files PR 5 also touches** (merge PR 4 first):

- `app/common/src/services/LocalBackend.ts`. PR 4 inserts its write methods
  after Task 15b's `versioningStatus` (inside the "Versioning" block) and
  changes `closeProject`. PR 5 edits `listAssetVersions`, `restoreAsset`,
  `copyAsset`, `duplicateProject`, `updateAsset` and `resolveProjectAssetData`
  in place. The hunks are disjoint.
- `app/common/src/text/english.json`. PR 4 adds keys after
  `"syncingProjectsMessage"`. PR 5 edits the `assetVersions.*` keys. The hunks
  are disjoint.
- `app/common/CLAUDE.md`. Each PR adds a sentence to the versioning bullet.
  Resolve by hand.
- `CHANGELOG.md`. Each PR adds an entry; PR 5 rebases.
- **Nothing else.** PR 4 never touches `localApi.ts` or `historyRoutes.ts`; PR 5
  never touches `saveRoutes.ts`, `lsHandler.ts` or the ydoc packages.

---

### Task 16: `LocalBackend`'s versioning writes, and the close commit's warning

**Files:**

- Modify: `app/common/src/services/LocalBackend.ts`
- Create: `app/common/src/services/__test__/LocalBackend.versioning.test.ts`
- Modify: `app/common/CLAUDE.md`

**Interfaces:**

Consumes: Task 15b's `makeLocalBackend()` and `LocalBackend.versioningStatus`.
`ProjectManager.initVersioning`, `enableVersioning`, `disableVersioning`,
`enableVersioningIfInside`, `commitVersion`, and `closeProject`, which returns
`{ readonly versioningWarning?: string }`.

Produces (in `LocalBackend`, inside Task 15b's "Versioning" block, after
`versioningStatus`):

```ts
initVersioning(rootPath: backend.Path): Promise<{ readonly repoRoot: Path }>
enableVersioning(repoRoot: backend.Path): Promise<void>
disableVersioning(repoRoot: backend.Path): Promise<void>
enableVersioningIfInside(repoRoot: backend.Path, rootPath: backend.Path): Promise<{ readonly enabled: boolean }>
/** Commit the project's current state with `message` (the shim saves an empty one as "Saved"). */
commitVersion(projectId: backend.ProjectId, message: string): Promise<{ readonly id: string | null }>
/** `closeProject`, returning the shim's `versioningWarning` when the close commit failed. */
closeProjectReportingVersioning(projectId: backend.ProjectId, title: string | null): Promise<{ readonly versioningWarning?: string }>
```

- [ ] **Step 1: Write the failing tests.**
      `app/common/src/services/__test__/LocalBackend.versioning.test.ts`:

```ts
/** @file `LocalBackend`'s versioning writes call `ProjectManager` with project paths. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { newProjectId } from "../LocalBackend";
import { Path } from "../ProjectManager/types";
import { makeLocalBackend } from "./localBackendTestUtils";

const PROJECT = Path("/root/P");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LocalBackend versioning writes", () => {
  it("commits the project at the id’s path, with the message as given", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    const spy = vi
      .spyOn(projectManager, "commitVersion")
      .mockResolvedValue({ id: "a".repeat(40) });
    expect(await localBackend.commitVersion(newProjectId(PROJECT), "")).toEqual(
      {
        id: "a".repeat(40),
      },
    );
    expect(spy).toHaveBeenCalledWith(PROJECT, "");
  });

  it("initialises, enables, disables, and enables a repository inside the root", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    const init = vi
      .spyOn(projectManager, "initVersioning")
      .mockResolvedValue({ repoRoot: Path("/root") });
    const enable = vi
      .spyOn(projectManager, "enableVersioning")
      .mockResolvedValue();
    const disable = vi
      .spyOn(projectManager, "disableVersioning")
      .mockResolvedValue();
    const inside = vi
      .spyOn(projectManager, "enableVersioningIfInside")
      .mockResolvedValue({ enabled: false });
    expect(await localBackend.initVersioning(Path("/root"))).toEqual({
      repoRoot: "/root",
    });
    await localBackend.enableVersioning(Path("/root"));
    await localBackend.disableVersioning(Path("/root"));
    expect(
      await localBackend.enableVersioningIfInside(Path("/"), Path("/root")),
    ).toEqual({
      enabled: false,
    });
    expect(init).toHaveBeenCalledWith("/root");
    expect(enable).toHaveBeenCalledWith("/root");
    expect(disable).toHaveBeenCalledWith("/root");
    expect(inside).toHaveBeenCalledWith("/", "/root");
  });

  it("returns the close commit’s warning; closeProject still resolves to nothing", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "closeProject").mockResolvedValue({
      versioningWarning: "locked",
    });
    expect(
      await localBackend.closeProjectReportingVersioning(
        newProjectId(PROJECT),
        "P",
      ),
    ).toEqual({
      versioningWarning: "locked",
    });
    expect(
      await localBackend.closeProject(newProjectId(PROJECT), "P"),
    ).toBeUndefined();
  });

  it("wraps a failed close as closeProject did", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "closeProject").mockRejectedValue(
      new Error("gone"),
    );
    await expect(
      localBackend.closeProjectReportingVersioning(newProjectId(PROJECT), "P"),
    ).rejects.toThrow("Could not close project 'P': gone.");
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/common exec vitest run src/services/__test__/LocalBackend.versioning.test.ts
```

Expected: `localBackend.commitVersion is not a function`, and so on.

- [ ] **Step 3: Implement.** Replace `closeProject` with:

```ts
  /**
   * Close the project identified by the given project ID.
   * @throws {Error} An error if the JSON-RPC call fails.
   */
  override async closeProject(projectId: backend.ProjectId, title: string | null): Promise<void> {
    await this.closeProjectReportingVersioning(projectId, title)
  }

  /**
   * Close the project, as {@link closeProject} does, and return the shim's `versioningWarning`
   * when it could not save the "Saved on close" version (the close itself still succeeded).
   * @throws {Error} An error if the JSON-RPC call fails.
   */
  async closeProjectReportingVersioning(
    projectId: backend.ProjectId,
    title: string | null,
  ): Promise<{ readonly versioningWarning?: string }> {
    const { path } = backend.extractTypeAndPath(projectId)
    try {
      return await this.projectManager.closeProject({ projectPath: path })
    } catch (error) {
      throw new Error(
        `Could not close project ${title != null ? `'${title}'` : `with ID '${projectId}'`}: ${
          tryGetMessage(error) ?? 'unknown error'
        }.`,
        { cause: error },
      )
    }
  }
```

After Task 15b's `versioningStatus`:

```ts
  /** Create a repository at `rootPath` (the local root), and enable it. */
  initVersioning(rootPath: backend.Path): Promise<{ readonly repoRoot: Path }> {
    return this.projectManager.initVersioning(rootPath)
  }

  /** Agree to have the existing repository at `repoRoot` versioned; clears an opt-out. */
  enableVersioning(repoRoot: backend.Path): Promise<void> {
    return this.projectManager.enableVersioning(repoRoot)
  }

  /** Stop versioning the repository at `repoRoot`, recording the opt-out; its history is kept. */
  disableVersioning(repoRoot: backend.Path): Promise<void> {
    return this.projectManager.disableVersioning(repoRoot)
  }

  /** Enable the repository at `repoRoot` if it is at or inside `rootPath` and not opted out. */
  enableVersioningIfInside(
    repoRoot: backend.Path,
    rootPath: backend.Path,
  ): Promise<{ readonly enabled: boolean }> {
    return this.projectManager.enableVersioningIfInside(repoRoot, rootPath)
  }

  /** Save the project's current state as a version (an empty message is saved as "Saved"). */
  commitVersion(
    projectId: backend.ProjectId,
    message: string,
  ): Promise<{ readonly id: string | null }> {
    return this.projectManager.commitVersion(backend.extractTypeAndPath(projectId).path, message)
  }
```

Decision: the empty-comment rule lives only in the shim's `versioning/commit`
route, which already saves an empty message as "Saved". The GUI passes the
comment through unchanged, so the rule is written once (R5).

- [ ] **Step 4: Run the common suite and typecheck; they pass.**

```bash
corepack pnpm -C app/common exec vitest run src/services
corepack pnpm -C app/common run typecheck
```

- [ ] **Step 5: Docs.** In `app/common/CLAUDE.md`'s versioning bullet, add: "PR
      4 adds the writes the saving GUI uses (`initVersioning`,
      `enableVersioning`, `disableVersioning`, `enableVersioningIfInside`,
      `commitVersion`) and `closeProjectReportingVersioning`, whose
      `versioningWarning` the GUI shows as a warning toast."

- [ ] **Step 6: Commit.**

```bash
git add app/common
git commit -m "LocalBackend: versioning writes, and the close commit's warning"
```

---

### Task 17: flushing the open modules through the ydoc session

**Files:** see the File structure table (Task 17 rows).

**Interfaces:**

Consumes (verified in the code):

- `LanguageServerSession` (`app/ydoc-server/src/languageServerSession.ts`):
  `indexDoc: WSSharedDoc`, `model: DistributedProject`
  (`findModuleByDocId(guid)`), `authoritativeModules`, `ls`, and the constructor
  where the visualization bridge is made.
- `ModulePersistence`: its constructor `(ls, path, sharedDoc)`, `state`,
  `lastAction`, `updateToApply`, `syncedVersion`, `inState`,
  `trySyncRemoteUpdates`, and `open`/`reload`, which sync the content.
- `LanguageServer.saveTextFile(path, currentVersion)`, `fileInfo(path)`
  (`attributes.lastModifiedTime`), and the `'text/autoSave'` notification, which
  goes to the lock holder, so the ydoc session gets it.
- `YjsChannel` (`ydoc-channel`): two instances on one doc talk to each other
  (the visualization bridge works this way).
- The GUI project store's `doc` (the index doc), and `projectModel.modules`
  (`Y.Map<Y.Doc>`) in `createProjectStore`.

Produces:

```ts
// app/ydoc-shared/src/ydocControl.ts
export const YDOC_CONTROL_CHANNEL = "ydoc:control";
/** A Yjs state vector as `[clientId, clock]` pairs, so that it travels as JSON. */
export type StateVectorEntries = readonly (readonly [number, number])[];
export type YdocControlMessage =
  | {
      readonly type: "flush";
      readonly id: string;
      readonly modules: Readonly<Record<string, StateVectorEntries>>;
    }
  | { readonly type: "flushed"; readonly id: string; readonly ok: true }
  | {
      readonly type: "flushed";
      readonly id: string;
      readonly ok: false;
      readonly error: string;
    };
export function stateVectorEntries(doc: Y.Doc): StateVectorEntries;
export function stateVectorCovers(
  doc: Y.Doc,
  wanted: StateVectorEntries,
): boolean;
export function encodeControlMessage(message: YdocControlMessage): string;
export function parseControlMessage(raw: string): YdocControlMessage | null;

// app/ydoc-server/src/languageServerSession.ts
class LanguageServerSession {
  /** Save every module `modules` names, once each covers the given state vector. */
  flush(
    modules: Readonly<Record<string, StateVectorEntries>>,
  ): Promise<Result<void>>;
}
class ModulePersistence {
  static FLUSH_WAIT_MS: number; // 4_000: for the GUI's edits to arrive and reach the LS
  static DISK_RECHECK_MS: number; // 500: for a `text/autoSave` already on its way
  static SAVE_RETRY_MS: number; // 6_000: the engine's auto-save delay
  flush(wanted: StateVectorEntries): Promise<Result<void>>;
}

// app/gui/src/providers/openedProjects/project/flush.ts
export type FlushOutcome =
  | { readonly kind: "flushed" }
  | { readonly kind: "waited" } // no answer: waited for the auto-save
  | { readonly kind: "declined"; readonly reason: string }; // nothing written; do not commit
export const FLUSH_TIMEOUT_MS = 5_000;
export const AUTOSAVE_FALLBACK_MS = 7_000;
export function createModuleFlusher(
  indexDoc: Y.Doc,
  moduleDocs: () => Iterable<Y.Doc>,
  options?: { readonly timeoutMs?: number; readonly fallbackMs?: number },
): { flush(): Promise<FlushOutcome>; close(): void };
// project store: `flushModules: () => Promise<FlushOutcome>`
```

Decision: the GUI sends state vectors as `[clientId, clock]` pairs in JSON, not
as base64. `lib0`'s base64 picks a Node or a browser implementation, and the
polyglot runtime is neither, while JSON needs nothing.

Decision: the session refuses the save ("changed on disk") when the file's
`lastModifiedTime` differs from the one the session last saw. It records that
time after opening or reloading a module, after each `text/autoSave` for it, and
after its own save. Before refusing, it waits `DISK_RECHECK_MS` and checks
again, so that a `text/autoSave` already on its way does not count as an outside
change. Plain `text/save` overwrites unconditionally (`WriteFile`). Without this
check, a flush could overwrite an outside edit, which the Language Server's
auto-save would have declined.

- [ ] **Step 1: Write the failing protocol tests.**
      `app/ydoc-shared/src/__tests__/ydocControl.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  encodeControlMessage,
  parseControlMessage,
  stateVectorCovers,
  stateVectorEntries,
} from "../ydocControl";

describe("state vectors", () => {
  test("a doc covers its own state vector, and not one with a later edit", () => {
    const a = new Y.Doc();
    a.getMap("m").set("k", 1);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(true);
    a.getMap("m").set("k", 2);
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(false);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(true);
  });

  test("an empty state vector is always covered", () => {
    expect(stateVectorCovers(new Y.Doc(), [])).toBe(true);
  });
});

describe("control messages", () => {
  test("round-trip", () => {
    const flush = { type: "flush", id: "x", modules: { g: [[1, 2]] } } as const;
    expect(parseControlMessage(encodeControlMessage(flush))).toEqual(flush);
    const failed = {
      type: "flushed",
      id: "x",
      ok: false,
      error: "changed on disk",
    } as const;
    expect(parseControlMessage(encodeControlMessage(failed))).toEqual(failed);
  });

  test("anything else is null", () => {
    expect(parseControlMessage("not json")).toBeNull();
    expect(
      parseControlMessage(JSON.stringify({ type: "flush", id: 3 })),
    ).toBeNull();
    expect(
      parseControlMessage(JSON.stringify({ type: "other", id: "x" })),
    ).toBeNull();
    expect(
      parseControlMessage(
        JSON.stringify({ type: "flush", id: "x", modules: { g: "no" } }),
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Watch it fail; implement; watch it pass.**

```bash
corepack pnpm -C app/ydoc-shared exec vitest run src/__tests__/ydocControl.test.ts
```

`app/ydoc-shared/src/ydocControl.ts`:

```ts
/**
 * @file The ydoc control channel: a JSON channel on a project's index doc between the GUI and the
 * ydoc server, beside the visualization bridge's `vis:control`. Its one request is `flush`: write
 * the named modules to disk once each contains the edits the GUI had made (its state vector), so
 * that a version of the project is not taken before the last edit is on disk.
 */
import * as Y from "yjs";

export const YDOC_CONTROL_CHANNEL = "ydoc:control";

/** A Yjs state vector as `[clientId, clock]` pairs, so that it travels as JSON. */
export type StateVectorEntries = readonly (readonly [number, number])[];

/** A message on {@link YDOC_CONTROL_CHANNEL}. */
export type YdocControlMessage =
  | {
      readonly type: "flush";
      readonly id: string;
      /** Each module doc's guid, with the state vector the GUI had. */
      readonly modules: Readonly<Record<string, StateVectorEntries>>;
    }
  | { readonly type: "flushed"; readonly id: string; readonly ok: true }
  | {
      readonly type: "flushed";
      readonly id: string;
      readonly ok: false;
      readonly error: string;
    };

/** The state vector of `doc`. */
export function stateVectorEntries(doc: Y.Doc): StateVectorEntries {
  return [...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()];
}

/** Whether `doc` contains everything `wanted` describes. */
export function stateVectorCovers(
  doc: Y.Doc,
  wanted: StateVectorEntries,
): boolean {
  const have = Y.decodeStateVector(Y.encodeStateVector(doc));
  return wanted.every(([client, clock]) => (have.get(client) ?? 0) >= clock);
}

/** Encode a message for the channel. */
export function encodeControlMessage(message: YdocControlMessage): string {
  return JSON.stringify(message);
}

const isEntries = (value: unknown): value is StateVectorEntries =>
  Array.isArray(value) &&
  value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === "number" &&
      typeof pair[1] === "number",
  );

/** Decode a message from the channel; `null` for anything that is not one. */
export function parseControlMessage(raw: string): YdocControlMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value == null) return null;
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string") return null;
  if (message.type === "flush") {
    const modules = message.modules;
    if (typeof modules !== "object" || modules == null) return null;
    if (!Object.values(modules).every(isEntries)) return null;
    return {
      type: "flush",
      id: message.id,
      modules: modules as Record<string, StateVectorEntries>,
    };
  }
  if (message.type === "flushed") {
    if (message.ok === true)
      return { type: "flushed", id: message.id, ok: true };
    if (message.ok === false && typeof message.error === "string")
      return {
        type: "flushed",
        id: message.id,
        ok: false,
        error: message.error,
      };
  }
  return null;
}
```

- [ ] **Step 3: Write the failing session tests.** In
      `app/ydoc-server/src/__tests__/languageServerSession.test.ts`, add a
      second fake beside `fakeLanguageServer`: it serves one module, records
      `text/save`, and lets a test hold an `applyEdit` back or fail a save:

```ts
import { YjsChannel as Channel } from "ydoc-channel";
import * as Ast from "ydoc-shared/ast";
import { computeTextChecksum } from "ydoc-shared/languageServer";
import {
  encodeControlMessage,
  parseControlMessage,
  stateVectorEntries,
  YDOC_CONTROL_CHANNEL,
} from "ydoc-shared/ydocControl";
import * as Y from "yjs";
import { ModulePersistence } from "../languageServerSession";

const MAIN = "main = 1\n";

/** A Language Server with one module, `src/Main.enso`, that records saves. */
function fakeLanguageServerWithModule() {
  const saves: { currentVersion: string }[] = [];
  const edits: { newVersion: string }[] = [];
  const state = {
    modifiedTime: "2026-10-16T10:00:00Z",
    holdEdits: false,
    failNextSave: false,
  };
  let releaseEdits: (() => void)[] = [];
  const server: YjsChannelServer = {
    onConnect: (untypedChannel) => {
      const channel = untypedChannel as YjsChannel<string>;
      channel.subscribe((raw) => {
        const message = JSON.parse(raw);
        if (typeof message.method !== "string" || message.id == null) return;
        const reply = (body: object) =>
          channel.send(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, ...body }),
          );
        const path = { rootId: PROJECT_ROOT, segments: ["src", "Main.enso"] };
        switch (message.method) {
          case "session/initProtocolConnection":
            return queueMicrotask(() =>
              reply({
                result: {
                  contentRoots: [{ type: "Project", id: PROJECT_ROOT }],
                },
              }),
            );
          case "file/list":
            return queueMicrotask(() =>
              reply({
                result: {
                  paths: [
                    {
                      type: "File",
                      name: "Main.enso",
                      path: { rootId: PROJECT_ROOT, segments: ["src"] },
                    },
                  ],
                },
              }),
            );
          case "text/openFile":
            return queueMicrotask(() =>
              reply({
                result: {
                  writeCapability: {
                    method: "text/canEdit",
                    registerOptions: { path },
                  },
                  content: MAIN,
                  currentVersion: computeTextChecksum(MAIN),
                },
              }),
            );
          case "file/info":
            return queueMicrotask(() =>
              reply({
                result: {
                  attributes: {
                    creationTime: state.modifiedTime,
                    lastAccessTime: state.modifiedTime,
                    lastModifiedTime: state.modifiedTime,
                    kind: { type: "File", name: "Main.enso", path },
                    byteSize: MAIN.length,
                  },
                },
              }),
            );
          case "text/applyEdit": {
            edits.push({ newVersion: message.params.edit.newVersion });
            const answer = () => reply({ result: null });
            if (state.holdEdits) releaseEdits.push(answer);
            else queueMicrotask(answer);
            return;
          }
          case "text/save": {
            saves.push({ currentVersion: message.params.currentVersion });
            if (state.failNextSave) {
              state.failNextSave = false;
              return queueMicrotask(() =>
                reply({ error: { code: 1000, message: "disk full" } }),
              );
            }
            return queueMicrotask(() => reply({ result: null }));
          }
          default:
            return queueMicrotask(() => reply({ result: null }));
        }
      });
    },
  };
  const release = () => {
    for (const answer of releaseEdits) answer();
    releaseEdits = [];
  };
  return { server, saves, edits, state, release };
}

/** A GUI: a copy of the module doc, whose updates the test delivers when it chooses. */
async function openWithGui(
  url: string,
  ls: ReturnType<typeof fakeLanguageServerWithModule>,
) {
  const session = LanguageServerSession.get(
    url,
    ls.server,
    noChannels,
    noChannels,
    {} as JavaByteBufferClass,
  );
  await vi.waitFor(() =>
    expect(session.model.modules.get("Main.enso")).toBeDefined(),
  );
  const serverDoc = session.model.modules.get("Main.enso")!;
  await vi.waitFor(() =>
    expect(new Ast.MutableModule(serverDoc).root()).toBeDefined(),
  );
  const guiDoc = new Y.Doc();
  Y.applyUpdate(guiDoc, Y.encodeStateAsUpdate(serverDoc));
  const undelivered: Uint8Array[] = [];
  guiDoc.on("update", (update: Uint8Array) => undelivered.push(update));
  const deliver = () => {
    for (const update of undelivered.splice(0))
      Y.applyUpdate(serverDoc, update, "gui");
  };
  const control = new Channel<string>(
    session.indexDoc.doc,
    YDOC_CONTROL_CHANNEL,
  );
  const answers: unknown[] = [];
  control.subscribe((raw) => answers.push(parseControlMessage(raw)));
  const flush = (id: string) =>
    control.send(
      encodeControlMessage({
        type: "flush",
        id,
        modules: { [serverDoc.guid]: stateVectorEntries(guiDoc) },
      }),
    );
  return { session, guiDoc, deliver, flush, answers };
}

describe("flush", () => {
  let flushSession: LanguageServerSession | undefined;
  afterEach(async () => {
    await flushSession?.release();
    flushSession = undefined;
  });

  test("waits for the GUI’s last edit to arrive and reach the LS, then saves its version", async () => {
    const ls = fakeLanguageServerWithModule();
    const gui = await openWithGui("ws://flush-waits", ls);
    flushSession = gui.session;
    new Ast.MutableModule(gui.guiDoc).syncToCode("main = 2\n");
    ls.state.holdEdits = true;
    gui.flush("one");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The edit has not arrived: nothing is saved yet.
    expect(ls.saves).toEqual([]);
    gui.deliver();
    await vi.waitFor(() => expect(ls.edits).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // It has arrived, but the LS has not applied it: still nothing.
    expect(ls.saves).toEqual([]);
    ls.release();
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([{ type: "flushed", id: "one", ok: true }]),
    );
    expect(ls.saves).toEqual([{ currentVersion: ls.edits[0]!.newVersion }]);
  });

  test("declines when the file changed on disk, and saves nothing", async () => {
    const ls = fakeLanguageServerWithModule();
    const gui = await openWithGui("ws://flush-declines", ls);
    flushSession = gui.session;
    ls.state.modifiedTime = "2026-10-16T11:00:00Z";
    gui.flush("two");
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([
        {
          type: "flushed",
          id: "two",
          ok: false,
          error: expect.stringContaining("changed on disk"),
        },
      ]),
    );
    expect(ls.saves).toEqual([]);
  });

  test("a failed save is reported, and retried once after the auto-save delay", async () => {
    ModulePersistence.SAVE_RETRY_MS = 50;
    try {
      const ls = fakeLanguageServerWithModule();
      const gui = await openWithGui("ws://flush-retries", ls);
      flushSession = gui.session;
      ls.state.failNextSave = true;
      gui.flush("three");
      await vi.waitFor(() =>
        expect(gui.answers).toEqual([
          {
            type: "flushed",
            id: "three",
            ok: false,
            error: expect.stringContaining("disk full"),
          },
        ]),
      );
      await vi.waitFor(() => expect(ls.saves).toHaveLength(2));
    } finally {
      ModulePersistence.SAVE_RETRY_MS = 6_000;
    }
  });

  test("an edit that never arrives fails the flush after the wait", async () => {
    ModulePersistence.FLUSH_WAIT_MS = 100;
    try {
      const ls = fakeLanguageServerWithModule();
      const gui = await openWithGui("ws://flush-never", ls);
      flushSession = gui.session;
      new Ast.MutableModule(gui.guiDoc).syncToCode("main = 3\n");
      gui.flush("four");
      await vi.waitFor(() =>
        expect(gui.answers).toEqual([
          {
            type: "flushed",
            id: "four",
            ok: false,
            error: expect.stringContaining("did not arrive"),
          },
        ]),
      );
      expect(ls.saves).toEqual([]);
    } finally {
      ModulePersistence.FLUSH_WAIT_MS = 4_000;
    }
  });
});
```

`new Ast.MutableModule(doc).syncToCode(code)` is how
`integration-test/mock/lsHandler.ts` writes a module's code into a doc; on a doc
that already has a root, it edits that root.

Export `ModulePersistence` from `languageServerSession.ts`. The tests need it to
lower the delays, and nothing else changes.

- [ ] **Step 4: Run them and watch them fail.**

```bash
corepack pnpm -C app/ydoc-server exec vitest run src/__tests__/languageServerSession.test.ts
```

Expected: the `answers` stay empty. Nothing listens on `ydoc:control`.

- [ ] **Step 5: Implement the session's side.** In `languageServerSession.ts`,
      import `YjsChannel` (a value) from `ydoc-channel` beside the type import,
      and `parseControlMessage`, `encodeControlMessage`, `stateVectorCovers`,
      `YDOC_CONTROL_CHANNEL` and `type StateVectorEntries` from
      `ydoc-shared/ydocControl`.

  `LanguageServerSession`: add the field `control: YjsChannel<string>`; in the
  constructor, after `this.visualizationBridge = …`:

```ts
// The control channel: the GUI asks for its modules to be written before a version is saved.
this.control = new YjsChannel<string>(this.indexDoc.doc, YDOC_CONTROL_CHANNEL);
this.control.subscribe((raw) => void this.handleControlMessage(raw));
```

In `release()`, beside `this.visualizationBridge.close()`, add
`this.control.close()`. Methods:

```ts
  private async handleControlMessage(raw: string) {
    const message = parseControlMessage(raw)
    if (message?.type !== 'flush') return
    const result = await this.flush(message.modules)
    this.control.send(
      encodeControlMessage(
        result.ok ?
          { type: 'flushed', id: message.id, ok: true }
        : { type: 'flushed', id: message.id, ok: false, error: result.error.message() },
      ),
    )
  }

  /**
   * Write every module `modules` names (by doc guid) to disk, once each contains the edits the
   * caller had made (its state vector), so that a version taken next includes them. Modules this
   * session does not know are skipped.
   */
  async flush(modules: Readonly<Record<string, StateVectorEntries>>): Promise<Result<void>> {
    const flushes = Object.entries(modules).flatMap(([guid, wanted]) => {
      const name = this.model.findModuleByDocId(guid)
      const module = name != null ? this.authoritativeModules.get(name) : undefined
      return module != null ? [module.flush(wanted)] : []
    })
    const results = await Promise.all(flushes)
    return results.find((result) => !result.ok) ?? Ok()
  }
```

Check how a `Result` error turns into text in this codebase (`ResultError` has
`message()`, or look at how `result.error.log(…)` is built in
`enso-common/src/utilities/data/result`), and use that accessor.

In `setupClient`, record each auto-save's file time:

```ts
this.ls.on("text/autoSave", ({ path }) => {
  void this.tryGetExistingModuleModel(path)?.recordDiskTime();
});
```

`ModulePersistence`: keep the shared doc (`private readonly sharedDoc: Y.Doc`,
set in the constructor from the `sharedDoc` parameter), add
`diskTime: string | null = null`, and:

```ts
  /** How long a flush waits for the GUI's edits to arrive and to reach the Language Server. */
  static FLUSH_WAIT_MS = 4_000
  /** How long a flush waits, before refusing, for a `text/autoSave` that may be on its way. */
  static DISK_RECHECK_MS = 500
  /** After a failed save, when it is tried again (the engine's own auto-save delay). */
  static SAVE_RETRY_MS = 6_000

  /** Remember the file's modification time, as it is after a write or a read this session knows. */
  async recordDiskTime(): Promise<void> {
    const info = await this.ls.fileInfo(this.path)
    if (info.ok) this.diskTime = info.value.attributes.lastModifiedTime
  }

  /**
   * Write the module to disk once the shared doc covers `wanted` (the GUI's state vector) and the
   * covered edits have reached the Language Server. Refuses, writing nothing (so the Language
   * Server's pending auto-save is untouched), when the edits do not arrive in time, when the module
   * is not in sync, or when the file changed on disk since this session last wrote or read it. A
   * save that fails is reported and tried once more after {@link SAVE_RETRY_MS}.
   */
  async flush(wanted: StateVectorEntries): Promise<Result<void>> {
    const where = this.path.segments.join('/')
    if (!(await this.waitForCover(wanted, ModulePersistence.FLUSH_WAIT_MS)))
      return Err(`The last edits to ${where} did not arrive.`)
    const deadline = Date.now() + ModulePersistence.FLUSH_WAIT_MS
    while (this.updateToApply != null || !this.inState(LsSyncState.Synchronized)) {
      if (
        this.inState(
          LsSyncState.Closed,
          LsSyncState.Closing,
          LsSyncState.Disposed,
          LsSyncState.WriteError,
          LsSyncState.CapabilityError,
        )
      )
        return Err(`${where} is not in sync with the Language Server.`)
      if (Date.now() > deadline) return Err(`${where} did not reach the Language Server in time.`)
      this.trySyncRemoteUpdates()
      await Promise.race([this.lastAction, new Promise((resolve) => setTimeout(resolve, 50))])
    }
    const version = this.syncedVersion
    if (version == null) return Err(`${where} is not in sync with the Language Server.`)
    if (!(await this.diskUnchanged())) return Err(`${where} was changed on disk.`)
    const saved = await this.ls.saveTextFile(this.path, version)
    if (!saved.ok) {
      this.retrySave(version)
      return saved
    }
    await this.recordDiskTime()
    return Ok()
  }

  private waitForCover(wanted: StateVectorEntries, timeoutMs: number): Promise<boolean> {
    if (stateVectorCovers(this.sharedDoc, wanted)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (covered: boolean) => {
        clearTimeout(timer)
        this.sharedDoc.off('update', onUpdate)
        resolve(covered)
      }
      // Registered after the constructor's own listener, so the update is already queued for the
      // Language Server (`updateToApply`) when this sees it.
      const onUpdate = () => {
        if (stateVectorCovers(this.sharedDoc, wanted)) done(true)
      }
      const timer = setTimeout(() => done(false), timeoutMs)
      this.sharedDoc.on('update', onUpdate)
    })
  }

  private async diskUnchanged(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const info = await this.ls.fileInfo(this.path)
      if (info.ok && this.diskTime != null && info.value.attributes.lastModifiedTime === this.diskTime)
        return true
      if (attempt === 0)
        await new Promise((resolve) => setTimeout(resolve, ModulePersistence.DISK_RECHECK_MS))
    }
    return false
  }

  /** Try a failed save once more, unless the module has moved on (its own auto-save covers that). */
  private retrySave(version: Checksum) {
    setTimeout(() => {
      if (this.syncedVersion !== version || !this.inState(LsSyncState.Synchronized)) return
      void this.ls.saveTextFile(this.path, version).then((result) => {
        if (result.ok) void this.recordDiskTime()
        else result.error.log(`Could not save ${this.path.segments.join('/')} again`)
      })
    }, ModulePersistence.SAVE_RETRY_MS)
  }
```

Record the disk time where the content is read:

- in `open()`, in the `Closed` case, right after `this.syncFileContents(…)`, add
  `await this.recordDiskTime()`;
- in `reload()`, after each of its two `this.syncFileContents(…)` calls, add the
  same.

`inState` is private to the class, which is where `flush` is. Make it
`protected` if the compiler asks.

- [ ] **Step 6: Run the ydoc-server suite; it passes.**

```bash
corepack pnpm -C app/ydoc-server exec vitest run
corepack pnpm -C app/ydoc-server exec tsc --noEmit -p .
corepack pnpm -C app/ydoc-server-polyglot run build
```

The last command builds the bundle the engine packs
(`build:ydoc-server-polyglot`). It proves the new imports bundle, without
needing the JVM.

- [ ] **Step 7: Write the failing GUI tests.**
      `app/gui/src/providers/openedProjects/project/__tests__/flush.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { YjsChannel } from "ydoc-channel";
import {
  encodeControlMessage,
  parseControlMessage,
  YDOC_CONTROL_CHANNEL,
} from "ydoc-shared/ydocControl";
import * as Y from "yjs";
import {
  AUTOSAVE_FALLBACK_MS,
  createModuleFlusher,
  FLUSH_TIMEOUT_MS,
} from "../flush";

afterEach(() => vi.useRealTimers());

/** The ydoc server's end of the control channel, answering with `answer`. */
function serverEnd(indexDoc: Y.Doc, answer: (id: string) => object | null) {
  const requests: unknown[] = [];
  const channel = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL);
  channel.subscribe((raw) => {
    const message = parseControlMessage(raw);
    requests.push(message);
    if (message?.type !== "flush") return;
    const reply = answer(message.id);
    if (reply != null)
      channel.send(
        JSON.stringify({ type: "flushed", id: message.id, ...reply }),
      );
  });
  return requests;
}

describe("createModuleFlusher", () => {
  test("sends each module doc’s state vector, and reports a flush", async () => {
    const indexDoc = new Y.Doc();
    const moduleDoc = new Y.Doc();
    moduleDoc.getMap("m").set("k", 1);
    const requests = serverEnd(indexDoc, () => ({ ok: true }));
    const flusher = createModuleFlusher(indexDoc, () => [moduleDoc]);
    expect(await flusher.flush()).toEqual({ kind: "flushed" });
    expect(requests).toEqual([
      {
        type: "flush",
        id: expect.any(String),
        modules: { [moduleDoc.guid]: [[moduleDoc.clientID, 1]] },
      },
    ]);
  });

  test('a refusal is "declined", with the server’s reason', async () => {
    const indexDoc = new Y.Doc();
    serverEnd(indexDoc, () => ({
      ok: false,
      error: "Main.enso was changed on disk.",
    }));
    const flusher = createModuleFlusher(indexDoc, () => []);
    expect(await flusher.flush()).toEqual({
      kind: "declined",
      reason: "Main.enso was changed on disk.",
    });
  });

  test('no answer: waits for the auto-save, then "waited"', async () => {
    vi.useFakeTimers();
    const indexDoc = new Y.Doc();
    serverEnd(indexDoc, () => null);
    const flusher = createModuleFlusher(indexDoc, () => []);
    let outcome: unknown;
    void flusher.flush().then((result) => (outcome = result));
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_FALLBACK_MS - FLUSH_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: "waited" });
  });

  test("answers for another request are ignored", async () => {
    const indexDoc = new Y.Doc();
    const other = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL);
    serverEnd(indexDoc, (id) => {
      other.send(
        encodeControlMessage({
          type: "flushed",
          id: `${id}-other`,
          ok: false,
          error: "x",
        }),
      );
      return { ok: true };
    });
    expect(await createModuleFlusher(indexDoc, () => []).flush()).toEqual({
      kind: "flushed",
    });
  });
});
```

- [ ] **Step 8: Run it and watch it fail; then implement.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/openedProjects/project/__tests__/flush.test.ts
```

`app/gui/src/providers/openedProjects/project/flush.ts`:

```ts
/**
 * @file Writing a project's open modules to disk before a version is saved. The ydoc server holds
 * the modules (it is the Language Server's client for them), so the GUI asks it, on the index
 * doc's control channel (`ydoc-shared/ydocControl`), sending each module doc's state vector: the
 * server writes a module only once it has the edits the GUI had made. With no answer (an engine
 * without the channel, or a busy one), the GUI waits for the engine's own auto-save instead.
 */
import { YjsChannel } from "ydoc-channel";
import {
  encodeControlMessage,
  parseControlMessage,
  stateVectorEntries,
  YDOC_CONTROL_CHANNEL,
} from "ydoc-shared/ydocControl";
import type * as Y from "yjs";

/** What became of a flush. */
export type FlushOutcome =
  | { readonly kind: "flushed" }
  /** No answer: waited {@link AUTOSAVE_FALLBACK_MS} for the engine's auto-save. */
  | { readonly kind: "waited" }
  /** The server refused (the file changed on disk, or is not in sync); nothing was written. */
  | { readonly kind: "declined"; readonly reason: string };

/** How long the GUI waits for the ydoc server's answer. */
export const FLUSH_TIMEOUT_MS = 5_000;
/** From the request, how long to wait without an answer: the engine's 6 s auto-save, and a margin. */
export const AUTOSAVE_FALLBACK_MS = 7_000;

/** Create the flusher of a project, whose index doc is `indexDoc`. */
export function createModuleFlusher(
  indexDoc: Y.Doc,
  moduleDocs: () => Iterable<Y.Doc>,
  options: { readonly timeoutMs?: number; readonly fallbackMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? FLUSH_TIMEOUT_MS;
  const fallbackMs = options.fallbackMs ?? AUTOSAVE_FALLBACK_MS;
  const control = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL);
  const pending = new Map<string, (outcome: FlushOutcome) => void>();
  control.subscribe((raw) => {
    const message = parseControlMessage(raw);
    if (message?.type !== "flushed") return;
    pending.get(message.id)?.(
      message.ok
        ? { kind: "flushed" }
        : { kind: "declined", reason: message.error },
    );
  });

  async function flush(): Promise<FlushOutcome> {
    const started = Date.now();
    const id = crypto.randomUUID();
    const modules = Object.fromEntries(
      [...moduleDocs()].map((doc) => [doc.guid, stateVectorEntries(doc)]),
    );
    const answer = await new Promise<FlushOutcome | null>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, timeoutMs);
      pending.set(id, (outcome) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(outcome);
      });
      control.send(encodeControlMessage({ type: "flush", id, modules }));
    });
    if (answer != null) return answer;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, started + fallbackMs - Date.now())),
    );
    return { kind: "waited" };
  }

  return { flush, close: () => control.close() };
}
```

In `project.ts` (`createProjectStore`), after
`const projectModel = new DistributedProject(doc)`:

```ts
const moduleFlusher = createModuleFlusher(doc, () =>
  projectModel.modules.values(),
);
onScopeDispose(() => moduleFlusher.close());
```

and add `flushModules: moduleFlusher.flush,` to the object the store returns,
beside `lsRpcConnection`.

- [ ] **Step 9: Run the GUI test, typecheck and lint; they pass.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/openedProjects/project/__tests__/flush.test.ts
corepack pnpm -C app/gui run typecheck
corepack pnpm -C app/gui exec eslint src/providers/openedProjects/project
```

- [ ] **Step 10: Docs.**
  - Amend the spec's PR 4 "Flush first" bullet (M9): "**Flush first.** The ydoc
    server, the Language Server's client for the modules, writes them
    (`text/save`) when the GUI asks over the index doc's `ydoc:control` channel.
    The request carries each module doc's state vector, so a module is written
    only once the GUI's last edit has reached it. A refusal (changed on disk) is
    a failure; without an answer the GUI waits for the 6 s auto-save."
  - Add a "Control channel" paragraph to `app/ydoc-server`'s `CLAUDE.md`,
    creating the file if missing per the `project-structure` skill: the channel,
    `flush`, the disk-time rule, the retry, and "this code runs in the engine's
    JVM (ydoc-server-polyglot), so a change needs a rebuilt engine to reach the
    IDE".

- [ ] **Step 11: Commit.**

```bash
git add app/ydoc-shared app/ydoc-server app/gui/src/providers/openedProjects/project docs/superpowers/specs
git commit -m "ydoc: write a project's modules on request, once the GUI's last edit has reached them"
```

Note for the PR body: `app/ydoc-server` is part of the engine bundle. If
`.github/workflows/engine-changed-files.yml` lists `app/ydoc-*`, the engine CI
also runs.

---

### Task 18: `$/providers/localVersioning`: each open local project's status, polled without overlap

The review's rule: no new status request is issued while one is pending.
TanStack Query's interval refetch deduplicates, but `invalidateQueries` cancels
the request in flight and starts another, while the shim still runs the first.
Decision: the provider polls with its own loop. Each project has at most one
request in flight, and a refresh asked for meanwhile runs once, after it.

Decision: the provider never imports `$/providers/openedProjects`, whose store
imports the provider, which would loop two `createGlobalState`s. Instead,
`projectStates.ts` calls `watchProject` and `unwatchProject`.

**Files:**

- Create: `app/gui/src/providers/localVersioning.ts`,
  `app/gui/src/providers/__tests__/localVersioning.test.ts`
- Modify: `app/gui/src/providers/openedProjects/projectStates.ts`

**Interfaces:**

Consumes: `LocalBackend.versioningStatus` (Task 15b), `enableVersioningIfInside`
(Task 16), `rootPath()`; `FlushOutcome` and the store's `flushModules` (Task
17); `extractTypeAndPath` (`enso-common/src/services/Backend`).

Produces (Tasks 19, 20 and 22 add members):

```ts
export const VERSIONING_POLL_INTERVAL_MS = 5_000;
export interface RepositoryPromptsState {
  readonly declinedRoots: readonly string[];
  readonly declinedRepositories: readonly string[];
}
export interface LocalVersioningDependencies {
  readonly localBackend: () => LocalBackend | null;
  readonly modals: ModalsStore;
  readonly toasts: ToastsStore;
  readonly getText: ReturnType<typeof useText>["getText"];
  readonly prompts: PersistedStore<RepositoryPromptsState>;
  readonly pollIntervalMs?: number;
}
export function createLocalVersioningStore(deps: LocalVersioningDependencies): {
  watchProject(projectId: ProjectId, flush: () => Promise<FlushOutcome>): void;
  unwatchProject(projectId: ProjectId): void;
  refresh(projectId: ProjectId): Promise<void>;
  statusOf(projectId: ProjectId): VersioningStatus | undefined;
  isVersioned(projectId: ProjectId): boolean;
};
export type LocalVersioningStore = ReturnType<
  typeof createLocalVersioningStore
>;
export const useLocalVersioning: () => LocalVersioningStore;
```

- [ ] **Step 1: Write the failing tests.**
      `app/gui/src/providers/__tests__/localVersioning.test.ts`:

```ts
/**
 * @file The local versioning provider: each open local project's status, polled every 5 s
 * without overlapping requests; the silent enabling of a repository inside the root; the
 * repository prompts; saving.
 */
import { createModalsStore } from "$/providers/modals";
import { useText } from "$/providers/text";
import { createToastsStore } from "$/providers/toasts";
import { createPersistedStore } from "$/utils/persistedStore";
import { Path, type ProjectId } from "enso-common/src/services/Backend";
import {
  newProjectId,
  type LocalBackend,
} from "enso-common/src/services/LocalBackend";
import type { VersioningStatus } from "enso-common/src/services/ProjectManager/types";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FlushOutcome } from "../openedProjects/project/flush";
import {
  createLocalVersioningStore,
  VERSIONING_POLL_INTERVAL_MS,
  type RepositoryPromptsState,
} from "../localVersioning";

const ROOT = Path("/root");
const PROJECT_PATH = Path("/root/P");
const PROJECT: ProjectId = newProjectId(PROJECT_PATH);
const FLUSHED = async (): Promise<FlushOutcome> => ({ kind: "flushed" });

function status(extra: Partial<VersioningStatus> = {}): VersioningStatus {
  return {
    git: true,
    repoRoot: ROOT,
    changed: false,
    lastVersion: null,
    blocked: null,
    enabled: true,
    optedOut: false,
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(backendOverrides: Record<string, unknown> = {}) {
  const backend = {
    rootPath: () => ROOT,
    versioningStatus: vi.fn(async (_path: Path) => status()),
    enableVersioningIfInside: vi.fn(async () => ({ enabled: false })),
    initVersioning: vi.fn(async () => ({ repoRoot: ROOT })),
    enableVersioning: vi.fn(async () => {}),
    commitVersion: vi.fn(async () => ({ id: "a".repeat(40) as string | null })),
    ...backendOverrides,
  };
  const modals = createModalsStore();
  const toasts = createToastsStore();
  const prompts = createPersistedStore<RepositoryPromptsState>(
    () => ({ declinedRoots: [], declinedRepositories: [] }),
    { name: "test-local-versioning-prompts", version: 1 },
  );
  const store = createLocalVersioningStore({
    // A stub with only what the store calls; not a third-party API.
    localBackend: () => backend as unknown as LocalBackend,
    modals,
    toasts,
    getText: useText().getText,
    prompts,
  });
  return { backend, modals, toasts, prompts, store };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("polling", () => {
  beforeEach(() => vi.useFakeTimers());

  test("reads the status at once, then every 5 s while the project is watched", async () => {
    const { backend, store } = setup();
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.versioningStatus).toHaveBeenCalledTimes(1);
    expect(backend.versioningStatus).toHaveBeenCalledWith(PROJECT_PATH);
    expect(store.statusOf(PROJECT)).toEqual(status());
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS);
    expect(backend.versioningStatus).toHaveBeenCalledTimes(2);
    store.unwatchProject(PROJECT);
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS);
    expect(backend.versioningStatus).toHaveBeenCalledTimes(2);
    expect(store.statusOf(PROJECT)).toBeUndefined();
  });

  test("never issues a request while one is pending; refreshes asked meanwhile run once after", async () => {
    const first = deferred<VersioningStatus>();
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(status({ changed: true }));
    const { store } = setup({ versioningStatus });
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(0);
    const a = store.refresh(PROJECT);
    const b = store.refresh(PROJECT);
    await vi.advanceTimersByTimeAsync(4 * VERSIONING_POLL_INTERVAL_MS);
    expect(versioningStatus).toHaveBeenCalledTimes(1);
    first.resolve(status());
    await a;
    await b;
    expect(versioningStatus).toHaveBeenCalledTimes(2);
    expect(store.statusOf(PROJECT)?.changed).toBe(true);
  });

  test("a poll waits 5 s after the previous answer, not after the previous question", async () => {
    const slow = deferred<VersioningStatus>();
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status())
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(status());
    const { store } = setup({ versioningStatus });
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS);
    expect(versioningStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS);
    expect(versioningStatus).toHaveBeenCalledTimes(2);
    slow.resolve(status());
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS);
    expect(versioningStatus).toHaveBeenCalledTimes(3);
  });

  test("a failed status keeps the previous one, and polling goes on", async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status({ changed: true }))
      .mockRejectedValueOnce(new Error("shim down"))
      .mockResolvedValue(status());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = setup({ versioningStatus });
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS);
    expect(store.statusOf(PROJECT)?.changed).toBe(true);
    expect(warn).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS);
    expect(store.statusOf(PROJECT)?.changed).toBe(false);
  });
});

describe("a repository that is not enabled", () => {
  beforeEach(() => vi.useFakeTimers());

  test("is offered to the shim once per session, and read again when enabled", async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status({ enabled: false }))
      .mockResolvedValue(status());
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: true }));
    const { store } = setup({ versioningStatus, enableVersioningIfInside });
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(0);
    expect(enableVersioningIfInside).toHaveBeenCalledWith(ROOT, ROOT);
    expect(store.isVersioned(PROJECT)).toBe(true);
  });

  test("outside the root it stays disabled, and is offered only once", async () => {
    const versioningStatus = vi.fn(async () =>
      status({ repoRoot: Path("/"), enabled: false }),
    );
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: false }));
    const { store } = setup({ versioningStatus, enableVersioningIfInside });
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS);
    expect(enableVersioningIfInside).toHaveBeenCalledTimes(1);
    expect(store.isVersioned(PROJECT)).toBe(false);
  });

  test("one the user turned off is not offered at all", async () => {
    const versioningStatus = vi.fn(async () =>
      status({ enabled: false, optedOut: true }),
    );
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: false }));
    const { store } = setup({ versioningStatus, enableVersioningIfInside });
    store.watchProject(PROJECT, FLUSHED);
    await vi.advanceTimersByTimeAsync(0);
    expect(enableVersioningIfInside).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/__tests__/localVersioning.test.ts
```

Expected: `Failed to resolve import "../localVersioning"`.

- [ ] **Step 3: Implement.** `app/gui/src/providers/localVersioning.ts`:

```ts
/**
 * @file Versioning of the open local projects with git, through the shim's `versioning/*` routes
 * (`LocalBackend`): each project's status, read when it opens and then every 5 s while it stays
 * open; saving a version; and offering a repository when none is in use. See the design,
 * `docs/superpowers/specs/2026-10-16-local-git-versioning-design.md`.
 *
 * Polling is this store's own loop, not vue-query: a project never has two status requests in
 * flight (an invalidation would cancel one and start another, while the shim still runs the first).
 * A refresh asked for while one is pending runs once, right after it.
 *
 * `projectStates.ts` tells the store when a local project is initialized and when it stops
 * (`watchProject`, `unwatchProject`); the store does not read the opened projects itself.
 */
import { useModals, type ModalsStore } from "$/providers/modals";
import type { FlushOutcome } from "$/providers/openedProjects/project/flush";
import { useText } from "$/providers/text";
import { useToasts, type ToastsStore } from "$/providers/toasts";
import {
  createPersistedStore,
  type PersistedStore,
} from "$/utils/persistedStore";
import { createGlobalState } from "@vueuse/core";
import {
  extractTypeAndPath,
  type Path,
  type ProjectId,
} from "enso-common/src/services/Backend";
import { LocalBackend } from "enso-common/src/services/LocalBackend";
import type { VersioningStatus } from "enso-common/src/services/ProjectManager/types";
import { shallowReactive } from "vue";
import { useBackends } from "./backends";

/** How often an open project's status is read, counted from the previous answer. */
export const VERSIONING_POLL_INTERVAL_MS = 5_000;

/** The answers to the repository prompts that last beyond a session (Task 19). */
export interface RepositoryPromptsState {
  /** Local roots for which "Don't ask again for this folder" was chosen at "Create". */
  readonly declinedRoots: readonly string[];
  /** Existing repositories for which "Don't ask again" was chosen at "Use". */
  readonly declinedRepositories: readonly string[];
}

/** What the store works with; the app's are {@link useLocalVersioning}'s, tests pass their own. */
export interface LocalVersioningDependencies {
  readonly localBackend: () => LocalBackend | null;
  readonly modals: ModalsStore;
  readonly toasts: ToastsStore;
  readonly getText: ReturnType<typeof useText>["getText"];
  readonly prompts: PersistedStore<RepositoryPromptsState>;
  readonly pollIntervalMs?: number;
}

interface WatchedProject {
  readonly path: Path;
  readonly flush: () => Promise<FlushOutcome>;
  timer: ReturnType<typeof setTimeout> | undefined;
  inFlight: Promise<void> | undefined;
  /** A refresh was asked for while one was in flight. */
  again: boolean;
  stopped: boolean;
}

/** Create the store. The app uses the global one, {@link useLocalVersioning}. */
export function createLocalVersioningStore(deps: LocalVersioningDependencies) {
  const pollIntervalMs = deps.pollIntervalMs ?? VERSIONING_POLL_INTERVAL_MS;
  const statuses = shallowReactive(new Map<ProjectId, VersioningStatus>());
  const watched = new Map<ProjectId, WatchedProject>();
  /** Repositories already offered to `enableVersioningIfInside` this session. */
  const offeredToShim = new Set<string>();

  async function readStatus(projectId: ProjectId, project: WatchedProject) {
    const backend = deps.localBackend();
    if (backend == null) return;
    try {
      let status = await backend.versioningStatus(project.path);
      if (
        status.git &&
        status.repoRoot != null &&
        !status.enabled &&
        !status.optedOut &&
        !offeredToShim.has(status.repoRoot)
      ) {
        offeredToShim.add(status.repoRoot);
        const { enabled } = await backend.enableVersioningIfInside(
          status.repoRoot,
          backend.rootPath(),
        );
        if (enabled) status = await backend.versioningStatus(project.path);
      }
      if (!project.stopped) statuses.set(projectId, status);
    } catch (error) {
      console.warn(
        `Could not read the versioning status of '${project.path}':`,
        error,
      );
    }
  }

  function refresh(projectId: ProjectId): Promise<void> {
    const project = watched.get(projectId);
    if (project == null) return Promise.resolve();
    if (project.inFlight != null) {
      project.again = true;
      return project.inFlight;
    }
    clearTimeout(project.timer);
    project.timer = undefined;
    project.inFlight = (async () => {
      try {
        do {
          project.again = false;
          await readStatus(projectId, project);
        } while (project.again && !project.stopped);
      } finally {
        project.inFlight = undefined;
        if (!project.stopped) {
          project.timer = setTimeout(
            () => void refresh(projectId),
            pollIntervalMs,
          );
        }
      }
    })();
    return project.inFlight;
  }

  function watchProject(
    projectId: ProjectId,
    flush: () => Promise<FlushOutcome>,
  ) {
    unwatchProject(projectId);
    watched.set(projectId, {
      path: extractTypeAndPath(projectId).path,
      flush,
      timer: undefined,
      inFlight: undefined,
      again: false,
      stopped: false,
    });
    void refresh(projectId);
  }

  function unwatchProject(projectId: ProjectId) {
    const project = watched.get(projectId);
    if (project == null) return;
    project.stopped = true;
    clearTimeout(project.timer);
    watched.delete(projectId);
    statuses.delete(projectId);
  }

  function statusOf(projectId: ProjectId) {
    return statuses.get(projectId);
  }

  function isVersioned(projectId: ProjectId) {
    return statuses.get(projectId)?.enabled === true;
  }

  return { watchProject, unwatchProject, refresh, statusOf, isVersioned };
}

/** The store's type. */
export type LocalVersioningStore = ReturnType<
  typeof createLocalVersioningStore
>;

/** The app's local versioning store. */
export const useLocalVersioning = createGlobalState(() => {
  const backends = useBackends();
  return createLocalVersioningStore({
    localBackend: () => {
      const backend = backends.localBackend;
      return backend instanceof LocalBackend ? backend : null;
    },
    modals: useModals(),
    toasts: useToasts(),
    getText: useText().getText,
    prompts: createPersistedStore<RepositoryPromptsState>(
      () => ({ declinedRoots: [], declinedRepositories: [] }),
      { name: "enso-local-versioning-prompts", version: 1 },
    ),
  });
});
```

Wire it into `projectStates.ts`: import `useLocalVersioning` from
`'../localVersioning'`; in `useProjectStates`,
`const localVersioning = useLocalVersioning()`; in `initializeProject`'s final
`scope.run(() => { … })`, before `return Ok(markRaw({ … }))`:

```ts
if (project.info.mode === "local") {
  const projectId = project.info.id;
  localVersioning.watchProject(projectId, () => store.flushModules());
  onScopeDispose(() => localVersioning.unwatchProject(projectId));
}
```

- [ ] **Step 4: Run the tests, typecheck and lint; they pass.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/__tests__/localVersioning.test.ts
corepack pnpm -C app/gui run typecheck
corepack pnpm -C app/gui exec eslint src/providers/localVersioning.ts src/providers/__tests__/localVersioning.test.ts src/providers/openedProjects/projectStates.ts
```

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/providers
git commit -m "GUI: poll each open local project's versioning status, never overlapping requests"
```

---

### Task 19: offering a repository: "Create" when there is none, "Use" for an existing one

**Files:**

- Create: `app/gui/src/components/LocalVersioning/RepositoryPromptModal.vue`,
  `app/gui/src/components/LocalVersioning/__tests__/RepositoryPromptModal.test.ts`
- Modify: `app/gui/src/providers/localVersioning.ts`, its test;
  `app/common/src/text/english.json`

**Interfaces:**

Consumes: `ModalsStore.ask` and `close`, `AlertDialog.vue` (its default slot
gets `{ confirm, cancel }`), `initVersioning`, `enableVersioning`.

Produces, on the store:

```ts
/** What became of {@link offerRepository}. */
export type RepositoryOffer =
  | 'ready'        // the repository is enabled: versions are kept
  | 'declined'     // the user chose Not now or Don't ask again, earlier or now, or opted out
  | 'outsideRoot'  // no repository, and the project is outside the local root: none is offered
  | 'noGit'
  | 'unavailable'  // not watched, no local backend, or quitting
offerRepository(projectId: ProjectId, reason: 'close' | 'save'): Promise<RepositoryOffer>
setQuitting(quitting: boolean): void
resetPrompts(): void
```

```ts
// RepositoryPromptModal.vue props
kind: 'create' | 'use'
folder: string
onDontAskAgain: () => void
onConfirm?: () => unknown
onCancel?: () => unknown
// emits close
```

Texts (add after `"syncingProjectsMessage"`):

```json
  "versioningCreateTitle": "Keep versions of your projects?",
  "versioningCreateMessage": "Keep versions of your projects with git? This creates a repository in $0.",
  "versioningCreate": "Create",
  "versioningUseTitle": "Use the existing repository?",
  "versioningUseMessage": "Keep versions of your projects in the existing repository at $0?",
  "versioningUse": "Use",
  "versioningNotNow": "Not now",
  "versioningDontAskAgainForFolder": "Don't ask again for this folder",
  "versioningDontAskAgain": "Don't ask again",
  "versioningSetupError": "Could not set up versions",
```

- [ ] **Step 1: Write the failing tests.** `RepositoryPromptModal.test.ts`:

```ts
/** @file The repository prompt's three answers, asked through the modal stack. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from "$/components/__tests__/mountWithProviders";
import RepositoryPromptModal from "$/components/LocalVersioning/RepositoryPromptModal.vue";
import ModalHost from "$/components/ModalHost/ModalHost.vue";
import { createModalsStore } from "$/providers/modals";
import userEvent from "@testing-library/user-event";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { h } from "vue";

usePrimitiveTestEnvironment();

const dialog = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]')!;

function setup() {
  const store = createModalsStore();
  mountWithProviders(() => h(ModalHost, { store }));
  return store;
}

describe("RepositoryPromptModal", () => {
  test('"create" names the root, and confirms with Create', async () => {
    const store = setup();
    const answer = store.ask(RepositoryPromptModal, {
      kind: "create",
      folder: "/home/me/enso-projects",
      onDontAskAgain: vi.fn(),
    });
    await flushPromises();
    expect(dialog().textContent).toContain(
      "Keep versions of your projects with git? This creates a repository in /home/me/enso-projects.",
    );
    expect(byTestId("alert-dialog-confirm")!.textContent!.trim()).toBe(
      "Create",
    );
    expect(byTestId("alert-dialog-cancel")!.textContent!.trim()).toBe(
      "Not now",
    );
    expect(
      byTestId("repository-prompt-dont-ask-again")!.textContent!.trim(),
    ).toBe("Don't ask again for this folder");
    await userEvent.click(byTestId("alert-dialog-confirm")!);
    await expect(answer).resolves.toBe("confirm");
  });

  test('"use" names the repository; Don\'t ask again dismisses and reports it', async () => {
    const store = setup();
    const onDontAskAgain = vi.fn();
    const answer = store.ask(RepositoryPromptModal, {
      kind: "use",
      folder: "/home/me",
      onDontAskAgain,
    });
    await flushPromises();
    expect(dialog().textContent).toContain(
      "Keep versions of your projects in the existing repository at /home/me?",
    );
    expect(byTestId("alert-dialog-confirm")!.textContent!.trim()).toBe("Use");
    await userEvent.click(byTestId("repository-prompt-dont-ask-again")!);
    await expect(answer).resolves.toBe("dismiss");
    expect(onDontAskAgain).toHaveBeenCalledOnce();
  });

  test('Not now dismisses without "Don\'t ask again"', async () => {
    const store = setup();
    const onDontAskAgain = vi.fn();
    const answer = store.ask(RepositoryPromptModal, {
      kind: "create",
      folder: "/r",
      onDontAskAgain,
    });
    await flushPromises();
    await userEvent.click(byTestId("alert-dialog-cancel")!);
    await expect(answer).resolves.toBe("dismiss");
    expect(onDontAskAgain).not.toHaveBeenCalled();
  });
});
```

Provider tests, appended. These tests mount no `ModalHost`, and a modal leaves
the stack only when it is closed (S5). So the helper answers through the props,
then closes the modal itself, as the host would on `close`:

```ts
/** Answer the repository prompt on top of the stack, and take it off, as the host would. */
async function answerPrompt(
  modals: ReturnType<typeof createModalsStore>,
  answer: "accept" | "notNow" | "dontAskAgain",
) {
  await vi.waitFor(() => expect(modals.stack.value).toHaveLength(1));
  const entry = modals.stack.value[0]!;
  const props = entry.props as {
    onConfirm: () => Promise<void>;
    onCancel: () => Promise<void>;
    onDontAskAgain: () => void;
  };
  if (answer === "accept") await props.onConfirm();
  else {
    if (answer === "dontAskAgain") props.onDontAskAgain();
    await props.onCancel();
  }
  modals.close(entry.key);
}

describe("offerRepository", () => {
  const noRepository = () =>
    status({ repoRoot: null, enabled: false, changed: true });

  test("Create makes a repository at the root; the project is then versioned", async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(noRepository())
      .mockResolvedValueOnce(noRepository())
      .mockResolvedValue(status({ changed: true }));
    const { backend, modals, store } = setup({ versioningStatus });
    store.watchProject(PROJECT, FLUSHED);
    const offered = store.offerRepository(PROJECT, "save");
    await answerPrompt(modals, "accept");
    await expect(offered).resolves.toBe("ready");
    expect(backend.initVersioning).toHaveBeenCalledWith(ROOT);
    expect(modals.stack.value).toHaveLength(0);
  });

  test("Not now: a close does not ask again this session, a save does", async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () => noRepository()),
    });
    store.watchProject(PROJECT, FLUSHED);
    const first = store.offerRepository(PROJECT, "close");
    await answerPrompt(modals, "notNow");
    await expect(first).resolves.toBe("declined");
    await expect(store.offerRepository(PROJECT, "close")).resolves.toBe(
      "declined",
    );
    expect(modals.stack.value).toHaveLength(0);
    const save = store.offerRepository(PROJECT, "save");
    await answerPrompt(modals, "notNow");
    await expect(save).resolves.toBe("declined");
  });

  test("Don't ask again is remembered per root, until reset", async () => {
    const { modals, prompts, store } = setup({
      versioningStatus: vi.fn(async () => noRepository()),
    });
    store.watchProject(PROJECT, FLUSHED);
    const first = store.offerRepository(PROJECT, "save");
    await answerPrompt(modals, "dontAskAgain");
    await expect(first).resolves.toBe("declined");
    expect(prompts.getState().declinedRoots).toEqual([ROOT]);
    await expect(store.offerRepository(PROJECT, "save")).resolves.toBe(
      "declined",
    );
    expect(modals.stack.value).toHaveLength(0);
    store.resetPrompts();
    expect(prompts.getState()).toEqual({
      declinedRoots: [],
      declinedRepositories: [],
    });
    void store.offerRepository(PROJECT, "save");
    await vi.waitFor(() => expect(modals.stack.value).toHaveLength(1));
  });

  test("Use enables an existing repository outside the root", async () => {
    const outside = status({ repoRoot: Path("/"), enabled: false });
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(outside)
      .mockResolvedValueOnce(outside)
      .mockResolvedValue(status({ repoRoot: Path("/") }));
    const { backend, modals, store } = setup({ versioningStatus });
    store.watchProject(PROJECT, FLUSHED);
    const offered = store.offerRepository(PROJECT, "save");
    await answerPrompt(modals, "accept");
    await expect(offered).resolves.toBe("ready");
    expect(backend.enableVersioning).toHaveBeenCalledWith("/");
  });

  test("a repository the user turned off is not offered", async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () =>
        status({ enabled: false, optedOut: true }),
      ),
    });
    store.watchProject(PROJECT, FLUSHED);
    await expect(store.offerRepository(PROJECT, "save")).resolves.toBe(
      "declined",
    );
    expect(modals.stack.value).toHaveLength(0);
  });

  test("nothing is asked while quitting", async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () => noRepository()),
    });
    store.watchProject(PROJECT, FLUSHED);
    store.setQuitting(true);
    await expect(store.offerRepository(PROJECT, "close")).resolves.toBe(
      "unavailable",
    );
    expect(modals.stack.value).toHaveLength(0);
  });

  test("nothing is asked for a project outside the root with no repository", async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () => noRepository()),
    });
    const elsewhere = newProjectId(Path("/elsewhere/Q"));
    store.watchProject(elsewhere, FLUSHED);
    await expect(store.offerRepository(elsewhere, "save")).resolves.toBe(
      "outsideRoot",
    );
    expect(modals.stack.value).toHaveLength(0);
  });

  test("nothing is asked without git", async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () =>
        status({ git: false, repoRoot: null, enabled: false }),
      ),
    });
    store.watchProject(PROJECT, FLUSHED);
    await expect(store.offerRepository(PROJECT, "save")).resolves.toBe("noGit");
    expect(modals.stack.value).toHaveLength(0);
  });

  test("an enabled repository needs no question", async () => {
    const { modals, store } = setup();
    store.watchProject(PROJECT, FLUSHED);
    await expect(store.offerRepository(PROJECT, "save")).resolves.toBe("ready");
    expect(modals.stack.value).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/__tests__/localVersioning.test.ts src/components/LocalVersioning
```

- [ ] **Step 3: Implement.** `RepositoryPromptModal.vue`:

```vue
<script setup lang="ts">
/**
 * @file The question asked before a local project's first version is kept: create a repository at
 * the local root ("create"), or use the existing repository the projects are in ("use"). Its three
 * answers are Create (or Use), Not now, and Don't ask again (for this folder).
 *
 * It is meant for the modal stack's `ask`: confirming resolves `'confirm'`, the other two
 * `'dismiss'`, and "Don't ask again" first calls `onDontAskAgain`. It emits `close` once it has
 * closed and its exit animation has ended, which takes it off the stack.
 */
import AlertDialog from "$/components/AlertDialog/AlertDialog.vue";
import Button from "$/components/Button/Button.vue";
import Text from "$/components/Text/Text.vue";
import { useText } from "$/providers/text";
import { ref } from "vue";

const { kind, folder, onDontAskAgain, onConfirm, onCancel } = defineProps<{
  kind: "create" | "use";
  folder: string;
  onDontAskAgain: () => void;
  onConfirm?: (() => unknown) | undefined;
  onCancel?: (() => unknown) | undefined;
}>();

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: [];
}>();

const { getText } = useText();

const open = ref(true);

function dontAskAgain(cancel: () => void) {
  onDontAskAgain();
  cancel();
}
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="
      getText(
        kind === 'create' ? 'versioningCreateTitle' : 'versioningUseTitle',
      )
    "
    :confirm="getText(kind === 'create' ? 'versioningCreate' : 'versioningUse')"
    :cancel="getText('versioningNotNow')"
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    testId="repository-prompt"
    @closed="emit('close')"
  >
    <template #default="{ cancel }">
      <Text>
        {{
          getText(
            kind === "create"
              ? "versioningCreateMessage"
              : "versioningUseMessage",
            folder,
          )
        }}
      </Text>
      <Button
        variant="link"
        size="small"
        testId="repository-prompt-dont-ask-again"
        @press="dontAskAgain(cancel)"
      >
        {{
          getText(
            kind === "create"
              ? "versioningDontAskAgainForFolder"
              : "versioningDontAskAgain",
          )
        }}
      </Button>
    </template>
  </AlertDialog>
</template>
```

Decision: "Don't ask again" is a link-style button under the message, because
`AlertDialog`'s button row has exactly confirm and cancel, and its slot already
receives `cancel`. Before using `variant="link"`, run
`grep -n "link\|ghost" src/components/Button/variants.ts`; if there is no `link`
variant, use `ghost`.

In `localVersioning.ts`, import `RepositoryPromptModal` from
`'$/components/LocalVersioning/RepositoryPromptModal.vue'` and
`getMessageOrToString` from `'enso-common/src/utilities/errors'`, and export the
`RepositoryOffer` type above. Inside the store:

```ts
let quitting = false;
/** Folders answered "Not now" this session. */
const notNowThisSession = new Set<string>();

/** Whether `path` is `folder` or inside it; both are the GUI's own spellings of local paths. */
function isAtOrUnder(path: string, folder: string) {
  return (
    path === folder ||
    path.startsWith(folder.endsWith("/") ? folder : `${folder}/`)
  );
}

async function askRepository(kind: "create" | "use", folder: string) {
  let dontAskAgain = false;
  const answer = await deps.modals.ask(RepositoryPromptModal, {
    kind,
    folder,
    onDontAskAgain: () => {
      dontAskAgain = true;
    },
  });
  return answer === "confirm"
    ? "accept"
    : dontAskAgain
      ? "dontAskAgain"
      : "notNow";
}

async function offerRepository(
  projectId: ProjectId,
  reason: "close" | "save",
): Promise<RepositoryOffer> {
  const project = watched.get(projectId);
  const backend = deps.localBackend();
  if (project == null || backend == null || quitting) return "unavailable";
  await refresh(projectId);
  const status = statuses.get(projectId);
  if (status == null) return "unavailable";
  if (!status.git) return "noGit";
  if (status.enabled) return "ready";
  if (status.optedOut) return "declined";
  const kind = status.repoRoot == null ? "create" : "use";
  const folder = status.repoRoot ?? backend.rootPath();
  // A saved local directory outside the root is versioned only if already in a repository.
  if (kind === "create" && !isAtOrUnder(project.path, folder))
    return "outsideRoot";
  const { declinedRoots, declinedRepositories } = deps.prompts.getState();
  if (
    (kind === "create" ? declinedRoots : declinedRepositories).includes(folder)
  )
    return "declined";
  if (reason === "close" && notNowThisSession.has(folder)) return "declined";
  switch (await askRepository(kind, folder)) {
    case "notNow":
      notNowThisSession.add(folder);
      return "declined";
    case "dontAskAgain":
      deps.prompts.setState(
        kind === "create"
          ? { declinedRoots: [...declinedRoots, folder] }
          : { declinedRepositories: [...declinedRepositories, folder] },
      );
      return "declined";
    case "accept":
      try {
        if (kind === "create") await backend.initVersioning(folder);
        else await backend.enableVersioning(folder);
      } catch (error) {
        deps.toasts.show(
          `${deps.getText("versioningSetupError")}: ${getMessageOrToString(error)}`,
          { type: "error" },
        );
        return "declined";
      }
      await refresh(projectId);
      return statuses.get(projectId)?.enabled === true ? "ready" : "declined";
  }
}

function setQuitting(value: boolean) {
  quitting = value;
}

function resetPrompts() {
  deps.prompts.setState({ declinedRoots: [], declinedRepositories: [] });
  notNowThisSession.clear();
}
```

Add `offerRepository, setQuitting, resetPrompts` to the returned object.

Decision: the "inside the root" check for _creating_ a repository compares the
GUI's own path strings. The project's path comes from listing that same root, so
it is spelt the same way. Only existing repositories, whose paths come from git,
are compared by real path, in the shim (Task 15b).

- [ ] **Step 4: Run the tests; they pass.** Then run the typecheck, and lint the
      touched files.

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/providers app/gui/src/components/LocalVersioning app/common/src/text/english.json
git commit -m "GUI: offer a repository (Create, or Use an existing one) before the first version"
```

---

### Task 20: saving: Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, the save dialog and the save action

**Files:**

- Modify: `app/gui/src/providers/localVersioning.ts`, its test
- Create: `app/gui/src/components/LocalVersioning/SaveVersionModal.vue`,
  `__tests__/SaveVersionModal.test.ts`
- Modify: `app/gui/src/configurations/graphInputBindings.ts`,
  `__tests__/keyboardShortcuts.test.ts`
- Modify: `app/gui/src/project-view/providers/action.ts`,
  `__tests__/action.test.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor.vue`
- Modify: `app/gui/src/project-view/assets/icons.svg`, regenerate `iconName.ts`
- Modify: `app/common/src/text/english.json`

**Interfaces:**

Consumes: `watched.flush` (Task 17), `offerRepository` (Task 19),
`commitVersion` (Task 16), `registerHandlers`, `useCurrentProject` (`id`,
`info`).

Produces, on the store:

```ts
/**
 * Save a version: make sure a repository is in use (Task 19), write the open modules (Task 17),
 * then commit with `comment` as given (the shim saves an empty one as "Saved"). A declined write
 * is a failure: an error toast, and no commit.
 */
save(projectId: ProjectId, comment?: string): Promise<void>
askToSave(projectId: ProjectId): void
/** Off when blocked, or when an enabled repository has nothing to save. */
canSave(projectId: ProjectId): boolean
```

The actions are `graph.saveVersion` (`Mod+S`) and `graph.saveVersionWithComment`
(`Mod+Shift+S`), both with the icon `save` in the category `graphEditor`. They
are added right after `graph.redo`. `Mod+Shift+S` is also the drive's
`download`, but that shortcut is in the `drive` scope, so the two do not
conflict.

Decision (M10): the shortcuts are graph-scoped, like undo and redo. While the
focus is in the code editor or the documentation panel, those widgets keep their
own keys, so Ctrl/Cmd+S does nothing there. **Raise this with the user** in the
PR body. Making the shortcut work there would need an app-scope binding, and
that would change the conflict rules.

Texts:

```json
  "graphSaveVersionShortcut": "Save Version",
  "graphSaveVersionWithCommentShortcut": "Save Version with Comment",
  "saveVersionTitle": "Save a version",
  "saveVersionCommentLabel": "Comment (optional)",
  "saveVersionSave": "Save",
  "versionSaved": "Version saved",
  "versionSavedAfterWaiting": "Version saved, after waiting for the project to write its changes",
  "versionNothingToSave": "Nothing has changed since the last version",
  "saveVersionError": "Could not save a version",
  "versioningOffForFolder": "Versions are off for this folder. Turn them on in Settings → Local.",
  "versioningNotForThisFolder": "This project is outside your projects folder and in no git repository, so no versions are kept for it.",
  "versioningBlocked": "Versions cannot be saved: $0",
```

- [ ] **Step 1: Write the failing tests.** Append to the provider test:

```ts
describe("save", () => {
  test("writes the open modules, then commits with the comment as given", async () => {
    const order: string[] = [];
    const commitVersion = vi.fn(async () => {
      order.push("commit");
      return { id: "a".repeat(40) as string | null };
    });
    const { toasts, store } = setup({
      versioningStatus: vi.fn(async () => status({ changed: true })),
      commitVersion,
    });
    store.watchProject(PROJECT, async () => {
      order.push("flush");
      return { kind: "flushed" };
    });
    await store.save(PROJECT);
    await store.save(PROJECT, "Joined the sales table");
    expect(order).toEqual(["flush", "commit", "flush", "commit"]);
    expect(commitVersion.mock.calls.map((call) => call[1])).toEqual([
      "",
      "Joined the sales table",
    ]);
    expect(toasts.toasts.value.map((t) => [t.type, t.content])).toContainEqual([
      "success",
      "Version saved",
    ]);
  });

  test("after waiting for the auto-save, the toast says so", async () => {
    const { toasts, store } = setup();
    store.watchProject(PROJECT, async () => ({ kind: "waited" }));
    await store.save(PROJECT);
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "success",
      content:
        "Version saved, after waiting for the project to write its changes",
    });
  });

  test("a declined write is an error toast, and nothing is committed", async () => {
    const { backend, toasts, store } = setup();
    store.watchProject(PROJECT, async () => ({
      kind: "declined",
      reason: "src/Main.enso was changed on disk.",
    }));
    await store.save(PROJECT);
    expect(backend.commitVersion).not.toHaveBeenCalled();
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "error",
      content: "Could not save a version: src/Main.enso was changed on disk.",
    });
  });

  test("nothing to commit is an info toast", async () => {
    const { toasts, store } = setup({
      commitVersion: vi.fn(async () => ({ id: null })),
    });
    store.watchProject(PROJECT, FLUSHED);
    await store.save(PROJECT);
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "info",
      content: "Nothing has changed since the last version",
    });
  });

  test("a failed commit shows git’s message in an error toast", async () => {
    const { toasts, store } = setup({
      commitVersion: vi.fn(async () => {
        throw new Error("index.lock exists");
      }),
    });
    store.watchProject(PROJECT, FLUSHED);
    await store.save(PROJECT);
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "error",
      content: "Could not save a version: index.lock exists",
    });
  });

  test("blocked: an error toast with git’s message, and no commit", async () => {
    const { backend, toasts, store } = setup({
      versioningStatus: vi.fn(async () =>
        status({ blocked: "A merge is in progress." }),
      ),
    });
    store.watchProject(PROJECT, FLUSHED);
    await store.save(PROJECT);
    expect(backend.commitVersion).not.toHaveBeenCalled();
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "error",
      content: "Versions cannot be saved: A merge is in progress.",
    });
  });

  test("outside the root, with no repository, it says why nothing is saved", async () => {
    const { toasts, store } = setup({
      versioningStatus: vi.fn(async () =>
        status({ repoRoot: null, enabled: false }),
      ),
    });
    const elsewhere = newProjectId(Path("/elsewhere/Q"));
    store.watchProject(elsewhere, FLUSHED);
    await store.save(elsewhere);
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "info",
      content:
        "This project is outside your projects folder and in no git repository, so no versions are kept for it.",
    });
  });

  test.each([
    [status({ changed: true }), true],
    [status({ changed: false }), false],
    [status({ changed: true, blocked: "merge" }), false],
    [status({ repoRoot: null, enabled: false }), true],
    [status({ git: false, repoRoot: null, enabled: false }), false],
  ])("canSave(%j) is %s", async (current, expected) => {
    const { store } = setup({ versioningStatus: vi.fn(async () => current) });
    store.watchProject(PROJECT, FLUSHED);
    await store.refresh(PROJECT);
    expect(store.canSave(PROJECT)).toBe(expected);
  });

  test("askToSave opens the dialog, whose Save saves with its comment", async () => {
    const { backend, modals, store } = setup();
    store.watchProject(PROJECT, FLUSHED);
    store.askToSave(PROJECT);
    const props = modals.stack.value[0]!.props as {
      onSave: (comment: string) => Promise<void>;
    };
    await props.onSave("From the dialog");
    expect(backend.commitVersion).toHaveBeenCalledWith(
      PROJECT,
      "From the dialog",
    );
  });
});
```

`SaveVersionModal.test.ts`, with the same harness as Task 19's modal test.
`BasicInput` overrides a `data-testid` passed to it (S7), so the field is found
by its accessible name:

```ts
const comment = () =>
  document.querySelector<HTMLInputElement>(
    'input[aria-label="Comment (optional)"]',
  )!;

describe("SaveVersionModal", () => {
  test("opens with the focus in the comment; Enter saves with it", async () => {
    const store = setup();
    const onSave = vi.fn();
    store.open(SaveVersionModal, { onSave });
    await flushPromises();
    await vi.waitFor(() => expect(document.activeElement).toBe(comment()));
    await userEvent.type(comment(), "Cleaned the dates{Enter}");
    expect(onSave).toHaveBeenCalledWith("Cleaned the dates");
    await vi.waitFor(() => expect(store.stack.value).toHaveLength(0));
  });

  test("Save with no comment saves an empty one; Cancel saves nothing", async () => {
    const store = setup();
    const onSave = vi.fn();
    store.open(SaveVersionModal, { onSave });
    await flushPromises();
    await userEvent.click(byTestId("save-version-save")!);
    expect(onSave).toHaveBeenCalledWith("");
    await vi.waitFor(() => expect(store.stack.value).toHaveLength(0));
    store.open(SaveVersionModal, { onSave });
    await flushPromises();
    await userEvent.click(byTestId("save-version-cancel")!);
    await vi.waitFor(() => expect(store.stack.value).toHaveLength(0));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
```

`keyboardShortcuts.test.ts`, in
`'are exactly those before #170, in the same order'` (S6): add
`'graph.saveVersion': ['Mod+S'],` and
`'graph.saveVersionWithComment': ['Mod+Shift+S'],` right after the
`'graph.redo'` line of the `toStrictEqual` object, and `'graph.saveVersion',`
and `'graph.saveVersionWithComment',` after `'graph.redo',` in the key-order
array. Rename the test to
`'are those before #170, with saving after redo, in this order'`. Add:

```ts
test("saving a version conflicts with nothing in the defaults", () => {
  const conflicts = currentConflicts(defaultShortcuts());
  expect([...conflicts.keys()]).not.toContain("graph.saveVersion");
  expect([...conflicts.keys()]).not.toContain("graph.saveVersionWithComment");
});
```

`project-view/providers/__tests__/action.test.ts`:

```ts
describe("saving actions", () => {
  test("are registered with the save icon, their names and Mod+S / Mod+Shift+S", () => {
    const actions = withSetup(() => initializeActions());
    const save = actions["graph.saveVersion"];
    const withComment = actions["graph.saveVersionWithComment"];
    expect(save.icon).toBe("save");
    expect(save.description).toBe("Save Version");
    expect(toValue(save.shortcut)?.key).toBe("S");
    expect(toValue(save.shortcut)?.modifiers).toEqual(["Mod"]);
    expect(withComment.description).toBe("Save Version with Comment");
    expect(toValue(withComment.shortcut)?.modifiers).toEqual(["Mod", "Shift"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/__tests__/localVersioning.test.ts src/components/LocalVersioning src/configurations/__tests__/keyboardShortcuts.test.ts src/project-view/providers/__tests__/action.test.ts
```

- [ ] **Step 3: Implement.** `SaveVersionModal.vue`:

```vue
<script setup lang="ts">
/**
 * @file The "Save a version" dialog (Ctrl/Cmd+Shift+S, the top bar's save icon): an optional
 * comment, saved with Enter or Save. An empty comment is saved as "Saved" by the shim.
 *
 * It is meant for the modal stack (`open`). It emits `close` once it has closed and its exit
 * animation has ended.
 */
import Button from "$/components/Button/Button.vue";
import ButtonGroup from "$/components/Button/ButtonGroup.vue";
import Dialog from "$/components/Dialog/Dialog.vue";
import BasicInput from "$/components/Inputs/BasicInput.vue";
import { useText } from "$/providers/text";
import { ref } from "vue";

const { onSave } = defineProps<{
  /** Save with the comment the user wrote (`''` for none). */
  onSave: (comment: string) => unknown;
}>();

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: [];
}>();

const { getText } = useText();

const open = ref(true);
const comment = ref("");

function save() {
  void onSave(comment.value);
  open.value = false;
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="getText('saveVersionTitle')"
    @closed="emit('close')"
  >
    <form class="flex flex-col gap-4" @submit.prevent="save">
      <BasicInput
        v-model="comment"
        autoFocus
        :placeholder="getText('saveVersionCommentLabel')"
        :aria-label="getText('saveVersionCommentLabel')"
      />
      <ButtonGroup align="end">
        <Button
          variant="ghost"
          testId="save-version-cancel"
          @press="open = false"
        >
          {{ getText("cancel") }}
        </Button>
        <Button type="submit" testId="save-version-save">{{
          getText("saveVersionSave")
        }}</Button>
      </ButtonGroup>
    </form>
  </Dialog>
</template>
```

Decision: this is a plain `Dialog` with a form, not an `AlertDialog`, because
`AlertDialog` moves the focus to its confirm button and the comment field must
have it. The pre-flight review checked that `Button` has `type="submit"` and
`Dialog` has `v-model:open`/`@closed`.

Provider, in the store (import `SaveVersionModal` as for the prompt):

```ts
async function save(projectId: ProjectId, comment = "") {
  const project = watched.get(projectId);
  const backend = deps.localBackend();
  if (project == null || backend == null) return;
  const offer = await offerRepository(projectId, "save");
  if (offer !== "ready") {
    if (offer === "declined")
      deps.toasts.show(deps.getText("versioningOffForFolder"), {
        type: "info",
      });
    else if (offer === "outsideRoot")
      deps.toasts.show(deps.getText("versioningNotForThisFolder"), {
        type: "info",
      });
    return;
  }
  const blocked = statuses.get(projectId)?.blocked;
  if (blocked != null) {
    deps.toasts.show(deps.getText("versioningBlocked", blocked), {
      type: "error",
    });
    return;
  }
  try {
    const written = await project.flush();
    if (written.kind === "declined") {
      deps.toasts.show(
        `${deps.getText("saveVersionError")}: ${written.reason}`,
        {
          type: "error",
        },
      );
      return;
    }
    const { id } = await backend.commitVersion(projectId, comment);
    if (id == null) {
      deps.toasts.show(deps.getText("versionNothingToSave"), { type: "info" });
    } else {
      deps.toasts.show(
        deps.getText(
          written.kind === "waited"
            ? "versionSavedAfterWaiting"
            : "versionSaved",
        ),
        { type: "success" },
      );
    }
  } catch (error) {
    deps.toasts.show(
      `${deps.getText("saveVersionError")}: ${getMessageOrToString(error)}`,
      {
        type: "error",
      },
    );
  } finally {
    await refresh(projectId);
  }
}

function askToSave(projectId: ProjectId) {
  deps.modals.open(SaveVersionModal, {
    onSave: (comment: string) => save(projectId, comment),
  });
}

function canSave(projectId: ProjectId) {
  const status = statuses.get(projectId);
  if (status == null || !status.git || status.blocked != null) return false;
  return !status.enabled || status.repoRoot == null || status.changed;
}
```

Return `save, askToSave, canSave`.

`graphInputBindings.ts`, after `'graph.redo'`:

```ts
    'graph.saveVersion': { bindings: ['Mod+S'], icon: 'save', category: 'graphEditor' },
    'graph.saveVersionWithComment': {
      bindings: ['Mod+Shift+S'],
      icon: 'save',
      category: 'graphEditor',
    },
```

`action.ts`, after `'graph.redo'`:

```ts
  'graph.saveVersion': {
    icon: 'save',
    description: 'Save Version',
    shortcut: () => graphBindings.bindings['graph.saveVersion'],
  },
  'graph.saveVersionWithComment': {
    icon: 'save',
    description: 'Save Version with Comment',
    shortcut: () => graphBindings.bindings['graph.saveVersionWithComment'],
  },
```

`GraphEditor.vue`:

- import `useLocalVersioning` from `'$/providers/localVersioning'` and `useText`
  from `'$/providers/text'`;
- add `const localVersioning = useLocalVersioning()` and
  `const { getText } = useText()`;
- in `registerHandlers({ … })`, after `'graph.redo'`:

```ts
  'graph.saveVersion': {
    available: () =>
      projectInfo.value.mode === 'local' && localVersioning.statusOf(assetId.value)?.git === true,
    enabled: () => localVersioning.canSave(assetId.value),
    description: () => {
      const blocked = localVersioning.statusOf(assetId.value)?.blocked
      return blocked != null ? getText('versioningBlocked', blocked) : undefined
    },
    action: () => void localVersioning.save(assetId.value),
  },
  'graph.saveVersionWithComment': {
    available: () =>
      projectInfo.value.mode === 'local' && localVersioning.statusOf(assetId.value)?.git === true,
    enabled: () => localVersioning.canSave(assetId.value),
    description: () => {
      const blocked = localVersioning.statusOf(assetId.value)?.blocked
      return blocked != null ? getText('versioningBlocked', blocked) : undefined
    },
    action: () => localVersioning.askToSave(assetId.value),
  },
```

`combineToValues` falls back to the static description when an override returns
`undefined`, so the tooltip shows git's message only while the repository is
blocked. `graphBindingsHandler` already skips a disabled action, so Ctrl+S with
nothing to save does nothing, just as the greyed icon does. Do not add the
actions to `contextMenuActions`.

`icons.svg`, after `"row_remove"`:

```xml
  <symbol id="save" viewBox="0 0 16 16" width="16" height="16" fill="none">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M3 1.5H10.59C10.98 1.5 11.36 1.66 11.65 1.94L14.06 4.35C14.34 4.64 14.5 5.02 14.5 5.41V13C14.5 13.83 13.83 14.5 13 14.5H3C2.17 14.5 1.5 13.83 1.5 13V3C1.5 2.17 2.17 1.5 3 1.5ZM4.5 3V5.5C4.5 5.78 4.72 6 5 6H10C10.28 6 10.5 5.78 10.5 5.5V3H4.5ZM8 8.5C6.9 8.5 6 9.4 6 10.5C6 11.6 6.9 12.5 8 12.5C9.1 12.5 10 11.6 10 10.5C10 9.4 9.1 8.5 8 8.5Z" fill="currentColor"></path>
  </symbol>
```

Then regenerate the name list with
`corepack pnpm --filter enso-gui run generate-icons`.

- [ ] **Step 4: Run the tests, the icon style check, typecheck and lint; they
      pass.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers/__tests__/localVersioning.test.ts src/components/LocalVersioning src/configurations src/project-view/providers src/project-view/assets/__tests__/iconStyle.test.ts
corepack pnpm -C app/gui run typecheck
corepack pnpm -C app/gui exec eslint src/providers/localVersioning.ts src/components/LocalVersioning src/configurations/graphInputBindings.ts src/project-view/providers/action.ts src/project-view/components/GraphEditor.vue
```

Never add `save` to `iconStyleKnownViolations.ts`. If it breaks a rule, redraw
it.

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src app/common/src/text/english.json
git commit -m "GUI: save a version with Ctrl/Cmd+S, or with a comment (Ctrl/Cmd+Shift+S)"
```

---

### Task 21: the changed indicator and the save icon

**Files:**

- Create: `app/gui/src/project-view/components/ChangedIndicator.vue`,
  `app/gui/src/project-view/components/__tests__/ChangedIndicator.test.ts`
- Modify: `app/gui/src/project-view/components/TopBar.vue`
- Modify: `app/gui/src/components/AppContainer/TabBar.vue`, create
  `__tests__/TabBar.test.ts`
- Modify: `app/common/src/text/english.json`:
  `"changedSinceLastVersion": "Changed since the last version",`

**Interfaces:**

Consumes: `useLocalVersioning().statusOf`, the `graph.saveVersionWithComment`
action, `ActionButton`.

Produces:

- `ChangedIndicator.vue` (props `projectId: ProjectId`, `mode: RunMode`). It
  renders
  `<span role="img" aria-label="Changed since the last version" data-testid="project-changed-indicator">`
  while the project's repository is enabled and `changed` is true.
- `TopBar.vue` renders it after `NavBreadcrumbs`, and
  `<ActionButton action="graph.saveVersionWithComment" />` after `graph.redo`.
- `TabBar.vue` renders `●` (`data-testid="tab-changed-indicator"`, with the same
  accessible name) before a changed local project's title.

Decision: the dot is a small component of its own, so that it can be tested
without mounting `TopBar`, which needs the graph selection, the stack navigator
and the action context. The save button inside the real top bar is covered by
Task 25's Playwright spec, and its registration by Task 20's `action.test.ts`.

Decision: the save icon runs `graph.saveVersionWithComment`, per the user's
decision.

- [ ] **Step 1: Write the failing tests.** `ChangedIndicator.test.ts`:

```ts
/** @file The changed dot: shown while a versioned local project has changes. */
import { mountWithProviders } from "$/utils/testing/mountWithProviders";
import { flushPromises } from "@vue/test-utils";
import { Path } from "enso-common/src/services/Backend";
import { newProjectId } from "enso-common/src/services/LocalBackend";
import { describe, expect, test, vi } from "vitest";
import { reactive } from "vue";
import ChangedIndicator from "../ChangedIndicator.vue";

const PROJECT = newProjectId(Path("/root/P"));
const current = reactive({ enabled: true, changed: true });

vi.mock("$/providers/localVersioning", () => ({
  useLocalVersioning: () => ({
    statusOf: () => ({
      git: true,
      repoRoot: "/root",
      blocked: null,
      lastVersion: null,
      optedOut: false,
      ...current,
    }),
  }),
}));

const dot = () =>
  document.querySelector('[data-testid="project-changed-indicator"]');

describe("ChangedIndicator", () => {
  test("shows, with an accessible name, while a local project has changed", async () => {
    current.enabled = true;
    current.changed = true;
    await mountWithProviders(ChangedIndicator, {
      props: { projectId: PROJECT, mode: "local" },
    });
    expect(dot()?.getAttribute("aria-label")).toBe(
      "Changed since the last version",
    );
    expect(dot()?.getAttribute("role")).toBe("img");
    current.changed = false;
    await flushPromises();
    expect(dot()).toBeNull();
  });

  test("is hidden for a repository that is not enabled, and for a cloud project", async () => {
    current.enabled = false;
    current.changed = true;
    const { setProps } = await mountWithProviders(ChangedIndicator, {
      props: { projectId: PROJECT, mode: "local" },
    });
    expect(dot()).toBeNull();
    current.enabled = true;
    await setProps({ mode: "cloud" });
    expect(dot()).toBeNull();
  });
});
```

`statusOf` reads `current`, a `reactive` object, so the component's `computed`
re-evaluates when a test changes it.

`TabBar.test.ts`:

```ts
/** @file The tab bar's changed indicator: a ● before a local project's title while it has changes. */
import { mountWithProviders } from "$/utils/testing/mountWithProviders";
import { flushPromises } from "@vue/test-utils";
import { Path } from "enso-common/src/services/Backend";
import { newProjectId } from "enso-common/src/services/LocalBackend";
import { describe, expect, test, vi } from "vitest";
import { computed, reactive } from "vue";
import TabBar from "../TabBar.vue";

const PROJECT = newProjectId(Path("/root/P"));
const current = reactive({ changed: true });

vi.mock("$/providers/container", () => ({
  panelKey: (tab: { id: string }) => tab.id,
  useContainerData: () =>
    reactive({
      tabList: [{ type: "project", id: PROJECT }],
      currentTab: undefined,
      isCurrentTab: () => false,
      closeTab: vi.fn(),
    }),
}));
vi.mock("$/providers/openedProjects", () => ({
  useOpenedProjects: () => ({
    get: () => ({
      state: {
        status: "initialized",
        info: { mode: "local", title: "P" },
        name: computed(() => "P"),
      },
      nextTask: undefined,
      error: undefined,
    }),
  }),
}));
vi.mock("$/providers/localVersioning", () => ({
  useLocalVersioning: () => ({
    statusOf: () => ({
      git: true,
      repoRoot: "/root",
      enabled: true,
      blocked: null,
      lastVersion: null,
      optedOut: false,
      changed: current.changed,
    }),
  }),
}));

const indicator = () =>
  document.querySelector('[data-testid="tab-changed-indicator"]');

describe("TabBar", () => {
  test("shows ● with an accessible name while the project has changed", async () => {
    current.changed = true;
    await mountWithProviders(TabBar);
    expect(indicator()?.textContent).toBe("●");
    expect(indicator()?.getAttribute("aria-label")).toBe(
      "Changed since the last version",
    );
    current.changed = false;
    await flushPromises();
    expect(indicator()).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/project-view/components/__tests__/ChangedIndicator.test.ts src/components/AppContainer/__tests__/TabBar.test.ts
```

- [ ] **Step 3: Implement.** `ChangedIndicator.vue`:

```vue
<script setup lang="ts">
/**
 * @file The dot beside the project name in the top bar: the project has changed since its last
 * version. Shown only for a local project whose repository is enabled (`$/providers/localVersioning`).
 */
import type { RunMode } from "$/providers/openedProjects/projectInfo";
import { useLocalVersioning } from "$/providers/localVersioning";
import { useText } from "$/providers/text";
import type { ProjectId } from "enso-common/src/services/Backend";
import { computed } from "vue";

const { projectId, mode } = defineProps<{
  projectId: ProjectId;
  mode: RunMode;
}>();

const localVersioning = useLocalVersioning();
const { getText } = useText();

const changed = computed(() => {
  if (mode !== "local") return false;
  const status = localVersioning.statusOf(projectId);
  return status?.enabled === true && status.changed;
});
</script>

<template>
  <span
    v-if="changed"
    role="img"
    class="ChangedIndicator"
    :aria-label="getText('changedSinceLastVersion')"
    data-testid="project-changed-indicator"
  />
</template>

<style scoped>
.ChangedIndicator {
  align-self: center;
  width: 8px;
  height: 8px;
  min-height: 8px;
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: 0.6;
}
</style>
```

`TopBar.vue`:

- import `ChangedIndicator from '@/components/ChangedIndicator.vue'` and
  `useCurrentProject` from `'$/components/WithCurrentProject.vue'`;
- add `const { id: projectId, info: projectInfo } = useCurrentProject()`;
- in `.alwaysVisibleElements`, after `<NavBreadcrumbs … />`, add
  `<ChangedIndicator :projectId="projectId" :mode="projectInfo.mode" />`;
- after `<ActionButton action="graph.redo" />`, add
  `<ActionButton action="graph.saveVersionWithComment" />`.

`TabBar.vue`:

- import `useLocalVersioning`, `useText` and `type ProjectId`;
- add `changed?: boolean` to `TabViewInfo`;
- in the `'project'` case, add
  `changed: project.state.info.mode === 'local' && isChanged(tab.id),` with:

```ts
const localVersioning = useLocalVersioning();
const { getText } = useText();

function isChanged(id: ProjectId) {
  const status = localVersioning.statusOf(id);
  return status?.enabled === true && status.changed;
}
```

Inside `<SelectableTab>`, before the spinner:

```vue
<span
  v-if="tab.changed"
  role="img"
  class="changed"
  :aria-label="getText('changedSinceLastVersion')"
  data-testid="tab-changed-indicator"
>●</span>
```

Style it with `.changed { font-size: 8px; line-height: 1; }`.

- [ ] **Step 4: Run the tests, typecheck and lint; they pass.**

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src app/common/src/text/english.json
git commit -m "GUI: show when a local project has changed since its last version"
```

---

### Task 22: closing: offer a repository first, and show the close commit's warning

**Files:**

- Modify: `app/gui/src/providers/openedProjects/projectStates.ts`
- Modify: `app/gui/src/providers/localVersioning.ts`, its test
- Modify: `app/common/src/text/english.json`:
  `"versionOnCloseWarning": "'$0' was closed, but its version could not be saved: $1",`

**Interfaces:**

Consumes: `closeProjectReportingVersioning` (Task 16),
`offerRepository(id, 'close')` (Task 19), and the **framework-free**
`backendMutationOptions(backend, method)` from `$/utils/backendQuery`. That
version returns a plain object with `mutationKey`, `networkMode` and
`meta.invalidates`. The Vue wrapper in `@/composables/backend` returns a
`computed` instead, and reading fields off it gives `undefined` (S2).

Produces: `showCloseWarning(title: string, warning: string): void` on the store.
The local branch of `closeProject` offers a repository before it stops the
scope, closes through `closeProjectReportingVersioning`, and shows the warning.

- [ ] **Step 1: Write the failing test** (provider test):

```ts
describe("showCloseWarning", () => {
  test("is a warning toast with the project and git’s message", () => {
    const { toasts, store } = setup();
    store.showCloseWarning("Sales", "index.lock exists");
    expect(toasts.toasts.value[0]).toMatchObject({
      type: "warning",
      content:
        "'Sales' was closed, but its version could not be saved: index.lock exists",
    });
  });
});
```

The close path in `projectStates.ts` has no unit harness. Task 25's spec
`'closing a project   with no repository offers Create; Not now still closes it'`
covers it (M2).

- [ ] **Step 2: Watch it fail; implement.** In the store:

```ts
function showCloseWarning(title: string, warning: string) {
  deps.toasts.show(deps.getText("versionOnCloseWarning", title, warning), {
    type: "warning",
  });
}
```

Return it. In `projectStates.ts`, import
`{ backendMutationOptions as backendMutationOptionsFor } from '$/utils/backendQuery'`
and replace the `closeLocalProject` mutation:

```ts
// The plain options (`$/utils/backendQuery`), not the Vue wrapper's `computed`: their key,
// network mode and invalidations are kept, while the call returns the close commit's warning.
const localCloseOptions = backendMutationOptionsFor(
  backends.localBackend,
  "closeProject",
);
const closeLocalProject = vueQuery.useMutation({
  mutationKey: localCloseOptions.mutationKey,
  networkMode: localCloseOptions.networkMode,
  meta: localCloseOptions.meta,
  mutationFn: ([id, title]: readonly [ProjectId, string]) => {
    const localBackend = backends.localBackend;
    if (!(localBackend instanceof LocalBackend))
      throw new Error("Cannot close local project: no local backend");
    return localBackend.closeProjectReportingVersioning(id, title);
  },
});
```

Import `LocalBackend` from `'enso-common/src/services/LocalBackend'`. Then
rewrite `closeProject` so that, for a local project, the scope stops after the
question. The question needs the project to be watched, and stopping the scope
unwatches it:

```ts
/** Close opened project. A local one may first be offered a repository (`localVersioning`). */
async function closeProject(
  project: Opened | Initialized,
): Promise<Result<NotOpened | HybridLocallyClosed>> {
  switch (project.info.mode) {
    case "local": {
      if (backends.localBackend == null) {
        project.scope.stop();
        return Err("Cannot close local project: no local backend");
      }
      await localVersioning.offerRepository(project.info.id, "close");
      project.scope.stop();
      const { versioningWarning } = await closeLocalProject.mutateAsync([
        project.info.id,
        project.info.title,
      ]);
      if (versioningWarning != null) {
        localVersioning.showCloseWarning(project.info.title, versioningWarning);
      }
      return Ok({ status: "not-opened", info: project.info });
    }
    case "cloud":
      project.scope.stop();
      await closeRemoteProject.mutateAsync([
        project.info.id,
        project.info.title,
      ]);
      return Ok({ status: "not-opened", info: project.info });
    case "hybrid":
      project.scope.stop();
      if (backends.localBackend == null)
        return Err("Cannot close hybrid project: no local backend");
      await backends.localBackend.closeProject(
        project.runningId,
        project.info.title,
      );
      return Ok({
        status: "hybrid-closed",
        info: { ...project.info, mode: project.info.mode },
      });
  }
}
```

In `renameProject`, after a successful rename, add
`void localVersioning.refresh(project.info.id)`. The spec says to refresh "after
the project's files change through the drive". Decision: the drive changes an
open project's files only by renaming it, and the 5 s poll covers anything else.

- [ ] **Step 3: Run the provider tests, the typecheck, and the nearby suites;
      they pass.**

```bash
corepack pnpm -C app/gui exec vitest run src/providers src/components/__tests__/DashboardPage.test.ts
corepack pnpm -C app/gui run typecheck
```

- [ ] **Step 4: Commit.**

```bash
git add app/gui/src app/common/src/text/english.json
git commit -m "GUI: offer a repository when closing a local project, and show a failed close commit"
```

---

### Task 23: quitting (dropped)

Quitting the app saves no version, by the user's decision: only closing a
project or saving it does. The quit stays as it was; there is no `quit.ts`, no
exit dialog for versions, and no `setQuitting` (earlier snippets that mention it
were removed from the code).

---

### Task 24: Settings → Local → Versions

**Files:**

- Create:
  `app/gui/src/dashboard/layouts/Settings/LocalVersionsSettingsSection.vue`
- Modify: `app/gui/src/dashboard/layouts/Settings/tabs.ts`,
  `__tests__/localTab.test.ts`
- Modify: `app/common/src/text/english.json`

**Interfaces:**

Consumes:

- `useSettingsContext()`, which returns a `Ref<SettingsContext>`
  (`context.value.localBackend`);
- `localVersioningStatusQueryOptions(backend, path)` (Task 15b);
- `initVersioning`, `enableVersioning` and `disableVersioning` (Task 16);
- `useLocalVersioning().resetPrompts`;
- `doesSettingsEntryMatch` and `settingsQueryMatcher`
  (`$/configurations/settings`).

Produces: a section `localVersionsSettingsSection` in `LOCAL_TAB`. Its single
custom entry shows one of five states:

| Status                           | Text                        | Button                                                                |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| git not found                    | `localVersionsNoGit`        | —                                                                     |
| no repository                    | `localVersionsNoRepository` | **Create repository**                                                 |
| a repository that is not enabled | `localVersionsNotEnabled`   | **Use this repository**                                               |
| opted out                        | `localVersionsOptedOut`     | **Use this repository**                                               |
| enabled                          | `localVersionsEnabled`      | **Stop keeping versions** (`disable`: records the opt-out, Ruling 21) |

**Ask again** is shown whenever git is found.

Texts:

```json
  "localVersionsSettingsSection": "Versions",
  "localVersionsSettingsCustomEntryAliases": "git\nversions\nrepository\nhistory",
  "localVersionsNoGit": "Git was not found. Install git to keep versions of your local projects.",
  "localVersionsNoRepository": "Your projects are not in a git repository.",
  "localVersionsNotEnabled": "Your projects are in the git repository at $0, but versions are not kept there.",
  "localVersionsOptedOut": "Versions are turned off for the git repository at $0.",
  "localVersionsEnabled": "Versions are kept in the git repository at $0.",
  "localVersionsCreate": "Create repository",
  "localVersionsUse": "Use this repository",
  "localVersionsStop": "Stop keeping versions",
  "localVersionsAskAgain": "Ask again",
  "localVersionsAskAgainDescription": "Ask again about the folders and repositories you chose \"Don't ask again\" for.",
```

- [ ] **Step 1: Write the failing tests.** In `localTab.test.ts`:
  - add the hoisted versioning stubs, and add them to the existing
    `vi.mock('$/providers/backends', …)` factory's `localBackend`;
  - mock the provider.

```ts
const versioning = vi.hoisted(() => ({
  status: {
    git: true,
    repoRoot: null as string | null,
    enabled: false,
    optedOut: false,
    changed: false,
    blocked: null,
    lastVersion: null,
  },
  versioningStatus: vi.fn(),
  initVersioning: vi.fn(),
  enableVersioning: vi.fn(),
  disableVersioning: vi.fn(),
  resetPrompts: vi.fn(),
}));
```

The `localBackend` of the existing backends mock becomes:

```ts
        localBackend: {
          rootPath: () => Path('/projects'),
          versioningStatus: (path: Path) => versioning.versioningStatus(path),
          initVersioning: (path: Path) => versioning.initVersioning(path),
          enableVersioning: (path: Path) => versioning.enableVersioning(path),
          disableVersioning: (path: Path) => versioning.disableVersioning(path),
        },
```

```ts
vi.mock("$/providers/localVersioning", () => ({
  useLocalVersioning: () => ({ resetPrompts: versioning.resetPrompts }),
}));

/** The Versions section's text. */
const versionsSection = () =>
  required(document.querySelector('[data-testid="local-versions-section"]'))
    .textContent ?? "";

describe("the Versions section", () => {
  beforeEach(() => {
    versioning.status = {
      git: true,
      repoRoot: null,
      enabled: false,
      optedOut: false,
      changed: false,
      blocked: null,
      lastVersion: null,
    };
    versioning.versioningStatus
      .mockReset()
      .mockImplementation(async () => ({ ...versioning.status }));
    versioning.initVersioning.mockReset().mockImplementation(async () => {
      versioning.status = {
        ...versioning.status,
        repoRoot: "/projects",
        enabled: true,
      };
      return { repoRoot: "/projects" };
    });
    versioning.enableVersioning.mockReset().mockImplementation(async () => {
      versioning.status = {
        ...versioning.status,
        enabled: true,
        optedOut: false,
      };
    });
    versioning.disableVersioning.mockReset().mockImplementation(async () => {
      versioning.status = {
        ...versioning.status,
        enabled: false,
        optedOut: true,
      };
    });
    versioning.resetPrompts.mockReset();
  });

  test("without a repository, Create makes one at the root", async () => {
    await openLocalTab();
    await vi.waitFor(() =>
      expect(versionsSection()).toContain(
        "Your projects are not in a git repository.",
      ),
    );
    await userEvent.setup().click(button("Create repository"));
    expect(versioning.initVersioning).toHaveBeenCalledWith("/projects");
    await vi.waitFor(() =>
      expect(versionsSection()).toContain(
        "Versions are kept in the git repository at /projects.",
      ),
    );
  });

  test("Stop turns versions off, and Use turns them on again", async () => {
    versioning.status = {
      ...versioning.status,
      repoRoot: "/projects",
      enabled: true,
    };
    await openLocalTab();
    const user = userEvent.setup();
    await vi.waitFor(() => button("Stop keeping versions"));
    await user.click(button("Stop keeping versions"));
    expect(versioning.disableVersioning).toHaveBeenCalledWith("/projects");
    await vi.waitFor(() =>
      expect(versionsSection()).toContain(
        "Versions are turned off for the git repository at /projects.",
      ),
    );
    await user.click(button("Use this repository"));
    expect(versioning.enableVersioning).toHaveBeenCalledWith("/projects");
  });

  test("an existing repository that is not used offers Use", async () => {
    versioning.status = { ...versioning.status, repoRoot: "/home" };
    await openLocalTab();
    await vi.waitFor(() =>
      expect(versionsSection()).toContain(
        "Your projects are in the git repository at /home, but versions are not kept there.",
      ),
    );
    await userEvent.setup().click(button("Use this repository"));
    expect(versioning.enableVersioning).toHaveBeenCalledWith("/home");
  });

  test("without git it says so, and offers no button", async () => {
    versioning.status = { ...versioning.status, git: false };
    await openLocalTab();
    await vi.waitFor(() =>
      expect(versionsSection()).toContain("Git was not found."),
    );
    expect(
      document.querySelector('[data-testid="local-versions-section"] button'),
    ).toBeNull();
  });

  test('Ask again resets the "Don\'t ask again" answers', async () => {
    await openLocalTab();
    await vi.waitFor(() => button("Ask again"));
    await userEvent.setup().click(button("Ask again"));
    expect(versioning.resetPrompts).toHaveBeenCalledOnce();
  });

  test('the settings search finds the section by "git" and "repository"', () => {
    const entry = {
      type: "custom",
      aliasesId: "localVersionsSettingsCustomEntryAliases",
    } as const;
    expect(
      doesSettingsEntryMatch(entry, settingsQueryMatcher("git"), getText),
    ).toBe(true);
    expect(
      doesSettingsEntryMatch(
        entry,
        settingsQueryMatcher("repository"),
        getText,
      ),
    ).toBe(true);
  });
});
```

Import `doesSettingsEntryMatch` and `settingsQueryMatcher` from
`'$/configurations/settings'`. `openLocalTab`, `button` and `required` are the
file's own helpers.

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/dashboard/layouts/Settings/__tests__/localTab.test.ts
```

- [ ] **Step 3: Implement.** `LocalVersionsSettingsSection.vue`:

```vue
<script setup lang="ts">
/**
 * @file The Local tab's Versions section: whether git was found, the repository the local projects
 * are versioned in (or a button to create one at the root, to use the existing one, or to stop),
 * and a reset of the "Don't ask again" answers.
 */
import Button from "$/components/Button/Button.vue";
import ButtonGroup from "$/components/Button/ButtonGroup.vue";
import Text from "$/components/Text/Text.vue";
import { useLocalVersioning } from "$/providers/localVersioning";
import { useSettingsContext } from "$/providers/settingsContext";
import { useText } from "$/providers/text";
import { useToasts } from "$/providers/toasts";
import { localVersioningStatusQueryOptions } from "$/utils/localVersioningQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { getMessageOrToString } from "enso-common/src/utilities/errors";
import { computed } from "vue";

const context = useSettingsContext();
const { getText } = useText();
const toasts = useToasts();
const queryClient = useQueryClient();
const localVersioning = useLocalVersioning();

// `SettingsBaseContext.localBackend` is already `LocalBackend | null`.
const backend = computed(() => context.value.localBackend);
const rootPath = computed(() => backend.value?.rootPath() ?? null);
const statusOptions = computed(() =>
  localVersioningStatusQueryOptions(backend.value, rootPath.value),
);
const statusQuery = useQuery(statusOptions);
const status = computed(() => statusQuery.data.value ?? undefined);

const change = useMutation({
  mutationFn: async (action: "create" | "use" | "stop") => {
    const local = backend.value;
    const root = rootPath.value;
    const repoRoot = status.value?.repoRoot ?? null;
    if (local == null || root == null) return;
    if (action === "create") await local.initVersioning(root);
    else if (repoRoot != null && action === "use")
      await local.enableVersioning(repoRoot);
    else if (repoRoot != null) await local.disableVersioning(repoRoot);
  },
  onError: (error) =>
    toasts.show(
      `${getText("versioningSetupError")}: ${getMessageOrToString(error)}`,
      {
        type: "error",
      },
    ),
  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: statusOptions.value.queryKey }),
});
</script>

<template>
  <div
    v-if="status != null"
    class="flex flex-col gap-2"
    data-testid="local-versions-section"
  >
    <Text v-if="!status.git">{{ getText("localVersionsNoGit") }}</Text>
    <template v-else>
      <Text v-if="status.repoRoot == null">{{
        getText("localVersionsNoRepository")
      }}</Text>
      <Text v-else-if="status.optedOut">
        {{ getText("localVersionsOptedOut", status.repoRoot) }}
      </Text>
      <Text v-else-if="!status.enabled">
        {{ getText("localVersionsNotEnabled", status.repoRoot) }}
      </Text>
      <Text v-else>{{ getText("localVersionsEnabled", status.repoRoot) }}</Text>
      <ButtonGroup class="grow-0">
        <Button
          v-if="status.repoRoot == null"
          size="small"
          variant="outline"
          :isLoading="change.isPending.value"
          @press="change.mutate('create')"
        >
          {{ getText("localVersionsCreate") }}
        </Button>
        <Button
          v-else-if="!status.enabled"
          size="small"
          variant="outline"
          :isLoading="change.isPending.value"
          @press="change.mutate('use')"
        >
          {{ getText("localVersionsUse") }}
        </Button>
        <Button
          v-else
          size="small"
          variant="outline"
          :isLoading="change.isPending.value"
          @press="change.mutate('stop')"
        >
          {{ getText("localVersionsStop") }}
        </Button>
        <Button
          size="small"
          variant="outline"
          :tooltip="getText('localVersionsAskAgainDescription')"
          @press="localVersioning.resetPrompts()"
        >
          {{ getText("localVersionsAskAgain") }}
        </Button>
      </ButtonGroup>
    </template>
  </div>
</template>
```

In `tabs.ts`, import the component and add, after the `localSettingsSection`
entry of `LOCAL_TAB.sections`:

```ts
    {
      nameId: 'localVersionsSettingsSection',
      entries: [
        {
          type: 'custom',
          aliasesId: 'localVersionsSettingsCustomEntryAliases',
          component: LocalVersionsSettingsSection,
        },
      ],
    },
```

- [ ] **Step 4: Run the Settings tests, typecheck and lint; they pass.**

```bash
corepack pnpm -C app/gui exec vitest run src/dashboard/layouts/Settings
corepack pnpm -C app/gui run typecheck
```

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src app/common/src/text/english.json
git commit -m "GUI: a Versions section in Settings → Local"
```

---

### Task 25: Playwright, screenshots, changelog, PR body

**Files:**

- Modify: `app/gui/integration-test/mock/versioning/saveRoutes.ts`,
  `app/gui/integration-test/mock/lsHandler.ts`
- Create: `app/gui/integration-test/project-view/localVersioning.spec.ts`,
  `app/gui/integration-test/dashboard/localVersioningSettings.spec.ts`
- Modify: `CHANGELOG.md`, `app/gui/CLAUDE.md`
- Create (not committed):
  `C:\Repos\Enso\ide\.superpowers\sdd\2026-10-16-local-git-versioning\pr4-body.md`

**Interfaces:**

Consumes:

- Task 15b's `MockVersioning` and `VersioningRouteHandler`, `toJSONRPCResult`
  and `toJSONRPCError` (`mock/jsonRpc.ts`), and `api.versioning`;
- `mockYdocProvider(room, doc)` (`mock/lsHandler.ts`);
- the `editorPage` and `drivePage` fixtures;
- `expectScreenshot`, `TEXT.closeShortcut` and the drive's `rightClickRow`.

Produces: `SAVE_ROUTES` (`init`, `enable`, `disable`, `enable-if-inside`,
`commit`), and the mocked ydoc server's answer on `ydoc:control`.

- [ ] **Step 1: Mock the routes.** `mock/versioning/saveRoutes.ts`:

```ts
/** @file The mocked versioning routes for saving versions, over `MockVersioning`. */
import { toJSONRPCError, toJSONRPCResult } from "../jsonRpc";
import type { VersioningRouteHandler } from "../localVersioning";

const notEnabled = (repoRoot: string | null) =>
  toJSONRPCError(
    `Versioning is not enabled for the repository at ${repoRoot}.`,
  );

export const SAVE_ROUTES: Readonly<Record<string, VersioningRouteHandler>> = {
  init: (params, { state }) => {
    state.repoRoot = String(params.rootPath);
    state.enabled = true;
    state.optedOut = false;
    return toJSONRPCResult({ repoRoot: state.repoRoot });
  },
  enable: (_params, { state }) => {
    state.enabled = true;
    state.optedOut = false;
    return toJSONRPCResult(null);
  },
  disable: (_params, { state }) => {
    state.enabled = false;
    state.optedOut = true;
    return toJSONRPCResult(null);
  },
  "enable-if-inside": (params, { state }) => {
    const repoRoot = String(params.repoRoot);
    const rootPath = String(params.rootPath);
    const inside = repoRoot === rootPath || repoRoot.startsWith(`${rootPath}/`);
    if (inside && !state.optedOut) state.enabled = true;
    return toJSONRPCResult({ enabled: state.enabled });
  },
  commit: (params, { state }) => {
    const path = String(params.path);
    if (!state.enabled) return notEnabled(state.repoRoot);
    if (!state.changed.has(path)) return toJSONRPCResult({ id: null });
    const message =
      String(params.message).trim() === "" ? "Saved" : String(params.message);
    const id = (state.commits.length + 1).toString(16).padStart(40, "0");
    state.commits.push([path, message]);
    state.changed.delete(path);
    state.versions.set(path, [
      {
        id,
        date: new Date().toISOString(),
        author: { name: "Tester", email: "tester@example.com" },
        comment: message,
        isLatest: true,
      },
      ...(state.versions.get(path) ?? []).map((version) => ({
        ...version,
        isLatest: false,
      })),
    ]);
    return toJSONRPCResult({ id });
  },
};
```

In `lsHandler.ts`, in `mockYdocProvider`'s `room === 'index'` branch, answer
flushes, as the ydoc server would:

```ts
// The ydoc server's control channel (`ydoc-shared/ydocControl`): every flush succeeds.
const control = new YjsChannel<string>(doc, YDOC_CONTROL_CHANNEL);
control.subscribe((raw) => {
  const message = parseControlMessage(raw);
  if (message?.type === "flush")
    control.send(
      encodeControlMessage({ type: "flushed", id: message.id, ok: true }),
    );
});
```

importing `YjsChannel` from `ydoc-channel` and the three names from
`ydoc-shared/ydocControl`.

- [ ] **Step 2: Write the specs.** `project-view/localVersioning.spec.ts`:

```ts
/**
 * @file Saving versions of a local project: Ctrl/Cmd+S, the save dialog, the changed indicator,
 * the repository prompt and closing. The shim's `versioning/*` routes are mocked
 * (`mock/localVersioning.ts`, `mock/versioning/saveRoutes.ts`); git is absent unless a test says.
 */
import { expect, test } from "integration-test/base";
import { posix } from "node:path";
import { TEXT } from "../actions";
import { expectScreenshot } from "../screenshot";

const ROOT = "/home/user/enso/enso-projects";
const MOCK_PROJECT_PATH = posix.join(ROOT, "Mock_Project");
const saveButton = "action:graph.saveVersionWithComment";

test.describe("with versions kept at the root, and changes", () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true;
        api.versioning.repoRoot = ROOT;
        api.versioning.enabled = true;
        api.versioning.changed.add(MOCK_PROJECT_PATH);
      },
    },
  });

  test('the dot and the tab’s ● show changes; Ctrl+S saves "Saved" and clears them', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage;
    const dot = page.getByTestId("project-changed-indicator");
    await expect(dot).toBeVisible();
    await expect(page.getByTestId("tab-changed-indicator")).toBeVisible();
    await expectScreenshot(
      page.getByTestId(saveButton).locator("xpath=../.."),
      "changed-top-bar.png",
    );
    await page.keyboard.press("ControlOrMeta+S");
    await expect(page.getByTestId("toast-host")).toContainText("Version saved");
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, "Saved"]]);
    await expect(dot).toBeHidden();
    await expect(page.getByTestId("tab-changed-indicator")).toBeHidden();
    await expect(page.getByTestId(saveButton)).toBeDisabled();
  });

  test("the save icon asks for a comment; Enter saves with it", async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage;
    await page.getByTestId(saveButton).click();
    const comment = page.getByRole("textbox", { name: "Comment (optional)" });
    await expect(comment).toBeFocused();
    await expectScreenshot(
      page.getByTestId("modal-dialog"),
      "save-version-dialog.png",
    );
    await comment.fill("Joined the sales table");
    await comment.press("Enter");
    await expect(page.getByTestId("toast-host")).toContainText("Version saved");
    expect(localApi.versioning.commits).toEqual([
      [MOCK_PROJECT_PATH, "Joined the sales table"],
    ]);
  });

  test('Ctrl+Shift+S opens the dialog; an empty comment saves "Saved"', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage;
    await page.keyboard.press("ControlOrMeta+Shift+S");
    await page.getByTestId("save-version-save").click();
    await expect(page.getByTestId("toast-host")).toContainText("Version saved");
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, "Saved"]]);
  });
});

test.describe("with a blocked repository", () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true;
        api.versioning.repoRoot = ROOT;
        api.versioning.enabled = true;
        api.versioning.blocked = "The repository is in the middle of a merge.";
        api.versioning.changed.add(MOCK_PROJECT_PATH);
      },
    },
  });

  test("the icon is greyed, with git’s message as its tooltip", async ({
    page,
    editorPage,
  }) => {
    await editorPage;
    const save = page.getByTestId(saveButton);
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("title", /in the middle of a merge/);
    await expectScreenshot(save, "save-blocked.png");
  });
});

test.describe("with git and no repository", () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true;
        api.versioning.changed.add(MOCK_PROJECT_PATH);
      },
    },
  });

  test("Ctrl+S offers to create one; Create creates it and saves", async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage;
    await page.keyboard.press("ControlOrMeta+S");
    const prompt = page.getByTestId("repository-prompt");
    await expect(prompt).toContainText(
      `Keep versions of your projects with git? This creates a repository in ${ROOT}.`,
    );
    await expectScreenshot(prompt, "create-repository-prompt.png");
    await prompt.getByRole("button", { name: "Create" }).click();
    await expect(page.getByTestId("toast-host")).toContainText("Version saved");
    expect(localApi.versioning.repoRoot).toBe(ROOT);
  });

  test('"Don\'t ask again for this folder" stops asking', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage;
    await page.keyboard.press("ControlOrMeta+S");
    await page.getByTestId("repository-prompt-dont-ask-again").click();
    await expect(page.getByTestId("repository-prompt")).toBeHidden();
    await page.keyboard.press("ControlOrMeta+S");
    await expect(page.getByTestId("toast-host")).toContainText(
      "Versions are off for this folder",
    );
    await expect(page.getByTestId("repository-prompt")).toBeHidden();
    expect(localApi.versioning.repoRoot).toBeNull();
  });

  test("closing a project with no repository offers Create; Not now still closes it", async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage.goToPage.drive().driveTable.rightClickRow("Mock Project");
    await page.getByRole("button", { name: TEXT.closeShortcut }).click();
    const prompt = page.getByTestId("repository-prompt");
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("tab", { name: "Mock Project" })).toHaveCount(
      0,
    );
    expect(localApi.versioning.repoRoot).toBeNull();
  });
});

test.describe("with an existing repository outside the root", () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true;
        api.versioning.repoRoot = "/home/user";
        api.versioning.changed.add(MOCK_PROJECT_PATH);
      },
    },
  });

  test("Ctrl+S asks to use it; Use enables it and saves", async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage;
    await page.keyboard.press("ControlOrMeta+S");
    const prompt = page.getByTestId("repository-prompt");
    await expect(prompt).toContainText(
      "Keep versions of your projects in the existing repository at /home/user?",
    );
    await expectScreenshot(prompt, "use-repository-prompt.png");
    await prompt.getByRole("button", { name: "Use" }).click();
    await expect(page.getByTestId("toast-host")).toContainText("Version saved");
    expect(localApi.versioning.enabled).toBe(true);
  });
});

test("without git there is no save icon, no dot, and Ctrl+S asks nothing", async ({
  page,
  editorPage,
}) => {
  await editorPage;
  await expect(page.getByTestId(saveButton)).toHaveCount(0);
  await expect(page.getByTestId("project-changed-indicator")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+S");
  await expect(page.getByTestId("repository-prompt")).toHaveCount(0);
});
```

`editorPage` is a chain of page actions, so `await editorPage` waits for the
editor. `editorPage.goToPage.drive()` continues the chain, as
`localRecent.spec.ts` does. If the top-bar screenshot's `xpath=../..` does not
pick the bar, choose the bar's own region by role instead. Find it with
Playwright's inspector, and avoid class names.

`dashboard/localVersioningSettings.spec.ts`:

```ts
/** @file Settings → Local → Versions, against the mocked versioning routes. */
import { expect, test } from "integration-test/base";
import { expectScreenshot } from "../screenshot";

test.use({ setupApi: { local: (api) => void (api.versioning.git = true) } });

test("Create repository creates one at the root; Stop turns versions off", async ({
  page,
  drivePage,
  localApi,
}) => {
  await drivePage.goToPage.settings().goToSettingsTab.local();
  const section = page.getByTestId("local-versions-section");
  await expect(section).toContainText(
    "Your projects are not in a git repository.",
  );
  await section.getByRole("button", { name: "Create repository" }).click();
  await expect(section).toContainText(
    "Versions are kept in the git repository at /home/user/enso/enso-projects.",
  );
  await expectScreenshot(section, "local-versions-settings.png");
  await section.getByRole("button", { name: "Stop keeping versions" }).click();
  await expect(section).toContainText(
    "Versions are turned off for the git repository at",
  );
  expect(localApi.versioning.optedOut).toBe(true);
});
```

Use the navigation helpers `localModeSettings.spec.ts` uses to reach the Local
tab (check its first lines). If their names differ from
`goToPage.settings().goToSettingsTab.local()`, use theirs.

- [ ] **Step 3: Run the new specs, on Windows and in WSL.**

```bash
corepack pnpm -r --if-present run compile
cd app/gui
corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/project-view/localVersioning.spec.ts integration-test/dashboard/localVersioningSettings.spec.ts
```

In WSL, source `~/.enso-toolchain.sh` first and use a Linux clone. Write the
`*-linux.png` baselines once with `--update-snapshots`, then run each spec three
times with `--workers=2`.

- [ ] **Step 4: Run the whole GUI suite once on Linux, and every package's
      checks.**
  - The full `project-view/` and `dashboard/` Playwright directories. Git is
    absent by default, so the screenshots of the other specs and the a11y
    baselines must not change.
  - In `app/gui`: `typecheck`, `lint`, `test:unit`.
  - The vitest suites of `app/common`, `app/ydoc-shared` and `app/ydoc-server`.
  - `prettier --check` over the changed files.
  - If a spec fails, compare its pass rate with `develop`'s, as
    `app/gui/integration-test/CLAUDE.md` describes.

- [ ] **Step 5: Screenshots for the PR.** Take before/after images of:
  - the top bar with the save icon and the dot;
  - the tab with ●;
  - the save dialog;
  - the Create prompt and the Use prompt;
  - the blocked tooltip;
  - Settings → Local → Versions in each of its states.

  "Before" is `develop`'s top bar, tab and Local tab. Push the images to the
  orphan `pr-screenshots` branch under `pr-<number>/`, and embed them in the PR
  body.

- [ ] **Step 6: Changelog.** Under `# Next Release` → `#### Enso IDE`:

```markdown
- [Local projects can keep versions with git][NNN]. When git is installed, a
  version is saved when a project closes, and on demand with Ctrl/Cmd+S (or
  Ctrl/Cmd+Shift+S and the new save icon, to add a comment). A dot beside the
  project name, and a ● on its tab, show changes since the last version. The
  first time, the IDE offers to create a repository in the projects folder (or
  to use the one it is already in); Settings → Local has a new Versions section.
```

Add the matching link line,
`[NNN]: https://github.com/jdunkerley/enso/pull/NNN`, at the bottom.

- [ ] **Step 7: Docs.** Add to `app/gui/CLAUDE.md`:
      "`$/providers/localVersioning` holds each open local project's git status
      (polled every 5 s by its own loop, one request in flight at a time),
      saving (the ydoc flush, `flush.ts`, then `versioning/commit`) and the
      repository prompts; `projectStates.ts` watches a local project when it
      initializes and offers a repository before it closes. See the design,
      `docs/superpowers/specs/2026-10-16-local-git-versioning-design.md`."

- [ ] **Step 8: Commit.**

```bash
git add app/gui CHANGELOG.md
git commit -m "GUI: Playwright specs for saving local versions; changelog"
```

- [ ] **Step 9: Draft the PR body** in `pr4-body.md`, shaped like `pr3-body.md`.
      It is neither committed nor pushed.
  - **Description.** PR 4 of local projects versioned with git (design #229), on
    Task 15b (#232). What users see:
    - save: Ctrl/Cmd+S saves "Saved"; Ctrl/Cmd+Shift+S and the icon ask for a
      comment;
    - the dot and the ●;
    - the prompts: Create; Use for an existing repository outside the root; a
      repository at or inside the root is enabled silently, unless the user
      turned it off;
    - a version on close (quitting saves none);
    - Settings → Local → Versions.
  - **Important notes.**
    - The ydoc flush: why `text/save` from the GUI cannot work; the handshake;
      the disk-time refusal; the retry; the auto-save fallback.
    - **The engine bundle**: `ydoc.cjs` is in the engine jar, so the installer
      test needs a rebuilt engine.
    - The non-overlapping poll.
    - "Don't ask again" is kept in `localStorage`
      (`enso-local-versioning-prompts`); "Not now" lasts for the session.
    - M10: Ctrl/Cmd+S is graph-scoped. **Question for the user.**
    - Not verified: `buildEngineDistribution` (the installer test covers it).
  - **Also:** the screenshots, the "Closes" lines, the
    `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer and
    the session link.
  - **Do not push.** PR 4 is a feature, so it waits for the user's installer
    test.

---

### Pre-flight resolutions

- **S1** (turning versions off did not stick). Fixed by Ruling 21 in Task 15b:
  `disable` records an opt-out, `enableIfInside` skips it, and `status.optedOut`
  is reported. The provider does not offer an opted-out repository to the shim
  (Task 18) or prompt about it (Task 19). Settings shows the opted-out state and
  offers Use (Task 24).
- **S2.** Task 22 uses the framework-free
  `backendMutationOptions(backend, method)` from `$/utils/backendQuery`, whose
  plain object keeps the key, network mode and invalidations.
- **S3, S4.** Task 17 is replaced (Ruling 20). The ydoc session flushes, after a
  state-vector handshake and a drain. A refusal sends nothing, so the pending
  auto-save stays. A failed save is retried. No engine request is added.
- **S5.** Task 19's `answerPrompt` closes the modal after answering, and its
  assertions are now exact.
- **S6.** The strict defaults test is updated in place. The new test reads
  `[...currentConflicts(…).keys()]`.
- **S7.** The comment field is found by its accessible name ("Comment
  (optional)"), with no `data-testid` on `BasicInput`.
- **S8.** The mock's base lives in its own module (Task 15b), with the JSON-RPC
  helpers hoisted into `mock/jsonRpc.ts`. PR 4 edits only
  `mock/versioning/saveRoutes.ts`.
- **S9.** The mock defaults to `git: false` (Task 15b). PR 4's specs opt in
  through `test.use({ setupApi })`.
- **S10.** `LocalBackend.versioningStatus` lands once, in Task 15b, so neither
  PR adds it.
- **S11.** Applies to PR 5 (see `plan-pr5.md`). PR 4 merges first.
- **M1.** Applies to PR 5.
- **M2.** Task 25 adds "closing a project with no repository offers Create; Not
  now still closes it".
- **M3.** The "without git" spec uses the default state (git absent from the
  start). No change after load.
- **M4.** Applies to PR 5.
- **M5.** `localVersioningQuery.ts` lands once (Task 15b), taking a nullable
  path, so there is no placeholder.
- **M6.** Applies to PR 5.
- **M7.** Task 17 is replaced, so there are no LS protocol docs.
- **M8.** The header now says PR 1 and PR 2 are in the base.
- **M9.** Task 17 Step 10 amends the spec's "Flush first".
- **M10.** Kept graph-scoped. Recorded as a Decision, and raised with the user
  in the PR body.
- **R1.** The search test asserts `doesSettingsEntryMatch` on the section's
  aliases.
- **R2.** The no-git case is its own test, and there is no `<= 1` assertion.
- **R3.** Applies to PR 5.
- **R4.** Every test body is written out. The TopBar test is replaced by
  `ChangedIndicator.test.ts` plus `action.test.ts`. The `DashboardPage` tests
  are written out.
- **R5.**
  - The empty-comment rule is only in the shim. The GUI passes the comment
    through, and its tests expect `''`.
  - The `LocalBackend` test setup is shared (`localBackendTestUtils.ts`, Task
    15b).
- **m4.** A project outside the root with no repository gets its own toast,
  `versioningNotForThisFolder`.
- **m5.** The provider test file exports nothing.

---

## PR 5: the local Versions tab

Branch `feature/local-versions-tab`. It starts from the commit Task 15b
(`plan-task15b.md`) makes on PR 3's branch (PR #232). That base already contains
PR 1 and PR 2.

From Task 15b it **uses, and must not add again**:

- `LocalBackend.versioningStatus`;
- `localBackendTestUtils.ts`;
- `app/gui/src/utils/localVersioningQuery.ts`
  (`localVersioningStatusQueryOptions(backend, path | null)`);
- the `mockBackends` widening;
- the Playwright versioning mock (`mock/localVersioning.ts`, default
  `git: false`).

PR 5 adds its mocked routes only in `mock/versioning/historyRoutes.ts`.

**Merge order: PR 4 first, then PR 5**, rebased. PR 5 does not depend on PR 4's
code or UI: its texts do not point at PR 4's Settings section (S11).

Read the spec's "PR 5: the local Versions tab", "Testing" and "Decisions"
sections first, then `app/gui/src/cloud/versions/CLAUDE.md` and the "Local
versioning" section of `app/project-manager-shim/CLAUDE.md`. Consent matters
here: `log`, `fileAt` and `exportAt` work without it, while `restore` and
`setComment` reject.

The spec's PR 5 section asks for **history across renames and moves**, and Task
30 implements it in the shim. PR 3 writes the `Enso-Moved-From` trailer, but its
`log` follows only the current path.

**Revision (after `preflight-pr4-pr5.md`).** Task 32 no longer creates
`localVersioningQuery.ts`, widens `mockBackends` or adds `versioningStatus`,
because all three moved to Task 15b. Task 35 no longer adds the shared mock
block. Every test is written out. Tasks keep their numbers 30–35.

Decision: the Versions tab stays in `src/cloud/versions/`, contributed by
`registerCloud`. Moving it to the core would bury this PR's behavioural diff in
a move, and every current build calls `registerCloud`. A build without the cloud
would lose local versions too, so moving the tab (and keeping only the Schedule
tab in `cloud/`) is recorded as a follow-up for PR 6.

### File structure

| Path                                                                                                                 | Task       | What                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `app/project-manager-shim/src/localVersioning/index.ts`, `__tests__/localVersioning.test.ts`                         | 30         | follow moves; the path at each version; an empty comment removes the note |
| `app/common/src/services/LocalBackend.ts`, `__test__/LocalBackend.versions.test.ts` (new)                            | 31         | the version methods                                                       |
| `app/gui/src/providers/rightPanel.ts`                                                                                | 32         | the Versions tab enabled in local categories                              |
| `app/gui/src/cloud/versions/AssetVersions.vue`, `AssetVersionList.vue`                                               | 32, 34     | local gating, the category's backend; restore of an open project          |
| `app/gui/src/cloud/versions/AssetVersion.vue`                                                                        | 33         | no tags on local versions                                                 |
| `app/gui/src/cloud/versions/__tests__/AssetVersions.test.ts`                                                         | 32–34      | local tests                                                               |
| `app/common/src/text/english.json`                                                                                   | 32         | `assetVersions.local*`                                                    |
| `app/gui/integration-test/mock/versioning/historyRoutes.ts`                                                          | 35         | mocked routes                                                             |
| `app/gui/integration-test/dashboard/localVersions.spec.ts` (new)                                                     | 35         | Playwright                                                                |
| `app/gui/src/cloud/versions/CLAUDE.md`, `app/common/CLAUDE.md`, `app/project-manager-shim/CLAUDE.md`, `CHANGELOG.md` | 30, 31, 35 | docs                                                                      |

**Files PR 4 also touches** (PR 4 merges first):

- `LocalBackend.ts`: PR 4 adds methods inside the "Versioning" block and changes
  `closeProject`; PR 5 edits other methods in place.
- `english.json`: PR 4 adds keys after `"syncingProjectsMessage"`; PR 5 edits
  the `assetVersions.*` keys.
- `app/common/CLAUDE.md`: each PR adds a sentence to the versioning bullet.
  Resolve by hand.
- `app/project-manager-shim/CLAUDE.md`: PR 4 changes nothing in the sections PR
  5 edits ("Close hook and moves", "Notes reference").
- `CHANGELOG.md`: each PR adds an entry; PR 5 rebases.
- The shim's `localVersioning/index.ts` and its test: only Task 15b and PR 5
  change them, since PR 4 adds nothing to the shim.

---

### Task 30: the shim follows a project's history across renames and moves

**Files:**

- Modify: `app/project-manager-shim/src/localVersioning/index.ts`,
  `__tests__/localVersioning.test.ts`
- Modify: `app/project-manager-shim/CLAUDE.md`

**Interfaces:**

Consumes:

- `MOVED_FROM_TRAILER` (`'Enso-Moved-From'`);
- `commitMove`'s commit, which covers both paths and carries
  `Enso-Moved-From: <old repository-relative path>`;
- `repoRelative`, `excludeEnso`, `withoutMoveTrailer`, `exclusive`, `runGit`,
  `identityArgs`, `AUTOMATIC`, `NOTES_REF` and `lockMessage`.

Produces (public signatures unchanged):

```ts
interface LoggedVersion extends VersionEntry { readonly relativePath: string }  // internal
const MAX_FOLLOWED_MOVES = 100
log(projectPath): Promise<readonly VersionEntry[]>          // now includes the versions before each move
fileAt(projectPath, id, relativePath): Promise<string>       // at the path the project had at `id`
exportAt(projectPath, id, targetPath): Promise<void>         // the tree at that path
restore(projectPath, id): Promise<{ readonly id: string }>   // into the current path
setComment(projectPath, id, comment): Promise<void>          // an empty comment removes the note
```

- [ ] **Step 1: Write the failing tests.** Append to `localVersioning.test.ts`:

```ts
describe("history across moves", () => {
  /** A, saved twice, moved to `folder/A`, and saved once more. */
  async function movedProject(root: string, versioning: LocalVersioning) {
    const a = path.join(root, "A");
    const first = (await versioning.commit([a], "first")).id!;
    await writeFiles(root, {
      "A/src/Main.enso": "main = 2\n",
      "A/src/Extra.enso": "x = 1\n",
    });
    const second = (await versioning.commit([a], "second")).id!;
    await fs.mkdir(path.join(root, "folder"));
    await fs.rename(a, path.join(root, "folder", "A"));
    await versioning.commitMove(
      a,
      path.join(root, "folder", "A"),
      ({ to }) => `Moved A to ${to}`,
    );
    const moved = await git(root, "rev-parse", "HEAD");
    await writeFiles(root, { "folder/A/src/Main.enso": "main = 3\n" });
    const third = (
      await versioning.commit([path.join(root, "folder", "A")], "third")
    ).id!;
    return {
      first,
      second,
      moved,
      third,
      project: path.join(root, "folder", "A"),
    };
  }

  test("log lists the versions from before the move, newest first", async () => {
    await withRepo(async (root, versioning) => {
      const { first, second, moved, third, project } = await movedProject(
        root,
        versioning,
      );
      const log = await versioning.log(project);
      expect(log.map((v) => v.id)).toEqual([third, moved, second, first]);
      expect(log.map((v) => v.comment)).toEqual([
        "third",
        "Moved A to folder/A",
        "second",
        "first",
      ]);
      expect(log.map((v) => v.isLatest)).toEqual([true, false, false, false]);
      expect(log[0]).not.toHaveProperty("relativePath");
    });
  });

  test("follows a chain of moves", async () => {
    await withRepo(async (root, versioning) => {
      const first = (await versioning.commit([path.join(root, "A")], "first"))
        .id!;
      await fs.rename(path.join(root, "A"), path.join(root, "B2"));
      await versioning.commitMove(
        path.join(root, "A"),
        path.join(root, "B2"),
        "Renamed to B2",
      );
      await fs.rename(path.join(root, "B2"), path.join(root, "C"));
      await versioning.commitMove(
        path.join(root, "B2"),
        path.join(root, "C"),
        "Renamed to C",
      );
      const log = await versioning.log(path.join(root, "C"));
      expect(log.map((v) => v.comment)).toEqual([
        "Renamed to C",
        "Renamed to B2",
        "first",
      ]);
      expect(log.at(-1)?.id).toBe(first);
    });
  });

  test("fileAt reads a version from before the move at its old path", async () => {
    await withRepo(async (root, versioning) => {
      const { first, project } = await movedProject(root, versioning);
      expect(await versioning.fileAt(project, first, "src/Main.enso")).toBe(
        "main = 1\n",
      );
    });
  });

  test("exportAt exports a version from before the move", async () => {
    await withRepo(async (root, versioning) => {
      const { second, project } = await movedProject(root, versioning);
      const target = path.join(path.dirname(root), "exported");
      await versioning.exportAt(project, second, target);
      expect(
        await fs.readFile(path.join(target, "src", "Main.enso"), "utf8"),
      ).toBe("main = 2\n");
      expect(
        await fs.readFile(path.join(target, "src", "Extra.enso"), "utf8"),
      ).toBe("x = 1\n");
    });
  });

  test("restore brings a version from before the move back to the current path", async () => {
    await withRepo(async (root, versioning) => {
      const { first, project } = await movedProject(root, versioning);
      const { id } = await versioning.restore(project, first);
      expect(
        await fs.readFile(path.join(project, "src", "Main.enso"), "utf8"),
      ).toBe("main = 1\n");
      await expect(
        fs.access(path.join(project, "src", "Extra.enso")),
      ).rejects.toThrow();
      await expect(fs.access(path.join(root, "A"))).rejects.toThrow();
      expect(await git(root, "log", "-1", "--format=%H")).toBe(id);
      expect(await git(root, "log", "-1", "--format=%s")).toMatch(
        /^Restored version from /,
      );
      expect(await git(root, "status", "--porcelain", "--", "folder/A")).toBe(
        "",
      );
      await fs.access(path.join(project, ".enso", "project.json"));
    });
  });

  test("a version from before the move can be commented", async () => {
    await withRepo(async (root, versioning) => {
      const { first, project } = await movedProject(root, versioning);
      await versioning.setComment(project, first, "The original");
      expect((await versioning.log(project)).at(-1)?.comment).toBe(
        "The original",
      );
    });
  });
});

describe("setComment with an empty comment", () => {
  test("removes the note, so the commit message shows again", async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, "A");
      const { id } = await versioning.commit([a], "Saved");
      await versioning.setComment(a, id!, "Mine");
      await versioning.setComment(a, id!, "  ");
      expect((await versioning.log(a))[0]?.comment).toBe("Saved");
      await versioning.setComment(a, id!, "");
    });
  });

  test("works without a git identity (the notes commit uses the fallback)", async () => {
    await withProjects(async (root, versioning) => {
      await versioning.init(root);
      const a = path.join(root, "A");
      const { id } = await versioning.commit([a], "Saved");
      await versioning.setComment(a, id!, "Mine");
      await versioning.setComment(a, id!, "");
      expect((await versioning.log(a))[0]?.comment).toBe("Saved");
    });
  });
});
```

`withProjects` is the existing helper with no identity configured (M1).

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/project-manager-shim exec vitest run src/localVersioning
```

Expected:

- the `log` tests list only `[third, moved]`;
- `fileAt` fails with git's
  `path 'folder/A/src/Main.enso' does not exist in '<first>'`;
- `exportAt` and `restore` reject with `<id> is not a version of this project`;
- the empty-comment tests fail.

- [ ] **Step 3: Implement.** Beside `withoutMoveTrailer`, add:

```ts
/** The path in a commit message's `Enso-Moved-From` trailer, or `null`. */
function movedFrom(message: string): string | null {
  const prefix = `${MOVED_FROM_TRAILER}: `;
  const line = message
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(prefix));
  return line != null ? line.slice(prefix.length).trim() : null;
}

/** A version, with the project's repository-relative path at that version. */
interface LoggedVersion extends VersionEntry {
  readonly relativePath: string;
}

/** How many moves `log` follows back at most: a guard against a cycle of trailers. */
const MAX_FOLLOWED_MOVES = 100;
```

Replace `log` and `logIn`:

```ts
  async log(projectPath: string): Promise<readonly VersionEntry[]> {
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) return []
    const versions = await exclusive(repoRoot, () => this.logIn(repoRoot, projectPath))
    return versions.map(({ relativePath: _relativePath, ...version }) => version)
  }

  /**
   * The project's versions, newest first, following its moves back: when the oldest commit at the
   * current path carries an `Enso-Moved-From` trailer, the commits before it at the old path follow,
   * and so on. Each version records the path the project had then.
   */
  private async logIn(repoRoot: string, projectPath: string): Promise<readonly LoggedVersion[]> {
    const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
    const hasCommit = (revision: string) =>
      run(['rev-parse', '--verify', '--quiet', revision]).then(
        () => true,
        () => false,
      )
    if (!(await hasCommit('HEAD'))) return []
    let relative = await repoRelative(repoRoot, projectPath)
    let before: string | null = null
    const seen = new Set<string>()
    const commits: {
      readonly id: string
      readonly date: string
      readonly name: string
      readonly email: string
      readonly message: string
      readonly relativePath: string
    }[] = []
    for (let moves = 0; moves <= MAX_FOLLOWED_MOVES; moves++) {
      const output = await run([
        'log',
        '--format=%H%x00%cI%x00%an%x00%ae%x00%B%x1e',
        ...(before != null ? [`${before}^`] : []),
        '--',
        relative,
        excludeEnso(relative),
      ])
      const segment = output
        .split('\x1e')
        .filter((record) => record.trim() !== '')
        .map((record) => {
          const [id = '', date = '', name = '', email = '', message = ''] = record
            .replace(/^\r?\n/, '')
            .split('\0')
          return { id, date, name, email, message: message.trim(), relativePath: relative }
        })
        .filter((commit) => !seen.has(commit.id))
      for (const commit of segment) {
        seen.add(commit.id)
        commits.push(commit)
      }
      const oldest = segment.at(-1)
      const from = oldest != null ? movedFrom(oldest.message) : null
      if (oldest == null || from == null || from === relative) break
      if (!(await hasCommit(`${oldest.id}^`))) break
      before = oldest.id
      relative = from
    }
    // An absent notes ref lists nothing.
    const noted = new Set(
      (await run(['notes', NOTES_REF, 'list']))
        .split(/\r?\n/)
        .map((line) => line.split(' ')[1])
        .filter((id): id is string => !!id),
    )
    return Promise.all(
      commits.map(async ({ id, date, name, email, message, relativePath }, index) => ({
        id,
        date,
        author: { name, email },
        comment:
          noted.has(id) ?
            (await run(['notes', NOTES_REF, 'show', id])).replace(/\r?\n$/, '')
          : withoutMoveTrailer(message),
        isLatest: index === 0,
        relativePath,
      })),
    )
  }
```

`assertProjectVersionIn` now returns `Promise<LoggedVersion>`; its body is
unchanged.

In `fileAt`, the body inside `exclusive` becomes:

```ts
const current = await repoRelative(repoRoot, projectPath);
// An id not in the log (which `fileAt` has always accepted) reads at the current path.
const version = (await this.logIn(repoRoot, projectPath)).find(
  (entry) => entry.id === id,
);
const relative = version?.relativePath ?? current;
const target = relative === "." ? file : `${relative}/${file}`;
return runGit(repoRoot, ["show", `${id}:${target}`], { queueKey: repoRoot });
```

In `exportAt`, replace the two lines that compute `relative` and `tree`:

```ts
const version = await this.assertProjectVersionIn(repoRoot, projectPath, id);
const relative = version.relativePath;
const tree = relative === "." ? `${id}^{tree}` : `${id}:${relative}`;
```

In `restore`, replace its `try { await runGit(… 'restore' …) }` block with:

```ts
const relative = await repoRelative(repoRoot, projectPath);
const run = (args: readonly string[]) =>
  runGit(repoRoot, args, { queueKey: repoRoot });
try {
  if (version.relativePath === relative) {
    await run([
      "restore",
      `--source=${id}`,
      "--staged",
      "--worktree",
      "--",
      relative,
      excludeEnso(relative),
    ]);
  } else {
    if (relative === ".")
      throw new Error(
        "A version from before a move cannot be restored at the repository root.",
      );
    // The version is from before a move: its files were at another path. Everything at the
    // current path is tracked (the commit above), so drop it from the index, read the old
    // path's tree in under the current path, write it out, and remove what is left over.
    await run([
      "rm",
      "-r",
      "-q",
      "--cached",
      "--ignore-unmatch",
      "--",
      relative,
      excludeEnso(relative),
    ]);
    await run([
      "read-tree",
      `--prefix=${relative}/`,
      `${id}:${version.relativePath}`,
    ]);
    await run(["restore", "--worktree", "--", relative, excludeEnso(relative)]);
    await run([
      "clean",
      "-f",
      "-d",
      "-q",
      "--",
      relative,
      excludeEnso(relative),
    ]);
  }
} catch (error) {
  throw lockMessage(error) != null ? new Error(lockMessage(error)!) : error;
}
```

`git clean` without `-x` leaves ignored files (`.enso/`, `*.bak`) alone. In a
repository that tracks a project's `.enso/`, `read-tree --prefix` fails with
"already exists", and only the index has changed by then. Record this as a known
limitation in `CLAUDE.md`.

In `setComment`, inside its existing `try`, before the `notes add` call (M1: the
notes ref is a commit, so it needs the identity just as `add` does):

```ts
if (comment.trim() === "") {
  await runGit(
    repoRoot,
    [
      ...(await identityArgs(repoRoot)),
      ...AUTOMATIC,
      "notes",
      NOTES_REF,
      "remove",
      "--ignore-missing",
      "--end-of-options",
      id,
    ],
    { queueKey: repoRoot },
  );
  return;
}
```

- [ ] **Step 4: Run the whole shim suite and its typecheck; they pass**, the
      existing `commitMove`, `log`, `restore` and `exportAt` tests included.
      Then run them again in WSL, after sourcing `~/.enso-toolchain.sh`.

```bash
corepack pnpm -C app/project-manager-shim exec vitest run
corepack pnpm -C app/project-manager-shim run typecheck
```

- [ ] **Step 5: Docs.** In `app/project-manager-shim/CLAUDE.md`:
  - "Close hook and moves": replace "so the earlier history can be followed (PR
    5)" with "`log` follows it: when the oldest commit at the current path
    carries the trailer, the commits before it at the old path follow (at most
    100 moves). `fileAt`, `exportAt` and `restore` use the path the project had
    at the version; a restore across a move replaces the current path's files
    with the old path's tree (`rm --cached`, `read-tree --prefix`,
    `restore --worktree`, `clean`). Known limitation: not in a repository that
    tracks `.enso/`."
  - "Notes reference": "An empty comment removes the note (`notes remove`, with
    the identity fallback)."

- [ ] **Step 6: Commit.**

```bash
git add app/project-manager-shim
git commit -m "Shim: follow a project's versions across renames and moves"
```

---

### Task 31: `LocalBackend` implements the version methods

**Files:**

- Modify: `app/common/src/services/LocalBackend.ts`
- Create: `app/common/src/services/__test__/LocalBackend.versions.test.ts`
- Modify: `app/common/CLAUDE.md`

**Interfaces:**

Consumes:

- Task 15b's `makeLocalBackend()`;
- `ProjectManager.listVersions`, `versionFileContent`, `restoreVersion`,
  `duplicateVersion` and `setVersionComment`;
- `Backend`'s abstract signatures: `listAssetVersions(assetId)`,
  `resolveProjectAssetData(projectId, relativePath, versionId?, abort?)`,
  `restoreAsset(assetId, versionId)`,
  `copyAsset(assetId, parentDirectoryId, versionId?)`,
  `duplicateProject(projectId, versionId, title)` and
  `updateAsset(assetId, body, title)`.

Produces: those methods, for projects. A version id is the commit hash, in the
`S3ObjectVersionId` brand. Each `VersionEntry` becomes an `S3ObjectVersion`:

| `S3ObjectVersion` field | Value                                  |
| ----------------------- | -------------------------------------- |
| `versionId`             | `S3ObjectVersionId(id)`                |
| `lastModified`          | `Rfc3339DateTime(date)`                |
| `isLatest`              | `isLatest`                             |
| `key`                   | `id`                                   |
| `user`                  | `{ name, email: EmailAddress(email) }` |
| `comment`               | `comment`                              |
| `tags`                  | omitted                                |

The names exist under these spellings (checked by the pre-flight review):
`EmailAddress` and `S3ObjectVersionId` in the Backend types, and
`Rfc3339DateTime` in `utilities/data/dateTime.ts`.

- [ ] **Step 1: Write the failing tests.** `LocalBackend.versions.test.ts`:

```ts
/** @file `LocalBackend`'s version methods (the right panel's Versions tab) over the shim. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailAddress, S3ObjectVersionId, type AnyAsset } from "../Backend";
import { newDirectoryId, newProjectId } from "../LocalBackend";
import { Path, UUID, type VersionEntry } from "../ProjectManager/types";
import { makeLocalBackend } from "./localBackendTestUtils";

const PROJECT = Path("/root/P");
const ID = "a".repeat(40);
const ENTRY: VersionEntry = {
  id: ID,
  date: "2026-10-16T10:00:00+01:00",
  author: { name: "Ada", email: "ada@example.com" },
  comment: "Saved",
  isLatest: true,
};
const DUPLICATE = {
  projectId: UUID("11111111-1111-1111-1111-111111111111"),
  projectName: "P (2)",
  projectPath: Path("/root/P_1"),
  projectNormalizedName: "P_1",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LocalBackend versions", () => {
  it("lists a project’s versions as S3 object versions, without tags", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "listVersions").mockResolvedValue({
      versions: [ENTRY],
    });
    expect(await localBackend.listAssetVersions(newProjectId(PROJECT))).toEqual(
      {
        versions: [
          {
            versionId: S3ObjectVersionId(ID),
            lastModified: "2026-10-16T10:00:00+01:00",
            isLatest: true,
            key: ID,
            user: { name: "Ada", email: EmailAddress("ada@example.com") },
            comment: "Saved",
          },
        ],
      },
    );
    expect(projectManager.listVersions).toHaveBeenCalledWith(PROJECT);
  });

  it("a folder has no versions", async () => {
    const { localBackend } = makeLocalBackend();
    expect(
      await localBackend.listAssetVersions(newDirectoryId(Path("/root/d"))),
    ).toEqual({
      versions: [],
    });
  });

  it("reads a file at a version; without one, from the disk as before", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "versionFileContent").mockResolvedValue(
      "main = 1",
    );
    const getFileContent = vi
      .spyOn(projectManager, "getFileContent")
      .mockResolvedValue(new Response("main = 2"));
    const id = newProjectId(PROJECT);
    expect(
      await localBackend.getMainFileContent(id, S3ObjectVersionId(ID)),
    ).toBe("main = 1");
    expect(projectManager.versionFileContent).toHaveBeenCalledWith(
      PROJECT,
      ID,
      "src/Main.enso",
    );
    expect(await localBackend.getMainFileContent(id)).toBe("main = 2");
    expect(getFileContent).toHaveBeenCalledWith(PROJECT, "src/Main.enso");
  });

  it("restores a version", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "restoreVersion").mockResolvedValue({
      id: "b".repeat(40),
    });
    await localBackend.restoreAsset(
      newProjectId(PROJECT),
      S3ObjectVersionId(ID),
    );
    expect(projectManager.restoreVersion).toHaveBeenCalledWith(PROJECT, ID);
  });

  it("copyAsset with a version duplicates it into the same folder, under the project’s title", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "duplicateVersion").mockResolvedValue(DUPLICATE);
    const asset = (id: string, title: string) =>
      ({ id, title }) as unknown as AnyAsset;
    vi.spyOn(localBackend, "getAssetDetails").mockImplementation(
      async (assetId) =>
        assetId === newProjectId(PROJECT)
          ? (asset(assetId, "P") as never)
          : (asset(assetId, "P (2)") as never),
    );
    const { asset: copy } = await localBackend.copyAsset(
      newProjectId(PROJECT),
      newDirectoryId(Path("/root")),
      S3ObjectVersionId(ID),
    );
    expect(projectManager.duplicateVersion).toHaveBeenCalledWith(
      PROJECT,
      ID,
      "P",
      "/root",
    );
    expect(copy.id).toBe(newProjectId(DUPLICATE.projectPath));
  });

  it("duplicateProject with a version calls duplicate-at", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    vi.spyOn(projectManager, "duplicateVersion").mockResolvedValue(DUPLICATE);
    const created = await localBackend.duplicateProject(
      newProjectId(PROJECT),
      S3ObjectVersionId(ID),
      "Copy",
    );
    expect(projectManager.duplicateVersion).toHaveBeenCalledWith(
      PROJECT,
      ID,
      "Copy",
      "/root",
    );
    expect(created.projectId).toBe(newProjectId(DUPLICATE.projectPath));
  });

  it("a version comment goes to set-comment; null clears it; nothing is moved", async () => {
    const { projectManager, localBackend } = makeLocalBackend();
    const setComment = vi
      .spyOn(projectManager, "setVersionComment")
      .mockResolvedValue();
    const move = vi.spyOn(projectManager, "moveFile");
    const id = newProjectId(PROJECT);
    await localBackend.updateAsset(
      id,
      { versionId: S3ObjectVersionId(ID), comment: "Mine" },
      "P",
    );
    await localBackend.updateAsset(
      id,
      { versionId: S3ObjectVersionId(ID), comment: null },
      "P",
    );
    expect(setComment.mock.calls).toEqual([
      [PROJECT, ID, "Mine"],
      [PROJECT, ID, ""],
    ]);
    expect(move).not.toHaveBeenCalled();
  });

  it("local versions have no tags", async () => {
    const { localBackend } = makeLocalBackend();
    await expect(
      localBackend.updateAsset(
        newProjectId(PROJECT),
        { versionId: S3ObjectVersionId(ID), tag: "release" },
        "P",
      ),
    ).rejects.toThrow("Local versions have no tags.");
  });
});
```

The `getAssetDetails` stub returns only the two fields `copyAsset` reads.
`as never` makes it match the method's generic return type. It is a stub, not a
third-party API.

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/common exec vitest run src/services/__test__/LocalBackend.versions.test.ts
```

Expected:
`Cannot manage users, folders, files, tags, and secrets on the local backend.`
for `listAssetVersions` and `restoreAsset`; the version argument ignored by the
others.

- [ ] **Step 3: Implement** in `LocalBackend.ts`. Import `Rfc3339DateTime` from
      `'../utilities/data/dateTime.js'`, beside `toReadableIsoString`. Remove
      `restoreAsset` and `listAssetVersions` from the block of methods that
      intentionally do not work, and add:

```ts
  /** The versions of a local project (git commits), newest first. Folders and files have none. */
  override async listAssetVersions(assetId: backend.AssetId): Promise<backend.AssetVersions> {
    const { type, path } = backend.extractTypeAndPath(assetId)
    if (type !== backend.AssetType.project) return { versions: [] }
    const { versions } = await this.projectManager.listVersions(path)
    return {
      versions: versions.map((version) => ({
        versionId: backend.S3ObjectVersionId(version.id),
        lastModified: Rfc3339DateTime(version.date),
        isLatest: version.isLatest,
        key: version.id,
        user: { name: version.author.name, email: backend.EmailAddress(version.author.email) },
        comment: version.comment,
      })),
    }
  }

  /** Restore a local project to a version. The project must be closed. */
  override async restoreAsset(
    assetId: backend.AssetId,
    versionId: backend.S3ObjectVersionId,
  ): Promise<void> {
    const { type, path } = backend.extractTypeAndPath(assetId)
    if (type !== backend.AssetType.project) {
      throw new Error('Only projects have versions on the Local Backend.')
    }
    await this.projectManager.restoreVersion(path, versionId)
  }
```

`resolveProjectAssetData`:

```ts
  /** Resolve the data of a project asset relative to the project root, at a version if given. */
  override async resolveProjectAssetData(
    projectId: backend.ProjectId,
    relativePath: string,
    versionId?: backend.S3ObjectVersionId,
  ): Promise<Response> {
    const { path } = backend.extractTypeAndPath(projectId)
    if (versionId != null) {
      return new Response(
        await this.projectManager.versionFileContent(path, versionId, relativePath),
      )
    }
    return await this.projectManager.getFileContent(path, relativePath)
  }
```

`duplicateProject`: give it
`versionId?: backend.S3ObjectVersionId, title?: string` and add, at the top of
the body:

```ts
const { path } = backend.extractTypeAndPath(projectId);
if (versionId != null) {
  const project = await this.projectManager.duplicateVersion(
    path,
    versionId,
    title ?? getFileName(path),
    getDirectoryAndName(path).directoryPath,
  );
  return {
    projectId: newProjectId(project.projectPath),
    name: project.projectName,
    packageName: project.projectNormalizedName,
    organizationId: backend.OrganizationId("organization-"),
    state: { type: backend.ProjectState.closed, volumeId: "" },
    ensoPath: backend.EnsoPath(project.projectPath),
  };
}
```

After it, keep the existing no-version body, without its own repeated
`const { path } = backend.extractTypeAndPath(projectId)`.

`copyAsset`: add `versionId?: backend.S3ObjectVersionId` as the third parameter,
and, inside the project branch, before the existing `duplicateProject` call:

```ts
if (versionId != null) {
  const { title } = await this.getAssetDetails(assetId, undefined);
  const project = await this.projectManager.duplicateVersion(
    path,
    versionId,
    title,
    backend.extractTypeAndPath(parentDirectoryId).path,
  );
  return {
    asset: await this.getAssetDetails(
      newProjectId(project.projectPath),
      undefined,
    ),
  };
}
```

`updateAsset`: at the top of the body:

```ts
if (body.versionId != null) {
  const { type, path } = backend.extractTypeAndPath(assetId);
  if (body.tag != null) throw new Error("Local versions have no tags.");
  if (type !== backend.AssetType.project) {
    throw new Error("Only projects have versions on the Local Backend.");
  }
  // An empty comment removes it (the shim deletes the note), so the version shows its message.
  await this.projectManager.setVersionComment(
    path,
    body.versionId,
    body.comment ?? "",
  );
  return;
}
```

- [ ] **Step 4: Run the common suite and the common and GUI typechecks; they
      pass.**

```bash
corepack pnpm -C app/common exec vitest run src/services
corepack pnpm -C app/common run typecheck
corepack pnpm -C app/gui run typecheck
```

- [ ] **Step 5: Docs.** Add to `app/common/CLAUDE.md`'s versioning bullet: "PR
      5: the Versions tab's methods (`listAssetVersions`,
      `resolveProjectAssetData` with a version, `restoreAsset`,
      `copyAsset`/`duplicateProject` with a version, `updateAsset` with a
      version comment) call `log`, `file-at`, `restore`, `duplicate-at` and
      `set-comment`. A version id is a commit hash in the `S3ObjectVersionId`
      brand; only projects have versions; local versions have no tags."

- [ ] **Step 6: Commit.**

```bash
git add app/common
git commit -m "LocalBackend: list, compare, restore, duplicate and comment local project versions"
```

---

### Task 32: the Versions tab for local projects

**Files:**

- Modify: `app/gui/src/providers/rightPanel.ts`
- Modify: `app/gui/src/cloud/versions/AssetVersions.vue`, `AssetVersionList.vue`
- Modify: `app/gui/src/cloud/versions/__tests__/AssetVersions.test.ts`
- Modify: `app/common/src/text/english.json`

**Interfaces:**

Consumes: Task 31's methods; Task 15b's
`localVersioningStatusQueryOptions(backend, path | null)` and
`LocalBackend.versioningStatus`; `isCloudCategory`, `isLocalCategory` and
`CATEGORY_BACKEND` (`$/providers/category`); `useBackends()`.

Produces: `AssetVersionList.vue`'s prop `backend: Backend` (it was
`RemoteBackend`). The tab shows, for a local category:

| Selection                                       | Shown                                 |
| ----------------------------------------------- | ------------------------------------- |
| nothing                                         | `assetVersions.notSelected`           |
| no local backend                                | `assetVersions.localUnavailable` (m3) |
| a folder or file                                | `assetVersions.localProjectsOnly`     |
| a project whose status is loading               | a loader                              |
| no git                                          | `assetVersions.localNoGit`            |
| no repository                                   | `assetVersions.localNoRepository`     |
| a repository that is not enabled (or opted out) | `assetVersions.localNotEnabled`       |
| a repository that is enabled                    | the list                              |

Decision: a repository that is not enabled shows a placeholder, not a read-only
list. `log` would work without consent, but Restore and comments would then
fail, so consent comes first.

Decision (S11): the texts say what is missing, and do not point at PR 4's
Settings section, so that PR 5 stands on its own.

Texts: delete `"assetVersions.localAssetsDoNotHaveVersions"`; its only user is
`AssetVersions.vue` (check with
`grep -rn "assetVersions.localAssetsDoNotHaveVersions" app/gui`). Add after
`"assetVersions.removeTag"`:

```json
  "assetVersions.localProjectsOnly": "In the local drive, only projects have versions.",
  "assetVersions.localUnavailable": "The local drive is not available.",
  "assetVersions.localNoGit": "Install git to keep versions of local projects.",
  "assetVersions.localNoRepository": "This project is not in a git repository, so it has no versions.",
  "assetVersions.localNotEnabled": "Versions are not kept in this project's git repository.",
```

- [ ] **Step 1: Move the test helpers and add the local mocks.** In
      `AssetVersions.test.ts`:

  (a) Move `openMenu` and `choose` out of `describe('actions', …)` to the module
  level, unchanged. They are needed by Tasks 33 and 34.

  (b) Next to the `backend` mock, add a local backend and give both to
  `useBackends`:

```ts
const localBackend = vi.hoisted(() => ({
  type: "local",
  versioningStatus: vi.fn(),
  listAssetVersions: vi.fn(),
  listAssetVersionTags: vi.fn(),
  restoreAsset: vi.fn(),
  copyAsset: vi.fn(),
  updateAsset: vi.fn(),
  getMainFileContent: vi.fn(),
}));
vi.mock("$/providers/backends", () => ({
  useBackends: () => ({ remoteBackend: backend, localBackend }),
}));
```

(c) Add the opened projects' mock now, because Task 34's restore code calls it
for every backend. It returns `undefined` by default:

```ts
const openedProjects = vi.hoisted(() => ({
  get: vi.fn(),
  closeProject: vi.fn(),
  waitForProcess: vi.fn(async () => {}),
}));
vi.mock("$/providers/openedProjects", () => ({
  useOpenedProjects: () => openedProjects,
}));
```

(d) Add the local fixtures:

```ts
const LOCAL_PROJECT = {
  type: AssetType.project,
  id: newProjectId(Path("/root/P")),
  title: "P",
  parentId: newDirectoryId(Path("/root")),
} as unknown as AnyAsset;

function localStatus(extra: object = {}) {
  return {
    git: true,
    repoRoot: "/root",
    enabled: true,
    optedOut: false,
    changed: false,
    blocked: null,
    lastVersion: null,
    ...extra,
  };
}
```

with
`import { newDirectoryId, newProjectId } from 'enso-common/src/services/LocalBackend'`
and `Path` from the Backend import. In the top-level `beforeEach`, add
`openedProjects.get.mockReset().mockReturnValue(undefined)`.

(e) Replace the placeholder test
`'outside the cloud, local assets have no versions'` with the local suite:

```ts
describe("in a local category", () => {
  /** Newest first. */
  let localVersions: S3ObjectVersion[];

  beforeEach(() => {
    category.value = { type: "local" };
    asset.value = LOCAL_PROJECT;
    localVersions = [
      version(2, { isLatest: true, comment: "Saved" }),
      version(1),
    ];
    localBackend.versioningStatus.mockReset().mockResolvedValue(localStatus());
    localBackend.listAssetVersions
      .mockReset()
      .mockImplementation(() => Promise.resolve({ versions: localVersions }));
    localBackend.listAssetVersionTags.mockReset().mockResolvedValue([]);
    localBackend.restoreAsset.mockReset().mockResolvedValue(undefined);
    localBackend.copyAsset.mockReset();
    localBackend.updateAsset.mockReset().mockResolvedValue(undefined);
    localBackend.getMainFileContent.mockReset().mockResolvedValue("main = 1");
  });

  test("lists a project’s versions from the local backend", async () => {
    const { wrapper } = await renderTab();
    expect(localBackend.versioningStatus).toHaveBeenCalledWith("/root/P");
    expect(localBackend.listAssetVersions).toHaveBeenCalledWith(
      LOCAL_PROJECT.id,
    );
    expect(backend.listAssetVersions).not.toHaveBeenCalled();
    expect(wrapper.text()).toMatch(/Version 2.*Version 1/);
    expect(wrapper.text()).toContain("Saved");
  });

  test("a folder: only projects have versions", async () => {
    asset.value = {
      ...LOCAL_PROJECT,
      type: AssetType.directory,
    } as unknown as AnyAsset;
    const { wrapper } = await renderTab();
    expect(wrapper.text()).toContain(
      "In the local drive, only projects have versions.",
    );
    expect(localBackend.versioningStatus).not.toHaveBeenCalled();
  });

  test.each([
    [
      { git: false, repoRoot: null, enabled: false },
      "Install git to keep versions of local projects.",
    ],
    [
      { repoRoot: null, enabled: false },
      "This project is not in a git repository, so it has no versions.",
    ],
    [
      { enabled: false },
      "Versions are not kept in this project's git repository.",
    ],
    [
      { enabled: false, optedOut: true },
      "Versions are not kept in this project's git repository.",
    ],
  ])("status %j says why there is no list", async (extra, message) => {
    localBackend.versioningStatus.mockResolvedValue(localStatus(extra));
    const { wrapper } = await renderTab();
    expect(wrapper.text()).toContain(message);
    expect(localBackend.listAssetVersions).not.toHaveBeenCalled();
  });
});
```

Keep the existing placeholder test for a folder in the cloud. It already covers
`invalidAssetType`.

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/cloud/versions
```

Expected: "Local assets do not have versions." instead of the list or the new
messages.

- [ ] **Step 3: Implement.** In `rightPanel.ts`'s `useRightPanelTabs`:

```ts
const isLocalDirectoryView = computed(
  () =>
    rightPanelContext.value?.category != null &&
    isLocalCategory(rightPanelContext.value.category),
);
const enabledInDrive = computed(() =>
  isCloudDirectoryView.value || isLocalDirectoryView.value
    ? Ok()
    : Err("Exclusive to the drive"),
);
```

Set the `'versions'` entry's `enabled` to `enabledInDrive`, and import
`isLocalCategory` beside `isCloudCategory`. The other cloud-only tabs keep
`enabledInCloudOnly`.

`AssetVersions.vue` script (replacing `state` and the backend destructuring):

```ts
import Loader from "$/components/Spinner/Loader.vue";
import { isCloudCategory, isLocalCategory } from "$/providers/category";
import { localVersioningStatusQueryOptions } from "$/utils/localVersioningQuery";
import { useQuery } from "@tanstack/vue-query";
import {
  AssetType,
  extractTypeAndPath,
  type Backend,
} from "enso-common/src/services/Backend";

const { remoteBackend, localBackend } = useBackends();

/** The selected local project's path, while a local category is shown. */
const localProjectPath = computed(() => {
  const category = rightPanel.context?.category;
  const asset = rightPanel.focusedAsset;
  if (
    category == null ||
    !isLocalCategory(category) ||
    asset?.type !== AssetType.project
  ) {
    return null;
  }
  return extractTypeAndPath(asset.id).path;
});
const localStatusQuery = useQuery(
  computed(() =>
    localVersioningStatusQueryOptions(localBackend, localProjectPath.value),
  ),
);

type State =
  | { readonly placeholder: string }
  | { readonly loading: true }
  | {
      readonly asset: DatalinkAsset | FileAsset | ProjectAsset;
      readonly backend: Backend;
    };

const state = computed((): State => {
  const category = rightPanel.context?.category;
  const asset = rightPanel.focusedAsset;
  if (category == null || asset == null)
    return { placeholder: getText("assetVersions.notSelected") };
  if (isCloudCategory(category)) {
    return hasVersions(asset)
      ? { asset, backend: remoteBackend }
      : { placeholder: getText("assetVersions.invalidAssetType") };
  }
  if (localBackend == null)
    return { placeholder: getText("assetVersions.localUnavailable") };
  if (asset.type !== AssetType.project) {
    return { placeholder: getText("assetVersions.localProjectsOnly") };
  }
  const status = localStatusQuery.data.value;
  if (status == null) return { loading: true };
  if (!status.git) return { placeholder: getText("assetVersions.localNoGit") };
  if (status.repoRoot == null)
    return { placeholder: getText("assetVersions.localNoRepository") };
  if (!status.enabled)
    return { placeholder: getText("assetVersions.localNotEnabled") };
  return { asset, backend: localBackend };
});
```

The template:

```vue
<Result
  v-if="'placeholder' in state"
  status="info"
  :centered="true"
  :title="state.placeholder"
/>
<Loader v-else-if="'loading' in state" />
<ErrorBoundary v-else :key="state.asset.id">
    <SuspenseLoader>
      <AssetVersionList :backend="state.backend" :item="state.asset" />
    </SuspenseLoader>
  </ErrorBoundary>
```

Remove the `CATEGORY_BACKEND`, `BackendType` and `includes` imports if nothing
else uses them. Change the file comment's first sentence to "the versions of the
asset selected in a cloud category, or of a local project in an enabled git
repository". If `useBackends()` types `localBackend` as `Backend | null`, narrow
it with `localBackend instanceof LocalBackend ? localBackend : null` (in the
test, the hoisted stub is not an instance). In that case have the query's
`backend` argument use the same narrowing, and change the test's stub to
`Object.assign(Object.create(LocalBackend.prototype), { … })`. Never use a
double cast.

`AssetVersionList.vue`: change the prop to `backend: Backend`, importing
`type Backend` from `enso-common/src/services/Backend` instead of
`RemoteBackend`.

- [ ] **Step 4: Run the tests, typecheck and lint; they pass.**

```bash
corepack pnpm -C app/gui exec vitest run src/cloud/versions src/providers
corepack pnpm -C app/gui run typecheck
corepack pnpm -C app/gui exec eslint src/cloud/versions src/providers/rightPanel.ts
```

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src app/common/src/text/english.json
git commit -m "GUI: the Versions tab lists a local project's versions"
```

---

### Task 33: no tags on local versions; comments stay editable

**Files:** `app/gui/src/cloud/versions/AssetVersion.vue`; its test file.

**Interfaces:**

Consumes: `versionTagsQueryOptions(backend)`, `AddVersionTag`, `BackendType`.

Produces:

- In `AssetVersion.vue`,
  `const hasTags = computed(() => backend.type !== BackendType.local)`. The
  tag-suggestions query runs only when it is true, and `AddVersionTag` renders
  only when it is true.
- "Latest" (`getText('latestIndicator')`, a label shown by the tab, not a stored
  tag) stays, with no remove button.

Decision: "Latest" stays on local versions. The user cannot add or remove it,
and the list needs it to show which version is current.

- [ ] **Step 1: Write the failing tests** (in
      `describe('in a local category', …)`):

```ts
test('no tags: no "Add tag" button, no suggestions; "Latest" still shows', async () => {
  const { wrapper } = await renderTab();
  expect(wrapper.text()).toContain("Latest");
  // In the cloud, each version has an "add" button for a tag (see the tags tests).
  expect(buttonsWithIcon("add")).toHaveLength(0);
  expect(localBackend.listAssetVersionTags).not.toHaveBeenCalled();
});

test("a comment is added from the comment button, and saved with Enter", async () => {
  await renderTab();
  const user = userEvent.setup();
  const addComment = document.querySelector<HTMLElement>(
    'button[aria-label="Add comment"]',
  )!;
  await user.click(addComment);
  const textArea = document.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(document.activeElement).toBe(textArea);
  await user.keyboard("The first draft{Enter}");
  await flushPromises();
  expect(localBackend.updateAsset).toHaveBeenCalledWith(
    LOCAL_PROJECT.id,
    { versionId: localVersions[1]!.versionId, comment: "The first draft" },
    "P",
  );
  expect(text()).toContain("The first draft");
});
```

Version 2 has the comment "Saved", so the only "Add comment" button is version
1's, at index 1.

- [ ] **Step 2: Run them and watch them fail.**

```bash
corepack pnpm -C app/gui exec vitest run src/cloud/versions
```

Expected: one or more "add" buttons, and `listAssetVersionTags` called.

- [ ] **Step 3: Implement.** In `AssetVersion.vue`, import `BackendType` with
      the other Backend names, and replace
      `const tagsQuery = useQuery(versionTagsQueryOptions(backend))` with:

```ts
/** Only the cloud tags versions; a local version is a git commit, and git tags are repository-wide. */
const hasTags = computed(() => backend.type !== BackendType.local);
const tagsQuery = useQuery(
  computed(() => ({
    ...versionTagsQueryOptions(backend),
    enabled: hasTags.value,
  })),
);
```

Then change `<AddVersionTag` to `<AddVersionTag v-if="hasTags"`. Adding
`enabled` leaves the shared key and its defaults as they are.

- [ ] **Step 4: Run the tests and lint; they pass.**

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/cloud/versions
git commit -m "GUI: local versions have no tags"
```

---

### Task 34: restoring an open local project: close, restore, reopen

**Files:** `app/gui/src/cloud/versions/AssetVersionList.vue`; its test file.

**Interfaces:**

Consumes:

- `useOpenedProjects()` (`get`, `closeProject`, `waitForProcess`; a project's
  `state.status` and `error`);
- `useContainerData().openProjectLocally(info, backendType, userAction)`;
- `localVersioningStatusQueryOptions(null, path).queryKey` (Task 15b);
- `useQueryClient`.

Produces, in `AssetVersionList.vue`:

```ts
/**
 * Restore a version. A local project that is open is closed first (saving its "Saved on close"
 * version, so nothing is lost), then restored and opened again; the shim refuses to restore a
 * running project. If the close fails, nothing is restored and the error is shown.
 */
async function restoreVersion(versionId: S3ObjectVersionId): Promise<void>;
```

Decision: the project reopens with `userAction = false`, so the drive stays in
front, where the user chose Restore. The project's tab is there to switch to.

- [ ] **Step 1: Write the failing tests** (in
      `describe('in a local category', …)`):

```ts
test("restoring an open project closes it, restores, and opens it again", async () => {
  const order: string[] = [];
  const opened = { state: { status: "initialized" }, error: undefined };
  openedProjects.get.mockReturnValue(opened);
  openedProjects.closeProject.mockImplementation(() => order.push("close"));
  openedProjects.waitForProcess.mockImplementation(async () => {
    order.push("closed");
  });
  localBackend.restoreAsset.mockImplementation(async () => {
    order.push("restore");
  });
  openProjectLocally.mockImplementation(() => order.push("open"));
  await renderTab();
  const user = await openMenu(1);
  await choose(user, "Restore");
  await vi.waitFor(() =>
    expect(order).toEqual(["close", "closed", "restore", "open"]),
  );
  expect(localBackend.restoreAsset).toHaveBeenCalledWith(
    LOCAL_PROJECT.id,
    localVersions[1]!.versionId,
  );
  expect(openProjectLocally).toHaveBeenCalledWith(
    LOCAL_PROJECT,
    "local",
    false,
  );
});

test("if the close fails, nothing is restored and the error is shown", async () => {
  const opened = {
    state: { status: "initialized" },
    error: undefined as Error | undefined,
  };
  openedProjects.get.mockReturnValue(opened);
  openedProjects.waitForProcess.mockImplementation(async () => {
    opened.error = new Error("engine did not stop");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await renderTab();
  const user = await openMenu(1);
  await choose(user, "Restore");
  await vi.waitFor(() => expect(text()).toContain("engine did not stop"));
  expect(localBackend.restoreAsset).not.toHaveBeenCalled();
  expect(openProjectLocally).not.toHaveBeenCalled();
});

test("a closed project is restored without opening it", async () => {
  await renderTab();
  const user = await openMenu(1);
  await choose(user, "Restore");
  await vi.waitFor(() => expect(localBackend.restoreAsset).toHaveBeenCalled());
  expect(openedProjects.closeProject).not.toHaveBeenCalled();
  expect(openProjectLocally).not.toHaveBeenCalled();
});

test('"Duplicate and open" opens the local copy with the local backend', async () => {
  const copyId = newProjectId(Path("/root/P_1"));
  localBackend.copyAsset.mockResolvedValue({
    asset: { ...LOCAL_PROJECT, id: copyId },
  });
  await renderTab();
  const user = await openMenu(1);
  await choose(user, "Duplicate and open");
  expect(localBackend.copyAsset).toHaveBeenCalledWith(
    LOCAL_PROJECT.id,
    newDirectoryId(Path("/root")),
    localVersions[1]!.versionId,
  );
  expect(openProjectLocally).toHaveBeenCalledWith(
    expect.objectContaining({ id: copyId }),
    "local",
  );
});
```

The error toast is rendered by the toast host. If `renderTab` mounts no toast
host, assert on `console.error` instead (`toastAndLog` logs the same message):
`expect(console.error).toHaveBeenCalledWith(expect.stringContaining('engine did not stop'))`.

- [ ] **Step 2: Run them and watch them fail.** Expected: the order is
      `['restore']`.

- [ ] **Step 3: Implement.** In `AssetVersionList.vue`:

```ts
import { useOpenedProjects } from "$/providers/openedProjects";
import { localVersioningStatusQueryOptions } from "$/utils/localVersioningQuery";
import {
  BackendType,
  extractTypeAndPath /* …existing names… */,
} from "enso-common/src/services/Backend";

const openedProjects = useOpenedProjects();

async function restoreVersion(versionId: S3ObjectVersionId) {
  if (backend.type !== BackendType.local || item.type !== AssetType.project) {
    await backend.restoreAsset(item.id, versionId);
    return;
  }
  const opened = openedProjects.get(item.id);
  const wasOpen = opened != null && opened.state.status !== "not-opened";
  if (opened != null && wasOpen) {
    openedProjects.closeProject(item.id);
    await openedProjects.waitForProcess(opened);
    if (opened.error != null) throw opened.error;
  }
  await backend.restoreAsset(item.id, versionId);
  if (wasOpen) openProjectLocally(item, BackendType.local, false);
}

const restoreInvalidates =
  backend.type === BackendType.local
    ? [
        versionsQueryOptions.queryKey,
        localVersioningStatusQueryOptions(
          null,
          extractTypeAndPath(item.id).path,
        ).queryKey,
      ]
    : [versionsQueryOptions.queryKey];

const restoreMutation = useMutation({
  mutationFn: (variables: {
    versionId: S3ObjectVersionId;
    placeholderId: S3ObjectVersionId;
  }) => restoreVersion(variables.versionId),
  onError: (error: unknown) => toastAndLog("restoreProjectError", error),
  meta: { invalidates: restoreInvalidates, awaitInvalidates: true },
});
```

If `opened.error` is a `ResultError` rather than an `Error`, throw
`new Error(getMessageOrToString(opened.error))`, so that `toastAndLog` shows its
message.

- [ ] **Step 4: Run the tests, typecheck and lint; they pass.**

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/cloud/versions
git commit -m "GUI: restoring an open local project closes it first, then opens it again"
```

---

### Task 35: Playwright, screenshots, changelog, PR body

**Files:**

- Modify: `app/gui/integration-test/mock/versioning/historyRoutes.ts`
- Create: `app/gui/integration-test/dashboard/localVersions.spec.ts`
- Modify: `app/gui/src/cloud/versions/CLAUDE.md`, `CHANGELOG.md`
- Create (not committed):
  `C:\Repos\Enso\ide\.superpowers\sdd\2026-10-16-local-git-versioning\pr5-body.md`

**Interfaces:**

Consumes:

- Task 15b's `VersioningRouteHandler` and `VersioningMockContext` (`state`,
  `addProject`), and `toJSONRPCResult` and `toJSONRPCError`;
- the `drivePage` fixture: `goToCategory.local()` and
  `driveTable.clickRow(name)`;
- the right panel's tab, `getByRole('tab', { name: 'Versions' })`
  (`SelectableTab` is `role="tab"`, named by its title);
- `expectScreenshot`.

Produces: `HISTORY_ROUTES` (`log`, `file-at`, `restore`, `duplicate-at`,
`set-comment`).

- [ ] **Step 1: Mock the routes.** `mock/versioning/historyRoutes.ts`:

```ts
/** @file The mocked versioning routes behind the Versions tab, over `MockVersioning`. */
import { Path } from "enso-common/src/services/ProjectManager/types";
import { toRfc3339 } from "enso-common/src/utilities/data/dateTime";
import { uuidv4 } from "lib0/random.js";
import { posix } from "node:path";
import { toJSONRPCError, toJSONRPCResult } from "../jsonRpc";
import type { VersioningRouteHandler } from "../localVersioning";

const notEnabled = (repoRoot: string | null) =>
  toJSONRPCError(
    `Versioning is not enabled for the repository at ${repoRoot}.`,
  );

export const HISTORY_ROUTES: Readonly<Record<string, VersioningRouteHandler>> =
  {
    log: (params, { state }) =>
      toJSONRPCResult({
        versions: state.versions.get(String(params.path)) ?? [],
      }),
    "file-at": (params, { state }) => {
      const version = (state.versions.get(String(params.path)) ?? []).find(
        (entry) => entry.id === params.id,
      );
      return version == null
        ? toJSONRPCError(
            `${String(params.id)} is not a version of this project`,
          )
        : toJSONRPCResult(`main =\n    "${version.comment}"\n`);
    },
    restore: (params, { state }) => {
      if (!state.enabled) return notEnabled(state.repoRoot);
      state.restores.push([String(params.path), String(params.id)]);
      return toJSONRPCResult({ id: String(params.id) });
    },
    "duplicate-at": (params, { state, addProject }) => {
      const title = String(params.title);
      const name = `${title} (copy)`;
      const normalizedName = name.replace(/\W+/g, "_");
      const projectPath = Path(
        posix.join(String(params.parentPath), normalizedName),
      );
      const projectId = uuidv4();
      state.duplicates.push([String(params.path), String(params.id), title]);
      addProject({
        path: projectPath,
        metadata: {
          id: projectId,
          name,
          namespace: "local",
          created: toRfc3339(new Date()),
        },
      });
      return toJSONRPCResult({
        projectId,
        projectName: name,
        projectPath,
        projectNormalizedName: normalizedName,
      });
    },
    "set-comment": (params, { state }) => {
      if (!state.enabled) return notEnabled(state.repoRoot);
      const path = String(params.path);
      state.versions.set(
        path,
        (state.versions.get(path) ?? []).map((entry) =>
          entry.id === params.id
            ? { ...entry, comment: String(params.comment) }
            : entry,
        ),
      );
      return toJSONRPCResult(null);
    },
  };
```

`ProjectMetadata.id` is a `UUID` brand. Wrap it as `UUID(uuidv4())`, as
`localRecent.spec.ts` does, importing `UUID` from the same types module.

- [ ] **Step 2: Write the spec.** `dashboard/localVersions.spec.ts`:

```ts
/**
 * @file The right panel's Versions tab for local projects: the list, See changes, restore,
 * duplicate and comments. The shim's `versioning/*` routes are mocked (`mock/localVersioning.ts`,
 * `mock/versioning/historyRoutes.ts`).
 */
import {
  Path,
  type VersionEntry,
} from "enso-common/src/services/ProjectManager/types";
import { expect, test, type Page } from "integration-test/base";
import { posix } from "node:path";
import { expectScreenshot } from "../screenshot";

const ROOT = "/home/user/enso/enso-projects";
const MOCK_PROJECT_PATH = posix.join(ROOT, "Mock_Project");

function entry(n: number, comment: string, isLatest = false): VersionEntry {
  return {
    id: n.toString(16).padStart(40, "0"),
    date: `2026-10-1${n}T10:00:00Z`,
    author: { name: "Ada", email: "ada@example.com" },
    comment,
    isLatest,
  };
}

const VERSIONS = [
  entry(3, "Joined the sales table", true),
  entry(2, "Saved on close"),
  entry(1, "Saved"),
];

/** The right panel's Versions tab. */
async function openVersions(page: Page) {
  await page.getByRole("tab", { name: "Versions" }).click();
  return page.getByTestId("right-panel").locator("visible=true");
}

/** The actions menu of the version at `index` (0 is the newest). */
async function openVersionMenu(page: Page, index: number) {
  const panel = page.getByTestId("right-panel").locator("visible=true");
  await panel.locator('button[aria-haspopup="menu"]').nth(index).click();
  return page.getByRole("menu");
}

test.describe("with versions kept", () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true;
        api.versioning.repoRoot = ROOT;
        api.versioning.enabled = true;
        api.versioning.versions.set(MOCK_PROJECT_PATH, [...VERSIONS]);
      },
    },
  });

  test("lists the versions, newest first, with their comments, and no tags", async ({
    page,
    drivePage,
  }) => {
    await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
    const panel = await openVersions(page);
    await expect(panel.getByText("Version 3")).toBeVisible();
    await expect(panel.getByText("Joined the sales table")).toBeVisible();
    await expect(panel.getByText("Saved on close")).toBeVisible();
    await expect(panel.getByText("Latest")).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Add tag" })).toHaveCount(
      0,
    );
    await expectScreenshot(panel, "local-versions-list.png");
  });

  test("restores an older version", async ({ page, drivePage, localApi }) => {
    await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
    await openVersions(page);
    const menu = await openVersionMenu(page, 2);
    await menu.getByRole("menuitem", { name: "Restore" }).click();
    await expect
      .poll(() => localApi.versioning.restores)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[2]!.id]]);
  });

  test("duplicates a version into the same folder", async ({
    page,
    drivePage,
    localApi,
  }) => {
    await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
    await openVersions(page);
    const menu = await openVersionMenu(page, 1);
    await menu
      .getByRole("menuitem", { name: "Duplicate", exact: true })
      .click();
    await expect
      .poll(() => localApi.versioning.duplicates)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[1]!.id, "Mock Project"]]);
    await expect(
      page.getByTestId("drive-view").getByText("Mock Project (copy)"),
    ).toBeVisible();
  });

  test("See changes compares Main.enso with the previous version", async ({
    page,
    drivePage,
  }) => {
    await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
    const panel = await openVersions(page);
    await panel.getByRole("button", { name: "See changes" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Compare Version 3 with Version 2");
    await expect(dialog).toContainText("Joined the sales table");
    await expectScreenshot(dialog, "local-version-diff.png");
  });

  test("a comment is edited", async ({ page, drivePage, localApi }) => {
    await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
    const panel = await openVersions(page);
    await panel.getByRole("button", { name: "Edit comment" }).last().click();
    const comment = panel.locator("textarea");
    await comment.fill("The first draft");
    await comment.press("Enter");
    await expect(panel.getByText("The first draft")).toBeVisible();
    expect(
      localApi.versioning.versions.get(MOCK_PROJECT_PATH)?.at(-1)?.comment,
    ).toBe("The first draft");
  });
});

test.describe("placeholders", () => {
  test.describe("with a folder", () => {
    test.use({
      setupApi: {
        local: (api) => void api.addDirectory({ path: Path(`${ROOT}/Data`) }),
      },
    });

    test("a folder: only projects have versions", async ({
      page,
      drivePage,
    }) => {
      await drivePage.goToCategory.local().driveTable.clickRow("Data");
      const panel = await openVersions(page);
      await expect(panel).toContainText(
        "In the local drive, only projects have versions.",
      );
    });
  });

  test.describe("with git and no repository", () => {
    test.use({
      setupApi: { local: (api) => void (api.versioning.git = true) },
    });

    test("says the project is in no repository", async ({
      page,
      drivePage,
    }) => {
      await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
      const panel = await openVersions(page);
      await expect(panel).toContainText(
        "This project is not in a git repository, so it has no versions.",
      );
    });
  });

  test("without git, says to install it", async ({ page, drivePage }) => {
    await drivePage.goToCategory.local().driveTable.clickRow("Mock Project");
    const panel = await openVersions(page);
    await expect(panel).toContainText(
      "Install git to keep versions of local projects.",
    );
  });
});
```

`addDirectory({ path })` is the mock API's own helper (`localApi.ts`, returned
in `api`).

- [ ] **Step 3: Run the spec on Windows and in WSL.**

```bash
corepack pnpm -r --if-present run compile
cd app/gui
corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/dashboard/localVersions.spec.ts
```

In WSL, write the `*-linux.png` baselines once with `--update-snapshots`, then
run the spec three times with `--workers=2`. Then run
`dashboard/rightPanel.spec.ts` and `dashboard/accessibility.spec.ts`; the asset
panel is one of its screens. Add no baseline entry without giving the reason.

- [ ] **Step 4: All checks.**
  - In `app/gui`: `typecheck`, `lint`, `test:unit`.
  - The vitest suites of `app/common` and the shim.
  - `prettier --check` over the changed files.
  - The whole `integration-test/dashboard/` directory, once on Linux. If a spec
    fails, compare its pass rate with `develop`'s.

- [ ] **Step 5: Screenshots for the PR.** "Before" is `develop`: "Local assets
      do not have versions." "After":
  - the list;
  - the diff;
  - the restore menu;
  - the duplicated copy in the drive;
  - the edited comment;
  - each placeholder.

  Push them to the orphan `pr-screenshots` branch under `pr-<number>/`, and
  embed them.

- [ ] **Step 6: Changelog** under `# Next Release` → `#### Enso IDE`:

```markdown
- [The Versions tab now works for local projects kept in git][NNN]: list a
  project's versions (following it across renames and moves), see what changed
  in each, compare any two, restore one (an open project is closed and reopened
  around it), duplicate one, and edit a version's comment.
```

Add the matching link line,
`[NNN]: https://github.com/jdunkerley/enso/pull/NNN`, at the bottom.

- [ ] **Step 7: Docs.** In `app/gui/src/cloud/versions/CLAUDE.md`:
  - the first paragraph: "an asset's versions in the Enso Cloud, or a local
    project's git versions";
  - a new bullet: `AssetVersions.vue`'s local gating
    (`localVersioningStatusQueryOptions` and the placeholders),
    `AssetVersion.vue`'s `hasTags`, and `AssetVersionList.vue`'s
    `restoreVersion`;
  - replace "so no Playwright spec covers these tabs" with "the local Versions
    tab is covered by `dashboard/localVersions.spec.ts`, against the mocked
    `versioning/*` routes; the cloud's has none";
  - the follow-up: the tab now serves the core too, so it should move out of
    `cloud/` (PR 6).

- [ ] **Step 8: Commit.**

```bash
git add app/gui CHANGELOG.md
git commit -m "GUI: Playwright specs for the local Versions tab; changelog"
```

- [ ] **Step 9: Draft the PR body** in `pr5-body.md`, shaped like `pr3-body.md`.
      It is neither committed nor pushed.
  - **Description.** PR 5 of local projects versioned with git (design #229), on
    Task 15b (#232), to merge after PR 4. What users see:
    - the local Versions tab: the list, See changes, Compare, Restore, Duplicate
      and open, and comments;
    - history across renames and moves;
    - the placeholders.
  - **Important notes.**
    - How moves are followed: the `Enso-Moved-From` trailer, at most 100 moves
      back.
    - Restoring across a move goes through the index (`rm --cached`,
      `read-tree --prefix`, `restore --worktree`, `clean`), so it fails in a
      repository that tracks `.enso/`.
    - An empty comment removes the note, using the identity fallback.
    - A version id is a commit hash, in the `S3ObjectVersionId` brand.
    - A repository that is not enabled shows a placeholder, not a read-only
      list.
    - "Latest" is kept; tags are hidden.
    - Restoring an open project closes it, restores, and reopens it in the
      background.
    - The tab stays in `src/cloud/` for now (a follow-up moves it).
    - Not verified: the Electron build (the installer test covers it).
  - **Also:** the screenshots, the "Closes" lines, the
    `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer and
    the session link.
  - **Do not push.** PR 5 waits for the user's installer test.

---

### Pre-flight resolutions

- **S8.** The shared mock base lives in Task 15b. PR 5 edits only
  `mock/versioning/historyRoutes.ts`, and never `localApi.ts`.
- **S9.** Git is absent by default (Task 15b). PR 5's specs opt in with
  `test.use({ setupApi })`, and the "without git" placeholder spec uses the
  default.
- **S10.** `LocalBackend.versioningStatus` lands once, in Task 15b. Task 32 no
  longer adds it.
- **S11.** The placeholders say what is missing ("…not in a git repository, so
  it has no versions", "Versions are not kept in this project's git repository")
  and point at no Settings section. PR 4 merges first all the same.
- **M1.** `notes remove` passes `identityArgs`, tested with no identity
  configured.
- **M4.** `duplicate-at` computes the copy's `path` and passes it to the
  context's `addProject`, whose options are `{ path, metadata }`. The project's
  path is the one it computed.
- **M5.** `localVersioningQuery.ts` (Task 15b) takes `path: Path | null`, so
  `AssetVersions.vue` needs no placeholder path.
- **M6.**
  - `restoreVersion` throws `opened.error` after a failed close, which is
    tested.
  - The mutation's `invalidates` includes the local status key.
- **R3.** The folder placeholder has its own spec. Every step of every spec is
  written out.
- **R4.** The test steps of Tasks 33 and 34 are written out, using `openMenu`
  and `choose`, which Task 32 moved to module level.
- **R5.** The `LocalBackend` tests share `makeLocalBackend()` (Task 15b).
- **m1.** A restore across a move into the repository root is refused with a
  clear error, instead of `--prefix=./`.
- **m2.** Not modelled: the mocked `set-comment` stores an empty comment as is.
  No spec clears a comment, and the shim's behaviour is covered by Task 30's
  tests.
- **m3.** Without a local backend, the tab says "The local drive is not
  available." (`assetVersions.localUnavailable`).
- **S1–S7, M2, M3, M7–M10, R1, R2, m4, m5.** These concern PR 4; see
  `plan-pr4.md`.

---

## PR 6 outline: docs

`CLAUDE.md` for the GUI provider, the Versions tab and `LocalBackend`; spec
status "implemented"; the OneDrive note.
