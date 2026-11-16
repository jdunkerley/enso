/** @file The JSON tree's toolbar and its right-click menu on an entry. */
import type { ToValue } from '$/utils/reactivity'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import type { GridMenuItem } from '@/components/shared/AgGridTableView/gridPopupMenuItems'
import { isActionButton, type ToolbarItem } from '@/components/visualizations/toolbar'
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { flushPromises } from '@vue/test-utils'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { toValue } from 'vue'
import { pinnedDir } from '../../__tests__/pinnedGoldens'
import JSONVisualization from '../JSONVisualization.vue'

const toolbar = vi.hoisted(() => ({ current: undefined as ToValue<ToolbarItem[]> | undefined }))
const createNodes = vi.hoisted(() => vi.fn())
vi.mock('@/util/visualizationBuiltins', () => ({
  useVisualizationConfig: () => ({
    createNodes,
    executeExpression: vi.fn(),
    setToolbar: (items: ToValue<ToolbarItem[]>) => {
      toolbar.current = items
    },
  }),
}))

const PLAIN = {
  id: 'remove_missing',
  label: 'Remove Missing',
  icon: 'not_exclamation',
  kind: 'chain',
  template: 'remove_missing',
}
const NEEDS_A_GESTURE = {
  id: 'open_row',
  label: 'Get Item',
  icon: 'select_row',
  kind: 'chain',
  template: 'at {{#index}}',
}
const LEAF_ROOT = { root: { kind: 'leaf', value: 1 } }

async function buttons(data: unknown) {
  await mountWithProviders(JSONVisualization, { props: { data } })
  return (toValue(toolbar.current) ?? []).filter(isActionButton)
}

beforeEach(() => {
  toolbar.current = undefined
  createNodes.mockClear()
})

describe('the JSON tree toolbar', () => {
  test('a plain action of the root is a button that creates its node', async () => {
    const [button, ...others] = await buttons({ ...LEAF_ROOT, actions: [PLAIN] })
    expect(others).toHaveLength(0)
    expect(button?.title).toBe('Remove Missing')
    button?.onClick()
    expect(createNodes).toHaveBeenCalledOnce()
  })

  test('an action that needs a gesture is no button', async () => {
    expect(await buttons({ ...LEAF_ROOT, actions: [NEEDS_A_GESTURE, PLAIN] })).toHaveLength(1)
  })

  test('a root with no actions has no button', async () => {
    expect(await buttons(LEAF_ROOT)).toHaveLength(0)
  })
})

describe('the pinned Enso goldens', () => {
  const names = readdirSync(pinnedDir).filter((name) => /^tree_prepare_.*\.json$/.test(name))

  test.each(names)('%s adds no toolbar button', async (name) => {
    const golden: unknown = JSON.parse(readFileSync(path.join(pinnedDir, name), 'utf8'))
    expect(await buttons(golden)).toHaveLength(0)
  })
})

