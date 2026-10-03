/**
 * @file The settings page's Local tab writes both directories through the store the drive's Local
 * category reads (`useLocalPaths`), so a change shows there at once (#182): by editing the path, by
 * browsing for a folder, and by resetting it to the default.
 */
import { localPathsStore, useLocalPaths } from '$/providers/localDirectories'
import type * as QueryParamsModule from '$/providers/queryParams'
import { useText } from '$/providers/text'
import LocalStorage from '$/utils/LocalStorage'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { Path, Plan, type User } from 'enso-common/src/services/Backend'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { z } from 'zod'
import SettingsPage from '../SettingsPage.vue'
import { required } from './dom'

const USER = { name: 'user name', email: 'user@example.com', plan: Plan.solo } as User
const DEFAULT_ROOT = Path('/projects')
const DEFAULT_DOWNLOADS = Path('/downloads')

vi.mock('$/providers/auth', () => ({
  useAuth: () => ({
    session: {
      user: USER,
      email: USER.email,
      accessToken: `.${btoa(JSON.stringify({ username: USER.email }))}.`,
    },
  }),
}))
// The global store keeps the first router it sees; each test has its own.
vi.mock('$/providers/queryParams', async (importOriginal) => {
  const original = await importOriginal<typeof QueryParamsModule>()
  return { ...original, useQueryParams: () => original.createQueryParams() }
})
vi.mock('$/providers/session', () => ({ useSession: () => ({ changePassword: vi.fn() }) }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () =>
      mockBackends({
        remoteBackend: { getOrganization: vi.fn(() => Promise.resolve(null)) },
        localBackend: { rootPath: () => Path('/projects') },
      }),
  }
})
// The React tabs are not under test.
vi.mock('$/utils/react', () => ({ reactComponent: () => () => null }))

const { getText } = useText()
const openFileBrowser = vi.fn<() => Promise<string[]>>()

/** The settings page, beside what the drive's Local category reads. */
const PageAndLocalPaths = defineComponent({
  setup() {
    const paths = useLocalPaths()
    return () => [
      h(SettingsPage),
      h(
        'output',
        { 'data-testid': 'local-paths' },
        `${paths.localRootDirectory ?? DEFAULT_ROOT}|${paths.downloadDirectory}`,
      ),
    ]
  },
})

/** Open the Local tab. A new `window.api` is read by the buttons as they are created. */
async function openLocalTab() {
  await mountWithProviders(PageAndLocalPaths, {
    route: `/?${new URLSearchParams({ 'cloud-ide_SettingsTab': '"local"' }).toString()}`,
    global: { provide: { defaultDownloadPath: DEFAULT_DOWNLOADS } },
  })
  // The tab's content loads behind a suspense boundary.
  await vi.waitFor(() => input('localRootPathSettingsInput'))
}

const shownPaths = () => required(document.querySelector('[data-testid="local-paths"]')).textContent
const input = (labelId: 'downloadDirectorySettingsInput' | 'localRootPathSettingsInput') =>
  required(
    [...document.querySelectorAll<HTMLInputElement>('input')].find(
      (element) => element.labels?.[0]?.textContent.trim() === getText(labelId),
    ),
  )
const button = (name: string) =>
  required(
    [...document.querySelectorAll<HTMLElement>('button')].find(
      (element) => element.textContent.trim() === name,
    ),
  )

beforeAll(() => {
  // The React `App.tsx` registers it, which every page of the app loads first.
  LocalStorage.registerKey('preferredTimeZone', { schema: z.string() })
})

beforeEach(() => {
  localPathsStore.setState({ localRootDirectory: null, downloadDirectory: null })
  // Only the file browser: what the Browse buttons use, and what makes them show.
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fileBrowser: { openFileBrowser } },
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'api')
  openFileBrowser.mockReset()
})

describe('the Local settings tab', () => {
  test('a typed directory, once saved, reaches the local paths', async () => {
    await openLocalTab()
    expect(shownPaths()).toBe(`${DEFAULT_ROOT}|${DEFAULT_DOWNLOADS}`)
    const user = userEvent.setup()

    await user.clear(input('localRootPathSettingsInput'))
    await user.type(input('localRootPathSettingsInput'), '/typed/root')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(shownPaths()).toBe(`/typed/root|${DEFAULT_DOWNLOADS}`)

    await user.clear(input('downloadDirectorySettingsInput'))
    await user.type(input('downloadDirectorySettingsInput'), '/typed/downloads')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(shownPaths()).toBe('/typed/root|/typed/downloads')
    expect(localPathsStore.getState()).toMatchObject({
      localRootDirectory: '/typed/root',
      downloadDirectory: '/typed/downloads',
    })
  })

  test('a browsed-for directory reaches the local paths', async () => {
    await openLocalTab()
    const user = userEvent.setup()

    openFileBrowser.mockResolvedValueOnce(['/browsed/root'])
    await user.click(button(getText('browseForNewLocalRootDirectory')))
    await flushPromises()
    expect(openFileBrowser).toHaveBeenLastCalledWith('directory')
    expect(shownPaths()).toBe(`/browsed/root|${DEFAULT_DOWNLOADS}`)
    expect(input('localRootPathSettingsInput').value).toBe('/browsed/root')

    openFileBrowser.mockResolvedValueOnce(['/browsed/downloads'])
    await user.click(button(getText('browseForNewDownloadDirectory')))
    await flushPromises()
    expect(shownPaths()).toBe('/browsed/root|/browsed/downloads')
    expect(input('downloadDirectorySettingsInput').value).toBe('/browsed/downloads')
  })

  test('a reset returns both to their defaults in the local paths', async () => {
    localPathsStore.setState({
      localRootDirectory: Path('/saved/root'),
      downloadDirectory: Path('/saved/downloads'),
    })
    await openLocalTab()
    expect(shownPaths()).toBe('/saved/root|/saved/downloads')
    const user = userEvent.setup()

    await user.click(button(getText('resetLocalRootDirectory')))
    await flushPromises()
    expect(shownPaths()).toBe(`${DEFAULT_ROOT}|/saved/downloads`)
    expect(input('localRootPathSettingsInput').value).toBe(DEFAULT_ROOT)

    await user.click(button(getText('resetDownloadDirectory')))
    await flushPromises()
    expect(shownPaths()).toBe(`${DEFAULT_ROOT}|${DEFAULT_DOWNLOADS}`)
    expect(input('downloadDirectorySettingsInput').value).toBe(DEFAULT_DOWNLOADS)
  })
})
