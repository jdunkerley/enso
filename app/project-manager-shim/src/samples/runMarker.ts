/**
 * @file A marker that a project is being run by a process: `<project>/.enso/run-<pid>.lock`, holding
 * `{ pid, host }` and touched every {@link RUN_MARKER_HEARTBEAT_MS}. A headless `--startup.project`
 * run takes no single-instance lock, so an IDE started meanwhile cannot see it among its own open
 * projects; the samples check looks for a live marker instead, and never changes a sample that has
 * one.
 *
 * A marker is live when it was touched within {@link RUN_MARKER_STALE_MS}, comes from this host, and
 * its process is not known to be gone (`EPERM`, a process of another user, is not known either
 * way, so the heartbeat decides). Any other marker is stale (a crash, a reused pid, a marker from
 * another machine sharing the folder) and is deleted when it is read.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as pathModule from 'node:path'

/** How often a running process touches its marker. */
export const RUN_MARKER_HEARTBEAT_MS = 30_000
/** How long a marker stays live without a touch. */
export const RUN_MARKER_STALE_MS = 120_000

const MARKER_REGEX = /^run-(?<pid>\d+)\.lock$/

/** Whether a file name is a run marker's. */
export function isRunMarkerName(name: string): boolean {
  return MARKER_REGEX.test(name)
}

function markerDirectory(projectPath: string): string {
  return pathModule.join(projectPath, '.enso')
}

/** Whether the process with this id is running: `'unknown'` when that cannot be told. */
function processState(pid: number): 'alive' | 'gone' | 'unknown' {
  if (pid === process.pid) return 'alive'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    // `EPERM`: something has this pid, but it may be a reused one of another user.
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown'
  }
}

/** A marker being kept: remove it with `remove`. */
export interface RunMarker {
  readonly path: string
  readonly remove: () => Promise<void>
  /** Remove the marker at once, synchronously (on a signal, before the process exits). */
  readonly removeNow: () => void
}

/**
 * Mark the project at `projectPath` as run by this process, and keep the marker fresh until it is
 * removed. A marker that cannot be written is logged and otherwise ignored.
 */
export async function markProjectRunning(projectPath: string): Promise<RunMarker> {
  const marker = pathModule.join(markerDirectory(projectPath), `run-${process.pid}.lock`)
  try {
    await fs.promises.mkdir(markerDirectory(projectPath), { recursive: true })
    await fs.promises.writeFile(marker, JSON.stringify({ pid: process.pid, host: os.hostname() }))
  } catch (error) {
    console.warn(`Could not mark '${projectPath}' as running:`, error)
    return { path: marker, remove: async () => {}, removeNow: () => {} }
  }
  const heartbeat = setInterval(() => {
    const now = new Date()
    fs.promises.utimes(marker, now, now).catch(() => {})
  }, RUN_MARKER_HEARTBEAT_MS)
  heartbeat.unref()
  return {
    path: marker,
    remove: async () => {
      clearInterval(heartbeat)
      await fs.promises.rm(marker, { force: true }).catch(() => {})
    },
    removeNow: () => {
      clearInterval(heartbeat)
      try {
        fs.rmSync(marker, { force: true })
      } catch {
        // Nothing more can be done as the process exits; the marker goes stale.
      }
    },
  }
}

/** The exit codes a shell gives a process ended by these signals. */
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const

/**
 * Remove `marker` when this process is interrupted (Ctrl+C) or terminated, then exit as the signal
 * would have. Returns the function that stops listening.
 */
export function removeOnSignals(marker: RunMarker): () => void {
  const handlers = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => {
    const handler = () => {
      marker.removeNow()
      process.exit(code)
    }
    process.once(signal, handler)
    return [signal, handler] as const
  })
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
}

/** Whether the marker file at `path` is live (see the file's comment). */
async function isLive(path: string, now: number): Promise<boolean> {
  const stats = await fs.promises.stat(path)
  if (now - stats.mtimeMs > RUN_MARKER_STALE_MS) return false
  let content: unknown
  try {
    content = JSON.parse(await fs.promises.readFile(path, 'utf8'))
  } catch {
    // An unreadable marker (an older format, a partial write) has only its heartbeat.
    return true
  }
  if (typeof content !== 'object' || content == null) return true
  if ('host' in content && typeof content.host === 'string' && content.host !== os.hostname()) {
    return false
  }
  const pid = 'pid' in content && typeof content.pid === 'number' ? content.pid : null
  return pid == null || processState(pid) !== 'gone'
}

/**
 * The live run marker of the project at `projectPath` (see {@link markProjectRunning}), or `null`.
 * Stale markers found on the way are deleted.
 */
export async function findLiveRunMarker(
  projectPath: string,
  now = Date.now(),
): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.promises.readdir(markerDirectory(projectPath))
  } catch {
    return null
  }
  let live: string | null = null
  for (const name of names) {
    if (!isRunMarkerName(name)) continue
    const path = pathModule.join(markerDirectory(projectPath), name)
    try {
      if (await isLive(path, now)) live ??= path
      else await fs.promises.rm(path, { force: true })
    } catch {
      // Gone meanwhile, or not readable: not a marker that blocks anything.
    }
  }
  return live
}
