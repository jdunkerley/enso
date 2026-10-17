import type { ProjectId } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  states: {
    openProject: vi.fn(),
    closeProject: vi.fn(),
    uploadHybridProject: vi.fn(),
  },
  versioning: {
    statusOf: vi.fn((_id: string): { enabled: boolean } | undefined => ({ enabled: true })),
    isStatusUnknown: vi.fn((_id: string) => false),
    setQuitting: vi.fn(),
  },
  onElectron: true,
  calls: [] as string[],
}))
vi.mock('../openedProjects/projectStates', () => ({ useProjectStates: () => mocks.states }))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => mocks.versioning }))
vi.mock('enso-common/src/utilities/detect', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isOnElectron: () => mocks.onElectron,
}))

import { createOpenedProjectsStore } from '../openedProjects'
import { QUIT_CLOSE_TIMEOUT_MS } from '../openedProjects/quit'

let beforeUnload: ((event: Event) => void) | undefined
let windowClose: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  mocks.calls.length = 0
  mocks.onElectron = true
  mocks.states.openProject.mockReset()
  mocks.states.uploadHybridProject.mockReset().mockResolvedValue(undefined)
  mocks.states.closeProject.mockReset().mockImplementation(async (state: { info: unknown }) => {
    mocks.calls.push('close')
    return { ok: true, value: { status: 'not-opened', info: state.info } }
  })
  mocks.versioning.statusOf.mockReset().mockReturnValue({ enabled: true })
  mocks.versioning.isStatusUnknown.mockReset().mockReturnValue(false)
  mocks.versioning.setQuitting.mockReset().mockImplementation((value: boolean) => {
    mocks.calls.push(`quitting ${value}`)
  })
  windowClose = vi.spyOn(window, 'close').mockImplementation(() => {})
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'beforeunload') beforeUnload = listener as (event: Event) => void
    else add(type, listener, options)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Let every pending promise chain run; no timer fires. */
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

async function storeWith(...infos: { mode: string; id: string; synced?: boolean }[]) {
  const store = createOpenedProjectsStore()
  const scopes = new Map<string, EffectScope>()
  for (const info of infos) {
    const scope = effectScope()
    scopes.set(info.id, scope)
    mocks.states.openProject.mockResolvedValueOnce({
      ok: true,
      value: { status: 'initialized', info, scope },
    })
    store.openProject({ title: info.id, ...info } as never)
    await settle()
    expect(store.get(info.id as ProjectId)?.state.status).toBe('initialized')
  }
  return { store, scopes }
}

function quit() {
  const event = new Event('beforeunload', { cancelable: true })
  beforeUnload!(event)
  return event
}

