/**
 * @file Find a project's engine log files: the active `.log` file of each session, in the
 * project's own log directory (`<engine log directory>/<local project key>`).
 */
import * as fsSync from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * An active session log, `<prefix>-yyyy-MM-dd-HH-mm-ss.log`, as `LogbackSetup.setupFileAppender`
 * names it. Rolled archives (`….N.log.gz`) do not match.
 */
const ACTIVE_LOG = /^(.+)-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.log$/

/** The names of the active session logs in `directory`; none when it does not exist. */
export function listActiveLogsSync(directory: string): string[] {
  try {
    return fsSync.readdirSync(directory).filter((name) => ACTIVE_LOG.test(name))
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

/**
 * The newest active session log in `directory` whose name is not in `known`: the log of an engine
 * started after `known` was listed.
 * @returns Its full path, or `undefined` while there is none.
 */
export async function findNewSessionLog(
  directory: string,
  known: ReadonlySet<string>,
): Promise<string | undefined> {
  let names: string[]
  try {
    names = await fs.readdir(directory)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  const fresh = names.filter((name) => ACTIVE_LOG.test(name) && !known.has(name))
  fresh.sort(compareByTimestamp)
  const newest = fresh.at(-1)
  return newest == null ? undefined : path.join(directory, newest)
}

function compareByTimestamp(a: string, b: string): number {
  const timeA = ACTIVE_LOG.exec(a)?.[2] ?? ''
  const timeB = ACTIVE_LOG.exec(b)?.[2] ?? ''
  return timeA === timeB ? a.localeCompare(b) : timeA.localeCompare(timeB)
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
