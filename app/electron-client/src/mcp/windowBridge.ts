/** @file Forwards a project tool call from main to the IDE window and awaits the window's reply. */
import type {
  McpCaller,
  McpToolCallReply,
  McpToolCallRequest,
  McpToolResult,
} from 'enso-common/src/mcp'
import { randomUUID } from 'node:crypto'
import { Channel } from '../ipc'

export const WINDOW_TOOL_TIMEOUT_MS = 30_000

/** The part of a `WebContents` the bridge needs. */
export interface WindowTarget {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

interface Pending {
  readonly resolve: (result: McpToolResult) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * Whether a message from the window is a well-formed reply: a string `requestId` and a `result`
 * that is `ok: true` with a string `value` or `ok: false` with a string `error`. Anything else is
 * ignored; the call it might belong to times out.
 */
function isReply(reply: unknown): reply is McpToolCallReply {
  if (typeof reply !== 'object' || reply == null) return false
  const { requestId, result } = reply as { requestId?: unknown; result?: unknown }
  if (typeof requestId !== 'string' || typeof result !== 'object' || result == null) return false
  const { ok, value, error } = result as { ok?: unknown; value?: unknown; error?: unknown }
  return (ok === true && typeof value === 'string') || (ok === false && typeof error === 'string')
}

/** Sends project tool calls to the IDE window over IPC and awaits the replies. */
export class WindowBridge {
  private readonly pending = new Map<string, Pending>()
  /** Settles the pending call a window reply belongs to. */
  private readonly replyListener = (_event: unknown, reply: unknown) => {
    if (isReply(reply)) this.handleReply(reply)
  }

  /** `resolveWindow` is asked afresh on each call, so a reopened window is found. */
  constructor(
    private readonly resolveWindow: () => WindowTarget | null,
    private readonly ipc: Pick<Electron.IpcMain, 'on' | 'removeListener'>,
  ) {
    this.ipc.on(Channel.mcpToolReply, this.replyListener)
  }

  /**
   * Send {@link Channel.mcpToolCall} and resolve with the window's reply, or `{ ok: false }` when
   * there is no window, it is destroyed, it fails to receive the call, or 30 s pass.
   */
  call(tool: string, args: Record<string, unknown>, caller: McpCaller): Promise<McpToolResult> {
    const win = this.resolveWindow()
    if (win == null || win.isDestroyed()) {
      return Promise.resolve({ ok: false, error: 'No Enso window is open to run this tool' })
    }
    const requestId = randomUUID()
    return new Promise<McpToolResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          resolve({
            ok: false,
            error: `The Enso window timed out after ${WINDOW_TOOL_TIMEOUT_MS}ms`,
          })
        }
      }, WINDOW_TOOL_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, timer })
      const request: McpToolCallRequest = { requestId, tool, args, caller }
      try {
        win.send(Channel.mcpToolCall, request)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        resolve({
          ok: false,
          error: `Failed to send the call to the Enso window: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    })
  }

  /** Resolve pending calls with an error and stop listening. */
  dispose(): void {
    this.ipc.removeListener(Channel.mcpToolReply, this.replyListener)
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: 'The IDE is shutting down' })
      this.pending.delete(requestId)
    }
  }

  private handleReply(reply: McpToolCallReply): void {
    const pending = this.pending.get(reply.requestId)
    if (pending == null) return
    clearTimeout(pending.timer)
    this.pending.delete(reply.requestId)
    pending.resolve(reply.result)
  }
}
