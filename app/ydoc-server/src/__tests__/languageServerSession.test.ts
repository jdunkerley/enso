import type { Result } from 'enso-common/src/utilities/data/result'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { YjsChannel as Channel, type YjsChannel, type YjsChannelServer } from 'ydoc-channel'
import * as Ast from 'ydoc-shared/ast'
import { computeTextChecksum } from 'ydoc-shared/languageServer'
import { createModuleFlusher } from 'ydoc-shared/moduleFlusher'
import {
  encodeControlMessage,
  moduleState,
  parseControlMessage,
  YDOC_CONTROL_CHANNEL,
  type ModuleState,
} from 'ydoc-shared/ydocControl'
import type { ExternalId } from 'ydoc-shared/yjsModel'
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

/**
 * A Language Server with the modules `src/<name>` (each `content`, by default `MAIN`), that records edits and saves, and
 * lets a test hold edits or `file/info` back, or fail an edit or a save.
 */
function fakeLanguageServerWithModules(
  names: readonly string[] = ['Main.enso'],
  content: string = MAIN,
) {
  const saves: { path: string; currentVersion: string }[] = []
  const edits: { path: string; newVersion: string }[] = []
  const fileInfos: string[] = []
  const state = {
    modifiedTime: '2026-10-16T10:00:00Z',
    holdEdits: false,
    holdFileInfo: false,
    failNextSave: false,
    failNextEdit: false,
  }
  let releaseEdits: (() => void)[] = []
  let lastChannel: YjsChannel<string> | undefined
  const server: YjsChannelServer = {
    onConnect: (untypedChannel) => {
      const channel = untypedChannel as YjsChannel<string>
      channel.subscribe((raw) => {
        const message = JSON.parse(raw)
        if (typeof message.method !== 'string' || message.id == null) return
        lastChannel = channel
        const reply = (body: object) =>
          channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body }))
        const path = message.params?.path
        const where: string = path?.segments?.join('/') ?? ''
        switch (message.method) {
          case 'session/initProtocolConnection':
            return queueMicrotask(() =>
              reply({ result: { contentRoots: [{ type: 'Project', id: PROJECT_ROOT }] } }),
            )
          case 'file/list':
            return queueMicrotask(() =>
              reply({
                result: {
                  paths: names.map((name) => ({
                    type: 'File',
                    name,
                    path: { rootId: PROJECT_ROOT, segments: ['src'] },
                  })),
                },
              }),
            )
          case 'text/openFile':
            return queueMicrotask(() =>
              reply({
                result: {
                  writeCapability: { method: 'text/canEdit', registerOptions: { path } },
                  content,
                  currentVersion: computeTextChecksum(content),
                },
              }),
            )
          case 'file/info':
            fileInfos.push(where)
            if (state.holdFileInfo) return
            return queueMicrotask(() =>
              reply({
                result: {
                  attributes: {
                    creationTime: state.modifiedTime,
                    lastAccessTime: state.modifiedTime,
                    lastModifiedTime: state.modifiedTime,
                    kind: { type: 'File', name: path.segments.at(-1), path },
                    byteSize: content.length,
                  },
                },
              }),
            )
          case 'text/applyEdit': {
            edits.push({
              path: message.params.edit.path.segments.join('/'),
              newVersion: message.params.edit.newVersion,
            })
            if (state.failNextEdit) {
              state.failNextEdit = false
              return queueMicrotask(() =>
                reply({ error: { code: 3003, message: 'invalid version' } }),
              )
            }
            const answer = () => reply({ result: null })
            if (state.holdEdits) releaseEdits.push(answer)
            else queueMicrotask(answer)
            return
          }
          case 'text/save': {
            saves.push({ path: where, currentVersion: message.params.currentVersion })
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
  /** Send a notification, as the Language Server does, on the session's connection. */
  const notify = (method: string, params: object) =>
    lastChannel!.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  return { server, saves, edits, fileInfos, state, release, notify }
}

/**
 * A GUI: a copy of each module doc (with the same guid, as a subdoc has), whose updates the test
 * delivers when it chooses.
 */
async function openWithGui(
  url: string,
  ls: ReturnType<typeof fakeLanguageServerWithModules>,
  names: readonly string[] = ['Main.enso'],
) {
  const session = LanguageServerSession.get(
    url,
    ls.server,
    noChannels,
    noChannels,
    {} as JavaByteBufferClass,
  )
  const undelivered: [Y.Doc, Uint8Array][] = []
  const guiDocs = new Map<string, Y.Doc>()
  for (const name of names) {
    await vi.waitFor(() => expect(session.model.modules.get(name)).toBeDefined())
    const serverDoc = session.model.modules.get(name)!
    await vi.waitFor(() => expect(new Ast.MutableModule(serverDoc).root()).toBeDefined())
    const guiDoc = new Y.Doc({ guid: serverDoc.guid })
    Y.applyUpdate(guiDoc, Y.encodeStateAsUpdate(serverDoc))
    guiDoc.on('update', (update: Uint8Array) => undelivered.push([serverDoc, update]))
    guiDocs.set(name, guiDoc)
  }
  const deliver = () => {
    for (const [serverDoc, update] of undelivered.splice(0)) Y.applyUpdate(serverDoc, update, 'gui')
  }
  // Made on the first request: two subscribers on one local doc would both consume a message
  // (the wire-contract test brings its own).
  let control: Channel<string> | undefined
  const answers: unknown[] = []
  const flushModules = (id: string, modules: Record<string, ModuleState>) => {
    if (control == null) {
      control = new Channel<string>(session.indexDoc.doc, YDOC_CONTROL_CHANNEL)
      control.subscribe((raw) => answers.push(parseControlMessage(raw)))
    }
    control.send(encodeControlMessage({ type: 'flush', id, modules }))
  }
  const flush = (id: string) =>
    flushModules(
      id,
      Object.fromEntries(Array.from(guiDocs.values(), (doc) => [doc.guid, moduleState(doc)])),
    )
  const guiDoc = guiDocs.get(names[0]!)!
  return { session, guiDoc, guiDocs, deliver, flush, flushModules, answers }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('flush', () => {
  let flushSession: LanguageServerSession | undefined
  afterEach(async () => {
    vi.restoreAllMocks()
    await flushSession?.release()
    flushSession = undefined
  })

  test('waits for the GUI’s last edit to arrive and reach the LS, then saves its version', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-waits', ls)
    flushSession = gui.session
    new Ast.MutableModule(gui.guiDoc).syncToCode('main = 2\n')
    ls.state.holdEdits = true
    gui.flush('one')
    await sleep(50)
    // The edit has not arrived: nothing is saved yet.
    expect(ls.saves).toEqual([])
    gui.deliver()
    await vi.waitFor(() => expect(ls.edits).toHaveLength(1))
    await sleep(50)
    // It has arrived, but the LS has not applied it: still nothing.
    expect(ls.saves).toEqual([])
    ls.release()
    await vi.waitFor(() => expect(gui.answers).toEqual([{ type: 'flushed', id: 'one', ok: true }]))
    expect(ls.saves).toEqual([{ path: 'src/Main.enso', currentVersion: ls.edits[0]!.newVersion }])
  })

  test('waits for a last edit that only deletes (it advances no clock)', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-delete-only', ls)
    flushSession = gui.session
    const root = new Ast.MutableModule(gui.guiDoc).root()!
    root.setNodeMetadata({ colorOverride: 'red' })
    gui.deliver()
    root.setNodeMetadata({ colorOverride: undefined })
    gui.flush('delete')
    await sleep(50)
    // Only the deletion is missing, and the state vector cannot show it: nothing is saved yet.
    expect(ls.saves).toEqual([])
    gui.deliver()
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([{ type: 'flushed', id: 'delete', ok: true }]),
    )
    expect(ls.saves).toHaveLength(1)
  })

  test('declines when the file changed on disk, and saves nothing', async () => {
    const ls = fakeLanguageServerWithModules()
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

  test('a `text/autoSave` refreshes the recorded disk time, so a later flush saves', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-after-autosave', ls)
    flushSession = gui.session
    await vi.waitFor(() => expect(ls.fileInfos).toHaveLength(1))
    ls.state.modifiedTime = '2026-10-16T11:00:00Z'
    ls.notify('text/autoSave', { path: { rootId: PROJECT_ROOT, segments: ['src', 'Main.enso'] } })
    await vi.waitFor(() => expect(ls.fileInfos).toHaveLength(2))
    gui.flush('autosaved')
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([{ type: 'flushed', id: 'autosaved', ok: true }]),
    )
    expect(ls.saves).toHaveLength(1)
  })

  test('a failed save is reported, and retried once after the auto-save delay', async () => {
    ModulePersistence.SAVE_RETRY_MS = 50
    try {
      const ls = fakeLanguageServerWithModules()
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

  test('an edit that never arrives fails the flush at the deadline', async () => {
    ModulePersistence.FLUSH_DEADLINE_MS = 100
    try {
      const ls = fakeLanguageServerWithModules()
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
      ModulePersistence.FLUSH_DEADLINE_MS = 4_000
    }
  })

  test('one deadline bounds the whole flush, Language Server requests included', async () => {
    ModulePersistence.FLUSH_DEADLINE_MS = 200
    try {
      const ls = fakeLanguageServerWithModules()
      const gui = await openWithGui('ws://flush-slow-ls', ls)
      flushSession = gui.session
      // The open's own `file/info` has been answered: only the flush's is held.
      await vi.waitFor(() => expect(ls.fileInfos).toHaveLength(1))
      await sleep(10)
      ls.state.holdFileInfo = true
      const started = Date.now()
      gui.flush('slow')
      await vi.waitFor(() =>
        expect(gui.answers).toEqual([
          {
            type: 'flushed',
            id: 'slow',
            ok: false,
            error: expect.stringContaining('did not describe src/Main.enso in time'),
          },
        ]),
      )
      expect(Date.now() - started).toBeLessThan(600)
      expect(ls.saves).toEqual([])
    } finally {
      ModulePersistence.FLUSH_DEADLINE_MS = 4_000
    }
  })

  test('an edit the Language Server rejected fails the flush, though the reload resyncs', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-dropped-edit', ls)
    flushSession = gui.session
    new Ast.MutableModule(gui.guiDoc).syncToCode('main = 4\n')
    ls.state.failNextEdit = true
    gui.flush('dropped')
    gui.deliver()
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([
        {
          type: 'flushed',
          id: 'dropped',
          ok: false,
          error: expect.stringContaining('could not be applied'),
        },
      ]),
    )
    expect(ls.saves).toEqual([])
  })

  test('saves every module named', async () => {
    const names = ['Main.enso', 'Other.enso']
    const ls = fakeLanguageServerWithModules(names)
    const gui = await openWithGui('ws://flush-many', ls, names)
    flushSession = gui.session
    new Ast.MutableModule(gui.guiDocs.get('Main.enso')!).syncToCode('main = 5\n')
    new Ast.MutableModule(gui.guiDocs.get('Other.enso')!).syncToCode('main = 6\n')
    gui.deliver()
    gui.flush('many')
    await vi.waitFor(() => expect(gui.answers).toEqual([{ type: 'flushed', id: 'many', ok: true }]))
    expect(ls.saves.map((save) => save.path).sort()).toEqual(['src/Main.enso', 'src/Other.enso'])
  })

  test('a module the session does not know is skipped', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-unknown', ls)
    flushSession = gui.session
    gui.flushModules('unknown', { 'no-such-guid': moduleState(new Y.Doc()) })
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([{ type: 'flushed', id: 'unknown', ok: true }]),
    )
    expect(ls.saves).toEqual([])
  })

  test('a flush that throws is answered as a failure', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-throws', ls)
    flushSession = gui.session
    vi.spyOn(gui.session, 'flush').mockRejectedValue(new Error('boom'))
    gui.flush('throws')
    await vi.waitFor(() =>
      expect(gui.answers).toEqual([
        { type: 'flushed', id: 'throws', ok: false, error: expect.stringContaining('boom') },
      ]),
    )
  })

  test('the wire contract: the GUI’s flusher against the session', async () => {
    const ls = fakeLanguageServerWithModules()
    const gui = await openWithGui('ws://flush-wire', ls)
    flushSession = gui.session
    const flusher = createModuleFlusher(gui.session.indexDoc.doc, () => [gui.guiDoc])
    try {
      new Ast.MutableModule(gui.guiDoc).syncToCode('main = 7\n')
      gui.deliver()
      expect(await flusher.flush()).toEqual({ kind: 'flushed' })
      expect(ls.saves).toEqual([
        { path: 'src/Main.enso', currentVersion: ls.edits.at(-1)!.newVersion },
      ])
      ls.state.modifiedTime = '2026-10-16T12:00:00Z'
      expect(await flusher.flush()).toEqual({
        kind: 'declined',
        reason: expect.stringContaining('changed on disk'),
      })
    } finally {
      flusher.close()
    }
  })
})

