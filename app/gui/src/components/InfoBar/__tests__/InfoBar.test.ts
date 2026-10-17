/** @file The Vue info bar and menu (#83): the logo button and About; no Sign out in local-only mode. */
import { useAboutModal } from '$/components/AboutModal/aboutModal'
import InfoBar from '$/components/InfoBar/InfoBar.vue'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'

const auth = reactive<{ session: object | null }>({ session: null })
vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))

const { getText } = useText()

let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  auth.session = null
})
afterEach(() => {
  portalRoot.remove()
  useAboutModal().isOpen.value = false
})

const logoButton = () =>
  document
    .querySelector<HTMLElement>(`svg[aria-label="${getText('openInfoMenu')}"]`)!
    .closest('button')!
const infoMenu = () => document.querySelector<HTMLElement>('[data-testid="info-menu"]')
const entry = (name: string) =>
  [...(infoMenu()?.querySelectorAll('button') ?? [])].find(
    (button) => button.querySelector('span')?.textContent?.trim() === name,
  )

describe('InfoBar', () => {
  test('the logo opens the info menu, named by it; About opens the About dialog', async () => {
    await mountWithProviders(InfoBar)
    const user = userEvent.setup()
    logoButton().focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(infoMenu()!.getAttribute('role')).toBe('dialog')
    expect(infoMenu()!.getAttribute('aria-label')).toBe(getText('openInfoMenu'))
    expect(document.activeElement).toBe(infoMenu())
    expect(infoMenu()!.textContent).toContain('Enso')
    expect(entry(getText('signOutShortcut'))).toBeUndefined()
    await user.tab()
    expect(document.activeElement).toBe(entry(getText('aboutThisAppShortcut')))
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(infoMenu()).toBeNull()
    expect(useAboutModal().isOpen.value).toBe(true)
  })

  test('signed in: there is no Sign out entry, as the app runs on the offline session only', async () => {
    auth.session = {}
    await mountWithProviders(InfoBar)
    const user = userEvent.setup()
    await user.click(logoButton())
    await flushPromises()
    expect(entry(getText('aboutThisAppShortcut'))).toBeDefined()
    expect(entry(getText('signOutShortcut'))).toBeUndefined()
  })
})
