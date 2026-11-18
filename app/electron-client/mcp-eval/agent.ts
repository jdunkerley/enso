/**
 * @file Drives Claude Code in headless mode: writes the MCP config, builds the command line (the
 * one in the spec, "Driving Claude Code"), reads the stream as it arrives, and enforces the turn
 * cap and the time limit. This is the only module that knows about the agent; a second agent
 * would be a sibling of it.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { endedFromResult, StreamTally, type Ended, type StreamSummary } from './stream'

/** What the agent is told besides the task (spec: the preamble says only this). */
export const PREAMBLE =
  'You work in the Enso IDE through its MCP tools. The project is open on screen. No one will ' +
  'answer questions, so do not ask any: finish the task, and end with one line saying what you did.'

/** An open can take 120 s, so a tool call may wait that long (plus a margin). */
export const MCP_TOOL_TIMEOUT_MS = 130_000

export interface AgentRequest {
  readonly prompt: string
  readonly model: string
  readonly effort?: string | undefined
  readonly budgetUsd: number
  readonly mcpConfigPath: string
  readonly maxTurns: number
  readonly timeoutMs: number
}

/** The `mcp.json` the agent reads: the IDE's server, with this run's port and token. */
export function mcpConfig(port: number, token: string): object {
  return {
    mcpServers: {
      enso: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }
}

/** The arguments of `claude`: only the IDE's tools, no user context, a budget, a stream. */
export function buildClaudeArgs(request: AgentRequest): string[] {
  return [
    '-p',
    request.prompt,
    '--bare',
    '--mcp-config',
    request.mcpConfigPath,
    '--strict-mcp-config',
    '--tools',
    '',
    '--allowedTools',
    'mcp__enso',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--model',
    request.model,
    ...(request.effort != null ? ['--effort', request.effort] : []),
    '--max-budget-usd',
    request.budgetUsd.toFixed(2),
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--append-system-prompt',
    PREAMBLE,
  ]
}

/** The command line as a shell would need it, for `--dry-run` and the report (never run through one). */
export function formatCommand(args: readonly string[], executable = 'claude'): string {
  const quote = (arg: string) =>
    arg === '' || /[\s"'$`\\]/.test(arg) ? `"${arg.replace(/(["\\$`])/g, '\\$1')}"` : arg
  return [executable, ...args.map(quote)].join(' ')
}

/** The variables the agent keeps: where things are, and its own key; nothing else. */
const KEPT_VARIABLES = new Set(
  [
    'PATH',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'TMPDIR',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'LANG',
    'LC_ALL',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
  ].map((v) => v.toUpperCase()),
)

/** The agent's environment: `PATH`, home and temp variables, the key and the tool timeout. */
export function agentEnv(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(parent)) {
    if (value != null && KEPT_VARIABLES.has(name.toUpperCase())) env[name] = value
  }
  if (parent.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = parent.ANTHROPIC_API_KEY
  env.MCP_TOOL_TIMEOUT = String(MCP_TOOL_TIMEOUT_MS)
  return env
}

export interface AgentRun {
  readonly summary: StreamSummary
  readonly ended: Ended
  readonly wallMs: number
  readonly exitCode: number | null
  /** The end of the agent's standard error, for a run that ended in `error`. */
  readonly stderrTail: string
}

/** Kills a process and everything it started. */
export function killTree(pid: number | undefined): void {
  if (pid == null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Runs `claude` to the end, writing every stream line to `transcriptPath`. It ends the process at
 * the turn cap or the time limit.
 */
export async function runAgent(
  request: AgentRequest,
  options: {
    readonly cwd: string
    readonly env: Record<string, string>
    readonly transcriptPath: string
  },
): Promise<AgentRun> {
  const args = buildClaudeArgs(request)
  const transcript = fs.createWriteStream(options.transcriptPath)
  const tally = new StreamTally()
  const started = Date.now()
  return await new Promise<AgentRun>((resolve) => {
    const child = spawn('claude', args, {
      cwd: options.cwd,
      // The repo types `ProcessEnv` as closed; a spawned process takes any variable.
      env: options.env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let forced: 'turn-cap' | 'timeout' | undefined
    let spawnError: string | undefined
    let stderr = ''
    let pending = ''
    const timer = setTimeout(() => {
      forced ??= 'timeout'
      killTree(child.pid)
    }, request.timeoutMs)
    const readLine = (line: string) => {
      transcript.write(`${line}\n`)
      const turns = tally.push(line)
      if (turns > request.maxTurns && forced == null) {
        forced = 'turn-cap'
        killTree(child.pid)
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) readLine(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000)
    })
    child.on('error', (e) => {
      spawnError = e.message
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (pending.trim() !== '') readLine(pending)
      transcript.end()
      const summary = tally.summary()
      const ended: Ended =
        forced ?? (spawnError != null ? 'error' : endedFromResult(summary.result))
      resolve({
        summary,
        ended,
        wallMs: Date.now() - started,
        exitCode,
        stderrTail: spawnError ?? stderr,
      })
    })
  })
}
