import { afterEach, describe, expect, test, vi } from 'vitest'
import { YjsChannel } from 'ydoc-channel'
import {
  encodeControlMessage,
  FLUSH_DEADLINE_MS,
  parseControlMessage,
  YDOC_CONTROL_CHANNEL,
} from 'ydoc-shared/ydocControl'
import * as Y from 'yjs'
import { AUTOSAVE_FALLBACK_MS, createModuleFlusher, FLUSH_TIMEOUT_MS } from '../flush'

afterEach(() => vi.useRealTimers())

/** The ydoc server's end of the control channel, answering with `answer` (`null`: no answer yet). */
function serverEnd(indexDoc: Y.Doc, answer: (id: string) => object | null) {
  const requests: unknown[] = []
  const channel = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL)
  channel.subscribe((raw) => {
    const message = parseControlMessage(raw)
    requests.push(message)
    if (message?.type !== 'flush') return
    const reply = answer(message.id)
    if (reply != null) channel.send(JSON.stringify({ type: 'flushed', id: message.id, ...reply }))
  })
  const answerLater = (id: string, reply: object) =>
    channel.send(JSON.stringify({ type: 'flushed', id, ...reply }))
  return { requests, answerLater }
}

describe('createModuleFlusher', () => {
  test('the GUI waits longer than the server may take, and falls back no sooner', () => {
    expect(FLUSH_TIMEOUT_MS).toBeGreaterThan(FLUSH_DEADLINE_MS)
    expect(AUTOSAVE_FALLBACK_MS).toBeGreaterThanOrEqual(FLUSH_TIMEOUT_MS)
  })

  test('sends each loaded module doc’s state, and reports a flush', async () => {
    const indexDoc = new Y.Doc()
    const moduleDoc = new Y.Doc()
    moduleDoc.getMap('m').set('k', 1)
    const { requests } = serverEnd(indexDoc, () => ({ ok: true }))
    const flusher = createModuleFlusher(indexDoc, () => [moduleDoc])
    expect(await flusher.flush()).toEqual({ kind: 'flushed' })
    expect(requests).toEqual([
      {
        type: 'flush',
        id: expect.any(String),
        modules: { [moduleDoc.guid]: { stateVector: [[moduleDoc.clientID, 1]], deleteSet: {} } },
      },
    ])
  })

  test('a module doc this client never loaded is not sent', async () => {
    const indexDoc = new Y.Doc()
    const loaded = new Y.Doc()
    const unloaded = new Y.Doc({ shouldLoad: false })
    const { requests } = serverEnd(indexDoc, () => ({ ok: true }))
    await createModuleFlusher(indexDoc, () => [loaded, unloaded]).flush()
    expect(requests).toEqual([
      expect.objectContaining({ modules: { [loaded.guid]: expect.anything() } }),
    ])
  })

  test('a refusal is "declined", with the server’s reason', async () => {
    const indexDoc = new Y.Doc()
    serverEnd(indexDoc, () => ({ ok: false, error: 'Main.enso was changed on disk.' }))
    const flusher = createModuleFlusher(indexDoc, () => [])
    expect(await flusher.flush()).toEqual({
      kind: 'declined',
      reason: 'Main.enso was changed on disk.',
    })
  })

  test('no answer: waits for the auto-save, then "waited"', async () => {
    vi.useFakeTimers()
    const indexDoc = new Y.Doc()
    serverEnd(indexDoc, () => null)
    const flusher = createModuleFlusher(indexDoc, () => [])
    let outcome: unknown
    void flusher.flush().then((result) => (outcome = result))
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS)
    expect(outcome).toBeUndefined()
    await vi.advanceTimersByTimeAsync(AUTOSAVE_FALLBACK_MS - FLUSH_TIMEOUT_MS)
    expect(outcome).toEqual({ kind: 'waited' })
  })

  test('a refusal that comes after the timeout, but before the fallback, still wins', async () => {
    vi.useFakeTimers()
    const indexDoc = new Y.Doc()
    let requestId: string | undefined
    const server = serverEnd(indexDoc, (id) => ((requestId = id), null))
    const flusher = createModuleFlusher(indexDoc, () => [])
    let outcome: unknown
    void flusher.flush().then((result) => (outcome = result))
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS + 100)
    server.answerLater(requestId!, { ok: false, error: 'late' })
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toEqual({ kind: 'declined', reason: 'late' })
  })

  test('answers for another request are ignored', async () => {
    const indexDoc = new Y.Doc()
    const other = new YjsChannel<string>(indexDoc, YDOC_CONTROL_CHANNEL)
    serverEnd(indexDoc, (id) => {
      other.send(
        encodeControlMessage({ type: 'flushed', id: `${id}-other`, ok: false, error: 'x' }),
      )
      return { ok: true }
    })
    expect(await createModuleFlusher(indexDoc, () => []).flush()).toEqual({ kind: 'flushed' })
  })
})
