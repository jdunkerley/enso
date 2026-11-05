import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { DistributedProject } from '../yjsModel'

/** Exchange the two docs' missing updates both ways, as a y-websocket sync does. */
function sync(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b))
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
  Y.applyUpdate(b, toB, 'remote')
  Y.applyUpdate(a, toA, 'remote')
}

/** A ydoc server session's index doc, marked as its sessions are when they start. */
function serverDoc(sessionId: string) {
  const doc = new Y.Doc()
  new DistributedProject(doc).markServerSession(sessionId)
  return doc
}

describe('server sessions of an index doc', () => {
  test('the first session a client meets is not a replacement', () => {
    const client = new Y.Doc()
    let replaced = 0
    new DistributedProject(client).observeServerSessionReplaced(() => (replaced += 1))

    sync(client, serverDoc('a'))
    sync(client, serverDoc('a'))

    expect(replaced).toBe(0)
  })

  test('a client that meets a second session learns it was replaced, once', () => {
    // The ydoc host restarted (or the engine hosting the ydoc server did): the GUI reconnects its
    // index doc to a new session, which knows nothing of the GUI's Language Server session, its
    // execution context or its module docs.
    const client = new Y.Doc()
    let replaced = 0
    new DistributedProject(client).observeServerSessionReplaced(() => (replaced += 1))
    sync(client, serverDoc('a'))

    const second = serverDoc('b')
    sync(client, second)
    expect(replaced).toBe(1)

    // Further syncs with the same session do not report it again.
    sync(client, second)
    expect(replaced).toBe(1)
  })

  test('the session ids the first sync brings are all the first session', () => {
    // A client that joins a doc which already met several sessions (another client pushed its
    // older ids into it) has not seen any replacement itself.
    const server = serverDoc('a')
    Y.applyUpdate(server, Y.encodeStateAsUpdate(serverDoc('b')))
    const client = new Y.Doc()
    let replaced = 0
    new DistributedProject(client).observeServerSessionReplaced(() => (replaced += 1))

    sync(client, server)

    expect(replaced).toBe(0)
  })

  test('the unsubscribe stops the reports', () => {
    const client = new Y.Doc()
    let replaced = 0
    const stop = new DistributedProject(client).observeServerSessionReplaced(() => (replaced += 1))
    sync(client, serverDoc('a'))
    stop()
    sync(client, serverDoc('b'))
    expect(replaced).toBe(0)
  })
})
