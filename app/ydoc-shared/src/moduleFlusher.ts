/**
 * @file The client's end of the `flush` request on the ydoc control channel (`ydocControl.ts`):
 * ask the ydoc server, which holds the modules as the Language Server's client for them, to write
 * them to disk, sending what each loaded module doc contains. The server writes a module only once
 * it has those edits. With no answer (an engine without the channel, or a busy one), the client
 * waits for the engine's own auto-save instead. The GUI uses it through
 * `app/gui/src/providers/openedProjects/project/flush.ts`.
 */
import { YjsChannel } from 'ydoc-channel'
import type * as Y from 'yjs'
import {
  encodeControlMessage,
  FLUSH_DEADLINE_MS,
  moduleState,
  parseControlMessage,
  YDOC_CONTROL_CHANNEL,
} from './ydocControl'

/** What became of a flush. */
export type FlushOutcome =
  | { readonly kind: 'flushed' }
  /** No answer: waited {@link AUTOSAVE_FALLBACK_MS} for the engine's auto-save. */
  | { readonly kind: 'waited' }
  /** The server refused (the file changed on disk, or is not in sync); nothing was written. */
  | { readonly kind: 'declined'; readonly reason: string }

/** By when the ydoc server answers: its own deadline ({@link FLUSH_DEADLINE_MS}), and a margin. */
export const FLUSH_TIMEOUT_MS = FLUSH_DEADLINE_MS + 2_000
/**
 * From the request, how long to wait without an answer: the engine's 6 s auto-save, and a margin.
 * An answer that comes later than {@link FLUSH_TIMEOUT_MS} but within this still counts, so a late
 * refusal is never taken for a save. It must not be shorter than {@link FLUSH_TIMEOUT_MS}.
 */
export const AUTOSAVE_FALLBACK_MS = 7_000

/**
 * Create the flusher of a project, whose index doc is `indexDoc`. Of `moduleDocs`, only those this
 * client loaded are sent: an unloaded subdoc holds no edits of this client.
 */
export function createModuleFlusher(
  indexDoc: Y.Doc,
  moduleDocs: () => Iterable<Y.Doc>,
  options: { readonly fallbackMs?: number } = {},
) {
  const fallbackMs = options.fallbackMs ?? AUTOSAVE_FALLBACK_MS
  if (fallbackMs < FLUSH_TIMEOUT_MS)
    throw new Error(`The fallback (${fallbackMs} ms) is shorter than the server's answer time.`)
  const control = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL)
  const pending = new Map<string, (outcome: FlushOutcome) => void>()
  control.subscribe((raw) => {
    const message = parseControlMessage(raw)
    if (message?.type !== 'flushed') return
    pending.get(message.id)?.(
      message.ok ? { kind: 'flushed' } : { kind: 'declined', reason: message.error },
    )
  })

  /** Ask the ydoc server to write every loaded module, as this client has it now. */
  function flush(): Promise<FlushOutcome> {
    const id = crypto.randomUUID()
    const modules = Object.fromEntries(
      Array.from(moduleDocs())
        .filter((doc) => doc.shouldLoad)
        .map((doc) => [doc.guid, moduleState(doc)]),
    )
    return new Promise<FlushOutcome>((resolve) => {
      const finish = (outcome: FlushOutcome) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(outcome)
      }
      const timer = setTimeout(() => finish({ kind: 'waited' }), fallbackMs)
      pending.set(id, finish)
      control.send(encodeControlMessage({ type: 'flush', id, modules }))
    })
  }

  return { flush, close: () => control.close() }
}
