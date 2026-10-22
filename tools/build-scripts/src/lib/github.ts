/** @file Publishing values the way `./run` did: GitHub Actions files in CI, `export` lines locally. */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

/**
 * One `NAME<<delimiter … delimiter` entry, the multi-line form GitHub reads from `GITHUB_OUTPUT` and
 * `GITHUB_ENV` (the form `ide_ci::actions::env_file` wrote).
 */
export function envFileEntry(name: string, value: string, delimiter: string): string {
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`
}

/** A POSIX shell `export` line; the value is single-quoted. */
export function exportLine(name: string, value: string): string {
  return `export ${name}='${value.replaceAll("'", "'\\''")}'`
}

/**
 * Publishes `values`. In GitHub Actions (`GITHUB_ACTIONS=true`) each one is appended to
 * `GITHUB_OUTPUT` (the step's outputs) and to `GITHUB_ENV` (the job's later steps), and logged.
 * Elsewhere it prints `export` lines, for `eval "$(…)"`.
 */
export function publish(
  values: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env,
  print: (line: string) => void = console.log,
): void {
  const inActions = env.GITHUB_ACTIONS === 'true'
  for (const [name, value] of Object.entries(values)) {
    if (!inActions) {
      print(exportLine(name, value))
      continue
    }
    print(`${name}=${value}`)
    for (const file of [env.GITHUB_OUTPUT, env.GITHUB_ENV]) {
      if (file) appendFileSync(file, envFileEntry(name, value, `ghadelimiter_${randomUUID()}`))
    }
  }
}
