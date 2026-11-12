/**
 * @file Resident memory of the processes an open-time launch starts: the engine's (the launcher and
 * the JVM under it) and the ydoc host's. See `perf/openTime.ts`, which samples at
 * `welcomeShown` and 30 s later (ruling 14 of the JVM-by-default plan).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessInfo {
  readonly pid: number
  readonly ppid: number
  /** Resident set (Linux, macOS) or working set (Windows), in kilobytes. */
  readonly rssKb: number
  /** Private bytes (memory not shared with other processes), in kilobytes; read on Windows only. */
  readonly privateKb?: number
  /** The full command line; may be empty when the system does not show it. */
  readonly command: string
}

/** Parse `ps -axo pid=,ppid=,rss=,args=` (Linux, macOS). */
export function parsePs(output: string): ProcessInfo[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line)
    return match ?
        [{ pid: +match[1]!, ppid: +match[2]!, rssKb: +match[3]!, command: match[4]!.trim() }]
      : []
  })
}

/** Parse the JSON of `Get-CimInstance Win32_Process | Select-Object …` (an object for one process). */
export function parseCim(output: string): ProcessInfo[] {
  if (output.trim() === '') return []
  const parsed: unknown = JSON.parse(output)
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[]
  return rows.flatMap((row) => {
    const pid = Number(row.ProcessId)
    if (!Number.isFinite(pid)) return []
    const privateBytes = Number(row.PrivatePageCount)
    return [
      {
        pid,
        ppid: Number(row.ParentProcessId) || 0,
        rssKb: Math.round((Number(row.WorkingSetSize) || 0) / 1024),
        // `PrivatePageCount` is in bytes, despite its name.
        ...(row.PrivatePageCount != null && Number.isFinite(privateBytes) ?
          { privateKb: Math.round(privateBytes / 1024) }
        : {}),
        command: typeof row.CommandLine === 'string' ? row.CommandLine : '',
      },
    ]
  })
}

/** Every process of the machine, with its parent and memory. */
export async function listProcesses(): Promise<readonly ProcessInfo[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,CommandLine | ConvertTo-Json -Compress',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    return parseCim(stdout)
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss=,args='], {
    maxBuffer: 64 * 1024 * 1024,
  })
  return parsePs(stdout)
}

/**
 * The base name of a command line's executable: the quoted path, else the path up to the first
 * `.exe` followed by a space (a Windows path with spaces), else up to the first whitespace.
 */
export function executableName(command: string): string {
  const trimmed = command.trim()
  let executable: string
  const quoted = /^"([^"]*)"/.exec(trimmed)
  if (quoted) executable = quoted[1]!
  else {
    const exe = /^(.*?\.exe)(?=\s|$)/i.exec(trimmed)
    executable = exe ? exe[1]! : (trimmed.split(/\s/)[0] ?? '')
  }
  return executable.split(/[\\/]/).pop() ?? ''
}

const normalisePath = (file: string) => file.replace(/\\/g, '/').toLowerCase()

/** The full path of a command line's executable, normalised (see {@link executableName}). */
export function executablePath(command: string): string {
  const trimmed = command.trim()
  const quoted = /^"([^"]*)"/.exec(trimmed)
  if (quoted) return normalisePath(quoted[1]!)
  const exe = /^(.*?\.exe)(?=\s|$)/i.exec(trimmed)
  return normalisePath(exe ? exe[1]! : (trimmed.split(/\s/)[0] ?? ''))
}

/** Names of the engine's own processes: the launcher and the JVM it starts. */
const ENGINE_EXECUTABLES = new Set(['enso', 'enso.exe', 'java', 'java.exe'])

/**
 * Whether `info` is one of the engine's processes. Electron's own helpers (the renderer, the GPU
 * process, the ydoc host's utility process) run the IDE's binary, which is also called `enso` or
 * `Enso.exe`; they carry `--type=`, the engine does not.
 */
function isEngineProcess(info: ProcessInfo, ideExecutable: string | undefined): boolean {
  if (/(^|\s)--type=/.test(info.command)) return false
  if (ideExecutable != null && executablePath(info.command) === normalisePath(ideExecutable)) {
    return false
  }
  return ENGINE_EXECUTABLES.has(executableName(info.command).toLowerCase())
}

function descendants(processes: readonly ProcessInfo[], root: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const p of processes) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid])
  const found = new Set<number>()
  const queue = [root]
  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (!found.has(child) && child !== root) {
        found.add(child)
        queue.push(child)
      }
    }
  }
  return found
}

/**
 * The engine's processes: every descendant of `electronPid` that is the launcher
 * or `java`, and all their descendants, each once. `ideExecutable` is the IDE's own binary: a
 * process running it is never the engine, whatever its arguments. On Windows Playwright's
 * `electronApplication.process()` is a launcher, and the real main process (`Enso.exe --inspect=0
 * --remote-debugging-port=0`, no `--type=`) is its child: without this the whole IDE was summed.
 */
export function engineProcesses(
  processes: readonly ProcessInfo[],
  electronPid: number,
  ideExecutable?: string,
): ProcessInfo[] {
  const below = descendants(processes, electronPid)
  const counted = new Set<number>()
  for (const p of processes) {
    if (!below.has(p.pid) || !isEngineProcess(p, ideExecutable)) continue
    counted.add(p.pid)
    for (const pid of descendants(processes, p.pid)) counted.add(pid)
  }
  return processes.filter((p) => counted.has(p.pid))
}

/** The sum of {@link engineProcesses}; `undefined` when there is none (not 0 KiB: no sample). */
export function engineRssKb(
  processes: readonly ProcessInfo[],
  electronPid: number,
  ideExecutable?: string,
): number | undefined {
  const engine = engineProcesses(processes, electronPid, ideExecutable)
  return engine.length === 0 ? undefined : engine.reduce((sum, p) => sum + p.rssKb, 0)
}

/** One process's memory; `undefined` when it is gone (not 0 KiB: no sample). */
export function processRssKb(processes: readonly ProcessInfo[], pid: number): number | undefined {
  return processes.find((p) => p.pid === pid)?.rssKb
}
