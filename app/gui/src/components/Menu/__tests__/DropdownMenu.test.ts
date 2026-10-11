/**
 * @file Keyboard and focus behaviour of the Reka-based {@link DropdownMenu} primitive.
 */
import userEvent from '@testing-library/user-event'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import DropdownMenu from '../DropdownMenu.vue'
import MenuItem from '../MenuItem.vue'
import MenuSeparator from '../MenuSeparator.vue'

function mountMenu() {
  const onSelect = vi.fn<(item: string) => void>()
  const Host = defineComponent({
    setup() {
      return () =>
        h(
          DropdownMenu,
          { testId: 'menu' },
          {
            trigger: () => h('button', { type: 'button', 'data-testid': 'trigger' }, 'Open'),
            default: () => [
              h(MenuItem, { testId: 'alpha', onSelect: () => onSelect('Alpha') }, () => 'Alpha'),
              h(MenuItem, { testId: 'beta', onSelect: () => onSelect('Beta') }, () => 'Beta'),
              h(MenuItem, { testId: 'disabled', isDisabled: true }, () => 'Unavailable'),
              h(MenuSeparator),
              h(MenuItem, { testId: 'gamma', onSelect: () => onSelect('Gamma') }, () => 'Gamma'),
            ],
          },
        )
    },
  })
  mount(Host, { attachTo: document.body })
  return { onSelect }
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

// A failed assertion must not leave an open menu behind for the next test to find.
enableAutoUnmount(afterEach)

describe('DropdownMenu', () => {
  let portalRoot: HTMLElement
  beforeEach(() => {
    // `index.html` provides this; the menu renders into it.
    portalRoot = document.createElement('div')
    portalRoot.id = 'enso-portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => {
    portalRoot.remove()
  })

  test('opens from the keyboard, focuses the first item and renders into the portal root', async () => {
    mountMenu()
    const user = userEvent.setup()
    byTestId('trigger')!.focus()
    await user.keyboard('{Enter}')
    await flushPromises()

    const menu = byTestId('menu')
    expect(menu).not.toBeNull()
    expect(menu!.getAttribute('role')).toBe('menu')
    expect(portalRoot.contains(menu)).toBe(true)
    expect(byTestId('trigger')!.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(byTestId('alpha'))
    expect(byTestId('alpha')!.getAttribute('role')).toBe('menuitem')
  })

  test('arrow keys move through the items, skip disabled ones and wrap', async () => {
    mountMenu()
    const user = userEvent.setup()
    byTestId('trigger')!.focus()
    await user.keyboard('{Enter}')
    await flushPromises()

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(byTestId('beta'))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(byTestId('gamma'))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(byTestId('alpha'))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(byTestId('gamma'))
    expect(byTestId('disabled')!.getAttribute('aria-disabled')).toBe('true')
  })

  test('Enter selects the highlighted item, closes the menu and returns focus to the trigger', async () => {
    const { onSelect } = mountMenu()
    const user = userEvent.setup()
    byTestId('trigger')!.focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    await user.keyboard('{ArrowDown}{Enter}')
    await flushPromises()

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Beta')
    expect(byTestId('menu')).toBeNull()
    expect(document.activeElement).toBe(byTestId('trigger'))
  })

  test('Escape closes the menu without selecting and returns focus to the trigger', async () => {
    const { onSelect } = mountMenu()
    const user = userEvent.setup()
    byTestId('trigger')!.focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    await user.keyboard('{Escape}')
    await flushPromises()

    expect(onSelect).not.toHaveBeenCalled()
    expect(byTestId('menu')).toBeNull()
    expect(byTestId('trigger')!.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(byTestId('trigger'))
  })

  test('the styles come from the shared variants and Reka state attributes', async () => {
    mountMenu()
    const user = userEvent.setup()
    byTestId('trigger')!.focus()
    await user.keyboard('{Enter}')
    await flushPromises()

    // `DIALOG_BACKGROUND` from the dashboard's `Dialog/variants.ts`.
    expect(byTestId('menu')!.classList).toContain('backdrop-blur-md')
    // The highlighted item carries the attribute `MENU_ITEM_STYLES` keys its background on.
    expect(byTestId('alpha')!.hasAttribute('data-highlighted')).toBe(true)
    expect(byTestId('beta')!.hasAttribute('data-highlighted')).toBe(false)
    expect(byTestId('disabled')!.hasAttribute('data-disabled')).toBe(true)
  })
})
