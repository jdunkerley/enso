/**
 * @file How many logical CPUs a process may run on (its affinity mask), so that a run pinned to 4
 * or 8 CPUs can be checked from its report (`app/electron-client/CLAUDE.md`, "Open-time harness").
 * Children inherit the mask, so the IDE's main process stands for the engine too.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The number of set bits. */
export function bitCount(mask: bigint): number {
  let count = 0
  for (let m = mask; m > 0n; m >>= 1n) count += Number(m & 1n)
  return count
}

/** `taskset -p <pid>`: `pid 123's current affinity mask: ff` (groups of 32 bits, comma-separated). */
export function parseTaskset(output: string): number | undefined {
  const match = /affinity mask:\s*([0-9a-f,]+)/i.exec(output)
  return match ? bitCount(BigInt(`0x${match[1]!.replace(/,/g, '')}`)) : undefined
}

/** `(Get-Process -Id <pid>).ProcessorAffinity.ToInt64()`: a decimal mask. */
export function parseWindowsAffinity(output: string): number | undefined {
  const text = output.trim()
  return /^\d+$/.test(text) ? bitCount(BigInt(text)) : undefined
}

/** The number of CPUs `pid` may run on; `undefined` when it cannot be read (or on macOS). */
export async function cpuAffinity(pid: number): Promise<number | undefined> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${pid}).ProcessorAffinity.ToInt64()`,
      ])
      return parseWindowsAffinity(stdout)
    }
    if (process.platform === 'linux') {
      const { stdout } = await run('taskset', ['-p', String(pid)])
      return parseTaskset(stdout)
    }
  } catch {
    // Not worth a failed launch: the report just has no CPU count.
  }
  return undefined
}
