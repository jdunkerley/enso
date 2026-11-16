import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import {
  entryMenu,
  PAGE_SIZE,
  siblingChains,
  useLazyTree,
  type FetchPage,
  type TreeRow,
} from '../lazyTree'
import { nodeExpressionPattern } from '../treeExpression'
import type { PageResult, Prepared, TreeEntry } from '../treeWire'

function leaf(key: string | number, value: unknown, expr: string | null = null): TreeEntry {
  return { key, kind: 'leaf', value, expr }
}

function items(start: number, end: number): TreeEntry[] {
  return Array.from({ length: end - start }, (_, i) =>
    leaf(start + i, start + i, `.at ${start + i}`),
  )
}

const prepared: Prepared = {
  root: { kind: 'object', size: 4, label: '{4 keys}' },
  children: {
    start: 0,
    size: 4,
    entries: [
      leaf('name', 'John', ".get 'name'"),
      {
        key: 'items',
        kind: 'array',
        size: 250,
        label: '[250 items]',
        expr: ".get 'items'",
      },
      { key: 'raw', kind: 'array', size: 1, label: '[1 item]', expr: null },
      {
        key: 'broken',
        kind: 'object',
        size: 1,
        label: '{1 key}',
        expr: ".get 'broken'",
      },
    ],
  },
}

/** Answers 250 items under `items` and `raw`, and fails under anything else. */
function fakeFetch() {
  return vi.fn<FetchPage>(async (path, start, count) =>
    path[0] === 'items' || path[0] === 'raw' ?
      {
        ok: true,
        page: {
          start,
          size: 250,
          entries: items(start, Math.min(250, start + count)),
        },
      }
    : { ok: false, message: 'boom' },
  )
}

function summary(row: TreeRow): string {
  switch (row.kind) {
    case 'root':
      return `root ${row.node.kind === 'leaf' ? JSON.stringify(row.node.value) : row.node.label}`
    case 'entry': {
      const shown = row.entry.kind === 'leaf' ? JSON.stringify(row.entry.value) : row.entry.label
      return `${row.depth} ${row.entry.key}: ${shown}${row.expanded ? ' (open)' : ''}`
    }
    case 'more':
      return `${row.depth} more ${row.shown}/${row.total}`
    case 'loading':
      return `${row.depth} loading`
    case 'error':
      return `${row.depth} error ${row.message}`
  }
}

function summaries(rows: readonly TreeRow[]) {
  return rows.map(summary)
}

