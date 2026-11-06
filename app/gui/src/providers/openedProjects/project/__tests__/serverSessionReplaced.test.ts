/**
 * @file A project store whose ydoc server session is replaced (the ydoc host restarted, or the
 * engine it ran in) asks for its project's stores to be made again, and the store made then
 * initializes a Language Server session and creates an execution context (#593).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { YjsChannel } from 'ydoc-channel'
import { DistributedProject } from 'ydoc-shared/yjsModel'
import * as Y from 'yjs'

/** A ydoc server session: its index doc, marked with its id, and the requests it was sent. */
interface FakeSession {
  doc: Y.Doc
  requests: { ls: string; method: string }[]
}

function fakeSession(id: string): FakeSession {
  const doc = new Y.Doc()
  new DistributedProject(doc).markServerSession(id)
  return { doc, requests: [] }
}

const mocks = vi.hoisted(() => ({
  current: undefined as FakeSession | undefined,
  reconnectProject: vi.fn(),
  docs: [] as Y.Doc[],
}))

/**
 * Answer the Language Server requests that arrive on the `ls` channel of the session, as the
 * proxy socket to a Language Server would.
 */
function serveLanguageServer(session: FakeSession, ls: string) {
  const channel = new YjsChannel<string>(session.doc, ls)
  channel.subscribe((raw) => {
    const message = JSON.parse(raw)
    if (typeof message.method !== 'string' || message.id == null) return
    session.requests.push({ ls, method: message.method })
    const result =
      message.method === 'session/initProtocolConnection' ?
        { contentRoots: [{ type: 'Project', id: '00000000-0000-0000-0000-0000000000aa' }] }
      : message.method === 'executionContext/create' ?
        {
          contextId: message.params.contextId,
          canModify: { method: 'canModify', registerOptions: {} },
          receivesUpdates: { method: 'receivesUpdates', registerOptions: {} },
        }
      : null
    queueMicrotask(() => channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })))
  })
}

/** Stands in for y-websocket: keeps the client's index doc in sync with the current session's. */
vi.mock('@/util/crdt', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  attachProvider: (_url: string, _room: string, params: { ls: string }, doc: Y.Doc) => {
    const session = mocks.current!
    mocks.docs.push(doc)
    serveLanguageServer(session, params.ls)
    const toServer = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'server') Y.applyUpdate(session.doc, update, 'client')
    }
    const toClient = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'client') Y.applyUpdate(doc, update, 'server')
    }
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(doc), 'client')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(session.doc), 'server')
    doc.on('update', toServer)
    session.doc.on('update', toClient)
    return {
      provider: { wsconnected: true, synced: true },
      dispose: () => {
        doc.off('update', toServer)
        session.doc.off('update', toClient)
      },
    }
  },
}))
vi.mock('$/providers/openedProjects', () => ({
  useOpenedProjects: () => ({ reconnectProject: mocks.reconnectProject }),
}))
vi.mock('$/providers/text', () => ({ useText: () => ({ getText: (key: string) => key }) }))

import { createProjectNameStore } from '../../projectNames'
import { createProjectStore } from '../project'

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  mocks.reconnectProject.mockReset()
})

function openStore() {
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() =>
    createProjectStore(
      {
        projectId: 'project' as never,
        projectAssetId: 'project-asset' as never,
        engine: { rpcUrl: 'ws://127.0.0.1:30616', ydocUrl: 'ws://127.0.0.1:30617' },
      },
      createProjectNameStore({
        projectNamespace: 'local',
        projectDisplayedName: () => 'Project',
        projectInitialName: 'Project',
      }),
    ),
  )
  return scope
}

const methods = (session: FakeSession) => session.requests.map((r) => r.method)

describe('a project store whose ydoc server session is replaced', () => {
  test('is made again, and the new store initializes a session and creates an execution context', async () => {
    const first = fakeSession('first')
    mocks.current = first
    const firstScope = openStore()
    await vi.waitFor(() => expect(methods(first)).toContain('executionContext/create'))
    expect(methods(first)).toContain('session/initProtocolConnection')

    // The owner of the stores makes them again in a new scope when asked (`reconnectProject`).
    mocks.reconnectProject.mockImplementation(() => {
      firstScope.stop()
      openStore()
    })

    // The ydoc host restarted: the client's index doc reconnects to a new session.
    const second = fakeSession('second')
    mocks.current = second
    // What the restored listener does when the client's socket comes back: the two docs sync.
    Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc), 'client')
    Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc), 'server')

    await vi.waitFor(() => expect(mocks.reconnectProject).toHaveBeenCalledWith('project-asset'))
    await vi.waitFor(() => expect(methods(second)).toContain('executionContext/create'))
    expect(methods(second)).toContain('session/initProtocolConnection')
    expect(mocks.reconnectProject).toHaveBeenCalledTimes(1)
  })

  test('is not made again while it keeps its session', async () => {
    const only = fakeSession('only')
    mocks.current = only
    openStore()
    await vi.waitFor(() => expect(methods(only)).toContain('executionContext/create'))
    // A later sync with the same session brings nothing new.
    Y.applyUpdate(only.doc, new Uint8Array([0, 0]), 'client')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.reconnectProject).not.toHaveBeenCalled()
  })

  test('a store is gone with its scope: its index doc is destroyed', async () => {
    // Each rebuild must not keep the previous store's docs alive (the old providers' intervals held
    // them).
    mocks.docs.length = 0
    const session = fakeSession('one')
    mocks.current = session
    const scope = openStore()
    await vi.waitFor(() => expect(methods(session)).toContain('executionContext/create'))
    const doc = mocks.docs[0]!
    expect(doc.isDestroyed).toBe(false)
    scope.stop()
    await vi.waitFor(() => expect(doc.isDestroyed).toBe(true))
  })

  test('a replacement noticed just before the store is disposed asks for nothing', async () => {
    const first = fakeSession('before')
    mocks.current = first
    const scope = openStore()
    await vi.waitFor(() => expect(methods(first)).toContain('executionContext/create'))
    const second = fakeSession('after')
    Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc), 'server')
    // The rebuild is deferred to the next tick; the store goes first.
    scope.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.reconnectProject).not.toHaveBeenCalled()
  })
})
