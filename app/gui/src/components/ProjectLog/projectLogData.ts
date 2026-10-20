import { useBackends } from '$/providers/backends'
import type { ToValue } from '$/utils/reactivity'
import * as vueQuery from '@tanstack/vue-query'
import type { ProjectSessionId } from 'enso-common/src/services/Backend'
import { computed, toRef } from 'vue'

export interface LogEntry {
  level: number
  timestamp: Date
  module: string
  event: string
}

export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const

// === Fetching ===

export interface LogDataOptions {
  sessionId: ToValue<ProjectSessionId>
  projectTitle: ToValue<string>
}

/** Composable support obtaining project session log data from the backend. */
export function useLogData(options: LogDataOptions) {
  const backends = useBackends()
  const sessionId = toRef(options.sessionId)
  const projectTitle = toRef(options.projectTitle)

  /** Project sessions are local: their logs come from the local backend. */
  function localBackend() {
    const backend = backends.localBackend
    if (backend == null) throw new Error('Cannot read the project logs: no local backend.')
    return backend
  }

  const logs = vueQuery.useInfiniteQuery({
    queryKey: [
      'projectLogs',
      { projectSessionId: sessionId.value, projectTitle: projectTitle.value, infinite: true },
    ],
    queryFn: ({ pageParam }) =>
      localBackend().getProjectSessionLogs(sessionId.value, { scrollId: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hits.length === 0 ? null : page.scrollId),
  })
  const logData = computed(() => logs.data.value?.pages.flatMap((page) => page.hits) ?? [])
  const logEntries = computed(() => parseEntries(logData.value))

  const dataActions = {
    reload: {
      action: () => logs.refetch(),
    },
    loadMore: {
      action: () => logs.fetchNextPage(),
      enabled: () => logs.hasNextPage.value && !logs.isFetchingNextPage.value,
    },
    download: {
      action: () => localBackend().downloadProjectSessionLogs(sessionId.value),
    },
  }
  return {
    logEntries,
    dataActions,
    isLoading: logs.isLoading,
    isFetchingNextPage: logs.isFetchingNextPage,
  }
}

// === Parsing ===

const entryRe = new RegExp(`\\[(${LOG_LEVELS.join('|')})] \\[([^\\]]+)] \\[([^\\]]+)] (.*)`)

/** Parse a log line that starts an entry; `undefined` for any other line (a stack trace's, say). */
export function parseEntry(line: string): LogEntry | undefined {
  const matched = entryRe.exec(line)
  if (!matched) return undefined
  const [_, levelName, timestamp, mod, event] = matched
  if (levelName == null || timestamp == null || mod == null || event == null) return undefined
  const level = LOG_LEVELS.findIndex((l) => l === levelName)
  if (level == null) return undefined
  return {
    level,
    timestamp: new Date(timestamp),
    module: mod,
    event,
  }
}

function parseEntries(lines: string[]): LogEntry[] {
  const result: LogEntry[] = []
  let current: LogEntry | undefined = undefined
  for (const line of lines) {
    const parsed = parseEntry(line)
    if (parsed) {
      if (current) result.push(current)
      current = parsed
    } else {
      if (current) {
        current.event += line
      } else {
        console.error('Invalid log entry', line)
      }
    }
  }
  if (current) result.push(current)
  return result
}

// === Rendering ===

/** Printable name for the log level. */
export function logLevelName(num: number): string {
  return LOG_LEVELS[num] ?? `${num}`
}
