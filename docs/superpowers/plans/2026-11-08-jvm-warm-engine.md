# A Warm Engine For The JVM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the user is on the dashboard, keep one JVM engine started and
warmed up in a standby mode, and hand it to the next project opened, so that a
JVM open no longer pays for the JVM start and the JIT compilation of the
engine's own Java.

**Architecture:** Three PRs. PR 1 gives the engine runner a `--standby` mode: it
warms up in a throwaway context, preloads classes, prints `STANDBY READY <ms>`,
then reads one JSON line from stdin (the arguments `project/open` would pass,
plus the per-open environment) and calls the ordinary `Main` launch with them.
PR 2 adds a spare-engine manager to the project service (`spareEngine.ts`),
wires it into `EnsoRunner.openProject`, adds `engine/setSpare` and the GUI's
"Pre-start the engine" switch. PR 3 teaches the open-time harness a `jvm-spare`
engine and records the measurement at 8 CPUs.

**Tech Stack:** Java 21+/GraalVM (engine runner, JUnit 4), Scala (Language
Server config), TypeScript (project-manager-shim, Electron, Vitest), Vue 3 (GUI
settings), Playwright (packaged IDE and GUI integration).

**Spec:** `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md` (merged
in #650). Executors read both.

## Global Constraints

- The re-gate is at **8 logical CPUs**: the JVM's `welcomeShown` and
  `libraryShown` within **1.5×** native. CI's 4 CPUs is reported, not gated.
- A spare exists only while the engine runs on the JVM, the setting is on, and
  no project is open.
- The warm-up loads the default template's imports (spec decision 3), builds a
  table, filters, aggregates and sorts it, and prepares a table visualization of
  the result, in a throwaway context on a temporary copy of the default template
  under the system temporary directory, which is deleted afterwards. (Task 6
  lists the imports; decision 4 below.)
- The engine prints `STANDBY READY <ms>` on stderr and
  `standby: warm-up done in N ms` once the warm-up is over.
- If stdin closes before a line arrives, the standby process exits with status
  **0**.
- Relative paths in the argument line are not allowed in standby mode.
- If the warm-up throws, the spare still reaches standby: a broken warm-up must
  never stop a project from opening.
- The Language Server's boot and configuration do not change (approach A): with
  the line, the process is an ordinary Language Server.
- One fresh process per project, killed on close. Respawns (the watchdog's) are
  always ordinary spawns.
- After a close, the next spare starts once the closing engine has exited or **2
  s** have passed, whichever is first.
- A spare that fails to start or dies is logged and dropped. It is not restarted
  until the next time no project is open. There is no retry loop.
- A settings change (engine, log level, `ENSO_ENGINE_ARGS`, the setting itself)
  stops the spare and, if one is still wanted, starts a new one.
- Setting: a new **Engine** section on the Settings page's Local tab, one switch
  **Pre-start the engine**, help text exactly "Starts the engine in the
  background while you are on the dashboard, so projects open faster. Uses about
  0.5–0.8 GB of memory while no project is open.". It is on by default and shown
  only when the project service reports that the engine runs on the JVM.
- The setting is stored in a small `$/providers` store in `localStorage`, like
  `engineLogSettings`.
- The GUI sends the setting with a new request, `engine/setSpare` with body
  `{ enabled: boolean }`, when the dashboard loads and whenever the setting
  changes. Until the first such request the project service starts no spare.
- `ENSO_SPARE_ENGINE=0` in the environment disables the spare whatever the
  setting says.
- The IDE's default engine stays native.
- Rollout: PR 1 (engine) and PR 3 (harness) take the `CI: No changelog needed`
  label. PR 2 (project service and GUI) takes a `CHANGELOG.md` entry under
  `#### Enso IDE` and waits for the owner's installer test before merging.
- Repo rules (`scratchpad/wave1/rules-common.md`): never `git stash`,
  force-push, `git reset --hard`, `--no-verify`/`--no-gpg-sign`/`HUSKY=0`. Stage
  paths explicitly and never stage `.claude/settings.local.json`. Before any
  test run, unset every `ENSO_*` (except `ENSO_VERSION`, `ENSO_EDITION` and the
  log level), `AWS_*`, `SNOWFLAKE*`, `GOOGLE*`, `AZURE*` and `*_TOKEN` variable.
  Engine runs use their own `ENSO_DATA_DIRECTORY` under the scratch folder, and
  sbt runs with `-Dsbt.server.forcestart=true`. Use `corepack pnpm`. Never build
  from `C:\Repos\Enso\ide` itself: a script's `cd` must stop the script when it
  fails. Do not merge.
- Every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```
- Every PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, a blank
  line, and `https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN`. Each PR
  says `Refs #518`.

## Decisions this plan takes where the spec leaves room

These are binding for every task. Where one changes what the spec says, the PR
that implements it says so in its body.

1. **The argument line** is one line of JSON: `{"args":[...],"env":{...}}`,
   where `env` is optional. The spec's "JSON array of strings, plus an optional
   object" is carried as the two keys of one object, so it parses as a single
   JSON document.
2. **The per-open environment** of an open is more than the spec's
   `LANGUAGE_SERVER_YDOC_PORT`. Each open also passes its own
   `LANGUAGE_SERVER_CHANNEL_TOKEN`, `ENSO_LOCAL_PROJECT_ID` and
   `ENSO_LOCAL_PROJECT_SESSION_ID`, and Java cannot set environment variables.
   The engine therefore accepts exactly these four in `env`, and refuses any
   other name:
   - `LANGUAGE_SERVER_YDOC_PORT` and `LANGUAGE_SERVER_CHANNEL_TOKEN` become the
     configuration properties `language-server.ydoc.port` and
     `language-server.channel-token`. `ApplicationConfig` falls back to them,
     and to read them after start-up it now reads a fresh
     `ConfigFactory.systemProperties()` instead of pureconfig's start-up
     snapshot.
   - The two `ENSO_LOCAL_PROJECT_*` variables become `enso.env.<NAME>`
     properties, read through a new `org.enso.common.ProcessEnvironment.get`.

   `LANGUAGE_SERVER_YDOC_ALLOWED_ORIGINS` is not accepted, so there is no spare
   under `ENSO_YDOC_HOST=engine`, the one-release rollback.

3. **The working-directory check** stays as it is. In standby mode the runner
   sets the polyglot context's working directory to the parent of `--path`,
   through the new system property `enso.context.workingDirectory` that
   `ContextFactory` applies. `EnsoContext.checkWorkingDirectory` compares
   against the context's working directory, so it then compares against the
   parent of `--path`. The JVM's own working directory cannot follow, so Task 2
   makes relative `File`s, `File.current_directory` and `Process.run`'s default
   directory resolve against the context's working directory whenever it is not
   the process's. A spare-served project then behaves like a normal one, with
   the known differences that Task 2 lists (Java code given a raw relative
   string, and the text of a relative `File`).
4. **The warm-up's imports.** Decision 3 lists Standard.Base, Standard.Table and
   Standard.Visualization, but the default template
   (`lib/scala/pkg/src/main/resources/default/src/Main.enso`) also imports
   Standard.Database and Standard.Examples, and Standard.Visualization imports
   Standard.Database itself. The warm-up imports all five, which is what the
   decision's "the default template's imports" means.
5. **Preloading (the open question).** The class list is **generated** from a
   Language Server boot without an AOT cache, by
   `tools/standby-preload/generate.mjs`, and committed as a resource. The
   preloader is **skipped when the JVM runs with an AOT cache** (`-XX:AOTCache=`
   or `-XX:SharedArchiveFile=` in its options). The IDE's cache is trained on a
   Language Server boot (`jvmAot/trainer.ts`), so it already archives those
   classes, and the classes it lacks (~4,800 lambda classes) cannot be preloaded
   by name. Task 9 measures that claim and records it in PR 1. The cache is
   detected only from the options the launcher gives the JVM (`jvm.options` and
   `ENSO_JVM_OPTIONS`, `JvmOptions.all`). A cache passed through
   `JAVA_TOOL_OPTIONS` is not detected and only causes needless preloading; the
   IDE never passes it that way.
6. **The engine's own messages before the line** (the warm-up's failure,
   `standby: warm-up done …`, `STANDBY READY …`) are stderr lines. Logging is
   not set up before the line, because the Language Server sets it up itself and
   the session's log file must belong to the project. The shim echoes them and
   puts a summary into the opened project's engine log.
7. **"The project service's answer to the existing initial requests"** is the
   answer to `engine/setSpare` itself: `{ engineMode: 'native' | 'jvm' }`. The
   GUI sends it when the dashboard loads, so no existing response changes.
8. **The spawn key** is the SHA-256 hash of the engine mode, the service's own
   extra arguments (`ENSO_ENGINE_ARGS` and Electron's, which hold the log
   level), the AOT cache's JVM options, the stable extra environment (the
   secrets key, which is never logged or stored unhashed) and the inherited
   `ENSO_JVM_OPTIONS`. The per-open arguments (`--server …`, the engine-logging
   `--vm.D` options) travel in the line, which re-applies them.

   No spare is started while an AOT training runs (a first launch without a
   cache), so the two do not compete. A training that ends, trained or failed,
   refreshes the spare (`JvmAotCacheSettings.onTrainingEnded`), so the spare
   starts with the new cache instead of being discarded at the next open.

   Rotating or resetting the secrets key refreshes the spare too
   (`SecretsActionOptions.afterKeyChange`). The spare holds the old key in its
   environment, and the rotation's "no engine running" check
   (`ROTATE_BLOCKED_BY_PROJECTS`) does not count it.

9. **"No project is open"** ignores a project whose close has begun: the 2 s
   rule starts the next spare while the old engine may still be stopping.
10. **No spare** while the extra arguments hold `--profiling-path` (its value is
    relative), and a spare is stopped when a project opens with the native
    engine.
11. **The measurement's "wait for `STANDBY READY` (or 15 s)"** means whichever
    comes first. The "open during the warm-up" question is settled with the
    system property `enso.standby.abandonWarmUp`, measured by two extra harness
    engines, beside a cold `jvm`. If waiting for the warm-up (`jvm-spare-early`)
    is slower than a cold start (`jvm`) in the pooled first-open median,
    abandoning becomes the default regardless. Otherwise it becomes the default
    only if it is faster than waiting by at least 150 ms in the pooled median
    and faster in at least 2 of the 3 rounds.
12. **The GUI's "sent on load and on change"** is tested where the sending
    lives, a composable test (`spareEngineSync.test.ts`). `localTab.test.ts`
    tests that the switch persists and that the section is hidden when the
    engine is native.

---

## File Structure

**Part 1 (engine, PR 1)**

| File                                                                                                                                              | Change             | Responsibility                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `engine/common/src/main/java/org/enso/common/ContextFactory.java`                                                                                 | Modify             | `workingDirectory(String)` and the `enso.context.workingDirectory` property              |
| `engine/common/src/main/java/org/enso/common/ProcessEnvironment.java`                                                                             | Create             | Environment variables, with the values a standby engine was handed after start           |
| `engine/common/src/test/java/org/enso/common/ProcessEnvironmentTest.java`                                                                         | Create             | Its test                                                                                 |
| `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/WorkingDirectoryCheckTest.java`                                         | Create             | The check passes against the context's working directory, and still fails on a wrong one |
| `engine/runtime/src/main/java/org/enso/interpreter/runtime/system/System.java`                                                                    | Modify             | `working_directory_override`; `create_process` starts in the context's working directory |
| `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Runtime_Helpers.enso`, `System/Internal/File_Helpers.enso`, `System/File.enso`             | Modify             | Relative files and `File.current_directory` follow the context's working directory       |
| `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/ContextWorkingDirectoryTest.java`                                       | Create             | Their test                                                                               |
| `engine/runner/src/main/java/org/enso/runner/Main.java`                                                                                           | Modify             | `--standby`, `ProcessEnvironment` in `setupLoggingContext`, `launch` package-private     |
| `engine/runtime-instrument-common/src/main/java/org/enso/interpreter/instrument/telemetry/ProgressTimingCollector.java`                           | Modify             | Read the project ids through `ProcessEnvironment`                                        |
| `engine/language-server/src/main/scala/org/enso/languageserver/boot/config/ApplicationConfig.scala`                                               | Modify             | Fall back to a fresh `ConfigFactory.systemProperties()`                                  |
| `engine/language-server/src/test/scala/org/enso/languageserver/boot/config/ApplicationConfigTest.scala`                                           | Modify             | The properties set after start are read                                                  |
| `engine/runner/src/main/java/org/enso/runner/StandbyJson.java`                                                                                    | Create             | The strict JSON reader for the line                                                      |
| `engine/runner/src/main/java/org/enso/runner/StandbyRequest.java`                                                                                 | Create             | The parsed line, and applying its environment                                            |
| `engine/runner/src/main/java/org/enso/runner/Standby.java`                                                                                        | Create             | The background warm-up, `STANDBY READY`, reading the line                                |
| `engine/runner/src/main/java/org/enso/runner/StandbyWarmUp.java`                                                                                  | Create             | The throwaway context on a temporary default-template project                            |
| `engine/runner/src/main/java/org/enso/runner/StandbyPreloader.java`                                                                               | Create             | Loading the listed classes without initialising them                                     |
| `engine/runner/src/main/resources/org/enso/runner/standby-preload.txt`                                                                            | Create (generated) | The class list                                                                           |
| `tools/standby-preload/generate.mjs`                                                                                                              | Create             | Turns a `-Xlog:class+load` log into the class list                                       |
| `engine/runner/src/main/java/module-info.java`, `build.sbt`                                                                                       | Modify             | The runner reads `typesafe.config` (`invalidateCaches`)                                  |
| `engine/runner/src/test/java/org/enso/runner/StandbyRequestTest.java`, `StandbyTest.java`, `StandbyPreloaderTest.java`, `StandbyProcessTest.java` | Create             | Tests                                                                                    |
| `engine/runner/CLAUDE.md`                                                                                                                         | Modify             | "Standby mode"                                                                           |

**Part 2 (project service and GUI, PR 2)**

| File                                                                                                                                      | Change          | Responsibility                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `app/project-manager-shim/src/projectService/spareEngine.ts`                                                                              | Create          | `SpareEngine`: spawn, `STANDBY READY`, take, stop, failure; `spawnKey`, `standbyLine`, `spareNotice` |
| `app/project-manager-shim/src/projectService/ensoRunner.ts`                                                                               | Modify          | `startSpare`, `stopSpare`, `spareAvailableAgain`, `hasProjectsInUse`; `openProject` takes the spare  |
| `app/project-manager-shim/src/projectService/index.ts`                                                                                    | Modify          | `setSpareEngine`, `refreshSpare`, `stopSpareEngine`; the key, the after-close delay                  |
| `app/project-manager-shim/src/handler/projectService.ts`                                                                                  | Modify          | `POST /api/project-service/engine/setSpare`                                                          |
| `app/project-manager-shim/src/jvmAot/index.ts`                                                                                            | Modify          | `isTraining`, `onTrainingEnded`                                                                      |
| `app/electron-client/src/secretsKey.ts`, `src/electron.ts`, `tests/headless/secretsKey.test.ts`                                           | Modify          | `afterKeyChange`: a rotation or reset refreshes the spare                                            |
| `app/project-manager-shim/src/projectService/__tests__/fakeSpareEngine.ts`                                                                | Create          | The fake `enso` with `--standby`                                                                     |
| `…/__tests__/spareEngine.test.ts`, `spareOpen.test.ts`, `spareService.test.ts`                                                            | Create          | Tests                                                                                                |
| `…/__tests__/testPorts.ts`                                                                                                                | Modify          | One more port band                                                                                   |
| `app/project-manager-shim/src/handler/__tests__/projectService.test.ts`, `jvmAot/__tests__/cache.test.ts`                                 | Modify          | Tests                                                                                                |
| `app/common/src/services/ProjectManager/ProjectManager.ts`, `types.ts`, `app/common/src/services/LocalBackend.ts`                         | Modify          | `setSpareEngine`                                                                                     |
| `app/common/src/services/ProjectManager/__tests__/ProjectManager.spareEngine.test.ts`                                                     | Create          | Test                                                                                                 |
| `app/electron-client/src/projectService.ts`, `src/index.ts`                                                                               | Modify          | Quit, `onTrainingEnded`, `refreshSpareEngine`                                                        |
| `app/gui/src/providers/spareEngineSettings.ts`                                                                                            | Create          | The store, and `engineRunsOnJvm`                                                                     |
| `app/gui/src/composables/spareEngineSync.ts` (+ test)                                                                                     | Create          | Sends the setting                                                                                    |
| `app/gui/src/dashboard/layouts/Settings/EngineSettingsSection.vue`                                                                        | Create          | The switch                                                                                           |
| `app/gui/src/dashboard/layouts/Settings/tabs.ts`, `app/gui/src/App.vue`, `app/common/src/text/english.json`                               | Modify          | Wiring and text                                                                                      |
| `app/gui/src/dashboard/layouts/Settings/__tests__/localTab.test.ts`                                                                       | Modify          | Test                                                                                                 |
| `app/gui/integration-test/mock/localApi.ts`, `integration-test/dashboard/spareEngineSettings.spec.ts`                                     | Modify / Create | Mock route, GUI Playwright                                                                           |
| `app/electron-client/tests/electronTest.ts`, `tests/spareEngine.spec.ts`                                                                  | Modify / Create | Packaged-IDE Playwright                                                                              |
| `app/project-manager-shim/CLAUDE.md`, `app/gui/src/dashboard/layouts/Settings/CLAUDE.md`, `app/electron-client/CLAUDE.md`, `CHANGELOG.md` | Modify          | Docs, changelog                                                                                      |

**Part 3 (harness, PR 3)**

| File                                                                                                      | Change                           | Responsibility                                                    |
| --------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `app/electron-client/perf/openTimeReport.ts`                                                              | Modify                           | Spare engines, `SpareRun`, `spareTable`, `ratioTable`, `cpusLine` |
| `app/electron-client/perf/cpuAffinity.ts`                                                                 | Create                           | How many CPUs the IDE was pinned to                               |
| `app/electron-client/perf/poolReports.ts`                                                                 | Create                           | Pools the reports of several rounds                               |
| `app/electron-client/perf/openTime.ts`                                                                    | Modify                           | Runs the spare engines                                            |
| `app/electron-client/tests/headless/openTimeReport.test.ts`, `cpuAffinity.test.ts`, `poolReports.test.ts` | Modify / Create                  | Tests                                                             |
| `app/electron-client/CLAUDE.md`                                                                           | Modify                           | Harness docs, procedure                                           |
| `engine/runner/src/main/java/org/enso/runner/Standby.java`                                                | Modify (only if abandoning wins) | Default of `enso.standby.abandonWarmUp`                           |

---

# Part 1 — The engine's standby mode (PR 1)

Set up the worktree (from outside it):

```bash
git -C /c/Repos/Enso/ide fetch origin develop
git -C /c/Repos/Enso/ide worktree add -b jvm-warm-engine-1-standby /c/Repos/Enso/ide/.claude/worktrees/jvm-standby origin/develop
```

Every command in Part 1 runs from
`/c/Repos/Enso/ide/.claude/worktrees/jvm-standby` (in WSL,
`/mnt/c/Repos/Enso/ide/.claude/worktrees/jvm-standby`, after
`. ~/.enso-toolchain.sh`).

### Task 1: The context's working directory

**Files:**

- Modify: `engine/common/src/main/java/org/enso/common/ContextFactory.java`
  (fields at the top, a builder method, `build()` after `.in(in);`)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/WorkingDirectoryCheckTest.java`

**Interfaces:**

- Produces:
  `ContextFactory.WORKING_DIRECTORY_PROPERTY = "enso.context.workingDirectory"`
  (public static final String) and
  `ContextFactory workingDirectory(String workingDirectory)`. `build()` gives
  the polyglot context `currentWorkingDirectory(Path.of(dir).toAbsolutePath())`
  when either is set: the builder's value first, then the property.

- [ ] **Step 1: Write the failing test**

```java
package org.enso.interpreter.test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import org.enso.common.ContextFactory;
import org.enso.common.LanguageInfo;
import org.enso.common.RuntimeOptions;
import org.enso.test.utils.ProjectUtils;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.PolyglotException;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A standby engine starts before its project is known, so its process's working directory is not
 * the project's parent. The runner gives the context the project's parent as its working directory
 * instead (`ContextFactory.workingDirectory`), and `EnsoContext.checkWorkingDirectory` compares
 * against that: it passes, and a wrong one still fails.
 */
public class WorkingDirectoryCheckTest {
  private static final String UNEXPECTED = "unexpected working directory";

  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private final List<LogRecord> records = new ArrayList<>();
  private final Handler handler =
      new Handler() {
        @Override
        public void publish(LogRecord record) {
          synchronized (records) {
            records.add(record);
          }
        }

        @Override
        public void flush() {}

        @Override
        public void close() {}
      };

  private Path newProject() throws Exception {
    var project = tmp.newFolder("projects", "Wd_Test").toPath();
    ProjectUtils.createProject("Wd_Test", "main = 42", project);
    return project;
  }

  private Context context(Path project, Path workingDirectory) {
    return ContextFactory.create()
        .projectRoot(project.toString())
        .workingDirectory(workingDirectory.toString())
        .logLevel(Level.WARNING)
        .logHandler(handler)
        .options(
            Map.of(
                RuntimeOptions.LANGUAGE_HOME_OVERRIDE,
                Paths.get("../../distribution/component").toFile().getAbsolutePath()))
        .build();
  }

  /** Whether initialising `ctx` reported the unexpected working directory (a warning, or with -ea an error). */
  private boolean complains(Context ctx) {
    try {
      ctx.initialize(LanguageInfo.ID);
    } catch (PolyglotException e) {
      if (String.valueOf(e.getMessage()).contains(UNEXPECTED)) {
        return true;
      }
      throw e;
    }
    synchronized (records) {
      return records.stream().anyMatch(r -> String.valueOf(r.getMessage()).contains(UNEXPECTED));
    }
  }

  @Test
  public void theProjectsParentAsTheContextsWorkingDirectoryPasses() throws Exception {
    var project = newProject();
    var parent = project.getParent();
    assertNotEquals(
        "the process must not already run in the project's parent",
        parent.toRealPath(),
        Path.of("").toRealPath());
    try (var ctx = context(project, parent)) {
      assertFalse("no complaint about the working directory", complains(ctx));
    }
  }

  @Test
  public void anotherWorkingDirectoryStillFails() throws Exception {
    var project = newProject();
    var elsewhere = Files.createDirectories(tmp.getRoot().toPath().resolve("elsewhere"));
    try (var ctx = context(project, elsewhere)) {
      assertTrue("the check still reports a wrong directory", complains(ctx));
    }
  }
}
```

- [ ] **Step 2: Run the test to see it fail**

Run:
`sbt -Dsbt.server.forcestart=true "runtime-integration-tests/testOnly org.enso.interpreter.test.WorkingDirectoryCheckTest"`
Expected: compilation FAILS with
`cannot find symbol: method workingDirectory(String)`.

- [ ] **Step 3: Implement**

In `ContextFactory.java`, next to the other fields (after
`private boolean enableDebugServer;`):

```java
  /**
   * The system property a standby engine sets to its project's parent once it knows the project
   * (engine/runner `Standby`, Note [Standby Mode]): the context's working directory, which
   * `EnsoContext.checkWorkingDirectory` compares with the project's parent and against which Enso
   * resolves relative paths, as it did when the process ran in the project's parent.
   */
  public static final String WORKING_DIRECTORY_PROPERTY = "enso.context.workingDirectory";

  private String workingDirectory;
```

After the `enableDebugServer(boolean b)` builder method:

```java
  /**
   * The context's working directory, instead of the process's; {@link #WORKING_DIRECTORY_PROPERTY}
   * when not given.
   */
  public ContextFactory workingDirectory(String workingDirectory) {
    this.workingDirectory = workingDirectory;
    return this;
  }
```

In `build()`, right after the statement that ends with `.in(in);`:

```java
    var cwd =
        workingDirectory != null
            ? workingDirectory
            : System.getProperty(WORKING_DIRECTORY_PROPERTY);
    if (cwd != null) {
      builder.currentWorkingDirectory(java.nio.file.Path.of(cwd).toAbsolutePath());
    }
```

- [ ] **Step 4: Run the test to see it pass**

Run:
`sbt -Dsbt.server.forcestart=true "runtime-integration-tests/testOnly org.enso.interpreter.test.WorkingDirectoryCheckTest"`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/common/src/main/java/org/enso/common/ContextFactory.java engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/WorkingDirectoryCheckTest.java
git commit -m "Engine: a context's working directory can be given, for a standby engine (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 2: Relative paths and processes follow the context's working directory

A normal engine runs in the project's parent, so its JVM resolves relative paths
there. A spare's process runs in the system temporary directory, and its working
directory cannot be changed once the JVM runs (`Utils.adjustCwdToProject`
explains why). Without this task a project served by a spare would resolve
`File.new "data/x.csv"` (which is `java.nio.file.Path.of`, relative to the
process's directory: `File_Helpers.get_file`) and `File.current_directory`
against the temporary directory. `Process.run` without a directory would start
there too. This task makes all three follow the context's working directory,
which Task 1 lets the runner set to the project's parent. The new builtin
decides by whether a standby engine set the context's working directory, that is
whether the `enso.context.workingDirectory` property
(`ContextFactory.WORKING_DIRECTORY_PROPERTY`, Task 1) is present. It does not
compare paths, since symlinks, 8.3 names or letter case could make a normal
engine's two directories compare unequal. A normal engine never has the
property, so the builtin answers `Nothing` and nothing changes for it.

Known differences that remain, stated in PR 1 and in `engine/runner/CLAUDE.md`:

- In a spare-served project a relative `File` is made absolute when it is
  created, so its text shows the full path.
- Java code handed a relative path string directly still resolves it against the
  process's directory. That covers user code through `polyglot java import`, and
  the std-bits helpers only when given a raw relative string; Enso's own callers
  pass a `File`'s path, which is now absolute.
- `DiskSpaceGetter` falls back to `user.dir` only when there is no project,
  which never happens in a Language Server.
- `File.resolve_local_file` takes `is_absolute` from `get_file`'s result, so in
  a spare a relative path counts as absolute and skips the branch that resolves
  it against a cloud project's parent directory. That branch is not reached in
  the local-only IDE, which has no cloud projects, so this is harmless here.

The places that use the process's directory were found with
`grep -rn "user.dir\|ProcessBuilder\|getCurrentWorkingDirectory\|Java_Path.of" engine/runtime/src/main std-bits distribution/lib/Standard`.
Besides the three above, `Java_Path.of` appears only on paths taken from
exceptions about files that are already absolute (`File.enso`'s
`_replace_create_directories_*`).

**Files:**

- Modify:
  `engine/runtime/src/main/java/org/enso/interpreter/runtime/system/System.java`
  (a new builtin; `create_process`)
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Runtime_Helpers.enso`
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/System/Internal/File_Helpers.enso`
  (`get_file`)
- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/System/File.enso`
  (`current_directory`)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/ContextWorkingDirectoryTest.java`

**Interfaces:**

- Consumes: `ContextFactory.workingDirectory` (Task 1); the polyglot
  `Context.Builder.currentWorkingDirectory` it sets.
- Produces: the builtin `System.working_directory_override`, which returns the
  context's working directory as `Text` when the `enso.context.workingDirectory`
  property is set (a standby engine), and `Nothing` otherwise. Also
  `Runtime_Helpers.working_directory_override`.

- [ ] **Step 1: Write the failing test**

```java
package org.enso.interpreter.test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.nio.file.Path;
import java.util.List;
import org.enso.common.ContextFactory;
import org.enso.test.utils.ContextUtils;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A standby engine's process runs in the temporary directory; its context's working directory is
 * the project's parent (`ContextFactory.workingDirectory`). Relative files, the current directory
 * and processes started without a directory must follow the context, as they follow the process
 * in a normal engine.
 */
public class ContextWorkingDirectoryTest {
  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private static final String CODE =
      """
      from Standard.Base import all
      import Standard.Base.System.Platform
      import Standard.Base.System.Process

      main =
          relative = File.new "data/a.csv" . path
          current = File.current_directory . absolute . normalize . path
          pwd = if Platform.os == Platform.OS.Windows then Process.run "cmd" ["/c", "cd"] else Process.run "pwd"
          [relative, current, pwd.stdout.trim]
      """;

  /**
   * `main`'s three texts, in a context whose working directory is `dir` (the process's when
   * null). `standby` sets the property a standby engine sets (`Main.runStandby`), which is what
   * makes the context's directory count.
   */
  private static List<String> run(Path dir, boolean standby) {
    var builder = ContextUtils.newBuilder("enso");
    if (dir != null) {
      builder = builder.withModifiedContext(b -> b.currentWorkingDirectory(dir));
    }
    if (standby) {
      System.setProperty(ContextFactory.WORKING_DIRECTORY_PROPERTY, dir.toString());
    }
    try (var ctx = builder.build()) {
      var result = ctx.evalModule(CODE);
      return List.of(
          result.getArrayElement(0).asString(),
          result.getArrayElement(1).asString(),
          result.getArrayElement(2).asString());
    } finally {
      System.clearProperty(ContextFactory.WORKING_DIRECTORY_PROPERTY);
    }
  }

