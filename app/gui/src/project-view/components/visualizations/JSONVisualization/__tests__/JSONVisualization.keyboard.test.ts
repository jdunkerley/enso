/** @file The JSON tree used from the keyboard: roving focus, expanding, Enter and the entry menu. */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import JSONVisualization from '../JSONVisualization.vue'

const createNodes = vi.hoisted(() => vi.fn())
const executeExpression = vi.hoisted(() => vi.fn())
vi.mock('@/util/visualizationBuiltins', () => ({
  useVisualizationConfig: () => ({
    createNodes,
    executeExpression,
    setToolbar: vi.fn(),
  }),
}))

/** `name`, `address` (a branch of two entries), `raw` (no expression), and a "Show more" row. */
const TREE = {
  root: { kind: 'object', size: 4, label: '{4 keys}' },
  children: {
    start: 0,
    size: 4,
    entries: [
      { key: 'name', kind: 'leaf', value: 'John', expr: ".get 'name'" },
      { key: 'address', kind: 'object', size: 2, label: '{2 keys}', expr: ".get 'address'" },
      { key: 'raw', kind: 'leaf', value: 1, expr: null },
    ],
  },
}
const ADDRESS_PAGE = {
  start: 0,
  size: 2,
  entries: [
    { key: 'city', kind: 'leaf', value: 'Rome', expr: ".get 'city'" },
    { key: 'zip', kind: 'leaf', value: '00100', expr: ".get 'zip'" },
  ],
}

beforeEach(() => {
  createNodes.mockClear()
  executeExpression.mockReset()
  executeExpression.mockResolvedValue({ ok: true, value: ADDRESS_PAGE })
})
afterEach(() => {
  document.body.innerHTML = ''
})

/** Replaces the tree's payload (the host the harness mounts it in owns its props). */
let setTreeData: (data: unknown) => Promise<void>

async function mountTree() {
  const { wrapper, setProps } = await mountWithProviders(JSONVisualization, {
    props: { data: TREE },
    global: { stubs: { GridPopupMenu: true } },
    attachTo: document.body,
  })
  setTreeData = (data) => setProps({ data })
  return wrapper
}
type Tree = Awaited<ReturnType<typeof mountTree>>

/** The row element of an entry (or `more`) by its key text. */
function row(wrapper: Tree, key: string): HTMLElement {
  const found = wrapper.findAll('.TreeRow').find((candidate) =>
    key === 'more' || key === 'error' ? candidate.classes(key)
    : candidate.find('.key').exists() ? candidate.find('.key').text() === key
    : false,
  )
  if (found == null) throw new Error(`no row ${key}`)
  return found.element
}

async function press(
  element: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  element.dispatchEvent(event)
  await flushPromises()
  return event
}

function focused(): string {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.classList.contains('TreeRow')) return '(none)'
  return (
    active.classList.contains('more') ? 'more'
    : active.classList.contains('error') ? 'error'
    : (active.querySelector('.key')?.textContent ?? '')
  )
}

function popup(wrapper: Tree) {
  return wrapper.findComponent({ name: 'GridPopupMenu' })
}

function nodeTexts(options: readonly NodeCreationOptions[]) {
  return options.map(({ content }) => {
    if (!(content instanceof Pattern)) throw new Error('not a pattern')
    return content.instantiateCopied([Ast.parseExpression('data')!]).code()
  })
}

describe('the tree as an ARIA tree', () => {
  test('the scroller is a tree, and its entries are tree items with a level', async () => {
    const wrapper = await mountTree()
    expect(wrapper.find('[data-testid="tree-scroller"]').attributes('role')).toBe('tree')
    expect(row(wrapper, 'name').getAttribute('role')).toBe('treeitem')
    expect(row(wrapper, 'name').getAttribute('aria-level')).toBe('1')
  })

  test('a branch says whether it is expanded, a leaf says nothing', async () => {
    const wrapper = await mountTree()
    expect(row(wrapper, 'address').getAttribute('aria-expanded')).toBe('false')
    expect(row(wrapper, 'name').hasAttribute('aria-expanded')).toBe(false)
    await press(row(wrapper, 'address'), 'ArrowRight')
    expect(row(wrapper, 'address').getAttribute('aria-expanded')).toBe('true')
    expect(row(wrapper, 'city').getAttribute('aria-level')).toBe('2')
  })
})