describe('the right-click menu on a tree entry', () => {
  const TREE = {
    root: { kind: 'object', size: 3, label: '{3 keys}' },
    children: {
      start: 0,
      size: 3,
      entries: [
        { key: 'name', kind: 'leaf', value: 'John', expr: ".get 'name'" },
        { key: 'age', kind: 'leaf', value: 3, expr: ".get 'age'" },
        { key: 'raw', kind: 'leaf', value: 1, expr: null },
      ],
    },
  }

  /** Mounts the tree; `GridPopupMenu` is stubbed, as it teleports and needs an interaction handler. */
  function mountTreeWithProps() {
    return mountWithProviders(JSONVisualization, {
      props: { data: TREE },
      global: { stubs: { GridPopupMenu: true } },
    })
  }
  async function mountTree() {
    return (await mountTreeWithProps()).wrapper
  }
  type Tree = Awaited<ReturnType<typeof mountTree>>

  function content(wrapper: Tree, key: string) {
    const found = wrapper
      .findAll('.TreeRow.entry .content')
      .find((element) => element.find('.key').text() === key)
    if (found == null) throw new Error(`no entry ${key}`)
    return found
  }

  async function rightClick(element: ReturnType<typeof content>) {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 12,
      clientY: 34,
    })
    const reached = vi.fn()
    document.body.addEventListener('contextmenu', reached, { once: true })
    element.element.dispatchEvent(event)
    document.body.removeEventListener('contextmenu', reached)
    await flushPromises()
    return { event, reachedBody: reached.mock.calls.length > 0 }
  }

  function menuItems(wrapper: Tree): GridMenuItem[] {
    return wrapper.findComponent({ name: 'GridPopupMenu' }).props('items')
  }

  function action(item: GridMenuItem | undefined) {
    if (item?.type !== 'item') throw new Error('not a menu item')
    return item.action
  }

  test('offers Get Value and Get All Loaded Values Here, at the pointer', async () => {
    const wrapper = await mountTree()
    await rightClick(content(wrapper, 'name'))
    const popup = wrapper.findComponent({ name: 'GridPopupMenu' })
    expect(popup.exists()).toBe(true)
    expect(popup.props('point')).toEqual({ x: 12, y: 34 })
    expect(menuItems(wrapper).map((item) => (item.type === 'item' ? item.name : '-'))).toEqual([
      'Get Value',
      'Get All Loaded Values Here',
    ])
  })

  test('Get Value makes the entry node, and Get All one for each loaded entry', async () => {
    const wrapper = await mountTree()
    await rightClick(content(wrapper, 'name'))
    const [getValue, getAll] = menuItems(wrapper)
    action(getValue)()
    expect(createNodes).toHaveBeenCalledOnce()
    expect(nodeTexts(createNodes.mock.calls[0]!)).toEqual(["data.get 'name'"])
    createNodes.mockClear()
    action(getAll)()
    expect(nodeTexts(createNodes.mock.calls[0]!)).toEqual(["data.get 'name'", "data.get 'age'"])
    expect(createNodes.mock.calls[0]!.every((option) => option.commit === true)).toBe(true)
  })

  test('is not offered, and nothing is made, for an entry no expression reaches', async () => {
    const wrapper = await mountTree()
    await rightClick(content(wrapper, 'raw'))
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(false)
    expect(createNodes).not.toHaveBeenCalled()
  })

  test('a second right-click moves the menu to the new entry, and closing removes it', async () => {
    const wrapper = await mountTree()
    await rightClick(content(wrapper, 'name'))
    await rightClick(content(wrapper, 'age'))
    action(menuItems(wrapper)[0])()
    expect(nodeTexts(createNodes.mock.calls[0]!)).toEqual(["data.get 'age'"])
    wrapper.findComponent({ name: 'GridPopupMenu' }).vm.$emit('close')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(false)
  })

  test('a right-click on an entry with no expression closes a menu left open', async () => {
    const wrapper = await mountTree()
    await rightClick(content(wrapper, 'name'))
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(true)
    await rightClick(content(wrapper, 'raw'))
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(false)
  })

  test('the tooltip of an entry with an expression names the right-click menu as well', async () => {
    const wrapper = await mountTree()
    const title = content(wrapper, 'name').attributes('title') ?? ''
    expect(title).toContain('Double-click')
    expect(title).toContain('right-click')
    expect(title).toContain('Shift+double-click')
  })

  test('the tooltip of an entry with no expression promises no menu', async () => {
    const wrapper = await mountTree()
    expect(content(wrapper, 'raw').attributes('title') ?? '').not.toContain('right-click')
  })

  async function openOn(wrapper: Tree, key: string) {
    await rightClick(content(wrapper, key))
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(true)
  }

  function menuIsOpen(wrapper: Tree) {
    return wrapper.findComponent({ name: 'GridPopupMenu' }).exists()
  }

  test('scrolling the tree closes the menu', async () => {
    const wrapper = await mountTree()
    await openOn(wrapper, 'name')
    await wrapper.find('[data-testid="tree-scroller"]').trigger('scroll')
    expect(menuIsOpen(wrapper)).toBe(false)
  })

  test('a new tree payload closes the menu', async () => {
    const { wrapper, setProps } = await mountTreeWithProps()
    await openOn(wrapper, 'name')
    await setProps({ data: { ...TREE } })
    expect(menuIsOpen(wrapper)).toBe(false)
  })

  test('Escape closes the menu, and only while it is open', async () => {
    const wrapper = await mountTree()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(menuIsOpen(wrapper)).toBe(false)
    await openOn(wrapper, 'name')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(menuIsOpen(wrapper)).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(menuIsOpen(wrapper)).toBe(false)
  })

  test.each(['name', 'raw'])(
    'a right-click on %s keeps the native and the graph menus away',
    async (key) => {
      const wrapper = await mountTree()
      const { event, reachedBody } = await rightClick(content(wrapper, key))
      expect(event.defaultPrevented).toBe(true)
      expect(reachedBody).toBe(false)
    },
  )
})

/** The text of the nodes `createNodes` was asked for, each made on a node called `data`. */
function nodeTexts(options: readonly NodeCreationOptions[]) {
  return options.map(({ content }) => {
    if (!(content instanceof Pattern)) throw new Error('not a pattern')
    return content.instantiateCopied([Ast.parseExpression('data')!]).code()
  })
}