describe('useLazyTree', () => {
  test('shows the root and its first page', () => {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot(prepared)
    expect(summaries(tree.rows.value)).toEqual([
      'root {4 keys}',
      '1 name: "John"',
      '1 items: [250 items]',
      '1 raw: [1 item]',
      '1 broken: {1 key}',
    ])
  })

  test('shows a leaf root as one row', () => {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot({ root: { kind: 'leaf', value: 42 } })
    expect(summaries(tree.rows.value)).toEqual(['root 42'])
  })

  test('shows nothing for data that is not a tree', () => {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot(undefined)
    expect(tree.rows.value).toEqual([])
  })

  test('expanding a branch loads its first page and offers more', async () => {
    const fetchPage = fakeFetch()
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    expect(fetchPage).toHaveBeenCalledWith(['items'], 0, PAGE_SIZE)
    expect(summaries(tree.rows.value).slice(2, 4)).toEqual([
      '1 items: [250 items] (open)',
      '2 loading',
    ])
    await flushPromises()
    const rows = summaries(tree.rows.value)
    expect(rows[3]).toBe('2 0: 0')
    expect(rows[102]).toBe('2 99: 99')
    expect(rows[103]).toBe('2 more 100/250')
    expect(rows[104]).toBe('1 raw: [1 item]')
  })

  test('show more appends the next page until the branch is complete', async () => {
    const fetchPage = fakeFetch()
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    tree.showMore(['items'])
    expect(fetchPage).toHaveBeenLastCalledWith(['items'], 100, PAGE_SIZE)
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('2 more 200/250')
    tree.showMore(['items'])
    await flushPromises()
    const rows = summaries(tree.rows.value)
    expect(rows).toContain('2 249: 249')
    expect(rows.some((row) => row.includes('more'))).toBe(false)
  })

  test('collapsing hides the children and expanding again reuses them', async () => {
    const fetchPage = fakeFetch()
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    tree.toggle(['items'])
    expect(tree.rows.value).toHaveLength(5)
    tree.toggle(['items'])
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(tree.rows.value).toHaveLength(5 + 101)
  })

  test('a new payload fetches the open branches again, as many entries as were shown', async () => {
    const fetchPage = fakeFetch()
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    tree.showMore(['items'])
    await flushPromises()
    tree.setRoot(prepared)
    expect(fetchPage).toHaveBeenLastCalledWith(['items'], 0, 200)
    await flushPromises()
    const rows = summaries(tree.rows.value)
    expect(rows).toContain('1 items: [250 items] (open)')
    expect(rows).toContain('2 199: 199')
    expect(rows).toContain('2 more 200/250')
  })

  test('a page that arrives after a new payload is ignored', async () => {
    const resolvers: ((result: PageResult) => void)[] = []
    const fetchPage = vi.fn<FetchPage>(() => new Promise((resolve) => resolvers.push(resolve)))
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    tree.setRoot(prepared)
    expect(resolvers).toHaveLength(2)
    resolvers[0]!({
      ok: true,
      page: { start: 0, size: 250, entries: items(0, 1) },
    })
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('2 loading')
    resolvers[1]!({
      ok: true,
      page: { start: 0, size: 250, entries: items(0, 2) },
    })
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('2 1: 1')
  })

  test('a failed page shows its message, and retry asks again', async () => {
    const fetchPage = fakeFetch()
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['broken'])
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('2 error boom')
    expect(summaries(tree.rows.value)).toContain('1 name: "John"')
    tree.retry(['broken'])
    expect(fetchPage).toHaveBeenLastCalledWith(['broken'], 0, PAGE_SIZE)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  test('a second payload during a refetch still refetches the full count of a branch', async () => {
    const resolvers: ((result: PageResult) => void)[] = []
    let hold = false
    const base = fakeFetch()
    const fetchPage = vi.fn<FetchPage>((path, start, count) =>
      hold ? new Promise((resolve) => resolvers.push(resolve)) : base(path, start, count),
    )
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    tree.showMore(['items'])
    await flushPromises()
    hold = true
    tree.setRoot(prepared)
    tree.setRoot(prepared)
    expect(fetchPage).toHaveBeenLastCalledWith(['items'], 0, 200)
    expect(resolvers).toHaveLength(2)
    resolvers[1]!({ ok: true, page: { start: 0, size: 250, entries: items(0, 200) } })
    await flushPromises()
    const rows = summaries(tree.rows.value)
    expect(rows).toContain('2 199: 199')
    expect(rows).toContain('2 more 200/250')
  })

  test('a second payload during a refetch still extends the root to the shown count', async () => {
    const big: Prepared = {
      root: { kind: 'array', size: 300, label: '[300 items]' },
      children: { start: 0, size: 300, entries: items(0, 100) },
    }
    const resolvers: ((result: PageResult) => void)[] = []
    let hold = false
    const fetchPage = vi.fn<FetchPage>((_path, start, count) =>
      hold ?
        new Promise((resolve) => resolvers.push(resolve))
      : Promise.resolve({
          ok: true,
          page: { start, size: 300, entries: items(start, Math.min(300, start + count)) },
        }),
    )
    const tree = useLazyTree(fetchPage)
    tree.setRoot(big)
    tree.showMore([])
    await flushPromises()
    tree.showMore([])
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('1 299: 299')
    hold = true
    tree.setRoot(big)
    expect(fetchPage).toHaveBeenLastCalledWith([], 100, 200)
    tree.setRoot(big)
    expect(fetchPage).toHaveBeenLastCalledWith([], 100, 200)
    expect(resolvers).toHaveLength(2)
    resolvers[1]!({ ok: true, page: { start: 100, size: 300, entries: items(100, 300) } })
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('1 299: 299')
  })

  test('a rejected fetch shows the error row, and retry recovers', async () => {
    let reject = true
    const base = fakeFetch()
    const fetchPage = vi.fn<FetchPage>((path, start, count) =>
      reject ? Promise.reject(new Error('timed out')) : base(path, start, count),
    )
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    expect(summaries(tree.rows.value)).toEqual([
      'root {4 keys}',
      '1 name: "John"',
      '1 items: [250 items] (open)',
      '2 error timed out',
      '1 raw: [1 item]',
      '1 broken: {1 key}',
    ])
    reject = false
    tree.retry(['items'])
    expect(summaries(tree.rows.value)).toContain('2 loading')
    await flushPromises()
    const rows = summaries(tree.rows.value)
    expect(rows).toContain('2 99: 99')
    expect(rows).toContain('2 more 100/250')
    expect(rows.some((row) => row.includes('error'))).toBe(false)
  })

  test('a rejection that arrives after a new payload is ignored', async () => {
    const pending: { resolve: (r: PageResult) => void; reject: (e: unknown) => void }[] = []
    const fetchPage = vi.fn<FetchPage>(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    )
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    tree.setRoot(prepared)
    expect(pending).toHaveLength(2)
    pending[0]!.reject(new Error('late'))
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('2 loading')
    expect(summaries(tree.rows.value).some((row) => row.includes('error'))).toBe(false)
    pending[1]!.resolve({ ok: true, page: { start: 0, size: 250, entries: items(0, 2) } })
    await flushPromises()
    expect(summaries(tree.rows.value)).toContain('2 1: 1')
  })

  test('a failed show more keeps the entries already loaded', async () => {
    let failing = false
    const base = fakeFetch()
    const fetchPage = vi.fn<FetchPage>(async (path, start, count) =>
      failing ? { ok: false, message: 'nope' } : base(path, start, count),
    )
    const tree = useLazyTree(fetchPage)
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    failing = true
    tree.showMore(['items'])
    await flushPromises()
    const rows = summaries(tree.rows.value)
    expect(rows).toContain('2 99: 99')
    expect(rows).toContain('2 error nope')
    failing = false
    tree.retry(['items'])
    expect(fetchPage).toHaveBeenLastCalledWith(['items'], 100, PAGE_SIZE)
  })

  test('node expressions chain from the root and stop under an entry with none', async () => {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot(prepared)
    tree.toggle(['items'])
    tree.toggle(['raw'])
    await flushPromises()
    const chainOf = (path: (string | number)[]) =>
      tree.rows.value.find(
        (row) => row.kind === 'entry' && JSON.stringify(row.path) === JSON.stringify(path),
      )
    const item = chainOf(['items', 3])
    const raw = chainOf(['raw', 3])
    expect(item?.kind === 'entry' && item.chain).toEqual([".get 'items'", '.at 3'])
    expect(raw?.kind === 'entry' && raw.chain).toBeNull()
  })

  test('siblingChains gives the chains of every loaded entry beside a row', async () => {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    const row = tree.rows.value.find((r) => r.kind === 'entry' && r.path[1] === 5)!
    const chains = siblingChains(tree.rows.value, row)
    expect(chains).toHaveLength(100)
    expect(chains[0]).toEqual([".get 'items'", '.at 0'])
  })
})

describe('entryMenu', () => {
  async function loaded() {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot(prepared)
    tree.toggle(['items'])
    await flushPromises()
    return tree.rows.value
  }

  function entryAt(rows: readonly TreeRow[], path: (string | number)[]) {
    const row = rows.find(
      (r) => r.kind === 'entry' && JSON.stringify(r.path) === JSON.stringify(path),
    )
    if (row?.kind !== 'entry') throw new Error(`no entry at ${JSON.stringify(path)}`)
    return row
  }

  test('offers the entry and its loaded siblings', async () => {
    const rows = await loaded()
    const entry = entryAt(rows, ['items', 5])
    const menu = entryMenu(rows, entry)
    expect(menu.map((m) => m.name)).toEqual(['Get Value', 'Get All Loaded Values Here'])
    expect(menu[0]!.chains).toEqual([[".get 'items'", '.at 5']])
    expect(menu[1]!.chains).toEqual(siblingChains(rows, entry))
    expect(menu[1]!.chains).toHaveLength(100)
  })

  test('has an icon for each entry', async () => {
    const rows = await loaded()
    expect(entryMenu(rows, entryAt(rows, ['name'])).map((m) => m.icon)).toEqual([
      'select_cell',
      'select_row',
    ])
  })

  test('is empty for an entry no expression reaches', async () => {
    const tree = useLazyTree(fakeFetch())
    tree.setRoot(prepared)
    tree.toggle(['raw'])
    await flushPromises()
    const rows = tree.rows.value
    expect(entryMenu(rows, entryAt(rows, ['raw']))).toEqual([])
    expect(entryMenu(rows, entryAt(rows, ['raw', 0]))).toEqual([])
  })

  test('is empty for a row that is not an entry', async () => {
    const rows = await loaded()
    expect(rows.some((r) => r.kind !== 'entry')).toBe(true)
    for (const row of rows.filter((r) => r.kind !== 'entry'))
      expect(entryMenu(rows, row)).toEqual([])
  })

  test('offers nothing that makes no node', () => {
    // A bare `__` step is a second hole: the builder gives no pattern for it.
    const stepWithHole = leaf('hole', 1, '.get __')
    const rows = useLazyTreeRows({
      ...prepared,
      children: { ...prepared.children, entries: [stepWithHole] },
    })
    const entry = entryAt(rows, ['hole'])
    expect(entry.chain).toEqual(['.get __'])
    expect(nodeExpressionPattern(entry.chain!)).toBeUndefined()
    expect(entryMenu(rows, entry)).toEqual([])
  })

  test('leaves a sibling with no pattern out of the loaded values', () => {
    const rows = useLazyTreeRows({
      ...prepared,
      children: {
        ...prepared.children,
        entries: [leaf('a', 1, ".get 'a'"), leaf('hole', 2, '.get __')],
      },
    })
    const menu = entryMenu(rows, entryAt(rows, ['a']))
    expect(menu.map((m) => m.name)).toEqual(['Get Value', 'Get All Loaded Values Here'])
    expect(menu[1]!.chains).toEqual([[".get 'a'"]])
  })
})

function useLazyTreeRows(payload: Prepared): readonly TreeRow[] {
  const tree = useLazyTree(fakeFetch())
  tree.setRoot(payload)
  return tree.rows.value
}
