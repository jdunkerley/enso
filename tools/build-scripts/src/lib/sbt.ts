/**
 * @file The one place in the build scripts that starts sbt. `tools/ci/check-workflows.mjs` fails
 * any other module that does, and counts every command that imports this one as an sbt call, so a
 * workflow must run `setup-jvm` before it.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { invocation, runInherited } from './repo.ts'

/** What `./run` set on every sbt process. */
export const SBT_ENV = { LC_ALL: 'C.UTF-8', SBT_SERVER_FORCESTART: 'true' } as const

/** `./run`'s sbt arguments around one command string. */
export function sbtArguments(command: string): string[] {
  return ['-Dbench.compileOnly=false', '-Dsbt.server.autostart=false', command]
}

/**
 * Starts `sbt <command>` in `cwd` without waiting for it. On POSIX it leads a process group of its
 * own, so that {@link killTree} stops the forked JVMs too.
 */
export function spawnSbt(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const how = invocation('sbt', sbtArguments(command))
  return spawn(how.file, how.args, {
    cwd,
    env: { ...env, ...SBT_ENV },
    shell: how.shell,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform !== 'win32',
  })
}

/**
 * Runs `sbt <command>` in the repository to completion, with this process's output, and returns
 * its exit status (-1 when sbt cannot start).
 */
export function runSbt(command: string, env: NodeJS.ProcessEnv): number {
  return runInherited('sbt', sbtArguments(command), {
    env: { ...env, ...SBT_ENV },
  })
}

/** Stops a process started by {@link spawnSbt} and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}
