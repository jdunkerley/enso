# mcp-eval

The MCP effectiveness suite: Claude Code, in headless mode, does seven tasks
through the packaged IDE's MCP server, and each result is checked objectively.
It measures how well a real agent does real work with the IDE's tools, and
compares that across IDE changes (a tool description, a guide, a new tool) and
models. Spec:
`docs/superpowers/specs/2026-11-18-mcp-effectiveness-suite-design.md` (decisions
by the owner, 2026-11-18, at its end). Ticket #865.

**On demand only.** No workflow calls it, `run.ts` refuses to start when `CI` is
set, and it costs nothing until someone runs it with `--budget-usd`. It is
signal, not a gate: nothing is retried, and one run of one task is not evidence
(an agent is not deterministic; compare pass counts over `--repeat 3` or more,
same model).

## Running it

```
corepack pnpm --filter enso run mcp-eval -- --budget-usd 10 [--tasks csv-pipeline,join] [--repeat 3] [--model sonnet] [--effort high] [--out <dir>] [--exe <path>] [--baseline <run dir>] [--keep-temp] [--aot] [--max-turns 60] [--timeout-minutes 15] [--task-budget-usd <n>]
corepack pnpm --filter enso run mcp-eval -- --self-check [--tasks ...]
corepack pnpm --filter enso run mcp-eval -- --dry-run
```

- It needs a packaged IDE: `dist/ide/` from `ide-local`, or `--exe <path>` (an
  installed build must be new enough to know `ENSO_TEST_USER_DATA_DIR`; the
  runner checks the IDE's `userData` before it does anything and refuses
  otherwise).
- A real run needs `ANTHROPIC_API_KEY` in the environment: the agent runs with
  `claude --bare`, which reads no login, and `total_cost_usd` is then the real
  cost. `--budget-usd` is required (no default); a task starts only if what is
  spent plus its own budget (`--task-budget-usd`, else the run budget divided by
  the number of task runs, at most 3 USD) fits.
- `--dry-run` prints the exact `claude` command line of each task and spends
  nothing; `--self-check` runs every task with no agent (below).
- Results go to `--out` (default `~/enso-mcp-eval/`, outside the repository,
  never committed): `<timestamp>-<commit or WIP>/run.json`, `report.md`, a
  folder per task run (`transcript.jsonl`, `checks.json`, the final `Main.enso`,
  `graph.png`, the IDE's and engine's logs), and `history.csv`, one row per task
  run, appended. `--baseline <run dir>` adds that run's figures under each task
  in the report.
- Every task runs in `os.tmpdir()/enso-mcp-eval/<run>/<task>-<n>/`, outside any
  git working tree (Note [Harness Projects Are Outside Any Repository] in
  `perf/openTime.ts`), deleted afterwards (`--keep-temp` keeps it). A run first
  removes roots older than a day, left by a killed run.

## How a task runs

1. A new root with `projects/`, `user-data/`, `agent-cwd/` (empty) and
   `engine-logs/`.
