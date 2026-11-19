/**
 * @file The in-memory record of who uses the MCP server and what they called, for the window's
 * activity icon. It never holds arguments, results or error text; see Note [The MCP Activity
 * Record Holds No Data].
 */
import {
  MCP_ACTIVITY_MAX_CALLS,
  MCP_CONNECTED_WINDOW_MS,
  type McpActivityCall,
  type McpActivityClient,
  type McpActivitySnapshot,
  type McpCallOutcome,
} from 'enso-common/src/mcp'

/* Note [The MCP Activity Record Holds No Data]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The popover can be on screen while the user shares their screen, and tool arguments, results and
 * errors can hold the user's data (node code, file paths and contents). A call is therefore
 * recorded as its tool's name, its client, its times and its outcome, and nothing else: the methods
 * below take no argument that could carry more. Clients are named by what the app calls itself,
 * which is a label chosen by the caller, so it is trimmed and stripped of control characters. The
 * record is never written to disk or to the log.
 */

const MAX_CLIENTS = 8
const MAX_NAME_CHARS = 64
/** While only a client's `lastSeenAt` moves, the window is told at most this often. */
const SEEN_BROADCAST_MS = 5000
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

interface ClientRecord {
  /** The product token of the `User-Agent`: what identifies the client. */
  readonly token: string
  name: string
  version: string | null
  lastSeenAt: number
}

/** A label chosen by a caller: control characters removed, trimmed, at most 64 characters. */
function sanitise(label: string): string {
  return label.replace(CONTROL_CHARACTERS, '').trim().slice(0, MAX_NAME_CHARS)
}

/** Who has used the MCP server, and its last few calls. Held in main's memory only. */
export class McpActivity {
  private clients: ClientRecord[] = []
  private calls: McpActivityCall[] = []
  private nextId = 1
  private lastBroadcastAt = 0

  /**
   * `onChanged` receives a new snapshot at every change that matters to the window. `now` is the
   * clock, in epoch milliseconds.
   */
  constructor(
    private readonly onChanged: (snapshot: McpActivitySnapshot) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The record as it stands. */
  snapshot(): McpActivitySnapshot {
    const clients: McpActivityClient[] = [...this.clients]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(({ name, version, lastSeenAt }) => ({ name, version, lastSeenAt }))
    return { clients, calls: [...this.calls] }
  }

  /**
   * A request from the client with this `User-Agent` token passed the caller checks. A client
   * seen first, or again after the connected window lapsed, is broadcast at once; one only seen
   * again, at most every 5 s.
   */
  seen(token: string): void {
    const now = this.now()
    const known = this.clients.find((client) => client.token === token)
    if (known == null) {
      this.clients.push({ token, name: token, version: null, lastSeenAt: now })
      if (this.clients.length > MAX_CLIENTS) {
        const oldest = this.clients.reduce((a, b) => (b.lastSeenAt < a.lastSeenAt ? b : a))
        this.clients = this.clients.filter((client) => client !== oldest)
      }
      this.broadcast()
      return
    }
    const lapsed = now - known.lastSeenAt > MCP_CONNECTED_WINDOW_MS
    known.lastSeenAt = now
    if (lapsed || now - this.lastBroadcastAt >= SEEN_BROADCAST_MS) this.broadcast()
  }

  /** The client with this token introduced itself (`initialize`): `title`, else `name`. */
  named(
    token: string,
    info: {
      readonly name: string
      readonly title?: string | undefined
      readonly version: string | null
    },
  ): void {
    const label = sanitise(info.title ?? info.name) || sanitise(info.name) || token
    const version = info.version == null ? null : sanitise(info.version) || null
    let client = this.clients.find((candidate) => candidate.token === token)
    if (client == null) {
      this.seen(token)
      client = this.clients.find((candidate) => candidate.token === token)
    }
    if (client == null) return
    client.name = label
    client.version = version
    this.broadcast()
  }

  /** A call began; returns its id for {@link end}. */
  start(token: string, tool: string): number {
    const id = this.nextId++
    const client = this.clients.find((candidate) => candidate.token === token)
    const call: McpActivityCall = {
      id,
      client: client?.name ?? token,
      tool,
      startedAt: this.now(),
      endedAt: null,
      outcome: 'running',
    }
    this.calls = [call, ...this.calls].slice(0, MCP_ACTIVITY_MAX_CALLS)
    this.broadcast()
    return id
  }

  /** The call ended. Does nothing for one that has left the record (it is cleared or too old). */
  end(id: number, outcome: Exclude<McpCallOutcome, 'running'>): void {
    const index = this.calls.findIndex((call) => call.id === id)
    if (index < 0) return
    this.calls = this.calls.map((call, i) =>
      i === index ? { ...call, endedAt: this.now(), outcome } : call,
    )
    this.broadcast()
  }

  /** Forget everything (the server stopped). Tells the window only if there was anything. */
  clear(): void {
    if (this.clients.length === 0 && this.calls.length === 0) return
    this.clients = []
    this.calls = []
    this.broadcast()
  }

  private broadcast(): void {
    this.lastBroadcastAt = this.now()
    this.onChanged(this.snapshot())
  }
}