/** The new-project template, as the Project Manager copies it into every new project. */
const TEMPLATE_MAIN = fileURLToPath(
  new URL('../../../../lib/scala/pkg/src/main/resources/default/src/Main.enso', import.meta.url),
)
/** The id the template's idMap gives the welcome node, `Data.read Examples.welcome`. */
const WELCOME_NODE = 'fcf199e6-d2b1-44b7-be92-a47545d6a593' as ExternalId

describe('the new-project template', () => {
  let templateSession: LanguageServerSession | undefined
  afterEach(async () => {
    await templateSession?.release()
    templateSession = undefined
  })

  // The idMap's spans are resolved against the code in the metadata's `snapshot` whenever that
  // differs from the file's code, so a template whose code changes without a regenerated
  // snapshot loses the welcome node's id, and with it the open visualization the getting-started
  // tests wait for (#482).
  test('opens with the welcome node’s id and its visualization shown', async () => {
    const template = readFileSync(TEMPLATE_MAIN, 'utf8')
    const ls = fakeLanguageServerWithModules(['Main.enso'], template)
    const gui = await openWithGui('ws://new-project-template', ls)
    templateSession = gui.session
    const module = new Ast.MutableModule(gui.session.model.modules.get('Main.enso')!)
    let welcome: Ast.Ast | undefined
    Ast.visitRecursive(module.root()!, (ast) => {
      if (ast.externalId === WELCOME_NODE) welcome ??= ast
    })
    expect(welcome?.code()).toBe('Data.read Examples.welcome')
    expect(welcome?.nodeMetadata.get('visualization')?.visible).toBe(true)
  })
})
