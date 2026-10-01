/**
 * @file The rest of the Vue menu family beyond `DropdownMenu.test.ts`: typeahead, sections,
 * submenus, the item parts, and the `ContextMenu`.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h, ref } from 'vue'
import ContextMenu from '../ContextMenu.vue'
import DropdownMenu from '../DropdownMenu.vue'
import MenuItem from '../MenuItem.vue'
import MenuSection from '../MenuSection.vue'
import MenuSeparator from '../MenuSeparator.vue'
import MenuSubmenu from '../MenuSubmenu.vue'

const env = usePrimitiveTestEnvironment()

function mountMenu(onSelect = vi.fn<(item: string) => void>()) {
  mountWithProviders(() =>
    h(
      DropdownMenu,
      { testId: 'menu', placement: 'bottom-end' },
      {
        trigger: () => h('button', { type: 'button', 'data-testid': 'trigger' }, 'Open'),
        default: () => [
          h(MenuSection, { title: 'Edit', testId: 'section' }, () => [
            h(
              MenuItem,
              { testId: 'copy', icon: 'copy', shortcut: 'Mod+C', onSelect: () => onSelect('Copy') },
              () => 'Copy',
            ),
            h(
              MenuItem,
              {
                testId: 'cut',
                description: 'Remove and copy',
                onSelect: () => onSelect('Cut'),
              },
              () => 'Cut',
            ),
          ]),
          h(MenuSeparator),
          h(MenuSubmenu, { label: 'Share', testId: 'share' }, () => [
            h(MenuItem, { testId: 'email', onSelect: () => onSelect('Email') }, () => 'Email'),
          ]),
          h(MenuItem, { testId: 'paste', onSelect: () => onSelect('Paste') }, () => 'Paste'),
        ],
      },
    ),
  )
  return onSelect
}

async function open() {
  const user = userEvent.setup()
  byTestId('trigger')!.focus()
  await user.keyboard('{Enter}')
  await flushPromises()
  return user
}

describe('DropdownMenu', () => {
  test('placement sets the side and alignment', async () => {
    mountMenu()
    await open()
    expect(byTestId('menu')!.getAttribute('data-side')).toBe('bottom')
    expect(byTestId('menu')!.getAttribute('data-align')).toBe('end')
  })

  test('typeahead moves to the matching item', async () => {
    mountMenu()
    const user = await open()
    await user.keyboard('pa')
    expect(document.activeElement).toBe(byTestId('paste'))
  })

  test('a section is a group labelled by its title', async () => {
    mountMenu()
    await open()
    const section = byTestId('section')!
    expect(section.getAttribute('role')).toBe('group')
    expect(section.getAttribute('aria-label')).toBe('Edit')
    expect(section.querySelector('header')?.textContent).toBe('Edit')
  })

  test('items show their icon, shortcut and description', async () => {
    mountMenu()
    await open()
    expect(byTestId('copy')!.querySelector('use')?.getAttribute('data-icon')).toBe('copy')
    expect(byTestId('copy')!.querySelector('kbd')?.textContent).toBe('Mod+C')
    expect(byTestId('cut')!.textContent).toContain('Remove and copy')
  })

  test('the separator is a thin separator, as in React', async () => {
    mountMenu()
    await open()
    const separator = byTestId('menu')!.querySelector('[role="separator"]')!
    expect(separator.classList).toContain('h-[0.5px]')
    expect(separator.classList).toContain('bg-primary/30')
  })

  test('ArrowRight opens a submenu and ArrowLeft closes it', async () => {
    const onSelect = mountMenu()
    const user = await open()
    byTestId('share')!.focus()
    expect(byTestId('share')!.getAttribute('aria-haspopup')).toBe('menu')
    await user.keyboard('{ArrowRight}')
    await flushPromises()
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId('email')))
    await user.keyboard('{ArrowLeft}')
    await flushPromises()
    expect(byTestId('email')).toBeNull()
    expect(document.activeElement).toBe(byTestId('share'))

    await user.keyboard('{ArrowRight}')
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId('email')))
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Email')
    expect(byTestId('menu')).toBeNull()
  })
})

describe('ContextMenu', () => {
  function mountContextMenu() {
    const onSelect = vi.fn<(item: string) => void>()
    const menu = ref<InstanceType<typeof ContextMenu>>()
    mountWithProviders(() =>
      h(
        ContextMenu,
        { ref: menu },
        {
          trigger: () => h('div', { 'data-testid': 'area', style: 'width: 100px' }, 'Assets'),
          default: () => [
            h(MenuItem, { testId: 'open', onSelect: () => onSelect('Open') }, () => 'Open'),
            h(MenuItem, { testId: 'rename', onSelect: () => onSelect('Rename') }, () => 'Rename'),
          ],
        },
      ),
    )
    return { onSelect, menu }
  }

  test('a right click in its area opens it, with the same items and keys as a dropdown', async () => {
    const { onSelect } = mountContextMenu()
    const user = userEvent.setup()
    await user.pointer({ keys: '[MouseRight]', target: byTestId('area')! })
    await flushPromises()

    const menu = byTestId('context-menu')!
    expect(menu.getAttribute('role')).toBe('menu')
    expect(env.portalRoot.contains(menu)).toBe(true)
    // The menu's classes are the dropdown's.
    expect(menu.classList).toContain('backdrop-blur-md')

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await flushPromises()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Rename')
    expect(byTestId('context-menu')).toBeNull()
  })

  test('open() opens it at a point, and Escape closes it', async () => {
    const { menu } = mountContextMenu()
    menu.value!.open({ pageX: 40, pageY: 30 })
    await flushPromises()
    expect(byTestId('context-menu')).not.toBeNull()
    await userEvent.setup().keyboard('{Escape}')
    await flushPromises()
    expect(byTestId('context-menu')).toBeNull()
  })

  test('scrolling elsewhere closes it', async () => {
    const { menu } = mountContextMenu()
    menu.value!.open({ pageX: 40, pageY: 30 })
    await flushPromises()
    byTestId('area')!.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(byTestId('context-menu')).toBeNull()
  })
})
