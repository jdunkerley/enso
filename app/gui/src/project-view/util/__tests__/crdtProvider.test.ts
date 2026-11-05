import { expect, test, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { attachProvider } from '../crdt'

test('disposing a provider destroys it, and the providers of its subdocs', () => {
  // `disconnect` alone leaves y-websocket's check and resync intervals running, and they keep the
  // provider and its doc alive: every rebuilt project store leaked the previous one's docs (#593).
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const attached = attachProvider('ws://127.0.0.1:9', 'index', {}, doc, awareness)
  const subdoc = new Y.Doc()
  doc.getMap('modules').set('Main', subdoc)
  subdoc.load()
  const prototype = Object.getPrototypeOf(attached.provider)
  const original = prototype.destroy
  const destroyed: unknown[] = []
  const spy = vi.spyOn(prototype, 'destroy').mockImplementation(function (this: unknown) {
    destroyed.push(this)
    return original.call(this)
  })

  attached.dispose()

  spy.mockRestore()
  awareness.destroy()
  // The index doc's provider and the subdoc's.
  expect(destroyed).toContain(attached.provider)
  expect(destroyed).toHaveLength(2)
})
