# MCP effectiveness suite: an on-demand script driving Claude Code

Status: draft for the owner's review (2026-11-18). Ticket #865; decided in
discussion #853 (2026-11-17).

## Goal

Measure how well a real agent does real work through the IDE's MCP server, and
compare that across IDE changes (a tool description, a guide, a new tool) and
across models. One command runs 7 tasks against the packaged IDE, each driven by
Claude Code in headless mode, checks each result objectively, and writes a
report that the next run can be compared with.

It is **on demand only**: not in CI, no workflow calls it, and it costs nothing
until someone runs it. It is signal, not a gate: no retries hide a failure, and
one run of one task is not evidence (see "Scoring").

## Where we are

- The MCP server (`app/electron-client/src/mcp/`, its `CLAUDE.md`) has 33 tools,
  the guides under `src/mcp/guides/`, and is turned on and configured by
  `ENSO_MCP_ENABLED`, `ENSO_MCP_PORT` and `ENSO_MCP_TOKEN`, which win over
  `<userData>/mcp-settings.json` and never write it.
- `tests/mcp.spec.ts` already drives the packaged app with an SDK client
  (`@modelcontextprotocol/sdk`): it proves the tools work, not that an agent can
  use them.
- `perf/openTime.ts` is the model for a harness that is not a Playwright Test
  run: it launches the packaged IDE through `playwright`'s `_electron`, creates
  projects with the bundled launcher (`enso --new`) in a temporary directory
  outside any git tree, starts every child without credentials
  (`credentialFreeEnv`), and writes a JSON and Markdown report to `--out`.
