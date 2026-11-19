/**
 * @file The MCP effectiveness suite: runs Claude Code on seven tasks against the packaged IDE and
 * scores each result (spec `docs/superpowers/specs/2026-11-18-mcp-effectiveness-suite-design.md`,
 * `mcp-eval/CLAUDE.md`). On demand only; it spends money, so `--budget-usd` is required.
 *
 * ```
 * corepack pnpm --filter enso run mcp-eval -- --budget-usd 10 [--tasks a,b] [--repeat 3] [--model sonnet]
 * corepack pnpm --filter enso run mcp-eval -- --self-check
 * corepack pnpm --filter enso run mcp-eval -- --dry-run
 * ```
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findBuiltElectronExecutable } from '../tests/ideLocator'
import {
  agentEnv,
  buildClaudeArgs,
  formatCommand,
  mcpConfig,
  runAgent,
  type AgentRequest,
} from './agent'
import { diffTrees, findDryRunFiles, forbiddenChanges, hashTree } from './checkHelpers'
import {
  copyTree,
  createProject,
  freePort,
  ideEnv,
  launchIde,
  makeTaskRoot,
  newToken,
  openAndSettle,
  removeStaleRoots,
  waitForFileToSettle,
  type Ide,
  type TaskRoot,
} from './ide'
import { mayStartTask, parseOptions, refuseInCi, taskBudgetUsd, type Options } from './options'
import {
  appendHistory,
  readBaseline,
  renderReport,
  runDirectoryName,
  type RunRecord,
  type TaskRunRecord,
} from './report'
import { commonChecks, type CheckContext, type CheckResult, type TaskDefinition } from './task'
import { TASK_IDS, TASKS } from './tasks'

/** The IDE's version, read from the first IDE a run starts. */
let ideVersionSeen = 'unknown'

const TASKS_DIR = path.join(import.meta.dirname, 'tasks')

const projectName = (task: TaskDefinition, suffix = '') =>
  `Eval_${task.id.replace(/-/g, '_')}${suffix}`

/** The fixture's folders to copy over a new project: its `project/`, then optionally its `solution/`. */
const fixtureDirs = (task: TaskDefinition, withSolution: boolean) => [
  path.join(TASKS_DIR, task.id, 'project'),
  ...(withSolution ? [path.join(TASKS_DIR, task.id, 'solution')] : []),
]

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: import.meta.dirname, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** The short commit, or `WIP` when the working tree has changes (or there is no git). */
function currentCommit(): string {
  const sha = git(['rev-parse', '--short', 'HEAD'])
  if (sha === '') return 'WIP'
  return git(['status', '--porcelain']) === '' ? sha : 'WIP'
}

