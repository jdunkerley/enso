/** @file The repository root, and running other programs from the build scripts. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * The repository root. `corepack pnpm --filter build-scripts run …` runs a command in this
 * package's directory, so nothing here may resolve paths against `process.cwd()`.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** What a finished program returned. */
export interface Captured {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/** Options for {@link capture} and {@link runInherited}. */
export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Programs that are `.cmd`/`.bat` shims on Windows. Only the shell resolves those; Node finds a
 * `.exe` (`java`, `git`, `enso.exe`) by itself.
 */
const WINDOWS_SHIMS = new Set(['corepack', 'npm', 'npx', 'pnpm', 'sbt'])

/**
 * A command line for `cmd.exe`. An argument with blanks or `cmd` syntax is double-quoted; one with
 * a double quote is refused rather than escaped, since no caller needs it. Double quotes do not
 * neutralise `%` or `!` for `cmd.exe` (they are still expanded); no caller passes them.
 */
export function windowsCommandLine(program: string, args: readonly string[]): string {
  const quote = (arg: string) => {
    if (arg.includes('"')) throw new Error(`Cannot pass an argument with a double quote: ${arg}`)
    return arg === '' || /[\s&|<>^()%!]/.test(arg) ? `"${arg}"` : arg
  }
  return [program, ...args].map(quote).join(' ')
}

/** How to start `program`: through the shell for a Windows shim, directly otherwise. */
export function invocation(
  program: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { readonly file: string; readonly args: string[]; readonly shell: boolean } {
  if (platform === 'win32' && WINDOWS_SHIMS.has(program)) {
    return { file: windowsCommandLine(program, args), args: [], shell: true }
  }
  return { file: program, args: [...args], shell: false }
}

/** Runs a program to completion and returns its output. A program that cannot start has status -1. */
export function capture(
  program: string,
  args: readonly string[],
  options: RunOptions = {},
): Captured {
  const how = invocation(program, args)
  const result = spawnSync(how.file, how.args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: how.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  const failure = result.error != null ? `${String(result.error)}\n` : ''
  return {
    status: result.error != null ? -1 : (result.status ?? -1),
    stdout: result.stdout ?? '',
    stderr: failure + (result.stderr ?? ''),
  }
}

/** Runs a program with this process's stdout and stderr, and returns its exit status. */
export function runInherited(
  program: string,
  args: readonly string[],
  options: RunOptions = {},
): number {
  const how = invocation(program, args)
  const result = spawnSync(how.file, how.args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    shell: how.shell,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  return result.error != null ? -1 : (result.status ?? -1)
}

/**
 * This command's arguments. `corepack pnpm run <script> -- <args>` passes the `--` on, which
 * would end option parsing, so a leading one is dropped.
 */
export function commandArguments(argv: readonly string[] = process.argv): string[] {
  const args = argv.slice(2)
  return args[0] === '--' ? args.slice(1) : args
}
