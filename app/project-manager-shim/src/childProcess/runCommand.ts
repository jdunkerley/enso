import * as childProcess from 'node:child_process'

/** The result of a finished command. */
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

/** A command that exited with a non-zero code. */
export class CommandError extends Error {
  /**
   * @param command - The command that was executed
   * @param code - The exit code of the process
   * @param stdout - Standard output from the process
   * @param stderr - Standard error from the process
   */
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super()
  }
}

/**
 * Run `command` with `args` (no shell) and collect its output.
 * @throws {CommandError} when it exits non-zero; an `Error` when it cannot be spawned.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly input?: string },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const process = childProcess.spawn(command, args as string[], {
      cwd: options?.cwd,
      env: options?.env,
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    process.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    if (options?.input) {
      process.stdin.write(options.input)
      process.stdin.end()
    }

    process.on('error', (error) => {
      reject(error)
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new CommandError(command, code, stdout, stderr))
      }
    })
  })
}