  @Test
  public void relativePathsAndProcessesFollowTheContextsWorkingDirectory() throws Exception {
    var dir = tmp.newFolder("context-cwd").toPath().toRealPath();
    assertNotEquals(dir, Path.of("").toRealPath());
    var texts = run(dir, true);
    assertEquals(dir.resolve("data").resolve("a.csv").toString(), texts.get(0));
    assertEquals(dir.toString(), texts.get(1));
    assertEquals(dir, Path.of(texts.get(2)).toRealPath());
  }

  @Test
  public void aNormalContextIsUnchanged() throws Exception {
    var texts = run(null, false);
    assertEquals(Path.of("data", "a.csv").toString(), texts.get(0));
    assertEquals(Path.of("").toAbsolutePath().normalize().toString(), texts.get(1));
    assertEquals(Path.of("").toRealPath(), Path.of(texts.get(2)).toRealPath());
  }

  @Test
  public void aWorkingDirectoryWithoutTheStandbyPropertyChangesNoFile() throws Exception {
    // A context given a directory by something other than a standby engine (as the warm-up's is):
    // files keep their relative path, as in a normal engine.
    var dir = tmp.newFolder("not-standby").toPath().toRealPath();
    var texts = run(dir, false);
    assertEquals(Path.of("data", "a.csv").toString(), texts.get(0));
  }
}
```

- [ ] **Step 2: Run it to see it fail**

Run:
`sbt -Dsbt.server.forcestart=true "runtime-integration-tests/testOnly org.enso.interpreter.test.ContextWorkingDirectoryTest"`
Expected: `relativePathsAndProcessesFollowTheContextsWorkingDirectory` FAILS:
the first text is `data/a.csv` (relative) and the process prints the process's
directory. The other two PASS.

- [ ] **Step 3: Implement**

In `System.java`, add after `nanoTime()`:

```java
  @Builtin.Method(
      description =
          "The context's working directory when a standby engine set it, else Nothing: relative"
              + " local paths then resolve against it.")
  @Builtin.Specialize
  @SuppressWarnings("generic-enso-builtin-type")
  @CompilerDirectives.TruffleBoundary
  public static Object workingDirectoryOverride(EnsoContext ctx) {
    // Whether a standby engine set it (Note [Standby Mode] in engine/runner `Standby`), not a
    // comparison of paths: symlinks, 8.3 names or letter case could make a normal engine's
    // context and process directories compare unequal.
    if (java.lang.System.getProperty(ContextFactory.WORKING_DIRECTORY_PROPERTY) == null) {
      return ctx.getNothing();
    }
    return Text.create(ctx.getCurrentWorkingDirectory().getAbsoluteFile().normalize().getPath());
  }
```

Add `import org.enso.common.ContextFactory;` to `System.java`'s imports (the
runtime module already `requires org.enso.engine.common`).

In `create_process`, after the `if (ctx.getNothing() != cwdOrNothing) { … }`
block, add an `else`:

```java
      } else {
        // The context's working directory: a standby engine's process runs elsewhere (Note
        // [Standby Mode] in engine/runner `Standby`). In a normal engine they are the same.
        pb.directory(ctx.getCurrentWorkingDirectory());
      }
```

In `Runtime_Helpers.enso`, after `is_unix = @Builtin_Method "System.is_unix"`:

```
working_directory_override = @Builtin_Method "System.working_directory_override"
```

In `File_Helpers.enso`, add `import project.Internal.Runtime_Helpers` with the
imports and replace `get_file`:

```
## The builtin that returns a File instance for a given path. A relative path
   resolves against the context's working directory when that is not the
   process's (a standby engine, whose process runs elsewhere); it is then made
   absolute. In a normal engine the path is kept as given.
get_file path:Text =
    java_path = Java_Path.of path
    override = Runtime_Helpers.working_directory_override
    resolved = if override.is_nothing || java_path.isAbsolute then java_path else
        Java_Path.of override . resolve java_path
    File.Value resolved
```

(Keep the existing doc comment's first line if it differs; the rest of the
comment is new.)

In `File.enso`, change `current_directory`'s body from
`File.Value (Java_Path.of ".")` to:

```
        File_Helpers.get_file "."
```

- [ ] **Step 4: Run the tests to see them pass**

Run:
`sbt -Dsbt.server.forcestart=true "runtime-integration-tests/testOnly org.enso.interpreter.test.ContextWorkingDirectoryTest" "runtime-integration-tests/testOnly org.enso.interpreter.test.WorkingDirectoryCheckTest"`
Expected: all `ContextWorkingDirectoryTest` and `WorkingDirectoryCheckTest`
tests PASS. Then run the Base tests that cover files and processes, from `test/`
(root CLAUDE.md: the working directory must be the project's parent):

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/jvm-standby && git pull --ff-only /mnt/c/Repos/Enso/ide jvm-warm-engine-1-standby && sbt -Dsbt.server.forcestart=true buildEngineDistribution && cd test && JAVA_TOOL_OPTIONS="-enableassertions" ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests" "File|Process" 2>&1 | tail -5'
```

Expected: `0 tests failed`, and a log as long as develop's for the same filter
(a filter that matches nothing also says 0 failed). The WSL clone is made in
Task 7 Step 5; run that step's clone command first if it does not exist yet.

- [ ] **Step 5: Commit**

```bash
git add engine/runtime/src/main/java/org/enso/interpreter/runtime/system/System.java distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Runtime_Helpers.enso distribution/lib/Standard/Base/0.0.0-dev/src/System/Internal/File_Helpers.enso distribution/lib/Standard/Base/0.0.0-dev/src/System/File.enso engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/ContextWorkingDirectoryTest.java
git commit -m "Engine: relative paths and processes follow the context's working directory (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 3: Per-open variables handed after start

**Files:**

- Create: `engine/common/src/main/java/org/enso/common/ProcessEnvironment.java`
- Test:
  `engine/common/src/test/java/org/enso/common/ProcessEnvironmentTest.java`
- Modify: `engine/runner/src/main/java/org/enso/runner/Main.java`
  (`setupLoggingContext`, ~lines 1668-1697)
- Modify:
  `engine/runtime-instrument-common/src/main/java/org/enso/interpreter/instrument/telemetry/ProgressTimingCollector.java`
  (`resolveProjectId`, `resolveSessionId`)
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/boot/config/ApplicationConfig.scala`
- Test:
  `engine/language-server/src/test/scala/org/enso/languageserver/boot/config/ApplicationConfigTest.scala`

**Interfaces:**

- Produces: `ProcessEnvironment.PROPERTY_PREFIX = "enso.env."`,
  `static String ProcessEnvironment.get(String name)` returns the property
  `enso.env.<name>` if set, else `System.getenv(name)`.
- Produces: `ApplicationConfig.load()` reads `language-server.ydoc.port` and
  `language-server.channel-token` from system properties set after start, once
  `ConfigFactory.invalidateCaches()` has run.

- [ ] **Step 1: Write the failing tests**

`engine/common/src/test/java/org/enso/common/ProcessEnvironmentTest.java`:

```java
package org.enso.common;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.After;
import org.junit.Test;

public class ProcessEnvironmentTest {
  private static final String HANDED = ProcessEnvironment.PROPERTY_PREFIX + "PATH";

  @After
  public void clear() {
    System.clearProperty(HANDED);
  }

  @Test
  public void aHandedValueWinsOverTheEnvironment() {
    System.setProperty(HANDED, "handed");
    assertEquals("handed", ProcessEnvironment.get("PATH"));
  }

  @Test
  public void withoutAHandedValueTheEnvironmentIsRead() {
    assertEquals(System.getenv("PATH"), ProcessEnvironment.get("PATH"));
  }

  @Test
  public void neitherGivesNull() {
    assertNull(ProcessEnvironment.get("ENSO_TEST_SET_NOWHERE_518"));
  }
}
```

In `ApplicationConfigTest.scala`, add after the last test (and add
`import com.typesafe.config.ConfigFactory` at the top):

```scala
  it should "read the ydoc port and the channel token a standby engine set after start" in {
    // engine/runner `StandbyRequest.applyEnvironment` sets these, then invalidates the caches.
    sys.props("language-server.ydoc.port")     = "4567"
    sys.props("language-server.channel-token") = "standby-token"
    ConfigFactory.invalidateCaches()
    try {
      val config = ApplicationConfig.load()
      config.ydoc.port shouldBe sys.env
        .get("LANGUAGE_SERVER_YDOC_PORT")
        .map(_.toInt)
        .orElse(Some(4567))
      config.channelToken shouldBe sys.env
        .get("LANGUAGE_SERVER_CHANNEL_TOKEN")
        .orElse(Some("standby-token"))
    } finally {
      sys.props -= "language-server.ydoc.port"
      sys.props -= "language-server.channel-token"
      ConfigFactory.invalidateCaches()
    }
  }
```

- [ ] **Step 2: Run them to see them fail**

Run:
`sbt -Dsbt.server.forcestart=true "engine-common/testOnly org.enso.common.ProcessEnvironmentTest" "language-server/testOnly org.enso.languageserver.boot.config.ApplicationConfigTest"`
Expected: `engine-common` FAILS to compile
(`cannot find symbol: class ProcessEnvironment`). The new
`ApplicationConfigTest` case FAILS with `None was not equal to Some(4567)`: the
earlier test in the same JVM initialised pureconfig's
`ConfigSource.systemProperties` snapshot.

- [ ] **Step 3: Implement**

`engine/common/src/main/java/org/enso/common/ProcessEnvironment.java`:

```java
package org.enso.common;

/**
 * The process environment, with the variables a standby engine was handed after it started.
 *
 * <p>A standby engine (engine/runner `Standby`) is started before its project is known. The
 * variables of one open, such as the project's local id, reach it on its argument line, and Java
 * cannot set environment variables, so the runner sets each as the system property {@code
 * enso.env.<NAME>}. Code that reads one of those variables reads it through {@link #get}.
 */
public final class ProcessEnvironment {
  /** The prefix of the system property that holds a handed variable. */
  public static final String PROPERTY_PREFIX = "enso.env.";

  private ProcessEnvironment() {}

  /**
   * @param name the variable's name
   * @return the value handed to a standby engine, else the environment's, else {@code null}
   */
  public static String get(String name) {
    var handed = System.getProperty(PROPERTY_PREFIX + name);
    return handed != null ? handed : System.getenv(name);
  }
}
```

In `Main.java`, add `import org.enso.common.ProcessEnvironment;` and in
`setupLoggingContext` replace every `System.getenv(` with
`ProcessEnvironment.get(`: all ten calls there, each of the form
`System.getenv(LanguageServerApi.ENSO_..._ENV_NAME)`. Check with
`sed -n '/private void setupLoggingContext/,/^  }/p' engine/runner/src/main/java/org/enso/runner/Main.java | grep -c "System.getenv"`,
which must print `0` afterwards.

In `ProgressTimingCollector.java`, add
`import org.enso.common.ProcessEnvironment;` and replace the four
`System.getenv("ENSO_…")` calls in `resolveProjectId` and `resolveSessionId`
with `ProcessEnvironment.get("ENSO_…")` (same names).

In `ApplicationConfig.scala`, add `import com.typesafe.config.ConfigFactory` and
change the source:

```scala
      // A fresh `systemProperties()`, not pureconfig's `ConfigSource.systemProperties` (a snapshot
      // taken when `ConfigSource` is first used): a standby engine sets the ydoc port and the
      // channel token as properties after it started (engine/runner `StandbyRequest`).
      ConfigSource
        .resources(ConfigFilename)
        .withFallback(ConfigSource.fromConfig(ConfigFactory.systemProperties()))
        .at(ConfigNamespace)
        .loadOrThrow[ApplicationConfig]
```

- [ ] **Step 4: Run them to see them pass**

Run:
`sbt -Dsbt.server.forcestart=true "engine-common/testOnly org.enso.common.ProcessEnvironmentTest" "language-server/testOnly org.enso.languageserver.boot.config.ApplicationConfigTest" "runtime-instrument-common/compile" "engine-runner/compile"`
Expected: 3 + 4 tests PASS, both compiles succeed.

- [ ] **Step 5: Commit**

```bash
git add engine/common/src/main/java/org/enso/common/ProcessEnvironment.java engine/common/src/test/java/org/enso/common/ProcessEnvironmentTest.java engine/runner/src/main/java/org/enso/runner/Main.java engine/runtime-instrument-common/src/main/java/org/enso/interpreter/instrument/telemetry/ProgressTimingCollector.java engine/language-server/src/main/scala/org/enso/languageserver/boot/config/ApplicationConfig.scala engine/language-server/src/test/scala/org/enso/languageserver/boot/config/ApplicationConfigTest.scala
git commit -m "Engine: per-open variables can be handed after start (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 4: The argument line

**Files:**

- Create: `engine/runner/src/main/java/org/enso/runner/StandbyJson.java`
- Create: `engine/runner/src/main/java/org/enso/runner/StandbyRequest.java`
- Modify: `engine/runner/src/main/java/module-info.java` (add
  `requires typesafe.config;`)
- Modify: `build.sbt`, `engine-runner` `Compile / moduleDependencies` (add
  `"com.typesafe" % "config" % typesafeConfigVersion` to its `Seq(...)`)
- Test: `engine/runner/src/test/java/org/enso/runner/StandbyRequestTest.java`

**Interfaces:**

- Consumes: `ProcessEnvironment.PROPERTY_PREFIX` (Task 3).
- Produces: `record StandbyRequest(List<String> args, Map<String, String> env)`,
  `static StandbyRequest parse(String line)` (throws
  `IllegalArgumentException`), `void applyEnvironment()`,
  `static final Map<String, String> CONFIG_PROPERTIES`,
  `static final Set<String> PROCESS_VARIABLES`. Also `final class StandbyJson`,
  `StandbyJson(String text)`, `Object document()`, which returns a
  `Map<String, Object>`, `List<Object>` or `String`.

- [ ] **Step 1: Write the failing test**

```java
package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Map;
import org.enso.common.ProcessEnvironment;
import org.junit.After;
import org.junit.Test;

public class StandbyRequestTest {
  @After
  public void clear() {
    System.clearProperty("language-server.ydoc.port");
    System.clearProperty("language-server.channel-token");
    System.clearProperty(ProcessEnvironment.PROPERTY_PREFIX + "ENSO_LOCAL_PROJECT_ID");
  }

  @Test
  public void parsesTheArgumentsAndTheEnvironment() {
    var request =
        StandbyRequest.parse(
            "{\"args\":[\"--server\",\"--path\",\"C:\\\\Users\\\\A B\\\\P\",\"\\u00e9\"],"
                + "\"env\":{\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\"t\"}}");
    assertEquals(List.of("--server", "--path", "C:\\Users\\A B\\P", "é"), request.args());
    assertEquals(Map.of("LANGUAGE_SERVER_CHANNEL_TOKEN", "t"), request.env());
  }

  @Test
  public void theEnvironmentIsOptional() {
    var request = StandbyRequest.parse(" { \"args\" : [ ] } ");
    assertEquals(List.of(), request.args());
    assertEquals(Map.of(), request.env());
  }

  @Test
  public void refusesAVariableItCannotApply() {
    var e =
        assertThrows(
            IllegalArgumentException.class,
            () -> StandbyRequest.parse("{\"args\":[],\"env\":{\"PATH\":\"x\"}}"));
    assertTrue(e.getMessage(), e.getMessage().contains("PATH"));
  }

  @Test
  public void refusesWhatIsNotTheLine() {
    for (var line :
        List.of(
            "[\"--server\"]",
            "{\"args\":[1]}",
            "{\"args\":[],\"other\":[]}",
            "{\"args\":[]} x",
            "{\"args\":[\"unterminated]}",
            "{\"args\":[],\"args\":[]}")) {
      assertThrows(line, IllegalArgumentException.class, () -> StandbyRequest.parse(line));
    }
  }

  @Test
  public void appliesTheEnvironmentAsProperties() {
    StandbyRequest.parse(
            "{\"args\":[],\"env\":{\"LANGUAGE_SERVER_YDOC_PORT\":\"1234\","
                + "\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\"tok\",\"ENSO_LOCAL_PROJECT_ID\":\"key-1\"}}")
        .applyEnvironment();
    assertEquals("1234", System.getProperty("language-server.ydoc.port"));
    assertEquals("tok", System.getProperty("language-server.channel-token"));
    assertEquals("key-1", ProcessEnvironment.get("ENSO_LOCAL_PROJECT_ID"));
  }
}
```

- [ ] **Step 2: Run it to see it fail**

Run:
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyRequestTest"`
Expected: FAIL to compile, `cannot find symbol: class StandbyRequest`.

- [ ] **Step 3: Implement**

`StandbyJson.java`:

```java
package org.enso.runner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A strict reader for the standby argument line: JSON objects, arrays and strings only, which is
 * all the line holds (Note [Standby Mode] in {@link Standby}). Anything else is an {@link
 * IllegalArgumentException}. The runner has no JSON library, and must stay Native-Image friendly.
 */
final class StandbyJson {
  private final String text;
  private int pos;

  StandbyJson(String text) {
    this.text = text;
  }

  /** The one value the text holds. */
  Object document() {
    skipSpace();
    var value = value();
    skipSpace();
    if (pos != text.length()) {
      throw error("trailing characters");
    }
    return value;
  }

  private Object value() {
    if (pos >= text.length()) {
      throw error("unexpected end");
    }
    return switch (text.charAt(pos)) {
      case '{' -> object();
      case '[' -> array();
      case '"' -> string();
      default -> throw error("only objects, arrays and strings are allowed");
    };
  }

  private Map<String, Object> object() {
    expect('{');
    var map = new LinkedHashMap<String, Object>();
    skipSpace();
    if (peek('}')) {
      pos++;
      return map;
    }
    while (true) {
      skipSpace();
      var key = string();
      skipSpace();
      expect(':');
      skipSpace();
      if (map.put(key, value()) != null) {
        throw error("duplicate key " + key);
      }
      skipSpace();
      if (peek(',')) {
        pos++;
        continue;
      }
      expect('}');
      return map;
    }
  }

  private List<Object> array() {
    expect('[');
    var list = new ArrayList<Object>();
    skipSpace();
    if (peek(']')) {
      pos++;
      return list;
    }
    while (true) {
      skipSpace();
      list.add(value());
      skipSpace();
      if (peek(',')) {
        pos++;
        continue;
      }
      expect(']');
      return list;
    }
  }

  private String string() {
    expect('"');
    var sb = new StringBuilder();
    while (true) {
      if (pos >= text.length()) {
        throw error("unterminated string");
      }
      char c = text.charAt(pos++);
      if (c == '"') {
        return sb.toString();
      }
      if (c < 0x20) {
        throw error("control character in a string");
      }
      if (c != '\\') {
        sb.append(c);
        continue;
      }
      if (pos >= text.length()) {
        throw error("unterminated escape");
      }
      char e = text.charAt(pos++);
      switch (e) {
        case '"', '\\', '/' -> sb.append(e);
        case 'b' -> sb.append('\b');
        case 'f' -> sb.append('\f');
        case 'n' -> sb.append('\n');
        case 'r' -> sb.append('\r');
        case 't' -> sb.append('\t');
        case 'u' -> {
          if (pos + 4 > text.length()) {
            throw error("short \\u escape");
          }
          sb.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
          pos += 4;
        }
        default -> throw error("bad escape \\" + e);
      }
    }
  }

  private void skipSpace() {
    while (pos < text.length() && " \t\r\n".indexOf(text.charAt(pos)) >= 0) {
      pos++;
    }
  }

  private boolean peek(char c) {
    return pos < text.length() && text.charAt(pos) == c;
  }

  private void expect(char c) {
    if (!peek(c)) {
      throw error("expected '" + c + "'");
    }
    pos++;
  }

  private IllegalArgumentException error(String what) {
    return new IllegalArgumentException(what + " at character " + pos + " of the argument line");
  }
}
```

`StandbyRequest.java`:

```java
package org.enso.runner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.enso.common.ProcessEnvironment;

/**
 * The line a standby engine reads from stdin (Note [Standby Mode] in {@link Standby}): the
 * arguments {@code project/open} would have passed, and the open's own environment variables, as
 * {@code {"args":["--server",...],"env":{"LANGUAGE_SERVER_CHANNEL_TOKEN":"..."}}}.
 *
 * @param args the arguments, as if they had been on the command line
 * @param env the open's variables; only the names below are accepted
 */
record StandbyRequest(List<String> args, Map<String, String> env) {
  /** The variables the Language Server reads through its configuration, and their properties. */
  static final Map<String, String> CONFIG_PROPERTIES =
      Map.of(
          "LANGUAGE_SERVER_YDOC_PORT", "language-server.ydoc.port",
          "LANGUAGE_SERVER_CHANNEL_TOKEN", "language-server.channel-token");

  /** The variables read through {@link ProcessEnvironment}. */
  static final Set<String> PROCESS_VARIABLES =
      Set.of("ENSO_LOCAL_PROJECT_ID", "ENSO_LOCAL_PROJECT_SESSION_ID");

  /**
   * @param line the line, without its newline
   * @return the request it holds
   * @throws IllegalArgumentException when it is not a valid line
   */
  static StandbyRequest parse(String line) {
    if (!(new StandbyJson(line).document() instanceof Map<?, ?> object)) {
      throw new IllegalArgumentException("the argument line is not a JSON object");
    }
    for (var key : object.keySet()) {
      if (!"args".equals(key) && !"env".equals(key)) {
        throw new IllegalArgumentException("unknown key " + key + " in the argument line");
      }
    }
    if (!(object.get("args") instanceof List<?> list)) {
      throw new IllegalArgumentException("\"args\" must be an array of strings");
    }
    var args = new ArrayList<String>();
    for (var arg : list) {
      if (!(arg instanceof String text)) {
        throw new IllegalArgumentException("\"args\" must be an array of strings");
      }
      args.add(text);
    }
    var env = new LinkedHashMap<String, String>();
    var rawEnv = object.get("env");
    if (rawEnv != null) {
      if (!(rawEnv instanceof Map<?, ?> map)) {
        throw new IllegalArgumentException("\"env\" must be an object of strings");
      }
      for (var entry : map.entrySet()) {
        var name = (String) entry.getKey();
        if (!(entry.getValue() instanceof String value)) {
          throw new IllegalArgumentException("\"env\" must be an object of strings");
        }
        if (!CONFIG_PROPERTIES.containsKey(name) && !PROCESS_VARIABLES.contains(name)) {
          throw new IllegalArgumentException("cannot apply the environment variable " + name);
        }
        env.put(name, value);
      }
    }
    return new StandbyRequest(List.copyOf(args), Collections.unmodifiableMap(env));
  }

  /**
   * Set each variable as the property it is read through, and drop the configuration library's
   * cached view of the properties, which the warm-up or the logging may already have taken.
   */
  void applyEnvironment() {
    for (var entry : env.entrySet()) {
      var property = CONFIG_PROPERTIES.get(entry.getKey());
      System.setProperty(
          property != null ? property : ProcessEnvironment.PROPERTY_PREFIX + entry.getKey(),
          entry.getValue());
    }
    com.typesafe.config.ConfigFactory.invalidateCaches();
  }
}
```

In `engine/runner/src/main/java/module-info.java`, add after
`requires org.slf4j;`:

```java
  // ConfigFactory.invalidateCaches: a standby engine sets configuration properties late.
  requires typesafe.config;
```

In `build.sbt`, in `engine-runner`'s
`Compile / moduleDependencies ++= jline ++ slf4jApi ++ Seq(...)`, add as the
last element of the `Seq`:

```scala
        "commons-cli"          % "commons-cli" % commonsCliVersion,
        "com.typesafe"         % "config"      % typesafeConfigVersion
```

- [ ] **Step 4: Run it to see it pass**

Run:
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyRequestTest"`
Expected: 5 tests PASS. Check the log has no
`[JPMSUtils/...] Not all modules ... were found` line.

- [ ] **Step 5: Commit**

