# Engine Logs Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Logs** tab in the project view's bottom dock, next to the code
editor, that follows the running engine's log live and scrolls back through the
current project's history, earlier sessions included.

**Architecture:** The project-manager shim captures each open project's engine
output — its stderr, now piped and passed through, and its session `.log` file,
tailed — into a per-project ring buffer of 5,000 numbered events. It serves them
as server-sent events on `GET /api/engine-logs/stream`, which both hosts
(Electron's `Server.process` and the Vite middleware) route behind the #274
same-origin check. The GUI's `useEngineLogStream` reads that stream (with
reconnects that resume from the last sequence number) into a capped, batched row
model. `EngineLogPanel` shows it in a new Logs tab of `BottomPanel`, and history
comes from the existing session-log query.

**Tech Stack:** TypeScript; Node `fs`/`fs.watch`/`string_decoder` in
`app/project-manager-shim` (vitest); Vue 3 + `@vueuse/core` +
`@tanstack/vue-query` in `app/gui` (vitest + jsdom, `mountWithProviders`);
Playwright for the end-to-end spec; Electron main's headless vitest suite.

**Spec:** `docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`
(design PR #277). Read it before starting any task. Where this plan rules on
something the spec leaves open, the ruling is listed at the end ("Rulings").

## Global Constraints

- Use `corepack pnpm`, never bare `pnpm` or `npm`.
- Never run pnpm in WSL against `/mnt/c`. Linux checks run in a clone on the
  Linux filesystem (`~/enso-logs`), after `. ~/.enso-toolchain.sh`.
- Delete `*.tsbuildinfo` and `.eslintcache` (outside `node_modules`) before
  trusting a typecheck or lint.
- In any reused clone or worktree, run
  `corepack pnpm -r --if-present run compile` before a Playwright or Electron
  run, and after changing `enso-common` (text ids, the new `engineLogs` module),
  because the app and the specs import the workspace packages' `dist/`.
- Cast third-party APIs with `as T`, never `as unknown as T`. The stream handler
  takes its own structural request/response interfaces, so neither host nor test
  needs a cast at all.
- This is a feature. PR B carries one CHANGELOG entry under `#### Enso IDE`. PR
  A changes nothing users see, so it takes `CI: No changelog needed`.
- UI PRs carry before/after screenshots. Commit them to the orphan
  `pr-screenshots` branch under `pr-<N>/`, embed them in the PR, and never
  commit them to the feature branch.
- Tests never touch `%APPDATA%\Enso`, `%LOCALAPPDATA%\enso`, `~/.enso` or a real
  engine log directory. Use temporary directories, pass `logDirectory`
  explicitly, and stub `ENSO_LOG_DIRECTORY` with `vi.stubEnv` wherever
  `getEngineLogDirectory()` runs.
- Never close or kill the user's running Enso. No `taskkill`/`pkill` of `enso`,
  `java` or `Enso.exe` by name: the only engines a test stops are its own fake
  children.
- The route is `GET /api/engine-logs/stream`, under `/api/`. Each host
  dispatches it after `acceptLocalRequest`
  (`app/project-manager-shim/src/handler/localRequest.ts`, merged in #274),
  never before.
- Spec values: replay buffer 5,000 events, heartbeat every 15 s, live view
  capped at 20,000 rows, one view update per animation frame, and the endpoint
  `?project=…&after=<seq>`.
- Shortcut: `graph.toggleLogs`, default `Mod+L` (Ruling 1; the spec's
  `Mod+Shift+\`` cannot fire on common layouts).
- Never `git stash`; never `--no-verify`.
- Merge gate: a feature. Both PRs wait for the user's test. Retarget PR B to
  `develop` before merging PR A, and do not `--delete-branch` PR A's branch
  while PR B is based on it.
- End commit messages with the executing session's attribution trailers.

---

## Branches, worktrees and PRs

| PR  | Branch                                           | Worktree                  | Tasks | Changelog                       |
| --- | ------------------------------------------------ | ------------------------- | ----- | ------------------------------- |
| A   | `feature/engine-logs-shim` (on `origin/develop`) | `C:\Repos\Enso\ide-logs1` | 0–4   | label `CI: No changelog needed` |
| B   | `feature/engine-logs-panel` (on PR A)            | `C:\Repos\Enso\ide-logs2` | 5–8   | entry under `#### Enso IDE`     |

- **PR A, "Engine logs, PR 1: the shim streams an open project's engine log".**
  It covers the tailer, the stderr capture, the replay buffer and the SSE route
  in both hosts. The engine's stderr still reaches the terminal, and nothing
  else changes for users.
- **PR B, "Engine logs, PR 2: the Logs tab".** It covers the client, the panel,
  the dock tabs, the shortcut, the Playwright spec, the changelog, the docs and
  the screenshots.

The design branch `design/engine-logs-panel` (worktree `C:\Repos\Enso\ide-logs`,
draft PR #277) carries only the spec and this plan.

## File map

**PR A**

- Create `app/common/src/services/engineLogs.ts`, with its test in
  `app/common/src/services/__tests__/engineLogs.test.ts`. It holds the wire
  format shared by the shim and the GUI.
- Create in `app/project-manager-shim/src/engineLogs/`:
  - `lineSplitter.ts`, `logFileTailer.ts`, `sessionFiles.ts` (Task 1)
  - `replayBuffer.ts`, `channel.ts`, `hub.ts` (Task 2)
  - their tests in `__tests__/`
- Modify `app/project-manager-shim/src/projectService/ensoRunner.ts`: add the
  `EngineLogSink`, pipe stderr, and add the `openProject` parameter.
- Modify `app/project-manager-shim/src/projectService/index.ts`: add the
  `engineLogs` hub, and open and close a channel with each project.
- Create `app/project-manager-shim/src/handler/engineLogs.ts`, with its test.
  Modify `handler/index.ts`, and add a case to `__tests__/localRequest.test.ts`.
- Modify `app/electron-client/src/server.ts`, with a test in
  `tests/headless/server.test.ts`.
- Modify `app/gui/project-manager-shim-middleware/index.ts`.
- Docs: `app/project-manager-shim/CLAUDE.md`, `app/electron-client/CLAUDE.md`.

**PR B**

- Create in `app/gui/src/project-view/components/EngineLogs/`:
  - `engineLogModel.ts`, `engineLogStream.ts`, `engineLogHistory.ts` (Task 5)
  - `engineLogView.ts`, `EngineLogList.vue`, `EngineLogPanel.vue` (Task 6)
  - `CLAUDE.md`
  - `__tests__/` (with `fakeEventSource.ts`)
- Modify `app/gui/src/components/ProjectLog/projectLogData.ts` to export
  `LOG_LEVELS` and drop `@internal` from `parseEntry`.
- Create `app/gui/src/project-view/components/BottomPanel/dockTab.ts` and
  `BottomPanelTabs.vue`, with tests in `__tests__/`. Modify
  `app/gui/src/project-view/components/BottomPanel.vue`.
- Modify `app/gui/src/project-view/components/GraphEditor.vue`.
- Modify `app/gui/src/configurations/graphInputBindings.ts` and
  `__tests__/keyboardShortcuts.test.ts`.
- Modify `app/gui/src/project-view/providers/action.ts`.
- Modify `app/common/src/text/english.json` and `app/common/src/text.ts`.
- Modify `app/gui/integration-test/mock/localApi.ts`, and create
  `integration-test/project-view/engineLogs.spec.ts`.
- Docs: `CHANGELOG.md`, `app/gui/CLAUDE.md`,
  `app/gui/integration-test/CLAUDE.md`.

---

## PR A: the shim streams the engine log

### Task 0: Bring the worktrees up to date with #274

The design worktree predates #274: `origin/develop` is at `fe32249ee0`, and
`app/project-manager-shim/src/handler/localRequest.ts` is missing from
`C:\Repos\Enso\ide-logs`.

**Files:** none changed by hand.

- [ ] **Step 1: Merge `origin/develop` into the design branch**

```bash
cd /c/Repos/Enso/ide-logs
git fetch origin
git merge --no-edit origin/develop
test -f app/project-manager-shim/src/handler/localRequest.ts && echo HAS_274
git push origin design/engine-logs-panel
```

Expected: `HAS_274`, and the push updates draft PR #277.

- [ ] **Step 2: Create PR A's worktree from `origin/develop`**

```bash
cd /c/Repos/Enso/ide
git worktree add -b feature/engine-logs-shim /c/Repos/Enso/ide-logs1 origin/develop
cd /c/Repos/Enso/ide-logs1
git merge-base --is-ancestor fe32249ee0 HEAD && echo HAS_274
corepack pnpm install --frozen-lockfile
corepack pnpm -r --if-present run compile
```

Expected: `HAS_274`, and the install and compile succeed.

- [ ] **Step 3: Record the baseline**

```bash
cd /c/Repos/Enso/ide-logs1/app/project-manager-shim && corepack pnpm exec vitest run
cd ../electron-client && corepack pnpm exec vitest run tests/headless/server.test.ts
```

Expected: both pass. Write any failure into the task ledger as pre-existing
before you change anything.

---

### Task 1: Follow a log file (line splitting, tailing, roll-over, finding the session's file)

**Files:**

- Create: `app/project-manager-shim/src/engineLogs/lineSplitter.ts`
- Create: `app/project-manager-shim/src/engineLogs/logFileTailer.ts`
- Create: `app/project-manager-shim/src/engineLogs/sessionFiles.ts`
- Test:
  `app/project-manager-shim/src/engineLogs/__tests__/lineSplitter.test.ts`,
  `logFileTailer.test.ts`, `sessionFiles.test.ts`

**Interfaces:**

- Consumes: nothing new. The file names follow `LogbackSetup.setupFileAppender`
  (`lib/scala/logging-service-logback/src/main/java/org/enso/logging/service/logback/LogbackSetup.java:198-298`):
  - the active file is
    `<logRoot>/<projectLocalId>/<prefix>-yyyy-MM-dd-HH-mm-ss.log`
  - archives are `<prefix>-<date>-<time>.<i>.log.gz`
  - a roll renames the active file away and creates a new file with the same
    name.
- Produces:

```ts
// lineSplitter.ts
export const MAX_LINE_LENGTH = 65_536;
export class LineSplitter {
  push(chunk: Buffer | string): string[]; // completed lines; `\r\n` and `\n` both end a line
  flush(): string[]; // the partial last line, if any
}
// logFileTailer.ts
export const DEFAULT_POLL_MS = 500;
export interface LogFileTailerOptions {
  readonly pollMs?: number | undefined;
}
export class LogFileTailer {
  constructor(
    file: string,
    onLines: (lines: readonly string[]) => void,
    options?: LogFileTailerOptions,
  );
  readonly file: string;
  start(): void; // fs.watch on the directory + poll timer
  poll(): Promise<void>; // read what was appended; concurrent calls merge
  stop(): Promise<void>; // final read, emits a partial last line
}
// sessionFiles.ts
export function listActiveLogsSync(directory: string): string[]; // file names; [] when missing
export function findNewSessionLog(
  directory: string,
  known: ReadonlySet<string>,
): Promise<string | undefined>; // full path
```

- [ ] **Step 1: Write the failing tests**

`app/project-manager-shim/src/engineLogs/__tests__/lineSplitter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { LineSplitter, MAX_LINE_LENGTH } from "../lineSplitter.js";

describe("LineSplitter", () => {
  test("returns complete lines and keeps a partial one", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("one\ntw")).toEqual(["one"]);
    expect(splitter.push("o\nthree")).toEqual(["two"]);
    expect(splitter.flush()).toEqual(["three"]);
    expect(splitter.flush()).toEqual([]);
  });

  test("drops the carriage return of CRLF line ends, even across chunks", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\r\nb\r")).toEqual(["a"]);
    expect(splitter.push("\n")).toEqual(["b"]);
  });

  test("keeps a multi-byte character split across chunks", () => {
    const splitter = new LineSplitter();
    const bytes = Buffer.from("é\n", "utf8");
    expect(splitter.push(bytes.subarray(0, 1))).toEqual([]);
    expect(splitter.push(bytes.subarray(1))).toEqual(["é"]);
  });

  test("keeps empty lines", () => {
    expect(new LineSplitter().push("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  test("emits an over-long partial line in pieces", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("x".repeat(MAX_LINE_LENGTH * 2 + 5))).toEqual([
      "x".repeat(MAX_LINE_LENGTH),
      "x".repeat(MAX_LINE_LENGTH),
    ]);
    expect(splitter.flush()).toEqual(["xxxxx"]);
  });
});
```

`app/project-manager-shim/src/engineLogs/__tests__/logFileTailer.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LogFileTailer } from "../logFileTailer.js";

let dir: string;
let tailer: LogFileTailer | undefined;
let lines: string[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-log-tail-"));
  lines = [];
});

afterEach(async () => {
  await tailer?.stop();
  tailer = undefined;
  await fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

function follow(file: string) {
  tailer = new LogFileTailer(file, (more) => lines.push(...more), {
    pollMs: 20,
  });
  return tailer;
}

describe("LogFileTailer", () => {
  test("reads a file from its start, then what is appended", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "one\ntwo\n");
    const t = follow(file);
    await t.poll();
    expect(lines).toEqual(["one", "two"]);
    await fs.appendFile(file, "three\n");
    await t.poll();
    expect(lines).toEqual(["one", "two", "three"]);
  });

  test("keeps a partial line until it is completed", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "par");
    const t = follow(file);
    await t.poll();
    expect(lines).toEqual([]);
    await fs.appendFile(file, "tial\n");
    await t.poll();
    expect(lines).toEqual(["partial"]);
  });

  test("waits for a file that does not exist yet", async () => {
    const file = path.join(dir, "later.log");
    const t = follow(file);
    await t.poll();
    expect(lines).toEqual([]);
    await fs.writeFile(file, "hello\n");
    await t.poll();
    expect(lines).toEqual(["hello"]);
  });

  test("starts again from the beginning when the file is truncated", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "old line one\nold line two\n");
    const t = follow(file);
    await t.poll();
    await fs.writeFile(file, "new\n");
    await t.poll();
    expect(lines).toEqual(["old line one", "old line two", "new"]);
  });

  test("starts again from the beginning when the file is replaced (roll-over)", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "before roll\n");
    const t = follow(file);
    await t.poll();
    // As logback rolls: the active file is renamed away and a new one takes its name. The new
    // one is longer, so only its identity (not its size) can tell it apart.
    await fs.rename(file, path.join(dir, "a.0.log"));
    await fs.writeFile(file, "after roll, a longer first line\n");
    await t.poll();
    expect(lines).toEqual(["before roll", "after roll, a longer first line"]);
  });

  test("emits the partial last line of a rolled file before the new file", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "tail without newline");
    const t = follow(file);
    await t.poll();
    await fs.rename(file, path.join(dir, "a.0.log"));
    await fs.writeFile(file, "fresh\n");
    await t.poll();
    expect(lines).toEqual(["tail without newline", "fresh"]);
  });

  test("follows appends on its own once started", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "");
    follow(file).start();
    await fs.appendFile(file, "live\n");
    await vi.waitFor(() => expect(lines).toEqual(["live"]), { timeout: 2_000 });
  });

  test("stop reads the last lines and emits a partial line", async () => {
    const file = path.join(dir, "a.log");
    await fs.writeFile(file, "");
    const t = follow(file);
    t.start();
    await fs.appendFile(file, "done\nno newline");
    await t.stop();
    expect(lines).toEqual(["done", "no newline"]);
  });
});
```

`app/project-manager-shim/src/engineLogs/__tests__/sessionFiles.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findNewSessionLog, listActiveLogsSync } from "../sessionFiles.js";

const OLDER = "enso-language-server-2026-10-20-09-00-00";
const NEWER = "enso-language-server-2026-10-20-10-00-00";
const NEWEST = "enso-language-server-2026-10-20-11-00-00";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-log-sessions-"));
});

afterEach(async () => {
  await fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

async function touch(name: string) {
  await fs.writeFile(path.join(dir, name), "");
}

describe("listActiveLogsSync", () => {
  test("lists the active session logs only", async () => {
    await touch(`${OLDER}.log`);
    await touch(`${OLDER}.0.log.gz`);
    await touch("notes.txt");
    await touch("enso.log");
    expect(listActiveLogsSync(dir)).toEqual([`${OLDER}.log`]);
  });

  test("is empty for a directory that does not exist", () => {
    expect(listActiveLogsSync(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("findNewSessionLog", () => {
  test("finds the newest active log that was not listed before", async () => {
    await touch(`${OLDER}.log`);
    await touch(`${NEWEST}.log`);
    await touch(`${NEWER}.log`);
    await touch(`${NEWEST}.1.log.gz`);
    expect(await findNewSessionLog(dir, new Set([`${OLDER}.log`]))).toBe(
      path.join(dir, `${NEWEST}.log`),
    );
  });

  test("is undefined while there is no new log, or no directory", async () => {
    await touch(`${OLDER}.log`);
    expect(
      await findNewSessionLog(dir, new Set([`${OLDER}.log`])),
    ).toBeUndefined();
    expect(
      await findNewSessionLog(path.join(dir, "missing"), new Set()),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run:
`cd app/project-manager-shim && corepack pnpm exec vitest run src/engineLogs`

Expected: FAIL. Each suite reports
`Failed to resolve import "../lineSplitter.js"` (or `../logFileTailer.js`,
`../sessionFiles.js`).

- [ ] **Step 3: Implement**

`app/project-manager-shim/src/engineLogs/lineSplitter.ts`:

```ts
/** @file Split a stream of text chunks into lines, keeping a partial last line until it completes. */
import { StringDecoder } from "node:string_decoder";

/**
 * The longest line kept whole. A longer run without a newline (a runaway write) is emitted in
 * pieces of this length, so that a partial line cannot grow without bound.
 */
export const MAX_LINE_LENGTH = 65_536;

/** Splits chunks of UTF-8 bytes (or text) into lines on `\n`, dropping a `\r` before it. */
export class LineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";

  /**
   * Add a chunk.
   * @returns The lines it completes. A multi-byte character split across chunks is kept whole.
   */
  push(chunk: Buffer | string): string[] {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const parts = (this.pending + text).split("\n");
    this.pending = parts.pop() ?? "";
    const lines = parts.map(stripCarriageReturn);
    while (this.pending.length > MAX_LINE_LENGTH) {
      lines.push(this.pending.slice(0, MAX_LINE_LENGTH));
      this.pending = this.pending.slice(MAX_LINE_LENGTH);
    }
    return lines;
  }

  /** The partial last line, if any, as a line of its own; the splitter is then empty. */
  flush(): string[] {
    const rest = this.pending + this.decoder.end();
    this.pending = "";
    return rest === "" ? [] : [stripCarriageReturn(rest)];
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
```

`app/project-manager-shim/src/engineLogs/logFileTailer.ts`:

```ts
/**
 * @file Follow a growing log file: read what is appended, and start again from the beginning when
 * the file is replaced or truncated (the engine's roll-over).
 */
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LineSplitter } from "./lineSplitter.js";

/** How often the file is read when no change is reported: `fs.watch` misses some file systems. */
export const DEFAULT_POLL_MS = 500;
const READ_CHUNK_BYTES = 64 * 1024;

/** Options for {@link LogFileTailer}. */
export interface LogFileTailerOptions {
  readonly pollMs?: number | undefined;
}

/**
 * Follows one log file from its start. It reads on a timer, and whenever `fs.watch` reports a
 * change in the file's directory. The directory is watched rather than the file, because the
 * engine's roll-over renames the file and creates a new one with the same name.
 *
 * A file that is smaller than the read offset, or that is another file (another inode or creation
 * time), has been rolled over: the partial last line of the old one is emitted, and reading starts
 * again at offset 0. Lines appended to the old file between the last read and the roll-over are not
 * read here; they are in the rolled archive.
 *
 * The file is opened only for each read, never held open, so the engine can rename it on Windows.
 */
export class LogFileTailer {
  private offset = 0;
  private identity: string | undefined;
  private readonly splitter = new LineSplitter();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watcher: fsSync.FSWatcher | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;
  private stopped = false;
  private readonly pollMs: number;

  /** Follow `file`, calling `onLines` with each batch of completed lines. */
  constructor(
    readonly file: string,
    private readonly onLines: (lines: readonly string[]) => void,
    options: LogFileTailerOptions = {},
  ) {
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  /** Start reading on the timer and on change notifications. */
  start(): void {
    try {
      this.watcher = fsSync.watch(path.dirname(this.file), (_event, name) => {
        if (name == null || name === path.basename(this.file)) void this.poll();
      });
      this.watcher.on("error", () => this.closeWatcher());
    } catch {
      // No watching (the directory is missing, or the file system cannot): the timer still reads.
    }
    this.schedule();
    void this.poll();
  }

  /** Read whatever has been appended. Calls made while a read runs are merged into one more read. */
  poll(): Promise<void> {
    if (this.running != null) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.readOnce();
        } while (this.rerun);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** Stop following. The last read runs first, and a partial last line is emitted. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    this.closeWatcher();
    await this.poll();
    this.emit(this.splitter.flush());
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.schedule());
    }, this.pollMs);
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private emit(lines: readonly string[]): void {
    if (lines.length > 0) this.onLines(lines);
  }

  private async readOnce(): Promise<void> {
    try {
      let stat: fsSync.Stats;
      try {
        stat = await fs.stat(this.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      const identity = `${stat.ino}:${stat.birthtimeMs}`;
      if (
        this.identity != null &&
        (identity !== this.identity || stat.size < this.offset)
      ) {
        // Rolled over: what is left of the old file's last line is all of it we will read.
        this.emit(this.splitter.flush());
        this.offset = 0;
      }
      this.identity = identity;
      if (stat.size <= this.offset) return;
      const handle = await fs.open(this.file, "r");
      try {
        const buffer = Buffer.alloc(READ_CHUNK_BYTES);
        while (this.offset < stat.size) {
          const length = Math.min(buffer.length, stat.size - this.offset);
          const { bytesRead } = await handle.read(
            buffer,
            0,
            length,
            this.offset,
          );
          if (bytesRead === 0) break;
          this.offset += bytesRead;
          this.emit(this.splitter.push(buffer.subarray(0, bytesRead)));
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error(`Failed to read the engine log '${this.file}':`, error);
    }
  }
}
```

`app/project-manager-shim/src/engineLogs/sessionFiles.ts`:

```ts
/**
 * @file Find a project's engine log files: the active `.log` file of each session, in the
 * project's own log directory (`<engine log directory>/<local project key>`).
 */
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * An active session log, `<prefix>-yyyy-MM-dd-HH-mm-ss.log`, as `LogbackSetup.setupFileAppender`
 * names it. Rolled archives (`….N.log.gz`) do not match.
 */
const ACTIVE_LOG = /^(.+)-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.log$/;

/** The names of the active session logs in `directory`; none when it does not exist. */
export function listActiveLogsSync(directory: string): string[] {
  try {
    return fsSync
      .readdirSync(directory)
      .filter((name) => ACTIVE_LOG.test(name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/**
 * The newest active session log in `directory` whose name is not in `known`: the log of an engine
 * started after `known` was listed.
 * @returns Its full path, or `undefined` while there is none.
 */
export async function findNewSessionLog(
  directory: string,
  known: ReadonlySet<string>,
): Promise<string | undefined> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  const fresh = names.filter(
    (name) => ACTIVE_LOG.test(name) && !known.has(name),
  );
  fresh.sort(compareByTimestamp);
  const newest = fresh.at(-1);
  return newest == null ? undefined : path.join(directory, newest);
}

function compareByTimestamp(a: string, b: string): number {
  const timeA = ACTIVE_LOG.exec(a)?.[2] ?? "";
  const timeB = ACTIVE_LOG.exec(b)?.[2] ?? "";
  return timeA === timeB ? a.localeCompare(b) : timeA.localeCompare(timeB);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run:
`cd app/project-manager-shim && corepack pnpm exec vitest run src/engineLogs && corepack pnpm exec tsc --noEmit -p . && corepack pnpm exec eslint src/engineLogs`

Expected: PASS (17 tests: 5 splitter, 8 tailer, 4 session files); `tsc` and
`eslint` print nothing.

- [ ] **Step 5: Commit**

```bash
git add app/project-manager-shim/src/engineLogs
git commit -m "Engine logs: split lines and follow a rolling log file"
```

---

### Task 2: Per-project channel — wire format, replay buffer, session switch

**Files:**

- Create: `app/common/src/services/engineLogs.ts`
- Test: `app/common/src/services/__tests__/engineLogs.test.ts`
- Create: `app/project-manager-shim/src/engineLogs/replayBuffer.ts`,
  `channel.ts`, `hub.ts`
- Test:
  `app/project-manager-shim/src/engineLogs/__tests__/replayBuffer.test.ts`,
  `channel.test.ts`

**Interfaces:**

- Consumes (Task 1): `LineSplitter`, `LogFileTailer`, `listActiveLogsSync` and
  `findNewSessionLog`.
- Consumes (existing):
  `encodeSessionId(localProjectKey: string, baseName: string): string` from
  `app/project-manager-shim/src/handler/filesystem.ts:587-589`. It is the id
  format `listProjectSessions` reports.
- Produces (`enso-common/src/services/engineLogs`):

```ts
export const ENGINE_LOG_STREAM_PATH = "/api/engine-logs/stream";
export const ENGINE_LOG_HEARTBEAT_MS = 15_000;
export const ENGINE_LOG_REPLAY_CAPACITY = 5_000;
export type EngineLogSource = "file" | "stderr";
export interface EngineLogLineData {
  readonly seq: number;
  readonly source: EngineLogSource;
  readonly sessionId: string | null;
  readonly text: string;
}
export interface EngineLogSessionData {
  readonly seq: number;
  readonly sessionId: string;
  readonly logFile: string;
}
export interface EngineLogWaitingData {
  readonly seq: number;
}
export interface EngineLogHelloData {
  readonly channel: string;
  readonly oldestSeq: number;
  readonly nextSeq: number;
  readonly sessionId: string | null;
  readonly logFile: string | null;
}
export type EngineLogEndReason = "closed" | "not-open";
export interface EngineLogEndData {
  readonly reason: EngineLogEndReason;
}
export function engineLogStreamUrl(
  project: string,
  resume?: { readonly channel: string; readonly after: number },
): string;
```

- Produces (shim):

```ts
// replayBuffer.ts
export type Sequenced<T> = T & { readonly seq: number };
export class ReplayBuffer<T extends object> {
  constructor(capacity: number);
  readonly capacity: number;
  get nextSeq(): number;
  get oldestSeq(): number; // nextSeq when empty
  push(event: T): Sequenced<T>;
  since(after?: number): Sequenced<T>[];
}
// channel.ts
export type EngineLogEvent =
  | {
      readonly type: "line";
      readonly source: EngineLogSource;
      readonly sessionId: string | null;
      readonly text: string;
    }
  | {
      readonly type: "session";
      readonly sessionId: string;
      readonly logFile: string;
    }
  | { readonly type: "waiting" };
export type SequencedEngineLogEvent = Sequenced<EngineLogEvent>;
export interface EngineLogSubscriber {
  readonly event: (event: SequencedEngineLogEvent) => void;
  readonly end: (reason: EngineLogEndReason) => void;
}
export interface EngineLogSubscription {
  readonly hello: EngineLogHelloData;
  readonly replay: readonly SequencedEngineLogEvent[];
  readonly closed: boolean;
  readonly unsubscribe: () => void;
}
export interface EngineLogResume {
  readonly channel?: string | undefined;
  readonly after?: number | undefined;
}
export interface EngineLogChannelOptions {
  readonly projectPath: string;
  readonly logDirectory: string;
  readonly localProjectKey: string;
  readonly pollMs?: number | undefined;
  readonly capacity?: number | undefined;
}
export class EngineLogChannel {
  // implements EngineLogSink (Task 3) structurally
  constructor(options: EngineLogChannelOptions);
  readonly id: string;
  get projectPath(): string;
  get logDirectory(): string;
  get isOpen(): boolean;
  onClosed(callback: () => void): void;
  engineStarted(): void;
  engineStderr(chunk: Buffer): void;
  projectClosed(): void;
  close(): Promise<void>;
  subscribe(
    subscriber: EngineLogSubscriber,
    resume?: EngineLogResume,
  ): EngineLogSubscription;
}
// hub.ts
export function projectKey(projectPath: string): string;
export class EngineLogHub {
  constructor(defaults?: {
    readonly pollMs?: number | undefined;
    readonly capacity?: number | undefined;
  });
  open(
    options: Omit<EngineLogChannelOptions, "pollMs" | "capacity">,
  ): EngineLogChannel;
  get(projectPath: string): EngineLogChannel | undefined;
}
```

- [ ] **Step 1: Write the failing tests**

`app/common/src/services/__tests__/engineLogs.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ENGINE_LOG_STREAM_PATH, engineLogStreamUrl } from "../engineLogs";

describe("engineLogStreamUrl", () => {
  test("names the project", () => {
    const url = new URL(
      engineLogStreamUrl("project-%2Fp%2FMy Project"),
      "http://localhost",
    );
    expect(url.pathname).toBe(ENGINE_LOG_STREAM_PATH);
    expect(url.searchParams.get("project")).toBe("project-%2Fp%2FMy Project");
    expect(url.searchParams.has("after")).toBe(false);
  });

  test("resumes after a sequence number of a channel", () => {
    const url = new URL(
      engineLogStreamUrl("project-x", { channel: "c1", after: 41 }),
      "http://h",
    );
    expect(url.searchParams.get("channel")).toBe("c1");
    expect(url.searchParams.get("after")).toBe("41");
  });
});
```

`app/project-manager-shim/src/engineLogs/__tests__/replayBuffer.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ReplayBuffer } from "../replayBuffer.js";

describe("ReplayBuffer", () => {
  test("numbers events from 1 and replays them oldest first", () => {
    const buffer = new ReplayBuffer<{ text: string }>(10);
    expect(buffer.oldestSeq).toBe(1);
    expect(buffer.nextSeq).toBe(1);
    expect(buffer.push({ text: "a" })).toEqual({ text: "a", seq: 1 });
    buffer.push({ text: "b" });
    buffer.push({ text: "c" });
    expect(buffer.since().map((e) => e.text)).toEqual(["a", "b", "c"]);
    expect(buffer.since(1).map((e) => e.seq)).toEqual([2, 3]);
    expect(buffer.since(3)).toEqual([]);
  });

  test("keeps the newest events when full", () => {
    const buffer = new ReplayBuffer<{ n: number }>(3);
    for (let n = 1; n <= 5; n++) buffer.push({ n });
    expect(buffer.oldestSeq).toBe(3);
    expect(buffer.nextSeq).toBe(6);
    expect(buffer.since().map((e) => e.n)).toEqual([3, 4, 5]);
    // An `after` older than the buffer replays what is left.
    expect(buffer.since(1).map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(buffer.since(4).map((e) => e.seq)).toEqual([5]);
  });

  test("refuses a capacity below one", () => {
    expect(() => new ReplayBuffer(0)).toThrow("Invalid capacity 0.");
  });
});
```

`app/project-manager-shim/src/engineLogs/__tests__/channel.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encodeSessionId } from "../../handler/filesystem.js";
import type {
  EngineLogChannel,
  EngineLogSubscriber,
  SequencedEngineLogEvent,
} from "../channel.js";
import { EngineLogHub } from "../hub.js";

const KEY = "project-key";
const FIRST = "enso-language-server-2026-10-20-10-00-00";
const SECOND = "enso-language-server-2026-10-20-10-05-00";
const NOOP: EngineLogSubscriber = { event: () => {}, end: () => {} };

let root: string;
let logDirectory: string;
let projectPath: string;
let hub: EngineLogHub;
let channel: EngineLogChannel;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-log-channel-"));
  logDirectory = path.join(root, "logs", KEY);
  projectPath = path.join(root, "Project");
  hub = new EngineLogHub({ pollMs: 20 });
  channel = hub.open({ projectPath, logDirectory, localProjectKey: KEY });
});

afterEach(async () => {
  await channel.close();
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

function collect() {
  const events: SequencedEngineLogEvent[] = [];
  const ends: string[] = [];
  channel.subscribe({
    event: (event) => events.push(event),
    end: (reason) => ends.push(reason),
  });
  const lines = (source?: "file" | "stderr") =>
    events.flatMap((event) =>
      event.type === "line" && (source == null || event.source === source)
        ? [event.text]
        : [],
    );
  const types = () => events.map((event) => event.type);
  return { events, ends, lines, types };
}

async function writeLog(baseName: string, content: string) {
  await fs.mkdir(logDirectory, { recursive: true });
  await fs.appendFile(path.join(logDirectory, `${baseName}.log`), content);
}

describe("EngineLogChannel", () => {
  test("a started engine is waiting until its log file appears, then the file is followed", async () => {
    const log = collect();
    channel.engineStarted();
    await vi.waitFor(() => expect(log.types()).toEqual(["waiting"]));
    await writeLog(FIRST, "[INFO] [2026-10-20T10:00:00Z] [x] started\n");
    await vi.waitFor(() =>
      expect(log.lines("file")).toEqual([
        "[INFO] [2026-10-20T10:00:00Z] [x] started",
      ]),
    );
    expect(log.events).toEqual([
      { type: "waiting", seq: 1 },
      {
        type: "session",
        seq: 2,
        sessionId: encodeSessionId(KEY, FIRST),
        logFile: path.join(logDirectory, `${FIRST}.log`),
      },
      {
        type: "line",
        seq: 3,
        source: "file",
        sessionId: encodeSessionId(KEY, FIRST),
        text: "[INFO] [2026-10-20T10:00:00Z] [x] started",
      },
    ]);
  });

  test("ignores the logs of earlier sessions", async () => {
    await writeLog(FIRST, "old\n");
    const log = collect();
    channel.engineStarted();
    await vi.waitFor(() => expect(log.types()).toEqual(["waiting"]));
    await writeLog(SECOND, "new\n");
    await vi.waitFor(() => expect(log.lines("file")).toEqual(["new"]));
  });

  test("tags and splits stderr, keeping a partial line until it completes", () => {
    const log = collect();
    channel.engineStderr(Buffer.from("Exception in thread\n  at Foo"));
    expect(log.lines("stderr")).toEqual(["Exception in thread"]);
    channel.engineStderr(Buffer.from(".bar\n"));
    expect(log.lines("stderr")).toEqual([
      "Exception in thread",
      "  at Foo.bar",
    ]);
    expect(
      log.events.every(
        (event) => event.type === "line" && event.sessionId === null,
      ),
    ).toBe(true);
  });

  test("a respawn switches to the new session's file", async () => {
    const log = collect();
    channel.engineStarted();
    await writeLog(FIRST, "a1\n");
    await vi.waitFor(() => expect(log.lines("file")).toEqual(["a1"]));
    channel.engineStderr(Buffer.from("crash\n"));
    channel.engineStarted();
    await vi.waitFor(() =>
      expect(log.types().filter((t) => t === "waiting")).toHaveLength(2),
    );
    await writeLog(SECOND, "b1\n");
    await vi.waitFor(() => expect(log.lines("file")).toEqual(["a1", "b1"]));
    expect(log.types()).toEqual([
      "waiting",
      "session",
      "line",
      "line",
      "waiting",
      "session",
      "line",
    ]);
    expect(log.events.at(-1)).toMatchObject({
      type: "line",
      source: "file",
      sessionId: encodeSessionId(KEY, SECOND),
      text: "b1",
    });
  });

  test("replays its buffer, after a sequence number of the same channel only", () => {
    channel.engineStderr(Buffer.from("1\n2\n3\n"));
    const all = channel.subscribe(NOOP);
    all.unsubscribe();
    expect(all.hello).toEqual({
      channel: channel.id,
      oldestSeq: 1,
      nextSeq: 4,
      sessionId: null,
      logFile: null,
    });
    expect(all.replay.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(
      channel
        .subscribe(NOOP, { channel: channel.id, after: 2 })
        .replay.map((e) => e.seq),
    ).toEqual([3]);
    expect(
      channel
        .subscribe(NOOP, { channel: "from-before-a-restart", after: 2 })
        .replay.map((e) => e.seq),
    ).toEqual([1, 2, 3]);
  });

  test("keeps the newest events in its buffer", async () => {
    const small = new EngineLogHub({ pollMs: 20, capacity: 3 }).open({
      projectPath: path.join(root, "Other"),
      logDirectory,
      localProjectKey: KEY,
    });
    small.engineStderr(Buffer.from("1\n2\n3\n4\n5\n"));
    const { hello, replay } = small.subscribe(NOOP);
    expect(hello).toMatchObject({ oldestSeq: 3, nextSeq: 6 });
    expect(replay.map((event) => event.seq)).toEqual([3, 4, 5]);
    await small.close();
  });

  test("closing flushes a partial stderr line, ends subscribers, and takes nothing more", async () => {
    const log = collect();
    channel.engineStderr(Buffer.from("last words"));
    await channel.close();
    expect(log.lines("stderr")).toEqual(["last words"]);
    expect(log.ends).toEqual(["closed"]);
    expect(hub.get(projectPath)).toBeUndefined();
    channel.engineStderr(Buffer.from("after close\n"));
    channel.engineStarted();
    expect(log.events).toHaveLength(1);
    expect(channel.subscribe(NOOP).closed).toBe(true);
  });

  test("closing stops following the file", async () => {
    const log = collect();
    channel.engineStarted();
    await writeLog(FIRST, "x\n");
    await vi.waitFor(() => expect(log.lines("file")).toEqual(["x"]));
    await channel.close();
    await writeLog(FIRST, "y\n");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(log.lines("file")).toEqual(["x"]);
  });
});

describe("EngineLogHub", () => {
  test("gives the open channel for the same project, however its path is spelled", async () => {
    const samePath = path.join(root, "Project", "..", "Project");
    expect(
      hub.open({ projectPath: samePath, logDirectory, localProjectKey: KEY }),
    ).toBe(channel);
    if (process.platform === "win32")
      expect(hub.get(projectPath.toUpperCase())).toBe(channel);
    await channel.close();
    const reopened = hub.open({
      projectPath,
      logDirectory,
      localProjectKey: KEY,
    });
    expect(reopened).not.toBe(channel);
    expect(reopened.id).not.toBe(channel.id);
    await reopened.close();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run:
`cd app/common && corepack pnpm exec vitest run src/services/__tests__/engineLogs.test.ts`
and `cd ../project-manager-shim && corepack pnpm exec vitest run src/engineLogs`

Expected: FAIL. The suites report `Failed to resolve import "../engineLogs"`,
`"../replayBuffer.js"` and `"../hub.js"`, while Task 1's suites still pass.

- [ ] **Step 3: Implement**

`app/common/src/services/engineLogs.ts`:

```ts
/**
 * @file The wire format of the engine log stream, `GET /api/engine-logs/stream`, shared by the
 * project-manager shim, which serves it, and the GUI, which reads it. See
 * `docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`.
 *
 * The stream is server-sent events: `hello`, then the buffered events after `after`, then live
 * ones (`line`, `session`, `waiting`), a `: heartbeat` comment every
 * {@link ENGINE_LOG_HEARTBEAT_MS}, and `end` when the project closes.
 */

/** The stream's path on the app's local server. */
export const ENGINE_LOG_STREAM_PATH = "/api/engine-logs/stream";
/** How often the server writes a comment, so that idle connections stay open. */
export const ENGINE_LOG_HEARTBEAT_MS = 15_000;
/** How many of the newest events the server keeps per project, to replay on (re)connection. */
export const ENGINE_LOG_REPLAY_CAPACITY = 5_000;

/** Where a line came from: the session's log file, or the engine's stderr. */
export type EngineLogSource = "file" | "stderr";

/** `line`: one line of the log, as the engine wrote it. */
export interface EngineLogLineData {
  readonly seq: number;
  readonly source: EngineLogSource;
  /** The session's id, as `listProjectSessions` reports it; `null` before its file exists. */
  readonly sessionId: string | null;
  readonly text: string;
}

/** `session`: the engine's session log file has been found (after a start or a restart). */
export interface EngineLogSessionData {
  readonly seq: number;
  readonly sessionId: string;
  readonly logFile: string;
}

/** `waiting`: an engine has started and its session log file does not exist yet. */
export interface EngineLogWaitingData {
  readonly seq: number;
}

/** `hello`: the first event of every connection. */
export interface EngineLogHelloData {
  /** Identifies this opening of the project; `after` applies only to the same channel. */
  readonly channel: string;
  /** The oldest sequence number the server still holds: anything older was dropped. */
  readonly oldestSeq: number;
  readonly nextSeq: number;
  /** The current session, if its file has been found. */
  readonly sessionId: string | null;
  readonly logFile: string | null;
}

/** Why the stream ended: the project closed, or it was not open. The client does not reconnect. */
export type EngineLogEndReason = "closed" | "not-open";

/** `end`: the last event of a stream. */
export interface EngineLogEndData {
  readonly reason: EngineLogEndReason;
}

/** The stream's URL for a project (its id in the GUI); `resume` continues a dropped stream. */
export function engineLogStreamUrl(
  project: string,
  resume?: { readonly channel: string; readonly after: number },
): string {
  const params = new URLSearchParams({ project });
  if (resume != null) {
    params.set("channel", resume.channel);
    params.set("after", String(resume.after));
  }
  return `${ENGINE_LOG_STREAM_PATH}?${params.toString()}`;
}
```

`app/project-manager-shim/src/engineLogs/replayBuffer.ts`:

```ts
/** @file A fixed-size buffer of the most recent events, each numbered in arrival order. */

/** An event with its sequence number: 1 for the first event, one more for each after it. */
export type Sequenced<T> = T & { readonly seq: number };

/** Keeps the newest `capacity` events, numbered consecutively from 1. */
export class ReplayBuffer<T extends object> {
  private readonly items: (Sequenced<T> | undefined)[];
  private start = 0;
  private count = 0;
  private next = 1;

  /** Create a buffer for `capacity` events. */
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Invalid capacity ${capacity}.`);
    }
    this.items = new Array<Sequenced<T> | undefined>(capacity);
  }

  /** The number the next event will get. */
  get nextSeq(): number {
    return this.next;
  }

  /** The number of the oldest event held; {@link nextSeq} when the buffer is empty. */
  get oldestSeq(): number {
    return this.next - this.count;
  }

  /** Add an event, dropping the oldest when full. */
  push(event: T): Sequenced<T> {
    const item: Sequenced<T> = { ...event, seq: this.next };
    this.next += 1;
    this.items[(this.start + this.count) % this.capacity] = item;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
    return item;
  }

  /** The events held with a number above `after`, oldest first; all of them without `after`. */
  since(after?: number): Sequenced<T>[] {
    const oldest = this.oldestSeq;
    const from = after == null ? oldest : Math.max(after + 1, oldest);
    const result: Sequenced<T>[] = [];
    for (let seq = from; seq < this.next; seq++) {
      result.push(this.items[(this.start + (seq - oldest)) % this.capacity]!);
    }
    return result;
  }
}
```

`app/project-manager-shim/src/engineLogs/channel.ts`:

```ts
/**
 * @file The engine log of one open project: where its lines come from (stderr and the session's
 * log file), its replay buffer, and its subscribers.
 */
import * as crypto from "node:crypto";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  ENGINE_LOG_REPLAY_CAPACITY,
  type EngineLogEndReason,
  type EngineLogHelloData,
  type EngineLogSource,
} from "enso-common/src/services/engineLogs";
import { encodeSessionId } from "../handler/filesystem.js";
import { LineSplitter } from "./lineSplitter.js";
import { DEFAULT_POLL_MS, LogFileTailer } from "./logFileTailer.js";
import { ReplayBuffer, type Sequenced } from "./replayBuffer.js";
import { findNewSessionLog, listActiveLogsSync } from "./sessionFiles.js";

/** An engine log event, before the buffer numbers it. */
export type EngineLogEvent =
  | {
      readonly type: "line";
      readonly source: EngineLogSource;
      readonly sessionId: string | null;
      readonly text: string;
    }
  | {
      readonly type: "session";
      readonly sessionId: string;
      readonly logFile: string;
    }
  | { readonly type: "waiting" };

/** An engine log event with its sequence number. */
export type SequencedEngineLogEvent = Sequenced<EngineLogEvent>;

/** Receives a channel's live events. */
export interface EngineLogSubscriber {
  /** An event that arrived after the subscription. */
  readonly event: (event: SequencedEngineLogEvent) => void;
  /** The channel has closed: there will be no more events. */
  readonly end: (reason: EngineLogEndReason) => void;
}

/** What {@link EngineLogChannel.subscribe} gives a new subscriber. */
export interface EngineLogSubscription {
  readonly hello: EngineLogHelloData;
  /** The buffered events to send before any live one, oldest first. */
  readonly replay: readonly SequencedEngineLogEvent[];
  /** Whether the channel had already closed: send the replay, then end. */
  readonly closed: boolean;
  readonly unsubscribe: () => void;
}

/** Where a reconnecting subscriber left off. */
export interface EngineLogResume {
  readonly channel?: string | undefined;
  readonly after?: number | undefined;
}

/** Options for {@link EngineLogChannel}. */
export interface EngineLogChannelOptions {
  readonly projectPath: string;
  /** The project's own log directory: `<engine log directory>/<local project key>`. */
  readonly logDirectory: string;
  readonly localProjectKey: string;
  readonly pollMs?: number | undefined;
  readonly capacity?: number | undefined;
}

/**
 * The engine log of one open project. It is opened before the engine starts, and is fed by the
 * runner through the `EngineLogSink` methods (`engineStarted`, `engineStderr`, `projectClosed`).
 *
 * Each engine start emits `waiting`, then looks for the session's log file: the newest active log
 * in the project's log directory that was not there when the engine started. When it appears,
 * `session` is emitted and the file is followed. stderr lines are emitted as they arrive, tagged
 * with the session found so far (`null` before the file exists).
 */
export class EngineLogChannel {
  readonly id: string = crypto.randomUUID();
  private readonly buffer: ReplayBuffer<EngineLogEvent>;
  private readonly subscribers = new Set<EngineLogSubscriber>();
  private readonly closedCallbacks: (() => void)[] = [];
  private readonly pollMs: number;
  private stderrLines = new LineSplitter();
  private tailer: LogFileTailer | undefined;
  private finderTimer: ReturnType<typeof setInterval> | undefined;
  private finderWatcher: fsSync.FSWatcher | undefined;
  private generation = 0;
  private sessionId: string | null = null;
  private logFile: string | null = null;
  private state: "open" | "closing" | "closed" = "open";
  private closing: Promise<void> | undefined;

  /** Create the channel of a project that is being opened. */
  constructor(private readonly options: EngineLogChannelOptions) {
    this.buffer = new ReplayBuffer(
      options.capacity ?? ENGINE_LOG_REPLAY_CAPACITY,
    );
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  /** The project's directory. */
  get projectPath(): string {
    return this.options.projectPath;
  }

  /** The directory the project's session logs are written to. */
  get logDirectory(): string {
    return this.options.logDirectory;
  }

  /** Whether the channel still takes events. */
  get isOpen(): boolean {
    return this.state === "open";
  }

  /** Call `callback` once the channel has closed. */
  onClosed(callback: () => void): void {
    this.closedCallbacks.push(callback);
  }

  /** An engine process has started: the first one, or a respawn after a crash. */
  engineStarted(): void {
    if (this.state !== "open") return;
    this.emitLines("stderr", this.stderrLines.flush(), this.sessionId);
    this.stderrLines = new LineSplitter();
    this.stopFinder();
    const previous = this.tailer;
    this.tailer = undefined;
    this.sessionId = null;
    this.logFile = null;
    const generation = ++this.generation;
    // Listed now, before the new engine can create its file.
    const known = new Set(listActiveLogsSync(this.options.logDirectory));
    // The old session's last lines come before the new session's `waiting`.
    void (previous?.stop() ?? Promise.resolve()).then(() => {
      if (generation !== this.generation || this.state !== "open") return;
      this.push({ type: "waiting" });
      this.startFinder(generation, known);
    });
  }

  /** A chunk the engine wrote to stderr. */
  engineStderr(chunk: Buffer): void {
    if (this.state !== "open") return;
    this.emitLines("stderr", this.stderrLines.push(chunk), this.sessionId);
  }

  /** The project has closed. */
  projectClosed(): void {
    void this.close();
  }

  /** Stop following, end every subscriber, and forget the channel. Calls after the first wait for it. */
  close(): Promise<void> {
    if (this.closing != null) return this.closing;
    this.state = "closing";
    this.stopFinder();
    this.closing = (async () => {
      this.emitLines("stderr", this.stderrLines.flush(), this.sessionId);
      const tailer = this.tailer;
      this.tailer = undefined;
      await tailer?.stop();
      this.state = "closed";
      for (const subscriber of this.subscribers) subscriber.end("closed");
      this.subscribers.clear();
      for (const callback of this.closedCallbacks) callback();
    })();
    return this.closing;
  }

  /**
   * Subscribe to live events. The replay holds the buffered events after `resume.after`, or all of
   * them when `resume.channel` is not this channel (a reconnection across a reopening).
   */
  subscribe(
    subscriber: EngineLogSubscriber,
    resume: EngineLogResume = {},
  ): EngineLogSubscription {
    const after = resume.channel === this.id ? resume.after : undefined;
    const hello: EngineLogHelloData = {
      channel: this.id,
      oldestSeq: this.buffer.oldestSeq,
      nextSeq: this.buffer.nextSeq,
      sessionId: this.sessionId,
      logFile: this.logFile,
    };
    const replay = this.buffer.since(after);
    if (this.state === "closed") {
      return { hello, replay, closed: true, unsubscribe: () => {} };
    }
    this.subscribers.add(subscriber);
    return {
      hello,
      replay,
      closed: false,
      unsubscribe: () => this.subscribers.delete(subscriber),
    };
  }

  private push(event: EngineLogEvent): void {
    if (this.state === "closed") return;
    const sequenced = this.buffer.push(event);
    for (const subscriber of this.subscribers) subscriber.event(sequenced);
  }

  private emitLines(
    source: EngineLogSource,
    lines: readonly string[],
    sessionId: string | null,
  ): void {
    for (const text of lines)
      this.push({ type: "line", source, sessionId, text });
  }

  private startFinder(generation: number, known: ReadonlySet<string>): void {
    const look = async () => {
      const current = () =>
        generation === this.generation &&
        this.state === "open" &&
        this.tailer == null;
      if (!current()) return;
      let file: string | undefined;
      try {
        file = await findNewSessionLog(this.options.logDirectory, known);
      } catch (error) {
        console.error(`Failed to list '${this.options.logDirectory}':`, error);
      }
      if (file != null && current()) this.attach(file);
    };
    this.finderTimer = setInterval(() => void look(), this.pollMs);
    try {
      this.finderWatcher = fsSync.watch(
        this.options.logDirectory,
        () => void look(),
      );
      this.finderWatcher.on("error", () => this.closeFinderWatcher());
    } catch {
      // The directory does not exist until the engine creates it: the timer looks meanwhile.
    }
    void look();
  }

  private stopFinder(): void {
    clearInterval(this.finderTimer);
    this.finderTimer = undefined;
    this.closeFinderWatcher();
  }

  private closeFinderWatcher(): void {
    this.finderWatcher?.close();
    this.finderWatcher = undefined;
  }

  private attach(file: string): void {
    this.stopFinder();
    const sessionId = encodeSessionId(
      this.options.localProjectKey,
      path.basename(file, ".log"),
    );
    this.sessionId = sessionId;
    this.logFile = file;
    this.push({ type: "session", sessionId, logFile: file });
    const tailer = new LogFileTailer(
      file,
      (lines) => this.emitLines("file", lines, sessionId),
      {
        pollMs: this.pollMs,
      },
    );
    this.tailer = tailer;
    tailer.start();
  }
}
```

`app/project-manager-shim/src/engineLogs/hub.ts`:

```ts
/** @file The engine log channels of a host's open projects, by project directory. */
import * as path from "node:path";
import { EngineLogChannel, type EngineLogChannelOptions } from "./channel.js";

/** A project directory as a map key: resolved, and lower case on Windows (paths are case-blind there). */
export function projectKey(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** One {@link EngineLogChannel} per open project. A closed channel is forgotten. */
export class EngineLogHub {
  private readonly channels = new Map<string, EngineLogChannel>();

  /** Create a hub; `defaults` apply to every channel (tests shorten the poll). */
  constructor(
    private readonly defaults: {
      readonly pollMs?: number | undefined;
      readonly capacity?: number | undefined;
    } = {},
  ) {}

  /** The project's open channel, or a new one. */
  open(
    options: Omit<EngineLogChannelOptions, "pollMs" | "capacity">,
  ): EngineLogChannel {
    const key = projectKey(options.projectPath);
    const existing = this.channels.get(key);
    if (existing?.isOpen === true) return existing;
    const channel = new EngineLogChannel({
      ...options,
      pollMs: this.defaults.pollMs,
      capacity: this.defaults.capacity,
    });
    this.channels.set(key, channel);
    channel.onClosed(() => {
      if (this.channels.get(key) === channel) this.channels.delete(key);
    });
    return channel;
  }

  /** The channel of the project at `projectPath`, while it is open. */
  get(projectPath: string): EngineLogChannel | undefined {
    return this.channels.get(projectKey(projectPath));
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run:

```bash
cd app/common && corepack pnpm exec vitest run src/services/__tests__/engineLogs.test.ts && corepack pnpm run typecheck
cd ../project-manager-shim && corepack pnpm exec vitest run src/engineLogs && corepack pnpm exec tsc --noEmit -p . && corepack pnpm exec eslint src/engineLogs
```

Expected: PASS (common 2 tests; shim 17 from Task 1, plus 3 buffer and 9
channel/hub tests), with no output from `tsc` or `eslint`.

- [ ] **Step 5: Commit**

```bash
git add app/common/src/services/engineLogs.ts app/common/src/services/__tests__/engineLogs.test.ts app/project-manager-shim/src/engineLogs
git commit -m "Engine logs: per-project channel with a numbered replay buffer and session switching"
```

---

### Task 3: Capture the engine's stderr, and give every opened project a channel

**Files:**

- Modify: `app/project-manager-shim/src/projectService/ensoRunner.ts`:
  - the imports (lines 1–5)
  - `Runner.openProject` (lines 27–32)
  - after `Socket` (line 63)
  - `OpenedProject` (constructor 99–114, `create` 116–130, `close` 132–149)
  - `EnsoRunner.openProject` (373–445, spawn `stdio` at line 424)
- Modify: `app/project-manager-shim/src/projectService/index.ts`:
  - the imports (1–27)
  - a new field after `versioningWarnings` (line 95)
  - `projectEnvVars` (204–215)
  - `runProject` (218–227)
  - `openProject` (230–278)
  - `closeProject` (281–293)
- Test:
  `app/project-manager-shim/src/projectService/__tests__/engineStderr.test.ts`
  (create), `__tests__/lifecycle.test.ts` (add a `describe`)

**Interfaces:**

- Consumes (Task 2): `EngineLogHub`, `EngineLogChannel` (which satisfies
  `EngineLogSink` structurally), and `getEngineLogDirectory()` from
  `src/distributionManager.ts`.
- Consumes:
  `makeProjectTelemetryKey(projectsDirectory, projectId): Promise<string>` from
  `enso-common/src/services/ProjectManager/projectIdentity`.
- Produces:

```ts
// ensoRunner.ts
export interface EngineLogSink {
  engineStarted(): void
  engineStderr(chunk: Buffer): void
  projectClosed(): void
}
// Runner.openProject gains a fifth parameter:
openProject(projectPath: Path, projectId: string, extraArgs?: readonly string[], extraEnv?: readonly (readonly [string, string])[], logSink?: EngineLogSink): Promise<LanguageServerSockets>
// index.ts
class ProjectService { readonly engineLogs: EngineLogHub }
```

- [ ] **Step 1: Write the failing tests**

`app/project-manager-shim/src/projectService/__tests__/engineStderr.test.ts`:

```ts
/**
 * @file The runner pipes an opened project's engine stderr: every chunk still reaches this
 * process's stderr, and the project's `EngineLogSink` sees each start, each chunk and the close.
 * The engine is a fake `enso`: a Node script that answers the health check, writes to stderr and
 * crashes when a `<project>.crash` file appears.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EnsoRunner, type EngineLogSink } from "../ensoRunner.js";
import { Path } from "../types.js";

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const server = http.createServer((_request, response) => response.end('ok'))
server.listen(Number(value('--rpc-port')), '127.0.0.1')
const startsFile = project + '.starts'
const starts = (fs.existsSync(startsFile) ? Number(fs.readFileSync(startsFile, 'utf8')) : 0) + 1
fs.writeFileSync(startsFile, String(starts))
process.stderr.write('engine ' + starts + ' started\\n')
const stop = () => process.exit(0)
process.stdin.on('data', stop)
process.stdin.on('end', stop)
const crash = setInterval(() => {
  if (fs.existsSync(project + '.crash')) {
    fs.rmSync(project + '.crash')
    clearInterval(crash)
    process.stderr.write('crashing now\\n')
    process.exit(3)
  }
}, 20)
`;

let root: string;
let runner: EnsoRunner;

/** Write the fake executable: a `.bat` on Windows (as the runner expects), a script elsewhere. */
async function fakeEnso(directory: string): Promise<Path> {
  const script = path.join(directory, "fake-enso.mjs");
  await fs.writeFile(script, FAKE_ENSO);
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

function recordingSink() {
  const calls: string[] = [];
  const chunks: string[] = [];
  const sink: EngineLogSink = {
    engineStarted: () => void calls.push("started"),
    engineStderr: (chunk) => {
      calls.push("stderr");
      chunks.push(chunk.toString("utf8"));
    },
    projectClosed: () => void calls.push("closed"),
  };
  return {
    sink,
    calls,
    stderr: () => chunks.join("").replaceAll("\r\n", "\n"),
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-stderr-"));
  runner = new EnsoRunner(await fakeEnso(root));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});

test("the engine's stderr reaches the sink and this process's stderr, start by start", async () => {
  const written: string[] = [];
  // `as T` (not `as unknown as T`): `write` is overloaded, and this is its first overload's shape.
  vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    written.push(Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write);
  const { sink, calls, stderr } = recordingSink();
  const project = Path(path.join(root, "Project"));
  await runner.openProject(project, "id", undefined, undefined, sink);
  await vi.waitFor(() => expect(stderr()).toContain("engine 1 started\n"), {
    timeout: 15_000,
  });
  expect(calls[0]).toBe("started");

  await fs.writeFile(`${project}.crash`, "");
  await vi.waitFor(() => expect(stderr()).toContain("engine 2 started\n"), {
    timeout: 15_000,
  });
  expect(stderr()).toContain("crashing now\n");
  expect(calls.filter((call) => call === "started")).toHaveLength(2);
  expect(written.join("")).toContain("engine 1 started");
  expect(written.join("")).toContain("crashing now");

  await runner.closeProject(project);
  expect(calls.at(-1)).toBe("closed");
}, 45_000);
```

Add to
`app/project-manager-shim/src/projectService/__tests__/lifecycle.test.ts`. First
the imports, merged into the existing ones:

```ts
import { makeProjectTelemetryKey } from "enso-common/src/services/ProjectManager/projectIdentity";
import type { EngineLogSink, Runner } from "../ensoRunner.js";
```

`Runner` is already imported as a type; add `EngineLogSink` to the same import.
Then this `describe` at the end of the file:

```ts
describe("engine logs", () => {
  const SOCKETS = {
    jsonSocket: { host: "127.0.0.1", port: 1 },
    ydocSocket: { host: "127.0.0.1", port: 2 },
  };

  beforeEach(() => {
    vi.stubEnv("ENSO_LOG_DIRECTORY", path.join(root, "logs"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("opening a project opens its log channel in the project's log directory; closing closes it", async () => {
    const projectPath = await createProject(path.join(root, "P"), "id-1");
    let sink: EngineLogSink | undefined;
    const openProject: Runner["openProject"] = async (
      _path,
      _id,
      _args,
      _env,
      logSink,
    ) => {
      sink = logSink;
      return SOCKETS;
    };
    const logs = new ProjectService({ ...fakeRunner(), openProject }, []);
    await logs.openProject(UUID("id-1"), Path(root));
    const channel = logs.engineLogs.get(projectPath);
    expect(channel).toBeDefined();
    expect(sink).toBe(channel);
    const key = await makeProjectTelemetryKey(Path(root), "id-1");
    expect(channel!.logDirectory).toBe(path.join(root, "logs", key));
    await logs.closeProject(UUID("id-1"), Path(root));
    expect(logs.engineLogs.get(projectPath)).toBeUndefined();
  });

  test("a failed open closes the channel", async () => {
    const projectPath = await createProject(path.join(root, "P"), "id-1");
    const openProject: Runner["openProject"] = async () => {
      throw new Error("Language server startup timeout");
    };
    const logs = new ProjectService({ ...fakeRunner(), openProject }, []);
    await expect(logs.openProject(UUID("id-1"), Path(root))).rejects.toThrow(
      "startup timeout",
    );
    expect(logs.engineLogs.get(projectPath)).toBeUndefined();
  });
});
```

(`createProject` from `localMetadata/__tests__/testUtils.js` returns the project
directory. `fakeRunner`, `root` and the `trash` mock are already in this file.)

- [ ] **Step 2: Run the tests to see them fail**

Run:
`cd app/project-manager-shim && corepack pnpm exec vitest run src/projectService/__tests__/engineStderr.test.ts src/projectService/__tests__/lifecycle.test.ts`

Expected: FAIL. `engineStderr` fails with
`SyntaxError: The requested module '../ensoRunner.js' does not provide an export named 'EngineLogSink'`
(or a type error under `tsc`), or with `calls[0]` being `undefined`. The
`engine logs` tests fail on `logs.engineLogs` being `undefined`.

- [ ] **Step 3: Implement the runner side** (`ensoRunner.ts`)

Replace the `childProcess` import (lines 2–5):

```ts
import {
  WatchedChildProcess,
  type ChildProcessHandle,
  type UnexpectedExitInfo,
} from "enso-common/src/utilities/childProcess";
```

In `Runner` (lines 27–32), give `openProject` a fifth parameter:

```ts
  openProject(
    projectPath: Path,
    projectId: string,
    extraArgs?: readonly string[],
    extraEnv?: readonly (readonly [string, string])[],
    logSink?: EngineLogSink,
  ): Promise<LanguageServerSockets>
```

After `interface Socket` (line 63), add:

```ts
/**
 * Where an opened project's engine output goes, besides this process's own stderr: the engine
 * logs panel (`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`).
 */
export interface EngineLogSink {
  /** An engine process has started (the first, or a respawn): a new log session begins. */
  engineStarted(): void;
  /** A chunk the engine wrote to stderr. It has already been written to this process's stderr. */
  engineStderr(chunk: Buffer): void;
  /** The project has closed; no engine will start for it again. */
  projectClosed(): void;
}
```

In `OpenedProject`, change the constructor (99–114):

```ts
  private constructor(
    private path: Path,
    public sockets: LanguageServerSockets,
    spawner: () => Promise<childProcess.ChildProcess>,
    private readonly logSink: EngineLogSink | undefined,
  ) {
    this.loaded = this.loadedDeferred.promise
    this.loadedDeferred.promise.catch(() => undefined)
    this.watcher = new WatchedChildProcess(spawner, {
      onChildStarted: (handle) => {
        this.captureStderr(handle)
        this.startLoadingRoutine()
      },
      onUnexpectedExit: (reason, info) => this.onUnexpectedExit(reason, info),
      crashLoopLimit: {
        maxCrashes: LANGUAGE_SERVER_CRASH_LOOP_MAX,
        windowMs: LANGUAGE_SERVER_CRASH_LOOP_WINDOW_MS,
      },
    })
  }
```

and `create` (116–130):

```ts
  static async create(
    path: Path,
    jsonPort: number,
    ydocPort: number,
    spawner: () => Promise<childProcess.ChildProcess>,
    logSink?: EngineLogSink,
  ) {
    const sockets = {
      jsonSocket: { host: '127.0.0.1', port: jsonPort },
      ydocSocket: { host: '127.0.0.1', port: ydocPort },
    }
    const project = new OpenedProject(path, sockets, spawner, logSink)
    // Surface synchronous spawn failures (bad executable path, etc.) to the caller.
    await project.watcher.firstSpawn
    return project
  }
```

In `close()` (132–149), right after `await this.gracefulShutdown()`, add:

```ts
// The engine has exited: its log is complete. Closed before the hooks, which may take a while.
this.logSink?.projectClosed();
```

Add this method after `close()`:

```ts
  /**
   * Pass the engine's stderr through to this process's stderr, as when it was inherited, and to the
   * log sink. It is read even without a sink: an unread pipe would fill up and block the engine.
   */
  private captureStderr(handle: ChildProcessHandle): void {
    this.logSink?.engineStarted()
    handle.child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      this.logSink?.engineStderr(chunk)
    })
  }
```

In `EnsoRunner.openProject` (373–445):

1. Add the parameter `logSink?: EngineLogSink` after `extraEnv`.
2. Pass it as the fifth argument of
   `OpenedProject.create(projectPath, jsonPort, ydocPort, () => …, logSink)`.
3. Change the spawn's `stdio: ['pipe', 'inherit', 'inherit']` (line 424) to
   `stdio: ['pipe', 'inherit', 'pipe']`.

- [ ] **Step 4: Implement the service side** (`projectService/index.ts`)

Add to the imports:

```ts
import * as path from "node:path";
import { getEngineLogDirectory } from "../distributionManager.js";
import { EngineLogHub } from "../engineLogs/hub.js";
```

After `private readonly versioningWarnings = new Map<string, string>()` (line
95), add:

```ts
  /** The engine logs of the open projects, served by `GET /api/engine-logs/stream`. */
  readonly engineLogs = new EngineLogHub()
```

Replace `projectEnvVars` (204–215):

```ts
  private projectEnvVars(localProjectKey: string): readonly (readonly [string, string])[] {
    const localSessionId = `localprojectsession-${KSUID.randomSync().string}`
    return [
      ['ENSO_LOCAL_PROJECT_ID', localProjectKey],
      ['ENSO_LOCAL_PROJECT_SESSION_ID', localSessionId],
      ...(this.extraEnvironment?.() ?? []),
    ]
  }
```

In `runProject`, change the second argument of `this.runner.runProject` to:

```ts
      this.projectEnvVars(await makeProjectTelemetryKey(projectsDirectory, projectId)),
```

In `openProject`, replace the block that starts at
`// Start the language server` and ends at the `this.runner.openProject(...)`
call with:

```ts
// The log channel opens before the engine starts, so that its start-up is in the replay buffer.
const localProjectKey = await makeProjectTelemetryKey(
  projectsDirectory,
  projectId,
);
const engineLog = this.engineLogs.open({
  projectPath: project.path,
  logDirectory: path.join(getEngineLogDirectory(), localProjectKey),
  localProjectKey,
});

// Start the language server
let sockets: LanguageServerSockets;
try {
  sockets = await this.runner.openProject(
    project.path,
    projectId,
    this.extraArgs.length > 0 ? this.extraArgs : undefined,
    this.projectEnvVars(localProjectKey),
    engineLog,
  );
} catch (error) {
  await engineLog.close();
  throw error;
}
```

In `closeProject`, right after `await this.runner.closeProject(project.path)`,
add:

```ts
// The runner closes it too when the engine stops (`projectClosed`); this covers runners that do not.
await this.engineLogs.get(project.path)?.close();
```

- [ ] **Step 5: Run the tests to see them pass**

Run:

```bash
cd app/project-manager-shim
corepack pnpm exec vitest run src/projectService src/engineLogs
corepack pnpm exec tsc --noEmit -p . && corepack pnpm exec eslint src/projectService src/engineLogs
```

Expected: PASS. That covers `engineStderr`, `lifecycle` (the two new tests
included), `runningProjects`, `ProjectService` and the `extra environment` test,
which still finds `ENSO_LOCAL_PROJECT_ID`. `tsc` and `eslint` print nothing.

- [ ] **Step 6: Commit**

```bash
git add app/project-manager-shim/src/projectService
git commit -m "Engine logs: pipe the engine's stderr and open a log channel with each project"
```

---

### Task 4: `GET /api/engine-logs/stream` in both hosts, and PR A

**Files:**

- Create: `app/project-manager-shim/src/handler/engineLogs.ts`
- Modify: `app/project-manager-shim/src/handler/index.ts` (add an export)
- Test: `app/project-manager-shim/src/handler/__tests__/engineLogs.test.ts`
  (create), `__tests__/localRequest.test.ts` (add a test)
- Modify: `app/electron-client/src/server.ts`. That is the import from
  `project-manager-shim/handler` (lines 17–22 on `develop`) and `process()`
  (lines 329–352).
- Test: `app/electron-client/tests/headless/server.test.ts` (inside
  `describe('requests')`)
- Modify: `app/gui/project-manager-shim-middleware/index.ts`. That is the import
  (lines 45–50) and `handler()` (lines 133–145).
- Modify: `app/project-manager-shim/CLAUDE.md`, `app/electron-client/CLAUDE.md`

**Interfaces:**

- Consumes (Task 2/3): `EngineLogHub.get`, `EngineLogChannel.subscribe`,
  `SequencedEngineLogEvent`, and `ProjectService.engineLogs`.
- Consumes (common): `ENGINE_LOG_STREAM_PATH`, `ENGINE_LOG_HEARTBEAT_MS`,
  `EngineLogEndReason`, `extractTypeAndPath`, `ProjectId` and `AssetType` from
  `enso-common/src/services/Backend`.
- Consumes (#274): `acceptLocalRequest`, which both hosts already run first.
- Produces (`project-manager-shim/handler`):

```ts
export interface EventStreamRequest {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
  once(event: "close", listener: () => void): unknown;
}
export interface EventStreamResponse {
  writeHead(statusCode: number, headers: Record<string, string>): unknown;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(chunk?: string): unknown;
}
export interface EngineLogStreamOptions {
  readonly heartbeatMs?: number | undefined;
}
export function isEngineLogStreamRequest(url: string): boolean;
export function formatServerSentEvent(event: string, data: unknown): string;
export function formatEngineLogEvent(event: SequencedEngineLogEvent): string;
export function handleEngineLogStream(
  request: EventStreamRequest,
  response: EventStreamResponse,
  hub: EngineLogHub | undefined,
  headers: Readonly<Record<string, string>>,
  options?: EngineLogStreamOptions,
): void;
```

- [ ] **Step 1: Write the failing tests**

`app/project-manager-shim/src/handler/__tests__/engineLogs.test.ts`:

```ts
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EngineLogChannel } from "../../engineLogs/channel.js";
import { EngineLogHub } from "../../engineLogs/hub.js";
import {
  handleEngineLogStream,
  isEngineLogStreamRequest,
  type EngineLogStreamOptions,
  type EventStreamRequest,
  type EventStreamResponse,
} from "../engineLogs.js";

class FakeRequest extends EventEmitter implements EventStreamRequest {
  constructor(
    readonly url: string,
    readonly method = "GET",
  ) {
    super();
  }
}

class FakeResponse implements EventStreamResponse {
  status: number | undefined;
  headers: Record<string, string> = {};
  readonly chunks: string[] = [];
  ended = false;

  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    if (this.ended) throw new Error("write after end");
    this.chunks.push(chunk);
    return true;
  }
  end(chunk?: string) {
    if (chunk != null) this.chunks.push(chunk);
    this.ended = true;
    return this;
  }
  get body() {
    return this.chunks.join("");
  }
  /** The events written, as `[name, data]`. */
  events(): [string, unknown][] {
    return this.body
      .split("\n\n")
      .filter((block) => block.startsWith("event: "))
      .map((block) => {
        const [eventLine = "", dataLine = ""] = block.split("\n");
        return [
          eventLine.slice("event: ".length),
          JSON.parse(dataLine.slice("data: ".length)),
        ];
      });
  }
}

const HEADERS = { "Cross-Origin-Resource-Policy": "same-origin" };

let root: string;
let projectPath: string;
let hub: EngineLogHub;
let channel: EngineLogChannel;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-log-stream-"));
  projectPath = path.join(root, "Project");
  hub = new EngineLogHub({ pollMs: 20 });
  channel = hub.open({
    projectPath,
    logDirectory: path.join(root, "logs", "key"),
    localProjectKey: "key",
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await channel.close();
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

/** The query naming the project as the GUI does: its asset id, `project-<encoded path>`. */
function projectQuery(extra = "") {
  return `${new URLSearchParams({ project: `project-${encodeURIComponent(projectPath)}` })}${extra}`;
}

function open(
  query: string,
  hubArg: EngineLogHub | undefined = hub,
  options: EngineLogStreamOptions = {},
  method = "GET",
) {
  const request = new FakeRequest(`/api/engine-logs/stream?${query}`, method);
  const response = new FakeResponse();
  handleEngineLogStream(request, response, hubArg, HEADERS, options);
  return { request, response };
}

describe("isEngineLogStreamRequest", () => {
  test("recognises the route, with or without a query", () => {
    expect(isEngineLogStreamRequest("/api/engine-logs/stream")).toBe(true);
    expect(isEngineLogStreamRequest("/api/engine-logs/stream?project=x")).toBe(
      true,
    );
    expect(isEngineLogStreamRequest("/api/engine-logs")).toBe(false);
    expect(isEngineLogStreamRequest("/api/project-service/project/open")).toBe(
      false,
    );
  });
});

describe("handleEngineLogStream", () => {
  test("answers a project that is not open with an event stream that ends at once", () => {
    for (const hubArg of [hub, undefined]) {
      const { response } = open(
        new URLSearchParams({ project: "project-%2Fnowhere" }).toString(),
        hubArg,
      );
      expect(response.status).toBe(200);
      expect(response.headers["Content-Type"]).toBe(
        "text/event-stream; charset=utf-8",
      );
      expect(response.headers["Cache-Control"]).toBe("no-cache, no-transform");
      expect(response.headers["Cross-Origin-Resource-Policy"]).toBe(
        "same-origin",
      );
      expect(response.events()).toEqual([["end", { reason: "not-open" }]]);
      expect(response.ended).toBe(true);
    }
  });

  test.each([
    ["no project", ""],
    ["the id of something other than a project", "project=directory-%252Fx"],
    ["a negative `after`", "project=project-x&after=-1"],
    ["a `after` that is not a number", "project=project-x&after=soon"],
  ])("refuses %s", (_, query) => {
    const { response } = open(query);
    expect(response.status).toBe(400);
    expect(response.ended).toBe(true);
  });

  test("refuses anything but GET", () => {
    const { response } = open(projectQuery(), hub, {}, "POST");
    expect(response.status).toBe(405);
    expect(response.headers["Allow"]).toBe("GET");
  });

  test("sends hello, then the buffered events, then live ones", () => {
    channel.engineStderr(Buffer.from("one\ntwo\n"));
    const { response } = open(projectQuery());
    expect(response.events()).toEqual([
      [
        "hello",
        {
          channel: channel.id,
          oldestSeq: 1,
          nextSeq: 3,
          sessionId: null,
          logFile: null,
        },
      ],
      ["line", { seq: 1, source: "stderr", sessionId: null, text: "one" }],
      ["line", { seq: 2, source: "stderr", sessionId: null, text: "two" }],
    ]);
    channel.engineStderr(Buffer.from("three\n"));
    expect(response.events().at(-1)).toEqual([
      "line",
      { seq: 3, source: "stderr", sessionId: null, text: "three" },
    ]);
    expect(response.ended).toBe(false);
  });

  test("resumes after `after` on the same channel, and replays everything for another", () => {
    channel.engineStderr(Buffer.from("1\n2\n3\n"));
    const resumed = open(
      projectQuery(`&channel=${channel.id}&after=2`),
    ).response;
    expect(
      resumed
        .events()
        .map(([name, data]) => [name, (data as { seq?: number }).seq]),
    ).toEqual([
      ["hello", undefined],
      ["line", 3],
    ]);
    const other = open(
      projectQuery("&channel=an-earlier-opening&after=2"),
    ).response;
    expect(other.events().filter(([name]) => name === "line")).toHaveLength(3);
  });

  test("ends the stream when the project closes", async () => {
    const { response } = open(projectQuery());
    await channel.close();
    expect(response.events().at(-1)).toEqual(["end", { reason: "closed" }]);
    expect(response.ended).toBe(true);
  });

  test("writes a heartbeat comment every 15 seconds until the client goes away", () => {
    vi.useFakeTimers();
    const { request, response } = open(projectQuery());
    vi.advanceTimersByTime(15_000);
    expect(response.body.endsWith(": heartbeat\n\n")).toBe(true);
    const written = response.chunks.length;
    request.emit("close");
    vi.advanceTimersByTime(60_000);
    expect(response.chunks).toHaveLength(written);
  });

  test("sends nothing more to a client that went away", () => {
    const { request, response } = open(projectQuery());
    request.emit("close");
    channel.engineStderr(Buffer.from("unseen\n"));
    expect(response.body).not.toContain("unseen");
  });
});
```

Add to `app/project-manager-shim/src/handler/__tests__/localRequest.test.ts`, at
the end:

```ts
describe("the engine log stream", () => {
  const STREAM = "/api/engine-logs/stream?project=project-x";
  const host = `localhost:${PORT}`;

  test("is an /api/ route: refused cross-site or from another origin, served same-origin", () => {
    expect(allowed(STREAM, { host, "sec-fetch-site": "cross-site" })).toBe(
      false,
    );
    expect(allowed(STREAM, { host, origin: "https://evil.example" })).toBe(
      false,
    );
    expect(allowed(STREAM, { host, "sec-fetch-site": "same-origin" })).toBe(
      true,
    );
    expect(allowed(STREAM, { host: `evil.example:${PORT}` })).toBe(false);
  });
});
```

Add to `app/electron-client/tests/headless/server.test.ts`, inside
`describe('requests', …)`:

```ts
test("the engine log stream answers a same-origin request as an event stream", async () => {
  const reply = await send({
    path: "/api/engine-logs/stream?project=project-x",
    headers: sameOrigin(),
  });
  expect(reply.status).toBe(200);
  // The test server's project service has no open project.
  expect(reply.body).toBe('event: end\ndata: {"reason":"not-open"}\n\n');
});

test("a cross-site engine log stream request is refused", async () => {
  const reply = await send({
    path: "/api/engine-logs/stream?project=project-x",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  expect(reply.status).toBe(403);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run:

```bash
cd app/project-manager-shim && corepack pnpm exec vitest run src/handler
corepack pnpm run compile
cd ../electron-client && corepack pnpm exec vitest run tests/headless/server.test.ts
```

Expected: the shim's `engineLogs.test.ts` fails with
`Failed to resolve import "../engineLogs.js"`, while `localRequest`'s new test
already passes (#274 covers every `/api/` path). The Electron stream test fails
with a 404 body `Unknown endpoint '/engine-logs/stream'`.

- [ ] **Step 3: Implement the handler**

`app/project-manager-shim/src/handler/engineLogs.ts`:

```ts
/**
 * @file `GET /api/engine-logs/stream?project=<project id>[&channel=<id>&after=<seq>]`: an open
 * project's engine log as server-sent events. The wire format is in
 * `enso-common/src/services/engineLogs`. Hosts route it after `acceptLocalRequest` (#274), which
 * keeps it to the app's own window.
 */
import {
  AssetType,
  extractTypeAndPath,
  ProjectId,
} from "enso-common/src/services/Backend";
import {
  ENGINE_LOG_HEARTBEAT_MS,
  ENGINE_LOG_STREAM_PATH,
  type EngineLogEndReason,
} from "enso-common/src/services/engineLogs";
import type {
  EngineLogSubscription,
  SequencedEngineLogEvent,
} from "../engineLogs/channel.js";
import type { EngineLogHub } from "../engineLogs/hub.js";

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_METHOD_NOT_ALLOWED = 405;

/** The slice of `http.IncomingMessage` the stream uses. */
export interface EventStreamRequest {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
  once(event: "close", listener: () => void): unknown;
}

/** The slice of `http.ServerResponse` the stream uses. */
export interface EventStreamResponse {
  writeHead(statusCode: number, headers: Record<string, string>): unknown;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(chunk?: string): unknown;
}

/** Options for {@link handleEngineLogStream}. */
export interface EngineLogStreamOptions {
  readonly heartbeatMs?: number | undefined;
}

/** Whether a request URL (or path) is the engine log stream. */
export function isEngineLogStreamRequest(url: string): boolean {
  return new URL(url, "http://localhost").pathname === ENGINE_LOG_STREAM_PATH;
}

/** One server-sent event. JSON has no raw newlines, so `data` is a single line. */
export function formatServerSentEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A channel event as the server-sent event the GUI reads. */
export function formatEngineLogEvent(event: SequencedEngineLogEvent): string {
  switch (event.type) {
    case "line":
      return formatServerSentEvent("line", {
        seq: event.seq,
        source: event.source,
        sessionId: event.sessionId,
        text: event.text,
      });
    case "session":
      return formatServerSentEvent("session", {
        seq: event.seq,
        sessionId: event.sessionId,
        logFile: event.logFile,
      });
    case "waiting":
      return formatServerSentEvent("waiting", { seq: event.seq });
  }
}

/** The directory a `project` parameter names: the GUI's id of a local project. */
function projectPathOf(project: string): string | undefined {
  try {
    const { type, path } = extractTypeAndPath(ProjectId(project));
    return type === AssetType.project ? path : undefined;
  } catch {
    return undefined;
  }
}

function sendText(
  response: EventStreamResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  text: string,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...headers,
    ...extraHeaders,
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

/**
 * Serve the engine log stream. `hub` is the host's `ProjectService.engineLogs`, or `undefined`
 * before there is a project service (then no project is open).
 */
export function handleEngineLogStream(
  request: EventStreamRequest,
  response: EventStreamResponse,
  hub: EngineLogHub | undefined,
  headers: Readonly<Record<string, string>>,
  options: EngineLogStreamOptions = {},
): void {
  if (request.method !== "GET") {
    sendText(
      response,
      HTTP_STATUS_METHOD_NOT_ALLOWED,
      headers,
      "Only GET is allowed.",
      {
        Allow: "GET",
      },
    );
    return;
  }
  const params = new URL(request.url ?? "", "http://localhost").searchParams;
  const projectPath = projectPathOf(params.get("project") ?? "");
  const afterParam = params.get("after");
  const after = afterParam == null ? undefined : Number(afterParam);
  if (
    projectPath == null ||
    (after != null && (!Number.isSafeInteger(after) || after < 0))
  ) {
    sendText(
      response,
      HTTP_STATUS_BAD_REQUEST,
      headers,
      "Expected ?project=<project id>, optionally with &channel=<id>&after=<sequence number>.",
    );
    return;
  }

  response.writeHead(HTTP_STATUS_OK, {
    ...headers,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  const endStream = (reason: EngineLogEndReason) => {
    response.write(formatServerSentEvent("end", { reason }));
    response.end();
  };

  const channel = hub?.get(projectPath);
  if (channel == null) {
    endStream("not-open");
    return;
  }

  let finished = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let subscription: EngineLogSubscription | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    subscription?.unsubscribe();
  };
  subscription = channel.subscribe(
    {
      event: (event) => {
        if (!finished) response.write(formatEngineLogEvent(event));
      },
      end: (reason) => {
        if (finished) return;
        finish();
        endStream(reason);
      },
    },
    { channel: params.get("channel") ?? undefined, after },
  );
  response.write(formatServerSentEvent("hello", subscription.hello));
  for (const event of subscription.replay)
    response.write(formatEngineLogEvent(event));
  if (subscription.closed) {
    finish();
    endStream("closed");
    return;
  }
  heartbeat = setInterval(
    () => response.write(": heartbeat\n\n"),
    options.heartbeatMs ?? ENGINE_LOG_HEARTBEAT_MS,
  );
  request.once("close", finish);
}
```

In `app/project-manager-shim/src/handler/index.ts`, add:

```ts
export * from "./engineLogs.js";
```

- [ ] **Step 4: Wire both hosts**

`app/electron-client/src/server.ts`:

1. Add `handleEngineLogStream` and `isEngineLogStreamRequest` to the import from
   `project-manager-shim/handler`.
2. In `process()`, insert a branch between the null-URL check and
   `isProjectServiceRequest`. `acceptLocalRequest` has already run above it.

```ts
    if (requestUrl == null) {
      console.error('Request URL is null.')
    } else if (isEngineLogStreamRequest(requestUrl)) {
      handleEngineLogStream(
        request,
        response,
        this.projectService.engineLogs,
        Object.fromEntries(COOP_COEP_CORP_HEADERS),
      )
    } else if (isProjectServiceRequest(requestUrl)) {
```

`app/gui/project-manager-shim-middleware/index.ts`:

1. Add `handleEngineLogStream` and `isEngineLogStreamRequest` to the import from
   `project-manager-shim/handler`.
2. In `handler()`, after `const requestPath = url.pathname`, change the first
   `if` to:

```ts
    if (isEngineLogStreamRequest(requestPath)) {
      // No project service yet means no project is open: the stream says so and ends.
      handleEngineLogStream(request, response, this.projectService?.engineLogs, COMMON_HEADERS)
    } else if (isProjectServiceRequest(requestPath)) {
```

- [ ] **Step 5: Run the tests to see them pass**

Run:

```bash
cd app/project-manager-shim && corepack pnpm exec vitest run && corepack pnpm exec tsc --noEmit -p . && corepack pnpm exec eslint src
corepack pnpm run compile
cd ../electron-client && corepack pnpm exec vitest run tests/headless && corepack pnpm run typecheck
cd ../gui && find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete && corepack pnpm exec vue-tsc --noEmit -p tsconfig.node.json
```

Expected:

- The whole shim suite passes, Task 0's pre-existing failures excepted.
- The Electron headless suite passes, with the 2 new stream tests.
- The GUI node typecheck, which covers the middleware, prints nothing.

- [ ] **Step 6: Check the middleware by hand**

Run the dev server (`corepack pnpm --filter enso-gui run dev:vite`), then:

```bash
curl -s -N -H "Sec-Fetch-Site: same-origin" "http://localhost:<vite port>/api/engine-logs/stream?project=project-x"
curl -s -o /dev/null -w '%{http_code}\n' -H "Sec-Fetch-Site: cross-site" "http://localhost:<vite port>/api/engine-logs/stream?project=project-x"
```

The port is the one Vite prints. Expected: the first prints `event: end` /
`data: {"reason":"not-open"}`, and the second prints `403`. Then open a project
in the dev GUI, and use the project id from the browser's network tab
(`project-<encoded path>`). The stream should then stay open, starting with
`event: hello` and `event: waiting`, and lines should arrive. Stop the server.

- [ ] **Step 7: Update the docs**

In `app/project-manager-shim/CLAUDE.md`, add a section before
`## Local datalinks`:

```markdown
## Engine logs (`src/engineLogs/`)

`ProjectService.engineLogs` (an `EngineLogHub`) holds one `EngineLogChannel` per
open project, keyed by its directory (resolved, lower case on Windows).
`openProject` opens it before the engine starts, so start-up lands in the replay
buffer; the runner feeds it through `EngineLogSink` (`engineStarted`,
`engineStderr`, `projectClosed`), and `closeProject` closes it too.

- **Sources.** The engine's stderr: spawned piped, every chunk still written to
  this process's stderr. And the session's active `.log` file,
  `<getEngineLogDirectory()>/<local project key>/<prefix>-yyyy-MM-dd-HH-mm-ss.log`
  — the newest such file that was not there when the engine started — followed
  by `LogFileTailer` (a directory `fs.watch` plus a 500 ms poll; a smaller or a
  different file is a roll-over, read again from offset 0).
- **Events.** `waiting` (an engine started; its file is not there yet),
  `session` (`sessionId` in the `listProjectSessions` format, `logFile`) and
  `line` (`source`, `sessionId` — `null` before the file is found — `text`).
  Each takes the next `seq` in a 5,000-event `ReplayBuffer`.
- **Route.**
  `GET /api/engine-logs/stream?project=<GUI project id>[&channel=<id>&after=<seq>]`
  (`handler/engineLogs.ts`), as server-sent events:
  1. `hello` (`channel`, `oldestSeq`, `nextSeq`, `sessionId`, `logFile`);
  2. the buffered events after `after` (all of them unless `channel` is the
     current one);
  3. live events, with a `: heartbeat` comment every 15 s;
  4. `end`: `closed`, or `not-open` when the project has no channel.

  Both hosts route it right after `acceptLocalRequest`. The wire types are in
  `enso-common/src/services/engineLogs.ts`.

- **Tests** never touch real log directories: channels take a temporary
  `logDirectory`, and code that calls `getEngineLogDirectory()` runs with
  `ENSO_LOG_DIRECTORY` stubbed.
- **Known limitation:** lines appended to the old file between the last read and
  a roll-over are not streamed. They are in the rolled archive, so they show up
  in the panel's history.
```

In `app/electron-client/CLAUDE.md`, under `## What this process does`, after the
`enso://` bullet, add:

```markdown
- Streams the open project's engine log to the window
  (`GET /api/engine-logs/stream`, served by the shim's `handleEngineLogStream`
  from `ProjectService.engineLogs`; see `app/project-manager-shim/CLAUDE.md`).
```

Run:
`corepack pnpm exec prettier --check app/project-manager-shim/CLAUDE.md app/electron-client/CLAUDE.md`.
Expected: `All matched files use Prettier code style!`

- [ ] **Step 8: Verify on Linux**

```bash
cd /c/Repos/Enso/ide-logs1 && git push -u origin feature/engine-logs-shim
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e
  [ -d ~/enso-logs ] || git clone /mnt/c/Repos/Enso/ide ~/enso-logs
  cd ~/enso-logs && git fetch https://github.com/jdunkerley/enso feature/engine-logs-shim && git checkout -f FETCH_HEAD
  corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile
  find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
  cd app/project-manager-shim && corepack pnpm exec vitest run && corepack pnpm exec tsc --noEmit -p .
  cd ../electron-client && corepack pnpm exec vitest run tests/headless
  cd ../.. && corepack pnpm exec prettier --check app/project-manager-shim app/electron-client/src app/common/src/services app/gui/project-manager-shim-middleware'
```

Expected: all pass on Linux. The roll-over and `fs.watch` tests behave
differently there (inotify follows inodes), so this run is the check that
matters for them.

- [ ] **Step 9: Commit, push and open PR A**

```bash
git add app/project-manager-shim app/electron-client app/gui/project-manager-shim-middleware
git commit -m "Engine logs: serve GET /api/engine-logs/stream from both hosts"
git push
gh pr create --base develop --head feature/engine-logs-shim --label "CI: No changelog needed" \
  --title "Engine logs, PR 1: the shim streams an open project's engine log" \
  --body-file <scratchpad>/pr-a-body.md
```

The body says what the PR adds: the stderr pass-through, the tailer and
roll-over, the replay buffer, the route and its #274 coverage. It names the
spec, says PR 2 adds the UI, and gives the test commands and the Linux run. It
says nothing changes for users: stderr still reaches the terminal. It ends with
the session's PR attribution. Hold the merge until PR B has been tested (merge
gate).

---

## PR B: the Logs tab

Create PR B's worktree on PR A's branch:

```bash
cd /c/Repos/Enso/ide && git fetch origin
git worktree add -b feature/engine-logs-panel /c/Repos/Enso/ide-logs2 origin/feature/engine-logs-shim
cd /c/Repos/Enso/ide-logs2 && corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile
```

### Task 5: The GUI's stream client and row model

**Files:**

- Modify: `app/gui/src/components/ProjectLog/projectLogData.ts`. Export
  `LOG_LEVELS` (line 14) `as const`, and drop `@internal` from `parseEntry`
  (line 73).
- Create in `app/gui/src/project-view/components/EngineLogs/`:
  - `engineLogModel.ts`, `engineLogStream.ts`, `engineLogHistory.ts`
  - `CLAUDE.md`
- Test: `app/gui/src/project-view/components/EngineLogs/__tests__/`:
  - `fakeEventSource.ts`
  - `engineLogModel.test.ts`, `engineLogStream.test.ts`,
    `engineLogHistory.test.ts`

**Interfaces:**

- Consumes (Task 2): the `enso-common/src/services/engineLogs` types and
  `engineLogStreamUrl`.
- Consumes (existing): `parseEntry(line): LogEntry | undefined` and `LOG_LEVELS`
  (`'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'`) from
  `$/components/ProjectLog/projectLogData`.
- Consumes (existing):
  `LocalBackend.getProjectSessionLogs(projectSessionId, { scrollId })`. It
  returns `{ scrollId, hits }`, and the shim pages it `archive:N` … `active` …
  `done`.
- Produces:

```ts
// engineLogModel.ts
export const LIVE_ROW_CAP = 20_000;
export const ERROR_LEVEL: number; // 0
export const WARN_LEVEL: number; // 1
export const INFO_LEVEL: number; // 2
export type DividerKind = "restarted" | "skipped" | "truncated";
export interface LogLine {
  readonly kind: "line";
  readonly key: number;
  readonly source: EngineLogSource;
  readonly text: string;
  readonly level: number;
  readonly entryStart: boolean;
}
export interface LogDivider {
  readonly kind: "divider";
  readonly key: number;
  readonly divider: DividerKind;
}
export type LogRow = LogLine | LogDivider;
export type LevelFilter = "error" | "warn" | "info";
export class LineClassifier {
  classify(
    text: string,
    source: EngineLogSource,
  ): { level: number; entryStart: boolean };
}
export class EngineLogModel {
  readonly rows: LogRow[];
  waiting: boolean;
  ended: EngineLogEndReason | undefined;
  sessionId: string | null;
  logFile: string | null;
  unseenErrors: number;
  get sessionStartHeld(): boolean;
  resumeFrom():
    { readonly channel: string; readonly after: number } | undefined;
  onHello(data: EngineLogHelloData): void;
  onLine(data: EngineLogLineData): void;
  onWaiting(data: EngineLogWaitingData): void;
  onSession(data: EngineLogSessionData): void;
  onEnd(reason: EngineLogEndReason): void;
  commit(): boolean;
  markSeen(): void;
  prependHistory(lines: readonly string[]): void;
}
export function overlapStart(
  lines: readonly string[],
  head: readonly string[],
): number;
export function rowsFromLines(lines: readonly string[]): LogRow[];
export function filterRows(
  rows: readonly LogRow[],
  filter: { readonly level: LevelFilter; readonly text: string },
): readonly LogRow[];
// engineLogStream.ts
export const RECONNECT_DELAYS_MS: readonly [500, 1000, 2000, 5000, 10000];
export interface EventSourceLike {
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
}
export interface EngineLogStreamOptions {
  readonly project: ToValue<string>;
  readonly active: ToValue<boolean>;
  readonly createEventSource?: ((url: string) => EventSourceLike) | undefined;
  readonly requestFrame?: ((callback: () => void) => void) | undefined;
}
export interface EngineLogStreamState {
  waiting: boolean;
  ended: EngineLogEndReason | undefined;
  sessionId: string | null;
  logFile: string | null;
  unseenErrors: number;
  sessionStartHeld: boolean;
}
export function useEngineLogStream(options: EngineLogStreamOptions): {
  rows: ShallowRef<readonly LogRow[]>;
  state: EngineLogStreamState;
  markSeen(): void;
  loadHistory(lines: readonly string[]): void;
};
export type EngineLogStream = ReturnType<typeof useEngineLogStream>;
// engineLogHistory.ts
export const MAX_HISTORY_PAGES = 1_000;
export function fetchSessionLines(
  backend: Pick<LocalBackend, "getProjectSessionLogs">,
  sessionId: ProjectSessionId,
): Promise<string[]>;
```

- [ ] **Step 1: Write the failing tests**

`app/gui/src/project-view/components/EngineLogs/__tests__/fakeEventSource.ts`:

```ts
/** @file An `EventSource` stand-in for the engine log tests: the test emits the server's events. */
import type { EventSourceLike } from "../engineLogStream";

/** Records every instance; `emit` and `fail` play the server's part. */
export class FakeEventSource implements EventSourceLike {
  static readonly created: FakeEventSource[] = [];
  closed = false;
  private readonly listeners = new Map<
    string,
    ((event: MessageEvent<string>) => void)[]
  >();

  constructor(readonly url: string) {
    FakeEventSource.created.push(this);
  }

  /** The newest instance. */
  static latest(): FakeEventSource {
    const source = FakeEventSource.created.at(-1);
    if (source == null) throw new Error("No EventSource was created.");
    return source;
  }

  /** Forget every instance. */
  static reset(): void {
    FakeEventSource.created.length = 0;
  }

  /** The query parameters of {@link url}. */
  get params(): URLSearchParams {
    return new URL(this.url, "http://localhost").searchParams;
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver a server-sent event with JSON data. */
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }

  /** The connection failed or was closed by the server. */
  fail(): void {
    for (const listener of this.listeners.get("error") ?? [])
      listener(new MessageEvent("error"));
  }
}
```

`app/gui/src/project-view/components/EngineLogs/__tests__/engineLogModel.test.ts`:

```ts
import type {
  EngineLogHelloData,
  EngineLogSource,
} from "enso-common/src/services/engineLogs";
import { describe, expect, test } from "vitest";
import {
  EngineLogModel,
  ERROR_LEVEL,
  filterRows,
  INFO_LEVEL,
  LIVE_ROW_CAP,
  overlapStart,
  rowsFromLines,
  WARN_LEVEL,
  type LogRow,
} from "../engineLogModel";

const entry = (level: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [org.enso.Test] ${message}`;

function feed(model = new EngineLogModel()) {
  let seq = 0;
  return {
    model,
    hello: (overrides: Partial<EngineLogHelloData> = {}) =>
      model.onHello({
        channel: "c1",
        oldestSeq: 1,
        nextSeq: 1,
        sessionId: null,
        logFile: null,
        ...overrides,
      }),
    waiting: () => model.onWaiting({ seq: ++seq }),
    session: (sessionId = "s1") =>
      model.onSession({
        seq: ++seq,
        sessionId,
        logFile: `/logs/${sessionId}.log`,
      }),
    line: (text: string, source: EngineLogSource = "file") =>
      model.onLine({ seq: ++seq, source, sessionId: "s1", text }),
    skipTo: (next: number) => {
      seq = next - 1;
    },
  };
}

const texts = (rows: readonly LogRow[]) =>
  rows.map((row) => (row.kind === "line" ? row.text : `--${row.divider}--`));

describe("EngineLogModel", () => {
  test("classifies entries by level, continuation lines by their entry, and stderr as ERROR", () => {
    const f = feed();
    f.hello();
    f.line("a line before any entry");
    f.line(entry("WARN", "careful"));
    f.line("  at Foo.bar");
    f.line("Picked up JAVA_TOOL_OPTIONS", "stderr");
    f.model.commit();
    expect(
      f.model.rows.map((row) =>
        row.kind === "line" ? [row.level, row.entryStart] : null,
      ),
    ).toEqual([
      [INFO_LEVEL, false],
      [WARN_LEVEL, true],
      [WARN_LEVEL, false],
      [ERROR_LEVEL, true],
    ]);
  });

  test("ignores an event it already has", () => {
    const f = feed();
    f.hello();
    f.model.onLine({ seq: 1, source: "file", sessionId: "s1", text: "once" });
    f.model.onLine({ seq: 1, source: "file", sessionId: "s1", text: "once" });
    f.model.commit();
    expect(texts(f.model.rows)).toEqual(["once"]);
  });

  test("marks a restart at the next engine's start, not at the first", () => {
    const f = feed();
    f.hello();
    f.waiting();
    f.session("s1");
    f.line("a");
    f.line("crash", "stderr");
    f.waiting();
    f.line("new engine starting", "stderr");
    f.session("s2");
    f.line("b");
    f.model.commit();
    expect(texts(f.model.rows)).toEqual([
      "a",
      "crash",
      "--restarted--",
      "new engine starting",
      "b",
    ]);
    expect(f.model.sessionId).toBe("s2");
    expect(f.model.waiting).toBe(false);
  });

  test("counts ERROR entries and stderr lines as unseen until marked seen", () => {
    const f = feed();
    f.hello();
    f.line(entry("INFO", "fine"));
    f.line(entry("ERROR", "broken"));
    f.line("  at Foo.bar");
    f.line("boom", "stderr");
    expect(f.model.unseenErrors).toBe(2);
    f.model.markSeen();
    expect(f.model.unseenErrors).toBe(0);
  });

  test("shows a skipped divider after a gap, or on another channel", () => {
    const f = feed();
    f.hello();
    f.line("1");
    f.line("2");
    f.hello({ oldestSeq: 10, nextSeq: 12 });
    f.skipTo(10);
    f.line("10");
    f.hello({ channel: "c2" });
    f.skipTo(1);
    f.line("fresh");
    f.model.commit();
    expect(texts(f.model.rows)).toEqual([
      "1",
      "2",
      "--skipped--",
      "10",
      "--skipped--",
      "fresh",
    ]);
  });

  test("resumes from the last sequence number of its channel", () => {
    const f = feed();
    expect(f.model.resumeFrom()).toBeUndefined();
    f.hello();
    f.line("1");
    f.line("2");
    expect(f.model.resumeFrom()).toEqual({ channel: "c1", after: 2 });
    f.hello({ channel: "c2" });
    expect(f.model.resumeFrom()).toBeUndefined();
  });

  test(`keeps the newest ${LIVE_ROW_CAP} rows`, () => {
    const f = feed();
    f.hello();
    for (let n = 1; n <= LIVE_ROW_CAP + 5; n++) f.line(`line ${n}`);
    f.model.commit();
    expect(f.model.rows).toHaveLength(LIVE_ROW_CAP);
    expect(texts(f.model.rows.slice(0, 1))).toEqual(["line 6"]);
  });

  test("knows whether it holds the current session from its start", () => {
    const midway = feed();
    midway.hello({ sessionId: "s1" });
    midway.line("somewhere in the middle");
    midway.model.commit();
    expect(midway.model.sessionStartHeld).toBe(false);

    const fromStart = feed();
    fromStart.hello();
    fromStart.waiting();
    fromStart.session();
    fromStart.line("first");
    fromStart.model.commit();
    expect(fromStart.model.sessionStartHeld).toBe(true);
    for (let n = 0; n < LIVE_ROW_CAP; n++) fromStart.line(`more ${n}`);
    fromStart.model.commit();
    expect(fromStart.model.sessionStartHeld).toBe(false);
  });

  test("prepends the earlier lines of the session above its first live file line", () => {
    const f = feed();
    f.hello({ sessionId: "s1" });
    f.line("started", "stderr");
    f.line("L3");
    f.line("L4");
    f.model.prependHistory(["L1", "L2", "L3", "L4"]);
    expect(texts(f.model.rows)).toEqual(["started", "L1", "L2", "L3", "L4"]);
    expect(new Set(f.model.rows.map((row) => row.key)).size).toBe(5);
    expect(f.model.sessionStartHeld).toBe(true);
  });

  test("prepends every line when none of the live ones is in the history", () => {
    const f = feed();
    f.hello({ sessionId: "s1" });
    f.line("live");
    f.model.prependHistory(["h1", "h2"]);
    expect(texts(f.model.rows)).toEqual(["h1", "h2", "live"]);
  });

  test("caps prepended history to the room left, under a truncated divider", () => {
    const f = feed();
    f.hello({ sessionId: "s1" });
    for (let n = 0; n < LIVE_ROW_CAP - 2; n++) f.line(`live ${n}`);
    f.model.prependHistory(["h1", "h2", "h3", "h4"]);
    expect(texts(f.model.rows.slice(0, 4))).toEqual([
      "--truncated--",
      "h3",
      "h4",
      "live 0",
    ]);
  });
});

describe("helpers", () => {
  test("overlapStart finds where the live lines begin in the history", () => {
    expect(overlapStart(["a", "b", "c", "d"], ["c", "d"])).toBe(2);
    expect(overlapStart(["x", "c", "x", "c", "d"], ["c", "d"])).toBe(3);
    expect(overlapStart(["a", "b"], ["z"])).toBe(2);
  });

  test("rowsFromLines keeps the newest lines under a truncated divider", () => {
    const lines = Array.from({ length: LIVE_ROW_CAP + 1 }, (_, n) => `l${n}`);
    const rows = rowsFromLines(lines);
    expect(rows).toHaveLength(LIVE_ROW_CAP + 1);
    expect(texts(rows.slice(0, 2))).toEqual(["--truncated--", "l1"]);
    expect(texts(rowsFromLines(["a"]))).toEqual(["a"]);
  });

  test("filterRows keeps dividers, and lines at or above the level that contain the text", () => {
    const rows = rowsFromLines([
      entry("INFO", "started"),
      entry("WARN", "slow query"),
      entry("ERROR", "query failed"),
      "  at Query.run",
    ]);
    const withDivider: LogRow[] = [
      { kind: "divider", key: 99, divider: "restarted" },
      ...rows,
    ];
    expect(
      texts(filterRows(withDivider, { level: "error", text: "" })),
    ).toEqual([
      "--restarted--",
      entry("ERROR", "query failed"),
      "  at Query.run",
    ]);
    expect(
      texts(filterRows(withDivider, { level: "warn", text: " SLOW " })),
    ).toEqual(["--restarted--", entry("WARN", "slow query")]);
    expect(filterRows(withDivider, { level: "info", text: "" })).toHaveLength(
      5,
    );
  });
});
```

`app/gui/src/project-view/components/EngineLogs/__tests__/engineLogStream.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import {
  RECONNECT_DELAYS_MS,
  useEngineLogStream,
  type EngineLogStreamOptions,
} from "../engineLogStream";
import { FakeEventSource } from "./fakeEventSource";

const PROJECT = "project-%2Fprojects%2FMock Project";
const HELLO = {
  channel: "c1",
  oldestSeq: 1,
  nextSeq: 1,
  sessionId: null,
  logFile: null,
};
const line = (seq: number, text: string, source = "file") => ({
  seq,
  source,
  sessionId: "s1",
  text,
});

let scope: EffectScope;
let frames: (() => void)[];

beforeEach(() => {
  scope = effectScope();
  frames = [];
});

afterEach(() => {
  scope.stop();
  FakeEventSource.reset();
  vi.useRealTimers();
});

function start(options: Partial<EngineLogStreamOptions> = {}) {
  return scope.run(() =>
    useEngineLogStream({
      project: PROJECT,
      active: true,
      createEventSource: (url) => new FakeEventSource(url),
      requestFrame: (callback) => void frames.push(callback),
      ...options,
    }),
  )!;
}

function runFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

const texts = (stream: ReturnType<typeof start>) =>
  stream.rows.value.map((row) =>
    row.kind === "line" ? row.text : `--${row.divider}--`,
  );

test("connects to the project's stream and applies events once per frame", () => {
  const stream = start();
  const source = FakeEventSource.latest();
  expect(source.params.get("project")).toBe(PROJECT);
  expect(source.params.has("after")).toBe(false);
  source.emit("hello", HELLO);
  source.emit("waiting", { seq: 1 });
  source.emit("line", line(2, "first"));
  source.emit("line", line(3, "oops", "stderr"));
  expect(stream.rows.value).toEqual([]);
  expect(frames).toHaveLength(1);
  runFrames();
  expect(texts(stream)).toEqual(["first", "oops"]);
  expect(stream.state.waiting).toBe(true);
  expect(stream.state.unseenErrors).toBe(1);
  stream.markSeen();
  expect(stream.state.unseenErrors).toBe(0);
});

test("reconnects with backoff, resuming after the last event of its channel", () => {
  vi.useFakeTimers();
  start();
  const first = FakeEventSource.latest();
  first.emit("hello", HELLO);
  first.emit("line", line(1, "one"));
  first.emit("line", line(2, "two"));
  first.fail();
  expect(first.closed).toBe(true);
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
  expect(FakeEventSource.created).toHaveLength(1);
  vi.advanceTimersByTime(1);
  const second = FakeEventSource.latest();
  expect(second.params.get("channel")).toBe("c1");
  expect(second.params.get("after")).toBe("2");
  // No `hello` before this failure, so the next wait is longer.
  second.fail();
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1] - 1);
  expect(FakeEventSource.created).toHaveLength(2);
  vi.advanceTimersByTime(1);
  expect(FakeEventSource.created).toHaveLength(3);
});

test("does not reconnect once the stream has ended", () => {
  vi.useFakeTimers();
  const stream = start();
  const source = FakeEventSource.latest();
  source.emit("end", { reason: "closed" });
  source.fail();
  vi.advanceTimersByTime(60_000);
  expect(FakeEventSource.created).toHaveLength(1);
  runFrames();
  expect(stream.state.ended).toBe("closed");
});

test("holds no connection while inactive, and catches up when active again", async () => {
  const active = ref(true);
  start({ active });
  const first = FakeEventSource.latest();
  first.emit("hello", HELLO);
  first.emit("line", line(1, "one"));
  active.value = false;
  await nextTick();
  expect(first.closed).toBe(true);
  active.value = true;
  await nextTick();
  const second = FakeEventSource.latest();
  expect(second).not.toBe(first);
  expect(second.params.get("after")).toBe("1");
});

test("loadHistory puts earlier lines above the live ones", () => {
  const stream = start();
  const source = FakeEventSource.latest();
  source.emit("hello", { ...HELLO, sessionId: "s1" });
  source.emit("line", line(5, "L3"));
  runFrames();
  expect(stream.state.sessionStartHeld).toBe(false);
  stream.loadHistory(["L1", "L2", "L3"]);
  expect(texts(stream)).toEqual(["L1", "L2", "L3"]);
  expect(stream.state.sessionStartHeld).toBe(true);
});
```

`app/gui/src/project-view/components/EngineLogs/__tests__/engineLogHistory.test.ts`:

```ts
import { ProjectSessionId } from "enso-common/src/services/Backend";
import type { LocalBackend } from "enso-common/src/services/LocalBackend";
import { expect, test, vi } from "vitest";
import { fetchSessionLines } from "../engineLogHistory";

test("reads every page of a session, oldest first", async () => {
  const pages: Record<string, { scrollId: string; hits: string[] }> = {
    start: { scrollId: "archive:1", hits: ["a0"] },
    "archive:1": { scrollId: "active", hits: ["a1"] },
    active: { scrollId: "done", hits: ["live 1", "live 2"] },
  };
  const getProjectSessionLogs = vi.fn<LocalBackend["getProjectSessionLogs"]>(
    async (_id, { scrollId }) => pages[scrollId ?? "start"]!,
  );
  const lines = await fetchSessionLines(
    { getProjectSessionLogs },
    ProjectSessionId("s1"),
  );
  expect(lines).toEqual(["a0", "a1", "live 1", "live 2"]);
  expect(
    getProjectSessionLogs.mock.calls.map(([, params]) => params.scrollId),
  ).toEqual([null, "archive:1", "active"]);
});

test("stops when a page does not move on", async () => {
  const getProjectSessionLogs = vi.fn<LocalBackend["getProjectSessionLogs"]>(
    async () => ({
      scrollId: "stuck",
      hits: ["x"],
    }),
  );
  const lines = await fetchSessionLines(
    { getProjectSessionLogs },
    ProjectSessionId("s1"),
  );
  expect(lines).toEqual(["x", "x"]);
  expect(getProjectSessionLogs).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/EngineLogs`

Expected: FAIL with `Failed to resolve import "../engineLogModel"` (and
`../engineLogStream`, `../engineLogHistory`).

- [ ] **Step 3: Implement**

In `app/gui/src/components/ProjectLog/projectLogData.ts`:

- Change line 14 to
  `export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const`.
- Replace the `/** @internal */` above `parseEntry` with
  `/** Parse a log line that starts an entry; `undefined` for any other line (a stack trace's, say). */`.

`app/gui/src/project-view/components/EngineLogs/engineLogModel.ts`:

```ts
/**
 * @file The engine log as the Logs tab shows it: rows built from the stream's events, with the
 * level rules, dividers, the live cap and history splicing. Framework-free; `engineLogStream.ts`
 * makes it reactive.
 */
import { LOG_LEVELS, parseEntry } from "$/components/ProjectLog/projectLogData";
import type {
  EngineLogEndReason,
  EngineLogHelloData,
  EngineLogLineData,
  EngineLogSessionData,
  EngineLogSource,
  EngineLogWaitingData,
} from "enso-common/src/services/engineLogs";

/** The most rows the view keeps; older ones remain in the session's history. */
export const LIVE_ROW_CAP = 20_000;
export const ERROR_LEVEL = LOG_LEVELS.indexOf("ERROR");
export const WARN_LEVEL = LOG_LEVELS.indexOf("WARN");
export const INFO_LEVEL = LOG_LEVELS.indexOf("INFO");

/** How many live file lines must match to place history above them. */
const OVERLAP_CHECK = 3;

/**
 * - `restarted` — a new engine started.
 * - `skipped` — lines were lost while the stream was down.
 * - `truncated` — older lines are not shown.
 */
export type DividerKind = "restarted" | "skipped" | "truncated";

/** One line of the log. */
export interface LogLine {
  readonly kind: "line";
  readonly key: number;
  readonly source: EngineLogSource;
  readonly text: string;
  /** An index into `LOG_LEVELS`. */
  readonly level: number;
  /** Whether the line starts a log entry (rather than continuing one, as a stack trace does). */
  readonly entryStart: boolean;
}

/** A marker between lines. */
export interface LogDivider {
  readonly kind: "divider";
  readonly key: number;
  readonly divider: DividerKind;
}

/** A row of the Logs tab. */
export type LogRow = LogLine | LogDivider;

/** The level filter: ERROR only, WARN and above, or INFO and above. */
export type LevelFilter = "error" | "warn" | "info";

const MAX_LEVEL: Readonly<Record<LevelFilter, number>> = {
  error: ERROR_LEVEL,
  warn: WARN_LEVEL,
  info: INFO_LEVEL,
};

/**
 * Gives lines their level. An entry has its own; a line that starts no entry continues the
 * previous entry and takes its level (INFO before any); stderr is ERROR.
 */
export class LineClassifier {
  private level = INFO_LEVEL;

  /** The level of `text`, and whether it starts an entry. */
  classify(
    text: string,
    source: EngineLogSource,
  ): { level: number; entryStart: boolean } {
    if (source === "stderr") return { level: ERROR_LEVEL, entryStart: true };
    const entry = parseEntry(text);
    if (entry == null) return { level: this.level, entryStart: false };
    this.level = entry.level;
    return { level: entry.level, entryStart: true };
  }

  /** Forget the current entry (a new session starts). */
  reset(): void {
    this.level = INFO_LEVEL;
  }
}

/** The start of `head` in `lines`, searching from the end; `lines.length` when it is not there. */
export function overlapStart(
  lines: readonly string[],
  head: readonly string[],
): number {
  for (let i = lines.length - head.length; i >= 0; i--) {
    if (head.every((text, j) => lines[i + j] === text)) return i;
  }
  return lines.length;
}

/** Rows for a session read whole (an earlier session): its newest {@link LIVE_ROW_CAP} lines. */
export function rowsFromLines(lines: readonly string[]): LogRow[] {
  const shown =
    lines.length > LIVE_ROW_CAP
      ? lines.slice(lines.length - LIVE_ROW_CAP)
      : lines;
  const classifier = new LineClassifier();
  const rows: LogRow[] = [];
  if (shown.length < lines.length)
    rows.push({ kind: "divider", key: 0, divider: "truncated" });
  for (const text of shown) {
    rows.push({
      kind: "line",
      key: rows.length + 1,
      source: "file",
      text,
      ...classifier.classify(text, "file"),
    });
  }
  return rows;
}

/** The rows a filter shows: every divider, and the lines at or above the level that contain the text. */
export function filterRows(
  rows: readonly LogRow[],
  filter: { readonly level: LevelFilter; readonly text: string },
): readonly LogRow[] {
  const needle = filter.text.trim().toLowerCase();
  const maxLevel = MAX_LEVEL[filter.level];
  if (needle === "" && filter.level === "info") {
    return rows.filter(
      (row) => row.kind === "divider" || row.level <= maxLevel,
    );
  }
  return rows.filter(
    (row) =>
      row.kind === "divider" ||
      (row.level <= maxLevel &&
        (needle === "" || row.text.toLowerCase().includes(needle))),
  );
}

/** The Logs tab's rows and state, built from the stream's events. */
export class EngineLogModel {
  /** The rows, oldest first. New rows reach it on {@link commit}. */
  readonly rows: LogRow[] = [];
  waiting = false;
  ended: EngineLogEndReason | undefined = undefined;
  /** The current session, as `listProjectSessions` names it; `null` while it has no file. */
  sessionId: string | null = null;
  logFile: string | null = null;
  /** ERROR entries and stderr lines not yet seen. */
  unseenErrors = 0;

  private pending: LogRow[] = [];
  private channel: string | undefined;
  private lastSeq: number | undefined;
  private nextKey = 1;
  private previousKey = 0;
  private hadEngine = false;
  private sessionBeganInView = false;
  private sessionFirstKey: number | undefined;
  private sessionRowsDropped = false;
  private readonly classifier = new LineClassifier();

  /** Whether the rows hold the current session from its start, so that it has nothing older to load. */
  get sessionStartHeld(): boolean {
    return this.sessionBeganInView && !this.sessionRowsDropped;
  }

  /** Where a dropped stream resumes; `undefined` before the first event of a channel. */
  resumeFrom():
    { readonly channel: string; readonly after: number } | undefined {
    return this.channel == null || this.lastSeq == null
      ? undefined
      : { channel: this.channel, after: this.lastSeq };
  }

  /** A connection's first event. */
  onHello(data: EngineLogHelloData): void {
    const sameChannel = this.channel === data.channel;
    const hasRows = this.rows.length + this.pending.length > 0;
    if (!sameChannel && this.channel != null && hasRows) {
      this.addDivider("skipped");
    } else if (
      sameChannel &&
      this.lastSeq != null &&
      data.oldestSeq > this.lastSeq + 1
    ) {
      this.addDivider("skipped");
    }
    if (!sameChannel) {
      this.lastSeq = undefined;
      this.sessionBeganInView = false;
      this.sessionRowsDropped = false;
      this.sessionFirstKey = undefined;
    }
    this.channel = data.channel;
    this.sessionId = data.sessionId;
    this.logFile = data.logFile ?? this.logFile;
  }

  /** A log line. */
  onLine(data: EngineLogLineData): void {
    if (!this.accept(data.seq)) return;
    this.hadEngine = true;
    const { level, entryStart } = this.classifier.classify(
      data.text,
      data.source,
    );
    this.pending.push({
      kind: "line",
      key: this.nextKey++,
      source: data.source,
      text: data.text,
      level,
      entryStart,
    });
    if (entryStart && level === ERROR_LEVEL) this.unseenErrors += 1;
  }

  /** An engine started; a restart when one ran before. */
  onWaiting(data: EngineLogWaitingData): void {
    if (!this.accept(data.seq)) return;
    if (this.hadEngine) this.addDivider("restarted");
    this.hadEngine = true;
    this.waiting = true;
    this.sessionId = null;
    this.sessionBeganInView = true;
    this.sessionRowsDropped = false;
    this.sessionFirstKey = this.nextKey;
    this.classifier.reset();
  }

  /** The session's log file was found. */
  onSession(data: EngineLogSessionData): void {
    if (!this.accept(data.seq)) return;
    this.hadEngine = true;
    this.waiting = false;
    this.sessionId = data.sessionId;
    this.logFile = data.logFile;
  }

  /** The stream ended. */
  onEnd(reason: EngineLogEndReason): void {
    this.ended = reason;
    this.waiting = false;
  }

  /**
   * Move new rows into {@link rows}, keeping the newest {@link LIVE_ROW_CAP}.
   * @returns Whether anything changed.
   */
  commit(): boolean {
    if (this.pending.length === 0) return false;
    for (const row of this.pending) this.rows.push(row);
    this.pending = [];
    const excess = this.rows.length - LIVE_ROW_CAP;
    if (excess > 0) {
      const dropped = this.rows.splice(0, excess);
      const first = this.sessionFirstKey;
      if (first != null && dropped.some((row) => row.key >= first))
        this.sessionRowsDropped = true;
    }
    return true;
  }

  /** The unseen errors have been seen. */
  markSeen(): void {
    this.unseenErrors = 0;
  }

  /**
   * Put the current session's earlier lines above the rows. `lines` is the session's whole file
   * history, oldest first; the part before the first live file line goes in above that line (after
   * any start-up stderr), at most as many as fit under {@link LIVE_ROW_CAP}.
   */
  prependHistory(lines: readonly string[]): void {
    this.commit();
    const firstFileIndex = this.rows.findIndex(
      (row) => row.kind === "line" && row.source === "file",
    );
    const liveFile =
      firstFileIndex < 0
        ? []
        : this.rows
            .slice(firstFileIndex)
            .flatMap((row) =>
              row.kind === "line" && row.source === "file" ? [row.text] : [],
            )
            .slice(0, OVERLAP_CHECK);
    let older = lines.slice(
      0,
      liveFile.length === 0 ? lines.length : overlapStart(lines, liveFile),
    );
    const room = Math.max(LIVE_ROW_CAP - this.rows.length, 0);
    const truncated = older.length > room;
    if (truncated) older = older.slice(older.length - room);
    const classifier = new LineClassifier();
    const added: LogRow[] = older.map((text): LogRow => ({
      kind: "line",
      key: 0,
      source: "file",
      text,
      ...classifier.classify(text, "file"),
    }));
    if (truncated)
      added.unshift({ kind: "divider", key: 0, divider: "truncated" });
    // Keys below every existing one, increasing downwards, so they stay unique.
    const keyed = added.map((row, index): LogRow => ({
      ...row,
      key: this.previousKey - added.length + index,
    }));
    this.previousKey -= added.length;
    this.rows.splice(
      firstFileIndex < 0 ? this.rows.length : firstFileIndex,
      0,
      ...keyed,
    );
    this.sessionBeganInView = true;
    this.sessionRowsDropped = false;
    this.sessionFirstKey =
      keyed[0]?.key ?? this.sessionFirstKey ?? this.nextKey;
  }

  private accept(seq: number): boolean {
    if (this.lastSeq != null && seq <= this.lastSeq) return false;
    this.lastSeq = seq;
    return true;
  }

  private addDivider(divider: DividerKind): void {
    this.pending.push({ kind: "divider", key: this.nextKey++, divider });
  }
}
```

`app/gui/src/project-view/components/EngineLogs/engineLogStream.ts`:

```ts
/**
 * @file `useEngineLogStream`: the open project's engine log, read from the app's local server
 * (`GET /api/engine-logs/stream`) into an {@link EngineLogModel}.
 */
import type { ToValue } from "$/utils/reactivity";
import {
  engineLogStreamUrl,
  type EngineLogEndData,
  type EngineLogEndReason,
  type EngineLogHelloData,
  type EngineLogLineData,
  type EngineLogSessionData,
  type EngineLogWaitingData,
} from "enso-common/src/services/engineLogs";
import {
  onScopeDispose,
  reactive,
  shallowRef,
  toValue,
  watch,
  type ShallowRef,
} from "vue";
import { EngineLogModel, type LogRow } from "./engineLogModel";

/** The waits before each reconnection attempt; the last repeats. A `hello` starts over. */
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

/** The slice of `EventSource` the stream uses. */
export interface EventSourceLike {
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
}

/** Options for {@link useEngineLogStream}. */
export interface EngineLogStreamOptions {
  /** The project's id in the GUI (`project-<encoded path>`). */
  readonly project: ToValue<string>;
  /** Connected only while true: a project tab in the background holds no connection. */
  readonly active: ToValue<boolean>;
  /** Tests pass a fake. */
  readonly createEventSource?: ((url: string) => EventSourceLike) | undefined;
  /** Tests run frames by hand. */
  readonly requestFrame?: ((callback: () => void) => void) | undefined;
}

/** What the Logs tab and the dock read. */
export interface EngineLogStreamState {
  waiting: boolean;
  ended: EngineLogEndReason | undefined;
  sessionId: string | null;
  logFile: string | null;
  unseenErrors: number;
  sessionStartHeld: boolean;
}

/**
 * Read the project's engine log. Events are applied to the model at once and published to `rows`
 * and `state` once per animation frame. A dropped connection is retried with backoff, resuming
 * after the last event received; an `end` stops it for good.
 */
export function useEngineLogStream(options: EngineLogStreamOptions) {
  const createEventSource =
    options.createEventSource ??
    ((url: string): EventSourceLike => new EventSource(url));
  const requestFrame =
    options.requestFrame ??
    ((callback: () => void) => void requestAnimationFrame(callback));
  let model = new EngineLogModel();
  const rows: ShallowRef<readonly LogRow[]> = shallowRef([]);
  const state = reactive<EngineLogStreamState>({
    waiting: false,
    ended: undefined,
    sessionId: null,
    logFile: null,
    unseenErrors: 0,
    sessionStartHeld: false,
  });
  let source: EventSourceLike | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let frameRequested = false;

  function publish() {
    if (model.commit()) rows.value = model.rows.slice();
    state.waiting = model.waiting;
    state.ended = model.ended;
    state.sessionId = model.sessionId;
    state.logFile = model.logFile;
    state.unseenErrors = model.unseenErrors;
    state.sessionStartHeld = model.sessionStartHeld;
  }

  function schedulePublish() {
    if (frameRequested) return;
    frameRequested = true;
    requestFrame(() => {
      frameRequested = false;
      publish();
    });
  }

  function parse<T>(event: MessageEvent<string>): T {
    return JSON.parse(event.data) as T;
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    source?.close();
    source = undefined;
  }

  function scheduleReconnect() {
    if (model.ended != null || !toValue(options.active)) return;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    disconnect();
    if (model.ended != null) return;
    const current = createEventSource(
      engineLogStreamUrl(toValue(options.project), model.resumeFrom()),
    );
    source = current;
    const on = <T>(type: string, apply: (data: T) => void) =>
      current.addEventListener(type, (event) => {
        if (source !== current) return;
        apply(parse<T>(event));
        schedulePublish();
      });
    on<EngineLogHelloData>("hello", (data) => {
      attempt = 0;
      model.onHello(data);
    });
    on<EngineLogLineData>("line", (data) => model.onLine(data));
    on<EngineLogWaitingData>("waiting", (data) => model.onWaiting(data));
    on<EngineLogSessionData>("session", (data) => model.onSession(data));
    on<EngineLogEndData>("end", (data) => {
      model.onEnd(data.reason);
      disconnect();
    });
    current.addEventListener("error", () => {
      if (source !== current) return;
      disconnect();
      scheduleReconnect();
    });
  }

  watch(
    () => [toValue(options.active), toValue(options.project)] as const,
    ([active, project], previous) => {
      if (previous != null && previous[1] !== project) {
        disconnect();
        model = new EngineLogModel();
        rows.value = [];
        publish();
      }
      if (active) connect();
      else disconnect();
    },
    { immediate: true },
  );
  onScopeDispose(disconnect);

  return {
    rows,
    state,
    /** The unseen errors have been seen (the Logs tab is showing). */
    markSeen() {
      model.markSeen();
      state.unseenErrors = 0;
    },
    /** Put the current session's earlier lines (its whole history, oldest first) above the rows. */
    loadHistory(lines: readonly string[]) {
      model.prependHistory(lines);
      rows.value = model.rows.slice();
      publish();
    },
  };
}

/** The project's engine log, as the dock and the Logs tab use it. */
export type EngineLogStream = ReturnType<typeof useEngineLogStream>;
```

`app/gui/src/project-view/components/EngineLogs/engineLogHistory.ts`:

```ts
/** @file Read a whole engine log session through the existing session-log query. */
import type { ProjectSessionId } from "enso-common/src/services/Backend";
import type { LocalBackend } from "enso-common/src/services/LocalBackend";

/** A bound on the pages read, in case a backend never says `done`. */
export const MAX_HISTORY_PAGES = 1_000;

/**
 * Every line of a session, oldest first: its rolled archives, then its active file, as the shim
 * pages them (`archive:N` … `active` … `done`).
 */
export async function fetchSessionLines(
  backend: Pick<LocalBackend, "getProjectSessionLogs">,
  sessionId: ProjectSessionId,
): Promise<string[]> {
  const lines: string[] = [];
  let scrollId: string | null = null;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const result = await backend.getProjectSessionLogs(sessionId, { scrollId });
    for (const line of result.hits) lines.push(line);
    if (result.scrollId === "done" || result.scrollId === scrollId) break;
    scrollId = result.scrollId;
  }
  return lines;
}
```

`app/gui/src/project-view/components/EngineLogs/CLAUDE.md`:

```markdown
# src/project-view/components/EngineLogs/

The Logs tab of the project view's bottom dock: the open project's engine log,
live, with its earlier lines and sessions. The design is in
`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`; the shim side
is described in `app/project-manager-shim/CLAUDE.md` ("Engine logs").

- `engineLogModel.ts` — framework-free rows built from the stream's events.
  - Level rules: stderr is ERROR; a line that starts no entry takes its entry's
    level.
  - Dividers: `restarted` at a new engine's `waiting`, `skipped` after a gap or
    on a new channel, `truncated` above capped lines.
  - The 20,000-row cap, `prependHistory` (a session's history spliced above the
    first live file line), `filterRows` and `rowsFromLines`.
- `engineLogStream.ts` — `useEngineLogStream`:
  - one `EventSource` on `/api/engine-logs/stream`, connected only while the
    project tab is active (HTTP/1.1 allows six connections per origin);
  - reconnects with backoff and `channel` + `after`;
  - events are batched into one update per animation frame.
- `engineLogHistory.ts` — `fetchSessionLines`: a whole session through the
  existing session-log query (no history API of its own).
```

- [ ] **Step 4: Run the tests to see them pass**

Run:

```bash
cd app/gui
corepack pnpm exec vitest run src/project-view/components/EngineLogs src/components
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
corepack pnpm exec vue-tsc --noEmit -p tsconfig.app.json && corepack pnpm exec eslint src/project-view/components/EngineLogs src/components/ProjectLog
```

Expected: PASS (14 model/helper, 5 stream and 2 history tests; the existing
`src/components` tests unchanged), and no typecheck or lint output.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/EngineLogs app/gui/src/components/ProjectLog/projectLogData.ts
git commit -m "Engine logs: GUI stream client and row model"
```

---

### Task 6: `EngineLogPanel` — the Logs tab's content

**Files:**

- Create in `app/gui/src/project-view/components/EngineLogs/`:
  `engineLogView.ts`, `EngineLogList.vue`, `EngineLogPanel.vue`
- Test:
  `app/gui/src/project-view/components/EngineLogs/__tests__/engineLogView.test.ts`,
  `EngineLogPanel.test.ts`
- Modify: `app/common/src/text/english.json`, after
  `"graphToggleDocumentationEditorShortcut"` (line 821); and
  `app/common/src/text.ts`, `PlaceholderOverrides`, after
  `readonly versioningBlocked: [reason: string]` (line 102)
- Modify: `app/gui/src/project-view/components/EngineLogs/CLAUDE.md`

**Interfaces:**

- Consumes (Task 5): `EngineLogStream`, `filterRows`, `rowsFromLines`,
  `LevelFilter`, `LogRow`, `DividerKind`, `ERROR_LEVEL`, `WARN_LEVEL`,
  `fetchSessionLines`, and in tests `useEngineLogStream` + `FakeEventSource`.
- Consumes (existing): `useBackends()` (`$/providers/backends`), with
  `localBackend.listProjectSessions(projectId)` (oldest first) and
  `getProjectSessionLogs`; `useText()`; `useResizeObserver`
  (`@/composables/events`); `window.api?.system?.showItemInFolder(path)`;
  `toReadableIsoString`.
- Produces:

```ts
// engineLogView.ts
export const ROW_HEIGHT_PX = 18;
export const OVERSCAN_ROWS = 20;
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  count: number,
): { start: number; end: number };
export function isNearBottom(
  element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
): boolean;
// EngineLogList.vue — props { rows: readonly LogRow[] }, v-model:follow (boolean), emits reachedTop
// EngineLogPanel.vue — props { stream: EngineLogStream; projectId: ProjectId }
```

- Text ids (and their English): `bottomDockLogsTab` "Logs" (also the log's
  label, so it is added here); `engineLogsWaiting`, `engineLogsRestarted`,
  `engineLogsSkipped`, `engineLogsTruncated`, `engineLogsEnded`,
  `engineLogsJumpToLatest`, `engineLogsShowInFolder`, `engineLogsLevel`,
  `engineLogsLevelError`, `engineLogsLevelWarn`, `engineLogsLevelInfo`,
  `engineLogsFilter`, `engineLogsSession`, `engineLogsThisSession`,
  `engineLogsLoadingHistory`, `engineLogsHistoryFailed` (with a
  `[message: string]` placeholder).

- [ ] **Step 1: Write the failing tests**

`app/gui/src/project-view/components/EngineLogs/__tests__/engineLogView.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  isNearBottom,
  OVERSCAN_ROWS,
  ROW_HEIGHT_PX,
  visibleRange,
} from "../engineLogView";

test("visibleRange covers the viewport and the overscan, within the rows", () => {
  expect(ROW_HEIGHT_PX).toBe(18);
  expect(visibleRange(0, 180, 1000)).toEqual({
    start: 0,
    end: 10 + OVERSCAN_ROWS,
  });
  expect(visibleRange(1800, 180, 1000)).toEqual({
    start: 100 - OVERSCAN_ROWS,
    end: 110 + OVERSCAN_ROWS,
  });
  expect(visibleRange(0, 0, 3)).toEqual({ start: 0, end: 3 });
});

test("isNearBottom within one row of the end", () => {
  expect(
    isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }),
  ).toBe(true);
  expect(
    isNearBottom({ scrollTop: 885, scrollHeight: 1000, clientHeight: 100 }),
  ).toBe(true);
  expect(
    isNearBottom({ scrollTop: 880, scrollHeight: 1000, clientHeight: 100 }),
  ).toBe(false);
});
```

`app/gui/src/project-view/components/EngineLogs/__tests__/EngineLogPanel.test.ts`:

```ts
import { mountWithProviders } from "$/utils/testing/mountWithProviders";
import { flushPromises } from "@vue/test-utils";
import { ProjectId, ProjectSessionId } from "enso-common/src/services/Backend";
import { Rfc3339DateTime } from "enso-common/src/utilities/data/dateTime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { effectScope, type EffectScope } from "vue";
import EngineLogPanel from "../EngineLogPanel.vue";
import { useEngineLogStream } from "../engineLogStream";
import { FakeEventSource } from "./fakeEventSource";

const mocks = vi.hoisted(() => ({
  listProjectSessions: vi.fn(),
  getProjectSessionLogs: vi.fn(),
}));
vi.mock("$/providers/backends", async () => {
  const { mockBackends } = await import("$/utils/testing/mountWithProviders");
  return { useBackends: () => mockBackends({ localBackend: mocks }) };
});

const PROJECT = ProjectId("project-%2Fprojects%2FMock");
const entry = (level: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [org.enso.Test] ${message}`;

let scope: EffectScope;
let frames: (() => void)[];

beforeEach(() => {
  scope = effectScope();
  frames = [];
  mocks.listProjectSessions.mockResolvedValue([]);
  mocks.getProjectSessionLogs.mockResolvedValue({ scrollId: "done", hits: [] });
});

afterEach(() => {
  scope.stop();
  FakeEventSource.reset();
});

async function mountPanel() {
  const stream = scope.run(() =>
    useEngineLogStream({
      project: PROJECT,
      active: true,
      createEventSource: (url) => new FakeEventSource(url),
      requestFrame: (callback) => void frames.push(callback),
    }),
  )!;
  const source = FakeEventSource.latest();
  const { wrapper } = await mountWithProviders(EngineLogPanel, {
    props: { stream, projectId: PROJECT },
  });
  const flush = async () => {
    while (frames.length > 0) frames.shift()!();
    await flushPromises();
  };
  const lineTexts = () =>
    wrapper.findAll(".row .text").map((text) => text.text());
  return { stream, source, wrapper, flush, lineTexts };
}

function stubScroller(element: Element, scrollTop: number) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: 100,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
}

test("shows live lines, marks stderr, and says while it waits for the engine", async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel();
  source.emit("hello", {
    channel: "c1",
    oldestSeq: 1,
    nextSeq: 1,
    sessionId: null,
    logFile: null,
  });
  source.emit("waiting", { seq: 1 });
  source.emit("line", {
    seq: 2,
    source: "stderr",
    sessionId: null,
    text: "Picked up JAVA_TOOL_OPTIONS",
  });
  await flush();
  expect(lineTexts()).toEqual(["Picked up JAVA_TOOL_OPTIONS"]);
  expect(wrapper.find(".row.stderr .marker").text()).toBe("stderr");
  expect(wrapper.text()).toContain("Waiting for the engine…");
  source.emit("session", { seq: 3, sessionId: "s1", logFile: "/logs/s1.log" });
  await flush();
  expect(wrapper.text()).not.toContain("Waiting for the engine…");
});

test("filters by level and by text", async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel();
  source.emit("hello", {
    channel: "c1",
    oldestSeq: 1,
    nextSeq: 1,
    sessionId: "s1",
    logFile: null,
  });
  source.emit("line", {
    seq: 1,
    source: "file",
    sessionId: "s1",
    text: entry("INFO", "started"),
  });
  source.emit("line", {
    seq: 2,
    source: "file",
    sessionId: "s1",
    text: entry("ERROR", "query failed"),
  });
  source.emit("line", {
    seq: 3,
    source: "file",
    sessionId: "s1",
    text: entry("ERROR", "disk full"),
  });
  await flush();
  expect(lineTexts()).toHaveLength(3);
  await wrapper.find('select[aria-label="Level"]').setValue("error");
  expect(lineTexts()).toEqual([
    entry("ERROR", "query failed"),
    entry("ERROR", "disk full"),
  ]);
  await wrapper.find('input[aria-label="Filter logs"]').setValue("DISK");
  expect(lineTexts()).toEqual([entry("ERROR", "disk full")]);
});

test("scrolling up pauses following; Jump to latest resumes it", async () => {
  const { source, wrapper, flush } = await mountPanel();
  source.emit("hello", {
    channel: "c1",
    oldestSeq: 1,
    nextSeq: 1,
    sessionId: "s1",
    logFile: null,
  });
  source.emit("line", { seq: 1, source: "file", sessionId: "s1", text: "one" });
  await flush();
  const list = wrapper.find('[role="log"]');
  stubScroller(list.element, 400);
  await list.trigger("scroll");
  const jump = wrapper.find("button.jump");
  expect(jump.exists()).toBe(true);
  await jump.trigger("click");
  await flushPromises();
  expect(wrapper.find("button.jump").exists()).toBe(false);
  expect((list.element as HTMLElement).scrollTop).toBe(1000);
});

test("scrolling up at the top loads the session's earlier lines", async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel();
  source.emit("hello", {
    channel: "c1",
    oldestSeq: 40,
    nextSeq: 42,
    sessionId: "s1",
    logFile: "/logs/s1.log",
  });
  source.emit("line", { seq: 40, source: "file", sessionId: "s1", text: "L3" });
  source.emit("line", { seq: 41, source: "file", sessionId: "s1", text: "L4" });
  await flush();
  mocks.getProjectSessionLogs.mockResolvedValueOnce({
    scrollId: "done",
    hits: ["L1", "L2", "L3", "L4"],
  });
  await wrapper.find('[role="log"]').trigger("wheel", { deltaY: -100 });
  await flush();
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledWith(
    ProjectSessionId("s1"),
    { scrollId: null },
  );
  expect(lineTexts()).toEqual(["L1", "L2", "L3", "L4"]);
  // The session is now held from its start: scrolling up again loads nothing.
  await wrapper.find('[role="log"]').trigger("wheel", { deltaY: -100 });
  await flush();
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledTimes(1);
});

test("lists earlier sessions apart from the current one", async () => {
  mocks.listProjectSessions.mockResolvedValue([
    {
      projectId: PROJECT,
      projectSessionId: ProjectSessionId("old"),
      createdAt: Rfc3339DateTime("2026-10-19T09:00:00"),
    },
    {
      projectId: PROJECT,
      projectSessionId: ProjectSessionId("s1"),
      createdAt: Rfc3339DateTime("2026-10-20T10:00:00"),
    },
  ]);
  const { source, wrapper, flush } = await mountPanel();
  source.emit("hello", {
    channel: "c1",
    oldestSeq: 1,
    nextSeq: 1,
    sessionId: "s1",
    logFile: null,
  });
  await flush();
  const options = wrapper
    .find('select[aria-label="Session"]')
    .findAll("option");
  expect(options.map((option) => option.text())).toEqual([
    "This session",
    expect.stringContaining("Session 1"),
  ]);
});

test("shows an earlier session, read-only", async () => {
  mocks.listProjectSessions.mockResolvedValue([
    {
      projectId: PROJECT,
      projectSessionId: ProjectSessionId("old"),
      createdAt: Rfc3339DateTime("2026-10-19T09:00:00"),
    },
  ]);
  mocks.getProjectSessionLogs.mockResolvedValue({
    scrollId: "done",
    hits: ["from yesterday"],
  });
  const { source, wrapper, flush, lineTexts } = await mountPanel();
  // The engine is starting: live, the tab would say it is waiting.
  source.emit("hello", {
    channel: "c1",
    oldestSeq: 1,
    nextSeq: 1,
    sessionId: null,
    logFile: null,
  });
  source.emit("waiting", { seq: 1 });
  await flush();
  expect(wrapper.text()).toContain("Waiting for the engine…");
  const picker = wrapper.find('select[aria-label="Session"]');
  await picker.setValue("old");
  await flush();
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledWith(
    ProjectSessionId("old"),
    { scrollId: null },
  );
  expect(lineTexts()).toEqual(["from yesterday"]);
  // Read-only: no live notices.
  expect(wrapper.text()).not.toContain("Waiting for the engine…");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/EngineLogs`

Expected: FAIL with `Failed to resolve import "../engineLogView"` and
`"../EngineLogPanel.vue"`, while Task 5's suites still pass.

- [ ] **Step 3: Add the text**

In `app/common/src/text/english.json`, after
`"graphToggleDocumentationEditorShortcut": "Show/Hide Documentation Editor",`,
insert:

```json
  "bottomDockLogsTab": "Logs",
  "engineLogsWaiting": "Waiting for the engine…",
  "engineLogsRestarted": "Engine restarted (new session)",
  "engineLogsSkipped": "Some lines were skipped; see history",
  "engineLogsTruncated": "Earlier lines are not shown here; open the log file to see them",
  "engineLogsEnded": "The project's engine is no longer running",
  "engineLogsJumpToLatest": "Jump to latest",
  "engineLogsShowInFolder": "Show in folder",
  "engineLogsLevel": "Level",
  "engineLogsLevelError": "Error",
  "engineLogsLevelWarn": "Warn and above",
  "engineLogsLevelInfo": "Info and above",
  "engineLogsFilter": "Filter logs",
  "engineLogsSession": "Session",
  "engineLogsThisSession": "This session",
  "engineLogsLoadingHistory": "Loading earlier lines…",
  "engineLogsHistoryFailed": "Could not load the log: $0",
```

In `app/common/src/text.ts`, after
`readonly versioningBlocked: [reason: string]`, add:

```ts
  readonly engineLogsHistoryFailed: [message: string]
```

- [ ] **Step 4: Implement the view helpers and the list**

`app/gui/src/project-view/components/EngineLogs/engineLogView.ts`:

```ts
/** @file Geometry of the Logs tab's virtualised list: fixed-height rows, rendered near the viewport only. */

/** The height of one row; rows are one line each. */
export const ROW_HEIGHT_PX = 18;
/** Rows rendered beyond each edge of the viewport, so that a fast scroll does not show blanks. */
export const OVERSCAN_ROWS = 20;

/** The rows to render, `start` inclusive and `end` exclusive. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  count: number,
): { start: number; end: number } {
  const start = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS,
  );
  const end = Math.min(
    count,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT_PX) + OVERSCAN_ROWS,
  );
  return { start, end };
}

/** Whether the list is scrolled to its end, give or take a row: it then follows new rows. */
export function isNearBottom(
  element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    ROW_HEIGHT_PX
  );
}
```

`app/gui/src/project-view/components/EngineLogs/EngineLogList.vue`:

```vue
<script setup lang="ts">
/**
 * @file The Logs tab's rows: a virtualised list that follows the newest row until the user scrolls
 * up, and keeps its place when rows are added above or dropped from the top.
 */
import { useText } from "$/providers/text";
import { useResizeObserver } from "@/composables/events";
import type { TextId } from "enso-common/src/text";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ERROR_LEVEL,
  WARN_LEVEL,
  type DividerKind,
  type LogRow,
} from "./engineLogModel";
import { isNearBottom, ROW_HEIGHT_PX, visibleRange } from "./engineLogView";

const { rows } = defineProps<{ rows: readonly LogRow[] }>();
const follow = defineModel<boolean>("follow", { required: true });
const emit = defineEmits<{ reachedTop: [] }>();
const { getText } = useText();

const DIVIDER_TEXT: Readonly<Record<DividerKind, TextId>> = {
  restarted: "engineLogsRestarted",
  skipped: "engineLogsSkipped",
  truncated: "engineLogsTruncated",
};

const scroller = ref<HTMLElement>();
const scrollerSize = useResizeObserver(scroller);
const scrollTop = ref(0);
const range = computed(() =>
  visibleRange(scrollTop.value, scrollerSize.value.y, rows.length),
);
const visible = computed(() =>
  rows
    .slice(range.value.start, range.value.end)
    .map((row, offset) => ({ row, index: range.value.start + offset })),
);

function rowClass(row: LogRow) {
  return row.kind === "divider"
    ? { divider: true }
    : {
        line: true,
        stderr: row.source === "stderr",
        error: row.level === ERROR_LEVEL,
        warn: row.level === WARN_LEVEL,
        continuation: !row.entryStart,
      };
}

function scrollToEnd() {
  const element = scroller.value;
  if (element == null) return;
  element.scrollTop = element.scrollHeight;
  scrollTop.value = element.scrollTop;
}

function onScroll() {
  const element = scroller.value;
  if (element == null) return;
  scrollTop.value = element.scrollTop;
  follow.value = isNearBottom(element);
  if (element.scrollTop <= 0 && rows.length > 0) emit("reachedTop");
}

/** A scroll up at the top: no `scroll` event fires when the rows do not fill the view. */
function onWheel(event: WheelEvent) {
  if (
    event.deltaY < 0 &&
    (scroller.value?.scrollTop ?? 0) <= 0 &&
    rows.length > 0
  ) {
    emit("reachedTop");
  }
}

onMounted(() => {
  if (follow.value) scrollToEnd();
});

watch(
  () => rows,
  async (now, before) => {
    await nextTick();
    if (follow.value) {
      scrollToEnd();
      return;
    }
    // Keep the row at the top of the view in place when rows are added above it or dropped.
    const element = scroller.value;
    if (element == null || before.length === 0) return;
    const anchorIndex = Math.floor(element.scrollTop / ROW_HEIGHT_PX);
    const anchor = before[anchorIndex];
    if (anchor == null) return;
    const index = now.findIndex((row) => row.key === anchor.key);
    if (index >= 0 && index !== anchorIndex) {
      element.scrollTop += (index - anchorIndex) * ROW_HEIGHT_PX;
      scrollTop.value = element.scrollTop;
    }
  },
);

watch(follow, (following) => {
  if (following) void nextTick(scrollToEnd);
});
</script>

<template>
  <div
    ref="scroller"
    class="EngineLogList"
    role="log"
    tabindex="0"
    :aria-label="getText('bottomDockLogsTab')"
    @scroll="onScroll"
    @wheel.stop.passive="onWheel"
  >
    <div
      class="content"
      :style="{ height: `${rows.length * ROW_HEIGHT_PX}px` }"
    >
      <div
        v-for="{ row, index } in visible"
        :key="row.key"
        class="row"
        :class="rowClass(row)"
        :style="{ transform: `translateY(${index * ROW_HEIGHT_PX}px)` }"
        :title="row.kind === 'line' ? row.text : undefined"
      >
        <template v-if="row.kind === 'line'">
          <span v-if="row.source === 'stderr'" class="marker">stderr</span>
          <span class="text">{{ row.text }}</span>
        </template>
        <span v-else class="dividerText">{{
          getText(DIVIDER_TEXT[row.divider])
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.EngineLogList {
  position: relative;
  overflow: auto;
  /*noinspection CssNoGenericFontName*/
  font-family: var(--font-mono);
  font-variant-ligatures: var(--font-mono-readonly-variant-ligatures);
  font-feature-settings: var(--font-mono-readonly-feature-settings);
  font-size: 12px;
  outline: none;
}

.content {
  position: relative;
  width: 100%;
}

.row {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  line-height: 18px;
  padding: 0 8px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}

.row.warn {
  color: color-mix(in oklab, var(--color-warning) 60%, black);
}

.row.error {
  color: var(--color-error);
}

.row.continuation {
  opacity: 0.85;
}

.marker {
  display: inline-block;
  margin-right: 6px;
  padding: 0 4px;
  border-radius: 4px;
  line-height: 14px;
  font-size: 10px;
  background-color: var(--color-error);
  color: var(--color-text-inversed);
}

.row.divider {
  text-align: center;
  font-style: italic;
  opacity: 0.6;
  border-top: 1px dashed var(--color-dim);
}
</style>
```

- [ ] **Step 5: Implement the panel**

`app/gui/src/project-view/components/EngineLogs/EngineLogPanel.vue`:

```vue
<script setup lang="ts">
/**
 * @file The Logs tab of the bottom dock: the open project's engine log as it is written, with its
 * earlier lines and sessions (`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`).
 */
import { useBackends } from "$/providers/backends";
import { useText } from "$/providers/text";
import { useQuery } from "@tanstack/vue-query";
import {
  ProjectSessionId,
  type ProjectId,
  type ProjectSession,
} from "enso-common/src/services/Backend";
import type { LocalBackend } from "enso-common/src/services/LocalBackend";
import { toReadableIsoString } from "enso-common/src/utilities/data/dateTime";
import { computed, ref, shallowRef, watch } from "vue";
import EngineLogList from "./EngineLogList.vue";
import { fetchSessionLines } from "./engineLogHistory";
import {
  filterRows,
  rowsFromLines,
  type LevelFilter,
  type LogRow,
} from "./engineLogModel";
import type { EngineLogStream } from "./engineLogStream";

const { stream, projectId } = defineProps<{
  stream: EngineLogStream;
  projectId: ProjectId;
}>();

const { getText } = useText();
const backends = useBackends();
const systemApi = window.api?.system;

const level = ref<LevelFilter>("info");
const filterText = ref("");
const follow = ref(true);
/** The earlier session shown, read-only; `''` for the live one. */
const selectedSession = ref("");
const sessionRows = shallowRef<readonly LogRow[]>([]);
const loading = ref(false);
const loadError = ref<string>();

const live = computed(() => selectedSession.value === "");

const sessions = useQuery({
  queryKey: computed(() => [
    "engineLogSessions",
    projectId,
    stream.state.sessionId,
  ]),
  queryFn: async (): Promise<readonly ProjectSession[]> =>
    (await backends.localBackend?.listProjectSessions(projectId)) ?? [],
});

/** The earlier sessions, newest first, numbered from the oldest as the Activity tab numbers them. */
const earlierSessions = computed(() =>
  (sessions.data.value ?? [])
    .map((session, index) => ({ session, number: index + 1 }))
    .filter(
      ({ session }) => session.projectSessionId !== stream.state.sessionId,
    )
    .reverse(),
);

const shownRows = computed(() =>
  filterRows(live.value ? stream.rows.value : sessionRows.value, {
    level: level.value,
    text: filterText.value,
  }),
);

async function withBackend(task: (backend: LocalBackend) => Promise<void>) {
  const backend = backends.localBackend;
  if (backend == null) return;
  loading.value = true;
  loadError.value = undefined;
  try {
    await task(backend);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

watch(selectedSession, (sessionId) => {
  sessionRows.value = [];
  follow.value = true;
  if (sessionId === "") return;
  void withBackend(async (backend) => {
    const lines = await fetchSessionLines(backend, ProjectSessionId(sessionId));
    if (selectedSession.value === sessionId)
      sessionRows.value = rowsFromLines(lines);
  });
});

/** At the top of the live view: load the current session's earlier lines, if it has any. */
function onReachedTop() {
  const sessionId = stream.state.sessionId;
  if (
    !live.value ||
    loading.value ||
    stream.state.sessionStartHeld ||
    sessionId == null
  )
    return;
  void withBackend(async (backend) => {
    stream.loadHistory(
      await fetchSessionLines(backend, ProjectSessionId(sessionId)),
    );
  });
}

function showInFolder() {
  const file = stream.state.logFile;
  if (file != null) systemApi?.showItemInFolder(file);
}

function sessionLabel(session: ProjectSession, number: number) {
  return `${getText("projectSessionX", number)} (${toReadableIsoString(new Date(session.createdAt))})`;
}
</script>

<template>
  <div class="EngineLogPanel" data-testid="engine-log-panel">
    <div class="toolbar">
      <select v-model="level" :aria-label="getText('engineLogsLevel')">
        <option value="error">{{ getText("engineLogsLevelError") }}</option>
        <option value="warn">{{ getText("engineLogsLevelWarn") }}</option>
        <option value="info">{{ getText("engineLogsLevelInfo") }}</option>
      </select>
      <input
        v-model="filterText"
        type="search"
        :aria-label="getText('engineLogsFilter')"
        :placeholder="getText('engineLogsFilter')"
      />
      <select
        v-model="selectedSession"
        :aria-label="getText('engineLogsSession')"
      >
        <option value="">{{ getText("engineLogsThisSession") }}</option>
        <option
          v-for="{ session, number } in earlierSessions"
          :key="session.projectSessionId"
          :value="session.projectSessionId"
        >
          {{ sessionLabel(session, number) }}
        </option>
      </select>
      <span class="spacer" />
      <button
        v-if="systemApi != null && stream.state.logFile != null"
        type="button"
        @click="showInFolder"
      >
        {{ getText("engineLogsShowInFolder") }}
      </button>
    </div>
    <div v-if="loading" class="notice" role="status">
      {{ getText("engineLogsLoadingHistory") }}
    </div>
    <div v-if="loadError != null" class="notice error" role="alert">
      {{ getText("engineLogsHistoryFailed", loadError) }}
    </div>
    <EngineLogList
      v-model:follow="follow"
      class="list"
      :rows="shownRows"
      @reachedTop="onReachedTop"
    />
    <div v-if="live && stream.state.waiting" class="notice" role="status">
      {{ getText("engineLogsWaiting") }}
    </div>
    <div
      v-else-if="live && stream.state.ended != null"
      class="notice"
      role="status"
    >
      {{ getText("engineLogsEnded") }}
    </div>
    <button
      v-if="live && !follow"
      type="button"
      class="jump"
      @click="follow = true"
    >
      {{ getText("engineLogsJumpToLatest") }}
    </button>
  </div>
</template>

<style scoped>
.EngineLogPanel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  backdrop-filter: var(--blur-app-bg);
  background-color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: var(--color-text);
}

.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
}

.toolbar select,
.toolbar input,
.toolbar button {
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--color-dim);
  background-color: white;
  font: inherit;
}

.toolbar input {
  width: 16em;
}

.spacer {
  flex: 1;
}

.list {
  flex: 1;
  min-height: 0;
}

.notice {
  flex: none;
  padding: 2px 8px;
  font-size: 12px;
  opacity: 0.7;
}

.notice.error {
  color: var(--color-error);
  opacity: 1;
}

.jump {
  position: absolute;
  right: 16px;
  bottom: 16px;
  padding: 2px 10px;
  border-radius: 12px;
  border: none;
  background-color: var(--color-text);
  color: var(--color-text-inversed);
  font-size: 12px;
}
</style>
```

Append to `app/gui/src/project-view/components/EngineLogs/CLAUDE.md`:

```markdown
- `EngineLogPanel.vue` — the tab's content:
  - level, text and session filters;
  - "Show in folder" (Electron only; it reveals the current session's file,
    whose folder holds every session);
  - the waiting and ended notices, and Jump to latest;
  - an earlier session read whole and read-only (`rowsFromLines`).
- `EngineLogList.vue` + `engineLogView.ts` — a virtualised list (`role="log"`)
  with 18 px rows. It follows the newest row until the user scrolls up, keeps
  its place when rows are added above or dropped, and emits `reachedTop` (on a
  scroll, or a wheel at the top) to load history.
```

- [ ] **Step 6: Run the tests to see them pass**

Run:

```bash
corepack pnpm --filter enso-common run compile
cd app/gui
corepack pnpm exec vitest run src/project-view/components/EngineLogs
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
corepack pnpm exec vue-tsc --noEmit -p tsconfig.app.json && corepack pnpm exec eslint src/project-view/components/EngineLogs
```

Expected: PASS (2 view and 6 panel tests, plus Task 5's), with no typecheck or
lint output.

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/project-view/components/EngineLogs app/common/src/text/english.json app/common/src/text.ts
git commit -m "Engine logs: the Logs tab's panel"
```

---

### Task 7: Dock tabs, the `graph.toggleLogs` action and shortcut, and the wiring

**Files:**

- Create: `app/gui/src/project-view/components/BottomPanel/dockTab.ts`,
  `BottomPanelTabs.vue`
- Test:
  `app/gui/src/project-view/components/BottomPanel/__tests__/dockTab.test.ts`,
  `BottomPanelTabs.test.ts`
- Modify: `app/gui/src/project-view/components/BottomPanel.vue` (whole file, 116
  lines)
- Modify: `app/gui/src/project-view/components/GraphEditor.vue`:
  - imports 20–87
  - `showCodeEditor` (line 236)
  - handlers (267)
  - after `isActive` (422–424)
  - `contextMenuActions` (777–790)
  - template (847–849)
- Modify: `app/gui/src/configurations/graphInputBindings.ts` (after
  `graph.toggleCodeEditor`, lines 53–57)
- Modify: `app/gui/src/project-view/providers/action.ts` (after
  `graph.toggleCodeEditor`, lines 204–208)
- Modify: `app/common/src/text/english.json`, `app/common/src/text.ts`
- Test: `app/gui/src/configurations/__tests__/keyboardShortcuts.test.ts`, lines
  56–108 (the pinned defaults) plus a new test

**Interfaces:**

- Consumes (Task 5/6): `useEngineLogStream`,
  `EngineLogStream.state.unseenErrors`, `markSeen`, and `EngineLogPanel`.
- Consumes (existing): `toggledAction`, `registerHandlers` and `isActive`
  (`GraphEditor.vue`); `defaultShortcuts` and `conflictsFor`
  (`$/configurations/keyboardShortcuts`).
- Produces:

```ts
// dockTab.ts
export type DockTab = "code" | "logs";
export const DOCK_TAB_STORAGE_KEY = "bottom-dock-tab";
export function useDockTab(): Ref<DockTab>;
export function toggleDockTab(
  show: Ref<boolean>,
  tab: Ref<DockTab>,
  target: DockTab,
): void;
// BottomPanelTabs.vue — v-model:tab (DockTab), props { logsBadge?: number }
// BottomPanel.vue — v-model:show, v-model:tab, props { logsBadge?: number }, slots #code and #logs
// graph action 'graph.toggleLogs' (displayable; default binding 'Mod+L')
```

- Text ids: `graphToggleLogsShortcut` "Show/Hide Engine Logs", `bottomDockTabs`
  "Bottom panel", `bottomDockCodeTab` "Code", and `engineLogsUnseenErrors` "$0
  new errors" (with a `[count: number]` placeholder).

- [ ] **Step 1: Write the failing tests**

`app/gui/src/project-view/components/BottomPanel/__tests__/dockTab.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import {
  DOCK_TAB_STORAGE_KEY,
  toggleDockTab,
  useDockTab,
  type DockTab,
} from "../dockTab";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

test("remembers the selected tab in local storage", async () => {
  const scope = effectScope();
  const first = scope.run(() => useDockTab())!;
  expect(first.value).toBe("code");
  first.value = "logs";
  await nextTick();
  expect(localStorage.getItem(DOCK_TAB_STORAGE_KEY)).toBe("logs");
  const second = scope.run(() => useDockTab())!;
  expect(second.value).toBe("logs");
  scope.stop();
});

test("reads an unknown stored value as the Code tab", () => {
  localStorage.setItem(DOCK_TAB_STORAGE_KEY, "terminal");
  const scope = effectScope();
  expect(scope.run(() => useDockTab())!.value).toBe("code");
  scope.stop();
});

test("toggleDockTab opens the dock on a tab, switches tabs, and closes when that tab shows", () => {
  const show = ref(false);
  const tab = ref<DockTab>("code");
  toggleDockTab(show, tab, "logs");
  expect([show.value, tab.value]).toEqual([true, "logs"]);
  toggleDockTab(show, tab, "logs");
  expect([show.value, tab.value]).toEqual([false, "logs"]);
  show.value = true;
  tab.value = "code";
  toggleDockTab(show, tab, "logs");
  expect([show.value, tab.value]).toEqual([true, "logs"]);
});
```

`app/gui/src/project-view/components/BottomPanel/__tests__/BottomPanelTabs.test.ts`:

```ts
import { mountWithProviders } from "$/utils/testing/mountWithProviders";
import { expect, test } from "vitest";
import BottomPanelTabs from "../BottomPanelTabs.vue";

test("lists the tabs and selects one", async () => {
  const { wrapper } = await mountWithProviders(BottomPanelTabs, {
    props: { tab: "code", logsBadge: 0 },
  });
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map((tab) => tab.text())).toEqual(["Code", "Logs"]);
  expect(tabs.map((tab) => tab.attributes("aria-selected"))).toEqual([
    "true",
    "false",
  ]);
  await tabs[1]!.trigger("click");
  expect(wrapper.emitted("update:tab")).toEqual([["logs"]]);
});

test("shows the error badge only while the Logs tab is not selected", async () => {
  const { wrapper, setProps } = await mountWithProviders(BottomPanelTabs, {
    props: { tab: "code", logsBadge: 3 },
  });
  const badge = () => wrapper.find('[data-testid="logs-badge"]');
  expect(badge().text()).toBe("3");
  expect(badge().attributes("aria-label")).toBe("3 new errors");
  await setProps({ logsBadge: 120 });
  expect(badge().text()).toBe("99+");
  await setProps({ tab: "logs" });
  expect(badge().exists()).toBe(false);
});
```

In `app/gui/src/configurations/__tests__/keyboardShortcuts.test.ts`, in the
`are those before #170, …` test, make two changes:

1. Add `'graph.toggleLogs': ['Mod+L'],` right after
   `'graph.toggleCodeEditor': ['Mod+\`'],`in the`toStrictEqual` object.
2. Add `'graph.toggleLogs',` right after `'graph.toggleCodeEditor',` in the
   `Object.keys(GRAPH_BINDINGS)` list.

Then append this `describe`:

```ts
describe("graph.toggleLogs", () => {
  test("defaults to Mod+L, which nothing active over the graph has (the drive's Label is drive-only)", () => {
    const shortcuts = defaultShortcuts();
    const logs = byId(shortcuts, "graph.toggleLogs");
    expect(logs.defaults).toEqual(["Mod+L"]);
    expect(logs.scope).toBe("graph");
    expect(conflictsFor(shortcuts, logs, "Mod+L")).toEqual([]);
    expect(byId(shortcuts, "label").bindings).toContain("Mod+L");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/BottomPanel src/configurations`

Expected: FAIL. The two BottomPanel suites cannot resolve `../dockTab` and
`../BottomPanelTabs.vue`. The keyboard test fails with
`No shortcut graph.toggleLogs.` and on the pinned defaults object.

- [ ] **Step 3: Implement the tabs**

`app/gui/src/project-view/components/BottomPanel/dockTab.ts`:

```ts
/** @file Which tab of the bottom dock shows: remembered across reloads, shared by every project tab. */
import { useLocalStorage } from "@vueuse/core";
import type { Ref } from "vue";

/** The bottom dock's tabs. */
export type DockTab = "code" | "logs";

/** Its own key: the dock's height stays under `code-editor-size`, in the shape it has always had. */
export const DOCK_TAB_STORAGE_KEY = "bottom-dock-tab";

/** The selected tab, saved in local storage. */
export function useDockTab(): Ref<DockTab> {
  const tab = useLocalStorage<DockTab>(DOCK_TAB_STORAGE_KEY, "code");
  if (tab.value !== "code" && tab.value !== "logs") tab.value = "code";
  return tab;
}

/** Open the dock on `target`; close it if `target` is already showing. */
export function toggleDockTab(
  show: Ref<boolean>,
  tab: Ref<DockTab>,
  target: DockTab,
): void {
  if (show.value && tab.value === target) {
    show.value = false;
  } else {
    tab.value = target;
    show.value = true;
  }
}
```

`app/gui/src/project-view/components/BottomPanel/BottomPanelTabs.vue`:

```vue
<script setup lang="ts">
/** @file The bottom dock's tab strip: Code and Logs, with the count of unseen errors on Logs. */
import { useText } from "$/providers/text";
import type { DockTab } from "./dockTab";

const tab = defineModel<DockTab>("tab", { required: true });
const { logsBadge = 0 } = defineProps<{
  /** ERROR and stderr lines the Logs tab has not shown yet. */
  logsBadge?: number;
}>();
const { getText } = useText();
</script>

<template>
  <div
    class="BottomPanelTabs"
    role="tablist"
    :aria-label="getText('bottomDockTabs')"
  >
    <button
      type="button"
      role="tab"
      class="tab"
      :aria-selected="tab === 'code'"
      data-testid="dock-tab-code"
      @click="tab = 'code'"
    >
      {{ getText("bottomDockCodeTab") }}
    </button>
    <button
      type="button"
      role="tab"
      class="tab"
      :aria-selected="tab === 'logs'"
      data-testid="dock-tab-logs"
      @click="tab = 'logs'"
    >
      {{ getText("bottomDockLogsTab") }}
      <span
        v-if="logsBadge > 0 && tab !== 'logs'"
        class="badge"
        data-testid="logs-badge"
        :aria-label="getText('engineLogsUnseenErrors', logsBadge)"
        >{{ logsBadge > 99 ? "99+" : logsBadge }}</span
      >
    </button>
  </div>
</template>

<style scoped>
.BottomPanelTabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 28px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 8px 8px 0 0;
  background-color: rgba(255, 255, 255, 0.5);
  color: var(--color-text);
  font-size: 13px;
}

.tab[aria-selected="true"] {
  background-color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

.badge {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background-color: var(--color-error);
  color: var(--color-text-inversed);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
</style>
```

Replace `app/gui/src/project-view/components/BottomPanel.vue` with:

```vue
<script setup lang="ts">
/** @file The bottom dock: a resizable panel with a Code tab and a Logs tab. */
import ActionButton from "@/components/ActionButton.vue";
import BottomPanelTabs from "@/components/BottomPanel/BottomPanelTabs.vue";
import type { DockTab } from "@/components/BottomPanel/dockTab";
import { useResizeHandles } from "@/components/resizeHandles";
import ResizeHandles from "@/components/ResizeHandles.vue";
import WithFullscreenMode from "@/components/WithFullscreenMode.vue";
import { useResizeObserver } from "@/composables/events";
import { useLocalStorage } from "@vueuse/core";
import { computed, ref, watch } from "vue";

defineOptions({
  inheritAttrs: false,
});

const { logsBadge = 0 } = defineProps<{
  /** ERROR and stderr lines the Logs tab has not shown yet. */
  logsBadge?: number;
}>();
defineSlots<{ code(): any; logs(): any }>();

const MIN_DOCK_SIZE_PX = 20;

const rootElement = ref<HTMLElement>();

const show = defineModel<boolean>("show", { required: true });
const tab = defineModel<DockTab>("tab", { required: true });

const savedSize = useLocalStorage<{ height: number | null }>(
  "code-editor-size",
  { height: null },
);

const resizeHandles = useResizeHandles({
  size: useResizeObserver(rootElement),
});
resizeHandles.onResizeHeight((value) => (savedSize.value = { height: value }));

function clampSize(size: number) {
  return Math.max(size, MIN_DOCK_SIZE_PX);
}

const fullscreen = ref(false);
const fullscreenAnimating = ref(false);

watch(show, (show) => {
  if (!show) fullscreen.value = false;
});

const style = computed(() =>
  savedSize.value?.height != null
    ? { "--panel-size": `${clampSize(savedSize.value.height)}px` }
    : undefined,
);
</script>

<template>
  <ActionButton
    action="graph.toggleCodeEditor"
    class="gutterButton bottomOfGutter"
    :class="{ aboveFullscreen: fullscreen || fullscreenAnimating }"
  />
  <Transition>
    <div
      v-if="show"
      ref="rootElement"
      class="BottomPanel dock"
      :style="style"
      data-testid="bottomDock"
      v-bind="$attrs"
    >
      <WithFullscreenMode
        v-model="fullscreen"
        @update:animating="fullscreenAnimating = $event"
      >
        <ActionButton
          action="panel.fullscreen"
          class="gutterButton topOfGutter"
          :class="{ aboveFullscreen: fullscreen || fullscreenAnimating }"
        />
        <div class="dockLayout">
          <BottomPanelTabs
            v-model:tab="tab"
            class="tabs"
            :logsBadge="logsBadge"
          />
          <div class="dockBody">
            <slot v-if="tab === 'code'" name="code" />
            <slot v-else name="logs" />
          </div>
        </div>
      </WithFullscreenMode>
      <ResizeHandles top v-on="resizeHandles.events" />
    </div>
  </Transition>
</template>

<style scoped>
.BottomPanel {
  --panel-size: var(--code-editor-default-height);
  position: relative;
  height: var(--panel-size);
  /*
   * Limit the size of the panel. Because size is persisted, allowing the panel to fill the screen
   * may be confusing, especially if the user sets the size on one screen and then reopens the code
   * editor on a screen with a lower resolution.
   */
  max-height: 85svh;
  margin-right: 1px;
  /*
   * Ensure that the content height doesn't exceed the panel's height while animating, which can
   * cause the native scrollbar to appear momentarily, "shaking" the viewport.
   */
  contain: layout;
}
.v-enter-active,
.v-leave-active {
  transition: height 0.1s ease;
}
.v-enter-from,
.v-leave-to {
  height: 0;
}

.dockLayout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.tabs {
  flex: none;
  /* Clear of the fullscreen button in the gutter. */
  padding-left: 44px;
}

.dockBody {
  flex: 1;
  min-height: 0;
}

.gutterButton {
  position: absolute;
  z-index: 1;
  left: 12px;
  &.aboveFullscreen {
    z-index: 2;
  }
}

.bottomOfGutter {
  bottom: 12px;
}

.topOfGutter {
  top: 12px;
}
</style>
```

- [ ] **Step 4: Add the action, the shortcut and the text**

In `app/gui/src/configurations/graphInputBindings.ts`, after the
`'graph.toggleCodeEditor'` entry, add:

```ts
    'graph.toggleLogs': {
      // Not the spec's `Mod+Shift+\``: with Shift held, `event.key` is `~` (US) or `¬` (UK), so that
      // binding never matches. `Mod+L` is the drive's Label too, but the drive and the graph are
      // never active together (see `keyboardShortcuts.ts`).
      bindings: ['Mod+L'],
      icon: 'log',
      category: 'graphEditor',
    },
```

In `app/gui/src/project-view/providers/action.ts`, after the
`'graph.toggleCodeEditor'` entry in `displayableActions`, add:

```ts
  'graph.toggleLogs': {
    icon: 'log',
    description: 'Engine Logs',
    shortcut: () => graphBindings.bindings['graph.toggleLogs'],
  },
```

In `app/common/src/text/english.json`, after
`"graphToggleCodeEditorShortcut": "Show/Hide Code Editor",`, add:

```json
  "graphToggleLogsShortcut": "Show/Hide Engine Logs",
  "bottomDockTabs": "Bottom panel",
  "bottomDockCodeTab": "Code",
  "engineLogsUnseenErrors": "$0 new errors",
```

In `app/common/src/text.ts`, after the line added in Task 6, add:

```ts
  readonly engineLogsUnseenErrors: [count: number]
```

- [ ] **Step 5: Wire `GraphEditor.vue`**

1. Imports. After `import BottomPanel from '@/components/BottomPanel.vue'`, add:

```ts
import { toggleDockTab, useDockTab } from "@/components/BottomPanel/dockTab";
```

After `import CodeEditor from '@/components/CodeEditor.vue'`, add:

```ts
import EngineLogPanel from "@/components/EngineLogs/EngineLogPanel.vue";
import { useEngineLogStream } from "@/components/EngineLogs/engineLogStream";
```

(`watchEffect` is already imported from `vue`.)

2. After `const showCodeEditor = ref(false)` (line 236), add:

```ts
const dockTab = useDockTab();
```

3. In `registerHandlers`, after
   `'graph.toggleCodeEditor': toggledAction(showCodeEditor),` (line 267), add:

```ts
  'graph.toggleLogs': {
    action: () => toggleDockTab(showCodeEditor, dockTab, 'logs'),
    toggled: () => showCodeEditor.value && dockTab.value === 'logs',
  },
```

4. After the `isActive` lines (422–424), add:

```ts
// === Engine logs ===

// Owned here, not by the Logs tab, so that the tab's badge counts while it is hidden.
const engineLogs = useEngineLogStream({
  project: () => assetId.value,
  active: isActive,
});
watchEffect(() => {
  if (
    showCodeEditor.value &&
    dockTab.value === "logs" &&
    engineLogs.state.unseenErrors > 0
  ) {
    engineLogs.markSeen();
  }
});
```

5. In `contextMenuActions`, after `'graph.toggleCodeEditor',`, add
   `'graph.toggleLogs',`.

6. In the template, replace the `BottomPanel` element (lines 847–849) with:

```vue
<BottomPanel
  v-model:show="showCodeEditor"
  v-model:tab="dockTab"
  :logsBadge="engineLogs.state.unseenErrors"
  class="bottomPanel"
>
        <template #code><CodeEditor /></template>
        <template #logs><EngineLogPanel :stream="engineLogs" :projectId="assetId" /></template>
      </BottomPanel>
```

- [ ] **Step 6: Run the tests to see them pass**

Run:

```bash
corepack pnpm --filter enso-common run compile
cd app/gui
corepack pnpm exec vitest run src/project-view/components src/configurations src/dashboard/layouts/Settings
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
find . -name '.eslintcache' -not -path '*/node_modules/*' -delete
corepack pnpm run typecheck && corepack pnpm run lint
```

Expected: PASS. That includes `KeyboardShortcutsSettingsSection.test.ts` and the
registry's `has no conflicts among the defaults` and
`names every action, and every category` tests. Typecheck and lint print no
errors.

- [ ] **Step 7: Commit**

```bash
git add app/gui/src app/common/src/text/english.json app/common/src/text.ts
git commit -m "Engine logs: Code | Logs tabs in the bottom dock, and Mod+L for the logs"
```

---

### Task 8: Playwright, changelog, docs, Linux verification, screenshots, PR B

**Files:**

- Modify: `app/gui/integration-test/mock/localApi.ts`:
  - `INITIAL_CALLS_OBJECT` (line 73)
  - the state in `mockLocalApi` (after line 135)
  - a new route next to `/api/run-project-manager-command?*` (line 952)
  - the `api` object (lines 1124–1146)
- Create: `app/gui/integration-test/project-view/engineLogs.spec.ts`
- Modify: `CHANGELOG.md`, `app/gui/CLAUDE.md`,
  `app/gui/integration-test/CLAUDE.md`,
  `app/gui/src/project-view/components/EngineLogs/CLAUDE.md`

**Interfaces:**

- Consumes: the wire format (Task 2). The mock writes it by hand, so the spec
  imports nothing from `src/` (`tsconfig.node.json` stays as it is). It also
  consumes the UI from Tasks 6–7: the `role="tab"` names "Code" / "Logs …", the
  `bottomDock` test id, `role="log"`, the combobox "Level", `logs-badge`, and
  `ControlOrMeta+L`.
- Produces (mock API):
  `addEngineLogEvent(event: 'line' | 'session' | 'waiting', data?: Record<string, unknown>)`,
  `addEngineLogLine(text: string, source?: 'file' | 'stderr')`, and tracked
  calls `engineLogStreams: { project, channel, after }[]`.

- [ ] **Step 1: Write the failing spec**

`app/gui/integration-test/project-view/engineLogs.spec.ts`:

```ts
/** @file The bottom dock's Logs tab: the open project's engine log, live (engine logs panel). */
import { expect, test } from "integration-test/base";

const INFO =
  "[INFO] [2026-10-20T10:00:00.000Z] [org.enso.languageserver] Language server started";
const ERROR =
  "[ERROR] [2026-10-20T10:00:01.000Z] [org.enso.interpreter] Something failed";
const STDERR = 'Exception in thread "main" java.lang.IllegalStateException';

test.use({
  setupApi: {
    local: (api) => {
      api.addEngineLogEvent("waiting");
      api.addEngineLogEvent("session", {
        sessionId: "mock-session",
        logFile: "/logs/enso-language-server-2026-10-20-10-00-00.log",
      });
      api.addEngineLogLine(INFO);
      api.addEngineLogLine(ERROR);
      api.addEngineLogLine(STDERR, "stderr");
    },
  },
});

test("the Logs tab follows the engine log and filters by level", async ({
  editorPage,
  localApi,
}) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press("ControlOrMeta+L");
    const dock = page.getByTestId("bottomDock");
    await expect(dock.getByRole("tab", { name: /Logs/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const log = dock.getByRole("log");
    await expect(log.getByText("Language server started")).toBeVisible();
    await expect(log.getByText("Something failed")).toBeVisible();
    await expect(log.getByText(STDERR)).toBeVisible();

    // A line written later arrives without reopening anything.
    localApi.addEngineLogLine(
      "[INFO] [2026-10-20T10:00:02.000Z] [org.enso.languageserver] A later line",
    );
    await expect(log.getByText("A later line")).toBeVisible();

    await dock.getByRole("combobox", { name: "Level" }).selectOption("error");
    await expect(log.getByText("Something failed")).toBeVisible();
    await expect(log.getByText(STDERR)).toBeVisible();
    await expect(log.getByText("Language server started")).toBeHidden();

    // The shortcut closes the dock again while Logs shows.
    await page.keyboard.press("ControlOrMeta+L");
    await expect(dock).toBeHidden();
  });
});

test("the Logs tab counts unseen errors while the Code tab shows", async ({
  editorPage,
}) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press("ControlOrMeta+`");
    const dock = page.getByTestId("bottomDock");
    await expect(dock.getByRole("tab", { name: "Code" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const logsTab = dock.getByRole("tab", { name: /Logs/ });
    // The ERROR entry and the stderr line.
    await expect(logsTab.getByTestId("logs-badge")).toHaveText("2");
    await logsTab.click();
    await expect(logsTab.getByTestId("logs-badge")).toBeHidden();
  });
});
```

Run:

```bash
corepack pnpm -r --if-present run compile
cd app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/engineLogs.spec.ts
```

Expected: FAIL in the fixture with
`TypeError: api.addEngineLogEvent is not a function` (Playwright transpiles
without type-checking; `corepack pnpm run typecheck` would report
`Property 'addEngineLogEvent' does not exist on type 'MockLocalApi'`).

- [ ] **Step 2: Mock the stream**

In `app/gui/integration-test/mock/localApi.ts`, add to `INITIAL_CALLS_OBJECT`:

```ts
  engineLogStreams: array<{ project: string | null; channel: string | null; after: string | null }>(),
```

After `const projectSessions: …` in `mockLocalApi`, add:

```ts
/**
 * The engine log the mock stream (`GET /api/engine-logs/stream`) serves, numbered from 1. With
 * no events the stream says the project is not open, so specs that do not use it make one
 * request and stop.
 */
const engineLog = {
  channel: "mock-engine-log",
  events: [] as { seq: number; event: string; data: Record<string, unknown> }[],
};
```

Next to the `/api/run-project-manager-command?*` route, add:

```ts
await page.route("/api/engine-logs/stream?*", async (route, request) => {
  const url = new URL(request.url());
  const channel = url.searchParams.get("channel");
  const after = url.searchParams.get("after");
  called("engineLogStreams", {
    project: url.searchParams.get("project"),
    channel,
    after,
  });
  const sse = (event: string, data: unknown) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (engineLog.events.length === 0) {
    return route.fulfill({
      contentType: "text/event-stream",
      body: sse("end", { reason: "not-open" }),
    });
  }
  const from =
    channel === engineLog.channel && after != null ? Number(after) : 0;
  const session = [...engineLog.events]
    .reverse()
    .find((e) => e.event === "session");
  const hello = {
    channel: engineLog.channel,
    oldestSeq: 1,
    nextSeq: engineLog.events.length + 1,
    sessionId: session?.data["sessionId"] ?? null,
    logFile: session?.data["logFile"] ?? null,
  };
  // A fulfilled route closes the stream: the client reconnects with `after` and gets what was
  // added since, which is how a spec's later lines arrive.
  const body =
    sse("hello", hello) +
    engineLog.events
      .filter((e) => e.seq > from)
      .map((e) => sse(e.event, { seq: e.seq, ...e.data }))
      .join("");
  return route.fulfill({ contentType: "text/event-stream", body });
});
```

After `addProjectSession`, add:

```ts
/** Add an event to the mock engine log stream. */
function addEngineLogEvent(
  event: "line" | "session" | "waiting",
  data: Record<string, unknown> = {},
) {
  engineLog.events.push({ seq: engineLog.events.length + 1, event, data });
}

/** Add a line to the mock engine log stream. */
function addEngineLogLine(text: string, source: "file" | "stderr" = "file") {
  addEngineLogEvent("line", { source, sessionId: "mock-session", text });
}
```

In the `api` object, after `addProjectSession,`, add `addEngineLogEvent,` and
`addEngineLogLine,`.

- [ ] **Step 3: Run the spec to see it pass**

Run (Windows first; the screenshot comparisons this touches are Linux-only):

```bash
cd app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/engineLogs.spec.ts integration-test/project-view/projectSessions.spec.ts integration-test/project-view/rebindingShortcuts.spec.ts
```

Expected: PASS (2 + 1 + the rebinding tests).

- [ ] **Step 4: Changelog and docs**

1. Open PR B as a draft first, to get its number `<N>`:

```bash
git push -u origin feature/engine-logs-panel
gh pr create --draft --base feature/engine-logs-shim --head feature/engine-logs-panel \
  --title "Engine logs, PR 2: the Logs tab" --body "Draft; description to follow."
```

2. In `CHANGELOG.md`, under `# Next Release` → `#### Enso IDE`, after the
   `[272]` entry, add:

```markdown
- [Engine logs in the project view: a Logs tab next to the code editor follows
  the engine's log as it is written, flags errors, and scrolls back through
  earlier lines and sessions.][<N>]
```

Add `[<N>]: https://github.com/jdunkerley/enso/pull/<N>` to the link
definitions, in numeric order.

3. In `app/gui/CLAUDE.md`, after the `## Keyboard shortcuts` section, add:

```markdown
## Engine logs (the bottom dock's Logs tab)

The bottom dock (`project-view/components/BottomPanel.vue`) has Code and Logs
tabs (`BottomPanel/`; the tab is saved under `bottom-dock-tab`).
`Mod+\`` toggles the dock on its last tab; `graph.toggleLogs` (`Mod+L`) opens it on Logs or closes it. The Logs tab and its stream client are in `project-view/components/EngineLogs/`(see its`CLAUDE.md`); `GraphEditor.vue`
owns the stream so that the tab's error badge counts while it is hidden.
```

4. In `app/gui/integration-test/CLAUDE.md`, under `## Writing tests`, add:

```markdown
- The engine log stream (`GET /api/engine-logs/stream`) is mocked in
  `mock/localApi.ts`. With no events it answers `end` (`not-open`) and the
  client stops. A spec adds events with `addEngineLogEvent` / `addEngineLogLine`
  in `setupApi.local`; a fulfilled route closes the stream, so later events
  arrive as the client reconnects (about every 0.5 s).
```

5. Append to `app/gui/src/project-view/components/EngineLogs/CLAUDE.md`:

```markdown
- The dock's tabs are `@/components/BottomPanel/` (`dockTab.ts`,
  `BottomPanelTabs.vue`); `GraphEditor.vue` creates the stream and passes it to
  `EngineLogPanel`.
- Playwright: `integration-test/project-view/engineLogs.spec.ts`, against the
  mock stream in `mock/localApi.ts`.
```

Run:
`corepack pnpm exec prettier --check CHANGELOG.md app/gui/CLAUDE.md app/gui/integration-test/CLAUDE.md app/gui/src/project-view/components/EngineLogs/CLAUDE.md app/gui/integration-test`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 5: Commit**

```bash
git add app/gui/integration-test CHANGELOG.md app/gui/CLAUDE.md app/gui/src/project-view/components/EngineLogs/CLAUDE.md
git commit -m "Engine logs: Playwright spec against a mock stream, changelog and docs"
git push
```

- [ ] **Step 6: Verify on Linux, in a clone on the Linux filesystem**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e
  [ -d ~/enso-logs ] || git clone /mnt/c/Repos/Enso/ide ~/enso-logs
  cd ~/enso-logs && git fetch https://github.com/jdunkerley/enso feature/engine-logs-panel && git checkout -f FETCH_HEAD
  corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile
  corepack pnpm --filter enso-gui run generate-icons
  find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
  find . -name ".eslintcache" -not -path "*/node_modules/*" -delete
  corepack pnpm exec prettier --check app/gui/src app/gui/integration-test app/common/src CHANGELOG.md
  cd app/gui && corepack pnpm run typecheck && corepack pnpm run lint && corepack pnpm exec vitest run
  for i in 1 2 3; do corepack pnpm exec playwright test --project="Integration Tests" --workers=2 \
    integration-test/project-view/engineLogs.spec.ts integration-test/project-view/codeFont.spec.ts \
    integration-test/project-view/editorPanels.spec.ts integration-test/project-view/projectSessions.spec.ts; done'
```

Expected: everything passes, three runs out of three.

- **Prettier** must pass on Linux: `prettier-plugin-organize-imports` can
  corrupt a Vue SFC there and nowhere else (#19). Check the diff of every `.vue`
  file touched.
- **`codeFont.spec.ts`** compares screenshots of the code editor, which now sits
  28 px lower, under the tab strip. If `code-editor.png` or
  `code-editor-comments.png` differ, open the diff images. If the only change is
  the dock's tab strip or the editor's offset, regenerate them on Linux:

```bash
corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/codeFont.spec.ts --update-snapshots
```

Then commit the `*-linux.png` files and say why in the PR. Never commit
`*-win32.png`.

- **Any other failure:** run the same spec on `origin/develop` in the same clone
  before blaming this branch (memory `ci-failure-attribution`).

- [ ] **Step 7: Screenshots**

In `~/enso-logs`, write an uncommitted spec,
`app/gui/integration-test/project-view/zzScreens.spec.ts`:

```ts
import { test } from "integration-test/base";

test.use({
  setupApi: {
    local: (api) => {
      if (!("addEngineLogLine" in api)) return;
      api.addEngineLogEvent("waiting");
      api.addEngineLogEvent("session", {
        sessionId: "mock-session",
        logFile: "/logs/s.log",
      });
      api.addEngineLogLine(
        "[INFO] [2026-10-20T10:00:00.000Z] [org.enso.languageserver] Language server started",
      );
      api.addEngineLogLine(
        "[WARN] [2026-10-20T10:00:01.000Z] [org.enso.interpreter] Slow import of Standard.Table",
      );
      api.addEngineLogLine(
        "[ERROR] [2026-10-20T10:00:02.000Z] [org.enso.interpreter] Query failed: no such table",
      );
      api.addEngineLogLine("    at Standard.Database.Connection.read", "file");
      api.addEngineLogLine(
        'Exception in thread "main" java.lang.IllegalStateException',
        "stderr",
      );
    },
  },
});

test("screens", async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    const dir = process.env.SHOTS ?? "/tmp/shots";
    await page.keyboard.press("ControlOrMeta+`");
    const dock = page.getByTestId("bottomDock");
    await dock.waitFor();
    await page.waitForTimeout(500);
    await dock.screenshot({ path: `${dir}/dock-code.png` });
    const logs = dock.getByRole("tab", { name: /Logs/ });
    if ((await logs.count()) === 0) return;
    await logs.click();
    await dock.getByRole("log").getByText("Language server started").waitFor();
    await dock.screenshot({ path: `${dir}/dock-logs.png` });
    await dock.getByRole("combobox", { name: "Level" }).selectOption("error");
    await dock.screenshot({ path: `${dir}/dock-logs-errors.png` });
  });
});
```

`waitForTimeout` here only lets the dock's open animation finish for a still
image; it is never committed. The `'addEngineLogLine' in api` check lets the
same file run on `develop`, before the mock has it.

Run it on `develop` (before) and on the branch (after):

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && set -e && cd ~/enso-logs
  mkdir -p ~/shots/before ~/shots/after
  cp app/gui/integration-test/project-view/zzScreens.spec.ts /tmp/zzScreens.spec.ts
  git fetch https://github.com/jdunkerley/enso develop && git checkout -f FETCH_HEAD
  cp /tmp/zzScreens.spec.ts app/gui/integration-test/project-view/
  corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile
  cd app/gui && SHOTS=~/shots/before corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/zzScreens.spec.ts
  cd ~/enso-logs && rm app/gui/integration-test/project-view/zzScreens.spec.ts
  git fetch https://github.com/jdunkerley/enso feature/engine-logs-panel && git checkout -f FETCH_HEAD
  cp /tmp/zzScreens.spec.ts app/gui/integration-test/project-view/
  corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile
  cd app/gui && SHOTS=~/shots/after corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/zzScreens.spec.ts
  rm ~/enso-logs/app/gui/integration-test/project-view/zzScreens.spec.ts'
```

Publish the images on the orphan branch, never on the feature branch:

```bash
cd /c/Repos/Enso/ide && git fetch origin pr-screenshots
git worktree add /c/Repos/Enso/pr-shots origin/pr-screenshots --detach
mkdir -p /c/Repos/Enso/pr-shots/pr-<N>
cp //wsl.localhost/Ubuntu/home/$USER/shots/before/dock-code.png /c/Repos/Enso/pr-shots/pr-<N>/before-dock.png
cp //wsl.localhost/Ubuntu/home/$USER/shots/after/dock-code.png /c/Repos/Enso/pr-shots/pr-<N>/after-dock-code.png
cp //wsl.localhost/Ubuntu/home/$USER/shots/after/dock-logs.png /c/Repos/Enso/pr-shots/pr-<N>/after-dock-logs.png
cp //wsl.localhost/Ubuntu/home/$USER/shots/after/dock-logs-errors.png /c/Repos/Enso/pr-shots/pr-<N>/after-dock-logs-errors.png
cd /c/Repos/Enso/pr-shots && git add pr-<N> && git commit -m "Screenshots for #<N>" && git push origin HEAD:pr-screenshots
cd /c/Repos/Enso/ide && git worktree remove /c/Repos/Enso/pr-shots
```

(Use the WSL distribution's actual name and user in the `//wsl.localhost/…`
paths.)

- [ ] **Step 8: Write PR B's description and mark it ready**

The body (`gh pr edit <N> --body-file <scratchpad>/pr-b-body.md`) contains:

- **What it adds:** the dock tabs, the Logs tab, `Mod+L` and the badge.
- **Design:** links to the spec and to PR A.
- **Rulings:** the ones that change what users see: `Mod+L`, Mod+` keeping the
  last tab, history splicing.
- **Testing:** the vitest and Playwright commands, the Linux runs, and any
  regenerated `codeFont` baselines with the reason.
- **Screenshots:**
  `![before](https://raw.githubusercontent.com/jdunkerley/enso/pr-screenshots/pr-<N>/before-dock.png)`,
  `after-dock-code.png`, `after-dock-logs.png` and `after-dock-logs-errors.png`.
- **Merge gate:** the merge order (retarget to `develop` after PR A merges).
- The session's PR attribution.

```bash
gh pr ready <N>
```

Then hand both PRs to the user for their installer test (memory
`local-windows-installer-build`). Merge neither until they confirm:

1. Retarget PR B to `develop`.
2. Merge PR A, without `--delete-branch`.
3. Merge PR B.
4. Delete PR A's branch.

---

## Self-review against the spec

| Spec section / requirement                                                                                                                               | Task(s)                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Goal: Logs tab in the bottom dock, live + history incl. earlier sessions                                                                                 | 6, 7 (UI); 2–4 (source); 5 (client)                                                        |
| Decision: live tail **and** history                                                                                                                      | 2–5 (live), 5–6 (history, earlier sessions)                                                |
| Decision: tabs **Code \| Logs** in the existing dock                                                                                                     | 7                                                                                          |
| Decision: live source = session `.log` file **and** stderr                                                                                               | 1, 2 (file); 3 (stderr)                                                                    |
| Decision: level is a filter only, engine level unchanged                                                                                                 | 6 (`filterRows`, level select); no engine change anywhere                                  |
| Decision: SSE from the local server, Electron and dev build alike                                                                                        | 4                                                                                          |
| Tailer: offset reading, `fs.watch` + poll, partial lines                                                                                                 | 1                                                                                          |
| Tailer: roll-over (shrink or replace) → offset 0                                                                                                         | 1                                                                                          |
| Tailer: switch to the new session's file on respawn, `session` event                                                                                     | 2 (channel), 3 (respawn reaches the sink)                                                  |
| stderr piped, written through to `process.stderr`, `source: 'stderr'`; stdout inherited                                                                  | 3                                                                                          |
| Replay buffer: 5,000 per project, interleaved, monotonic `seq`                                                                                           | 2                                                                                          |
| Endpoint: buffered `seq > after` (all without), then live                                                                                                | 2 (`subscribe`), 4 (handler)                                                               |
| Endpoint events `line`, `session`, `waiting`, heartbeat every 15 s                                                                                       | 2, 4 (+ `hello`, `end`: Ruling 4)                                                          |
| Stream ends when the project closes                                                                                                                      | 2 (`close` → `end`), 3 (`projectClosed`, `closeProject`), 4                                |
| Under `/api/`, #274 checks apply                                                                                                                         | 4 (route after `acceptLocalRequest`; tests in `localRequest.test.ts` and `server.test.ts`) |
| Both hosts: Electron `Server.process` and the Vite middleware                                                                                            | 4                                                                                          |
| History reuses the session-log commands; no new history API                                                                                              | 5 (`fetchSessionLines`), 6                                                                 |
| Tailing from open to close regardless of listeners                                                                                                       | 3 (channel opened in `openProject` before the engine)                                      |
| Dock tabs, persisted tab, height/resize/fullscreen for both                                                                                              | 7                                                                                          |
| `Mod+\`` toggles the dock as now; `graph.toggleLogs` (rebindable) opens on Logs or closes                                                                | 7 (Rulings 1, 7)                                                                           |
| Logs tab reuses `projectLogData.ts` parsing                                                                                                              | 5 (`parseEntry`, `LOG_LEVELS`); presentation: Ruling 9                                     |
| Follow tail unless scrolled up; "Jump to latest"                                                                                                         | 6                                                                                          |
| stderr in error style with a `stderr` marker                                                                                                             | 6                                                                                          |
| Restart divider "Engine restarted (new session)"                                                                                                         | 5, 6 (Ruling 6)                                                                            |
| Toolbar: level filter, text filter, session picker, Show in folder                                                                                       | 6                                                                                          |
| Scroll to top loads older lines of the current session                                                                                                   | 5 (`prependHistory`), 6 (Ruling 11)                                                        |
| Earlier session read-only, no live tail                                                                                                                  | 6                                                                                          |
| Badge: ERROR + stderr count while Logs is not visible                                                                                                    | 5 (count), 7 (badge, `markSeen`), 8 (e2e)                                                  |
| Client: `EventSource`, backoff, `after`, skipped divider                                                                                                 | 5                                                                                          |
| Error: "Waiting for the engine…" driven by `waiting`                                                                                                     | 2, 6                                                                                       |
| Error: crash → red stderr, divider, follows new session, old one in picker                                                                               | 2, 3, 5, 6                                                                                 |
| Error: dropped stream → reconnect with backoff from last `seq`                                                                                           | 5                                                                                          |
| Error: batching per frame, virtualised table, 20,000 cap                                                                                                 | 5, 6                                                                                       |
| Error: project close → server ends, no client reconnect                                                                                                  | 2, 4, 5                                                                                    |
| Secrets: lines shown as written; same-origin only                                                                                                        | 4 (no transformation; #274)                                                                |
| Testing: shim unit tests (tail, partial, roll-over, session switch, buffer/`after`, stderr, SSE framing/heartbeat, #274)                                 | 1–4                                                                                        |
| Testing: GUI unit tests (tabs + persistence, action + shortcut, live append, follow/pause, filters, badge, history on scroll-up, reconnect with `after`) | 5–7                                                                                        |
| Testing: Playwright with a scripted SSE mock; open Logs, lines arrive, level filter                                                                      | 8                                                                                          |
| Testing: Linux verification of GUI checks                                                                                                                | 4 (shim), 8 (GUI)                                                                          |
| Testing: before/after screenshots of the dock on the PR                                                                                                  | 8                                                                                          |
| Out of scope: no level change, no other logs, no dashboard viewer changes                                                                                | Respected. `projectLogData.ts` gains an export only ("sharing code")                       |
| Delivery: changelog under Enso IDE; waits for the user's test                                                                                            | 8; merge gate in Global Constraints                                                        |

**Spec references corrected against the code:**

- `ProjectLog.vue` is at `app/gui/src/components/ProjectLog.vue`, not in
  `components/ProjectLog/`.
- `getProjectSessionLogs` pages oldest first (`archive:N` → `active` → `done`),
  which is why history is read whole (Ruling 11).

**Placeholder scan:** none, apart from the PR number `<N>` and the Vite port,
which are only known at run time, with the exact step that produces each.

**Type consistency:** the names in each Interfaces block are the ones the code
uses:

- `EngineLogSink` / `engineStarted` / `engineStderr` / `projectClosed`
- `EngineLogHub.open` / `get`
- `EngineLogChannel.subscribe` → `{ hello, replay, closed, unsubscribe }`
- `engineLogStreamUrl`
- `EngineLogModel.onHello` / `onLine` / `onWaiting` / `onSession` / `onEnd` /
  `commit` / `prependHistory` / `sessionStartHeld`
- `useEngineLogStream` → `{ rows, state, markSeen, loadHistory }`
- `DockTab`, `toggleDockTab`, `graph.toggleLogs`

## Rulings

1. **Ruling:** `graph.toggleLogs` defaults to `Mod+L`, not `Mod+Shift+\``.
   - **Why:** the graph's shortcuts match on `event.key`, and with Shift held
     the backquote key reports `~` (US) or `¬` (UK), so the spec's binding never
     fires. `Mod+L` is free in the `graph` and `app` scopes. The drive's Label
     shares it, but in the `drive` scope, which never overlaps the graph. No
     Electron menu accelerator or project CodeMirror keymap uses it.
   - **Cost if wrong:** one binding string and two test lines, and users can
     rebind it anyway.
2. **Ruling:** the stream's `project` parameter is the GUI's local project id
   (`project-<encoded path>`), and channels are keyed by the resolved directory.
   - **Why:** the project view already holds that id (`useCurrentProject().id`);
     the runner keys projects by path; `project.json` UUIDs can clash across
     folders.
   - **Cost if wrong:** a small change in `projectPathOf` and the GUI's URL.
3. **Ruling:** `line.sessionId` is `null` for stderr that arrives before the
   session's file exists. Session ids use the `listProjectSessions` format
   (`localprojectsession-<key>/<base>`).
   - **Why:** the session is only known once logback creates its file, and a
     shared format lets the picker tell "this session" from earlier ones.
   - **Cost if wrong:** small, since the client never relies on a line's
     `sessionId`.
4. **Ruling:** two events beyond the spec's list:
   - `hello` (`channel`, `oldestSeq`, `nextSeq`, `sessionId`, `logFile`) starts
     every connection;
   - `end` (`closed` or `not-open`) ends the stream.

   And `after` applies only together with a matching `channel`.
   - **Why:** sequence numbers restart when a project is reopened or the shim
     restarts, so a bare `after` would silently skip everything. `oldestSeq`
     makes the skipped divider exact. `EventSource` cannot tell a deliberate end
     from a dropped connection. `logFile` in `hello` keeps "Show in folder"
     working after the buffer has dropped the `session` event.
   - **Cost if wrong:** two event types, and a query parameter, to remove.

5. **Ruling:** `session` and `waiting` take sequence numbers and count towards
   the 5,000-event buffer.
   - **Why:** replay then reproduces the dividers and waiting state, and the
     numbers stay contiguous for gap detection.
   - **Cost if wrong:** a few buffer slots per restart.
6. **Ruling:** the "Engine restarted (new session)" divider goes at the new
   engine's `waiting` event, not at its `session` event.
   - **Why:** the new engine's own start-up stderr arrives between the two and
     belongs after the divider. The spec's order ("stderr in red, then the
     divider") holds for the crash output.
   - **Cost if wrong:** move one `addDivider` call to `onSession` and adjust one
     test.
7. **Ruling:**
   `Mod+\`` keeps toggling the dock and shows the last selected, persisted tab. Only `graph.toggleLogs`
   switches tab: it opens on Logs, or closes the dock while Logs shows.
   - **Why:** the spec says "toggles the dock as now", and this is where the
     persisted tab matters.
   - **Cost if wrong:** make `graph.toggleCodeEditor` call
     `toggleDockTab(…, 'code')`, a one-line change.
8. **Ruling:** the selected tab is saved under its own local-storage key,
   `bottom-dock-tab`, not inside `code-editor-size`.
   - **Why:** the height entry keeps the shape it has always had.
   - **Cost if wrong:** trivial.
9. **Ruling:** the Logs tab renders its own virtualised list (`EngineLogList`)
   instead of `ProjectLogTable` (AG Grid). It reuses `parseEntry` and
   `LOG_LEVELS` from `projectLogData.ts`.
   - **Why:** follow-the-tail, divider rows, stderr rows and keeping place on
     prepend are awkward in AG Grid. The table's set filter is an Enterprise
     feature, which unlicensed builds replace. Raw lines, one per row, keep
     stack traces readable.
   - **Cost if wrong:** swap the list for the table, which the model's `LogRow`s
     could feed.
10. **Ruling:** stderr lines count as ERROR, for both the level filter and the
    badge. A file line that starts no entry takes the previous entry's level
    (INFO before any). The badge counts ERROR _entries_, not their continuation
    lines.
    - **Why:** the spec counts stderr with errors, and a stack trace must stay
      with its entry under a filter.
    - **Cost if wrong:** one classifier rule.
11. **Ruling:** scrolling up at the top reads the current session whole through
    the existing paginated query, then inserts the part older than the first
    live file line above it.
    - The insertion point is the first 3 live file lines, matched in the
      history.
    - Without a match, everything goes above.
    - What fits under the 20,000-row cap is kept, under a "truncated" divider
      pointing at "Show in folder".
    - **Why:** the query pages oldest first, has no "lines before X", and the
      spec rules out a new history API.
    - **Cost if wrong:** duplicate lines where matching fails, and reading a
      large session in full once.
12. **Ruling:** an earlier session shows its newest 20,000 lines, under a
    "truncated" divider.
    - **Why:** the same cap as the live view, and the end of a session (where it
      failed) is what is usually wanted.
    - **Cost if wrong:** add paging upwards.
13. **Ruling:** the GUI keeps a stream open only while its project tab is
    active, and catches up with `after` when the tab becomes active again.
    - **Why:** the app's server speaks HTTP/1.1, so a window has six connections
      per origin. One long-lived stream per background project tab would starve
      other `/api/` calls.
    - **Cost if wrong:** after more than 5,000 events in the background, the
      skipped divider appears.
14. **Ruling:** lines the engine appends to the old file between the tailer's
    last read and a roll-over are not streamed live.
    - **Why:** the renamed file's name is known only by racing logback's
      compression. The lines are in the archive, and so in the panel's history.
    - **Cost if wrong:** rare missing live lines; a fix would read the newest
      archive on roll-over.
15. **Ruling:** "Show in folder" reveals the current session's log file, whose
    folder holds every session. It is shown only in Electron
    (`window.api.system`) and once the file is known.
    - **Why:** an earlier session's path is not in `listProjectSessions`.
    - **Cost if wrong:** pass the folder instead.
