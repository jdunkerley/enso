import type { IDoesFilterPassParams } from 'ag-grid-community'
import { describe, expect, test, vi } from 'vitest'
import { CommunitySetFilter, type CommunitySetFilterParams } from '../CommunitySetFilter'

function makeFilter(values: string[]) {
  const filterChangedCallback = vi.fn()
  const filter = new CommunitySetFilter()
  const dataByValue = new Map(values.map((value) => [value, { col: value }]))
  filter.init({
    colDef: { field: 'col' },
    column: {},
    api: {},
    context: undefined,
    getValue: (node: { data: { col: string } }) => node.data.col,
    filterChangedCallback,
    filterModifiedCallback: vi.fn(),
    doesRowPassOtherFilter: () => true,
    rowModel: {},
    values: (params: { success: (values: string[]) => void }) => params.success(values),
  } as unknown as CommunitySetFilterParams)
  return { filter, filterChangedCallback, dataByValue }
}

describe('CommunitySetFilter', () => {
  test('starts with every value selected and the filter inactive', () => {
    const { filter } = makeFilter(['a', 'b', 'c'])
    expect(filter.isFilterActive()).toBe(false)
    expect(filter.getModel()).toBeNull()
  })

  test('unchecking a value narrows the model, marks the filter active, and notifies the grid', () => {
    const { filter, filterChangedCallback } = makeFilter(['a', 'b', 'c'])
    const checkboxes = filter.getGui().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    checkboxes[0]!.checked = false
    checkboxes[0]!.dispatchEvent(new Event('change'))

    expect(filter.isFilterActive()).toBe(true)
    expect(filter.getModel()).toEqual({
      filterType: 'set',
      values: ['b', 'c'],
    })
    expect(filterChangedCallback).toHaveBeenCalledTimes(1)
  })

  test('setModel round-trips a selection and re-renders the checkboxes', () => {
    const { filter } = makeFilter(['a', 'b', 'c'])
    filter.setModel({ filterType: 'set', values: ['b'] })

    expect(filter.getModel()).toEqual({ filterType: 'set', values: ['b'] })
    const checked = Array.from(
      filter.getGui().querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ).length
    expect(checked).toBe(1)
  })

  test('setModel(null) re-activates every value (de-activates the filter)', () => {
    const { filter } = makeFilter(['a', 'b', 'c'])
    filter.setModel({ filterType: 'set', values: ['b'] })
    filter.setModel(null)

    expect(filter.isFilterActive()).toBe(false)
    expect(filter.getModel()).toBeNull()
  })

  test('the search box narrows which checkboxes are rendered without changing the selection', () => {
    const { filter } = makeFilter(['apple', 'banana', 'cherry'])
    const search = filter.getGui().querySelector<HTMLInputElement>('.community-set-filter-search')!
    search.value = 'an'
    search.dispatchEvent(new Event('input'))

    const labels = Array.from(filter.getGui().querySelectorAll('.community-set-filter-option')).map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['banana'])
    // Narrowing the visible list must not itself change which values are selected.
    expect(filter.isFilterActive()).toBe(false)
  })

  test('doesFilterPass compares the cell value against the current selection', () => {
    const { filter } = makeFilter(['a', 'b', 'c'])
    filter.setModel({ filterType: 'set', values: ['b'] })

    const passParams = (value: string) =>
      ({ node: { data: { col: value } } }) as unknown as IDoesFilterPassParams

    expect(filter.doesFilterPass(passParams('b'))).toBe(true)
    expect(filter.doesFilterPass(passParams('a'))).toBe(false)
  })

  test('when no values callback is provided, derives the distinct values from the grid row data (client-side row model)', () => {
    const filterChangedCallback = vi.fn()
    const filter = new CommunitySetFilter()
    const rows = [{ col: 'x' }, { col: 'y' }, { col: 'x' }]
    filter.init({
      colDef: { field: 'col' },
      column: {},
      api: {
        forEachNode: (cb: (node: { data: { col: string } }) => void) =>
          rows.forEach((data) => cb({ data })),
      },
      context: undefined,
      getValue: (node: { data: { col: string } }) => node.data.col,
      filterChangedCallback,
      filterModifiedCallback: vi.fn(),
      doesRowPassOtherFilter: () => true,
      rowModel: {},
    } as unknown as CommunitySetFilterParams)

    expect(filter.getModel()).toBeNull()
    const labels = Array.from(filter.getGui().querySelectorAll('.community-set-filter-option')).map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['x', 'y'])
  })

  test('shows a "No values" message when there are zero distinct values', () => {
    const { filter } = makeFilter([])
    expect(filter.getGui().querySelector<HTMLElement>('.community-set-filter-empty')?.hidden).toBe(
      false,
    )
  })

  test('afterGuiAttached re-fetches values while preserving explicit deselection', () => {
    let currentValues: string[] = ['a', 'b', 'c']
    const filter = new CommunitySetFilter()
    filter.init({
      colDef: { field: 'col' },
      column: {},
      api: {},
      context: undefined,
      getValue: () => '',
      filterChangedCallback: vi.fn(),
      filterModifiedCallback: vi.fn(),
      doesRowPassOtherFilter: () => true,
      rowModel: {},
      values: (params: { success: (values: string[]) => void }) => params.success(currentValues),
    } as unknown as CommunitySetFilterParams)

    // Deselect 'b' (checkboxes render sorted: a, b, c) — 'b' survives the refresh below, so this
    // exercises "stays unchecked if still present after refresh".
    const checkboxes = filter.getGui().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    checkboxes[1]!.checked = false
    checkboxes[1]!.dispatchEvent(new Event('change'))
    expect(filter.getModel()).toEqual({ filterType: 'set', values: ['a', 'c'] })

    // 'c' disappears (dropped from both lists), 'a' and 'b' remain, 'd' newly appears (defaults
    // selected).
    currentValues = ['a', 'b', 'd']
    filter.afterGuiAttached?.()

    expect(filter.getModel()).toEqual({ filterType: 'set', values: ['a', 'd'] })
  })

  test('Select All and Clear buttons work', () => {
    const { filter, filterChangedCallback } = makeFilter(['a', 'b'])
    const clearButton = filter
      .getGui()
      .querySelector<HTMLButtonElement>('.community-set-filter-clear')!
    clearButton.click()
    expect(filter.getModel()).toEqual({ filterType: 'set', values: [] })

    const selectAllButton = filter
      .getGui()
      .querySelector<HTMLButtonElement>('.community-set-filter-select-all')!
    selectAllButton.click()
    expect(filter.getModel()).toBeNull()
    expect(filterChangedCallback).toHaveBeenCalled()
  })
})
