# Local projects versioned with git: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version local projects as git commits at the local root folder: commit
on close, on quit and by hand, show a changed indicator, and serve the Versions
tab for local projects. Move labels into `package.yaml`, and remove the engine's
unused VCS.

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
- Git failures never fail a close or quit.
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
| 4   | `feature/local-versioning-save`  | PR 3          | GUI: save, indicator, init prompt, quit           |
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

---

## PR 4 outline: saving in the GUI (detail when it starts)

1. `LocalBackend` methods over the client: `versioningStatus`, `commitVersion`,
   `initVersioning` (+ `enso-common` tests).
2. `$/providers/localVersioning`: per open local project, the status query
   (refetch every 5 s while open, invalidated after saves and drive changes).
   Hidden entirely when `git` is false.
3. Flush before saving: `text/save` for each open module through the project's
   LS connection; find the module's current version in the ydoc session.
4. Actions `graph.saveVersion` (Mod+S, "Saved") and
   `graph.saveVersionWithComment` (Mod+Shift+S, the dialog): definitions in
   `graphInputBindings.ts`, `project-view/providers/action.ts`,
   `keyboardShortcuts.ts`, handler in `GraphEditor.vue`, names in
   `english.json`.
5. The save dialog (optional comment; Enter saves; empty → "Saved").
6. `TopBar.vue`: the save `ActionButton` beside undo/redo, disabled when
   unchanged, its tooltip git's `blocked` message when blocked; the changed dot
   beside `NavBreadcrumbs`. `TabBar.vue`: the ● before the title. Accessible
   names "Changed since the last version".
7. The init prompt (Create / Not now / Don't ask again for this folder),
   remembered per root in a `createPersistedStore`, before a save or close of a
   project in no repository; never during quit. Its variant for an existing
   repository that is not enabled (`status.enabled` false): "Keep versions of
   your projects in the existing repository at <repoRoot>?" with Use
   (`enableVersioning`) / Not now / Don't ask again. A repository rooted at or
   inside the user's projects root is enabled silently on first status; any
   other gets the prompt.
8. Settings → Local: a Versions section (git found; repo path or Create
   repository; reset "Don't ask again").
9. Quit: `beforeunload` closes open local projects in a repository behind a
   "Saving versions…" dialog modelled on `SyncingProjectsModal.vue`.
10. Toasts for failures. Playwright: mocked `versioning/*` routes in
    `integration-test/mock/localApi.ts`; specs for save, save with comment,
    indicator, init prompt. Screenshots; changelog entry; installer test.

## PR 5 outline: the local Versions tab (detail when it starts)

1. `LocalBackend.listAssetVersions` (→ `S3ObjectVersion[]` with `versionId` =
   commit hash, `lastModified`, `isLatest`, `user` from the author, `comment`,
   no `tags`), `resolveProjectAssetData` with `versionId` (→ `file-at`),
   `restoreAsset`, `duplicateProject` with `versionId`, `updateAsset` with
   `versionId` + `comment` (→ `set-comment`).
2. `AssetVersions.vue`: gated on the category's backend supporting versions
   (local: when the status says git and a repository); pass the category's
   backend; hide tags (`AddVersionTag`, `VersionTag`, tag suggestions) for
   local; reword the placeholder for local folders and files.
3. Restore of an open project: close, restore, reopen.
4. Playwright with mocked routes: list, See changes, restore, duplicate, edit a
   comment. Screenshots; changelog entry; installer test.

## PR 6 outline: docs

`CLAUDE.md` for the GUI provider, the Versions tab and `LocalBackend`; spec
status "implemented"; the OneDrive note.