describe('one tab stop', () => {
  test('only the first entry is tabbable at first; the buttons inside rows are not', async () => {
    const wrapper = await mountTree()
    const stops = wrapper
      .findAll('.TreeRow, .TreeRow button')
      .filter((element) => element.attributes('tabindex') === '0')
    expect(stops.map((element) => element.element)).toEqual([row(wrapper, 'name')])
    expect(wrapper.find('button.arrow').attributes('tabindex')).toBe('-1')
    expect(wrapper.find('.TreeRow.more button').attributes('tabindex')).toBe('-1')
  })

  test('the tab stop follows the focused entry', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'address').focus()
    await flushPromises()
    expect(row(wrapper, 'address').getAttribute('tabindex')).toBe('0')
    expect(row(wrapper, 'name').getAttribute('tabindex')).toBe('-1')
  })
})

describe('moving between entries', () => {
  test('ArrowDown and ArrowUp move focus through the visible entries', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    expect((await press(row(wrapper, 'name'), 'ArrowDown')).defaultPrevented).toBe(true)
    expect(focused()).toBe('address')
    await press(row(wrapper, 'address'), 'ArrowDown')
    expect(focused()).toBe('raw')
    await press(row(wrapper, 'raw'), 'ArrowDown')
    expect(focused()).toBe('more')
    await press(row(wrapper, 'more'), 'ArrowUp')
    expect(focused()).toBe('raw')
  })

  test('ArrowUp on the first entry and ArrowDown on the last stay where they are', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ArrowUp')
    expect(focused()).toBe('name')
    row(wrapper, 'more').focus()
    await press(row(wrapper, 'more'), 'ArrowDown')
    expect(focused()).toBe('more')
  })

  test('ArrowDown from an open branch goes into its entries', async () => {
    const wrapper = await mountTree()
    await press(row(wrapper, 'address'), 'ArrowRight')
    row(wrapper, 'address').focus()
    await press(row(wrapper, 'address'), 'ArrowDown')
    expect(focused()).toBe('city')
  })
})

describe('expanding and collapsing', () => {
  test('ArrowRight opens a closed branch, then moves into it', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'address').focus()
    await press(row(wrapper, 'address'), 'ArrowRight')
    expect(executeExpression).toHaveBeenCalledOnce()
    expect(row(wrapper, 'address').getAttribute('aria-expanded')).toBe('true')
    expect(focused()).toBe('address')
    await press(row(wrapper, 'address'), 'ArrowRight')
    expect(focused()).toBe('city')
  })

  test('ArrowRight on a leaf does nothing', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ArrowRight')
    expect(focused()).toBe('name')
    expect(executeExpression).not.toHaveBeenCalled()
  })

  test('ArrowLeft closes an open branch', async () => {
    const wrapper = await mountTree()
    await press(row(wrapper, 'address'), 'ArrowRight')
    row(wrapper, 'address').focus()
    await press(row(wrapper, 'address'), 'ArrowLeft')
    expect(row(wrapper, 'address').getAttribute('aria-expanded')).toBe('false')
    expect(wrapper.findAll('.TreeRow.entry')).toHaveLength(3)
    expect(focused()).toBe('address')
  })

  test('ArrowLeft on an entry of a branch goes to the branch', async () => {
    const wrapper = await mountTree()
    await press(row(wrapper, 'address'), 'ArrowRight')
    row(wrapper, 'zip').focus()
    await press(row(wrapper, 'zip'), 'ArrowLeft')
    expect(focused()).toBe('address')
  })

  test('ArrowLeft on a closed top-level entry does nothing', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'address').focus()
    await press(row(wrapper, 'address'), 'ArrowLeft')
    expect(focused()).toBe('address')
    expect(row(wrapper, 'address').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Enter', () => {
  test('makes the entry node, as a double-click does', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    expect((await press(row(wrapper, 'name'), 'Enter')).defaultPrevented).toBe(true)
    expect(nodeTexts(createNodes.mock.calls[0]!)).toEqual(["data.get 'name'"])
  })

  test('with Shift makes a node for each loaded entry beside it', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'Enter', { shiftKey: true })
    expect(nodeTexts(createNodes.mock.calls[0]!)).toEqual(["data.get 'name'", "data.get 'address'"])
  })

  test('makes nothing on an entry no expression reaches', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'raw').focus()
    await press(row(wrapper, 'raw'), 'Enter')
    expect(createNodes).not.toHaveBeenCalled()
  })

  test('on "Show more" asks for the next entries', async () => {
    executeExpression.mockResolvedValue({
      ok: true,
      value: {
        start: 3,
        size: 4,
        entries: [{ key: 'extra', kind: 'leaf', value: 1, expr: ".get 'extra'" }],
      },
    })
    const wrapper = await mountTree()
    row(wrapper, 'more').focus()
    await press(row(wrapper, 'more'), 'Enter')
    expect(executeExpression).toHaveBeenCalledOnce()
    expect(wrapper.find('.TreeRow.more').exists()).toBe(false)
  })
})

