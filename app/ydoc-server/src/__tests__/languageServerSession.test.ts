import type { Result } from 'enso-common/src/utilities/data/result'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { YjsChannel as Channel, type YjsChannel, type YjsChannelServer } from 'ydoc-channel'
import * as Ast from 'ydoc-shared/ast'
import { computeTextChecksum } from 'ydoc-shared/languageServer'
import {
  encodeControlMessage,
  parseControlMessage,
  stateVectorEntries,
  YDOC_CONTROL_CHANNEL,
} from 'ydoc-shared/ydocControl'
import * as Y from 'yjs'
import { LanguageServerSession, ModulePersistence } from '../languageServerSession'
import type { JavaByteBufferClass } from '../YjsBinaryChannel'

// Polyfill DOM event types that are missing from some Node.js versions.
if (typeof globalThis.CloseEvent === 'undefined') {
  ;(globalThis as any).CloseEvent = class CloseEvent extends Event {}
}
if (typeof globalThis.MessageEvent === 'undefined') {
  ;(globalThis as any).MessageEvent = class MessageEvent extends Event {
    data: any
    constructor(type: string, options?: any) {
      super(type, options)
      this.data = options?.data
    }
  }
}
if (typeof globalThis.ErrorEvent === 'undefined') {
  ;(globalThis as any).ErrorEvent = class ErrorEvent extends Event {
    error: any
    message: string
    constructor(type: string, options?: any) {
      super(type, options)
      this.error = options?.error
      this.message = options?.message || ''
    }
  }
}

const PROJECT_ROOT = '00000000-0000-0000-0000-0000000000aa'

/**
 * Stands in for the Language Server's JSON-RPC channel callbacks (`YdocJsonRpcServer.ServerCallbacks`):
 * every channel it is handed becomes a numbered connection, and every request is answered on the
 * connection it arrived on.
 */
function fakeLanguageServer() {
  const requests: { connection: number; method: string }[] = []
  let connections = 0
  const server: YjsChannelServer = {
    onConnect: (untypedChannel) => {
      const channel = untypedChannel as YjsChannel<string>
      const connection = connections++
      channel.subscribe((raw) => {
        const message = JSON.parse(raw)
        if (typeof message.method !== 'string' || message.id == null) return
        requests.push({ connection, method: message.method })
        const result =
          message.method === 'session/initProtocolConnection' ?
            { contentRoots: [{ type: 'Project', id: PROJECT_ROOT }] }
          : message.method === 'file/list' ? { paths: [] }
          : null
        queueMicrotask(() =>
          channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })),
        )
      })
    },
  }
  return { server, requests, connections: () => connections }
}

const noChannels: YjsChannelServer<any> = { onConnect: () => {} }

describe('LanguageServerSession', () => {
  let session: LanguageServerSession | undefined

  afterEach(async () => {
    await session?.release()
    session = undefined
  })

  test('restarting the client re-reads the initial state over a new connection', async () => {
    const ls = fakeLanguageServer()
    session = LanguageServerSession.get(
      'ws://restart-test',
      ls.server,
      noChannels,
      noChannels,
      {} as JavaByteBufferClass,
    )
    await vi.waitFor(() => expect(ls.requests.map((r) => r.method)).toContain('file/list'))
    const connectionsBefore = ls.connections()
    const requestsBefore = ls.requests.length

    // `restartClient` is what the session does when handling a Language Server event fails.
    const restartClient = (session as any).restartClient.bind(session) as () => Promise<
      Result<void>
    >
    const result = await restartClient()
    expect(result.ok).toBe(true)

    const afterRestart = ls.requests.slice(requestsBefore)
    expect(afterRestart.map((r) => r.method)).toEqual(
      expect.arrayContaining(['session/initProtocolConnection', 'file/list']),
    )
    // Only the connection made by the restart serves requests; the earlier ones are closed.
    expect(ls.connections()).toBeGreaterThan(connectionsBefore)
    for (const request of afterRestart) {
      expect(request.connection).toBeGreaterThanOrEqual(connectionsBefore)
    }
  })
})

const MAIN = 'main = 1\n'

/** A Language Server with one module, `src/Main.enso`, that records saves. */
function fakeLanguageServerWithModule() {
  const saves: { currentVersion: string }[] = []
  const edits: { newVersion: string }[] = []
  const state = { modifiedTime: '2026-10-16T10:00:00Z', holdEdits: false, failNextSave: false }
  let releaseEdits: (() => void)[] = []
  const server: YjsChannelServer = {
    onConnect: (untypedChannel) => {
      const channel = untypedChannel as YjsChannel<string>
      channel.subscribe((raw) => {
        const message = JSON.parse(raw)
        if (typeof message.method !== 'string' || message.id == null) return
        const reply = (body: object) =>
          channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body }))
        const path = { rootId: PROJECT_ROOT, segments: ['src', 'Main.enso'] }
        switch (message.method) {
          case 'session/initProtocolConnection':
            return queueMicrotask(() =>
              reply({ result: { contentRoots: [{ type: 'Project', id: PROJECT_ROOT }] } }),
            )
          case 'file/list':
            return queueMicrotask(() =>
              reply({
                result: {
                  paths: [
                    {
                      type: 'File',
                      name: 'Main.enso',
                      path: { rootId: PROJECT_ROOT, segments: ['src'] },
                    },
                  ],
                },
              }),
            )
          case 'text/openFile':
            return queueMicrotask(() =>
              reply({
                result: {
                  writeCapability: { method: 'text/canEdit', registerOptions: { path } },
                  content: MAIN,
                  currentVersion: computeTextChecksum(MAIN),
                },
              }),
            )
          case 'file/info':
            return queueMicrotask(() =>
              reply({
                result: {
                  attributes: {
                    creationTime: state.modifiedTime,
                    lastAccessTime: state.modifiedTime,
                    lastModifiedTime: state.modifiedTime,
                    kind: { type: 'File', name: 'Main.enso', path },
                    byteSize: MAIN.length,
                  },
                },
              }),
            )
          case 'text/applyEdit': {
            edits.push({ newVersion: message.params.edit.newVersion })
            const answer = () => reply({ result: null })
            if (state.holdEdits) releaseEdits.push(answer)
            else queueMicrotask(answer)
            return
          }
          case 'text/save': {
            saves.push({ currentVersion: message.params.currentVersion })
            if (state.failNextSave) {
              state.failNextSave = false
              return queueMicrotask(() => reply({ error: { code: 1000, message: 'disk full' } }))
            }
            return queueMicrotask(() => reply({ result: null }))
          }
          default:
            return queueMicrotask(() => reply({ result: null }))
        }
      })
    },
  }
  const release = () => {
    for (const answer of releaseEdits) answer()
    releaseEdits = []
  }
  return { server, saves, edits, state, release }
}