function cliVersion(): string {
  try {
    return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** Runs every check of `task`, then the common ones. */
async function runChecks(
  task: TaskDefinition,
  context: CheckContext,
  facts: Parameters<typeof commonChecks>[0],
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const check of task.checks) {
    try {
      results.push(await check.run(context))
    } catch (e) {
      results.push({
        name: check.name,
        passed: false,
        detail: `the check itself failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
  return [...results, ...commonChecks(facts)]
}

/** Starts the IDE for `task` and opens its starting project; the caller closes it. */
async function startTask(
  options: Options,
  exe: string,
  task: TaskDefinition,
  root: TaskRoot,
  runName: string,
) {
  const port = await freePort()
  const token = newToken()
  const aotDir = options.aot ? path.join(options.out, runName, 'jvm-aot') : undefined
  const env = ideEnv(process.env, root, { port, token }, aotDir)
  const ide = await launchIde(exe, root, env, { port, token })
  return { ide, port, token }
}

/** Copies what the task's IDE logged into the evidence folder. */
function saveLogs(root: TaskRoot, evidence: string) {
  for (const [from, to] of [
    [path.join(root.userData, 'logs'), path.join(evidence, 'ide-logs')],
    [root.logs, path.join(evidence, 'engine-logs')],
  ] as const) {
    try {
      if (fs.existsSync(from)) copyTree(from, to)
    } catch {
      // A log still held open is not worth failing the run.
    }
  }
}

function removeRoot(root: TaskRoot, keep: boolean) {
  if (keep) {
    console.log(`Kept ${root.root}`)
    return
  }
  try {
    fs.rmSync(root.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (e) {
    console.warn(`Could not delete ${root.root}: ${String(e)}`)
  }
  try {
    // The run's folder, once its last task root is gone (`rmdir` refuses a folder with content).
    fs.rmdirSync(path.dirname(root.root))
  } catch {
    // Not empty: a kept root, or a task still running.
  }
}

/** One agent run of one task: set up, run, check, save the evidence, clean up. */
async function runTask(
  options: Options,
  exe: string,
  task: TaskDefinition,
  repeat: number,
  runName: string,
  budgetUsd: number,
): Promise<TaskRunRecord> {
  const dirName = `${task.id}-${repeat}`
  const evidence = path.join(options.out, runName, dirName)
  fs.mkdirSync(evidence, { recursive: true })
  const root = makeTaskRoot(runName, dirName)
  let ide: Ide | undefined
  const base = {
    task: task.id,
    repeat,
    dir: dirName,
    toolCallsByName: {},
    toolErrors: 0,
    refusals: {},
    wallMs: 0,
    agentDurationMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    costUsd: 0,
    turns: 0,
    toolCalls: 0,
  }
  try {
    const started = await startTask(options, exe, task, root, runName)
    ide = started.ide
    ideVersionSeen = ide.version
    const project = await createProject(exe, root, projectName(task), fixtureDirs(task, false))
    await openAndSettle(ide.call, project)
    const baseline = (await task.baseline?.(ide.call)) ?? {}
    const before = hashTree(project)
    const mcpPath = path.join(root.root, 'mcp.json')
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig(started.port, started.token)))
    const request: AgentRequest = {
      prompt: task.prompt,
      model: options.model,
      effort: options.effort,
      budgetUsd,
      mcpConfigPath: mcpPath,
      maxTurns: options.maxTurns,
      timeoutMs: options.timeoutMinutes * 60_000,
    }
    console.log(`  agent: ${task.id} #${repeat} ...`)
    const agent = await runAgent(request, {
      cwd: root.agentCwd,
      env: agentEnv(process.env),
      transcriptPath: path.join(evidence, 'transcript.jsonl'),
    })
    const mainFile = path.join(project, 'src', 'Main.enso')
    const mainSource = await waitForFileToSettle(mainFile)
    fs.writeFileSync(path.join(evidence, 'Main.enso'), mainSource)
    const forbidden = forbiddenChanges(diffTrees(before, hashTree(project)))
    const dryRunFiles = findDryRunFiles([project, root.agentCwd])
    const checks = await runChecks(
      task,
      { call: ide.call, mainSource, baseline },
      { ended: agent.ended, forbiddenFileChanges: forbidden, dryRunFiles },
    )
    fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(checks, null, 2))
    try {
      const png = await ide.image('get_graph_image')
      if (png != null) fs.writeFileSync(path.join(evidence, 'graph.png'), png)
    } catch {
      // A picture is evidence, not a check.
    }
    const summary = agent.summary
    return {
      ...base,
      status: checks.every((c) => c.passed) ? 'pass' : 'fail',
      checks,
      ended: agent.ended,
      turns: summary.turns,
      toolCalls: summary.toolCalls,
      toolCallsByName: summary.toolCallsByName,
      toolErrors: summary.toolErrors,
      refusals: summary.refusals,
      wallMs: agent.wallMs,
      agentDurationMs: summary.result?.durationMs ?? 0,
      tokens: summary.result?.tokens ?? base.tokens,
      // A run killed before its `result` message cost something we cannot read: count its cap.
      costUsd: summary.result?.totalCostUsd ?? budgetUsd,
      ...(agent.ended === 'error' ?
        { error: summary.result?.text || agent.stderrTail || 'the agent ended in error' }
      : {}),
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`  ${task.id} #${repeat} failed to run: ${error}`)
    return {
      ...base,
      status: 'fail',
      checks: [],
      ended: 'error',
      costUsd: 0,
      error,
    }
  } finally {
    await ide?.close()
    saveLogs(root, evidence)
    removeRoot(root, options.keepTemp)
  }
}

/** `--dry-run`: the exact `claude` command line of every task, and what each may spend. */
function dryRun(options: Options, exe: string | undefined, tasks: readonly TaskDefinition[]) {
  const runs = tasks.length * options.repeat
  console.log(`IDE: ${exe ?? '(none found: pass --exe)'}`)
  console.log(`Output: ${options.out}`)
  console.log(
    `Run budget: ${options.budgetUsd != null ? `$${options.budgetUsd}` : '(none given)'}; ${runs} task runs\n`,
  )
  for (const task of tasks) {
    const request: AgentRequest = {
      prompt: task.prompt,
      model: options.model,
      effort: options.effort,
      budgetUsd: taskBudgetUsd(options, runs),
      mcpConfigPath: '<root>/mcp.json',
      maxTurns: options.maxTurns,
      timeoutMs: options.timeoutMinutes * 60_000,
    }
    console.log(`# ${task.id}: ${task.summary}`)
    console.log(
      `(cwd <root>/agent-cwd; at most ${options.maxTurns} turns, ${options.timeoutMinutes} min)`,
    )
    console.log(`${formatCommand(buildClaudeArgs(request))}\n`)
  }
}

/** `--self-check`: every task without an agent. Returns the number of tasks that did not behave. */
async function selfCheck(options: Options, exe: string, tasks: readonly TaskDefinition[]) {
  const runName = `self-check-${Date.now().toString(36)}`
  let bad = 0
  for (const task of tasks) {
    console.log(`\n${task.id}`)
    const root = makeTaskRoot(runName, task.id)
    let ide: Ide | undefined
    try {
      ide = (await startTask(options, exe, task, root, runName)).ide
      // The untouched fixture: the discriminating checks must fail.
      const fixture = await createProject(exe, root, projectName(task), fixtureDirs(task, false))
      await openAndSettle(ide.call, fixture)
      const baseline = (await task.baseline?.(ide.call)) ?? {}
      const facts = { ended: 'self-check', forbiddenFileChanges: [], dryRunFiles: [] } as const
      const onFixture = await runChecks(
        task,
        {
          call: ide.call,
          mainSource: fs.readFileSync(path.join(fixture, 'src', 'Main.enso'), 'utf8'),
          baseline,
        },
        facts,
      )
      const mustFail = task.checks.filter((c) => c.discriminating === true).map((c) => c.name)
      const stillPass = onFixture.filter((c) => mustFail.includes(c.name) && c.passed)
      const fixtureOk = stillPass.length === 0 && mustFail.length > 0
      console.log(
        `  fixture: ${fixtureOk ? 'ok' : 'WRONG'} — ${onFixture.filter((c) => !c.passed).length} of ${onFixture.length} checks fail${stillPass.length > 0 ? `; these should fail: ${stillPass.map((c) => c.name).join('; ')}` : ''}`,
      )
      const closed = await ide.call('close_project')
      if (closed.isError) console.warn(`  close_project: ${closed.text}`)
      // The reference solution: every check must pass.
      const solved = await createProject(
        exe,
        root,
        projectName(task, '_Solved'),
        fixtureDirs(task, true),
      )
      await openAndSettle(ide.call, solved)
      const onSolution = await runChecks(
        task,
        {
          call: ide.call,
          mainSource: fs.readFileSync(path.join(solved, 'src', 'Main.enso'), 'utf8'),
          baseline,
        },
        facts,
      )
      const failing = onSolution.filter((c) => !c.passed)
      console.log(
        `  solution: ${failing.length === 0 ? 'ok' : 'WRONG'} — ${onSolution.length - failing.length} of ${onSolution.length} checks pass`,
      )
      for (const c of failing) console.log(`    FAIL ${c.name}: ${c.detail ?? ''}`)
      if (!fixtureOk || failing.length > 0) bad += 1
    } catch (e) {
      bad += 1
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await ide?.close()
      removeRoot(root, options.keepTemp)
    }
  }
  console.log(`\nSelf-check: ${tasks.length - bad} of ${tasks.length} tasks behave.`)
  return bad
}

async function main(): Promise<number> {
  refuseInCi(process.env)
  const options = parseOptions(process.argv.slice(2), TASK_IDS)
  const tasks = options.tasks.map((id) => TASKS.find((t) => t.id === id)!)
  const exe = options.exe ?? (await findBuiltElectronExecutable())
  if (options.dryRun) {
    dryRun(options, exe, tasks)
    return 0
  }
  if (exe == null || !fs.existsSync(exe)) {
    throw new Error('No packaged IDE found: build one (`ide-local`) or pass --exe <path>.')
  }
  removeStaleRoots()
  if (options.selfCheck) return (await selfCheck(options, exe, tasks)) === 0 ? 0 : 1
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The runs use `claude --bare`, which reads no login, so the ' +
        'key is the only way in (and `total_cost_usd` is the real cost). Nothing was started.',
    )
  }
  const budget = options.budgetUsd!
  const totalRuns = tasks.length * options.repeat
  const perTask = taskBudgetUsd(options, totalRuns)
  const startedAt = new Date()
  const commit = currentCommit()
  const runName = runDirectoryName(startedAt, commit)
  fs.mkdirSync(path.join(options.out, runName), { recursive: true })
  console.log(
    `Run ${runName}: ${totalRuns} task runs, $${budget} budget, $${perTask.toFixed(2)} each at most.`,
  )
  const records: TaskRunRecord[] = []
  const skipped: string[] = []
  let spent = 0

  for (let repeat = 1; repeat <= options.repeat; repeat++) {
    for (const task of tasks) {
      if (!mayStartTask(budget, spent, perTask)) {
        skipped.push(`${task.id} #${repeat}`)
        continue
      }
      console.log(`\n${task.id} #${repeat} (spent $${spent.toFixed(2)})`)
      const record = await runTask(options, exe, task, repeat, runName, perTask)
      records.push(record)
      spent += record.costUsd
      console.log(
        `  ${record.status.toUpperCase()} (${record.ended}), $${record.costUsd.toFixed(2)}`,
      )
    }
  }
  const run: RunRecord = {
    name: runName,
    startedAt: startedAt.toISOString(),
    commit,
    ideVersion: ideVersionSeen,
    cliVersion: cliVersion(),
    model: options.model,
    effort: options.effort,
    options: { ...options, exe },
    runs: records,
    totalCostUsd: spent,
    skipped,
  }
  const dir = path.join(options.out, runName)
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2))
  const baseline = options.baseline != null ? readBaseline(options.baseline) : undefined
  const report = renderReport(run, baseline)
  fs.writeFileSync(path.join(dir, 'report.md'), report)
  appendHistory(options.out, run)
  console.log(`\n${report}\nWritten to ${dir}`)
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  },
)
