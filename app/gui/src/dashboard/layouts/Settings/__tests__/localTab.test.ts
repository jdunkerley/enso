/**
 * @file The settings page's Local tab writes both directories through the store the drive's Local
 * category reads (`useLocalPaths`), so a change shows there at once (#182): by editing the path, by
 * browsing for a folder, and by resetting it to the default.
 */
import { doesSettingsEntryMatch, settingsQueryMatcher } from '$/configurations/settings'
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

const versioning = vi.hoisted(() => ({
  status: {
    git: true,
    repoRoot: null as string | null,
    enabled: false,
    optedOut: false,
    changed: false,
    blocked: null,
    lastVersion: null,
  },
  versioningStatus: vi.fn<(path: string) => Promise<unknown>>(),
  initVersioning: vi.fn<(path: string) => Promise<{ repoRoot: string }>>(),
  enableVersioning: vi.fn<(path: string) => Promise<void>>(),
  disableVersioning: vi.fn<(path: string) => Promise<void>>(),
  resetPrompts: vi.fn(),
}))

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
        localBackend: {
          rootPath: () => Path('/projects'),
          versioningStatus: (path: Path) => versioning.versioningStatus(path),
          initVersioning: (path: Path) => versioning.initVersioning(path),
          enableVersioning: (path: Path) => versioning.enableVersioning(path),
          disableVersioning: (path: Path) => versioning.disableVersioning(path),
        },
      }),
  }
})

vi.mock('$/providers/localVersioning', () => ({
  useLocalVersioning: () => ({ resetPrompts: versioning.resetPrompts }),
}))

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
const input = (
  labelId:
    'downloadDirectorySettingsInput' | 'localRootPathSettingsInput' | 'mapboxTokenSettingsInput',
) =>
  required(
    [...document.querySelectorAll<HTMLInputElement>('input')].find((element) =>
      element.labels?.[0]?.textContent.trim().startsWith(getText(labelId)),
    ),
  )
const button = (name: string) =>
  required(
    [...document.querySelectorAll<HTMLElement>('button')].find(
      (element) => element.textContent.trim() === name,
    ),
  )

beforeAll(() => {
  // `App.vue` registers it, which every page of the app loads first.
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
  test('the Maps section saves the Mapbox token to the local store', async () => {
    const { mapboxSettingsStore } = await import('$/providers/mapboxToken')
    mapboxSettingsStore.setState({ accessToken: null })
    await openLocalTab()
    expect(document.body.textContent).toContain(getText('mapsSettingsSection'))
    expect(input('mapboxTokenSettingsInput').type).toBe('password')
    const user = userEvent.setup()
    await user.type(input('mapboxTokenSettingsInput'), ' pk.typed ')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(mapboxSettingsStore.getState().accessToken).toBe('pk.typed')
  })

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

/** The Versions section's text. */
const versionsSection = () =>
  required(document.querySelector('[data-testid="local-versions-section"]')).textContent

describe('the Versions section', () => {
  beforeEach(() => {
    versioning.status = {
      git: true,
      repoRoot: null,
      enabled: false,
      optedOut: false,
      changed: false,
      blocked: null,
      lastVersion: null,
    }
    versioning.versioningStatus
      .mockReset()
      .mockImplementation(() => Promise.resolve({ ...versioning.status }))
    versioning.initVersioning.mockReset().mockImplementation(() => {
      versioning.status = { ...versioning.status, repoRoot: '/projects', enabled: true }
      return Promise.resolve({ repoRoot: '/projects' })
    })
    versioning.enableVersioning.mockReset().mockImplementation(() => {
      versioning.status = { ...versioning.status, enabled: true, optedOut: false }
      return Promise.resolve()
    })
    versioning.disableVersioning.mockReset().mockImplementation(() => {
      versioning.status = { ...versioning.status, enabled: false, optedOut: true }
      return Promise.resolve()
    })
    versioning.resetPrompts.mockReset()
  })

  test('without a repository, Create makes one at the root', async () => {
    await openLocalTab()
    await vi.waitFor(() =>
      expect(versionsSection()).toContain('Your projects are not in a git repository.'),
    )
    await userEvent.setup().click(button('Create repository'))
    expect(versioning.initVersioning).toHaveBeenCalledWith('/projects')
    await vi.waitFor(() =>
      expect(versionsSection()).toContain('Versions are kept in the git repository at /projects.'),
    )
  })

  test('Stop turns versions off, and Use turns them on again', async () => {
    versioning.status = { ...versioning.status, repoRoot: '/projects', enabled: true }
    await openLocalTab()
    const user = userEvent.setup()
    await vi.waitFor(() => button('Stop keeping versions'))
    await user.click(button('Stop keeping versions'))
    expect(versioning.disableVersioning).toHaveBeenCalledWith('/projects')
    await vi.waitFor(() =>
      expect(versionsSection()).toContain(
        'Versions are turned off for the git repository at /projects.',
      ),
    )
    await user.click(button('Use this repository'))
    expect(versioning.enableVersioning).toHaveBeenCalledWith('/projects')
  })

  test('an existing repository that is not used offers Use', async () => {
    versioning.status = { ...versioning.status, repoRoot: '/home' }
    await openLocalTab()
    await vi.waitFor(() =>
      expect(versionsSection()).toContain(
        'Your projects are in the git repository at /home, but versions are not kept there.',
      ),
    )
    await userEvent.setup().click(button('Use this repository'))
    expect(versioning.enableVersioning).toHaveBeenCalledWith('/home')
  })

  test('without git it says so, and offers no button', async () => {
    versioning.status = { ...versioning.status, git: false }
    await openLocalTab()
    await vi.waitFor(() => expect(versionsSection()).toContain('Git was not found.'))
    expect(document.querySelector('[data-testid="local-versions-section"] button')).toBeNull()
  })

  test('while the status is read it says so', async () => {
    let answer!: (value: unknown) => void
    versioning.versioningStatus.mockReset().mockReturnValueOnce(new Promise((r) => (answer = r)))
    await openLocalTab()
    await vi.waitFor(() => expect(versionsSection()).toContain('Reading the versions status'))
    answer({ ...versioning.status })
    await vi.waitFor(() =>
      expect(versionsSection()).toContain('Your projects are not in a git repository.'),
    )
  })

  test('a failed read says why, and offers no button', async () => {
    versioning.versioningStatus.mockReset().mockRejectedValue(new Error('git timed out'))
    await openLocalTab()
    await vi.waitFor(() =>
      expect(versionsSection()).toContain('The versions status could not be read: git timed out'),
    )
    expect(document.querySelector('[data-testid="local-versions-section"] button')).toBeNull()
  })

  test(`Ask again resets the "Don't ask again" answers`, async () => {
    await openLocalTab()
    await vi.waitFor(() => button('Ask again'))
    await userEvent.setup().click(button('Ask again'))
    expect(versioning.resetPrompts).toHaveBeenCalledOnce()
  })

  test('the settings search finds the section by "git" and "repository"', () => {
    const entry = { type: 'custom', aliasesId: 'localVersionsSettingsCustomEntryAliases' } as const
    expect(doesSettingsEntryMatch(entry, settingsQueryMatcher('git'), getText)).toBe(true)
    expect(doesSettingsEntryMatch(entry, settingsQueryMatcher('repository'), getText)).toBe(true)
  })
})
