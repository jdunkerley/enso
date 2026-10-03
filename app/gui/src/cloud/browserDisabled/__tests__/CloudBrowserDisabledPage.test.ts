/**
 * @file The page shown when running projects in the browser is disabled (#84): it opens the desktop
 * app after three seconds, and offers to open or download it.
 */
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import CloudBrowserDisabledPage from '../CloudBrowserDisabledPage.vue'

const mocks = vi.hoisted(() => ({
  unsafeWriteValue: vi.fn(),
  getDownloadUrl: vi.fn(),
  download: vi.fn(),
}))

vi.mock('$/utils/write', () => ({ unsafeWriteValue: mocks.unsafeWriteValue }))
vi.mock('$/utils/github', () => ({ getDownloadUrl: mocks.getDownloadUrl }))
vi.mock('$/utils/download', () => ({ download: mocks.download }))
// The info bar has its own tests, and the modal host is not under test.
vi.mock('$/components/InfoBar/InfoBar.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))
vi.mock('$/components/ModalHost/ModalHost.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))

const { getText } = useText()

const section = () => document.querySelector('section')!
const link = (name: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (element) => element.textContent?.trim() === name,
  )
const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent?.trim() === name,
  )!

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => vi.useRealTimers())

describe('CloudBrowserDisabledPage', () => {
  test('says why, and offers to open the desktop app or download it', async () => {
    await mountWithProviders(CloudBrowserDisabledPage, { props: { redirectPath: '/' } })
    expect(section().textContent).toContain(getText('cloudBrowserDisabledTitle'))
    expect(section().textContent).toContain(getText('cloudBrowserDisabledSubtitle'))
    expect(section().textContent).toContain(getText('or'))
    expect(link(getText('openInDesktop'))!.getAttribute('href')).toBe('enso://')
    expect(button(getText('downloadIDE'))).toBeDefined()
  })

  test('opens the desktop app after three seconds, and stops its spinner', async () => {
    await mountWithProviders(CloudBrowserDisabledPage, { props: { redirectPath: '/drive' } })
    expect(link(getText('openInDesktop'))!.getAttribute('href')).toBe('enso://drive')
    // The loading status shows a spinner; the info status an "i".
    expect(section().textContent).not.toMatch(/^\s*i/)
    vi.advanceTimersByTime(2_999)
    expect(mocks.unsafeWriteValue).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mocks.unsafeWriteValue).toHaveBeenCalledWith(window.location, 'href', 'enso://drive')
    await flushPromises()
    expect(section().textContent).toMatch(/^\s*i/)
  })

  test('does not open it once the page has gone', async () => {
    const { unmount } = await mountWithProviders(CloudBrowserDisabledPage)
    unmount()
    vi.advanceTimersByTime(5_000)
    expect(mocks.unsafeWriteValue).not.toHaveBeenCalled()
  })

  test('downloads the latest release', async () => {
    vi.useRealTimers()
    mocks.getDownloadUrl.mockResolvedValue('https://example.com/enso.exe')
    await mountWithProviders(CloudBrowserDisabledPage)
    await userEvent.setup().click(button(getText('downloadIDE')))
    await flushPromises()
    expect(mocks.download).toHaveBeenCalledWith({ url: 'https://example.com/enso.exe' })
  })

  test('downloads nothing when there is no release for this platform', async () => {
    vi.useRealTimers()
    mocks.getDownloadUrl.mockResolvedValue(null)
    await mountWithProviders(CloudBrowserDisabledPage)
    await userEvent.setup().click(button(getText('downloadIDE')))
    await flushPromises()
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