describe('the focus while a page loads', () => {
  const MORE_PAGE = {
    start: 3,
    size: 4,
    entries: [{ key: 'extra', kind: 'leaf', value: 1, expr: ".get 'extra'" }],
  }

  /** A request that is answered when the test says so. */
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
  }

  test('Show more keeps the focus on the entry above, then moves it to the first new entry', async () => {
    const answer = deferred<unknown>()
    executeExpression.mockReturnValue(answer.promise)
    const wrapper = await mountTree()
    row(wrapper, 'more').focus()
    await press(row(wrapper, 'more'), 'Enter')
    expect(wrapper.find('.TreeRow.loading').exists()).toBe(true)
    expect(focused()).toBe('raw')
    answer.resolve({ ok: true, value: MORE_PAGE })
    await flushPromises()
    expect(focused()).toBe('extra')
  })

  test('Show more leaves a focus that moved on while it loaded alone', async () => {
    const answer = deferred<unknown>()
    executeExpression.mockReturnValue(answer.promise)
    const wrapper = await mountTree()
    row(wrapper, 'more').focus()
    await press(row(wrapper, 'more'), 'Enter')
    await press(row(wrapper, 'raw'), 'ArrowUp')
    expect(focused()).toBe('address')
    answer.resolve({ ok: true, value: MORE_PAGE })
    await flushPromises()
    expect(focused()).toBe('address')
  })

  describe('Retry', () => {
    async function failedAddress() {
      executeExpression.mockResolvedValueOnce({ ok: false, error: { payload: 'boom' } })
      const wrapper = await mountTree()
      row(wrapper, 'address').focus()
      await press(row(wrapper, 'address'), 'ArrowRight')
      expect(wrapper.find('.TreeRow.error').exists()).toBe(true)
      return wrapper
    }

    test('keeps the focus on the entry above, then moves it to the first entry it loads', async () => {
      const wrapper = await failedAddress()
      const answer = deferred<unknown>()
      executeExpression.mockReturnValue(answer.promise)
      row(wrapper, 'error').focus()
      await press(row(wrapper, 'error'), 'Enter')
      expect(wrapper.find('.TreeRow.loading').exists()).toBe(true)
      expect(focused()).toBe('address')
      answer.resolve({ ok: true, value: ADDRESS_PAGE })
      await flushPromises()
      expect(focused()).toBe('city')
    })

    test('puts the focus back on the failed row when it fails again', async () => {
      const wrapper = await failedAddress()
      executeExpression.mockResolvedValue({ ok: false, error: { payload: 'still' } })
      row(wrapper, 'error').focus()
      await press(row(wrapper, 'error'), 'Enter')
      expect(wrapper.find('.TreeRow.error').text()).toContain('still')
      expect(focused()).toBe('error')
    })
  })

  test('a mouse click on Show more keeps the focus too', async () => {
    const answer = deferred<unknown>()
    executeExpression.mockReturnValue(answer.promise)
    const wrapper = await mountTree()
    const button = wrapper.find('.TreeRow.more button').element as HTMLElement
    button.focus()
    button.click()
    await flushPromises()
    expect(focused()).toBe('raw')
    answer.resolve({ ok: true, value: MORE_PAGE })
    await flushPromises()
    expect(focused()).toBe('extra')
  })
})