/** A GUI: a copy of the module doc, whose updates the test delivers when it chooses. */
async function openWithGui(url: string, ls: ReturnType<typeof fakeLanguageServerWithModule>) {
  const session = LanguageServerSession.get(
    url,
    ls.server,
    noChannels,
    noChannels,
    {} as JavaByteBufferClass,
  )
  await vi.waitFor(() => expect(session.model.modules.get('Main.enso')).toBeDefined())
  const serverDoc = session.model.modules.get('Main.enso')!
  await vi.waitFor(() => expect(new Ast.MutableModule(serverDoc).root()).toBeDefined())
  const guiDoc = new Y.Doc()
  Y.applyUpdate(guiDoc, Y.encodeStateAsUpdate(serverDoc))
  const undelivered: Uint8Array[] = []
  guiDoc.on('update', (update: Uint8Array) => undelivered.push(update))
  const deliver = () => {
    for (const update of undelivered.splice(0)) Y.applyUpdate(serverDoc, update, 'gui')
  }
  const control = new Channel<string>(session.indexDoc.doc, YDOC_CONTROL_CHANNEL)
  const answers: unknown[] = []
  control.subscribe((raw) => answers.push(parseControlMessage(raw)))
  const flush = (id: string) =>
    control.send(
      encodeControlMessage({
        type: 'flush',
        id,
        modules: { [serverDoc.guid]: stateVectorEntries(guiDoc) },
      }),
    )
  return { session, guiDoc, deliver, flush, answers }
}

describe('flush', () => {
  let flushSession: LanguageServerSession | undefined
  afterEach(async () => {
    await flushSession?.release()
    flushSession = undefined
  })

  test('waits for the GUI’s last edit to arrive and reach the LS, then saves its version', async () => {
    const ls = fakeLanguageServerWithModule()
    const gui = await openWithGui('ws://flush-waits', ls)
    flushSession = gui.session
    new Ast.MutableModule(gui.guiDoc).syncToCode('main = 2\n')
    ls.state.holdEdits = true
    gui.flush('one')
    await new Promise((resolve) => setTimeout(resolve, 50))
    // The edit has not arrived: nothing is saved yet.
    expect(ls.saves).toEqual([])
    gui.deliver()
    await vi.waitFor(() => expect(ls.edits).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    // It has arrived, but the LS has not applied it: still nothing.
    expect(ls.saves).toEqual([])
    ls.release()
    await vi.waitFor(() => expect(gui.answers).toEqual([{ type: 'flushed', id: 'one', ok: true }]))
    expect(ls.saves).toEqual([{ currentVersion: ls.edits[0]!.newVersion }])
  })

  test('declines when the file changed on disk, and saves nothing', async () => {
    const ls = fakeLanguageServerWithModule()
    const gui = await openWithGui('ws://flush-declines', ls)
    flushSession = gui.session
    ls.state.modifiedTime = '2026-10-16T11:00:00Z'
    gui.flush('two')
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([
        {
          type: 'flushed',
          id: 'two',
          ok: false,
          error: expect.stringContaining('changed on disk'),
        },
      ]),
    )
    expect(ls.saves).toEqual([])
  })

  test('a failed save is reported, and retried once after the auto-save delay', async () => {
    ModulePersistence.SAVE_RETRY_MS = 50
    try {
      const ls = fakeLanguageServerWithModule()
      const gui = await openWithGui('ws://flush-retries', ls)
      flushSession = gui.session
      ls.state.failNextSave = true
      gui.flush('three')
      await vi.waitFor(() =>
        expect(gui.answers).toEqual([
          { type: 'flushed', id: 'three', ok: false, error: expect.stringContaining('disk full') },
        ]),
      )
      await vi.waitFor(() => expect(ls.saves).toHaveLength(2))
    } finally {
      ModulePersistence.SAVE_RETRY_MS = 6_000
    }
  })

  test('an edit that never arrives fails the flush after the wait', async () => {
    ModulePersistence.FLUSH_WAIT_MS = 100
    try {
      const ls = fakeLanguageServerWithModule()
      const gui = await openWithGui('ws://flush-never', ls)
      flushSession = gui.session
      new Ast.MutableModule(gui.guiDoc).syncToCode('main = 3\n')
      gui.flush('four')
      await vi.waitFor(() =>
        expect(gui.answers).toEqual([
          {
            type: 'flushed',
            id: 'four',
            ok: false,
            error: expect.stringContaining('did not arrive'),
          },
        ]),
      )
      expect(ls.saves).toEqual([])
    } finally {
      ModulePersistence.FLUSH_WAIT_MS = 4_000
    }
  })
})
