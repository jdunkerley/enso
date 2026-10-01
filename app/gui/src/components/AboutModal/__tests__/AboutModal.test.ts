/** @file The Vue "About Enso" dialog. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import { openAboutModal, useAboutModal } from '$/components/AboutModal/aboutModal'
import AboutModal from '$/components/AboutModal/AboutModal.vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { h, shallowRef } from 'vue'

usePrimitiveTestEnvironment()

const localBackend = shallowRef<object | null>(null)
vi.mock('$/providers/backends', () => ({ useBackends: () => ({ localBackend }) }))

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

function mountAbout() {
  const about = useAboutModal()
  mountWithProviders(() =>
    h(AboutModal, {
      open: about.isOpen.value,
      opener: about.opener.value,
      'onUpdate:open': (value: boolean) => (about.isOpen.value = value),
    }),
  )
}

describe('AboutModal', () => {
  afterEach(() => {
    useAboutModal().isOpen.value = false
    localBackend.value = null
  })

  test('opens through `openAboutModal`, titled "About Enso", with the edition and versions', async () => {
    mountAbout()
    await flushPromises()
    expect(dialog()).toBeNull()
    openAboutModal()
    await flushPromises()
    expect(dialog()!.querySelector('h2')!.textContent!.trim()).toBe('About Enso')
    expect(dialog()!.querySelector('h1')!.textContent!.trim()).toBe('Enso Cloud Edition')
    const rows = [...dialog()!.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    )
    expect(rows.at(-1)).toEqual(['User Agent', navigator.userAgent])
  })

  test('names the desktop edition when there is a local backend', async () => {
    localBackend.value = {}
    mountAbout()
    openAboutModal()
    await flushPromises()
    expect(dialog()!.querySelector('h1')!.textContent!.trim()).toBe('Enso Desktop Edition')
  })

  test('"Copy" copies every line as "<name> <version>"', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    mountAbout()
    openAboutModal()
    await flushPromises()
    const copy = [...dialog()!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Copy',
    )!
    await user.click(copy)
    await flushPromises()
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0]![0].split('\n').at(-1)).toBe(`User Agent ${navigator.userAgent}`)
  })

  test('the close button closes it', async () => {
    mountAbout()
    openAboutModal()
    await flushPromises()
    await userEvent
      .setup()
      .click(dialog()!.querySelector<HTMLElement>('button[aria-label="Close"]')!)
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(useAboutModal().isOpen.value).toBe(false)
    expect(byTestId('modal-dialog')).toBeNull()
  })

  test('focus returns to the menu it was opened from, though the menu item has gone', async () => {
    const menu = document.createElement('div')
    menu.innerHTML =
      '<button aria-controls="user-menu" data-testid="user-button">User</button>' +
      '<div id="user-menu"><button data-testid="about-item">About Enso</button></div>'
    document.body.appendChild(menu)
    byTestId('about-item')!.focus()
    openAboutModal()
    // The menu closes as the dialog opens; the dialog mounts (it is loaded on demand) after that.
    byTestId('about-item')!.remove()
    mountAbout()
    await flushPromises()
    expect(dialog()).not.toBeNull()
    await userEvent.setup().keyboard('{Escape}')
    await flushPromises()
    expect(dialog()).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId('user-button')))
    menu.remove()
  })
})
