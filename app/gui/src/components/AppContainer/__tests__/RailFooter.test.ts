/**
 * @file The rail footer (#83, #566), at the bottom of the left rail: the Settings, Documentation
 * and About buttons, whose actions are global; no account, notifications or offline notice, no cloud-only
 * buttons.
 */
import { useAboutModal } from '$/components/AboutModal/aboutModal'
import { useActionsStore } from '$/providers/actions'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, shallowRef } from 'vue'
import RailFooter from '../RailFooter.vue'

const localBackend = shallowRef<object | null>({})
vi.mock('$/providers/backends', () => ({
  useBackends: () =>
    reactive({
      get localBackend() {
        return localBackend.value
      },
    }),
}))

const openSettingsTab = vi.fn()
vi.mock('$/providers/container', () => ({
  useContainerData: () => ({ openSettingsTab }),
}))

const { getText } = useText()

/**
 * The value, which the test requires to be there.
 * @throws {Error} When it is not.
 */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a value.')
  return value
}

/** An element's text, trimmed. */
const textOf = (element: Element | null | undefined) => element?.textContent.trim()

const mountFooter = (props: { extended?: boolean } = {}) =>
  mountWithProviders(RailFooter, { props })

const button = (name: string) =>
  must(document.querySelector<HTMLElement>(`button[aria-label="${name}"]`))
const settingsButton = () => button(getText('settingsShortcut'))
const aboutButton = () => button(getText('aboutThisAppShortcut'))
const documentationButton = () => button(getText('documentationShortcut'))
const DOCS_URL = 'https://docs.example.test/docs/'
const actionNames = () =>
  useActionsStore()
    .findActions('')
    .map((action) => action.name)

beforeEach(() => {
  ;($config as { DOCS_URL?: string }).DOCS_URL = DOCS_URL
  openSettingsTab.mockClear()
  localBackend.value = {}
})

afterEach(() => {
  useAboutModal().isOpen.value = false
  useToasts().dismiss()
})

describe('RailFooter', () => {
  test('three buttons, Settings, Documentation and About, and nothing else', async () => {
    await mountFooter()
    const buttons = [...document.querySelectorAll('button')]
    expect(buttons).toEqual([settingsButton(), documentationButton(), aboutButton()])
    // The cog is the `settings` icon; About has the `info` icon.
    expect(settingsButton().querySelector('use')?.getAttribute('href')).toContain('settings')
    expect(aboutButton().querySelector('use')?.getAttribute('href')).toContain('info')
    expect(documentationButton().querySelector('use')?.getAttribute('href')).toContain('help')
    expect(document.body.textContent).not.toContain('Ada Lovelace')
  })

  test('the rail, expanded, shows the button labels', async () => {
    const mounted = await mountFooter()
    expect(textOf(settingsButton())).toBe('')
    expect(textOf(aboutButton())).toBe('')
    await mounted.unmount()
    await mountFooter({ extended: true })
    expect(textOf(settingsButton())).toBe(getText('settingsShortcut'))
    expect(textOf(aboutButton())).toBe(getText('aboutThisAppShortcut'))
    expect(textOf(documentationButton())).toBe(getText('documentationShortcut'))
  })

  test('Documentation opens the site’s introduction in the browser, and is an action', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mountFooter()
    documentationButton().click()
    expect(open).toHaveBeenCalledExactlyOnceWith(`${DOCS_URL}intro/`, '_blank')
    open.mockClear()
    const action = useActionsStore()
      .findActions('')
      .find((action) => action.name === getText('documentationShortcut'))
    action?.doAction()
    expect(open).toHaveBeenCalledExactlyOnceWith(`${DOCS_URL}intro/`, '_blank')
    open.mockRestore()
  })

  test('a site root without its trailing slash still opens the introduction', async () => {
    ;($config as { DOCS_URL?: string }).DOCS_URL = DOCS_URL.slice(0, -1)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mountFooter()
    documentationButton().click()
    expect(open).toHaveBeenCalledExactlyOnceWith(`${DOCS_URL}intro/`, '_blank')
    open.mockRestore()
  })

  test('without a configured site there is no Documentation button or action', async () => {
    ;($config as { DOCS_URL?: string }).DOCS_URL = undefined
    await mountFooter()
    expect(document.querySelectorAll('button')).toHaveLength(2)
    expect(actionNames()).not.toContain(getText('documentationShortcut'))
  })

  test('Settings and About act; there is no menu', async () => {
    await mountFooter()
    // `element.click()`: user-event's pointer sequence does not reach `MenuButton`'s handler in jsdom.
    settingsButton().click()
    expect(openSettingsTab).toHaveBeenCalledOnce()
    expect(useAboutModal().isOpen.value).toBe(false)
    aboutButton().click()
    expect(useAboutModal().isOpen.value).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  test('the buttons work from the keyboard', async () => {
    await mountFooter()
    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(settingsButton())
    await user.keyboard('{Enter}')
    expect(openSettingsTab).toHaveBeenCalledOnce()
    await user.tab()
    expect(document.activeElement).toBe(documentationButton())
    await user.tab()
    expect(document.activeElement).toBe(aboutButton())
    await user.keyboard('{Enter}')
    expect(useAboutModal().isOpen.value).toBe(true)
  })

  test('"Download app" is an action only, and only without a local backend', async () => {
    const mounted = await mountFooter()
    expect(actionNames()).not.toContain(getText('downloadAppShortcut'))
    await mounted.unmount()
    localBackend.value = null
    await mountFooter()
    expect(actionNames()).toContain(getText('downloadAppShortcut'))
    // Still no button for it.
    expect(document.querySelectorAll('button')).toHaveLength(3)
  })

  test('local mode: no "Upgrade Plan" or "Logout", in the rail or the actions', async () => {
    await mountFooter()
    const controls = [...document.querySelectorAll('a, button')].map(textOf)
    expect(controls).not.toContain(getText('upgrade'))
    expect(controls).not.toContain(getText('invite'))
    expect(document.body.textContent).not.toContain(getText('trialProgressLabel'))
    expect(actionNames()).not.toContain(getText('upgradePlanShortcut'))
    expect(actionNames()).not.toContain(getText('signOutShortcut'))
  })

  test('the actions are global while the footer is mounted', async () => {
    const { unmount } = await mountFooter()
    expect(actionNames()).toContain(getText('settingsShortcut'))
    expect(actionNames()).toContain(getText('aboutThisAppShortcut'))
    // `Mod+,` is Settings' default shortcut.
    await userEvent.setup().keyboard('{Control>},{/Control}')
    expect(openSettingsTab).toHaveBeenCalledOnce()
    unmount()
    expect(actionNames()).not.toContain(getText('settingsShortcut'))
  })
})
