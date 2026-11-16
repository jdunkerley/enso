import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ErrorCode, LsRpcError, RemoteRpcError } from 'ydoc-shared/languageServer'
import type { Event as LSEvent, Uuid } from 'ydoc-shared/languageServerTypes'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'
import { watchVisualizationFolder } from '../folderLoader'
import type { VisualizationMetadata } from '../metadata'
import { rootAddress, stylePathAttribute } from '../rootAddress'
import type { VisualizationModule } from '../runtimeTypes'

const ROOT = '6f9d2c1e-0000-4000-8000-000000000002' as Uuid
const OTHER_ROOT = '6f9d2c1e-0000-4000-8000-000000000003' as Uuid
const LIBRARY_MODULE = { kind: 'Library', name: 'Standard.Image' } as const
const IMAGE: VisualizationIdentifier = { module: LIBRARY_MODULE, name: 'Image' }

type Callback = (event: LSEvent<'file/event'>) => void
type Pending = { resolve: (viz: VisualizationModule) => void; reject: (error: unknown) => void }

function fileNotFound() {
  return Err(
    new LsRpcError(
      new RemoteRpcError({ code: ErrorCode.FILE_NOT_FOUND, message: 'no such folder' }),
      'file/acquireReceivesTreeUpdates',
      {},
    ),
  )
}

function setup(options: { quietIfMissing?: boolean; watchResult?: ReturnType<typeof Ok> } = {}) {
  let callback: Callback | undefined
  const unsubscribe = vi.fn()
  const ls = {
    watchFiles: vi.fn((_rootId: Uuid, _segments: string[], cb: Callback) => {
      callback = cb
      return { promise: Promise.resolve(options.watchResult ?? Ok()), unsubscribe }
    }),
  }
  // Compilations are settled by the test, in the order they were started.
  const pendingByAddress = new Map<string, Pending[]>()
  const compile = vi.fn(
    (address: string) =>
      new Promise<VisualizationModule>((resolve, reject) => {
        const pending = pendingByAddress.get(address) ?? []
        pending.push({ resolve, reject })
        pendingByAddress.set(address, pending)
      }),
  )
  const register =
    vi.fn<
      (
        id: VisualizationIdentifier,
        viz: Promise<VisualizationModule>,
        meta: VisualizationMetadata | undefined,
      ) => void
    >()
  const unregister = vi.fn<(id: VisualizationIdentifier) => void>()
  const watcher = watchVisualizationFolder({
    ls,
    rootId: ROOT,
    module: LIBRARY_MODULE,
    compile,
    register,
    unregister,
    quietIfMissing: options.quietIfMissing ?? true,
  })
  return {
    compile,
    register,
    unregister,
    watcher,
    unsubscribe,
    ls,
    emit(kind: LSEvent<'file/event'>['kind'], segments: string[], rootId: Uuid = ROOT) {
      callback!({ kind, path: { rootId, segments } })
    },
    /** Settle the oldest pending compilation of `file` in the visualizations folder. */
    finish(file: string, viz: Partial<VisualizationModule> | Error) {
      const address = rootAddress(ROOT, ['visualizations', file])
      const pending = pendingByAddress.get(address)?.shift()
      if (!pending) throw new Error(`Nothing is compiling '${address}'.`)
      if (viz instanceof Error) pending.reject(viz)
      else {
        pending.resolve({
          default: {},
          name: 'Image',
          inputType: 'Standard.Image.Image',
          ...viz,
        } as VisualizationModule)
      }
    },
    /** The registrations that carried metadata, i.e. those of completed compilations. */
    completed() {
      return register.mock.calls.filter(([, , meta]) => meta != null)
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  document.head.innerHTML = ''
})

test('it watches the visualizations folder of the root', () => {
  const { ls } = setup()
  expect(ls.watchFiles).toHaveBeenCalledWith(ROOT, ['visualizations'], expect.any(Function))
})

test('an added .vue file is compiled by address and registered with its metadata', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  expect(t.compile).toHaveBeenCalledWith(rootAddress(ROOT, ['visualizations', 'Image.vue']))
  t.finish('Image.vue', { name: 'Image', inputType: 'Standard.Image.Image' })
  await settle()
  expect(t.completed()).toEqual([
    [
      IMAGE,
      expect.any(Promise),
      { name: 'Image', inputType: 'Standard.Image.Image', dataType: undefined, icon: undefined },
    ],
  ])
})

