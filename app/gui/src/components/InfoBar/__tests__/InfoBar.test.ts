/** @file The Vue info bar and menu (#83): the logo button, About, and Logout when signed in. */
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

const signOut = vi.fn(async () => {})
vi.mock('$/providers/session', () => ({ useSession: () => ({ signOut }) }))

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

  test('signed in: Logout signs out, then goes to the login page', async () => {
    auth.session = {}
    const { router } = await mountWithProviders(InfoBar, { route: '/registration' })
    const user = userEvent.setup()
    await user.click(logoButton())
    await flushPromises()
    await user.click(entry(getText('signOutShortcut'))!)
    await flushPromises()
    expect(signOut).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/login')
  })
})
