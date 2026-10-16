/**
 * @file Writing a project's open modules to disk before a version is saved. The ydoc server holds
 * the modules (it is the Language Server's client for them), so the GUI asks it, on the index
 * doc's control channel (`ydoc-shared/ydocControl`), sending each module doc's state vector: the
 * server writes a module only once it has the edits the GUI had made. With no answer (an engine
 * without the channel, or a busy one), the GUI waits for the engine's own auto-save instead.
 */
import { YjsChannel } from 'ydoc-channel'
import {
  encodeControlMessage,
  parseControlMessage,
  stateVectorEntries,
  YDOC_CONTROL_CHANNEL,
} from 'ydoc-shared/ydocControl'
import type * as Y from 'yjs'

/** What became of a flush. */
export type FlushOutcome =
  | { readonly kind: 'flushed' }
  /** No answer: waited {@link AUTOSAVE_FALLBACK_MS} for the engine's auto-save. */
  | { readonly kind: 'waited' }
  /** The server refused (the file changed on disk, or is not in sync); nothing was written. */
  | { readonly kind: 'declined'; readonly reason: string }

/** How long the GUI waits for the ydoc server's answer. */
export const FLUSH_TIMEOUT_MS = 5_000
/** From the request, how long to wait without an answer: the engine's 6 s auto-save, and a margin. */
export const AUTOSAVE_FALLBACK_MS = 7_000

/** Create the flusher of a project, whose index doc is `indexDoc`. */
export function createModuleFlusher(
  indexDoc: Y.Doc,
  moduleDocs: () => Iterable<Y.Doc>,
  options: { readonly timeoutMs?: number; readonly fallbackMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? FLUSH_TIMEOUT_MS
  const fallbackMs = options.fallbackMs ?? AUTOSAVE_FALLBACK_MS
  const control = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL)
  const pending = new Map<string, (outcome: FlushOutcome) => void>()
  control.subscribe((raw) => {
    const message = parseControlMessage(raw)
    if (message?.type !== 'flushed') return
    pending.get(message.id)?.(
      message.ok ? { kind: 'flushed' } : { kind: 'declined', reason: message.error },
    )
  })

  /** Ask the ydoc server to write every module, as the GUI has it now. */
  async function flush(): Promise<FlushOutcome> {
    const started = Date.now()
    const id = crypto.randomUUID()
    const modules = Object.fromEntries(
      Array.from(moduleDocs(), (doc) => [doc.guid, stateVectorEntries(doc)]),
    )
    const answer = await new Promise<FlushOutcome | null>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve(null)
      }, timeoutMs)
      pending.set(id, (outcome) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(outcome)
      })
      control.send(encodeControlMessage({ type: 'flush', id, modules }))
    })
    if (answer != null) return answer
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, started + fallbackMs - Date.now())),
    )
    return { kind: 'waited' }
  }

  return { flush, close: () => control.close() }
}
