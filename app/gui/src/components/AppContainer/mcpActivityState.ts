/**
 * @file What the MCP activity icon shows, worked out from main's status and activity record.
 */
import {
  MCP_ACTIVE_WINDOW_MS,
  MCP_CONNECTED_WINDOW_MS,
  type McpActivityClient,
  type McpActivitySnapshot,
  type McpStatus,
} from 'enso-common/src/mcp'

/** The icon's state; the first that applies wins, top to bottom. */
export type McpActivityState =
  /** `error` is set, whether the server is switched on or not. */
  | 'error'
  /** MCP is switched off. */
  | 'off'
  /** A call is running or ended less than 10 s ago. */
  | 'active'
  /** A request came in the last 15 minutes. */
  | 'connected'
  /** On (or starting), with no client seen lately. */
  | 'idle'

/** The icon's state at `now` (epoch milliseconds). */
export function mcpActivityState(
  status: McpStatus,
  activity: McpActivitySnapshot,
  now: number,
): McpActivityState {
  if (status.error != null) return 'error'
  if (!status.enabled) return 'off'
  const working = activity.calls.some(
    (call) =>
      call.outcome === 'running' ||
      (call.endedAt != null && now - call.endedAt < MCP_ACTIVE_WINDOW_MS),
  )
  if (working) return 'active'
  return connectedClients(activity, now).length > 0 ? 'connected' : 'idle'
}

/** The clients seen in the last 15 minutes, most recently seen first. */
export function connectedClients(
  activity: McpActivitySnapshot,
  now: number,
): readonly McpActivityClient[] {
  return activity.clients.filter((client) => now - client.lastSeenAt < MCP_CONNECTED_WINDOW_MS)
}

/**
 * How long before `now` `then` was, in words ("12 seconds ago"); `justNow` for under 5 seconds.
 * `locale` is a BCP 47 tag.
 */
export function relativeAgo(then: number, now: number, locale: string, justNow: string): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 5) return justNow
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  if (seconds < 60) return format.format(-seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return format.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return format.format(-hours, 'hour')
  return format.format(-Math.round(hours / 24), 'day')
}

/**
 * The next moment after `now` at which {@link mcpActivityState} may change by time alone, or null
 * when none will: lets the window wake only when it must.
 */
export function nextLapse(activity: McpActivitySnapshot, now: number): number | null {
  const moments: number[] = []
  for (const call of activity.calls) {
    if (call.endedAt != null) moments.push(call.endedAt + MCP_ACTIVE_WINDOW_MS)
  }
  for (const client of activity.clients) moments.push(client.lastSeenAt + MCP_CONNECTED_WINDOW_MS)
  const later = moments.filter((moment) => moment > now)
  return later.length === 0 ? null : Math.min(...later)
}
