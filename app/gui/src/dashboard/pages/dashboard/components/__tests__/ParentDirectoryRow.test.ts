/**
 * @file The drive table's parent-folder entry (#640): its `..` name and accessible name, opening on
 * a double click, no selection, no context menu, empty cells beside the name, drops, its drop
 * highlight, and holding a drag over it to keep climbing.
 */
import { Column } from '#/pages/dashboard/components/column/columnUtils'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import ParentDirectoryRow from '../ParentDirectoryRow.vue'

const { getText } = useText()

beforeAll(() => {
  // The test DOM does not lay out, and has no `scrollIntoView`.
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  vi.useRealTimers()
})

/** The row inside a table, where a `<tr>` belongs. `props` may be changed afterwards. */
function inTable(props: Record<string, unknown>) {
  return defineComponent({
    render: () => h('table', [h('tbody', [h(ParentDirectoryRow, { ...props } as never)])]),
  })
}

/** A drag event carrying files, which the entry accepts. */
function fileDragEvent(type: string, relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], items: [] } })
  return event
}

async function setup(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onEntryFocus: vi.fn(),
    onEntryClick: vi.fn(),
    open: vi.fn(),
    onEntryDrop: vi.fn(),
  }
  const props = reactive<Record<string, unknown>>({
    targetId: 'directory-parent',
    columns: [Column.name, Column.modified, Column.labels],
    isKeyboardSelected: false,
    isTabStop: false,
    isOpening: false,
    ...handlers,
    ...overrides,
  })
  const { wrapper } = await mountWithProviders(inTable(props))
  const row = (wrapper.element as HTMLElement).querySelector<HTMLTableRowElement>(
    '[data-testid="parent-directory-row"]',
  )
  if (row == null) throw new Error('The parent-folder entry is not rendered.')
  return { row, props, ...handlers }
}

describe('ParentDirectoryRow', () => {
  test('shows `..`, is named "Parent folder", and leaves the other cells empty', async () => {
    const { row } = await setup()
    const cells = Array.from(row.querySelectorAll('td'), (cell) => cell.textContent.trim())
    expect(cells).toHaveLength(3)
    expect(row.querySelector('[data-testid="parent-directory-row-name"]')?.textContent.trim()).toBe(
      '..',
    )
    expect(cells[0]).toContain(getText('parentFolder'))
    expect(cells.slice(1)).toEqual(['', ''])
  })

  test('is a grid row that cannot be selected or dragged', async () => {
    const { row } = await setup()
    expect(row.getAttribute('aria-rowindex')).toBe('2')
    expect(row.hasAttribute('aria-selected')).toBe(false)
    expect(row.hasAttribute('data-selected')).toBe(false)
    expect(row.getAttribute('draggable')).toBe('false')
    expect(row.getAttribute('tabindex')).toBe('-1')
  })

  test('is the tab stop when the table says so', async () => {
    const { row } = await setup({ isTabStop: true })
    expect(row.getAttribute('tabindex')).toBe('0')
  })

  test('opens the parent folder on a double click', async () => {
    const { row, open, onEntryClick } = await setup()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onEntryClick).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  test('opens no context menu, and keeps the table from opening its own', async () => {
    const { row } = await setup()
    const onTableContextMenu = vi.fn()
    row.closest('table')?.addEventListener('contextmenu', onTableContextMenu)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    row.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onTableContextMenu).not.toHaveBeenCalled()
  })

  test('reports focus entering it, and takes the focus when the keyboard moves to it', async () => {
    const { row, onEntryFocus } = await setup({ isKeyboardSelected: true })
    await vi.waitFor(() => expect(document.activeElement).toBe(row))
    expect(onEntryFocus).toHaveBeenCalled()
  })

  test('hands a drop to the table', async () => {
    const { row, onEntryDrop } = await setup()
    const event = new Event('drop', { bubbles: true, cancelable: true })
    row.dispatchEvent(event)
    expect(onEntryDrop).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  test('is highlighted while a drag is over it, until the drag ends anywhere', async () => {
    const { row } = await setup()
    row.dispatchEvent(fileDragEvent('dragenter'))
    await nextTick()
    expect(row.classList.contains('selected')).toBe(true)
    // A drag cancelled elsewhere: only the document hears its end.
    document.body.dispatchEvent(new Event('dragend', { bubbles: true }))
    await nextTick()
    expect(row.classList.contains('selected')).toBe(false)
    row.dispatchEvent(fileDragEvent('dragenter'))
    await nextTick()
    expect(row.classList.contains('selected')).toBe(true)
    // Leaving the window: no related target.
    row.dispatchEvent(fileDragEvent('dragleave', null))
    await nextTick()
    expect(row.classList.contains('selected')).toBe(false)
  })

  test('held under a drag, opens the parent, and then the next one up', async () => {
    vi.useFakeTimers()
    const { row, props, open } = await setup()
    row.dispatchEvent(fileDragEvent('dragenter'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(open).toHaveBeenCalledTimes(1)
    // The drive moved up: the entry, still under the drag, now opens the folder above that.
    props.targetId = 'directory-grandparent'
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    expect(open).toHaveBeenCalledTimes(2)
    // Once the drag ends, moving on does not open anything more.
    document.body.dispatchEvent(new Event('drop', { bubbles: true }))
    props.targetId = 'directory-root'
    await nextTick()
    await vi.advanceTimersByTimeAsync(4000)
    expect(open).toHaveBeenCalledTimes(2)
  })

  test('shows a spinner instead of its icon while the parent folder opens', async () => {
    const { row } = await setup({ isOpening: true })
    expect(row.querySelector('svg use[href*="navigate_up"]')).toBeNull()
  })
})
