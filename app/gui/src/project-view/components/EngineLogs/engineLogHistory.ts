/** @file Read a whole engine log session through the existing session-log query. */
import type { ProjectSessionId } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'

/** A bound on the pages read, in case a backend never says `done`. */
export const MAX_HISTORY_PAGES = 1_000

/**
 * Every line of a session, oldest first: its rolled archives, then its active file, as the shim
 * pages them (`archive:N` … `active` … `done`).
 */
export async function fetchSessionLines(
  backend: Pick<LocalBackend, 'getProjectSessionLogs'>,
  sessionId: ProjectSessionId,
): Promise<string[]> {
  const lines: string[] = []
  let scrollId: string | null = null
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const result = await backend.getProjectSessionLogs(sessionId, { scrollId })
    for (const line of result.hits) lines.push(line)
    if (result.scrollId === 'done' || result.scrollId === scrollId) break
    scrollId = result.scrollId
  }
  return lines
}