- **What "effectiveness suite ported" meant.** The 2026-11-15 AI chat and MCP
  spec's step 6 was to port `app/electron-client/tests/aiChallenges.spec.ts`
  (removed with the in-app AI in #841, `ce1d12252c`) to drive the chat. That
  spec drove the Component Browser's AI prompt through four challenges (two
  Preppin' Data weeks, Colorado COVID, FX rates) on inputs downloaded by hand
  (`ENSO_TEST_AI_CHALLENGES_DIR`), asserted data-driven invariants (row counts,
  sentinel values) rather than agent-chosen names, and appended one CSV row per
  run (`aiMetrics.ts`: commit, parameters, status, tokens, durations). The chat
  was dropped, so there is nothing to port it to; this suite keeps its good
  ideas (invariant checks, no retries, one row per run for trends) and drops its
  downloaded inputs, its network fetch and its UI driving.

## Design

### Shape of a run

```
corepack pnpm --filter enso run mcp-eval -- --budget-usd 10 [--tasks csv-pipeline,join] [--repeat 3] [--model sonnet] [--out <dir>] [--exe <path>] [--baseline <run dir>]
corepack pnpm --filter enso run mcp-eval -- --self-check
```

For each task (and each repeat), in order, one at a time:

1. Make a fresh temporary root (`os.tmpdir()/enso-mcp-eval/<run>/<task>-<n>/`)
   with `projects/`, `user-data/` and `agent-cwd/` (empty). It is outside any
   git working tree, for the reason in Note [Harness Projects Are Outside Any
   Repository].
2. Create the task's project with the packaged app's launcher
   (`enso --new <name>` into `projects/`), then copy the fixture's
   `src/Main.enso` and `data/` over it, so `package.yaml` is always the current
   edition's.
3. Launch the packaged IDE (below), open the project with the runner's own SDK
   client (`open_project`, which answers once the project's tools answer), and
   wait for the graph to settle (`get_problems` until `pending` is 0).
4. Run Claude Code on the task's prompt (below) until it ends, hits the turn
   cap, the timeout or the task's budget.
5. Check the result with the runner's SDK client (reading tools only), save the
   evidence, quit the IDE and delete the temporary root (kept with
   `--keep-temp`).

One IDE per task: every task starts from the same state, a crash or hang in one
cannot spoil the next, and the launch (a few seconds plus the open) is small
next to an agent's minutes.

### Starting the IDE

- **The packaged app**, as `perf/openTime.ts` does: `dist/ide/` from `ide-local`
  by default (`tests/packagedIde.ts` locates it), or `--exe <path>` for an
  installed build. Not the dev build: it has no bundled engine, and what we
  measure is what users run.
- **Its own user data.** A new `ENSO_TEST_USER_DATA_DIR` environment variable,
  read in `index.ts` before `ready`, calls `app.setPath('userData', …)` (the one
  IDE change this suite needs; small, and useful to the Playwright fixture too).
  With it, the run never reads or writes the user's `mcp-settings.json`, Recent
  list, labels, added Drive folders or logs, and because Electron's
  single-instance lock is per user-data directory, the suite runs while the
  user's own IDE is open. (Whether Electron's `--user-data-dir` switch already
  does this is to be checked first; if it does, no IDE change is needed.)
- **MCP by environment**, as `tests/mcp.spec.ts` does: `ENSO_MCP_ENABLED=1`, a
  free port (asked of the OS, as `DummyRepository.freePort()` does) in
  `ENSO_MCP_PORT`, and a random token per run in `ENSO_MCP_TOKEN`. Nothing is
  read from a settings file, so there is nothing to scrape; the runner already
  knows the port and token it chose.
- **The rest of the environment** is the Playwright fixture's: `ENSO_TEST=true`,
  `ENSO_TEST_PROJECTS_DIR=<root>/projects` (the Drive's root, so the app tools'
  path rule confines the agent to it), `--no-welcome-project`,
  `ENSO_SPARE_ENGINE=0`, `ENSO_JVM_AOT=0` (an option, `--aot`, keeps a cache in
  the run's own directory for faster opens), `ENSO_TEST_DISABLE_GPU=1`, all on
  top of `credentialFreeEnv(process.env)`.

### Driving Claude Code

Checked against the installed CLI (`claude --version`: 2.1.325). One process per
task:

```
claude -p "<task prompt>"
  --bare
  --mcp-config <root>/mcp.json --strict-mcp-config
  --tools ""
  --allowedTools mcp__enso
  --permission-mode dontAsk --permission-prompts none
  --model <model> [--effort <level>]
  --max-budget-usd <task budget>
  --output-format stream-json --verbose
  --no-session-persistence
  --append-system-prompt "<preamble>"
```

- `mcp.json` is
  `{"mcpServers":{"enso":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`,
  written into the temporary root and deleted with it.
- **Only the IDE's tools.** `--tools ""` removes every built-in tool (no shell,
  no file reads or writes, no web), `--strict-mcp-config` ignores the user's own
  MCP servers, and `--allowedTools mcp__enso` pre-approves the server's tools;
  with `dontAsk` and no prompt target anything else is denied, never asked.
- **No user context.** `--bare` skips `CLAUDE.md` discovery, hooks, plugins,
  memory and the keychain, and the working directory is the empty `agent-cwd/`,
  so the agent knows only what the server's instructions, guides and tool
  descriptions tell it, which is what we are measuring. The catch: under
  `--bare` authentication is `ANTHROPIC_API_KEY` only (see Open questions). The
  child gets `PATH`, the home and temp variables, the key and
  `MCP_TOOL_TIMEOUT=130000` (an open can take 120 s), nothing else.
- **The preamble** says only: you work in the Enso IDE through its MCP tools,
  the project is open on screen, no one will answer questions, finish the task
  and end with one line saying what you did.
- **Model**: `--model` (default `sonnet`), recorded with the CLI version in the
  report. `--effort` is passed through when given.
- **Turns**: 2.1.325's `--help` has no turn limit, so the runner counts
  assistant messages on the stream and kills the process at the cap (default
  60), recording `turn-cap`. If a later CLI documents one, use it instead.
- **Time**: a wall-clock timeout per task (default 15 minutes), then the process
  tree is killed and the task recorded as `timeout`.
- **Cost**: `--max-budget-usd` per task (default the run budget divided by the
  task count, at most 3 USD), and the run stops starting tasks once the
  `total_cost_usd` already spent plus the next task's budget would pass
  `--budget-usd`, which is required (no default, so nothing spends by accident).

### The tasks

Seven, each a folder `mcp-eval/tasks/<id>/` with `task.ts` (prompt, checks,
budget), `project/` (`src/Main.enso`, `data/`) and `solution/src/Main.enso` (a
reference solution, see "Self-check"). Data is small, synthetic and
deterministic (the samples' house rule), so the expected values are fixed
constants in `task.ts`. Prompts state the goal and name the final node
(`result`) so the check can find it, but never name the components to use.

| Id             | Starting project                                                                      | Prompt (gist)                                                                                                                | Objective check                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `csv-pipeline` | Empty graph; `data/sales.csv` (500 rows: date, region, product, units, price)         | Read the CSV; for the North region in 2025, total revenue (units × price) per product, largest first, in a node `result`.    | `result` is a Table with 6 rows; the product column holds the 6 expected names in order; some numeric column equals the expected totals (±0.01). Columns found by values, not by the agent's names.        |
| `fix-error`    | A 6-node pipeline over `sales.csv` whose 4th node misnames a column and so errors     | One node is in error. Fix it so the pipeline gives the result it was meant to.                                               | `get_problems` reports no error or panic; node count is still 6 (fixed, not deleted); `result` equals the reference solution's value (row count and a checksum of a numeric column).                       |
| `document`     | A working pipeline and a function `Main.clean_names text` with no documentation       | Write documentation for the workflow and for `clean_names`, as the function documentation style asks.                        | `get_documentation` (top level, and after `open_method`) is non-empty, mentions `text`, has an `Examples`-style section where the style needs one; the code with documentation stripped is byte-identical. |
| `layout`       | 12 connected nodes stored at overlapping, shuffled positions                          | The graph is hard to read. Lay it out so it reads in data-flow order.                                                        | `get_graph { layout: true }`: no two node `area`s overlap; every node is below its inputs (y increases along every edge); the source without metadata is unchanged.                                        |
| `visualize`    | A node `monthly`: a 12-row table of month number and revenue                          | Show revenue against month as a chart on `monthly`, large enough to read (at least 400 wide).                                | `list_visualizations` on `monthly`: `shown` is `Scatter Plot`, `size.width` ≥ 400; `monthly`'s value unchanged.                                                                                            |
| `join`         | `data/customers.csv` (id, region, joined) and `data/orders.csv` (customer_id, amount) | For customers who joined in 2024, total order amount per region, every region listed even with no orders, in `result`.       | `result` has 4 rows (one with 0 or Nothing for the region without orders); each region's total equals the expected value (±0.01).                                                                          |
| `refactor`     | A pipeline whose first 4 nodes clean a table, followed by 3 that summarise it         | Group the cleaning steps into a function named `clean` called from the graph, and say what it does in a comment on the call. | The module has a function `clean`; a node calls it; the call node has a comment; `result`'s value equals the starting project's; node count dropped by at least 3.                                         |

These cover the tool families an agent needs: reading and searching
(`get_graph`, `search_components`, `get_component_docs`, `evaluate_expression`),
building (`add_nodes`, `edit_node`), problems (`get_problems`), documentation,
layout (`move_nodes` or `arrange_nodes`), visualizations (`list_visualizations`,
`set_visualization`) and structure (`collapse_nodes`, `set_node_comment`). The
checks read values through the engine via the runner's SDK client
(`evaluate_expression` on `result`, as text or JSON, and the read tools), so a
check judges what the graph computes, never how the agent described it. None is
judged by a model.

**Every task also has the common checks:** the run ended by itself (not a cap or
timeout); no file in the project changed or appeared except `src/Main.enso` and
`images/` (hashes taken before and after); no file under `data/` changed; and no
`*_ensodryrun*` file outside the system temporary directory.

### Self-check

`--self-check` runs every task with no agent: it copies `solution/` over the
fixture and runs the checks (all must pass), then runs them on the untouched
fixture (the task-specific ones must fail). It spends nothing and proves the
fixture, the expected values and the checks against the current engine; run it
after a standard-library change and before trusting a red task. The checks' pure
parts (finding a column by its values, the overlap test, the report) have unit
tests in `tests/headless/`, which CI runs as it runs every other unit test: no
agent and no key are involved.

### Scoring and the report

A task run is **pass** when every check passes, otherwise **fail**, with the
failed checks named. Each run also records:

- `turns` and `toolCalls` (total and per tool name), from the stream;
- `toolErrors`: tool results with `isError`;
- `refusals`: those errors that are the IDE's refusals, by their stable texts
  (Live mode, the Write rule, too late, another method, outside the Drive), the
  CLI's `permission_denials`, and a model `refusal` stop reason, each counted
  separately;
- `wallMs`, and the agent's `duration_ms`;
- tokens (input, output, cache read, cache creation) and `total_cost_usd`, from
  the final `result` message;
- `ended`: `done`, `turn-cap`, `timeout`, `budget`, or `error`.

Output, in `--out` (default `~/enso-mcp-eval/`, outside the repository):

- `<timestamp>-<commit or WIP>/run.json`: the run (IDE version and commit, CLI
  version, model, effort, the options) and every task run;
- `<…>/report.md`: per task the pass count over the repeats, and the medians of
  turns, tool calls, refusals, wall time and cost; then the run's total cost;
  with `--baseline <run dir>` a column of that run's figures beside each;
- `<…>/<task>-<n>/`: `transcript.jsonl` (the stream), `checks.json`, the final
  `Main.enso`, a `get_graph_image` picture (`graph.png`), and the IDE's logs;
- `history.csv` in `--out`: one row per task run (the old `aiMetrics.ts` idea),
  so a trend over weeks is one spreadsheet away.

**Reading it:** an agent is not deterministic, so one run of a task says little
either way (the repository's rule for timing-sensitive tests applies). Compare
pass rates over `--repeat 3` or more, same model, before concluding that a
change helped or hurt.

### Where the code lives

`app/electron-client/mcp-eval/`, next to `perf/`, because it shares that
package's packaged-app helpers (`tests/packagedIde.ts`, `credentialFreeEnv`),
its `playwright` and `@modelcontextprotocol/sdk` dependencies, and the launcher
location:

- `run.ts`: the command line and the loop (started with `vite-node`, as
  `perf:open` is);
- `ide.ts`: start the IDE with its temporary root, open the project, quit;
- `agent.ts`: write `mcp.json`, spawn `claude`, read the stream, enforce the
  caps;
- `checks.ts`: the shared check helpers and the common checks;
- `report.ts`: `run.json`, `report.md`, `history.csv`, the baseline comparison;
- `tasks/<id>/`: as above;
- a `CLAUDE.md` describing all of it.

`package.json` gets `"mcp-eval": "vite-node mcp-eval/run.ts"`. No workflow
references it, and `run.ts` refuses to start when `CI` is set.

### Safety

- **Write is never on.** The IDE runs in Design; nothing in the runner switches
  Live or Write on, and the IDE's own guard refuses code that enables output.
  The common checks catch a file written anyway and fail the task loudly (that
  would be a bug to file, not a score).
- **Never the user's projects or settings.** The Drive root is the run's
  temporary `projects/`, the user data is the run's own, and the agent has no
  file, shell or web tools, so the only paths it can reach are the IDE's, inside
  that Drive.
- **No credentials** reach the IDE (`credentialFreeEnv`) or the agent (only its
  own key).
- **No accidental spend.** `--budget-usd` is required, per-task budgets cap each
  run, and nothing runs in CI.
- **Cleanup.** Every temporary root is deleted at the end of its task, and on
  start the runner removes `enso-mcp-eval/` roots older than a day left by a
  killed run.

## Out of scope

- Other agents (Codex, Copilot). The runner's agent half is one module, so a
  second one can come later if wanted.
- Model-judged quality (prose of documentation, the beauty of a layout).
- Running in CI or on a schedule.
- Comparing models in one run: run twice with different `--model` and compare
  with `--baseline`.

## Order of work

One PR: the user-data override (or its confirmation), the harness, the seven
tasks with their solutions, `--self-check` green on Windows and Linux, unit
tests, and a first real run (one repeat, `sonnet`) whose `report.md` goes in the
PR description. Label `CI: No changelog needed` (nothing user-visible).

## Open questions for the owner

1. **Authentication: API key or your subscription?** `--bare` (no `CLAUDE.md`,
   memory, hooks or plugins from your machine: the cleanest measurement) uses
   `ANTHROPIC_API_KEY` only. Without `--bare`, the subscription login works but
   your user settings, memory and plugins leak into the agent's context unless
   each is turned off separately. **Recommendation:** `--bare` with an API key,
   read from the environment; `total_cost_usd` is then the real cost.
2. **Default model and repeats.** **Recommendation:** `sonnet`, one repeat by
   default (about 7 tasks × 1–3 USD), and `--repeat 3` when judging a change.
3. **Results folder.** **Recommendation:** `~/enso-mcp-eval/`, outside the
   repository; nothing committed. If you want history in git, a branch of its
   own (as `pr-screenshots`) rather than `develop`.
4. **The task list.** Seven as above. **Recommendation:** start with these, and
   add a task only with a fixture, a reference solution and a value check;
   prompts that need downloaded data (the old Preppin' Data challenges) stay
   out.
