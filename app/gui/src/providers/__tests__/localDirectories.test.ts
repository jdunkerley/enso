/**
 * @file The local directories' one store (#182): what it loads from `localStorage` (the entry the two
 * stores it replaces both persisted, and the legacy root key), and that a change through the
 * settings' setters reaches `useLocalPaths`, which the drive's Local category reads, at once.
 */
import { mount } from '@vue/test-utils'
import { Path } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

/** The `localStorage` entry both former stores persisted, and this one does. */
const STORAGE_KEY = 'enso-local-directory'
/** Where `LocalStorage` kept the root directory before the persisted store. */
const LEGACY_ROOT_KEY = 'Enso::localRootDirectory'

/** The module, fresh: the store reads `localStorage` once, when it is created. */
async function importFresh() {
  vi.resetModules()
  return await import('../localDirectories')
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('the stored local directories', () => {
  test('load unchanged from the entry the former stores saved', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { localRootDirectory: '/saved/root', downloadDirectory: '/saved/downloads' },
        version: 1,
      }),
    )
    const { localPathsStore } = await importFresh()
    expect(localPathsStore.getState()).toMatchObject({
      localRootDirectory: '/saved/root',
      downloadDirectory: '/saved/downloads',
    })
  })

  test('start from the legacy root key when nothing newer is saved', async () => {
    localStorage.setItem(LEGACY_ROOT_KEY, JSON.stringify('/legacy/root'))
    const { localPathsStore } = await importFresh()
    expect(localPathsStore.getState()).toMatchObject({
      localRootDirectory: '/legacy/root',
      downloadDirectory: null,
    })
  })

  test('prefer the saved entry to the legacy root key', async () => {
    localStorage.setItem(LEGACY_ROOT_KEY, JSON.stringify('/legacy/root'))
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { localRootDirectory: '/saved/root' }, version: 1 }),
    )
    const { localPathsStore } = await importFresh()
    expect(localPathsStore.getState().localRootDirectory).toBe('/saved/root')
  })

  test('default to nothing', async () => {
    const { localPathsStore } = await importFresh()
    expect(localPathsStore.getState()).toMatchObject({
      localRootDirectory: null,
      downloadDirectory: null,
    })
  })

  test('save a change in the same entry and format', async () => {
    const { setLocalRootDirectory, setDownloadDirectory } = await importFresh()
    setLocalRootDirectory(Path('/new/root'))
    setDownloadDirectory(Path('/new/downloads'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      state: { localRootDirectory: '/new/root', downloadDirectory: '/new/downloads' },
      version: 1,
    })
  })
})

describe('useLocalPaths', () => {
  test('follows a change through the setters at once, and defaults the download directory', async () => {
    const module = await importFresh()
    let paths: ReturnType<typeof module.useLocalPaths> | undefined
    const Probe = defineComponent({
      setup() {
        paths = module.useLocalPaths()
        return () => h('div')
      },
    })
    mount(Probe, { global: { provide: { defaultDownloadPath: Path('/default/downloads') } } })
    expect(paths?.localRootDirectory).toBeNull()
    expect(paths?.downloadDirectory).toBe('/default/downloads')

    module.setLocalRootDirectory(Path('/new/root'))
    module.setDownloadDirectory(Path('/new/downloads'))
    await nextTick()
    expect(paths?.localRootDirectory).toBe('/new/root')
    expect(paths?.downloadDirectory).toBe('/new/downloads')

    module.setLocalRootDirectory(null)
    module.setDownloadDirectory(null)
    await nextTick()
    expect(paths?.localRootDirectory).toBeNull()
    expect(paths?.downloadDirectory).toBe('/default/downloads')
  })
})
