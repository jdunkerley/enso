/**
 * @file The Vue version checker (#83), forced open as the devtools do (this build's version is not
 * a release one): "Remind me later" hides it; "Download" downloads, then it can be closed.
 */
import { useDevtoolsStore } from '$/providers/devTools'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { setIncludePrereleases } from '$/providers/updateSettings'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import VersionChecker from '$/versionChecker/VersionChecker.vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import type { UpdateStatus } from 'enso-common/src/updater'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isNewerRelease } from '../versionChecker'

const getLatestRelease = vi.fn<() => Promise<object | null>>(async () => ({
  // GitHub's field names.
  /* eslint-disable camelcase */
  tag_name: '2099.1.1',
  published_at: '2099-01-01T00:00:00Z',
  html_url: 'https://github.com/enso-org/enso/releases/tag/2099.1.1',
  assets: [],
  /* eslint-enable camelcase */
}))
const getDownloadUrl = vi.fn(async () => 'https://example.com/enso.exe')
vi.mock('$/utils/github', () => ({
  getLatestRelease: () => getLatestRelease(),
  getDownloadUrl: () => getDownloadUrl(),
  RELEASES_REPOSITORY: 'jdunkerley/enso',
}))
const openInNewBrowserTab = vi.fn()
vi.mock('$/utils/window', () => ({
  openInNewBrowserTab: (url: unknown) => openInNewBrowserTab(url),
}))
const download = vi.fn(async () => {})
vi.mock('$/utils/download', () => ({ download: (options: unknown) => download(options) }))

const { getText } = useText()

let portalRoot: HTMLElement
beforeEach(() => {
  setIncludePrereleases(false)
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  useDevtoolsStore().showVersionChecker = true
})
afterEach(() => {
  portalRoot.remove()
  useDevtoolsStore().showVersionChecker = false
})

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (name: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === name)

describe('VersionChecker', () => {
  test('shows the latest release; "Remind me later" hides it', async () => {
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(dialog()!.querySelector('h2')!.textContent!.trim()).toBe(getText('versionOutdatedTitle'))
    expect(dialog()!.textContent).toContain('2099.1.1')
    // Not dismissable before a choice: no close button.
    expect(button(getText('close'))).toBeUndefined()
    await userEvent.setup().click(button(getText('remindMeLater'))!)
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })

  test('"Download" downloads the app, then it can be closed', async () => {
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    const user = userEvent.setup()
    await user.click(button(getText('download'))!)
    await flushPromises()
    expect(download).toHaveBeenCalledWith({ url: 'https://example.com/enso.exe' })
    expect(dialog()!.textContent).toContain(getText('downloadingAppMessage'))
    const closeButtons = [...dialog()!.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === getText('close'),
    )
    await user.click(closeButtons.at(-1)!)
    await vi.waitFor(() => expect(useDevtoolsStore().showVersionChecker).toBe(false))
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })
})

function fakeUpdater(initial: UpdateStatus) {
  let listener: ((status: UpdateStatus) => void) | null = null
  const updater = {
    mode: vi.fn(async () => 'auto' as const),
    check: vi.fn(async () => initial),
    download: vi.fn(async () => {
      listener?.({ state: 'downloading', version: '2026.2.0', percent: 50 })
      listener?.({ state: 'ready', version: '2026.2.0' })
    }),
    quitAndInstall: vi.fn(async () => {}),
    onStatus: vi.fn((handler: (status: UpdateStatus) => void) => {
      listener = handler
      return () => (listener = null)
    }),
  }
  Object.assign(window, { api: { updater } })
  return updater
}

describe('automatic updates', () => {
  afterEach(() => Reflect.deleteProperty(window, 'api'))

  test('Update downloads, then Restart installs', async () => {
    const updater = fakeUpdater({
      state: 'available',
      version: '2026.2.0',
      releaseDate: '2026-11-01',
    })
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await userEvent.setup().click(button(getText('updateNow'))!)
    await vi.waitFor(() => expect(button(getText('restartToUpdate'))).not.toBeUndefined())
    await userEvent.setup().click(button(getText('restartToUpdate'))!)
    expect(updater.quitAndInstall).toHaveBeenCalled()
    expect(getDownloadUrl).not.toHaveBeenCalled()
  })

  test('passes the prerelease setting to the check', async () => {
    setIncludePrereleases(true)
    const updater = fakeUpdater({ state: 'none' })
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(updater.check).toHaveBeenCalledWith(true))
    expect(dialog()).toBeNull()
  })

  test('a reloaded window shows a download in progress, and a ready update', async () => {
    fakeUpdater({ state: 'downloading', version: '2026.2.0', percent: 30 })
    const wrapper = await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(dialog()!.querySelector('progress')).not.toBeNull()
    wrapper.unmount()
    await vi.waitFor(() => expect(dialog()).toBeNull())
    fakeUpdater({ state: 'ready', version: '2026.2.0' })
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(button(getText('restartToUpdate'))).not.toBeUndefined())
  })

  test('a failed download offers Retry and Download manually', async () => {
    const updater = fakeUpdater({ state: 'available', version: '2026.2.0', releaseDate: '' })
    updater.download.mockImplementation(async () => {})
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await userEvent.setup().click(button(getText('updateNow'))!)
    updater.onStatus.mock.calls[0]![0]({
      state: 'error',
      message: 'offline',
      version: '2026.2.0',
    })
    await vi.waitFor(() => expect(button(getText('retry'))).not.toBeUndefined())
    expect(button(getText('downloadManually'))).not.toBeUndefined()
  })
})