```bash
git add engine/runner/src/main/java/org/enso/runner/StandbyJson.java engine/runner/src/main/java/org/enso/runner/StandbyRequest.java engine/runner/src/main/java/module-info.java build.sbt engine/runner/src/test/java/org/enso/runner/StandbyRequestTest.java
git commit -m "Runner: the standby argument line (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 5: The standby wait

**Files:**

- Create: `engine/runner/src/main/java/org/enso/runner/Standby.java`
- Test: `engine/runner/src/test/java/org/enso/runner/StandbyTest.java`

**Interfaces:**

- Consumes: `StandbyRequest.parse` (Task 4).
- Produces: `final class Standby` with
  `static final String READY = "STANDBY READY"`,
  `WARM_UP_PROPERTY = "enso.standby.warmUp"`,
  `ABANDON_PROPERTY = "enso.standby.abandonWarmUp"`,
  `interface WarmUp { void run() throws Exception; void cancel(); }`,
  `interface Preload { String run(BooleanSupplier abandoned); }`,
  `static final WarmUp NO_WARM_UP`, constructor
  `Standby(WarmUp, Preload, PrintStream err, boolean abandonOnLine)`,
  `StandbyRequest awaitRequest(InputStream in) throws IOException, InterruptedException`
  (returns `null` when stdin closes first),
  `static String readLine(InputStream in) throws IOException`.
  `static Standby create(File component)` is added in Task 7, once the warm-up
  and the preloader exist.

- [ ] **Step 1: Write the failing test**

```java
package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class StandbyTest {
  private static final String LINE = "{\"args\":[\"--server\"]}\n";

  private final ByteArrayOutputStream errBytes = new ByteArrayOutputStream();
  private final PrintStream err = new PrintStream(errBytes, true, StandardCharsets.UTF_8);

  private String err() {
    return errBytes.toString(StandardCharsets.UTF_8);
  }

  private static ByteArrayInputStream in(String text) {
    return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
  }

  /** A warm-up that runs until released, and records a cancel. */
  private static final class Gate implements Standby.WarmUp {
    final CountDownLatch release = new CountDownLatch(1);
    final AtomicBoolean cancelled = new AtomicBoolean();

    @Override
    public void run() throws Exception {
      release.await();
      if (cancelled.get()) {
        throw new IllegalStateException("cancelled");
      }
    }

    @Override
    public void cancel() {
      cancelled.set(true);
      release.countDown();
    }
  }

  @Test
  public void readsOneLineAndLeavesTheRest() throws Exception {
    var stream = in("first\nsecond\n");
    assertEquals("first", Standby.readLine(stream));
    assertEquals("second\n", new String(stream.readAllBytes(), StandardCharsets.UTF_8));
  }

  @Test
  public void aClosedStdinBeforeANewlineIsNoLine() throws Exception {
    assertNull(Standby.readLine(in("")));
    assertNull(Standby.readLine(in("partial")));
  }

  @Test
  public void theLineWaitsForTheWarmUp() throws Exception {
    var gate = new Gate();
    var standby = new Standby(gate, abandoned -> "preloaded 0 of 0 classes", err, false);
    var pipeIn = new PipedInputStream();
    var pipeOut = new PipedOutputStream(pipeIn);
    var executor = Executors.newSingleThreadExecutor();
    try {
      var result = executor.submit(() -> standby.awaitRequest(pipeIn));
      pipeOut.write(LINE.getBytes(StandardCharsets.UTF_8));
      pipeOut.flush();
      Thread.sleep(300);
      assertFalse("the request waits for the warm-up", result.isDone());
      gate.release.countDown();
      assertEquals(List.of("--server"), result.get(10, TimeUnit.SECONDS).args());
      assertFalse(gate.cancelled.get());
      assertTrue(err(), err().contains("standby: warm-up done in "));
      assertTrue(err(), err().contains(Standby.READY + " "));
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  public void abandoningCancelsTheWarmUp() throws Exception {
    var gate = new Gate();
    var standby = new Standby(gate, abandoned -> "never asked", err, true);
    var request = standby.awaitRequest(in(LINE));
    assertEquals(List.of("--server"), request.args());
    assertTrue(gate.cancelled.get());
    assertTrue(err(), err().contains("standby: warm-up abandoned"));
    assertTrue(err(), err().contains("preloading abandoned"));
  }

  @Test
  public void aFailingWarmUpStillReachesStandby() throws Exception {
    Standby.WarmUp failing =
        new Standby.WarmUp() {
          @Override
          public void run() {
            throw new IllegalStateException("no libraries");
          }

          @Override
          public void cancel() {}
        };
    var standby = new Standby(failing, abandoned -> "preloaded 0 of 0 classes", err, false);
    assertEquals(List.of("--server"), standby.awaitRequest(in(LINE)).args());
    assertTrue(err(), err().contains("standby: warning: warm-up failed: "));
    assertTrue(err(), err().contains("no libraries"));
    assertTrue(err(), err().contains(Standby.READY + " "));
  }

  @Test
  public void stdinClosedFirstGivesNoRequest() throws Exception {
    var standby = new Standby(Standby.NO_WARM_UP, abandoned -> "x", err, false);
    assertNull(standby.awaitRequest(in("")));
  }

  @Test
  public void aBadLineIsRefused() {
    var standby = new Standby(Standby.NO_WARM_UP, abandoned -> "x", err, false);
    assertThrows(IllegalArgumentException.class, () -> standby.awaitRequest(in("[1]\n")));
  }
}
```

- [ ] **Step 2: Run it to see it fail**

Run:
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyTest"`
Expected: FAIL to compile, `cannot find symbol: class Standby`.

- [ ] **Step 3: Implement**

```java
package org.enso.runner;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.function.BooleanSupplier;

/* Note [Standby Mode]
 * ~~~~~~~~~~~~~~~~~~~
 * `enso --jvm --standby` is the IDE's spare engine (spec
 * `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`). The project service starts it while
 * the user is on the dashboard, before any project is known. On a background thread it warms up
 * (`StandbyWarmUp`: a throwaway context runs the default template's imports on a temporary project)
 * and preloads classes (`StandbyPreloader`), then prints `standby: warm-up done in N ms, …` and
 * `STANDBY READY <ms from process start>` on stderr. Meanwhile the main thread reads one line from
 * stdin: `{"args":[...],"env":{...}}` (`StandbyRequest`), the arguments `project/open` would have
 * passed and the open's own variables. It waits for the warm-up to end (unless
 * `enso.standby.abandonWarmUp` is true, which cancels it), applies the variables, sets the context's
 * working directory to the parent of `--path` (`ContextFactory.WORKING_DIRECTORY_PROPERTY`; relative
 * paths are refused), and calls `Main.launch` with the arguments: from then on the process is an
 * ordinary Language Server, which shuts down on the next stdin line as always. If stdin closes before
 * a line arrives, the process exits with 0.
 *
 * Nothing sets up logging before the line: the Language Server does that itself, and its session log
 * must be the project's. Before the line the engine only writes these stderr lines, which the shim
 * echoes and summarises in the opened project's engine log. A warm-up that throws is reported there
 * as `standby: warning: warm-up failed: …` and the engine still reaches standby.
 *
 * Only the process carries over from the warm-up: HotSpot's compiled code, loaded classes and the
 * IR caches it read. The warm-up's context is closed before the Language Server's is created.
 */
/** The standby mode's wait: warm up in the background, read the argument line. */
final class Standby {
  /** The stderr line the project service waits for. */
  static final String READY = "STANDBY READY";

  /** {@code false} skips the warm-up (tests that only need the Language Server). */
  static final String WARM_UP_PROPERTY = "enso.standby.warmUp";

  /** {@code true} abandons a running warm-up as soon as the line arrives. */
  static final String ABANDON_PROPERTY = "enso.standby.abandonWarmUp";

  /** The warm-up: run on the background thread; cancelled from the reading thread. */
  interface WarmUp {
    void run() throws Exception;

    void cancel();
  }

  /** The preloading, after the warm-up; its result is a phrase for the log line. */
  interface Preload {
    String run(BooleanSupplier abandoned);
  }

  static final WarmUp NO_WARM_UP =
      new WarmUp() {
        @Override
        public void run() {}

        @Override
        public void cancel() {}
      };

  private final WarmUp warmUp;
  private final Preload preload;
  private final PrintStream err;
  private final boolean abandonOnLine;
  private volatile boolean abandoned;

  Standby(WarmUp warmUp, Preload preload, PrintStream err, boolean abandonOnLine) {
    this.warmUp = warmUp;
    this.preload = preload;
    this.err = err;
    this.abandonOnLine = abandonOnLine;
  }

  /**
   * Start the warm-up, and read the argument line.
   *
   * @return the request, once the warm-up is over; {@code null} when stdin closed first
   * @throws IllegalArgumentException when the line is not a valid request
   */
  StandbyRequest awaitRequest(InputStream in) throws IOException, InterruptedException {
    var finished = new CountDownLatch(1);
    var thread =
        new Thread(
            () -> {
              try {
                prepare();
              } finally {
                finished.countDown();
              }
            },
            "enso-standby-warm-up");
    thread.setDaemon(true);
    thread.start();
    var line = readLine(in);
    if (line == null) {
      return null;
    }
    var request = StandbyRequest.parse(line);
    if (abandonOnLine) {
      abandoned = true;
      warmUp.cancel();
    }
    finished.await();
    return request;
  }

  private void prepare() {
    var started = System.nanoTime();
    try {
      warmUp.run();
    } catch (Throwable t) {
      if (abandoned) {
        err.println("standby: warm-up abandoned");
      } else {
        err.println("standby: warning: warm-up failed: " + t);
      }
    }
    String preloaded;
    try {
      preloaded = abandoned ? "preloading abandoned" : preload.run(() -> abandoned);
    } catch (Throwable t) {
      preloaded = "preloading failed: " + t;
    }
    var ms = (System.nanoTime() - started) / 1_000_000;
    var cpu =
        ProcessHandle.current().info().totalCpuDuration().map(Duration::toMillis).orElse(-1L);
    err.println(
        "standby: warm-up done in " + ms + " ms, " + preloaded + ", process CPU " + cpu + " ms");
    err.println(READY + " " + sinceProcessStart());
    err.flush();
  }

  /** Milliseconds since this process started (the `enso` launcher, which hosts the JVM). */
  static long sinceProcessStart() {
    return ProcessHandle.current()
        .info()
        .startInstant()
        .map(start -> Duration.between(start, Instant.now()).toMillis())
        .orElse(-1L);
  }

  /**
   * One line, read a byte at a time so that nothing after it is consumed: the Language Server reads
   * its shutdown line from the same stdin later.
   *
   * @return the line without its line break, or {@code null} when the stream ends first
   */
  static String readLine(InputStream in) throws IOException {
    var bytes = new ByteArrayOutputStream();
    while (true) {
      int b = in.read();
      if (b < 0) {
        return null;
      }
      if (b == '\n') {
        var line = bytes.toString(StandardCharsets.UTF_8);
        return line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
      }
      bytes.write(b);
    }
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run:
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyTest"`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/runner/src/main/java/org/enso/runner/Standby.java engine/runner/src/test/java/org/enso/runner/StandbyTest.java
git commit -m "Runner: the standby wait, warm-up in the background (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 6: The warm-up

**Files:**

- Create: `engine/runner/src/main/java/org/enso/runner/StandbyWarmUp.java`

**Interfaces:**

- Consumes: `Standby.WarmUp` (Task 5), `ContextFactory.workingDirectory` (Task
  1).
- Produces: `final class StandbyWarmUp implements Standby.WarmUp`,
  `StandbyWarmUp()`, `static final String MAIN_SOURCE`,
  `static final String PROJECT_NAME = "Warm_Up"`.

The warm-up is exercised end to end by
`StandbyProcessTest.aWarmedUpStandbyOpensTheProject` (Task 8, with a built
distribution) and by the measurement of Part 3. A unit test would have to
compile the standard library from source inside sbt, which takes minutes and
needs the std-bits built, so there is none.

- [ ] **Step 1: Implement**

```java
package org.enso.runner;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.concurrent.atomic.AtomicReference;
import org.enso.common.ContextFactory;
import org.enso.editions.DefaultEdition;
import org.enso.pkg.PackageManager$;
import org.enso.pkg.Template;
import org.enso.polyglot.PolyglotContext;
import org.graalvm.polyglot.Context;
import scala.Option$;

/**
 * The standby warm-up (Note [Standby Mode] in {@link Standby}): a project made from the default
 * template in a fresh folder under the system temporary directory, whose `Main` imports the
 * template's libraries, builds a table, filters, aggregates and sorts it, and prepares a table
 * visualization of the result. The context is closed and the folder deleted afterwards. The
 * libraries' IR caches are read from the usual data directory, as an open would.
 */
final class StandbyWarmUp implements Standby.WarmUp {
  static final String PROJECT_NAME = "Warm_Up";

  /** The default template's imports (Standard.Database and Standard.Examples included). */
  static final String MAIN_SOURCE =
      """
      from Standard.Base import all
      from Standard.Table import all
      from Standard.Database import all
      import Standard.Examples
      import Standard.Visualization
      import Standard.Visualization.Table.Visualization as Table_Visualization

      main =
          numbers = 0.up_to 2000 . to_vector
          keys = numbers.map i-> "K" + (i % 17).to_text
          values = numbers.map i-> (i * 37) % 101
          ratios = numbers.map i-> i / 7
          table = Table.new [["Key", keys], ["Value", values], ["Ratio", ratios]]
          filtered = table.filter "Value" (Filter_Condition.Greater than=10)
          totals = filtered.aggregate ["Key"] [Aggregate_Column.Sum "Value", Aggregate_Column.Average "Ratio", Aggregate_Column.Count]
          sorted = totals.order_by ["Key"]
          Table_Visualization.prepare_visualization sorted 1000
      """;

  private final AtomicReference<Context> running = new AtomicReference<>();
  private volatile boolean cancelled;

  @Override
  public void run() throws IOException {
    var directory = Files.createTempDirectory("enso-standby-");
    try {
      var root = directory.resolve(PROJECT_NAME);
      createProject(root.toFile());
      Files.writeString(root.resolve("src").resolve("Main.enso"), MAIN_SOURCE);
      // The Language Server's options (`MainModule`), so that the libraries' IR caches it reads
      // are the ones an open reads.
      var context =
          ContextFactory.create()
              .projectRoot(root.toString())
              .workingDirectory(directory.toString())
              .logLevel(java.util.logging.Level.WARNING)
              .strictErrors(false)
              .enableIrCaches(true)
              .disableLinting(true)
              .out(OutputStream.nullOutputStream())
              .build();
      running.set(context);
      try {
        if (cancelled) {
          return;
        }
        var module =
            new PolyglotContext(context).getTopScope().getModule("local." + PROJECT_NAME + ".Main");
        var main = module.getMethod(module.getAssociatedType(), "main");
        if (main.isEmpty()) {
          throw new IllegalStateException("the warm-up project has no main");
        }
        var result = main.get().execute();
        if (!result.isString()) {
          throw new IllegalStateException("the warm-up returned " + result);
        }
      } finally {
        var still = running.getAndSet(null);
        if (still != null) {
          still.close();
        }
      }
    } finally {
      deleteRecursively(directory);
    }
  }

  @Override
  public void cancel() {
    cancelled = true;
    var context = running.getAndSet(null);
    if (context != null) {
      context.close(true);
    }
  }

  @SuppressWarnings("unchecked")
  private static <T> scala.collection.immutable.List<T> nil() {
    return (scala.collection.immutable.List<T>) scala.collection.immutable.Nil$.MODULE$;
  }

  /** As `enso --new` does with the default template (`Main.createNew`). */
  private static void createProject(File root) {
    PackageManager$.MODULE$
        .Default()
        .create(
            root,
            PROJECT_NAME,
            "local",
            Option$.MODULE$.empty(),
            "0.0.1",
            Template.Default$.MODULE$,
            scala.Option.apply(DefaultEdition.getDefaultEdition()),
            nil(),
            nil(),
            "",
            Option$.MODULE$.empty(),
            nil(),
            Option$.MODULE$.empty(),
            false,
            false);
  }

  private static void deleteRecursively(Path directory) {
    try {
      Files.walkFileTree(
          directory,
          new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
                throws IOException {
              Files.deleteIfExists(file);
              return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc)
                throws IOException {
              Files.deleteIfExists(dir);
              return FileVisitResult.CONTINUE;
            }
          });
    } catch (IOException e) {
      System.err.println("standby: could not delete " + directory + ": " + e);
    }
  }
}
```

- [ ] **Step 2: Compile**

Run: `sbt -Dsbt.server.forcestart=true "engine-runner/compile"` Expected:
success.

- [ ] **Step 3: Commit**

```bash
git add engine/runner/src/main/java/org/enso/runner/StandbyWarmUp.java
git commit -m "Runner: the standby warm-up on a temporary default-template project (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 7: Preloading, from a generated list

**Files:**

- Create: `tools/standby-preload/generate.mjs`
- Create: `engine/runner/src/main/java/org/enso/runner/StandbyPreloader.java`
- Create (generated):
  `engine/runner/src/main/resources/org/enso/runner/standby-preload.txt`
- Modify: `engine/runner/src/main/java/org/enso/runner/Standby.java` (add
  `create`)
- Test: `engine/runner/src/test/java/org/enso/runner/StandbyPreloaderTest.java`

**Interfaces:**

- Consumes: `JvmOptions.all(File componentDir, String environmentValue)` and
  `JvmOptions.ENVIRONMENT_VARIABLE` (existing), `Standby.Preload` (Task 5),
  `StandbyWarmUp` (Task 6).
- Produces: `StandbyPreloader(List<String> jvmOptions)`,
  `StandbyPreloader(List<String> jvmOptions, List<String> names, ClassLoader loader)`,
  `String preload(BooleanSupplier abandoned)`,
  `static boolean aotCacheInUse(List<String> jvmOptions)`,
  `static List<String> listedClasses()`,
  `static final String RESOURCE = "/org/enso/runner/standby-preload.txt"`. Also
  `static Standby Standby.create(File component)`.

- [ ] **Step 1: Write the failing test**

```java
package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class StandbyPreloaderTest {
  @Test
  public void anAotCacheMeansNoPreloading() {
    assertTrue(StandbyPreloader.aotCacheInUse(List.of("-Dx=1", "-XX:AOTCache=C:\\a\\enso.aot")));
    assertTrue(StandbyPreloader.aotCacheInUse(List.of("-XX:SharedArchiveFile=/a/enso.jsa")));
    assertFalse(StandbyPreloader.aotCacheInUse(List.of("-XX:-UseJVMCICompiler")));
    var preloader =
        new StandbyPreloader(
            List.of("-XX:AOTCache=/a/enso.aot"),
            List.of("java.lang.String"),
            ClassLoader.getSystemClassLoader());
    assertEquals(
        "preloading skipped: the AOT cache holds the classes", preloader.preload(() -> false));
  }

  @Test
  public void loadsWhatItFindsAndCountsTheRest() {
    var preloader =
        new StandbyPreloader(
            List.of(),
            List.of("java.lang.String", "org.enso.does.not.Exist", "java.util.ArrayList"),
            ClassLoader.getSystemClassLoader());
    assertEquals("preloaded 2 of 3 classes", preloader.preload(() -> false));
  }

  @Test
  public void stopsWhenAbandoned() {
    var preloader =
        new StandbyPreloader(
            List.of(), List.of("java.lang.String"), ClassLoader.getSystemClassLoader());
    assertEquals("preloaded 0 of 1 classes (abandoned)", preloader.preload(() -> true));
  }

  @Test
  public void theListIsThereAndHoldsNoGeneratedClasses() throws Exception {
    var names = StandbyPreloader.listedClasses();
    assertTrue("the generated list is not empty", names.size() > 1000);
    for (var name : names) {
      assertFalse(name, name.contains("$$Lambda") || name.contains("/0x"));
    }
  }
}
```

- [ ] **Step 2: Run it to see it fail**

Run:
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyPreloaderTest"`
Expected: FAIL to compile, `cannot find symbol: class StandbyPreloader`.

- [ ] **Step 3: Implement the preloader and `Standby.create`**

`StandbyPreloader.java`:

```java
package org.enso.runner;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * Loads, without initialising, the classes a Language Server boot loads, so that a standby
 * engine's boot finds them loaded and verified (Note [Standby Mode] in {@link Standby}). The list
 * ({@link #RESOURCE}) is generated by `tools/standby-preload/generate.mjs` from a boot without an
 * AOT cache. With a cache it is skipped: the IDE's cache is trained on a Language Server boot, so it
 * already holds these classes, and the ones it does not (lambda classes) cannot be named.
 *
 * <p>The cache is seen only in the options the launcher gives the JVM (`jvm.options` and
 * `ENSO_JVM_OPTIONS`). One passed through `JAVA_TOOL_OPTIONS` is not seen, and only costs a
 * needless preload; the IDE passes its cache in `ENSO_JVM_OPTIONS`.
 */
final class StandbyPreloader {
  static final String RESOURCE = "/org/enso/runner/standby-preload.txt";

  private final List<String> jvmOptions;
  private final List<String> names;
  private final ClassLoader loader;

  StandbyPreloader(List<String> jvmOptions) {
    this(jvmOptions, null, ClassLoader.getSystemClassLoader());
  }

  StandbyPreloader(List<String> jvmOptions, List<String> names, ClassLoader loader) {
    this.jvmOptions = jvmOptions;
    this.names = names;
    this.loader = loader;
  }

  /** Whether the JVM was started with an AOT cache (JEP 483) or a CDS archive. */
  static boolean aotCacheInUse(List<String> jvmOptions) {
    return jvmOptions.stream()
        .anyMatch(o -> o.startsWith("-XX:AOTCache=") || o.startsWith("-XX:SharedArchiveFile="));
  }

  /** The listed class names, in the order the boot loaded them. */
  static List<String> listedClasses() throws IOException {
    try (InputStream in = StandbyPreloader.class.getResourceAsStream(RESOURCE)) {
      if (in == null) {
        throw new IOException(RESOURCE + " is missing");
      }
      return new String(in.readAllBytes(), StandardCharsets.UTF_8)
          .lines()
          .map(String::trim)
          .filter(line -> !line.isEmpty() && !line.startsWith("#"))
          .toList();
    }
  }

  /** Load the classes; the result is a phrase for the standby log line. */
  String preload(BooleanSupplier abandoned) {
    if (aotCacheInUse(jvmOptions)) {
      return "preloading skipped: the AOT cache holds the classes";
    }
    List<String> list;
    try {
      list = names != null ? names : listedClasses();
    } catch (IOException e) {
      return "preloading skipped: " + e.getMessage();
    }
    var loaded = 0;
    for (var name : list) {
      if (abandoned.getAsBoolean()) {
        return "preloaded " + loaded + " of " + list.size() + " classes (abandoned)";
      }
      try {
        Class.forName(name, false, loader);
        loaded++;
      } catch (ClassNotFoundException | LinkageError e) {
        // A class that is gone since the list was made, or not visible here: skipped.
      }
    }
    return "preloaded " + loaded + " of " + list.size() + " classes";
  }
}
```

In `Standby.java`, add `import java.io.File;` and, after the constructor:

```java
  /** The standby of `enso --standby`: the real warm-up and preloader, and the two properties. */
  static Standby create(File component) {
    WarmUp warmUp =
        Boolean.parseBoolean(System.getProperty(WARM_UP_PROPERTY, "true"))
            ? new StandbyWarmUp()
            : NO_WARM_UP;
    var preloader =
        new StandbyPreloader(
            JvmOptions.all(component, System.getenv(JvmOptions.ENVIRONMENT_VARIABLE)));
    return new Standby(
        warmUp,
        preloader::preload,
        System.err,
        Boolean.parseBoolean(System.getProperty(ABANDON_PROPERTY, "false")));
  }
```

- [ ] **Step 4: Write the generator**

`tools/standby-preload/generate.mjs`:

```js
#!/usr/bin/env node
/**
 * @file Turns a `-Xlog:class+load` log of a Language Server boot into the standby engine's preload
 * list (`engine/runner/src/main/resources/org/enso/runner/standby-preload.txt`; engine/runner
 * CLAUDE.md, "Standby mode"). Lambda, proxy and other generated classes cannot be loaded by name,
 * so they are left out; the order of first loading is kept.
 *
 * Usage: node tools/standby-preload/generate.mjs <class-load.log> <standby-preload.txt>
 */
import fs from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error(
    "Usage: node tools/standby-preload/generate.mjs <class-load.log> <output.txt>",
  );
  process.exit(2);
}

const LINE = /\[class,load\]\s+(\S+)\s+source:\s+(.*)$/;
const NAMED_SOURCE = /^(jrt:\/|file:|jar:|shared objects file)/;
const names = new Set();
for (const line of fs.readFileSync(input, "utf8").split(/\r?\n/)) {
  const match = LINE.exec(line);
  if (!match) continue;
  const [, name, source] = match;
  if (!NAMED_SOURCE.test(source)) continue;
  if (
    name.includes("$$Lambda") ||
    name.includes("/0x") ||
    name.includes("$Proxy")
  )
    continue;
  if (name.startsWith("jdk.internal.reflect.Generated")) continue;
  names.add(name);
}
const header = [
  "# The classes a Language Server boot loads, which a standby engine without an AOT cache",
  '# preloads (engine/runner CLAUDE.md, "Standby mode"). Generated by',
  "# tools/standby-preload/generate.mjs from a boot without a cache: do not edit by hand.",
];
fs.writeFileSync(output, [...header, ...names].join("\n") + "\n");
console.log(`${names.size} classes`);
```

- [ ] **Step 5: Generate the list from a boot without a cache (WSL)**

Build the distribution in WSL, from a clone on the Linux filesystem (root
CLAUDE.md: much faster than through `/mnt/c`). Check `df -h ~` first: the build
needs ~15 GB.

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && rm -rf ~/jvm-standby && git clone --branch jvm-warm-engine-1-standby /mnt/c/Repos/Enso/ide ~/jvm-standby && cd ~/jvm-standby && test "$(pwd)" = "$HOME/jvm-standby" && export CARGO_TARGET_DIR=$HOME/enso-target && sbt -Dsbt.server.forcestart=true buildEngineDistribution'
```

Run one Language Server boot with class loading logged, then stop it with a
newline after it has started. The distribution's `bin/enso` is the shell
launcher, which starts the JVM itself and does not read `ENSO_JVM_OPTIONS`
(engine/runner CLAUDE.md), so the log option goes in `JAVA_TOOL_OPTIONS`:

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/jvm-standby && export ENSO_DATA_DIRECTORY=$HOME/standby-data && rm -rf /tmp/standby-gen && mkdir -p /tmp/standby-gen && ENSO=$PWD/$(ls -d built-distribution/enso-engine-*/enso-*)/bin/enso && $ENSO --new /tmp/standby-gen/Gen_Project && cd /tmp/standby-gen && (sleep 90; echo) | JAVA_TOOL_OPTIONS="-Xlog:class+load=info:file=/tmp/standby-gen/class-load.log" $ENSO --server --root-id 00000000-0000-0000-0000-000000000001 --project-id 00000000-0000-0000-0000-000000000002 --path /tmp/standby-gen/Gen_Project --interface 127.0.0.1 --rpc-port 30999 && cd ~/jvm-standby && node tools/standby-preload/generate.mjs /tmp/standby-gen/class-load.log engine/runner/src/main/resources/org/enso/runner/standby-preload.txt'
```

Expected: `Started server at json` in the output within 90 s, then
`NNNN classes` with NNNN above 1000. Copy the file back into the Windows
worktree:

```bash
wsl -e bash -lc 'cp ~/jvm-standby/engine/runner/src/main/resources/org/enso/runner/standby-preload.txt /mnt/c/Repos/Enso/ide/.claude/worktrees/jvm-standby/engine/runner/src/main/resources/org/enso/runner/standby-preload.txt'
```

- [ ] **Step 6: Run the test to see it pass**

Run:
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyPreloaderTest org.enso.runner.StandbyTest"`
Expected: 4 + 7 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/standby-preload/generate.mjs engine/runner/src/main/java/org/enso/runner/StandbyPreloader.java engine/runner/src/main/java/org/enso/runner/Standby.java engine/runner/src/main/resources/org/enso/runner/standby-preload.txt engine/runner/src/test/java/org/enso/runner/StandbyPreloaderTest.java
git commit -m "Runner: standby preloading from a generated list, skipped with an AOT cache (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 8: `--standby` in `Main`

**Files:**

- Modify: `engine/runner/src/main/java/org/enso/runner/Main.java` (option
  constant ~line 111, `buildOptions`, `launch`)
- Test: `engine/runner/src/test/java/org/enso/runner/StandbyProcessTest.java`

**Interfaces:**

- Consumes: `Standby.create`, `Standby.awaitRequest`,
  `StandbyRequest.applyEnvironment` (Tasks 4, 5, 7),
  `ContextFactory.WORKING_DIRECTORY_PROPERTY` (Task 1).
- Produces: the CLI option `--standby` (`Main.STANDBY_OPTION = "standby"`).
  `Main.launch(String[])` becomes package-private.

- [ ] **Step 1: Write the failing test**

The test runs a real engine: the checkout's `built-distribution/`
(`sbt buildEngineDistribution`). Without one it is skipped, as the shim's
`ProjectService` tests are. Its `bin/enso` (or `enso.bat`) starts the JVM
itself, so `--standby` needs no `--jvm` there.

```java
package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * `enso --standby` as the project service runs it: the process's working directory is not the
 * project's parent, the line arrives on stdin, and the Language Server then answers `/_health` and
 * a JSON-RPC session, with the warm-up off and, in one process, after a full warm-up.
 */
public class StandbyProcessTest {
  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  /** `built-distribution/enso-engine-*\/enso-*\/bin/enso(.bat)` above the working directory. */
  private static File launcher() throws IOException {
    var dir = Path.of("").toAbsolutePath();
    while (dir != null && !Files.exists(dir.resolve("build.sbt"))) {
      dir = dir.getParent();
    }
    if (dir == null || !Files.isDirectory(dir.resolve("built-distribution"))) {
      return null;
    }
    var name = System.getProperty("os.name").toLowerCase().contains("windows") ? "enso.bat" : "enso";
    try (Stream<Path> found = Files.walk(dir.resolve("built-distribution"), 4)) {
      return found
          .filter(p -> p.getFileName().toString().equals(name) && p.getParent().endsWith("bin"))
          .map(Path::toFile)
          .findFirst()
          .orElse(null);
    }
  }

  private static String json(String text) {
    return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private static int freePort() throws IOException {
    try (var socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    }
  }

  private static boolean healthy(int port) {
    try {
      var connection =
          (HttpURLConnection) URI.create("http://127.0.0.1:" + port + "/_health").toURL().openConnection();
      connection.setConnectTimeout(500);
      connection.setReadTimeout(2000);
      return connection.getResponseCode() == 200;
    } catch (IOException e) {
      return false;
    }
  }

  /** A started standby engine, its stderr collected line by line. */
  private record Engine(Process process, List<String> stderr) {
    boolean said(String text) {
      synchronized (stderr) {
        return stderr.stream().anyMatch(line -> line.contains(text));
      }
    }

    void waitFor(String text, long seconds) throws InterruptedException {
      var end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
      while (!said(text)) {
        assertTrue("no '" + text + "' within " + seconds + " s: " + stderr, System.nanoTime() < end);
        assertTrue("the engine exited: " + stderr, process.isAlive());
        Thread.sleep(100);
      }
    }
  }

  private Engine start(File enso, boolean warmUp) throws IOException {
    var elsewhere = tmp.newFolder("elsewhere");
    var command = new ArrayList<String>();
    if (enso.getName().endsWith(".bat")) {
      command.addAll(List.of("cmd", "/c"));
    }
    command.addAll(
        List.of(enso.getAbsolutePath(), "--standby", "--vm.D", "enso.standby.warmUp=" + warmUp));
    var builder = new ProcessBuilder(command).directory(elsewhere);
    builder.environment().put("ENSO_DATA_DIRECTORY", tmp.newFolder("data").getAbsolutePath());
    builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
    var process = builder.start();
    var stderr = Collections.synchronizedList(new ArrayList<String>());
    var reader =
        new Thread(
            () -> {
              try (var lines =
                  new BufferedReader(
                      new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = lines.readLine()) != null) {
                  stderr.add(line);
                }
              } catch (IOException e) {
                stderr.add("read failed: " + e);
              }
            });
    reader.setDaemon(true);
    reader.start();
    return new Engine(process, stderr);
  }

  private Path project() throws IOException {
    var project = tmp.newFolder("projects", "Standby_Test").toPath();
    Files.writeString(
        project.resolve("package.yaml"),
        "name: Standby_Test\nnamespace: local\nversion: 0.0.1\nlicense: ''\nauthors: []\nmaintainers: []\n");
    Files.createDirectories(project.resolve("src"));
    Files.writeString(project.resolve("src").resolve("Main.enso"), "main = 42\n");
    return project;
  }

  private static String line(Path project, int port, String rootId) {
    var args =
        List.of(
            "--server",
            "--root-id",
            rootId,
            "--project-id",
            UUID.randomUUID().toString(),
            "--path",
            project.toString(),
            "--interface",
            "127.0.0.1",
            "--rpc-port",
            Integer.toString(port));
    var quoted = args.stream().map(StandbyProcessTest::json).toList();
    return "{\"args\":["
        + String.join(",", quoted)
        + "],\"env\":{\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\"standby-test\",\"ENSO_LOCAL_PROJECT_ID\":\"standby-test-key\"}}\n";
  }

  /**
   * `session/initProtocolConnection` on the JSON-RPC socket, as the GUI's first call; its answer.
   * `/_health` passes while the Language Server still initialises, and a socket opened then is
   * dropped (`jvmAot/driver.ts` in the shim), so a failed attempt is retried once a second.
   */
  private static String initProtocolConnection(int port) throws Exception {
    var client = HttpClient.newHttpClient();
    var end = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
    Exception last = null;
    while (System.nanoTime() < end) {
      var answer = new CompletableFuture<String>();
      var message = new StringBuilder();
      try {
        var socket =
            client
                .newWebSocketBuilder()
                .buildAsync(
                    URI.create("ws://127.0.0.1:" + port + "/"),
                    new WebSocket.Listener() {
                      @Override
                      public CompletionStage<?> onText(
                          WebSocket ws, CharSequence data, boolean lastPart) {
                        message.append(data);
                        if (lastPart) {
                          var text = message.toString();
                          message.setLength(0);
                          if (text.contains("\"id\":0")) {
                            answer.complete(text);
                          }
                        }
                        ws.request(1);
                        return null;
                      }

                      @Override
                      public void onError(WebSocket ws, Throwable error) {
                        answer.completeExceptionally(error);
                      }

                      @Override
                      public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
                        answer.completeExceptionally(new IOException("closed: " + code));
                        return null;
                      }
                    })
                .get(10, TimeUnit.SECONDS);
        socket.sendText(
            "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"session/initProtocolConnection\","
                + "\"params\":{\"clientId\":\""
                + UUID.randomUUID()
                + "\"}}",
            true);
        var reply = answer.get(30, TimeUnit.SECONDS);
        socket.sendClose(WebSocket.NORMAL_CLOSURE, "done");
        return reply;
      } catch (Exception e) {
        last = e;
        Thread.sleep(1000);
      }
    }
    throw new AssertionError("no answer to session/initProtocolConnection", last);
  }

  /**
   * Hand `engine` the line for a fresh project, and check that its Language Server answers
   * `/_health`, opens the project (the content roots name the line's root id) and stops on a newline.
   */
  private void serveProject(Engine engine) throws Exception {
    var project = project();
    var port = freePort();
    var rootId = UUID.randomUUID().toString();
    var stdin = engine.process().getOutputStream();
    stdin.write(line(project, port, rootId).getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    var end = System.nanoTime() + TimeUnit.SECONDS.toNanos(120);
    while (!healthy(port)) {
      assertTrue("no /_health within 120 s: " + engine.stderr(), System.nanoTime() < end);
      assertTrue("the engine exited: " + engine.stderr(), engine.process().isAlive());
      Thread.sleep(250);
    }
    var reply = initProtocolConnection(port);
    assertTrue(reply, reply.contains("\"result\""));
    assertTrue("the project is a content root: " + reply, reply.contains(rootId));
    assertFalse(engine.stderr().toString(), engine.said("unexpected working directory"));
    stdin.write('\n');
    stdin.flush();
    assertTrue(engine.process().waitFor(60, TimeUnit.SECONDS));
    assertEquals(0, engine.process().exitValue());
  }

  @Test(timeout = 300_000)
  public void theLineStartsALanguageServer() throws Exception {
    var enso = launcher();
    assumeTrue("no built-distribution: build one with `sbt buildEngineDistribution`", enso != null);
    var engine = start(enso, false);
    engine.waitFor(Standby.READY, 120);
    serveProject(engine);
  }

  @Test(timeout = 480_000)
  public void aWarmedUpStandbyOpensTheProject() throws Exception {
    var enso = launcher();
    assumeTrue("no built-distribution: build one with `sbt buildEngineDistribution`", enso != null);
    var engine = start(enso, true);
    engine.waitFor(Standby.READY, 240);
    assertTrue(engine.stderr().toString(), engine.said("standby: warm-up done in "));
    assertFalse(engine.stderr().toString(), engine.said("warm-up failed"));
    // The same process: the warm-up's context is gone, and the project's opens as usual.
    serveProject(engine);
  }

  @Test(timeout = 300_000)
  public void stdinClosedBeforeTheLineExitsWithZero() throws Exception {
    var enso = launcher();
    assumeTrue("no built-distribution: build one with `sbt buildEngineDistribution`", enso != null);
    var engine = start(enso, false);
    engine.process().getOutputStream().close();
    assertTrue(engine.process().waitFor(120, TimeUnit.SECONDS));
    assertEquals(0, engine.process().exitValue());
  }

  @Test(timeout = 300_000)
  public void aRelativePathIsRefused() throws Exception {
    var enso = launcher();
    assumeTrue("no built-distribution: build one with `sbt buildEngineDistribution`", enso != null);
    var engine = start(enso, false);
    var stdin = engine.process().getOutputStream();
    stdin.write(
        "{\"args\":[\"--server\",\"--path\",\"Relative_Project\",\"--rpc-port\",\"1\"]}\n"
            .getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    assertTrue(engine.process().waitFor(120, TimeUnit.SECONDS));
    assertEquals(1, engine.process().exitValue());
    assertTrue(engine.stderr().toString(), engine.said("needs an absolute --path"));
  }
}
```

- [ ] **Step 2: Run it to see it fail (WSL, with the distribution of Task 7)**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/jvm-standby && git pull --ff-only /mnt/c/Repos/Enso/ide jvm-warm-engine-1-standby && export ENSO_DATA_DIRECTORY=$HOME/standby-data && sbt -Dsbt.server.forcestart=true buildEngineDistribution "engine-runner/testOnly org.enso.runner.StandbyProcessTest"'
```

Expected: the 4 tests FAIL (the last fails without its message): the engine
prints `Unrecognized option: --standby` and exits 1.

- [ ] **Step 3: Implement**

In `Main.java`, after `private static final String SYSTEM_PROPERTY = "vm.D";`:

```java
  private static final String STANDBY_OPTION = "standby";
```

In `buildOptions()`, before `var options = new Options();`:

```java
    var standbyOption =
        cliOptionBuilder()
            .longOpt(STANDBY_OPTION)
            .desc(
                "Starts the engine, warms it up, and waits for one line of JSON on stdin: the"
                    + " arguments to run with. Used by the IDE's spare engine; needs --jvm.")
            .build();
```

and add `.addOption(standbyOption)` after `.addOption(lsOption)`.

Change the declaration
`private void launch(String[] args) throws IOException, InterruptedException, URISyntaxException {`
to:

```java
  void launch(String[] args) throws IOException, InterruptedException, URISyntaxException {
```

In `launch`, change the logging condition
`if (line.hasOption(LANGUAGE_SERVER_OPTION)) {` (the one that sets
`config.resource`) to:

```java
    // A standby engine becomes a Language Server: it sets up no logging of its own either (Note
    // [Standby Mode] in `Standby`).
    if (line.hasOption(LANGUAGE_SERVER_OPTION) || line.hasOption(STANDBY_OPTION)) {
```

At the end of `launch`, replace the last statement
`handleLaunch(originalCwdOrNull, line, logLevel, logMasking[0]);` with:

```java
    if (line.hasOption(STANDBY_OPTION)) {
      runStandby(component);
      return;
    }
    handleLaunch(originalCwdOrNull, line, logLevel, logMasking[0]);
```

and add after `launch`:

```java
  /**
   * `--standby` (Note [Standby Mode] in {@link Standby}): warm up, read the argument line, and
   * launch with it as if it had been the command line.
   */
  private void runStandby(File component)
      throws IOException, InterruptedException, URISyntaxException {
    if (HostEnsoUtils.isAot()) {
      throw exitFail("--" + STANDBY_OPTION + " runs only on the JVM: add --" + JVM_OPTION + ".");
    }
    StandbyRequest request;
    try {
      request = Standby.create(component).awaitRequest(System.in);
    } catch (IllegalArgumentException e) {
      throw exitFail("standby: " + e.getMessage());
    }
    if (request == null) {
      throw exitSuccess();
    }
    var args = request.args().toArray(new String[0]);
    var projectPath = preprocessArguments(args).getOptionValue(LanguageServerApi.ROOT_PATH_OPTION);
    if (projectPath == null || !Path.of(projectPath).isAbsolute()) {
      throw exitFail("standby: the argument line needs an absolute --path.");
    }
    request.applyEnvironment();
    var parent = Path.of(projectPath).normalize().getParent();
    if (parent != null) {
      System.setProperty(ContextFactory.WORKING_DIRECTORY_PROPERTY, parent.toString());
    }
    launch(args);
  }
```

- [ ] **Step 4: Run it to see it pass (WSL)**

Copy the change into the WSL clone (`git pull` as in Step 2, after committing in
Step 5, or run Step 5 first), then:

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/jvm-standby && export ENSO_DATA_DIRECTORY=$HOME/standby-data && sbt -Dsbt.server.forcestart=true buildEngineDistribution "engine-runner/testOnly org.enso.runner.StandbyProcessTest org.enso.runner.StandbyTest org.enso.runner.StandbyRequestTest org.enso.runner.StandbyPreloaderTest org.enso.runner.EngineMainTest"'
```

Expected: every test PASSES, and none is skipped (the distribution is there).
Also run
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyProcessTest"`
on Windows without a `built-distribution/`, expecting the 4 tests reported as
skipped.

- [ ] **Step 5: Commit**

```bash
git add engine/runner/src/main/java/org/enso/runner/Main.java engine/runner/src/test/java/org/enso/runner/StandbyProcessTest.java
git commit -m "Runner: enso --jvm --standby (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 9: The AOT cache check, docs, and PR 1

**Files:**

- Modify: `engine/runner/CLAUDE.md` (new section "Standby mode" after "JVM mode
  (`--jvm`)")

- [ ] **Step 1: Measure what the AOT cache leaves to preloading (WSL, the
      distribution of Task 8)**

Decision 5 claims that a cache trained on a Language Server boot already holds
the named classes of such a boot. Check it the way the shim makes its cache
(record, then create with the options the JVM ran with; `aotCreateArguments` in
`app/project-manager-shim/src/projectService/jvmOptions.ts`). Here the JVM is
the shell launcher's, so its options are `distribution/bin/enso`'s `JAVA_OPTS`
and the `jvm.options` lines. Then boot again with the cache and count where each
class came from:

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/jvm-standby && export ENSO_DATA_DIRECTORY=$HOME/standby-data && ENGINE=$PWD/$(ls -d built-distribution/enso-engine-*/enso-*) && G=/tmp/standby-gen && boot() { (sleep 90; echo) | (cd $G && $ENGINE/bin/enso --server --root-id 00000000-0000-0000-0000-000000000001 --project-id 00000000-0000-0000-0000-000000000002 --path $G/Gen_Project --interface 127.0.0.1 --rpc-port 30999); } && JAVA_TOOL_OPTIONS="-XX:AOTMode=record -XX:AOTConfiguration=$G/enso.aotconf" boot && java -XX:AOTMode=create -XX:AOTConfiguration=$G/enso.aotconf -XX:AOTCache=$G/enso.aot --module-path $ENGINE/component --enable-native-access=org.graalvm.truffle --sun-misc-unsafe-memory-access=allow --add-opens=java.base/java.nio=ALL-UNNAMED $(grep -vE "^[[:space:]]*(#|$)" $ENGINE/jvm.options) -m org.enso.runner/org.enso.runner.Main && JAVA_TOOL_OPTIONS="-XX:AOTCache=$G/enso.aot -Xlog:class+load=info:file=$G/cached-load.log" boot && echo "from the cache: $(grep -c "shared objects file" $G/cached-load.log)" && echo "named, from jars: $(grep -E "source: (jrt:|file:|jar:)" $G/cached-load.log | grep -vcE "Lambda|/0x|Proxy")" && echo "generated: $(grep -cE "Lambda|/0x" $G/cached-load.log)"'
```

Expected: `Started server at json` in both boots and three counts, the first in
the thousands. Record all three in the PR body. If the named classes from jars
number more than 500, the claim does not hold. In that case say so in the PR and
open a follow-up issue instead of widening this PR:
`gh issue create --title "Standby preloading: N named classes miss the AOT cache" --body "<the three counts, and the command above>"`,
with the body ending in `Refs #518`.

- [ ] **Step 2: Document the mode**

Insert in `engine/runner/CLAUDE.md` after the "JVM mode (`--jvm`)" section:

```markdown
## Standby mode (`--standby`)

`enso --jvm --standby` is the IDE's spare engine (spec
`docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`; Note [Standby
Mode] in `Standby.java`). It starts the JVM as `--jvm` does, then on a
background thread runs `StandbyWarmUp` (a throwaway context on a temporary copy
of the default template whose `Main` imports Base, Table, Database, Examples and
Visualization, builds, filters, aggregates and sorts a table and prepares its
visualization) and `StandbyPreloader`, and prints
`standby: warm-up done in N ms, <preloading>, process CPU C ms` and
`STANDBY READY <ms since process start>` on stderr. It reads one line from
stdin: `{"args":[...],"env":{...}}` (`StandbyRequest`), the arguments
`project/open` would have passed. `env` accepts only `LANGUAGE_SERVER_YDOC_PORT`
and `LANGUAGE_SERVER_CHANNEL_TOKEN` (set as the `language-server.*`
configuration properties) and `ENSO_LOCAL_PROJECT_ID` and
`ENSO_LOCAL_PROJECT_SESSION_ID` (set as `enso.env.<NAME>`, read through
`org.enso.common.ProcessEnvironment`). Any code that reads one of those four
from the environment must read it the same way. It then sets the context's
working directory (`enso.context.workingDirectory`, applied by `ContextFactory`)
to the parent of `--path`, which must be absolute, and calls `launch` with the
arguments. A closed stdin before the line exits with 0.

- Nothing logs before the line: the Language Server sets up logging itself.
  Messages before it are stderr lines (`standby: warning: warm-up failed: …`).
- `--vm.D enso.standby.warmUp=false` skips the warm-up (tests);
  `--vm.D enso.standby.abandonWarmUp=true` cancels a running warm-up when the
  line arrives instead of waiting for it.
- The preload list (`src/main/resources/org/enso/runner/standby-preload.txt`) is
  generated: run a Language Server boot without an AOT cache with
  `JAVA_TOOL_OPTIONS=-Xlog:class+load=info:file=<log>` (the shell launcher of
  `built-distribution/` does not read `ENSO_JVM_OPTIONS`), then
  `node tools/standby-preload/generate.mjs <log> <the list>`. Classes that have
  gone are skipped at run time; regenerate it when a release's count drops
  noticeably (the standby line says `preloaded N of M classes`). It is skipped
  when the JVM runs with an AOT cache, which already holds those classes. The
  cache is seen only in `jvm.options` and `ENSO_JVM_OPTIONS` (`JvmOptions.all`);
  one given through `JAVA_TOOL_OPTIONS` is not seen and only causes a needless
  preload.
- **The process's working directory is the temporary directory**, and the JVM's
  cannot be changed once it runs. Enso therefore resolves against the context's
  working directory (the project's parent), not the process's, wherever it can:
  `File_Helpers.get_file` (every relative local `File`, made absolute in a
  standby engine), `File.current_directory`, and `Process.run` without a
  directory (`System.create_process`). The builtin
  `System.working_directory_override` answers the context's directory only when
  the `enso.context.workingDirectory` property is set, never by comparing paths.
  Known differences from a normal engine: a relative `File` shows its absolute
  path; Java code handed a raw relative string (user code through
  `polyglot java import`) resolves it against the temporary directory; and
  `File.resolve_local_file` sees a relative path as absolute, so it skips the
  cloud-project branch (never reached in the local-only IDE). Any new engine or
  std-bits code that resolves a path against the process (`user.dir`, `Path.of`
  of a relative string, a `ProcessBuilder` without a directory) must go through
  the context's working directory instead.
- Tests: `StandbyRequestTest`, `StandbyTest`, `StandbyPreloaderTest`,
  `ContextWorkingDirectoryTest` (runtime-integration-tests), and
  `StandbyProcessTest`, which needs `built-distribution/` and is skipped without
  it.
```

Run Prettier on it from the worktree:
`node /c/Repos/Enso/ide/node_modules/prettier/bin/prettier.cjs --write engine/runner/CLAUDE.md`.

- [ ] **Step 3: Run the formatting and the whole runner suite (WSL)**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/jvm-standby && git pull --ff-only /mnt/c/Repos/Enso/ide jvm-warm-engine-1-standby && export ENSO_DATA_DIRECTORY=$HOME/standby-data && sbt -Dsbt.server.forcestart=true "javafmtCheckAll; scalafmtCheckAll" "engine-runner/test" "engine-common/test" "language-server/testOnly org.enso.languageserver.boot.config.ApplicationConfigTest" "runtime-integration-tests/testOnly org.enso.interpreter.test.WorkingDirectoryCheckTest org.enso.interpreter.test.ContextWorkingDirectoryTest"'
```

Expected: all PASS. Then build the native launcher on Windows once
(`sbt -Dsbt.server.forcestart=true "engine-runner/buildNativeImage"` from the
worktree) to confirm the new runner classes and the `typesafe.config`
requirement do not break the image. Run `bin\enso --standby` on it: it must
print `--standby runs only on the JVM: add --jvm.` and exit 1.

- [ ] **Step 4: Commit and open PR 1**

```bash
git add engine/runner/CLAUDE.md
git commit -m "Runner: document the standby mode (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
git push -u origin jvm-warm-engine-1-standby
```

Write the body to `<scratch>/pr1-body.md`. It says what the PR adds (the
`--standby` mode, the working directory through the context,
`ProcessEnvironment`, `ApplicationConfig`'s fresh system properties, the
generated preload list). It lists decisions 1, 2, 3, 5 and 6 of this plan, gives
the Task 9 Step 1 counts, and says the mode is invisible until PR 2 passes
`--standby`. It lists Task 2's known differences of a spare-served project (a
relative `File` shows its absolute path; Java code handed a raw relative string
resolves it against the temporary directory). It also says what was not
verified: `gatherLicenses` and `bloopInstall` (untouched), and the native image
beyond `--standby`'s refusal. It ends with `Refs #518` and the generated-with
lines. Then:

```bash
gh pr create --base develop --head jvm-warm-engine-1-standby --title "Engine: a standby mode for a warm spare engine (#518)" --label "CI: No changelog needed" --body-file <scratch>/pr1-body.md
```

Wait for CI. Fix failures this PR caused (check develop's history for the same
failure before blaming it). Do not merge: the owner merges PR 1 on green after
review.

---

# Part 2 — The project service's spare engine and the setting (PR 2)

Start once PR 1 is merged:

```bash
git -C /c/Repos/Enso/ide fetch origin develop
git -C /c/Repos/Enso/ide worktree add -b jvm-warm-engine-2-spare /c/Repos/Enso/ide/.claude/worktrees/jvm-spare origin/develop
```

Run `corepack pnpm install` in the worktree first. Commands below run from
`/c/Repos/Enso/ide/.claude/worktrees/jvm-spare`.

### Task 10: `SpareEngine`

**Files:**

- Create: `app/project-manager-shim/src/projectService/spareEngine.ts`
- Create:
  `app/project-manager-shim/src/projectService/__tests__/fakeSpareEngine.ts`
- Modify: `app/project-manager-shim/src/projectService/__tests__/testPorts.ts`
- Test:
  `app/project-manager-shim/src/projectService/__tests__/spareEngine.test.ts`

**Interfaces:**

- Produces (`spareEngine.ts`):
  - `LINE_VARIABLES: ReadonlySet<string>`
  - `interface SpawnKeyInputs { mode: EngineMode; args: readonly string[]; jvmOptions: readonly string[]; env: Readonly<Record<string, string>> }`
  - `spawnKey(inputs: SpawnKeyInputs): string` (64 hex digits)
  - `standbyLine(args: readonly string[], env: Readonly<Record<string, string>>): string`
    (JSON plus `\n`)
  - `interface SpareSpawn { key: string; command: string; args: readonly string[]; env: NodeJS.ProcessEnv }`
  - `interface TakenSpare { child: ChildProcess; startedAt: number; readyAfterMs: number | undefined }`
  - `type TakeResult = { kind: 'taken'; spare: TakenSpare } | { kind: 'none'; reason: string }`
  - `type SpareState = 'none' | 'warming' | 'ready'`
  - `spareNotice(result: TakeResult, now: number): string`
  - `class SpareEngine` with `constructor(options?: SpareEngineOptions)`,
    `state: SpareState`, `pid: number | undefined`,
    `start(spawn: SpareSpawn): void`, `take(key: string): TakeResult`,
    `stop(reason: string): void`, `clearFailure(): void`
- Produces (tests): `fakeSpareEnso(directory: string): Promise<Path>`,
  `spareEvents(log: string): Promise<SpareEvent[]>`,
  `isAlive(pid: number): boolean`, `SPARE_OPEN_PORT`.

- [ ] **Step 1: Add a port band**

Only `spareOpen.test.ts` starts engines on ports (`spareEngine.test.ts`'s fake
spares listen on none). The ten 2,000-wide bands fill 9,000 to 29,000, so the
eleventh goes below them: 7,000 to 8,000, half a band wide, which stays clear of
Vite's 5173 and the common 8080. Add at the end of `testPorts.ts`:

```ts
/**
 * `spareOpen.test.ts`: below the first band, half a band wide (7,000 to 8,000), clear of Vite's
 * 5173 and of 8080.
 */
export const SPARE_OPEN_PORT = 7_000 + crypto.randomInt(1_000 - BAND_HEADROOM);
```

In `app/project-manager-shim/CLAUDE.md` ("Tests that start engines"), change
"The bands are 2,000 ports wide and ten of them end at 29,000; an eleventh needs
the first band's start lowered." to "The bands are 2,000 ports wide and ten of
them end at 29,000; an eleventh, `spareOpen.test.ts`'s, is 7,000 to 8,000 (clear
of 5173 and 8080). Another needs the first band's start lowered, or a gap found
the same way."

- [ ] **Step 2: Write the fake engine**

`__tests__/fakeSpareEngine.ts`:

```ts
/**
 * @file A fake `enso` for the spare-engine tests. Without `--standby` it is an engine as in the
 * other tests: it records its arguments in `<project>.spawned.json`, answers the health check on
 * `--rpc-port` and exits on a stdin line. With `--standby` it appends `start` to `SPARE_LOG`
 * (exiting with 3 at once when `SPARE_DIES=1`), prints `STANDBY READY 42` after `READY_DELAY_MS`,
 * reads one line, records it in `<project>.line.json` and becomes such an engine; stdin closing
 * first appends `stdin-closed` and exits with 0, as the real one does.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Path } from "../types.js";

const FAKE_SPARE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const spawnArgs = process.argv.slice(2)
const log = process.env.SPARE_LOG
const event = (data) => log && fs.appendFileSync(log, JSON.stringify({ ...data, pid: process.pid }) + '\\n')
function serve(args) {
  const value = (flag) => args[args.indexOf(flag) + 1]
  http.createServer((_q, r) => r.end('OK')).listen(Number(value('--rpc-port')), '127.0.0.1')
  process.stdin.on('data', () => setTimeout(() => process.exit(0), Number(process.env.EXIT_DELAY_MS ?? '0')))
}
if (!spawnArgs.includes('--standby')) {
  const value = (flag) => spawnArgs[spawnArgs.indexOf(flag) + 1]
  fs.writeFileSync(value('--path') + '.spawned.json', JSON.stringify({ args: spawnArgs, pid: process.pid }))
  serve(spawnArgs)
} else {
  event({ event: 'start', args: spawnArgs, cwd: process.cwd(), jvmOptions: process.env.ENSO_JVM_OPTIONS ?? null })
  if (process.env.SPARE_DIES === '1') process.exit(3)
  setTimeout(() => process.stderr.write('STANDBY READY 42\\n'), Number(process.env.READY_DELAY_MS ?? '0'))
  let buffered = ''
  const onData = (chunk) => {
    buffered += chunk.toString()
    const newline = buffered.indexOf('\\n')
    if (newline < 0) return
    process.stdin.off('data', onData)
    const line = JSON.parse(buffered.slice(0, newline))
    const value = (flag) => line.args[line.args.indexOf(flag) + 1]
    fs.writeFileSync(value('--path') + '.line.json', JSON.stringify({ ...line, pid: process.pid, spawnArgs }))
    event({ event: 'taken' })
    serve(line.args)
  }
  process.stdin.on('data', onData)
  process.stdin.on('end', () => {
    event({ event: 'stdin-closed' })
    process.exit(0)
  })
}
`;

/** One line of `SPARE_LOG`. */
export interface SpareEvent {
  readonly event: "start" | "taken" | "stdin-closed";
  readonly pid: number;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly jvmOptions?: string | null;
}

/** Write the fake executable: a `.bat` on Windows (as the runner expects), a script elsewhere. */
export async function fakeSpareEnso(directory: string): Promise<Path> {
  const script = path.join(directory, "fake-enso.mjs");
  await fs.writeFile(script, FAKE_SPARE_ENSO);
  if (process.platform === "win32") {
    const launcher = path.join(directory, "enso.bat");
    await fs.writeFile(launcher, `@"${process.execPath}" "${script}" %*\r\n`);
    return Path(launcher);
  }
  const launcher = path.join(directory, "enso");
  await fs.writeFile(
    launcher,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
  );
  await fs.chmod(launcher, 0o755);
  return Path(launcher);
}

/** The events of `SPARE_LOG`, oldest first; none when it does not exist yet. */
export async function spareEvents(log: string): Promise<SpareEvent[]> {
  try {
    const text = await fs.readFile(log, "utf8");
    return text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as SpareEvent);
  } catch {
    return [];
  }
}

/** Whether a process with `pid` exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
```

- [ ] **Step 3: Write the failing test**

`__tests__/spareEngine.test.ts`:

```ts
/** @file `SpareEngine` with a fake `enso`: start, ready, take, stop, failure, and the line. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  SpareEngine,
  spawnKey,
  spareNotice,
  standbyLine,
  type SpareSpawn,
} from "../spareEngine.js";
import { fakeSpareEnso, isAlive, spareEvents } from "./fakeSpareEngine.js";

let root: string;
let log: string;
const engines: SpareEngine[] = [];

async function spawnOf(
  key: string,
  env: Record<string, string> = {},
): Promise<SpareSpawn> {
  const launcher = await fakeSpareEnso(root);
  const args = ["--jvm", "--standby", "--log-level", "info"];
  const [command, commandArgs] = launcher.endsWith(".bat")
    ? ["cmd.exe", ["/c", launcher, ...args]]
    : [launcher, args];
  return {
    key,
    command,
    args: commandArgs,
    env: { ...process.env, SPARE_LOG: log, ...env },
  };
}

function spare(): SpareEngine {
  const created = new SpareEngine({ log: () => {} });
  engines.push(created);
  return created;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spare-engine-"));
  log = path.join(root, "spare.log");
});

afterEach(async () => {
  for (const created of engines.splice(0)) created.stop("test over");
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});

test("the key is stable, and changes with any input", () => {
  const inputs = {
    mode: "jvm" as const,
    args: ["--log-level", "info"],
    jvmOptions: [],
    env: { A: "1", B: "2" },
  };
  expect(spawnKey(inputs)).toMatch(/^[0-9a-f]{64}$/);
  expect(spawnKey({ ...inputs, env: { B: "2", A: "1" } })).toBe(
    spawnKey(inputs),
  );
  expect(spawnKey({ ...inputs, args: ["--log-level", "trace"] })).not.toBe(
    spawnKey(inputs),
  );
  expect(spawnKey({ ...inputs, jvmOptions: ["-XX:AOTCache=a"] })).not.toBe(
    spawnKey(inputs),
  );
  expect(spawnKey({ ...inputs, env: { A: "1", B: "3" } })).not.toBe(
    spawnKey(inputs),
  );
});

test("the line is one line of JSON", () => {
  const line = standbyLine(["--path", 'C:\\A "B"'], {
    ENSO_LOCAL_PROJECT_ID: "k",
  });
  expect(line.endsWith("\n")).toBe(true);
  expect(line.slice(0, -1)).not.toContain("\n");
  expect(JSON.parse(line)).toEqual({
    args: ["--path", 'C:\\A "B"'],
    env: { ENSO_LOCAL_PROJECT_ID: "k" },
  });
});

test("a spare starts in the temporary directory, warms up, and is taken by its key", async () => {
  const engine = spare();
  engine.start(await spawnOf("k1"));
  expect(engine.state).toBe("warming");
  await vi.waitFor(() => expect(engine.state).toBe("ready"), {
    timeout: 10_000,
  });
  const [start] = await spareEvents(log);
  expect(start?.args).toEqual(["--jvm", "--standby", "--log-level", "info"]);
  expect(await fs.realpath(start!.cwd!)).toBe(await fs.realpath(os.tmpdir()));
  const result = engine.take("k1");
  expect(result.kind).toBe("taken");
  expect(engine.state).toBe("none");
  if (result.kind === "taken") {
    expect(result.spare.readyAfterMs).toBeGreaterThanOrEqual(0);
    expect(spareNotice(result, result.spare.startedAt + 3000)).toMatch(
      /pre-started spare used/,
    );
    result.spare.child.stdin?.end();
  }
});

test("a spare with another key is stopped, not taken", async () => {
  const engine = spare();
  engine.start(await spawnOf("k1"));
  await vi.waitFor(() => expect(engine.state).toBe("ready"), {
    timeout: 10_000,
  });
  const pid = engine.pid!;
  const result = engine.take("k2");
  expect(result).toEqual({
    kind: "none",
    reason: "the spare was started with other settings",
  });
  expect(spareNotice(result, Date.now())).toBe(
    "Engine: no pre-started spare (the spare was started with other settings)",
  );
  await vi.waitFor(
    () =>
      expect(
        (async () =>
          (await spareEvents(log)).some((e) => e.event === "stdin-closed") ||
          !isAlive(pid))(),
      ).resolves.toBe(true),
    { timeout: 10_000 },
  );
  expect(engine.state).toBe("none");
});

test("starting again with the same key keeps the running spare; a new key replaces it", async () => {
  const engine = spare();
  engine.start(await spawnOf("k1"));
  const first = engine.pid;
  engine.start(await spawnOf("k1"));
  expect(engine.pid).toBe(first);
  engine.start(await spawnOf("k2"));
  expect(engine.pid).not.toBe(first);
  await vi.waitFor(
    async () =>
      expect(
        (await spareEvents(log)).filter((e) => e.event === "start"),
      ).toHaveLength(2),
    { timeout: 10_000 },
  );
});

test("a spare that dies is dropped and not started again until the failure is cleared", async () => {
  const engine = spare();
  engine.start(await spawnOf("k1", { SPARE_DIES: "1" }));
  await vi.waitFor(() => expect(engine.state).toBe("none"), {
    timeout: 10_000,
  });
  expect(engine.take("k1")).toEqual({
    kind: "none",
    reason: "the last spare failed",
  });
  engine.start(await spawnOf("k1", { SPARE_DIES: "1" }));
  expect(engine.state).toBe("none");
  expect(
    (await spareEvents(log)).filter((e) => e.event === "start"),
  ).toHaveLength(1);
  engine.clearFailure();
  engine.start(await spawnOf("k1"));
  expect(engine.state).toBe("warming");
});

test("stop closes the spare", async () => {
  const engine = spare();
  engine.start(await spawnOf("k1"));
  await vi.waitFor(() => expect(engine.state).toBe("ready"), {
    timeout: 10_000,
  });
  const pid = engine.pid!;
  engine.stop("quitting");
  expect(engine.state).toBe("none");
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 });
});
```

- [ ] **Step 4: Run it to see it fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareEngine.test.ts`
Expected: FAIL, `Failed to resolve import "../spareEngine.js"`.

- [ ] **Step 5: Implement `spareEngine.ts`**

```ts
/**
 * @file The spare engine (spec `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`): a
 * JVM engine started with `--standby` while no project is open. It warms up, prints
 * `STANDBY READY <ms>` on stderr, and waits for one line on stdin, the arguments `project/open`
 * would have passed it (engine/runner CLAUDE.md, "Standby mode"); from then on it is an ordinary
 * engine. `EnsoRunner` owns one `SpareEngine` and hands its process to an open; `ProjectService`
 * decides when one is wanted.
 */
import * as childProcess from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as os from "node:os";
import type { EngineMode } from "./engineMode.js";

/**
 * The variables of one open: written on the spare's line, never part of its spawn key. The engine
 * accepts exactly these (`StandbyRequest` in engine/runner).
 */
export const LINE_VARIABLES: ReadonlySet<string> = new Set([
  "LANGUAGE_SERVER_CHANNEL_TOKEN",
  "LANGUAGE_SERVER_YDOC_PORT",
  "ENSO_LOCAL_PROJECT_ID",
  "ENSO_LOCAL_PROJECT_SESSION_ID",
]);

/** The engine's `STANDBY READY <ms from its process start>` line. */
const STANDBY_READY = /STANDBY READY (-?\d+)/;
/** How much of a spare's stderr is kept to find the ready line in. */
const STDERR_TAIL_LENGTH = 4096;

/** What a spare is started with, beyond the executable: an open must start with the same. */
export interface SpawnKeyInputs {
  readonly mode: EngineMode;
  readonly args: readonly string[];
  readonly jvmOptions: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The spawn key: a hash, so the secrets key in `env` is neither kept nor logged as it is. The
 * environment is sorted, so its order does not matter.
 */
export function spawnKey(inputs: SpawnKeyInputs): string {
  const env = Object.entries(inputs.env).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([inputs.mode, inputs.args, inputs.jvmOptions, env]))
    .digest("hex");
}

/** The argument line: `{"args":[...],"env":{...}}` and a newline. */
export function standbyLine(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): string {
  return `${JSON.stringify({ args, env })}\n`;
}

/** How to start a spare: the command line already resolved (a `.bat` through `cmd.exe`). */
export interface SpareSpawn {
  readonly key: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** A spare handed to an open. */
export interface TakenSpare {
  readonly child: ChildProcess;
  readonly startedAt: number;
  /** `undefined` while it was still warming up. */
  readonly readyAfterMs: number | undefined;
}

export type TakeResult =
  | { readonly kind: "taken"; readonly spare: TakenSpare }
  | { readonly kind: "none"; readonly reason: string };

export type SpareState = "none" | "warming" | "ready";

/** The engine log's line about an open's spare, so a slow open can be traced to it. */
export function spareNotice(result: TakeResult, now: number): string {
  if (result.kind === "none")
    return `Engine: no pre-started spare (${result.reason})`;
  const age = ((now - result.spare.startedAt) / 1000).toFixed(1);
  const ready =
    result.spare.readyAfterMs == null
      ? "still warming up"
      : `ready after ${(result.spare.readyAfterMs / 1000).toFixed(1)} s`;
  return `Engine: pre-started spare used (started ${age} s before the open, ${ready})`;
}

export interface SpareEngineOptions {
  /** Where a spare's stderr goes besides the ready check: the runner's echo to its own stderr. */
  readonly echo?: (chunk: Buffer) => void;
  /** `Spare engine: …` lines; `console.info` by default. */
  readonly log?: (message: string) => void;
  readonly now?: () => number;
}

interface Running {
  readonly child: ChildProcess;
  readonly key: string;
  readonly startedAt: number;
  readyAfterMs: number | undefined;
  readonly onStderr: (chunk: Buffer) => void;
  readonly onExit: () => void;
}

/** At most one spare engine. */
export class SpareEngine {
  private running: Running | undefined;
  /** The key of the last spare that failed: not started again until {@link clearFailure}. */
  private failedKey: string | undefined;
  private readonly echo: (chunk: Buffer) => void;
  private readonly log: (message: string) => void;
  private readonly now: () => number;

  constructor(options: SpareEngineOptions = {}) {
    this.echo = options.echo ?? (() => {});
    this.log =
      options.log ?? ((message) => console.info(`Spare engine: ${message}`));
    this.now = options.now ?? Date.now;
  }

  get state(): SpareState {
    const running = this.running;
    if (running == null) return "none";
    return running.readyAfterMs == null ? "warming" : "ready";
  }

  get pid(): number | undefined {
    return this.running?.child.pid;
  }

  /**
   * Start a spare, unless one with the same key runs. One with another key is stopped first. No
   * spare is started for a key whose last spare failed (spec: no retry loop).
   */
  start(spawn: SpareSpawn): void {
    const current = this.running;
    if (current?.key === spawn.key) return;
    if (current != null) this.stop("its settings changed");
    if (this.failedKey === spawn.key) {
      this.log(
        "not started: the last one with these settings failed; the next close tries again",
      );
      return;
    }
    this.failedKey = undefined;
    let child: ChildProcess;
    try {
      child = childProcess.spawn(spawn.command, [...spawn.args], {
        env: spawn.env,
        cwd: os.tmpdir(),
        stdio: ["pipe", "inherit", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.failedKey = spawn.key;
      this.log(`could not be started: ${String(error)}`);
      return;
    }
    const startedAt = this.now();
    // A write to an exited child fails asynchronously (project-manager-shim CLAUDE.md, "Child
    // processes"); the open that takes it attaches its own listener as well.
    child.stdin?.on("error", () => {});
    let tail = "";
    const running: Running = {
      child,
      key: spawn.key,
      startedAt,
      readyAfterMs: undefined,
      onStderr: (chunk: Buffer) => {
        this.echo(chunk);
        if (running.readyAfterMs != null) return;
        tail = (tail + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
        const match = STANDBY_READY.exec(tail);
        if (match == null) return;
        running.readyAfterMs = this.now() - startedAt;
        this.log(
          `ready after ${running.readyAfterMs} ms (${match[1]} ms from its own start)`,
        );
      },
      onExit: () => {
        if (this.running !== running) return;
        this.running = undefined;
        this.failedKey = spawn.key;
        this.log("exited before it was used; dropped until the next close");
      },
    };
    child.stderr?.on("data", running.onStderr);
    child.once("exit", running.onExit);
    child.once("error", running.onExit);
    this.running = running;
    this.log(`started (pid ${child.pid})`);
  }

  /**
   * Hand the spare to an open that would start an engine with `key`. One with another key is
   * stopped. A taken spare's stderr is no longer read here: the open attaches its own reader in the
   * same turn of the event loop (`OpenedProject.captureStderr`), so no chunk is lost.
   */
  take(key: string): TakeResult {
    const running = this.running;
    if (running == null) {
      return {
        kind: "none",
        reason:
          this.failedKey != null
            ? "the last spare failed"
            : "no spare was running",
      };
    }
    if (running.child.exitCode != null || running.child.signalCode != null) {
      this.running = undefined;
      this.detach(running);
      return { kind: "none", reason: "the spare had exited" };
    }
    if (running.key !== key) {
      this.stop("the open needs other settings");
      return {
        kind: "none",
        reason: "the spare was started with other settings",
      };
    }
    this.running = undefined;
    this.detach(running);
    this.log(
      `used (pid ${running.child.pid}, ${running.readyAfterMs == null ? "still warming up" : `ready after ${running.readyAfterMs} ms`})`,
    );
    return {
      kind: "taken",
      spare: {
        child: running.child,
        startedAt: running.startedAt,
        readyAfterMs: running.readyAfterMs,
      },
    };
  }

  /** Stop the spare, if any: its stdin closes (it exits by itself) and it is killed. */
  stop(reason: string): void {
    const running = this.running;
    if (running == null) return;
    this.running = undefined;
    this.detach(running);
    // Read to the end, so a full pipe never holds up its exit.
    running.child.stderr?.resume();
    this.log(`stopped: ${reason}`);
    running.child.stdin?.end();
    running.child.kill();
  }

  /** No project is open again: a key whose spare failed may be tried once more. */
  clearFailure(): void {
    this.failedKey = undefined;
  }

  private detach(running: Running): void {
    running.child.stderr?.off("data", running.onStderr);
    running.child.off("exit", running.onExit);
    running.child.off("error", running.onExit);
  }
}
```

- [ ] **Step 6: Run the test to see it pass**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareEngine.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/project-manager-shim/src/projectService/spareEngine.ts app/project-manager-shim/src/projectService/__tests__/fakeSpareEngine.ts app/project-manager-shim/src/projectService/__tests__/spareEngine.test.ts app/project-manager-shim/src/projectService/__tests__/testPorts.ts app/project-manager-shim/CLAUDE.md
git commit -m "Project service: the spare engine manager (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 11: `EnsoRunner` takes the spare

**Files:**

- Modify: `app/project-manager-shim/src/projectService/ensoRunner.ts` (`Runner`,
  `EngineLogSink`, `EngineLaunch`, `EnsoRunner`)
- Test:
  `app/project-manager-shim/src/projectService/__tests__/spareOpen.test.ts`

**Interfaces:**

- Consumes: `SpareEngine`, `LINE_VARIABLES`, `standbyLine`, `spareNotice`,
  `TakeResult` (Task 10).
- Produces:
  - `EngineLaunch.spareKey?: string`
  - `EngineLogSink.notice?(text: string): void`
  - `interface SpareRequest { key: string; extraArgs: readonly string[]; extraEnv: readonly (readonly [string, string])[]; launch: EngineLaunch }`
  - On `Runner` (all optional): `startSpare?(request: SpareRequest): void`,
    `stopSpare?(reason: string): Promise<void>`, `spareAvailableAgain?(): void`,
    `hasProjectsInUse?(): Promise<boolean>`
  - On `EnsoRunner`: the same four, plus `get spareState(): SpareState` and
    `get sparePid(): number | undefined`

- [ ] **Step 1: Write the failing test**

`__tests__/spareOpen.test.ts`:

```ts
/**
 * @file An open takes a spare whose key matches and writes it the line; a key that differs means an
 * ordinary spawn; a crash after the take respawns an ordinary engine. The engine is
 * `fakeSpareEngine.ts`.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  EnsoRunner,
  type EngineLaunch,
  type EngineLogSink,
} from "../ensoRunner.js";
import { ENGINE_TIMEOUTS } from "../timeouts.js";
import { Path } from "../types.js";
import { fakeSpareEnso, isAlive, spareEvents } from "./fakeSpareEngine.js";
import { SPARE_OPEN_PORT } from "./testPorts.js";

let root: string;
let log: string;
let runner: EnsoRunner;

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

const jvm = (spareKey?: string): EngineLaunch => ({
  mode: { mode: "jvm", source: "option" },
  timeouts: { ...ENGINE_TIMEOUTS.jvm, ydocWaitMs: 0 },
  ...(spareKey != null ? { spareKey } : {}),
});

function sink(): EngineLogSink & { notices: string[] } {
  const notices: string[] = [];
  return {
    notices,
    engineStarted: () => {},
    engineStderr: () => {},
    projectClosed: () => {},
    notice: (text) => void notices.push(text),
  };
}

async function readySpare(key: string) {
  runner.startSpare({
    key,
    extraArgs: ["--log-level", "info"],
    extraEnv: [["ENSO_SECRETS_KEY", "secret"]],
    launch: jvm(),
  });
  await vi.waitFor(() => expect(runner.spareState).toBe("ready"), {
    timeout: 10_000,
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spare-open-"));
  log = path.join(root, "spare.log");
  vi.stubEnv("SPARE_LOG", log);
  runner = new EnsoRunner(await fakeSpareEnso(root), {
    firstPort: SPARE_OPEN_PORT,
  });
});

afterEach(async () => {
  await runner.stopSpare("test over");
  vi.unstubAllEnvs();
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});

test("an open takes a matching spare and writes it the line", async () => {
  await readySpare("k1");
  const project = path.join(root, "P");
  const logSink = sink();
  const sockets = await runner.openProject(
    Path(project),
    "id-p",
    ["--log-level", "info", "--vm.D", "enso.Sql.Logger.level=debug"],
    [
      ["ENSO_LOCAL_PROJECT_ID", "key-1"],
      ["ENSO_LOCAL_PROJECT_SESSION_ID", "session-1"],
      ["ENSO_SECRETS_KEY", "secret"],
    ],
    logSink,
    jvm("k1"),
  );
  expect(await exists(`${project}.spawned.json`)).toBe(false);
  const line = JSON.parse(await fs.readFile(`${project}.line.json`, "utf8"));
  expect(line.spawnArgs).toEqual(["--jvm", "--standby", "--log-level", "info"]);
  expect(line.args.slice(0, 2)).toEqual(["--jvm", "--server"]);
  expect(line.args).toContain("--vm.D");
  expect(line.args[line.args.indexOf("--rpc-port") + 1]).toBe(
    String(sockets.jsonSocket.port),
  );
  expect(line.env.LANGUAGE_SERVER_CHANNEL_TOKEN).toMatch(/^[0-9a-f]{64}$/);
  expect(line.env.ENSO_LOCAL_PROJECT_ID).toBe("key-1");
  expect(line.env.ENSO_LOCAL_PROJECT_SESSION_ID).toBe("session-1");
  expect(line.env.LANGUAGE_SERVER_YDOC_PORT).toBe(
    String(sockets.ydocSocket.port),
  );
  expect(line.env).not.toHaveProperty("ENSO_SECRETS_KEY");
  expect(logSink.notices).toEqual([
    expect.stringMatching(/^Engine: pre-started spare used/),
  ]);
  expect(runner.spareState).toBe("none");
  await runner.closeProject(Path(project));
});

test("a spare with another key is stopped and the open spawns as today", async () => {
  await readySpare("k1");
  const pid = runner.sparePid!;
  const project = path.join(root, "Q");
  const logSink = sink();
  await runner.openProject(
    Path(project),
    "id-q",
    undefined,
    undefined,
    logSink,
    jvm("k2"),
  );
  expect(await exists(`${project}.spawned.json`)).toBe(true);
  expect(logSink.notices).toEqual([
    "Engine: no pre-started spare (the spare was started with other settings)",
  ]);
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 });
  await runner.closeProject(Path(project));
});

test("an open without a key leaves the spare alone and says nothing about it", async () => {
  await readySpare("k1");
  const project = path.join(root, "N");
  const logSink = sink();
  await runner.openProject(
    Path(project),
    "id-n",
    undefined,
    undefined,
    logSink,
    jvm(),
  );
  expect(await exists(`${project}.spawned.json`)).toBe(true);
  expect(logSink.notices).toEqual([]);
  expect(runner.spareState).toBe("ready");
  await runner.closeProject(Path(project));
});

test("a crash after the take respawns an ordinary engine", async () => {
  await readySpare("k1");
  const project = path.join(root, "R");
  await runner.openProject(
    Path(project),
    "id-r",
    undefined,
    undefined,
    undefined,
    jvm("k1"),
  );
  const { pid } = JSON.parse(await fs.readFile(`${project}.line.json`, "utf8"));
  process.kill(pid, "SIGKILL");
  await vi.waitFor(
    async () => expect(await exists(`${project}.spawned.json`)).toBe(true),
    {
      timeout: 20_000,
    },
  );
  expect(
    (await spareEvents(log)).filter((e) => e.event === "start"),
  ).toHaveLength(1);
  await runner.closeProject(Path(project));
}, 30_000);

test("a closing project is no longer in use", async () => {
  const project = path.join(root, "C");
  vi.stubEnv("EXIT_DELAY_MS", "1500");
  await runner.openProject(
    Path(project),
    "id-c",
    undefined,
    undefined,
    undefined,
    jvm(),
  );
  expect(await runner.hasProjectsInUse()).toBe(true);
  const closing = runner.closeProject(Path(project));
  await vi.waitFor(async () =>
    expect(await runner.hasProjectsInUse()).toBe(false),
  );
  expect(await runner.hasRunningProjects()).toBe(true);
  await closing;
});
```

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareOpen.test.ts`
Expected: FAIL, `runner.startSpare is not a function`.

- [ ] **Step 3: Implement**

In `ensoRunner.ts`, extend the imports:

```ts
import {
  LINE_VARIABLES,
  SpareEngine,
  spareNotice,
  standbyLine,
  type SpareState,
  type TakeResult,
} from "./spareEngine.js";
```

Add to `interface Runner`, after `hasRunningProjects(): Promise<boolean>`:

```ts
  /** Start a spare engine for `request`, unless one with its key runs (`spareEngine.ts`). */
  startSpare?(request: SpareRequest): void
  /** Stop the spare engine, if any. */
  stopSpare?(reason: string): Promise<void>
  /** No project is open again: a spare whose start failed may be tried once more. */
  spareAvailableAgain?(): void
  /** Whether a project is open or opening, not counting one whose close has begun. */
  hasProjectsInUse?(): Promise<boolean>
```

Add to `interface EngineLogSink`:

```ts
  /** A line of the shim's own for the log (`EngineLogChannel.notice`), such as the spare's use. */
  notice?(text: string): void
```

Add to `interface EngineLaunch`:

```ts
  /**
   * The spawn key of a JVM open (`spawnKey` in `spareEngine.ts`): the open takes a spare started
   * with the same key. Without one no spare is taken.
   */
  readonly spareKey?: string
```

Add after `interface EngineLaunch`:

```ts
/** What a spare is started with: the launch an open would have, without the open's own parts. */
export interface SpareRequest {
  readonly key: string;
  readonly extraArgs: readonly string[];
  readonly extraEnv: readonly (readonly [string, string])[];
  readonly launch: EngineLaunch;
}
```

In `class EnsoRunner`, after `private activeRuns = 0`:

```ts
  /** Paths whose close has begun: no longer in use, though their engine may still be stopping. */
  private readonly closingProjects = new Set<Path>()
  /** The spare engine (`spareEngine.ts`); its stderr is echoed like an engine's. */
  private readonly spare = new SpareEngine({ echo: echoToStderr })

  /** The spare engine's state, for tests and the service's decisions. */
  get spareState(): SpareState {
    return this.spare.state
  }

  /** The spare engine's process id, for tests. */
  get sparePid(): number | undefined {
    return this.spare.pid
  }

  /** Start a spare engine: `--standby` and the launch's arguments, in the temporary directory. */
  startSpare(request: SpareRequest): void {
    const args = [...modeArgs(request.launch), '--standby', ...request.extraArgs]
    const env = {
      ...process.env,
      ...jvmOptionsEnv(request.launch),
      ...Object.fromEntries(request.extraEnv),
    }
    const [command, commandArgs] = this.resolveCommandAndArgs(args)
    this.spare.start({ key: request.key, command, args: commandArgs, env })
  }

  /** Stop the spare engine, if any. */
  async stopSpare(reason: string): Promise<void> {
    this.spare.stop(reason)
  }

  /** No project is open again: a spare whose start failed may be tried once more. */
  spareAvailableAgain(): void {
    this.spare.clearFailure()
  }

  /** Whether a project is open or opening, not counting one whose close has begun. */
  async hasProjectsInUse(): Promise<boolean> {
    if (this.loadingProjects.size > 0) return true
    return [...this.runningProjects.keys()].some((path) => !this.closingProjects.has(path))
  }
```

In `openProject`, change the declaration of `engineYdocEnv` to give it a type:

```ts
const engineYdocEnv: Record<string, string> = nodeHost
  ? {}
  : {
      LANGUAGE_SERVER_YDOC_PORT: ydocPort.toString(),
      LANGUAGE_SERVER_YDOC_ALLOWED_ORIGINS: (
        this.options.ydocHost?.allowedOrigins?.() ?? []
      ).join(","),
    };
```

Then, right after `const cwd = path.dirname(projectPath)`, insert:

```ts
// A spare engine (`spareEngine.ts`) is taken by the first attempt of an open whose launch
// has its key. The engine cannot take allowed origins on its line (`StandbyRequest` in
// engine/runner), so an engine-hosted ydoc server for a browser page means no spare.
const spareAllowed =
  (engineYdocEnv.LANGUAGE_SERVER_YDOC_ALLOWED_ORIGINS ?? "") === "";
let spareResult: TakeResult | undefined;
if (attempt === 1 && launch?.spareKey != null) {
  if (spareAllowed) {
    spareResult = this.spare.take(launch.spareKey);
  } else {
    this.spare.stop("the ydoc server of this open runs in the engine");
    spareResult = {
      kind: "none",
      reason: "the ydoc server runs in the engine",
    };
  }
  logSink?.notice?.(spareNotice(spareResult, Date.now()));
}
let spareChild =
  spareResult?.kind === "taken" ? spareResult.spare.child : undefined;
const lineEnv: Record<string, string> = {
  LANGUAGE_SERVER_CHANNEL_TOKEN: token,
  ...(engineYdocEnv.LANGUAGE_SERVER_YDOC_PORT != null
    ? { LANGUAGE_SERVER_YDOC_PORT: engineYdocEnv.LANGUAGE_SERVER_YDOC_PORT }
    : {}),
  ...Object.fromEntries(
    (extraEnv ?? []).filter(([name]) => LINE_VARIABLES.has(name)),
  ),
};
```

and replace the spawner passed to `OpenedProject.create`:

```ts
            () => {
              // The first spawn of an open that took a spare is the spare: it gets the line and
              // becomes this open's engine. Every later spawn (a respawn) is an ordinary one.
              const child = spareChild
              spareChild = undefined
              if (child != null) {
                child.stdin?.write(standbyLine(args, lineEnv))
                return Promise.resolve(child)
              }
              return this.runProcess(args, (cmd, cmdArgs) =>
                childProcess.spawn(cmd, cmdArgs, {
                  env,
                  detached: false,
                  cwd,
                  stdio: ['pipe', 'inherit', 'pipe'],
                  windowsHide: true,
                }),
              )
            },
```

In `closeProject`, replace `return runningProject.close()` with:

```ts
this.closingProjects.add(projectPath);
try {
  return await runningProject.close();
} finally {
  this.closingProjects.delete(projectPath);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareOpen.test.ts src/projectService/__tests__/spareEngine.test.ts src/projectService/__tests__/engineLaunch.test.ts src/projectService/__tests__/respawnClose.test.ts src/projectService/__tests__/runningProjects.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/project-manager-shim/src/projectService/ensoRunner.ts app/project-manager-shim/src/projectService/__tests__/spareOpen.test.ts
git commit -m "Project service: an open takes a matching spare engine (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 12: `ProjectService` decides when a spare is wanted

**Files:**

- Modify: `app/project-manager-shim/src/projectService/index.ts`
  (`EngineSettings`, `ProjectService`)
- Test:
  `app/project-manager-shim/src/projectService/__tests__/spareService.test.ts`

**Interfaces:**

- Consumes: `Runner.startSpare`, `stopSpare`, `spareAvailableAgain`,
  `hasProjectsInUse`, `EngineLaunch.spareKey`, `SpareRequest` (Task 11);
  `spawnKey` (Task 10); `resolveDefaultEngineMode` (existing); `ydocHostKind`
  (existing).
- Produces also: `JvmAotCache.isTraining(): boolean`, added in this task's Step
  3 so that the service compiles; Task 14 tests it with the cache's own tests.
- Produces: `SPARE_AFTER_CLOSE_MS = 2000` (exported),
  `EngineSettings.spareAfterCloseMs?: number`,
  `ProjectService.setSpareEngine(enabled: boolean): Promise<{ readonly engineMode: EngineMode }>`,
  `ProjectService.refreshSpare(): Promise<void>`,
  `ProjectService.stopSpareEngine(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`__tests__/spareService.test.ts`:

```ts
/** @file When the service wants a spare engine, with a runner that records what it is asked. */
import { createDeferred } from "enso-common/src/utilities/async";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createProject } from "../../localMetadata/__tests__/testUtils.js";
import type { EngineLaunch, Runner, SpareRequest } from "../ensoRunner.js";
import { ProjectService, type EngineSettings } from "../index.js";
import { Path, UUID } from "../types.js";

let root: string;
let starts: SpareRequest[];
let stops: string[];
let opens: (EngineLaunch | undefined)[];
let inUse: boolean;
let availableAgain: number;
let closing: ReturnType<typeof createDeferred<void>>;
let secretsKey: string;

function fakeRunner(): Runner {
  return {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async (_path, _id, _args, _env, _sink, launch) => {
      opens.push(launch);
      inUse = true;
      return {
        jsonSocket: { host: "127.0.0.1", port: 1 },
        ydocSocket: { host: "127.0.0.1", port: 2 },
      };
    },
    closeProject: async () => {
      inUse = false;
      await closing.promise;
    },
    isProjectRunning: async () => false,
    hasRunningProjects: async () => inUse,
    hasProjectsInUse: async () => inUse,
    renameProject: async () => {},
    registerShutdownHook: async () => {},
    version: async () => "0.0.0",
    startSpare: (request) => void starts.push(request),
    stopSpare: async (reason) => void stops.push(reason),
    spareAvailableAgain: () => void (availableAgain += 1),
  };
}

function service(
  engine: EngineSettings = { option: "jvm" },
  extraArgs: string[] = [],
) {
  return new ProjectService(
    fakeRunner(),
    extraArgs,
    console,
    undefined,
    undefined,
    () => [["ENSO_SECRETS_KEY", secretsKey]],
    engine,
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spare-service-"));
  vi.stubEnv("ENSO_LOG_DIRECTORY", path.join(root, "logs"));
  vi.stubEnv("ENSO_SPARE_ENGINE", "");
  vi.stubEnv("ENSO_YDOC_HOST", "");
  vi.stubEnv("ENSO_ENGINE_MODE", "");
  starts = [];
  stops = [];
  opens = [];
  inUse = false;
  availableAgain = 0;
  closing = createDeferred<void>();
  secretsKey = "key-a";
  await createProject(path.join(root, "P"), "id-1");
});

afterEach(async () => {
  closing.resolve();
  vi.unstubAllEnvs();
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

test("no spare until the GUI reports the setting; then one, and the answer names the engine", async () => {
  const s = service();
  expect(starts).toEqual([]);
  expect(await s.setSpareEngine(true)).toEqual({ engineMode: "jvm" });
  expect(starts).toHaveLength(1);
  expect(starts[0]!.launch.mode.mode).toBe("jvm");
  expect(starts[0]!.extraEnv).toEqual([["ENSO_SECRETS_KEY", "key-a"]]);
});

test("no spare with the native engine, the setting off, ENSO_SPARE_ENGINE=0, the engine ydoc host, or profiling", async () => {
  expect(await service({}).setSpareEngine(true)).toEqual({
    engineMode: "native",
  });
  await service().setSpareEngine(false);
  vi.stubEnv("ENSO_SPARE_ENGINE", "0");
  await service().setSpareEngine(true);
  vi.stubEnv("ENSO_SPARE_ENGINE", "");
  vi.stubEnv("ENSO_YDOC_HOST", "engine");
  await service().setSpareEngine(true);
  vi.stubEnv("ENSO_YDOC_HOST", "");
  await service({ option: "jvm" }, [
    "--profiling-path",
    "profiling.npss",
  ]).setSpareEngine(true);
  expect(starts).toEqual([]);
  expect(stops).toEqual([
    "the engine is native",
    "the setting is off",
    "ENSO_SPARE_ENGINE=0",
    "ENSO_YDOC_HOST=engine",
    "profiling is on",
  ]);
});

test("turning the setting off stops the spare, and on starts one again", async () => {
  const s = service();
  await s.setSpareEngine(true);
  await s.setSpareEngine(false);
  await s.setSpareEngine(true);
  expect(starts).toHaveLength(2);
  expect(stops).toEqual(["the setting is off"]);
});

test("a changed input gives a new key, so the spare is replaced", async () => {
  const s = service();
  await s.setSpareEngine(true);
  secretsKey = "key-b";
  await s.refreshSpare();
  expect(starts).toHaveLength(2);
  expect(starts[1]!.key).not.toBe(starts[0]!.key);
});

test("a JVM open carries the spare's key; a native one stops the spare", async () => {
  const s = service();
  await s.setSpareEngine(true);
  await s.openProject(UUID("id-1"), Path(root));
  expect(opens[0]!.spareKey).toBe(starts[0]!.key);
  closing.resolve();
  await s.closeProject(UUID("id-1"), Path(root));
  const native = service({ option: "native" });
  await native.openProject(UUID("id-1"), Path(root));
  expect(opens[1]!.spareKey).toBeUndefined();
  expect(stops).toContain("a project with the native engine is opening");
});

test("after a close the next spare waits for the old engine or the delay, whichever is first", async () => {
  const s = service({ option: "jvm", spareAfterCloseMs: 100 });
  await s.setSpareEngine(true);
  await s.openProject(UUID("id-1"), Path(root));
  const close = s.closeProject(UUID("id-1"), Path(root));
  // The old engine is still stopping (`closing` unresolved): the delay starts the spare.
  await vi.waitFor(() => expect(starts).toHaveLength(2), { timeout: 2000 });
  expect(availableAgain).toBe(1);
  closing.resolve();
  await close;

  const slow = service({ option: "jvm", spareAfterCloseMs: 60_000 });
  closing = createDeferred<void>();
  await slow.setSpareEngine(true);
  await slow.openProject(UUID("id-1"), Path(root));
  const slowClose = slow.closeProject(UUID("id-1"), Path(root));
  closing.resolve();
  await slowClose;
  // The old engine exited long before the delay: the spare starts at once.
  await vi.waitFor(() => expect(starts).toHaveLength(4), { timeout: 2000 });
});

test("quitting stops the spare and starts no other", async () => {
  const s = service();
  await s.setSpareEngine(true);
  await s.stopSpareEngine();
  await s.setSpareEngine(true);
  expect(starts).toHaveLength(1);
  expect(stops).toEqual(["quitting", "quitting"]);
});

test("no spare while the AOT cache trains; the refresh after it starts one", async () => {
  let training = true;
  // The parts of `JvmAotCache` the service uses, for a first launch whose cache is training.
  const jvmAot = {
    isTraining: () => training,
    jvmOptions: async () => [] as readonly string[],
    openStarted: () => {},
    openAnswered: () => {},
    checkUseLog: async () => {},
  } as unknown as JvmAotCache;
  const s = service({ option: "jvm", jvmAot });
  await s.setSpareEngine(true);
  expect(starts).toEqual([]);
  expect(stops).toEqual(["the AOT cache is training"]);
  training = false;
  // What Electron's `onTrainingEnded` does.
  await s.refreshSpare();
  expect(starts).toHaveLength(1);
});
```

Add `import type { JvmAotCache } from "../../jvmAot/index.js";` to the test's
imports.

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareService.test.ts`
Expected: FAIL, `s.setSpareEngine is not a function`.

- [ ] **Step 3: Implement**

In `index.ts`, extend the imports:

```ts
import {
  describeEngineMode,
  liftJvmFlag,
  resolveDefaultEngineMode,
  resolveEngineMode,
  type EngineMode,
  type EngineModeSettings,
} from "./engineMode.js";
import { spawnKey } from "./spareEngine.js";
import { ydocHostKind, type YdocHost } from "./ydocHost.js";
```

(The existing `import type { YdocHost } from './ydocHost.js'` becomes the line
above.)

In `app/project-manager-shim/src/jvmAot/index.ts`, add to `class JvmAotCache`
after `openAnswered()`:

```ts
  /** Whether a training is starting or running (a launch without a cache): no spare meanwhile. */
  isTraining(): boolean {
    return this.training != null || this.starting != null
  }
```

Add to `interface EngineSettings`:

```ts
  /** How long after a close the next spare engine waits for the closing engine to exit (2 s). */
  readonly spareAfterCloseMs?: number | undefined
```

After the `OpenObserver` interface:

```ts
/**
 * After a close, the next spare engine starts once the closing engine has exited or this long has
 * passed, whichever is first, so the two do not compete for CPU (spec, "After a close").
 */
export const SPARE_AFTER_CLOSE_MS = 2000;
```

In `class ProjectService`, after `readonly engineLogs = new EngineLogHub()`:

```ts
  /** Settings → Local → Engine's "Pre-start the engine"; `undefined` until the GUI sends it. */
  private spareSetting: boolean | undefined
  /** Set on quit: no spare is started again. */
  private spareStopped = false
  /** Spare decisions, one at a time. */
  private spareQueue: Promise<void> = Promise.resolve()

  /**
   * `engine/setSpare`: the GUI's setting. Until the first call no spare is started. The answer says
   * which engine projects get by default, so the GUI shows the setting only for the JVM.
   */
  async setSpareEngine(enabled: boolean): Promise<{ readonly engineMode: EngineMode }> {
    this.spareSetting = enabled
    await this.refreshSpare()
    return { engineMode: resolveDefaultEngineMode(this.engineModeSettings()).mode }
  }

  /** Start the spare engine if one is wanted (`spareEngine.ts`), stop it otherwise. */
  refreshSpare(): Promise<void> {
    this.spareQueue = this.spareQueue
      .then(() => this.refreshSpareNow())
      .catch((error: unknown) => this.logger.error('Failed to update the spare engine:', error))
    return this.spareQueue
  }

  /** Quit: stop the spare engine for good. */
  async stopSpareEngine(): Promise<void> {
    this.spareStopped = true
    await this.refreshSpare()
  }

  private async refreshSpareNow(): Promise<void> {
    const runner = this.runner
    if (runner.startSpare == null || runner.stopSpare == null) return
    const reason = await this.spareUnwantedReason()
    if (reason != null) {
      await runner.stopSpare(reason)
      return
    }
    const mode = resolveDefaultEngineMode(this.engineModeSettings())
    const base = { mode, timeouts: engineTimeouts(mode.mode), ...(await this.aotOptions(mode.mode)) }
    const key = this.spareKeyFor(base)
    runner.startSpare({
      key,
      extraArgs: this.extraArgs,
      extraEnv: this.extraEnvironment?.() ?? [],
      launch: { ...base, spareKey: key },
    })
  }

  /** Why no spare is wanted now; `undefined` when one is. */
  private async spareUnwantedReason(): Promise<string | undefined> {
    if (this.spareStopped) return 'quitting'
    if (this.spareSetting !== true) {
      return this.spareSetting === false ? 'the setting is off' : 'the GUI has not sent the setting'
    }
    if (process.env.ENSO_SPARE_ENGINE === '0') return 'ENSO_SPARE_ENGINE=0'
    if (resolveDefaultEngineMode(this.engineModeSettings()).mode !== 'jvm') {
      return 'the engine is native'
    }
    if (ydocHostKind() !== 'node') return 'ENSO_YDOC_HOST=engine'
    // A first launch trains the AOT cache in the background: a spare would compete with it, and
    // be discarded at the next open for the new cache. `onTrainingEnded` refreshes it.
    if (this.engine?.jvmAot?.isTraining() === true) return 'the AOT cache is training'
    // `--profiling-path` takes a relative path, and a standby engine refuses relative paths.
    if (this.extraArgs.includes('--profiling-path')) return 'profiling is on'
    const inUse =
      this.runner.hasProjectsInUse != null ?
        await this.runner.hasProjectsInUse()
      : await this.runner.hasRunningProjects()
    return inUse ? 'a project is open' : undefined
  }

  /** The spawn key of a JVM engine started now (decision 8 of the plan; `spawnKey`). */
  private spareKeyFor(launch: Pick<EngineLaunch, 'mode' | 'jvmOptions'>): string {
    return spawnKey({
      mode: launch.mode.mode,
      args: this.extraArgs,
      jvmOptions: launch.jvmOptions ?? [],
      env: {
        ...Object.fromEntries(this.extraEnvironment?.() ?? []),
        ENSO_JVM_OPTIONS: process.env.ENSO_JVM_OPTIONS ?? '',
      },
    })
  }

  /** After a close: the next spare, once the closing engine has exited or the delay has passed. */
  private async spareAfterClose(closing: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      closing.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.engine?.spareAfterCloseMs ?? SPARE_AFTER_CLOSE_MS)
      }),
    ])
    clearTimeout(timer)
    this.runner.spareAvailableAgain?.()
    await this.refreshSpare()
  }
```

In `openFoundProject`, replace

```ts
launch = {
  mode,
  timeouts: engineTimeouts(mode.mode),
  ...(await this.aotOptions(mode.mode)),
};
```

with

```ts
launch = {
  mode,
  timeouts: engineTimeouts(mode.mode),
  ...(await this.aotOptions(mode.mode)),
};
if (mode.mode === "jvm") {
  launch = { ...launch, spareKey: this.spareKeyFor(launch) };
} else {
  await this.runner.stopSpare?.("a project with the native engine is opening");
}
```

and in its `catch (error)` block, before `throw error`:

```ts
// The open failed and no project of it is open: a spare may be wanted again.
void this.refreshSpare();
```

In `closeProject`, replace

```ts
    try {
      await this.runner.closeProject(project.path)
    } finally {
```

with

```ts
    const closing = this.runner.closeProject(project.path)
    void this.spareAfterClose(closing)
    try {
      await closing
    } finally {
```

- [ ] **Step 4: Run the tests to see them pass**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareService.test.ts src/projectService/__tests__/engineLogging.test.ts src/projectService/__tests__/lifecycle.test.ts src/projectService/__tests__/jvmAot.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/project-manager-shim/src/projectService/index.ts app/project-manager-shim/src/jvmAot/index.ts app/project-manager-shim/src/projectService/__tests__/spareService.test.ts
git commit -m "Project service: a spare engine while no project is open (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 13: `engine/setSpare` and its clients

**Files:**

- Modify: `app/project-manager-shim/src/handler/projectService.ts` (the
  `switch`, before `default`)
- Test: `app/project-manager-shim/src/handler/__tests__/projectService.test.ts`
- Modify: `app/common/src/services/ProjectManager/types.ts`,
  `ProjectManager.ts`, `app/common/src/services/LocalBackend.ts`
- Test:
  `app/common/src/services/ProjectManager/__tests__/ProjectManager.spareEngine.test.ts`

**Interfaces:**

- Consumes: `ProjectService.setSpareEngine` (Task 12).
- Produces: `POST /api/project-service/engine/setSpare` `{ enabled: boolean }` →
  `{ engineMode }`;
  `interface SpareEngineStatus { readonly engineMode: 'native' | 'jvm' }` in
  `types.ts`;
  `ProjectManager.setSpareEngine(enabled: boolean): Promise<SpareEngineStatus>`;
  `LocalBackend.setSpareEngine(enabled: boolean): Promise<SpareEngineStatus>`.

- [ ] **Step 1: Write the failing tests**

Append to `handler/__tests__/projectService.test.ts`:

```ts
describe("engine/setSpare", () => {
  test("answers which engine projects get", async () => {
    vi.stubEnv("ENSO_ENGINE_MODE", "");
    expect(await call("engine/setSpare", { enabled: true })).toEqual(
      expect.objectContaining({ result: { engineMode: "native" } }),
    );
    vi.unstubAllEnvs();
  });

  test("refuses a body without a boolean", async () => {
    const answer = await call("engine/setSpare", { enabled: "yes" });
    expect(answer.error).toBeDefined();
  });
});
```

`app/common/src/services/ProjectManager/__tests__/ProjectManager.spareEngine.test.ts`:

```ts
/** @file `ProjectManager.setSpareEngine` posts to the shim's `engine/setSpare`. */
import { afterEach, expect, it, vi } from "vitest";
import { ProjectManager } from "../ProjectManager";
import { Path } from "../types";

afterEach(() => vi.unstubAllGlobals());

it("posts the setting and returns the engine mode", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          result: { engineMode: "jvm" },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const pm = new ProjectManager(Path("/root"));
  expect(await pm.setSpareEngine(false)).toEqual({ engineMode: "jvm" });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "/api/project-service/engine/setSpare",
    {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    },
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/handler/__tests__/projectService.test.ts`
and
`corepack pnpm --filter enso-common exec vitest run src/services/ProjectManager/__tests__/ProjectManager.spareEngine.test.ts`
Expected: the handler test FAILS with
`Unknown project service request /api/project-service/engine/setSpare`; the
common test FAILS with `pm.setSpareEngine is not a function`.

- [ ] **Step 3: Implement**

In `handler/projectService.ts`, add before `default: {`:

```ts
    case 'POST /api/project-service/engine/setSpare': {
      interface Body {
        readonly enabled?: unknown
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          if (typeof body.enabled !== 'boolean') {
            throw new Error('engine/setSpare needs a boolean `enabled`')
          }
          const projectService = await getProjectService()
          return projectService.setSpareEngine(body.enabled)
        })
        .then((result) => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(result))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('engine/setSpare failed', err))
        })
      break
    }
```

In `app/common/src/services/ProjectManager/types.ts`, add after `SamplesStatus`:

```ts
/** The project service's answer to `engine/setSpare`: which engine projects get by default. */
export interface SpareEngineStatus {
  readonly engineMode: "native" | "jvm";
}
```

In `ProjectManager.ts`, import `SpareEngineStatus` from `./types` with the other
types, and add after `samplesStatus()`:

```ts
  /**
   * Tell the project service whether to keep a pre-started engine (Settings → Local → Engine). It
   * answers which engine projects get, so the setting shows only for the JVM.
   */
  async setSpareEngine(enabled: boolean): Promise<SpareEngineStatus> {
    return this.runProjectServiceCommand('engine/setSpare', { enabled })
  }
```

In `LocalBackend.ts`, add after `samplesStatus()`:

```ts
  /** Whether the project service keeps a pre-started engine; it answers which engine runs. */
  setSpareEngine(enabled: boolean) {
    return this.projectManager.setSpareEngine(enabled)
  }
```

- [ ] **Step 4: Run them to see them pass**

Run the two commands of Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/project-manager-shim/src/handler/projectService.ts app/project-manager-shim/src/handler/__tests__/projectService.test.ts app/common/src/services/ProjectManager/types.ts app/common/src/services/ProjectManager/ProjectManager.ts app/common/src/services/LocalBackend.ts app/common/src/services/ProjectManager/__tests__/ProjectManager.spareEngine.test.ts
git commit -m "Project service: engine/setSpare (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 14: Electron — quit, the AOT training, and a new secrets key

**Files:**

- Modify: `app/project-manager-shim/src/jvmAot/index.ts` (`JvmAotCacheSettings`,
  the training's handlers)
- Test: `app/project-manager-shim/src/jvmAot/__tests__/cache.test.ts`
- Modify: `app/electron-client/src/secretsKey.ts` (`SecretsActionOptions`,
  `rotateSecretsKey`, `resetSecrets`)
- Test: `app/electron-client/tests/headless/secretsKey.test.ts`
- Modify: `app/electron-client/src/projectService.ts` (`createJvmAotCache`, new
  `stopSpareEngine` and `refreshSpareEngine`)
- Modify: `app/electron-client/src/electron.ts` (the `secrets.rotate` and
  `secrets.reset` handlers)
- Modify: `app/electron-client/src/index.ts` (`before-quit`)

**Interfaces:**

- Consumes: `ProjectService.refreshSpare`, `ProjectService.stopSpareEngine`, and
  `JvmAotCache.isTraining` (all Task 12).
- Produces:
  - `JvmAotCacheSettings.onTrainingEnded?: () => void`, told when a training has
    finished (the cache written) or failed, but not when an open aborted it;
  - `SecretsActionOptions.afterKeyChange?: () => Promise<void>`;
  - `export async function stopSpareEngine(): Promise<void>` and
    `export async function refreshSpareEngine(): Promise<void>` in Electron's
    `projectService.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `jvmAot/__tests__/cache.test.ts`:

```ts
test("a training is reported while it runs, and its end is announced", async () => {
  const trainer = new FakeTrainer();
  const onTrainingEnded = vi.fn();
  const created = cache(trainer, { onTrainingEnded });
  expect(created.isTraining()).toBe(false);
  await created.start();
  expect(created.isTraining()).toBe(true);
  await trainer.runs[0]!.finish();
  await vi.waitFor(() => expect(onTrainingEnded).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(created.isTraining()).toBe(false));
});

test("a failed training is announced too; one an open stopped is not", async () => {
  const failing = new FakeTrainer();
  const failed = vi.fn();
  const first = cache(failing, { onTrainingEnded: failed });
  await first.start();
  failing.runs[0]!.fail();
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());

  const stopped = new FakeTrainer();
  const aborted = vi.fn();
  const second = cache(stopped, { onTrainingEnded: aborted });
  await second.start();
  second.openStarted();
  await vi.waitFor(() => expect(second.isTraining()).toBe(false));
  expect(aborted).not.toHaveBeenCalled();
});
```

In `tests/headless/secretsKey.test.ts`, add inside
`describe('while a project is running', …)`:

```ts
test("a refused rotation or reset leaves the spare engine alone", async () => {
  const afterKeyChange = vi.fn(async () => {});
  const options = {
    keySource,
    store,
    hasRunningProjects: async () => true,
    afterKeyChange,
  };
  await expect(rotateSecretsKey(options)).rejects.toThrow();
  await expect(resetSecrets(options)).rejects.toThrow();
  expect(afterKeyChange).not.toHaveBeenCalled();
});
```

and inside `describe('with no project running', …)`:

```ts
test("a rotation and a reset each refresh the spare engine, which holds the old key", async () => {
  const afterKeyChange = vi.fn(async () => {});
  const options = {
    keySource,
    store,
    hasRunningProjects: async () => false,
    afterKeyChange,
  };
  await rotateSecretsKey(options);
  expect(afterKeyChange).toHaveBeenCalledOnce();
  await resetSecrets(options);
  expect(afterKeyChange).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run them to see them fail**

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/jvmAot/__tests__/cache.test.ts`
and
`corepack pnpm --filter enso exec vitest run tests/headless/secretsKey.test.ts`
Expected: FAIL. `onTrainingEnded` is never called, and `afterKeyChange` is not
called after a rotation (`expected "spy" to be called once, but got 0 times`).

- [ ] **Step 3: Implement**

In `JvmAotCacheSettings`:

```ts
  /**
   * Told when a training has ended, with the cache written or failed, but not when an open stopped
   * it: no spare engine starts while one runs (`isTraining`), so it is refreshed then.
   */
  readonly onTrainingEnded?: () => void
```

In `tryBeginTraining` the callback goes in two places: the success handler,
after the `console.info` of `JDK AOT cache: trained in …`, and the failure
handler's `else` branch, the one that sets `this.wanted = false` after a real
failure. The training must no longer count as running when the callback runs, so
move `this.training = undefined` out of the `.finally` into both places, before
the call:

```ts
this.training = undefined;
this.settings.onTrainingEnded?.();
```

The abort branch sets `this.training = undefined` too, without the call. The
`.finally` keeps releasing the lock.

In `secretsKey.ts`, add to `SecretsActionOptions`:

```ts
  /**
   * After the key changed (or a change failed part way): the spare engine holds the key it was
   * started with, and `hasRunningProjects` does not count it, so it is refreshed.
   */
  readonly afterKeyChange?: () => Promise<void>
```

and change the two actions:

```ts
/** `secrets.rotate`: rotate the key, unless an engine is running. */
export function rotateSecretsKey(options: SecretsActionOptions): Promise<void> {
  return queued(async () => {
    if (await options.hasRunningProjects())
      throw new Error(ROTATE_BLOCKED_BY_PROJECTS);
    try {
      await options.keySource.rotate(options.store);
    } finally {
      await options.afterKeyChange?.();
    }
  });
}

/**
 * `secrets.reset`: delete the file and the key, then create a new key, unless an engine is running
 * or the keychain could not be read.
 */
export function resetSecrets(options: SecretsActionOptions): Promise<void> {
  return queued(async () => {
    if (await options.hasRunningProjects())
      throw new Error(RESET_BLOCKED_BY_PROJECTS);
    // Before the file goes: a keychain that could not be read may hold the right key.
    options.keySource.assertKeychainReadable();
    try {
      await options.store.reset();
      await options.keySource.forget();
      await options.keySource.initialise();
    } finally {
      await options.afterKeyChange?.();
    }
  });
}
```

In Electron's `projectService.ts`, in `createJvmAotCache`'s
`new JvmAotCache({ ... })`, add:

```ts
    // No spare engine starts while the cache trains (`isTraining`); once it has, one is wanted.
    onTrainingEnded: () => void projectService?.refreshSpare(),
```

and after `disposeJvmAotCache`:

```ts
/** Stop the spare engine (quit). It also exits by itself when its stdin closes. */
export async function stopSpareEngine(): Promise<void> {
  await projectService?.stopSpareEngine();
}

/** Start or replace the spare engine for the current settings (a new secrets key). */
export async function refreshSpareEngine(): Promise<void> {
  await projectService?.refreshSpare();
}
```

In `electron.ts`, import `refreshSpareEngine` from `@/projectService` with the
others, and add `afterKeyChange: refreshSpareEngine,` to the options of both
`resetSecrets({ … })` and `rotateSecretsKey({ … })`.

In `app/electron-client/src/index.ts`, import `stopSpareEngine` with
`disposeJvmAotCache`, and change the handler:

```ts
this.electron.app.on("before-quit", () => {
  void disposeJvmAotCache();
  void stopSpareEngine();
});
```

- [ ] **Step 4: Run the tests and the typecheck**

Run the two commands of Step 2, then `corepack pnpm --filter enso run typecheck`
and
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/spareService.test.ts`.
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/project-manager-shim/src/jvmAot/index.ts app/project-manager-shim/src/jvmAot/__tests__/cache.test.ts app/electron-client/src/secretsKey.ts app/electron-client/tests/headless/secretsKey.test.ts app/electron-client/src/projectService.ts app/electron-client/src/electron.ts app/electron-client/src/index.ts
git commit -m "Electron: the spare engine stops on quit, waits for the AOT training, follows a new secrets key (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 15: The GUI setting's store and its sync

**Files:**

- Create: `app/gui/src/providers/spareEngineSettings.ts`
- Create: `app/gui/src/composables/spareEngineSync.ts`
- Test: `app/gui/src/composables/__tests__/spareEngineSync.test.ts`
- Modify: `app/gui/src/App.vue`

**Interfaces:**

- Consumes: `LocalBackend.setSpareEngine` (Task 13).
- Produces: `spareEngineSettingsStore`,
  `usePreStartEngine(): ComputedRef<boolean>`,
  `setPreStartEngine(preStart: boolean): void`, `engineRunsOnJvm: Ref<boolean>`
  (`$/providers/spareEngineSettings`), and `useSpareEngineSync(): void`
  (`$/composables/spareEngineSync`).

- [ ] **Step 1: Write the failing test**

`app/gui/src/composables/__tests__/spareEngineSync.test.ts`:

```ts
/** @file The "Pre-start the engine" setting reaches the project service on load and on change. */
import { useSpareEngineSync } from "$/composables/spareEngineSync";
import {
  engineRunsOnJvm,
  setPreStartEngine,
  spareEngineSettingsStore,
} from "$/providers/spareEngineSettings";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { effectScope } from "vue";

const fake = vi.hoisted(() => ({
  setSpareEngine:
    vi.fn<(enabled: boolean) => Promise<{ engineMode: "native" | "jvm" }>>(),
  localBackend: null as {
    setSpareEngine: (enabled: boolean) => Promise<unknown>;
  } | null,
}));

vi.mock("$/providers/backends", () => ({
  useBackends: () => ({
    get localBackend() {
      return fake.localBackend;
    },
  }),
}));

beforeEach(() => {
  localStorage.clear();
  spareEngineSettingsStore.setState({ preStart: true });
  engineRunsOnJvm.value = false;
  fake.setSpareEngine.mockResolvedValue({ engineMode: "jvm" });
  fake.localBackend = { setSpareEngine: fake.setSpareEngine };
});

afterEach(() => vi.clearAllMocks());

test("sends the setting on load and whenever it changes, and keeps the engine mode", async () => {
  const scope = effectScope();
  scope.run(() => useSpareEngineSync());
  await flushPromises();
  expect(fake.setSpareEngine).toHaveBeenCalledExactlyOnceWith(true);
  expect(engineRunsOnJvm.value).toBe(true);
  setPreStartEngine(false);
  await flushPromises();
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(false);
  scope.stop();
});

test("a native engine hides the setting", async () => {
  fake.setSpareEngine.mockResolvedValue({ engineMode: "native" });
  const scope = effectScope();
  scope.run(() => useSpareEngineSync());
  await flushPromises();
  expect(engineRunsOnJvm.value).toBe(false);
  scope.stop();
});

test("a failed request is not an error", async () => {
  fake.setSpareEngine.mockRejectedValue(new Error("no engine"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const scope = effectScope();
  scope.run(() => useSpareEngineSync());
  await flushPromises();
  expect(engineRunsOnJvm.value).toBe(false);
  expect(warn).toHaveBeenCalled();
  scope.stop();
});

test("nothing is sent without a local backend", async () => {
  fake.localBackend = null;
  const scope = effectScope();
  scope.run(() => useSpareEngineSync());
  await flushPromises();
  expect(fake.setSpareEngine).not.toHaveBeenCalled();
  scope.stop();
});
```

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/composables/__tests__/spareEngineSync.test.ts`
Expected: FAIL, `Failed to resolve import "$/composables/spareEngineSync"`.

- [ ] **Step 3: Implement**

`app/gui/src/providers/spareEngineSettings.ts`:

```ts
/**
 * @file Settings → Local → Engine: "Pre-start the engine", on by default. The project service keeps
 * a warmed-up spare engine while no project is open (spec
 * `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`). `useSpareEngineSync` sends it
 * this value when the dashboard loads and whenever it changes, and keeps the answer: the section
 * shows only when projects get the JVM engine.
 */
import { createPersistedStore } from "$/utils/persistedStore";
import { computed, ref, type ComputedRef } from "vue";
import { z } from "zod";

/** The setting, as stored. */
export interface SpareEngineSettings {
  readonly preStart: boolean;
}

const DEFAULT_SPARE_ENGINE_SETTINGS: SpareEngineSettings = { preStart: true };
const SPARE_ENGINE_SETTINGS_SCHEMA = z.object({
  preStart: z.boolean().default(DEFAULT_SPARE_ENGINE_SETTINGS.preStart),
});

/** Exported for tests. */
export const spareEngineSettingsStore =
  createPersistedStore<SpareEngineSettings>(
    () => ({ ...DEFAULT_SPARE_ENGINE_SETTINGS }),
    {
      name: "enso-spare-engine-settings",
      version: 1,
      merge: (persistedState, currentState) => {
        const parsed = SPARE_ENGINE_SETTINGS_SCHEMA.safeParse(persistedState);
        return parsed.success
          ? { ...currentState, ...parsed.data }
          : currentState;
      },
    },
  );

/** Whether the engine is pre-started, reactively. */
export function usePreStartEngine(): ComputedRef<boolean> {
  return computed(() => spareEngineSettingsStore.state.value.preStart);
}

/** Change the setting; `useSpareEngineSync` sends it on. */
export function setPreStartEngine(preStart: boolean) {
  spareEngineSettingsStore.setState({ preStart });
}

/** Whether projects get the JVM engine: the project service's answer to `engine/setSpare`. */
export const engineRunsOnJvm = ref(false);
```

`app/gui/src/composables/spareEngineSync.ts`:

```ts
/**
 * @file Sends Settings → Local → Engine's "Pre-start the engine" to the project service
 * (`engine/setSpare`) once the local backend is there and whenever the setting changes; until the
 * first one the service starts no spare engine. The answer says whether projects get the JVM
 * engine, which shows the setting (`engineRunsOnJvm`). Nothing is sent without a local backend.
 */
import { useBackends } from "$/providers/backends";
import {
  engineRunsOnJvm,
  spareEngineSettingsStore,
} from "$/providers/spareEngineSettings";
import { watch } from "vue";

/** Keep the project service's spare engine in step with the setting. */
export function useSpareEngineSync() {
  const backends = useBackends();
  watch(
    [
      () => backends.localBackend,
      () => spareEngineSettingsStore.state.value.preStart,
    ] as const,
    async ([backend, preStart]) => {
      if (backend == null) return;
      try {
        const { engineMode } = await backend.setSpareEngine(preStart);
        engineRunsOnJvm.value = engineMode === "jvm";
      } catch (error) {
        console.warn(
          "Could not send the engine pre-start setting to the project service:",
          error,
        );
      }
    },
    { immediate: true },
  );
}
```

In `app/gui/src/App.vue`, import `useSpareEngineSync` from
`$/composables/spareEngineSync` and call it after `useSecretsKeyReminder()`:

```ts
useSecretsKeyReminder();
useSpareEngineSync();
```

- [ ] **Step 4: Run it to see it pass**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/composables/__tests__/spareEngineSync.test.ts`
and `corepack pnpm --filter enso-gui run typecheck` Expected: 4 tests PASS, no
type errors.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/providers/spareEngineSettings.ts app/gui/src/composables/spareEngineSync.ts app/gui/src/composables/__tests__/spareEngineSync.test.ts app/gui/src/App.vue
git commit -m "GUI: the pre-start setting, sent to the project service (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 16: Settings → Local → Engine

**Files:**

- Create: `app/gui/src/dashboard/layouts/Settings/EngineSettingsSection.vue`
- Modify: `app/gui/src/dashboard/layouts/Settings/tabs.ts`,
  `app/common/src/text/english.json`
- Test: `app/gui/src/dashboard/layouts/Settings/__tests__/localTab.test.ts`
- Modify: `app/gui/integration-test/mock/localApi.ts`
- Create: `app/gui/integration-test/dashboard/spareEngineSettings.spec.ts`

**Interfaces:**

- Consumes: `engineRunsOnJvm`, `usePreStartEngine`, `setPreStartEngine`,
  `spareEngineSettingsStore` (Task 15).
- Produces: text ids `engineSettingsSection`,
  `engineSettingsCustomEntryAliases`, `preStartEngineSetting`,
  `preStartEngineSettingDescription`; mock
  `api.spareEngine = { engineMode, requests }`.

- [ ] **Step 1: Write the failing test**

In `localTab.test.ts`, add inside `describe('the Local settings tab', ...)`
after the Engine logs test:

```ts
test("the Engine section is hidden unless projects get the JVM engine", async () => {
  const { engineRunsOnJvm } = await import("$/providers/spareEngineSettings");
  engineRunsOnJvm.value = false;
  await openLocalTab();
  expect(document.body.textContent).toContain(getText("mapsSettingsSection"));
  expect(document.body.textContent).not.toContain(
    getText("preStartEngineSetting"),
  );
});

test("the Engine section has the pre-start switch, on by default, and keeps a change", async () => {
  const { engineRunsOnJvm, setPreStartEngine, spareEngineSettingsStore } =
    await import("$/providers/spareEngineSettings");
  engineRunsOnJvm.value = true;
  await openLocalTab();
  expect(document.body.textContent).toContain(getText("engineSettingsSection"));
  expect(document.body.textContent).toContain(
    getText("preStartEngineSettingDescription"),
  );
  expect(spareEngineSettingsStore.getState().preStart).toBe(true);
  const user = userEvent.setup();
  await user.click(
    required(
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="switch"], input[type="checkbox"]',
        ),
      ].find((element) =>
        element
          .closest("label")
          ?.textContent.includes(getText("preStartEngineSetting")),
      ),
    ),
  );
  await flushPromises();
  expect(spareEngineSettingsStore.getState().preStart).toBe(false);
  expect(localStorage.getItem("enso-spare-engine-settings")).toContain(
    '"preStart":false',
  );
  setPreStartEngine(true);
  engineRunsOnJvm.value = false;
});
```

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/dashboard/layouts/Settings/__tests__/localTab.test.ts`
Expected: the two new tests FAIL: the Local tab has no Engine section.

- [ ] **Step 3: Implement**

`app/gui/src/dashboard/layouts/Settings/EngineSettingsSection.vue`:

```vue
<script setup lang="ts">
/**
 * @file The Local tab's Engine section: the "Pre-start the engine" switch
 * (`$/providers/spareEngineSettings`). `tabs.ts` shows it only when projects get the JVM engine.
 */
import Form from "$/components/Form/Form.vue";
import Switch from "$/components/Switch/Switch.vue";
import {
  setPreStartEngine,
  usePreStartEngine,
} from "$/providers/spareEngineSettings";
import { useText } from "$/providers/text";

const { getText } = useText();
const preStart = usePreStartEngine();

function onChange(name: string, value: unknown) {
  if (name === "preStart") setPreStartEngine(value === true);
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="engine-settings-section">
    <Form
      :schema="(z) => z.object({ preStart: z.boolean() })"
      :defaultValues="{ preStart }"
      @change="(name, value) => onChange(name, value)"
    >
      <Switch
        name="preStart"
        :label="getText('preStartEngineSetting')"
        :description="getText('preStartEngineSettingDescription')"
      />
    </Form>
  </div>
</template>
```

In `tabs.ts`, add the imports (alphabetical, next to the others):

```ts
import { engineRunsOnJvm } from "$/providers/spareEngineSettings";
import EngineSettingsSection from "./EngineSettingsSection.vue";
```

and insert in `LOCAL_TAB.sections` before the `engineLogsSettingsSection` entry:

```ts
    {
      nameId: 'engineSettingsSection',
      // Only a JVM engine has a spare to pre-start; the project service says which engine runs.
      visible: () => engineRunsOnJvm.value,
      entries: [
        {
          type: 'custom',
          aliasesId: 'engineSettingsCustomEntryAliases',
          component: EngineSettingsSection,
        },
      ],
    },
```

In `app/common/src/text/english.json`, add after
`"engineLogsSettingsNextStart": …,`:

```json
  "engineSettingsSection": "Engine",
  "engineSettingsCustomEntryAliases": "engine\npre-start\nprestart\nspare\nstart\nfaster\nmemory",
  "preStartEngineSetting": "Pre-start the engine",
  "preStartEngineSettingDescription": "Starts the engine in the background while you are on the dashboard, so projects open faster. Uses about 0.5–0.8 GB of memory while no project is open.",
```

In `app/gui/integration-test/mock/localApi.ts`:

- add `setSpareEngine: array<{ enabled: boolean }>(),` to
  `INITIAL_CALLS_OBJECT`;
- after `const engineLog = { … }` add:

```ts
/** The mocked spare engine: change `engineMode` in `setupApi.local`, before the page loads. */
const spareEngine = {
  engineMode: "native" as "native" | "jvm",
  /** Each `engine/setSpare` the GUI sent, oldest first. */
  requests: [] as boolean[],
};
```

- after the `project/delete` route, add:

```ts
await projectServiceRoute("engine/setSpare", (params) => {
  const enabled = params.enabled === true;
  spareEngine.requests.push(enabled);
  called("setSpareEngine", { enabled });
  return toJSONRPCResult({ engineMode: spareEngine.engineMode });
});
```

- add `spareEngine,` to the `api` object, after `samples,`.

`app/gui/integration-test/dashboard/spareEngineSettings.spec.ts`:

```ts
/**
 * @file Settings → Local → Engine: the "Pre-start the engine" switch, shown only when the project
 * service says projects get the JVM engine, and sent to it on load and on change. With
 * `PR_SCREENSHOT_DIR` set, each test also saves the settings panel for the PR.
 */
import { expect, test, type Page } from "integration-test/base";
import type { MockLocalApi } from "integration-test/mock/localApi";
import { TEXT } from "../actions";
import BaseActions from "../actions/BaseActions";

const settingsPanel = (page: Page) => page.getByTestId("settings-panel");
const sectionHeadings = (page: Page) => settingsPanel(page).locator("main h2");

async function screenshot(page: Page, name: string) {
  const dir = process.env.PR_SCREENSHOT_DIR;
  if (dir) await settingsPanel(page).screenshot({ path: `${dir}/${name}.png` });
}

test("with the native engine there is no Engine section", async ({
  drivePage,
  page,
  localApi,
}) => {
  await drivePage;
  await expect.poll(() => localApi.spareEngine.requests).toEqual([true]);
  await BaseActions.press(page, "Mod+,");
  await expect(sectionHeadings(page)).toHaveText([
    TEXT.localSettingsSection,
    TEXT.localVersionsSettingsSection,
    TEXT.engineLogsSettingsSection,
    TEXT.mapsSettingsSection,
  ]);
  await screenshot(page, "engine-section-native");
});

test.describe("with the JVM engine", () => {
  test.use({
    setupApi: {
      local: (api: MockLocalApi) => {
        api.spareEngine.engineMode = "jvm";
      },
    },
  });

  test("the Engine section has the switch, on, and a change is sent", async ({
    drivePage,
    page,
    localApi,
  }) => {
    await drivePage;
    await expect.poll(() => localApi.spareEngine.requests).toEqual([true]);
    await BaseActions.press(page, "Mod+,");
    await expect(sectionHeadings(page)).toHaveText([
      TEXT.localSettingsSection,
      TEXT.localVersionsSettingsSection,
      TEXT.engineSettingsSection,
      TEXT.engineLogsSettingsSection,
      TEXT.mapsSettingsSection,
    ]);
    const toggle = settingsPanel(page).getByLabel(TEXT.preStartEngineSetting);
    await expect(toggle).toBeChecked();
    await screenshot(page, "engine-section-jvm");
    await toggle.click();
    await expect
      .poll(() => localApi.spareEngine.requests)
      .toEqual([true, false]);
  });
});
```

- [ ] **Step 4: Run the tests to see them pass**

Run:

- `corepack pnpm --filter enso-gui exec vitest run src/dashboard/layouts/Settings/__tests__/localTab.test.ts src/composables/__tests__/spareEngineSync.test.ts`
- `cd app/gui && corepack pnpm run test:integration integration-test/dashboard/spareEngineSettings.spec.ts integration-test/dashboard/localModeSettings.spec.ts integration-test/dashboard/accessibility.spec.ts`
- `corepack pnpm --filter enso-gui run typecheck` and
  `corepack pnpm --filter enso-gui run lint`

Expected: all PASS. `accessibility.spec.ts`'s settings baseline must not change:
the mock answers `native` by default, so the section is absent there. A failure
in it is a real regression.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/dashboard/layouts/Settings/EngineSettingsSection.vue app/gui/src/dashboard/layouts/Settings/tabs.ts app/common/src/text/english.json app/gui/src/dashboard/layouts/Settings/__tests__/localTab.test.ts app/gui/integration-test/mock/localApi.ts app/gui/integration-test/dashboard/spareEngineSettings.spec.ts
git commit -m "GUI: Settings → Local → Engine, Pre-start the engine (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 17: The packaged-IDE Playwright spec

**Files:**

- Modify: `app/electron-client/tests/electronTest.ts` (the fixture's options and
  the `app` fixture's env)
- Create: `app/electron-client/tests/spareEngine.spec.ts`

**Interfaces:**

- Consumes: the `Spare engine: ready …` and `Spare engine: used …` log lines
  (Task 10), the engine log's `Engine: pre-started spare used` notice (Task 11),
  and the AOT cache's `JDK AOT cache: trained in …` line, after which a spare
  may start (Task 14). The Logs panel opens with the dock's
  `action:graph.toggleLogs` button and shows `engine-log-panel`, as in
  `app/gui/integration-test/project-view/engineLogs.spec.ts`.
- Produces: the fixture option `spareEngine: boolean` (default `false`). Without
  it every spec runs with `ENSO_SPARE_ENGINE=0`.

- [ ] **Step 1: Change the fixture**

In `electronTest.ts`, add to the fixture's type, after
`welcomeProject: boolean`:

```ts
/**
 * Whether the app runs the JVM engine with its spare engine. Default `false`: every other spec
 * runs with `ENSO_SPARE_ENGINE=0`, so a spare never changes its timing.
 */
spareEngine: boolean;
```

add `spareEngine: [false, { option: true }],` after
`welcomeProject: [false, { option: true }],`, add `spareEngine` to the `app`
fixture's destructured parameters, and add to its `env`:

```ts
        ...(spareEngine ? { ENSO_ENGINE_MODE: 'jvm' } : { ENSO_SPARE_ENGINE: '0' }),
```

- [ ] **Step 2: Write the spec**

`app/electron-client/tests/spareEngine.spec.ts`:

```ts
/**
 * @file With the JVM engine, the dashboard starts a spare engine, and the next open uses it (spec
 * `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`). The service logs
 * `Spare engine: ready …` and `Spare engine: used …` on the main process's stdout.
 */
import { expect } from "playwright/test";
import {
  createNewProject,
  SKIP_ON_WINDOWS_CI,
  SKIP_ON_WINDOWS_CI_REASON,
  test,
  waitForDashboard,
} from "./electronTest";

test.use({ spareEngine: true });

test("an open uses the spare engine", async ({ app, page }) => {
  test.skip(SKIP_ON_WINDOWS_CI, SKIP_ON_WINDOWS_CI_REASON);
  // A fresh profile has no AOT cache: the JVM default trains one first (minutes), and no spare
  // starts until that training has ended (`isTraining`, `onTrainingEnded`).
  test.setTimeout(900_000);
  const output: string[] = [];
  app
    .process()
    .stdout?.on("data", (chunk: Buffer) => void output.push(chunk.toString()));
  app
    .process()
    .stderr?.on("data", (chunk: Buffer) => void output.push(chunk.toString()));
  const said = (text: string) => output.join("").includes(text);
  await waitForDashboard(page);
  await expect
    .poll(() => said("JDK AOT cache: trained in") || said("training failed"), {
      timeout: 600_000,
    })
    .toBe(true);
  await expect
    .poll(() => said("Spare engine: started"), { timeout: 60_000 })
    .toBe(true);
  await expect
    .poll(() => said("Spare engine: ready"), { timeout: 180_000 })
    .toBe(true);
  await createNewProject(page, { waitForVisualization: false });
  await expect
    .poll(() => said("Spare engine: used"), { timeout: 60_000 })
    .toBe(true);
  // The project's engine log says so too (the shim's notice, `spareNotice`).
  await page
    .getByTestId("bottomDockButtons")
    .getByTestId("action:graph.toggleLogs")
    .click();
  await expect(page.getByTestId("engine-log-panel")).toContainText(
    "Engine: pre-started spare used",
    { timeout: 30_000 },
  );
});
```

- [ ] **Step 3: Run it against a packaged IDE of this branch**

Build `dist/ide` from the worktree with `ide-local` (memory: "Local Windows
installer build"; the script must `cd /d <worktree> || exit /b 1` and check its
directory first). Then:

```bash
corepack pnpm -r --filter enso ide-integration-test tests/spareEngine.spec.ts tests/localWorkflow.spec.ts
```

Expected: both PASS; the second shows the other specs unaffected
(`ENSO_SPARE_ENGINE=0`).

- [ ] **Step 4: Commit**

```bash
git add app/electron-client/tests/electronTest.ts app/electron-client/tests/spareEngine.spec.ts
git commit -m "Packaged IDE: an open uses the spare engine (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 18: Docs, changelog, PR 2

**Files:**

- Modify: `app/project-manager-shim/CLAUDE.md` (new section "Spare engine
  (`projectService/spareEngine.ts`)" after "Engine mode")
- Modify: `app/gui/src/dashboard/layouts/Settings/CLAUDE.md` (new section
  "Engine" before "Engine logs")
- Modify: `app/electron-client/CLAUDE.md` ("Env vars of note")
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the docs**

`app/project-manager-shim/CLAUDE.md`, after the "Engine mode" section:

```markdown
## Spare engine (`projectService/spareEngine.ts`)

While the engine runs on the JVM, the setting (Settings → Local → Engine,
`engine/setSpare`) is on and no project is open, `EnsoRunner` keeps one engine
started with `--standby` (engine/runner CLAUDE.md, "Standby mode"; spec
`docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`).

- **Who decides:** `ProjectService.refreshSpare` (one decision at a time). No
  spare until the GUI's first `engine/setSpare`, nor with the setting off,
  `ENSO_SPARE_ENGINE=0`, a native default engine, `ENSO_YDOC_HOST=engine`, a
  `--profiling-path` in the extra arguments, an AOT training running
  (`JvmAotCache.isTraining`, a first launch), or a project open or opening (one
  whose close has begun does not count, `hasProjectsInUse`). A native open stops
  the spare. `stopSpareEngine` (Electron's `before-quit`) stops it for good.
- **When:** at the first `engine/setSpare`; after a close, once the closing
  engine has exited or `SPARE_AFTER_CLOSE_MS` (2 s) has passed; after a failed
  open; when an AOT training ends, trained or failed (`onTrainingEnded`); and
  after the secrets key is rotated or reset (`afterKeyChange` in Electron's
  `secretsKey.ts`). The spare holds the old key and `hasRunningProjects` does
  not count it, so a rotation is not refused for it; the refresh replaces it.
- **The spawn key** (`spawnKey`, a SHA-256 hash) covers the mode, the service's
  extra arguments, the AOT options, the extra environment (the secrets key, so
  it is hashed and never logged) and `ENSO_JVM_OPTIONS`. Every JVM open carries
  its key (`EngineLaunch.spareKey`); the runner takes a spare with the same key
  and stops one with another.
- **The take** (`EnsoRunner.openProject`, first attempt only): the spare's
  process becomes the open's first spawn and gets `standbyLine(args, env)`. The
  `env` holds only `LINE_VARIABLES`: the channel token, the ydoc port, and the
  two `ENSO_LOCAL_PROJECT_*` ids. Everything after is today's path: health and
  ydoc waits, watchdog, stdin-newline close. Respawns are ordinary spawns. An
  engine-hosted ydoc server with allowed origins means no take, since the engine
  cannot take origins on its line.
- **Failure:** a spare that fails to spawn or exits before it is used is dropped
  and not started again for the same key until the next close
  (`spareAvailableAgain`). No retry loop.
- **Logs:**
  `Spare engine: started / ready after N ms / used / stopped: <why> / exited before it was used`
  on the console. The spare's stderr is echoed like an engine's, so
  `STANDBY READY` shows in the IDE's output. Each JVM open's engine log gets
  `Engine: pre-started spare used (…)` or
  `Engine: no pre-started spare (<why>)`.
- Tests: `spareEngine.test.ts`, `spareOpen.test.ts` (fake `--standby` engine in
  `fakeSpareEngine.ts`), `spareService.test.ts` (a recording runner).
```

`app/gui/src/dashboard/layouts/Settings/CLAUDE.md`, before "## Engine logs":

```markdown
## Engine

The Local tab's Engine section (`EngineSettingsSection.vue`) holds one switch,
on by default: Pre-start the engine. It lives in
`$/providers/spareEngineSettings` (`localStorage` key
`enso-spare-engine-settings`). `useSpareEngineSync` (called by `App.vue`) sends
it to the project service (`engine/setSpare`) when the local backend is there
and on every change. The answer's `engineMode` sets `engineRunsOnJvm`, which
shows the section (`tabs.ts`): with the native engine there is no spare to
pre-start. Tests: `__tests__/localTab.test.ts`,
`composables/__tests__/spareEngineSync.test.ts` and
`integration-test/dashboard/spareEngineSettings.spec.ts`.
```

and add `spareEngineSettings.spec.ts` to the Playwright list of its "Tests"
section.

`app/electron-client/CLAUDE.md`, in "Env vars of note" after `ENSO_JVM_AOT_DIR`:

```markdown
- `ENSO_SPARE_ENGINE=0` — no spare engine whatever Settings → Local → Engine
  says (`project-manager-shim/CLAUDE.md`, "Spare engine"). The Playwright
  fixture sets it for every spec but `spareEngine.spec.ts`; the open-time
  harness sets it for `jvm` and `jvm-first`.
```

Run Prettier on the three files:

```bash
node /c/Repos/Enso/ide/node_modules/prettier/bin/prettier.cjs --write app/project-manager-shim/CLAUDE.md app/gui/src/dashboard/layouts/Settings/CLAUDE.md app/electron-client/CLAUDE.md
```

- [ ] **Step 2: Run the package checks**

```bash
corepack pnpm --filter project-manager-shim run test:unit
corepack pnpm --filter project-manager-shim run lint
corepack pnpm --filter enso-common run test:unit
corepack pnpm --filter enso-gui run test:unit
corepack pnpm --filter enso run test:unit
corepack pnpm -r run typecheck
```

Expected: all PASS. Repeat the shim's `test:unit` in WSL (Linux, root CLAUDE.md
"Verify on Linux"):

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && rm -rf ~/jvm-spare && git clone --branch jvm-warm-engine-2-spare /mnt/c/Repos/Enso/ide ~/jvm-spare && cd ~/jvm-spare && corepack pnpm install && corepack pnpm -r compile && corepack pnpm --filter project-manager-shim run test:unit && corepack pnpm --filter enso-gui run test:unit'
```

- [ ] **Step 3: Commit, push, open PR 2**

```bash
git add app/project-manager-shim/CLAUDE.md app/gui/src/dashboard/layouts/Settings/CLAUDE.md app/electron-client/CLAUDE.md
git commit -m "Docs: the spare engine (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
git push -u origin jvm-warm-engine-2-spare
```

Write the body to `<scratch>/pr2-body.md`. It says what the PR adds and lists
decisions 2, 7, 8, 9, 10 and 12. It states the owner's gate ("Do not merge
before the owner's installer test: a JVM-engine install, the switch in Settings
→ Local → Engine, an open from the dashboard after `Spare engine: ready`") and
ends with `Refs #518` and the generated-with lines.

```bash
gh pr create --base develop --head jvm-warm-engine-2-spare --title "IDE: pre-start a warm engine on the dashboard (JVM) (#518)" --body-file <scratch>/pr2-body.md
```

- [ ] **Step 4: The changelog entry, with the PR's number**

Add under `# Next Release` → `#### Enso IDE`, as the first bullet, with `NNN`
the number `gh pr create` printed:

```markdown
- [With the JVM engine, the IDE starts and warms up an engine in the background
  while you are on the dashboard, so the next project opens faster. Turn it off
  with Pre-start the engine in Settings → Local → Engine; it uses about 0.5–0.8
  GB of memory while no project is open.][NNN]
```

and the link definition before the first existing one (`[629]: …`):

```markdown
[NNN]: https://github.com/jdunkerley/enso/pull/NNN
```

```bash
node /c/Repos/Enso/ide/node_modules/prettier/bin/prettier.cjs --check CHANGELOG.md
git add CHANGELOG.md
git commit -m "Changelog: pre-started engine (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
git push
```

- [ ] **Step 5: Screenshots**

```bash
mkdir -p <scratch>/pr2-shots
cd app/gui && PR_SCREENSHOT_DIR=<scratch>/pr2-shots corepack pnpm run test:integration integration-test/dashboard/spareEngineSettings.spec.ts
```

`engine-section-native.png` is the view as before (develop shows the same Local
tab), `engine-section-jvm.png` the new section. Push both to the orphan
`pr-screenshots` branch under `pr-NNN/` (memory: "Screenshots on every UI PR"; a
normal push), and post a PR comment embedding both images by their raw URLs.

- [ ] **Step 6: CI, then the owner's gate**

Wait for CI and fix failures this PR caused. The PR is a feature, so it waits
for the owner's installer test and OK (memory "Merge gate for features"). Do not
merge.

---

# Part 3 — The open-time harness and the measurement (PR 3)

Start once PR 2 is merged:

```bash
git -C /c/Repos/Enso/ide fetch origin develop
git -C /c/Repos/Enso/ide worktree add -b jvm-warm-engine-3-measure /c/Repos/Enso/ide/.claude/worktrees/jvm-measure origin/develop
```

### Task 19: The report knows spare engines

**Files:**

- Modify: `app/electron-client/perf/openTimeReport.ts`
- Test: `app/electron-client/tests/headless/openTimeReport.test.ts`

**Interfaces:**

- Produces (`openTimeReport.ts`):
  - `Engine` adds `'jvm-spare' | 'jvm-spare-early' | 'jvm-spare-abandon'`
  - `isSpareEngine(engine: Engine): boolean`
  - `interface SpareRun { readyMs: readonly number[]; warmUpMs: readonly number[]; cpuMs: readonly number[]; idleEngineKb?: number; used: readonly OpenTag[] }`
  - `RunResult.spare?: SpareRun`, `RunResult.cpus?: number`
  - `parseSpareOutput(stdout: string): Pick<SpareRun, 'readyMs' | 'warmUpMs' | 'cpuMs'>`
  - `spareRun(stdout: string, marks: readonly Mark[]): SpareRun`
  - `spareTable(report: OpenTimeReport): string`,
    `ratioTable(report: OpenTimeReport): string`,
    `cpusLine(report: OpenTimeReport): string`

- [ ] **Step 1: Write the failing test**

Append to `tests/headless/openTimeReport.test.ts` (add
`isSpareEngine, parseSpareOutput, spareRun, spareTable, ratioTable, cpusLine` to
its import from `../../perf/openTimeReport`):

```ts
describe("spare engines", () => {
  const stderr = [
    "Spare engine: started (pid 1)",
    "standby: warm-up done in 6100 ms, preloading skipped: the AOT cache holds the classes, process CPU 21400 ms",
    "STANDBY READY 7900",
    "Spare engine: used (pid 1, ready after 8000 ms)",
    "standby: warm-up done in 5900 ms, preloaded 7000 of 7100 classes, process CPU 20100 ms",
    "STANDBY READY 7600",
  ].join("\n");

  test("parseEngines takes them and isSpareEngine knows them", () => {
    expect(parseEngines("jvm-spare,jvm-spare-early,jvm-spare-abandon")).toEqual(
      ["jvm-spare", "jvm-spare-early", "jvm-spare-abandon"],
    );
    expect(isSpareEngine("jvm-spare-early")).toBe(true);
    expect(isSpareEngine("jvm")).toBe(false);
  });

  test("reads each spare's ready time, warm-up and CPU", () => {
    expect(parseSpareOutput(stderr)).toEqual({
      readyMs: [7900, 7600],
      warmUpMs: [6100, 5900],
      cpuMs: [21400, 20100],
    });
  });

  test("a launch records its idle memory and which opens used a spare", () => {
    const run = spareRun(stderr, [
      { k: "rss", t: 1, phase: "spareIdle", engineKb: 700_000, ydocKb: 90_000 },
      { k: "first:spareUsed", t: 2, used: true },
      { k: "second:spareUsed", t: 3, used: false },
    ]);
    expect(run.idleEngineKb).toBe(700_000);
    expect(run.used).toEqual(["first"]);
  });

  test("the tables give medians, ratios over native and the CPUs", () => {
    const launch = (
      engine: "native" | "jvm-spare",
      headline: number,
      cpus = 8,
    ) => ({
      engine,
      run: 1,
      first: { welcomeShown: headline },
      second: { welcomeShown: headline - 500 },
      notMeasured: [],
      cpus,
      ...(engine === "jvm-spare"
        ? {
            spare: {
              readyMs: [7900],
              warmUpMs: [6100],
              cpuMs: [21400],
              idleEngineKb: 700 * 1024,
              used: ["first", "second"] as const,
            },
          }
        : {}),
    });
    const report = {
      version: 1 as const,
      platform: "win32",
      commit: null,
      template: "core" as const,
      runs: [launch("native", 2650), launch("jvm-spare", 3450)],
    };
    expect(ratioTable(report)).toContain("| jvm-spare | 1.30 |");
    expect(spareTable(report)).toContain(
      "| jvm-spare | 1 | 7900 | 6100 | 21400 | 700 | 2/2 |",
    );
    expect(cpusLine(report)).toBe("CPUs (the IDE’s affinity): 8.");
    expect(
      cpusLine({
        ...report,
        runs: [launch("native", 1, 8), launch("jvm-spare", 1, 32)],
      }),
    ).toBe("CPUs (the IDE’s affinity) differ between launches: 8, 32.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter enso exec vitest run tests/headless/openTimeReport.test.ts`
Expected: FAIL, `isSpareEngine` and the other new names are not exported.

- [ ] **Step 3: Implement**

In `perf/openTimeReport.ts`:

Replace `export type Engine = 'native' | 'jvm' | 'jvm-first'` with:

```ts
export type Engine =
  | "native"
  | "jvm"
  | "jvm-first"
  | "jvm-spare"
  | "jvm-spare-early"
  | "jvm-spare-abandon";

const ENGINES: readonly Engine[] = [
  "native",
  "jvm",
  "jvm-first",
  "jvm-spare",
  "jvm-spare-early",
  "jvm-spare-abandon",
];

/**
 * The JVM with its spare engine (`project-manager-shim/CLAUDE.md`, "Spare engine"): `jvm-spare`
 * opens once the spare is ready (at most 15 s on the dashboard); `jvm-spare-early` opens at once,
 * while it warms up; `jvm-spare-abandon` opens at once with the warm-up abandoned on the line.
 */
export function isSpareEngine(engine: Engine): boolean {
  return engine.startsWith("jvm-spare");
}
```

In `parseEngines`, replace the condition
`if (engine !== 'native' && engine !== 'jvm' && engine !== 'jvm-first') {` with:

```ts
    if (!(ENGINES as readonly string[]).includes(engine)) {
```

and its `return engine` with `return engine as Engine`.

Add to `interface RunResult`:

```ts
  /** A spare engine launch's numbers (`spareRun`). */
  readonly spare?: SpareRun
  /** How many CPUs the IDE was pinned to (`cpuAffinity`), when it could be read. */
  readonly cpus?: number
```

Add after `RunResult`:

```ts
/** What a launch's spare engines reported (their stderr, echoed by the shim). */
export interface SpareRun {
  /** Per spare, in start order: ms from its process start to `STANDBY READY`. */
  readonly readyMs: readonly number[];
  /** Per spare: the warm-up's own duration, and the process's CPU time at its end. */
  readonly warmUpMs: readonly number[];
  readonly cpuMs: readonly number[];
  /** The engine processes' memory (KiB) once the first spare was ready, before the first open. */
  readonly idleEngineKb?: number;
  /** The opens that used a spare. */
  readonly used: readonly OpenTag[];
}

const READY_LINE = /STANDBY READY (\d+)/g;
const WARM_UP_LINE =
  /standby: warm-up done in (\d+) ms, .*?, process CPU (-?\d+) ms/g;

/** Each spare's `STANDBY READY` and warm-up line, in order. */
export function parseSpareOutput(
  stdout: string,
): Pick<SpareRun, "readyMs" | "warmUpMs" | "cpuMs"> {
  const warmUps = [...stdout.matchAll(WARM_UP_LINE)];
  return {
    readyMs: [...stdout.matchAll(READY_LINE)].map((m) => Number(m[1])),
    warmUpMs: warmUps.map((m) => Number(m[1])),
    cpuMs: warmUps.map((m) => Number(m[2])),
  };
}

/** A spare launch's `SpareRun`: its output, its `spareIdle` RSS and its `<open>:spareUsed` marks. */
export function spareRun(stdout: string, marks: readonly Mark[]): SpareRun {
  const idle = marks.find((m) => m.k === "rss" && m.phase === "spareIdle");
  const idleKb =
    typeof idle?.engineKb === "number" && idle.engineKb >= 0
      ? idle.engineKb
      : undefined;
  const used = (["first", "second"] as const).filter((tag) =>
    marks.some((m) => m.k === `${tag}:spareUsed` && m.used === true),
  );
  return {
    ...parseSpareOutput(stdout),
    ...(idleKb != null ? { idleEngineKb: idleKb } : {}),
    used,
  };
}

/** The spare engines' medians: ready, warm-up, CPU at ready, idle memory, and opens that used one. */
export function spareTable(report: OpenTimeReport): string {
  const engines = [...new Set(report.runs.map((r) => r.engine))].filter(
    isSpareEngine,
  );
  if (engines.length === 0) return "";
  const rows = engines.map((engine) => {
    const runs = report.runs.filter(
      (r) => r.engine === engine && r.spare != null,
    );
    const spares = runs.map((r) => r.spare!);
    const med = (values: number[]) => cell(median(values));
    const idle = median(
      spares.flatMap((s) => (s.idleEngineKb == null ? [] : [s.idleEngineKb])),
    );
    const opens = runs.reduce((n, r) => n + (r.second != null ? 2 : 1), 0);
    const usedOpens = spares.reduce((n, s) => n + s.used.length, 0);
    return `| ${engine} | ${runs.length} | ${med(spares.flatMap((s) => s.readyMs))} | ${med(spares.flatMap((s) => s.warmUpMs))} | ${med(spares.flatMap((s) => s.cpuMs))} | ${idle == null ? "–" : Math.round(idle / 1024)} | ${usedOpens}/${opens} |`;
  });
  return [
    "Spare engines (medians over the launches; ready is from the spare’s own start; idle memory is the engine processes’ before the first open, MiB).",
    "",
    "| Engine | Launches | Ready (ms) | Warm-up (ms) | Process CPU at ready (ms) | Idle (MiB) | Opens that used a spare |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

/** Each engine's headline over native's, first and second open; empty without native launches. */
export function ratioTable(report: OpenTimeReport): string {
  const summaries = summarise(report);
  const native = summaries.find((s) => s.engine === "native");
  if (native == null) return "";
  const ratio = (s: EngineSummary, open: "first" | "second") => {
    const engine = s[open][HEADLINE];
    const base = native[open][HEADLINE];
    return engine == null || base == null ? "–" : (engine / base).toFixed(2);
  };
  return [
    "Headline over native (medians). The re-gate: the first open, at 8 CPUs, at most 1.5.",
    "",
    "| Engine | First open | Second open |",
    "| --- | ---: | ---: |",
    ...summaries
      .filter((s) => s.engine !== "native")
      .map(
        (s) => `| ${s.engine} | ${ratio(s, "first")} | ${ratio(s, "second")} |`,
      ),
  ].join("\n");
}

/** The CPUs the IDE was pinned to, or that the launches differ; empty when none was read. */
export function cpusLine(report: OpenTimeReport): string {
  const counts = [
    ...new Set(report.runs.flatMap((r) => (r.cpus == null ? [] : [r.cpus]))),
  ].sort((a, b) => a - b);
  if (counts.length === 0) return "";
  return counts.length === 1
    ? `CPUs (the IDE’s affinity): ${counts[0]}.`
    : `CPUs (the IDE’s affinity) differ between launches: ${counts.join(", ")}.`;
}
```

(`cell`, `median`, `summarise`, `EngineSummary` and `HEADLINE` already exist in
the file; `spareTable` and `ratioTable` go after `summarise` and `cell` are
defined.)

- [ ] **Step 4: Run it to see it pass**

Run:
`corepack pnpm --filter enso exec vitest run tests/headless/openTimeReport.test.ts tests/headless/gate.test.ts`
Expected: all PASS; `gate.test.ts` is unchanged (the gate keeps `jvm` and
`jvm-first`).

- [ ] **Step 5: Commit**

```bash
git add app/electron-client/perf/openTimeReport.ts app/electron-client/tests/headless/openTimeReport.test.ts
git commit -m "Open-time report: spare engines, ratios over native, CPUs (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 20: Pinned CPUs and pooled rounds

**Files:**

- Create: `app/electron-client/perf/cpuAffinity.ts`
- Create: `app/electron-client/perf/poolReports.ts`
- Test: `app/electron-client/tests/headless/cpuAffinity.test.ts`,
  `poolReports.test.ts`

**Interfaces:**

- Consumes: `renderMarkdown` (existing), `ratioTable`, `spareTable`, `cpusLine`
  (Task 19).
- Produces (`cpuAffinity.ts`): `bitCount(mask: bigint): number`,
  `parseTaskset(output: string): number | undefined`,
  `parseWindowsAffinity(output: string): number | undefined`,
  `cpuAffinity(pid: number): Promise<number | undefined>`.
- Produces (`poolReports.ts`):
  `poolReports(reports: readonly OpenTimeReport[]): OpenTimeReport`.

- [ ] **Step 1: Write the failing tests**

`tests/headless/cpuAffinity.test.ts`:

```ts
/** @file Reading how many CPUs a process may run on. */
import { describe, expect, test } from "vitest";
import {
  bitCount,
  parseTaskset,
  parseWindowsAffinity,
} from "../../perf/cpuAffinity";

describe("cpuAffinity", () => {
  test("counts the bits of a mask", () => {
    expect(bitCount(0xffn)).toBe(8);
    expect(bitCount(0xfn)).toBe(4);
    expect(bitCount(0xffffffffn)).toBe(32);
  });

  test("reads taskset's output", () => {
    expect(parseTaskset("pid 123's current affinity mask: ff\n")).toBe(8);
    expect(
      parseTaskset("pid 1's current affinity mask: ffffffff,ffffffff"),
    ).toBe(64);
    expect(parseTaskset("taskset: failed")).toBeUndefined();
  });

  test("reads PowerShell's decimal mask", () => {
    expect(parseWindowsAffinity("255\r\n")).toBe(8);
    expect(parseWindowsAffinity("4294967295")).toBe(32);
    expect(parseWindowsAffinity("Get-Process : Cannot find")).toBeUndefined();
  });
});
```

`tests/headless/poolReports.test.ts`:

```ts
/** @file Pooling the reports of several rounds. */
import { describe, expect, test } from "vitest";
import type { OpenTimeReport } from "../../perf/openTimeReport";
import { poolReports } from "../../perf/poolReports";

const report = (headlines: number[], platform = "win32"): OpenTimeReport => ({
  version: 1,
  platform,
  commit: null,
  template: "core",
  runs: headlines.map((welcomeShown, i) => ({
    engine: "jvm",
    run: i + 1,
    first: { welcomeShown },
    second: null,
    notMeasured: [],
  })),
});

describe("poolReports", () => {
  test("keeps every launch, numbered by round", () => {
    const pooled = poolReports([report([1, 2]), report([3])]);
    expect(pooled.runs.map((r) => [r.run, r.first.welcomeShown])).toEqual([
      [101, 1],
      [102, 2],
      [201, 3],
    ]);
  });

  test("refuses reports of different platforms or templates", () => {
    expect(() => poolReports([report([1]), report([2], "linux")])).toThrow(
      /different/,
    );
    expect(() => poolReports([])).toThrow(/no reports/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run:
`corepack pnpm --filter enso exec vitest run tests/headless/cpuAffinity.test.ts tests/headless/poolReports.test.ts`
Expected: FAIL, unresolved imports (`../../perf/cpuAffinity`,
`../../perf/poolReports`).

- [ ] **Step 3: Implement**

`perf/cpuAffinity.ts`:

```ts
/**
 * @file How many logical CPUs a process may run on (its affinity mask), so that a run pinned to 4
 * or 8 CPUs can be checked from its report (`app/electron-client/CLAUDE.md`, "Open-time harness").
 * Children inherit the mask, so the IDE's main process stands for the engine too.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The number of set bits. */
export function bitCount(mask: bigint): number {
  let count = 0;
  for (let m = mask; m > 0n; m >>= 1n) count += Number(m & 1n);
  return count;
}

/** `taskset -p <pid>`: `pid 123's current affinity mask: ff` (groups of 32 bits, comma-separated). */
export function parseTaskset(output: string): number | undefined {
  const match = /affinity mask:\s*([0-9a-f,]+)/i.exec(output);
  return match
    ? bitCount(BigInt(`0x${match[1]!.replace(/,/g, "")}`))
    : undefined;
}

/** `(Get-Process -Id <pid>).ProcessorAffinity.ToInt64()`: a decimal mask. */
export function parseWindowsAffinity(output: string): number | undefined {
  const text = output.trim();
  return /^\d+$/.test(text) ? bitCount(BigInt(text)) : undefined;
}

/** The number of CPUs `pid` may run on; `undefined` when it cannot be read (or on macOS). */
export async function cpuAffinity(pid: number): Promise<number | undefined> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${pid}).ProcessorAffinity.ToInt64()`,
      ]);
      return parseWindowsAffinity(stdout);
    }
    if (process.platform === "linux") {
      const { stdout } = await run("taskset", ["-p", String(pid)]);
      return parseTaskset(stdout);
    }
  } catch {
    // Not worth a failed launch: the report just has no CPU count.
  }
  return undefined;
}
```

`perf/poolReports.ts`:

```ts
/**
 * @file Pools the open-time reports of several rounds (one harness run each, interleaving the
 * engines round by round) into one, and prints its tables (`app/electron-client/CLAUDE.md`,
 * "Open-time harness"). Launch numbers become `<round>0<n>` (101, 102, 201, …), all above 0.
 *
 * Usage: corepack pnpm --filter enso exec vite-node perf/poolReports.ts -- <round dir>...
 */
import fs from "node:fs";
import path from "node:path";
import {
  cpusLine,
  ratioTable,
  renderMarkdown,
  spareTable,
  type OpenTimeReport,
} from "./openTimeReport";

/** One report holding every launch of `reports`, which must share platform and template. */
export function poolReports(
  reports: readonly OpenTimeReport[],
): OpenTimeReport {
  const first = reports[0];
  if (first == null) throw new Error("no reports to pool");
  for (const report of reports) {
    if (
      report.platform !== first.platform ||
      report.template !== first.template ||
      report.project !== first.project
    ) {
      throw new Error("the reports are of different platforms or templates");
    }
  }
  return {
    ...first,
    runs: reports.flatMap((report, round) =>
      report.runs.map((run) => ({ ...run, run: (round + 1) * 100 + run.run })),
    ),
  };
}

function main(argv: readonly string[]) {
  const dirs = argv.filter((arg, i) => !(i === 0 && arg === "--"));
  if (dirs.length === 0) {
    console.error("Usage: vite-node perf/poolReports.ts -- <round dir>...");
    process.exitCode = 2;
    return;
  }
  const reports = dirs.map(
    (dir) =>
      JSON.parse(
        fs.readFileSync(path.join(dir, "open-time.json"), "utf8"),
      ) as OpenTimeReport,
  );
  const pooled = poolReports(reports);
  console.log(
    [
      renderMarkdown(pooled, []),
      ratioTable(pooled),
      spareTable(pooled),
      cpusLine(pooled),
    ]
      .filter((part) => part !== "")
      .join("\n\n"),
  );
}

// Run as a script (vite-node), not when a test imports the function above.
if (!process.env.VITEST) main(process.argv.slice(2));
```

- [ ] **Step 4: Run them to see them pass**

Run:
`corepack pnpm --filter enso exec vitest run tests/headless/cpuAffinity.test.ts tests/headless/poolReports.test.ts`
and `corepack pnpm --filter enso run typecheck` Expected: 3 + 2 tests PASS, no
type errors.

- [ ] **Step 5: Commit**

```bash
git add app/electron-client/perf/cpuAffinity.ts app/electron-client/perf/poolReports.ts app/electron-client/tests/headless/cpuAffinity.test.ts app/electron-client/tests/headless/poolReports.test.ts
git commit -m "Open-time harness: read the pinned CPUs, pool rounds (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 21: The harness runs the spare engines

**Files:**

- Modify: `app/electron-client/perf/openTime.ts` (`RssPhase`, `engineEnv`,
  `measureLaunch`, `main`, `writeReport` part of `main`)

**Interfaces:**

- Consumes: `isSpareEngine`, `spareRun`, `spareTable`, `ratioTable`, `cpusLine`
  (Task 19), `cpuAffinity` (Task 20).
- Produces: `perf:open --engines …,jvm-spare,jvm-spare-early,jvm-spare-abandon`;
  marks `<open>:spareWait` (`{ ready }`), `<open>:spareUsed` (`{ used }`), `rss`
  with `phase: 'spareIdle'`.

- [ ] **Step 1: Implement**

Import the new functions (`isSpareEngine`, `spareRun`, `spareTable`,
`ratioTable`, `cpusLine` from `./openTimeReport`; `cpuAffinity` from
`./cpuAffinity`).

Change the RSS phase type:

```ts
type RssPhase = "welcomeShown" | "welcomeShown+30s" | "spareIdle";
```

Add after `const RSS_LATER_MS = 30_000`:

```ts
/* Note [Spare Engines In The Harness]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `jvm-spare` is the JVM with the spare engine on (`project-manager-shim/CLAUDE.md`, "Spare
 * engine"): before each open it waits for that open's spare to print `STANDBY READY` (the shim
 * echoes the spare's stderr), at most `SPARE_WAIT_MS`, which is what a user spends on the dashboard
 * (spec, "Measurement"). Whether it was ready is the `<open>:spareWait` mark. Once the first spare is
 * ready, the engine processes' memory is sampled (`spareIdle`): the spare's idle cost. After each
 * open, `<open>:spareUsed` says whether the shim logged `Spare engine: used`. `jvm-spare-early`
 * opens without waiting, so the spare is still warming up and the open waits for the warm-up;
 * `jvm-spare-abandon` does the same with `enso.standby.abandonWarmUp=true`, which cancels the
 * warm-up when the line arrives (the spec's open question). `jvm` and `jvm-first` run with
 * `ENSO_SPARE_ENGINE=0`, so their numbers are what they were.
 */
const SPARE_WAIT_MS = 15_000;

const countLines = (lines: readonly string[], text: string) =>
  lines.filter((line) => line.includes(text)).length;
```

Replace `engineEnv`:

```ts
/** The environment of an engine's launches, on top of the harness's own. */
function engineEnv(engine: Engine, options: Options): Record<string, string> {
  const jvmOptions =
    options.jvmOptions.trim() === ""
      ? {}
      : { ENSO_JVM_OPTIONS: options.jvmOptions };
  if (engine === "native") return { ENSO_ENGINE_MODE: "native" };
  const jvm = {
    ENSO_ENGINE_MODE: "jvm",
    ENSO_JVM_AOT_DIR: shimAotDirectory(options),
    ...jvmOptions,
  };
  if (!isSpareEngine(engine)) return { ...jvm, ENSO_SPARE_ENGINE: "0" };
  return engine === "jvm-spare-abandon"
    ? { ...jvm, ENSO_ENGINE_ARGS: "--vm.D enso.standby.abandonWarmUp=true" }
    : jvm;
}
```

In `measureLaunch`, after `await ensureWindowSize(app, page, marks)`:

```ts
const cpus = await cpuAffinity(app.process().pid ?? -1);
if (cpus != null) marks.add("cpus", { cpus });
```

and replace the loop over `opens` with:

```ts
for (const tag of opens) {
  if (engine === "jvm-spare") {
    // Note [Spare Engines In The Harness]: this open's spare is the first or the second.
    const expected = tag === "first" ? 1 : 2;
    const ready = await poll(
      async () => countLines(stdoutLines, "STANDBY READY") >= expected,
      SPARE_WAIT_MS,
    );
    marks.add(`${tag}:spareWait`, { ready });
    if (ready && tag === "first") await sampleRss("spareIdle");
  }
  const usedBefore = countLines(stdoutLines, "Spare engine: used");
  await openProject(
    page,
    names[tag],
    tag,
    marks,
    dir,
    options.profile,
    options.extrasMs,
    snapshot,
    project,
    sampleRss,
  );
  if (isSpareEngine(engine)) {
    marks.add(`${tag}:spareUsed`, {
      used: countLines(stdoutLines, "Spare engine: used") > usedBefore,
    });
  }
  await closeProject(page, names[tag]);
  await page.waitForTimeout(2000);
}
```

At the end of `measureLaunch`, before `return {`:

```ts
const spare = isSpareEngine(engine)
  ? spareRun(stdoutLines.join("\n"), marks.list)
  : undefined;
const cpusMark = marks.list.find((m) => m.k === "cpus");
const cpus = typeof cpusMark?.cpus === "number" ? cpusMark.cpus : undefined;
```

and add to the returned object, after `...(rss ? { rss } : {}),`:

```ts
    ...(spare ? { spare } : {}),
    ...(cpus != null ? { cpus } : {}),
```

In `main`, replace the preparation block

```ts
    let prepared: { trainingMs: number; cacheBytes: number } | undefined
    if (engine === 'jvm') {
      try {
        prepared = await prepareShimAot(options, extraEnv)
```

with

```ts
    let prepared: { trainingMs: number; cacheBytes: number } | undefined
    // `jvm` always trains afresh; a spare engine needs a cache too, and reuses one that is there.
    const needsCache =
      engine === 'jvm' ||
      (isSpareEngine(engine) && findShimCache(shimAotDirectory(options)) == null)
    if (needsCache) {
      try {
        prepared = await prepareShimAot(options, { ...extraEnv, ENSO_SPARE_ENGINE: '0' })
```

(the rest of that `try`/`catch` is unchanged), and change
`if (prepared != null) shimAot = { ...prepared, rejectedIn, uncachedIn, uncheckedIn }`
to:

```ts
if (prepared != null && engine === "jvm") {
  shimAot = { ...prepared, rejectedIn, uncachedIn, uncheckedIn };
}
```

After `const markdown = renderMarkdown(report, baseline)`, replace it with:

```ts
const markdown = [
  renderMarkdown(report, baseline),
  ratioTable(report),
  spareTable(report),
  cpusLine(report),
]
  .filter((part) => part !== "")
  .join("\n\n");
```

- [ ] **Step 2: Typecheck and unit tests**

Run: `corepack pnpm --filter enso run typecheck` and
`corepack pnpm --filter enso exec vitest run tests/headless` Expected: PASS.

- [ ] **Step 3: A smoke run**

Build `dist/ide` from this worktree (`ide-local`, as in Task 17). Then:

```bash
corepack pnpm --filter enso run perf:open --out <scratch>/perf-smoke --runs 1 --engines native,jvm-spare --budget-minutes 20
```

Expected: `open-time.md` has the spare table with `Opens that used a spare` =
`2/2` and a ratio row for `jvm-spare`. `jvm-spare-1/rss-spareIdle.json` lists
the spare's processes.

- [ ] **Step 4: Commit**

```bash
git add app/electron-client/perf/openTime.ts
git commit -m "Open-time harness: the jvm-spare engines (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
```

### Task 22: Measure at 8 CPUs, settle the open question, PR 3

**Files:**

- Modify: `app/electron-client/CLAUDE.md` ("Open-time harness")
- Modify (only if abandoning wins):
  `engine/runner/src/main/java/org/enso/runner/Standby.java`,
  `engine/runner/CLAUDE.md`

- [ ] **Step 1: Run the rounds (owner's Windows machine, 32 logical CPUs)**

Close every other IDE (the single-instance lock). Unset the credential variables
(Global Constraints). Run each round under an affinity mask with
`start /affinity`, which the IDE's whole process tree inherits. `FF` is 8 CPUs,
`F` is 4, and no mask is 32. From PowerShell in the worktree:

```powershell
Set-Location C:\Repos\Enso\ide\.claude\worktrees\jvm-measure
if ((Get-Location).Path -ne 'C:\Repos\Enso\ide\.claude\worktrees\jvm-measure') { throw 'not in the worktree' }
$out = 'C:\Repos\Enso\ide\scratchpad\wave1\jvm\measure'
foreach ($cpus in @(@{ n = 8; mask = 'FF' }, @{ n = 4; mask = 'F' }, @{ n = 32; mask = '' })) {
  foreach ($round in 1..3) {
    foreach ($template in 'welcome', 'image') {
      $dir = "$out\cpu$($cpus.n)\$template\r$round"
      $cmd = "corepack pnpm --filter enso run perf:open --out $dir --runs 2 --engines native,jvm,jvm-spare --template $template --budget-minutes 40"
      if ($cpus.mask -ne '') { cmd /c "start `"`" /affinity $($cpus.mask) /wait /b $cmd" } else { cmd /c $cmd }
    }
  }
}
foreach ($round in 1..3) {
  $dir = "$out\cpu8\early\r$round"
  cmd /c "start `"`" /affinity FF /wait /b corepack pnpm --filter enso run perf:open --out $dir --runs 2 --engines jvm,jvm-spare-early,jvm-spare-abandon --budget-minutes 40"
}
```

Expected: each `open-time.md` ends with the `CPUs (the IDE’s affinity): N.` line
for its mask. A round whose line differs is discarded and run again.

- [ ] **Step 2: Pool the rounds**

```bash
for c in 8 4 32; do for t in welcome image; do corepack pnpm --filter enso exec vite-node perf/poolReports.ts -- $(ls -d /c/Repos/Enso/ide/scratchpad/wave1/jvm/measure/cpu$c/$t/r*) > /c/Repos/Enso/ide/scratchpad/wave1/jvm/measure/cpu$c-$t.md; done; done
corepack pnpm --filter enso exec vite-node perf/poolReports.ts -- $(ls -d /c/Repos/Enso/ide/scratchpad/wave1/jvm/measure/cpu8/early/r*) > /c/Repos/Enso/ide/scratchpad/wave1/jvm/measure/cpu8-early.md
```

Expected: six pooled reports with ≥ 5 successful launches per engine (6
attempted), plus the cold/early/abandon one.

- [ ] **Step 3: Settle the open question**

From `cpu8-early.md` and the per-round `open-time.md` files, compare the first
open's `welcomeShown` medians of `jvm` (a cold start), `jvm-spare-early`
(waiting for the warm-up) and `jvm-spare-abandon`, in this order (decision 11):

1. If `jvm-spare-early`'s pooled median is higher than `jvm`'s, waiting for the
   warm-up loses to a cold start, and the spec promises an open during the
   warm-up is "never longer than a cold start". Abandoning becomes the default
   regardless of the margin over waiting; say so, with both medians, in the PR.
2. Otherwise abandoning becomes the default only if its pooled median is lower
   than `jvm-spare-early`'s by at least 150 ms and it is lower in at least 2 of
   the 3 rounds.

If abandoning becomes the default, change `Standby.create`:

```java
        Boolean.parseBoolean(System.getProperty(ABANDON_PROPERTY, "true")));
```

and in `engine/runner/CLAUDE.md` change the line about the property to say
`--vm.D enso.standby.abandonWarmUp=false` waits for a running warm-up instead of
cancelling it, which is the default since #<PR 3's number>. Then run
`sbt -Dsbt.server.forcestart=true "engine-runner/testOnly org.enso.runner.StandbyTest"`
(it constructs `Standby` directly and is unaffected). If abandoning does not
win, change nothing in the engine.

- [ ] **Step 4: Document the engines and the procedure**

In `app/electron-client/CLAUDE.md`, "Open-time harness":

- in the usage line, list the engines as
  `[--engines native,jvm,jvm-first,jvm-spare,jvm-spare-early,jvm-spare-abandon]`;
- after the `jvm-first` bullet, add:

```markdown
- `jvm-spare`, `jvm-spare-early`, `jvm-spare-abandon`: the JVM with the spare
  engine (`project-manager-shim/CLAUDE.md`, "Spare engine"; Note [Spare Engines
  In The Harness]). `jvm-spare` waits before each open for that open's
  `STANDBY READY` (at most 15 s, as a user on the dashboard), samples the
  engine's memory once the first spare is ready (`spareIdle`), and records
  whether each open used a spare. `-early` opens at once, during the warm-up;
  `-abandon` does too, with `enso.standby.abandonWarmUp=true`. They share the
  `jvm` engine's AOT cache (prepared once if missing). `jvm` and `jvm-first` run
  with `ENSO_SPARE_ENGINE=0`. `open-time.md` adds the spare table (ready time,
  warm-up, process CPU at ready, idle MiB, opens that used a spare), the
  headline over native, and the CPUs the IDE was pinned to
  (`perf/cpuAffinity.ts`).
```

- add a paragraph after the gate's paragraph:

```markdown
**At 4 or 8 CPUs** (the re-gate is the first open at 8 CPUs, at most 1.5): pin
the whole run, which the IDE inherits. On Windows, from PowerShell,
`cmd /c "start "" /affinity FF /wait /b corepack pnpm --filter enso run perf:open …"`
(`F` for 4); on Linux
`taskset -c 0-7 corepack pnpm --filter enso run perf:open …`. Each report's last
line says the CPUs it ran on. Interleave the engines by running rounds
(`--runs 2`, three rounds, each its own `--out`), and pool them with
`corepack pnpm --filter enso exec vite-node perf/poolReports.ts -- <round dir>...`.
```

Run Prettier:
`node /c/Repos/Enso/ide/node_modules/prettier/bin/prettier.cjs --write app/electron-client/CLAUDE.md`
(and `engine/runner/CLAUDE.md` if it changed).

- [ ] **Step 5: Commit, push, open PR 3**

```bash
git add app/electron-client/CLAUDE.md
# Only if Step 3 changed the default:
# git add engine/runner/src/main/java/org/enso/runner/Standby.java engine/runner/CLAUDE.md
git commit -m "Open-time harness: document the spare engines and the pinned-CPU rounds (#518)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN"
git push -u origin jvm-warm-engine-3-measure
```

Write the body to `<scratch>/pr3-body.md`. It covers:

- what the harness gains;
- the 8-CPU tables (welcome and image: medians, ratios over native, the spare
  table), with the 4 and 32 CPU ratios beside them;
- the spare's idle memory (MiB), the warm-up's duration and the process CPU at
  ready;
- the comparison of a cold start, waiting for the warm-up and abandoning it, and
  the decision taken;
- whether the re-gate's 1.5 is met at 8 CPUs.

It names the other open-time changes in flight that the re-gate also counts (the
standard Java compiler for the engine's Java, the Language Server startup trims,
the openFile race fix), and ends with `Refs #518` and the generated-with lines.

```bash
gh pr create --base develop --head jvm-warm-engine-3-measure --title "Open-time harness: jvm-spare, and the warm engine at 8 CPUs (#518)" --label "CI: No changelog needed" --body-file <scratch>/pr3-body.md
```

Wait for CI and fix failures this PR caused. Do not merge.

- [ ] **Step 6: Clean up (each part, after its PR is open)**

From outside the worktree: `git -C /c/Repos/Enso/ide worktree remove <worktree>`
and `git -C /c/Repos/Enso/ide branch -D <branch>` (the branch stays on origin).
In WSL: `rm -rf ~/jvm-standby ~/jvm-spare /tmp/standby-gen` (memory: "Agent
clone cleanup").

---

## Self-review

**Spec coverage.**

- Engine standby mode, steps 1-6: Tasks 5, 6, 7 and 8.
- The working-directory change: Tasks 1 and 8; relative paths and processes
  following it, so a spare-served project behaves like a normal one: Task 2.
- Isolation (the context is closed, then deleted): Task 6.
- Failure (warm-up throws): Task 5 test.
- Steps 2-3 on a background thread, and the line waiting for the warm-up:
  Task 5.
- Project-service manager:
  - when a spare exists: Task 12;
  - starting with the spawn key and the temporary directory: Tasks 10 and 11;
  - after a close: Task 12;
  - the take on `project/open`, and a spare still warming up: Task 11;
  - respawns: Task 11 test;
  - failure without a retry loop: Tasks 10 and 12;
  - settings change: Task 12 (setting, key);
  - quit: Tasks 12 and 14;
  - no spare during an AOT training, and a refresh after a new secrets key:
    Tasks 12 and 14;
  - logging: Tasks 10 and 11.
- The setting: Tasks 15 and 16. `engine/setSpare`: Task 13. `ENSO_SPARE_ENGINE`:
  Task 12.
- Error-handling table: covered by Tasks 5, 10, 11 and 12.
- Testing section:
  - engine: Tasks 1, 2, 5 and 8 (the argument line with and without the warm-up,
    then a JSON-RPC session);
  - project service: Tasks 10, 11 and 12;
  - GUI: Tasks 15 and 16;
  - Playwright: Task 17 (stdout and the engine log), with other specs at
    `ENSO_SPARE_ENGINE=0`.
- Measurement (`jvm-spare`, 8 CPUs, idle memory, warm-up duration and CPU,
  interleaving, ≥ 5 runs): Tasks 19, 20, 21 and 22.
- Open questions: the preload list in Tasks 7 and 9; open during the warm-up in
  Tasks 5, 21 and 22.
- Rollout and labels: Tasks 9, 18 and 22.

**Placeholder scan.**

- `NNN` in Task 18 is the PR number, obtained in that same step from
  `gh pr create`.
- `<scratch>` is the executing agent's scratch folder.
- The preload list is generated by a command in Task 7.
- No step defers code.

**Type consistency.**

- `SpareRequest`, `EngineLaunch.spareKey`, `startSpare`, `stopSpare`,
  `spareAvailableAgain` and `hasProjectsInUse` match between Tasks 11, 12
  and 13.
- `TakeResult.kind` is `'taken' | 'none'` everywhere.
- `spareNotice` texts match the tests of Tasks 10 and 11.
- `Standby.create`, `StandbyRequest.parse`/`applyEnvironment` and
  `ContextFactory.WORKING_DIRECTORY_PROPERTY` match between Tasks 1, 4, 5, 7
  and 8.
- `engineRunsOnJvm`, `setPreStartEngine` and `spareEngineSettingsStore` match
  between Tasks 15 and 16.
- `isTraining`, `onTrainingEnded` and `afterKeyChange` match between Tasks 12,
  14 and 18.
- `SpareRun`, `spareRun` and `isSpareEngine` match between Tasks 19 and 21;
  `cpuAffinity` between Tasks 20 and 21.
