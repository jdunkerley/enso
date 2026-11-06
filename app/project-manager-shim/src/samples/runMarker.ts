/**
 * @file A marker that a project is being run by a process: `<project>/.enso/run-<pid>.lock`. A
 * headless `--startup.project` run takes no single-instance lock, so an IDE started meanwhile
 * cannot see it among its own open projects; the samples check looks for a live marker instead,
 * and never changes a sample that has one. A marker whose process is gone is ignored.
 */
import * as fs from 'node:fs'
import * as pathModule from 'node:path'

const MARKER_REGEX = /^run-(?<pid>\d+)\.lock$/

function markerDirectory(projectPath: string): string {
  return pathModule.join(projectPath, '.enso')
}

/** Whether a process with this id is running. */
function isAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // `EPERM`: it exists, but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Mark the project at `projectPath` as run by this process. Returns the function that removes the
 * marker. A marker that cannot be written is logged and otherwise ignored.
 */
export async function markProjectRunning(projectPath: string): Promise<() => Promise<void>> {
  const marker = pathModule.join(markerDirectory(projectPath), `run-${process.pid}.lock`)
  try {
    await fs.promises.mkdir(markerDirectory(projectPath), { recursive: true })
    await fs.promises.writeFile(marker, String(process.pid))
  } catch (error) {
    console.warn(`Could not mark '${projectPath}' as running:`, error)
    return async () => {}
  }
  return async () => {
    await fs.promises.rm(marker, { force: true }).catch(() => {})
  }
}

/** Whether a running process has marked the project at `projectPath` (see {@link markProjectRunning}). */
export async function hasLiveRunMarker(projectPath: string): Promise<boolean> {
  let names: string[]
  try {
    names = await fs.promises.readdir(markerDirectory(projectPath))
  } catch {
    return false
  }
  return names.some((name) => {
    const pid = MARKER_REGEX.exec(name)?.groups?.['pid']
    return pid != null && isAlive(Number(pid))
  })
}