describe('automatic updates, in more detail', () => {
  afterEach(() => Reflect.deleteProperty(window, 'api'))
  const available = (version: string): UpdateStatus => ({
    state: 'available',
    version,
    releaseDate: '2026-11-01',
  })

  test('nothing downloads before the Update click', async () => {
    const updater = fakeUpdater(available('2026.2.0'))
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(updater.download).not.toHaveBeenCalled()
  })

  test('Later hides the dialog; a newer version shows it again', async () => {
    const updater = fakeUpdater(available('2026.2.0'))
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await userEvent.setup().click(button(getText('remindMeLater'))!)
    await vi.waitFor(() => expect(dialog()).toBeNull())
    const emit = updater.onStatus.mock.calls[0]![0]
    emit(available('2026.2.0'))
    await flushPromises()
    expect(dialog()).toBeNull()
    emit(available('2026.3.0'))
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(dialog()!.textContent).toContain('2026.3.0')
  })

  test('closing during the download reopens when it is ready', async () => {
    const updater = fakeUpdater({ state: 'downloading', version: '2026.2.0', percent: 10 })
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await userEvent
      .setup()
      .click(dialog()!.querySelector<HTMLElement>('button[aria-label="Close"]')!)
    await vi.waitFor(() => expect(dialog()).toBeNull())
    updater.onStatus.mock.calls[0]![0]({ state: 'downloading', version: '2026.2.0', percent: 60 })
    await flushPromises()
    expect(dialog()).toBeNull()
    updater.onStatus.mock.calls[0]![0]({ state: 'ready', version: '2026.2.0' })
    await vi.waitFor(() => expect(button(getText('restartToUpdate'))).not.toBeUndefined())
  })

  test('Download manually opens the release page of the failed version', async () => {
    fakeUpdater({ state: 'error', message: 'offline', version: '2026.2.0' })
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await userEvent.setup().click(button(getText('downloadManually'))!)
    expect(openInNewBrowserTab).toHaveBeenCalledWith(
      'https://github.com/jdunkerley/enso/releases/tag/2026.2.0',
    )
    expect(getLatestRelease).not.toHaveBeenCalled()
    expect(getDownloadUrl).not.toHaveBeenCalled()
  })

  test('an empty release date shows no parentheses', async () => {
    fakeUpdater({ state: 'available', version: '2026.2.0', releaseDate: '' })
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(dialog()!.textContent).toContain('2026.2.0')
    expect(dialog()!.textContent).not.toContain('()')
  })

  test('manual mode with an updater present uses the download link', async () => {
    const updater = fakeUpdater(available('2026.2.0'))
    updater.mode.mockImplementation(async () => 'manual' as never)
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(updater.check).not.toHaveBeenCalled()
    expect(dialog()!.textContent).toContain('2099.1.1')
    await userEvent.setup().click(button(getText('download'))!)
    await vi.waitFor(() =>
      expect(download).toHaveBeenCalledWith({ url: 'https://example.com/enso.exe' }),
    )
  })
})

describe('VersionChecker, with nothing to offer', () => {
  // Forced open as in the tests above, so that only the missing release keeps it closed.
  test.each([
    ['no release yet (404)', () => Promise.resolve(null)],
    ['a failed check (offline, rate-limited)', () => Promise.reject(new Error('quiet'))],
  ])('%s: no dialog, no toast, no error logged', async (_name, latest) => {
    getLatestRelease.mockClear()
    getLatestRelease.mockImplementationOnce(latest)
    const error = vi.spyOn(console, 'error')
    await mountWithProviders(VersionChecker)
    await vi.waitFor(() => expect(getLatestRelease).toHaveBeenCalled())
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(dialog()).toBeNull()
    expect(useToasts().toasts.value).toHaveLength(0)
    expect(getLatestRelease).toHaveBeenCalledOnce()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('isNewerRelease', () => {
  test('a newer release is offered', () => {
    expect(isNewerRelease('2099.1.1', '2025.1.1')).toBe(true)
  })
  test('the same version, or an older one, is not', () => {
    expect(isNewerRelease('2025.1.1', '2025.1.1')).toBe(false)
    expect(isNewerRelease('2024.1.1', '2025.1.1')).toBe(false)
  })
  test('versions compare part by part, not as one number (#358)', () => {
    expect(isNewerRelease('2026.1.10', '2026.1.9')).toBe(true)
    expect(isNewerRelease('2026.1.9', '2026.1.10')).toBe(false)
    expect(isNewerRelease('2026.10.1', '2026.9.1')).toBe(true)
  })
  test('an rc build is offered its release, and a later one', () => {
    expect(isNewerRelease('2026.1.1', '2026.1.1-rc.2')).toBe(true)
    expect(isNewerRelease('2026.1.2', '2026.1.1-rc.2')).toBe(true)
    expect(isNewerRelease('2026.1.1-rc.10', '2026.1.1-rc.9')).toBe(true)
    expect(isNewerRelease('2026.1.1-rc.2', '2026.1.1')).toBe(false)
    expect(isNewerRelease('2025.1.1', '2026.1.1-rc.2')).toBe(false)
  })
  test('nor anything to a development or nightly build, or a tag that is not a version', () => {
    expect(isNewerRelease('2026.1.2', '2026.1.1-nightly.2026.10.22')).toBe(false)
    expect(isNewerRelease('2099.1.1', '0.0.0-dev')).toBe(false)
    expect(isNewerRelease('2099.1.1', '0.0.1-testing')).toBe(false)
    expect(isNewerRelease('2099.1.1', '2025.1.1-dev')).toBe(false)
    expect(isNewerRelease('2099.1.1', '2025.1.1-nightly.2025.1.1')).toBe(false)
    expect(isNewerRelease('latest', '2025.1.1')).toBe(false)
  })
})