2. The IDE (`ide.ts`) starts with the credential-free environment plus
   `ENSO_TEST=true`, `ENSO_TEST_PROJECTS_DIR` (the Drive's root, so the app
   tools confine the agent to it), **`ENSO_TEST_USER_DATA_DIR`** (its own
   profile: never the user's `mcp-settings.json`, Recent, labels or logs, and
   the single-instance lock is per user-data directory, so it runs beside the
   user's own IDE), `ENSO_MCP_ENABLED/PORT/TOKEN` (a free port, a random token),
   `ENSO_SPARE_ENGINE=0` and `ENSO_JVM_AOT=0` (`--aot` keeps a cache in the
   run's folder). Electron's `--user-data-dir` does **not** work here: the app's
   own argument parser refuses it as an unknown option (checked), so
   `src/testUserData.ts` reads the variable in `index.ts` before the logger.
3. The project is created by the bundled launcher (`enso --new`), so
   `package.yaml` is the current edition's, then the task's `project/` files are
   copied over it. The runner's own MCP client opens it and waits until every
   node has a value and the component catalogue has loaded (`get_problems` says
   `pending: 0` before the first execution, so it cannot be the signal).
4. `agent.ts` runs `claude -p` with `--bare`, only the IDE's server
   (`--strict-mcp-config`, `--tools ""`, `--allowedTools mcp__enso`, `dontAsk`),
   `--max-budget-usd`, `--output-format stream-json --verbose`, an empty working
   directory and an environment of `PATH`, home and temp variables, the key and
   `MCP_TOOL_TIMEOUT`. It counts turns (one per model response, by message id)
   from the stream and kills the process tree at `--max-turns` (`turn-cap`) or
   `--timeout-minutes` (`timeout`); the CLI has no turn limit of its own.
5. The checks run through the same MCP client (reading tools, plus `open_method`
   to look at a function's documentation), after `Main.enso` has stopped
   changing on disk (the IDE saves an edit seconds after it answers). Then
   evidence is saved and the IDE is quit.

Write is never on: the IDE stays in Design, the runner never switches Live or
Write on, and the common checks fail a task loudly if a file was written anyway.

## The tasks

`tasks/<id>/task.ts` (prompt, checks), `project/` (`src/Main.enso`, `data/`),
`solution/src/Main.enso`. Prompts name the final node but never the components
to use. Data is synthetic and deterministic (`tasks/data.ts`, seeded); the
expected values are constants in each `task.ts` that
`tests/headless/mcpEvalTasks.test.ts` recomputes from the data without an
engine, and the engine confirms them in `--self-check`.

| Id             | Starting project                                  | Judged by                                                                         |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `csv-pipeline` | no nodes; `data/sales.csv` (500 rows)             | `result`: 6 products in order, a column of the expected totals                    |
| `fix-error`    | 6 nodes, the 4th misnames a column                | no error, all nodes kept, `result` is the reference table                         |
| `document`     | working pipeline, `Main.clean_names` undocumented | docs for `main` and `clean_names` (names `text`, Examples, fence), no code change |
| `layout`       | 12 nodes stored on top of each other              | no area overlap, every node below its inputs, code unchanged                      |
| `visualize`    | node `monthly`                                    | Scatter Plot shown, at least 400 wide, value unchanged                            |
| `join`         | `customers.csv`, `orders.csv`                     | 4 rows, each region's total (a region with no orders is 0 or Nothing)             |
| `refactor`     | 4 cleaning nodes then 3 summary nodes             | function `clean`, a call node with a comment, 3 fewer nodes, same `result`        |

Columns are found by their values, never by the agent's names
(`checkHelpers.ts`). Every task also has the common checks (`task.ts`): the run
ended by itself, no file but `src/Main.enso` and `images/` changed (hashes taken
once the project is open; `.enso/` and `.git/` are skipped), and no
`*_ensodryrun*` file in the project or the agent's directory. A task passes when
every check does. None is judged by a model.

A check marked `discriminating` must fail on the untouched project.

## Self-check

`--self-check` needs no key and spends nothing: for each task it opens the
untouched fixture (the discriminating checks must fail), then a copy with the
reference solution over it (every check must pass). Run it after a standard
library or MCP change and before trusting a red task. **Changing a fixture:**
edit `tasks/sources.ts` (the Enso), `tasks/data.ts` (the data) or
`tasks/generateFixtures.ts`, then
`corepack pnpm --filter enso exec vite-node mcp-eval/tasks/writeFixtures.ts`;
the unit test fails when a committed file differs from the generator. The
`METADATA` trailers (node ids, stored positions, a shown visualization) are
generated by `tasks/metadata.ts`; stored `y` is up, the scene's is down.

## Files

`run.ts` (command line, loop, self-check, dry run), `options.ts` (flags, budget
rules), `ide.ts` (temporary roots, launching the IDE, the MCP client, opening a
project), `agent.ts` (the `claude` command, its environment, the stream reader
loop), `stream.ts` (turn, tool call and refusal counting, the final result),
`checkHelpers.ts` (pure check parts), `task.ts` (types and the common checks),
`report.ts` (`run.json`, `report.md`, `history.csv`), `tasks/`. Unit tests:
`tests/headless/mcpEval*.test.ts` (the recorded stream there is written by hand
from Claude Code 2.1.325's documented format; no agent run was made to record
one). A second agent would be a sibling of `agent.ts`.
