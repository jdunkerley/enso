/**
 * @file The Vue user bar (#83): the settings cog and the menu it opens (a dialog of buttons), its
 * entries as global actions; no account, notifications or offline notice, no cloud-only buttons.
 */
import { useAboutModal } from '$/components/AboutModal/aboutModal'
import { useActionsStore } from '$/providers/actions'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, shallowRef } from 'vue'
import UserBar from '../UserBar.vue'

const localBackend = shallowRef<object | null>({})
vi.mock('$/providers/backends', () => ({
  useBackends: () =>
    reactive({
      get localBackend() {
        return localBackend.value
      },
    }),
}))

const { getText } = useText()

// The overlays teleport into the portal root that `index.html` provides.
let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => {
  portalRoot.remove()
})

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

async function mountUserBar() {
  const goToSettingsPage = vi.fn()
  const mounted = await mountWithProviders(UserBar, { props: { goToSettingsPage } })
  return { ...mounted, goToSettingsPage }
}

const userMenuButton = () =>
  must(document.querySelector<HTMLElement>(`button[aria-label="${getText('userMenuLabel')}"]`))
const userMenu = () => document.querySelector<HTMLElement>('[data-testid="user-menu"]')
const entryNames = () =>
  [...(userMenu()?.querySelectorAll('button') ?? [])].map((button) =>
    textOf(button.querySelector('span')),
  )
const entry = (name: string) =>
  must(
    [...(userMenu()?.querySelectorAll('button') ?? [])].find(
      (button) => textOf(button.querySelector('span')) === name,
    ),
  )

beforeEach(() => {
  localBackend.value = {}
})

afterEach(() => {
  useAboutModal().isOpen.value = false
  useToasts().dismiss()
})

describe('UserBar', () => {
  test('the bar holds the settings cog and nothing else', async () => {
    await mountUserBar()
    const buttons = [...document.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toBe(userMenuButton())
    // The cog is the `settings` icon.
    expect(userMenuButton().querySelector('use')?.getAttribute('data-icon')).toBe('settings')
    expect(document.body.textContent).not.toContain('Ada Lovelace')
  })

  test('the settings menu: a dialog of buttons, focused as it opens', async () => {
    await mountUserBar()
    const user = userEvent.setup()
    userMenuButton().focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    const menu = must(userMenu())
    expect(menu.getAttribute('role')).toBe('dialog')
    expect(menu.getAttribute('aria-label')).toBe(getText('userMenuLabel'))
    // The dialog itself takes the focus, then Tab goes to the entries.
    expect(document.activeElement).toBe(menu)
    expect(entryNames()).toEqual([getText('settingsShortcut'), getText('aboutThisAppShortcut')])
    await user.tab()
    expect(document.activeElement).toBe(entry(getText('settingsShortcut')))
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(userMenu()).toBeNull()
    expect(document.activeElement).toBe(userMenuButton())
  })

  test('"Download app" without a local backend', async () => {
    localBackend.value = null
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).toEqual([
      getText('downloadAppShortcut'),
      getText('settingsShortcut'),
      getText('aboutThisAppShortcut'),
    ])
  })

  test('local mode: no "Upgrade Plan" or "Logout", in menu or actions', async () => {
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).toEqual([getText('settingsShortcut'), getText('aboutThisAppShortcut')])
    const names = useActionsStore()
      .findActions('')
      .map((action) => action.name)
    expect(names).not.toContain(getText('upgradePlanShortcut'))
    expect(names).not.toContain(getText('signOutShortcut'))
  })

  test('no trial, "Invite" or "Upgrade"', async () => {
    await mountUserBar()
    const controls = [...document.querySelectorAll('a, button')].map(textOf)
    expect(controls).not.toContain(getText('upgrade'))
    expect(controls).not.toContain(getText('invite'))
    expect(document.body.textContent).not.toContain(getText('trialProgressLabel'))
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).not.toContain(getText('upgradePlanShortcut'))
  })

  test('Settings and About close the menu and act; there is no Logout', async () => {
    const { goToSettingsPage } = await mountUserBar()
    const user = userEvent.setup()

    await user.click(userMenuButton())
    await flushPromises()
    await user.click(entry(getText('settingsShortcut')))
    await flushPromises()
    expect(goToSettingsPage).toHaveBeenCalledOnce()
    expect(userMenu()).toBeNull()

    await user.click(userMenuButton())
    await flushPromises()
    await user.click(entry(getText('aboutThisAppShortcut')))
    await flushPromises()
    expect(useAboutModal().isOpen.value).toBe(true)

    await user.click(userMenuButton())
    await flushPromises()
    expect(entryNames()).not.toContain(getText('signOutShortcut'))
  })

  test('the entries are global actions while the bar is mounted, the menu closed', async () => {
    const { goToSettingsPage, unmount } = await mountUserBar()
    const names = () =>
      useActionsStore()
        .findActions('')
        .map((action) => action.name)
    expect(names()).toContain(getText('settingsShortcut'))
    expect(names()).not.toContain(getText('signOutShortcut'))
    // `Mod+,` is Settings' default shortcut.
    await userEvent.setup().keyboard('{Control>},{/Control}')
    expect(goToSettingsPage).toHaveBeenCalledOnce()
    unmount()
    expect(names()).not.toContain(getText('settingsShortcut'))
  })

  test('the menu shows the shortcuts', async () => {
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    // The key of `Mod+,`, after its modifier.
    expect(entry(getText('settingsShortcut')).textContent).toMatch(/,$/)
  })
})
