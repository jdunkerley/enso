import { expect, test, vi } from 'vitest'
import { resolveGridMenuItems, type GridMenuContext } from '../gridPopupMenuItems'

function makeContext(overrides: Partial<GridMenuContext> = {}): GridMenuContext {
  return {
    api: {
      autoSizeColumns: vi.fn(),
      autoSizeAllColumns: vi.fn(),
      exportDataAsCsv: vi.fn(),
    } as any,
    column: { getColId: () => 'colA' } as any,
    node: { data: { value: 1 } } as any,
    ...overrides,
  }
}

test('passes through a custom menu item, binding its action to {node, api}', () => {
  const action = vi.fn()
  const ctx = makeContext()
  const [item] = resolveGridMenuItems([{ name: 'Do Thing', icon: '<svg/>', action }], ctx)

  expect(item).toMatchObject({
    type: 'item',
    name: 'Do Thing',
    icon: '<svg/>',
  })
  if (item?.type !== 'item') throw new Error('expected an item')
  item.action()
  expect(action).toHaveBeenCalledWith({ node: ctx.node, api: ctx.api })
})

test("'separator' becomes a divider", () => {
  const [item] = resolveGridMenuItems(['separator'], makeContext())
  expect(item).toEqual({ type: 'separator' })
})

test("'autoSizeThis' calls api.autoSizeColumns with the clicked column's id", () => {
  const ctx = makeContext()
  const [item] = resolveGridMenuItems(['autoSizeThis'], ctx)
  if (item?.type !== 'item') throw new Error('expected an item')
  item.action()
  expect(ctx.api.autoSizeColumns).toHaveBeenCalledWith(['colA'])
})

test("'autoSizeThis' is dropped when there is no column in context", () => {
  const items = resolveGridMenuItems(['autoSizeThis'], makeContext({ column: null }))
  expect(items).toEqual([])
})

test("'autoSizeAll' calls api.autoSizeAllColumns", () => {
  const ctx = makeContext()
  const [item] = resolveGridMenuItems(['autoSizeAll'], ctx)
  if (item?.type !== 'item') throw new Error('expected an item')
  item.action()
  expect(ctx.api.autoSizeAllColumns).toHaveBeenCalled()
})

test("'export' maps to CSV export only (Excel export is out of scope)", () => {
  const ctx = makeContext()
  const [item] = resolveGridMenuItems(['export'], ctx)
  expect(item?.name).toBe('Export to CSV')
  if (item?.type !== 'item') throw new Error('expected an item')
  item.action()
  expect(ctx.api.exportDataAsCsv).toHaveBeenCalled()
})

test('an unrecognized built-in token is dropped with a warning, not thrown', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const items = resolveGridMenuItems(['someFutureAgGridToken'], makeContext())
  expect(items).toEqual([])
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('a non-string icon (DOM Element) is dropped rather than rendered, since nothing in this codebase produces one', () => {
  const el = document.createElement('span')
  const [item] = resolveGridMenuItems([{ name: 'X', icon: el, action: vi.fn() }], makeContext())
  if (item?.type !== 'item') throw new Error('expected an item')
  expect(item.icon).toBeUndefined()
})

test('built-in menu items carry an icon', () => {
  // `export` shipped without one, so "Export to CSV" rendered with a blank icon slot.
  const [item] = resolveGridMenuItems(['export'], makeContext())
  if (item?.type !== 'item') throw new Error('expected an item')
  expect(item.icon).toBeTruthy()
})

test('AG Grid icon-font spans are replaced with Enso sprite icons', () => {
  // These render blank in GridPopupMenu: the `ag-icon` glyphs come from the AG Grid theme
  // stylesheet, which is scoped to the grid's shadow root, while the popup is in the light DOM.
  const agIcon = '<span class="ag-icon ag-icon-copy" unselectable="on" role="presentation"></span>'
  const [item] = resolveGridMenuItems(
    [{ name: 'Copy', icon: agIcon, action: vi.fn() }],
    makeContext(),
  )
  if (item?.type !== 'item') throw new Error('expected an item')
  expect(item.icon).not.toContain('ag-icon')
  expect(item.icon).toContain('<svg')
})

test('a non-AG-Grid icon is passed through untouched', () => {
  const custom = '<svg id="mine"/>'
  const [item] = resolveGridMenuItems([{ name: 'X', icon: custom, action: vi.fn() }], makeContext())
  if (item?.type !== 'item') throw new Error('expected an item')
  expect(item.icon).toBe(custom)
})