describe('the entry menu from the keyboard', () => {
  function placeAt(element: HTMLElement) {
    const content = element.querySelector('.content')!
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      x: 40,
      y: 100,
      left: 40,
      right: 140,
      top: 100,
      bottom: 120,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    })
  }

  test.each([
    ['the context-menu key', 'ContextMenu', {}],
    ['Shift+F10', 'F10', { shiftKey: true }],
  ])('%s opens the menu at the entry, with focus in it', async (_name, key, init) => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    placeAt(row(wrapper, 'name'))
    const event = await press(row(wrapper, 'name'), key, init)
    expect(event.defaultPrevented).toBe(true)
    expect(popup(wrapper).exists()).toBe(true)
    expect(popup(wrapper).props('point')).toEqual({ x: 40, y: 120 })
    expect(popup(wrapper).props('focusFirst')).toBe(true)
    expect(
      popup(wrapper)
        .props('items')
        .map((item: { name?: string }) => item.name),
    ).toEqual(['Get Value', 'Get All Loaded Values Here'])
  })

  test('is not opened on an entry no expression reaches', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'raw').focus()
    await press(row(wrapper, 'raw'), 'ContextMenu')
    expect(popup(wrapper).exists()).toBe(false)
  })

  test('a right-click opens the menu without taking the focus for it', async () => {
    const wrapper = await mountTree()
    wrapper
      .find('.TreeRow.entry .content')
      .element.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 2 }),
      )
    await flushPromises()
    expect(popup(wrapper).props('focusFirst')).toBe(false)
  })

  test('closing the menu returns the focus to its entry', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ContextMenu')
    ;(document.activeElement as HTMLElement).blur()
    popup(wrapper).vm.$emit('close')
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('name')
  })

  /** Opens the menu on `name`, then drops the focus as the real menu's removal would. */
  async function openKeyboardMenu(wrapper: Tree) {
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ContextMenu')
    ;(document.activeElement as HTMLElement).blur()
  }

  test('a click outside closes the menu and leaves the focus to the click', async () => {
    const wrapper = await mountTree()
    await openKeyboardMenu(wrapper)
    popup(wrapper).vm.$emit('close', 'pointer')
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('(none)')
  })

  test('scrolling closes the menu and returns the focus to its entry', async () => {
    const wrapper = await mountTree()
    await openKeyboardMenu(wrapper)
    wrapper.find('[data-testid="tree-scroller"]').element.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('name')
  })

  test('a new payload closes the menu and returns the focus to its entry', async () => {
    const wrapper = await mountTree()
    await openKeyboardMenu(wrapper)
    await setTreeData({ ...TREE })
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('name')
  })

  test('a new payload without the entry sends the focus to the first row', async () => {
    const wrapper = await mountTree()
    await openKeyboardMenu(wrapper)
    await setTreeData({
      ...TREE,
      children: { ...TREE.children, entries: TREE.children.entries.slice(1) },
    })
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('address')
  })

  // Escape itself is the popup's (`GridPopupMenu`, stubbed here and tested there): it asks to close
  // and the tree gives the focus back to the entry.
  test('the popup asking to close (Escape) returns the focus to the entry', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ContextMenu')
    popup(wrapper).vm.$emit('close')
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('name')
  })

  test('a scroll of the tree closes a keyboard-opened menu and returns the focus', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ContextMenu')
    expect(popup(wrapper).exists()).toBe(true)
    await wrapper.find('[data-testid="tree-scroller"]').trigger('scroll')
    await flushPromises()
    expect(popup(wrapper).exists()).toBe(false)
    expect(focused()).toBe('name')
  })

  test('Escape with no menu open is left to the graph', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    await press(row(wrapper, 'name'), 'Escape')
    window.removeEventListener('keydown', reached)
    expect(reached).toHaveBeenCalledOnce()
  })
})

describe('keys stay in the tree', () => {
  test.each([
    ['ArrowDown', {}],
    ['ArrowUp', {}],
    ['ArrowRight', {}],
    ['ArrowLeft', {}],
    ['Enter', {}],
    ['ContextMenu', {}],
    ['F10', { shiftKey: true }],
  ])('%s does not reach the graph editor on the window', async (key, init) => {
    const wrapper = await mountTree()
    row(wrapper, 'address').focus()
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    await press(row(wrapper, 'address'), key, init)
    window.removeEventListener('keydown', reached)
    expect(reached).not.toHaveBeenCalled()
  })

  test('Tab and other keys are left alone', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    const tab = await press(row(wrapper, 'name'), 'Tab')
    await press(row(wrapper, 'name'), 'a')
    window.removeEventListener('keydown', reached)
    expect(tab.defaultPrevented).toBe(false)
    expect(reached).toHaveBeenCalledTimes(2)
  })

  test('F10 without Shift is left alone, and opens no menu', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    await press(row(wrapper, 'name'), 'F10')
    window.removeEventListener('keydown', reached)
    expect(reached).toHaveBeenCalledOnce()
    expect(popup(wrapper).exists()).toBe(false)
  })

  test('a modified arrow key is left alone', async () => {
    const wrapper = await mountTree()
    row(wrapper, 'name').focus()
    await press(row(wrapper, 'name'), 'ArrowDown', { ctrlKey: true })
    expect(focused()).toBe('name')
  })
})
