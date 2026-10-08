/**
 * @file The drive's Vue `ContextMenu`: its DOM, and its closing behaviour (Escape, a press
 * outside, a right-click elsewhere, pressing an entry).
 */
import ContextMenu from '#/components/ContextMenu.vue'
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h, ref } from 'vue'

usePrimitiveTestEnvironment()

function setup() {
  const open = ref(true)
  const onClose = vi.fn()
  const copy = vi.fn()
  const paste = vi.fn()
  const entries: ContextMenuEntry[] = [
    { action: 'copy', doAction: copy },
    { action: 'paste', doAction: paste, isDisabled: true },
  ]
  mountWithProviders(() => [
    h(ContextMenu, {
      open: open.value,
      'onUpdate:open': (value: boolean) => (open.value = value),
      onClose,
      ariaLabel: 'Asset menu',
      entries,
      position: { pageX: 40, pageY: 50 },
    }),
    h('button', { 'data-testid': 'outside' }, 'outside'),
  ])
  return { open, onClose, copy, paste }
}

const menu = () => byTestId('context-menu')

/**
 * An element that must be there.
 * @throws {Error} When it is not.
 */
function present<T extends Element>(element: T | null | undefined): T {
  if (element == null) throw new Error('Expected the element to be present.')
  return element
}

const openMenu = () => present(menu())
const entryButton = (index: number) => present(openMenu().querySelectorAll('button')[index])
const outside = () => present(byTestId('outside'))

describe('ContextMenu', () => {
  test("has React's DOM: a dialog named by the label, of buttons, at the point", async () => {
    setup()
    await flushPromises()
    expect(menu()).not.toBeNull()
    expect(openMenu().style.left).toBe('40px')
    expect(openMenu().style.top).toBe('50px')
    expect(openMenu().querySelector('[role="dialog"]')).not.toBeNull()
    expect(openMenu().querySelector('[aria-label="Asset menu"]')).not.toBeNull()
    expect(openMenu().querySelectorAll('button')).toHaveLength(2)
    // It does not take focus on opening.
    expect(openMenu().contains(document.activeElement)).toBe(false)
  })

  test('pressing an entry runs it and closes the menu', async () => {
    const { open, onClose, copy } = setup()
    await flushPromises()
    await userEvent.setup().click(entryButton(0))
    expect(copy).toHaveBeenCalledOnce()
    expect(open.value).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('a disabled entry does nothing', async () => {
    const { open, paste } = setup()
    await flushPromises()
    await userEvent.setup().click(entryButton(1))
    expect(paste).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
  })

  test('Escape closes it', async () => {
    const { open } = setup()
    await flushPromises()
    await userEvent.setup().keyboard('{Escape}')
    expect(open.value).toBe(false)
  })

  test('a press outside closes it', async () => {
    const { open } = setup()
    await flushPromises()
    await userEvent.setup().click(outside())
    expect(open.value).toBe(false)
    await flushPromises()
    expect(menu()).toBeNull()
  })

  test('a right-click elsewhere closes it', async () => {
    const { open } = setup()
    await flushPromises()
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: outside() })
    expect(open.value).toBe(false)
  })
})
