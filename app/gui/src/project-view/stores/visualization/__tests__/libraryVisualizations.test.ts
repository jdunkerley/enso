import { Ok } from 'enso-common/src/utilities/data/result'
import { ObservableV2 } from 'lib0/observable'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from 'vue'
import type { ContentRoot, Event as LSEvent, Uuid } from 'ydoc-shared/languageServerTypes'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

// The compiler runs in a worker, which these tests have no use for.
vi.mock('@/stores/visualization/compilerMessaging', () => ({
  compile: vi.fn(async () => ({
    default: {},
    name: 'Image',
    inputType: 'Standard.Image.Image',
    icon: 'image',
  })),
}))

import { LIBRARY_WAIT_MS, provideVisualizationStore } from '@/stores/visualization'
import { rootAddress } from '../rootAddress'

const PROJECT_ROOT = '6f9d2c1e-0000-4000-8000-0000000000a0' as Uuid
const LIBRARY_ROOT = '6f9d2c1e-0000-4000-8000-0000000000a1' as Uuid
const libraryRoot: ContentRoot = {
  type: 'Library',
  id: LIBRARY_ROOT,
  namespace: 'Standard',
  name: 'Image',
  version: '0.0.0-dev',
}
const IMAGE_LIBRARY_ID: VisualizationIdentifier = {
  module: { kind: 'Library', name: 'Standard.Image' },
  name: 'Image',
}
const OLD_IMAGE_ID: VisualizationIdentifier = { module: { kind: 'Builtin' }, name: 'Image' }

type FileCallback = (event: LSEvent<'file/event'>) => void

class FakeLanguageServer extends ObservableV2<{
  'file/rootAdded': (param: { root: ContentRoot }) => void
}> {
  isDisposed = false
  readonly watched = new Map<Uuid, FileCallback>()
  readonly unsubscribes: ReturnType<typeof vi.fn>[] = []
  readonly watchFiles = vi.fn((rootId: Uuid, _segments: string[], callback: FileCallback) => {
    this.watched.set(rootId, callback)
    const unsubscribe = vi.fn()
    this.unsubscribes.push(unsubscribe)
    return { promise: Promise.resolve(Ok()), unsubscribe }
  })
  constructor(readonly contentRoots: Promise<ContentRoot[]>) {
    super()
  }
  addRoot(root: ContentRoot) {
    this.emit('file/rootAdded', [{ root }])
  }
  fileEvent(rootId: Uuid, kind: LSEvent<'file/event'>['kind'], segments: string[]) {
    this.watched.get(rootId)?.({ kind, path: { rootId, segments } })
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function createStore(initialRoots: ContentRoot[] = []) {
  const ls = new FakeLanguageServer(
    Promise.resolve([{ type: 'Project', id: PROJECT_ROOT }, ...initialRoots]),
  )
  const project = {
    projectRootId: Promise.resolve(PROJECT_ROOT),
    lsRpcConnection: Object.assign(ls, {}),
    dataConnection: Promise.resolve({}),
  }
  let store!: ReturnType<typeof provideVisualizationStore>
  const app = createApp({
    setup() {
      store = provideVisualizationStore(project as never)
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { ls, store, app }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
})

test('the project folder and every library root present at the start are watched', async () => {
  const { ls } = createStore([libraryRoot])
  await settle()
  expect(ls.watchFiles).toHaveBeenCalledWith(PROJECT_ROOT, ['visualizations'], expect.any(Function))
  expect(ls.watchFiles).toHaveBeenCalledWith(LIBRARY_ROOT, ['visualizations'], expect.any(Function))
})

test('a library root added later starts a watch, once', async () => {
  const { ls } = createStore()
  await settle()
  expect(ls.watched.has(LIBRARY_ROOT)).toBe(false)
  ls.addRoot(libraryRoot)
  ls.addRoot(libraryRoot)
  await settle()
  expect(ls.watchFiles.mock.calls.filter(([root]) => root === LIBRARY_ROOT)).toHaveLength(1)
})

test('a library visualization requested before its root arrives resolves once it registers', async () => {
  const { ls, store } = createStore()
  await settle()
  const pending = store.get(IMAGE_LIBRARY_ID).value
  expect(pending).toBeInstanceOf(Promise)
  ls.addRoot(libraryRoot)
  await settle()
  ls.fileEvent(LIBRARY_ROOT, 'Added', ['Image.vue'])
  await expect(pending).resolves.toMatchObject({ name: 'Image' })
  // Later reads give the registered module.
  await expect(store.get(IMAGE_LIBRARY_ID).value).resolves.toMatchObject({ name: 'Image' })
})

test('a library visualization that never arrives is rejected after the wait', async () => {
  vi.useFakeTimers()
  const { store } = createStore()
  const pending = store.get(IMAGE_LIBRARY_ID).value
  const rejected = expect(pending).rejects.toThrow(
    "The library 'Standard.Image' has no visualization 'Image'.",
  )
  await vi.advanceTimersByTimeAsync(LIBRARY_WAIT_MS)
  await rejected
  // A later request waits afresh instead of keeping the rejection.
  expect(store.get(IMAGE_LIBRARY_ID).value).not.toBe(pending)
})

test('the old builtin Image id gives the library module and its icon', async () => {
  const { ls, store } = createStore([libraryRoot])
  await settle()
  const viz = store.get(OLD_IMAGE_ID).value
  ls.fileEvent(LIBRARY_ROOT, 'Added', ['Image.vue'])
  await expect(viz).resolves.toMatchObject({ name: 'Image' })
  expect(store.icon(OLD_IMAGE_ID)).toBe('image')
  expect(store.icon(IMAGE_LIBRARY_ID)).toBe('image')
})

test('the project watch compiles the project folder as the current project', async () => {
  const { compile } = await import('@/stores/visualization/compilerMessaging')
  const { ls, store } = createStore()
  await settle()
  ls.fileEvent(PROJECT_ROOT, 'Added', ['Mine.vue'])
  await settle()
  expect(compile).toHaveBeenCalledWith(
    rootAddress(PROJECT_ROOT, ['visualizations', 'Mine.vue']),
    expect.anything(),
  )
  const mine = { module: { kind: 'CurrentProject' }, name: 'Image' } as const
  await expect(store.get(mine).value).resolves.toMatchObject({ name: 'Image' })
})

test('unmounting the store stops every watch', async () => {
  const { ls, app } = createStore([libraryRoot])
  await settle()
  app.unmount()
  expect(ls.unsubscribes.length).toBeGreaterThanOrEqual(2)
  for (const unsubscribe of ls.unsubscribes) expect(unsubscribe).toHaveBeenCalled()
})