/** A promise and its `resolve`. */
function pending() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('quitting the app', () => {
  test('closes each versioned local project, without asking about a repository, then the window', async () => {
    const { store } = await storeWith({ mode: 'local', id: 'p1' })
    const event = quit()
    expect(event.defaultPrevented).toBe(true)
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    expect(store.closingOnAppExit.value).toBe(false)
    await settle()
    expect(windowClose).toHaveBeenCalledTimes(1)
    expect(mocks.calls).toEqual(['quitting true', 'close'])
    expect(mocks.states.closeProject.mock.calls[0]![1]).toEqual({ offer: false })
    expect(store.savingVersionsOnAppExit.value).toBe(false)
    expect(store.get('p1' as ProjectId)?.state.status).toBe('not-opened')
    // The second `beforeunload`, from `window.close()`, lets the window go.
    expect(quit().defaultPrevented).toBe(false)
  })

  test.each([
    ['whose status could not be read', true],
    ['whose status has not been read yet', false],
  ])('a local project %s is closed too', async (_name, unknown) => {
    mocks.versioning.statusOf.mockReturnValue(undefined)
    mocks.versioning.isStatusUnknown.mockReturnValue(unknown)
    const { store } = await storeWith({ mode: 'local', id: 'p1' })
    expect(quit().defaultPrevented).toBe(true)
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    await settle()
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
    expect(mocks.states.closeProject.mock.calls[0]![1]).toEqual({ offer: false })
    expect(windowClose).toHaveBeenCalledTimes(1)
  })

  test('a local project known not to keep versions does not hold the quit', async () => {
    mocks.versioning.statusOf.mockReturnValue({ enabled: false })
    const { scopes } = await storeWith({ mode: 'local', id: 'p1' })
    expect(quit().defaultPrevented).toBe(false)
    expect(mocks.states.closeProject).not.toHaveBeenCalled()
    expect(mocks.versioning.setQuitting).not.toHaveBeenCalled()
    expect(scopes.get('p1')!.active).toBe(false)
  })

  test('in a browser nothing is held, and the projects are cleaned up', async () => {
    mocks.onElectron = false
    const { scopes } = await storeWith({ mode: 'local', id: 'p1' })
    expect(quit().defaultPrevented).toBe(false)
    await settle()
    expect(mocks.states.closeProject).not.toHaveBeenCalled()
    expect(mocks.versioning.setQuitting).not.toHaveBeenCalled()
    expect(scopes.get('p1')!.active).toBe(false)
  })

  test('a project that does not close holds the quit for the time limit, and only once', async () => {
    const { store } = await storeWith({ mode: 'local', id: 'p1' })
    mocks.states.closeProject.mockImplementation(() => new Promise(() => {}))
    expect(quit().defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(QUIT_CLOSE_TIMEOUT_MS - 1)
    expect(windowClose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(windowClose).toHaveBeenCalledTimes(1)
    expect(store.savingVersionsOnAppExit.value).toBe(false)
    expect(quit().defaultPrevented).toBe(false)
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
  })

  test('a failed close does not hold the quit again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await storeWith({ mode: 'local', id: 'p1' })
    mocks.states.closeProject.mockResolvedValue({ ok: false, error: { message: 'no' } })
    expect(quit().defaultPrevented).toBe(true)
    await settle()
    expect(windowClose).toHaveBeenCalledTimes(1)
    expect(quit().defaultPrevented).toBe(false)
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
  })

  test('quitting again while the projects close neither closes nor uploads twice', async () => {
    await storeWith({ mode: 'local', id: 'p1' }, { mode: 'hybrid', id: 'h1', synced: false })
    const upload = pending()
    mocks.states.uploadHybridProject.mockReturnValue(upload.promise)
    expect(quit().defaultPrevented).toBe(true)
    expect(quit().defaultPrevented).toBe(true)
    upload.resolve()
    await settle()
    expect(windowClose).toHaveBeenCalledTimes(1)
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
    expect(mocks.states.uploadHybridProject).toHaveBeenCalledTimes(1)
  })

  test('syncing and saving at once wait for each other, and say both', async () => {
    const { store } = await storeWith(
      { mode: 'local', id: 'p1' },
      { mode: 'hybrid', id: 'h1', synced: false },
    )
    const upload = pending()
    mocks.states.uploadHybridProject.mockReturnValue(upload.promise)
    quit()
    expect(store.closingOnAppExit.value).toBe(true)
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    await settle()
    expect(store.get('p1' as ProjectId)?.state.status).toBe('not-opened')
    expect(windowClose).not.toHaveBeenCalled()
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    upload.resolve()
    await settle()
    expect(windowClose).toHaveBeenCalledTimes(1)
    expect(store.closingOnAppExit.value).toBe(false)
    expect(store.savingVersionsOnAppExit.value).toBe(false)
  })

  test('a hybrid project in error keeps the window open, and repository questions come back', async () => {
    const { store } = await storeWith(
      { mode: 'hybrid', id: 'h1', synced: false },
      { mode: 'local', id: 'p1' },
    )
    store.get('h1' as ProjectId)!.error = new Error('offline')
    expect(quit().defaultPrevented).toBe(true)
    await settle()
    expect(mocks.versioning.setQuitting).toHaveBeenLastCalledWith(false)
    expect(windowClose).not.toHaveBeenCalled()
    expect(store.closingOnAppExit.value).toBe(false)
    expect(store.savingVersionsOnAppExit.value).toBe(false)
  })

  test('an upload that throws does not leave the dialog up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store } = await storeWith({ mode: 'hybrid', id: 'h1', synced: false })
    mocks.states.uploadHybridProject.mockRejectedValue(new Error('offline'))
    expect(quit().defaultPrevented).toBe(true)
    expect(store.closingOnAppExit.value).toBe(true)
    await settle()
    expect(store.closingOnAppExit.value).toBe(false)
    expect(windowClose).toHaveBeenCalledTimes(1)
  })
})
