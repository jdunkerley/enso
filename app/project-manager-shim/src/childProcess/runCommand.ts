import * as childProcess from 'node:child_process'

/** The result of a finished command. */
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

/**
 * A command that exited with a non-zero code. Its message is the trimmed stderr, else the trimmed
 * stdout, else the exit code.
 */
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
    // Some commands (`git commit`: "nothing to commit") explain a failure on stdout only.
    super(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`)
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
    const child = childProcess.spawn(command, args as string[], {
      cwd: options?.cwd,
      env: options?.env,
      shell: false,
      windowsHide: true,
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout.on('data', (data) => {
      stdoutChunks.push(data instanceof Buffer ? data : Buffer.from(data))
    })

    child.stderr.on('data', (data) => {
      stderrChunks.push(data instanceof Buffer ? data : Buffer.from(data))
    })

    if (options?.input) {
      child.stdin.write(options.input)
    }

    // Always close stdin (even with no input, so children reading to EOF don't hang)
    child.stdin.end()

    // Handle stdin errors (e.g., EPIPE when child exits before reading)
    child.stdin.on('error', () => {
      // Ignore stdin errors; exit code will determine outcome
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')

      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new CommandError(command, code, stdout, stderr))
      }
    })
  })
}