test('a live event carries the whole root-relative path and reaches the same file', async () => {
  const t = setup()
  t.emit('Modified', ['visualizations', 'Image.vue'])
  expect(t.compile).toHaveBeenCalledWith(rootAddress(ROOT, ['visualizations', 'Image.vue']))
  t.finish('Image.vue', {})
  await settle()
  expect(t.completed().map(([id]) => id)).toEqual([IMAGE])
})

test('files that are not .vue, and events for other roots, are ignored', () => {
  const t = setup()
  t.emit('Added', ['helper.ts'])
  t.emit('Added', ['Image.vue'], OTHER_ROOT)
  expect(t.compile).not.toHaveBeenCalled()
  expect(t.register).not.toHaveBeenCalled()
})

test('a modified file is recompiled and registered again under the same id', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  t.finish('Image.vue', {})
  await settle()
  t.emit('Modified', ['Image.vue'])
  t.finish('Image.vue', {})
  await settle()
  expect(t.compile).toHaveBeenCalledTimes(2)
  expect(t.completed().map(([id]) => id)).toEqual([IMAGE, IMAGE])
  expect(t.unregister).not.toHaveBeenCalled()
})

test('when the name export changes the old id is unregistered and the new one registered', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  t.finish('Image.vue', { name: 'Image' })
  await settle()
  t.emit('Modified', ['Image.vue'])
  t.finish('Image.vue', { name: 'Picture' })
  await settle()
  expect(t.unregister).toHaveBeenCalledWith(IMAGE)
  expect(t.completed().at(-1)?.[0]).toEqual({ module: LIBRARY_MODULE, name: 'Picture' })
})

test('a removed file is unregistered', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  t.finish('Image.vue', {})
  await settle()
  t.emit('Removed', ['Image.vue'])
  expect(t.unregister).toHaveBeenCalledWith(IMAGE)
})

test("a removed file's style elements are removed", () => {
  const style = document.head.appendChild(document.createElement('style'))
  style.setAttribute(stylePathAttribute, rootAddress(ROOT, ['visualizations', 'Image.vue']))
  const t = setup()
  t.emit('Removed', ['Image.vue'])
  expect(document.head.contains(style)).toBe(false)
})

test('a second modification arriving before the first compiled wins', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  t.emit('Modified', ['Image.vue'])
  // The first compilation finishes while the second is still running: it is stale.
  t.finish('Image.vue', { name: 'Stale' })
  await settle()
  expect(t.completed()).toEqual([])
  t.finish('Image.vue', { name: 'Fresh' })
  await settle()
  expect(t.completed().map(([, , meta]) => meta?.name)).toEqual(['Fresh'])
})

test('a compilation that fails registers nothing and does not throw', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  t.finish('Image.vue', new Error('syntax error'))
  await settle()
  expect(t.completed()).toEqual([])
  expect(console.error).toHaveBeenCalled()
})

test('a failing recompilation of a registered file unregisters it', async () => {
  const t = setup()
  t.emit('Added', ['Image.vue'])
  t.finish('Image.vue', {})
  await settle()
  t.emit('Modified', ['Image.vue'])
  t.finish('Image.vue', new Error('syntax error'))
  await settle()
  expect(t.unregister).toHaveBeenCalledWith(IMAGE)
})

test('a missing folder is silent for a library', async () => {
  setup({ quietIfMissing: true, watchResult: fileNotFound() as never })
  await settle()
  expect(console.info).not.toHaveBeenCalled()
  expect(console.error).not.toHaveBeenCalled()
})

test('a missing folder in the project is logged', async () => {
  setup({ quietIfMissing: false, watchResult: fileNotFound() as never })
  await settle()
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining("'visualizations/' folder"))
})

test('unsubscribing stops the file watch', () => {
  const t = setup()
  t.watcher.unsubscribe()
  expect(t.unsubscribe).toHaveBeenCalled()
})
