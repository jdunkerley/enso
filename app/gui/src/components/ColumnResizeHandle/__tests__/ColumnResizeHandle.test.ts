/** @file The resize handle of a table column: its separator semantics, keyboard, drag and reset. */
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import ColumnResizeHandle from '../ColumnResizeHandle.vue'

const LIMITS = { min: 100, max: 400 }

function mountHandle(width: number | null = 200) {
  const wrapper = mount(ColumnResizeHandle, {
    props: { label: 'Resize the Modified column', width, limits: LIMITS },
    attachTo: document.body,
  })
  return { wrapper, handle: wrapper.get('[role="separator"]') }
}

describe('ColumnResizeHandle', () => {
  test('is a focusable, labelled vertical separator with its width as its value', () => {
    const { handle } = mountHandle()
    expect(handle.attributes()).toMatchObject({
      'aria-orientation': 'vertical',
      'aria-label': 'Resize the Modified column',
      'aria-valuenow': '200',
      'aria-valuemin': '100',
      'aria-valuemax': '400',
      tabindex: '0',
    })
  })

  test('resizes by 10px with the arrow keys and 50px with Shift', async () => {
    const { wrapper, handle } = mountHandle()
    await handle.trigger('keydown', { key: 'ArrowRight' })
    await handle.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(wrapper.emitted('resize')).toEqual([[210], [150]])
  })

  test('stops at the limits', async () => {
    const { wrapper, handle } = mountHandle(120)
    await handle.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(wrapper.emitted('resize')).toEqual([[100]])
  })

  test('resets on Enter, Home and a double click', async () => {
    const { wrapper, handle } = mountHandle()
    await handle.trigger('keydown', { key: 'Enter' })
    await handle.trigger('keydown', { key: 'Home' })
    await handle.trigger('dblclick')
    expect(wrapper.emitted('reset')).toHaveLength(3)
  })

  test('keeps the keys it handles from the table, and lets the others through', () => {
    const { handle } = mountHandle()
    const seen: string[] = []
    document.body.addEventListener('keydown', (event) => seen.push(event.key))
    for (const key of ['ArrowRight', 'Enter', 'ArrowDown', 'Tab']) {
      handle.element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
    expect(seen).toEqual(['ArrowDown', 'Tab'])
  })

  test('follows a drag of the pointer from the width it started at', async () => {
    const { wrapper, handle } = mountHandle()
    await handle.trigger('pointerdown', { button: 0, clientX: 500, pointerId: 1 })
    await handle.trigger('pointermove', { clientX: 530, pointerId: 1 })
    await handle.trigger('pointermove', { clientX: 470, pointerId: 1 })
    await handle.trigger('pointerup', { clientX: 470, pointerId: 1 })
    await handle.trigger('pointermove', { clientX: 600, pointerId: 1 })
    expect(wrapper.emitted('resize')).toEqual([[230], [170]])
  })

  test('turns text selection off while dragging, and keeps the drag’s click from the table', async () => {
    const { handle } = mountHandle()
    const clicks: EventTarget[] = []
    document.body.addEventListener('click', (event) => clicks.push(event.target!))
    await handle.trigger('pointerdown', { button: 0, clientX: 500, pointerId: 1 })
    expect(document.documentElement.style.userSelect).toBe('none')
    await handle.trigger('pointerup', { clientX: 520, pointerId: 1 })
    expect(document.documentElement.style.userSelect).toBe('')
    await handle.trigger('click')
    expect(clicks).toEqual([])
  })

  test('ignores a press of any button but the primary one', async () => {
    const { wrapper, handle } = mountHandle()
    await handle.trigger('pointerdown', { button: 2, clientX: 500, pointerId: 1 })
    await handle.trigger('pointermove', { clientX: 530, pointerId: 1 })
    expect(wrapper.emitted('resize')).toBeUndefined()
  })
})
