/** @file Killing a child process together with the processes it started. */
import * as childProcess from 'node:child_process'

/**
 * Kill `child` and everything it started (on Windows a `.bat` launcher's `cmd.exe` has a child,
 * the engine, which killing `cmd.exe` alone would orphan). `label` prefixes the warning when
 * `taskkill` cannot be started. A child that has exited is left alone.
 */
export function killTree(child: childProcess.ChildProcess, label: string): void {
  if (child.pid == null || child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') {
    childProcess
      .spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      // A failed spawn must not be an unhandled error in Electron's main process (#401).
      .on('error', (error) => console.warn(`${label}: taskkill failed:`, error))
  } else {
    child.kill('SIGKILL')
  }
}
