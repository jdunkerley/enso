/**
 * @file The Vue version checker (#83), forced open as the devtools do (this build's version is not
 * a release one): "Remind me later" hides it; "Download" downloads, then it can be closed.
 */
import VersionChecker from '$/cloud/versionChecker/VersionChecker.vue'
import { useDevtoolsStore } from '$/providers/devTools'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const getLatestRelease = vi.fn(async () => ({
  tag_name: '2099.1.1',
  published_at: '2099-01-01T00:00:00Z',
  html_url: 'https://github.com/enso-org/enso/releases/tag/2099.1.1',
  assets: [],
}))
const getDownloadUrl = vi.fn(async () => 'https://example.com/enso.exe')
vi.mock('$/utils/github', () => ({
  getLatestRelease: () => getLatestRelease(),
  getDownloadUrl: () => getDownloadUrl(),
}))
const download = vi.fn(async () => {})
vi.mock('$/utils/download', () => ({ download: (options: unknown) => download(options) }))

const { getText } = useText()

let portalRoot: HTMLElement
beforeEach(() => {
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
