/** @file The lazy tree's state: the loaded pages, the open branches, and the rows they show. */
import { computed, shallowReactive, shallowRef } from 'vue'
import { isNodeExpression } from './treeExpression'
import type { PageResult, Prepared, TreeEntry, TreeKey, TreeNode } from './treeWire'

/** How many entries one `children` call, and one "Show more", asks for. */
export const PAGE_SIZE = 100

/** Fetches up to `count` children of the branch at `path`, from `start`. */
export type FetchPage = (
  path: readonly TreeKey[],
  start: number,
  count: number,
) => Promise<PageResult>

/** One row of the rendered tree. `path` is the entry's own path, or the branch a row ends. */
export type TreeRow =
  | { kind: 'root'; path: readonly TreeKey[]; depth: number; node: TreeNode }
  | {
      kind: 'entry'
      path: readonly TreeKey[]
      depth: number
      entry: TreeEntry
      expanded: boolean
      /** The node expressions from the root to this entry, or `null` if one is missing. */
      chain: readonly string[] | null
    }
  | {
      kind: 'more'
      path: readonly TreeKey[]
      depth: number
      shown: number
      total: number
    }
  | { kind: 'loading'; path: readonly TreeKey[]; depth: number }
  | { kind: 'error'; path: readonly TreeKey[]; depth: number; message: string }

interface PageState {
  readonly size: number
  readonly entries: readonly TreeEntry[]
  readonly loading: boolean
  readonly error: string | undefined
  readonly failed: { readonly start: number; readonly count: number } | undefined
}

/** A path's key in the state maps. `JSON.stringify` keeps the key `"1"` apart from index `1`. */
export function pathKey(path: readonly TreeKey[]): string {
  return JSON.stringify(path)
}

/** The chains of the entries beside `row` (its siblings and itself) that have one. */
export function siblingChains(rows: readonly TreeRow[], row: TreeRow): (readonly string[])[] {
  if (row.kind !== 'entry') return []
  const parent = pathKey(row.path.slice(0, -1))
  return rows.flatMap((other) =>
    other.kind === 'entry' && other.chain != null && pathKey(other.path.slice(0, -1)) === parent ?
      [other.chain]
    : [],
  )
}

/**
 * The state of one tree visualization. `setRoot` takes each new payload of `Tree.prepare`; open
 * branches stay open across payloads, and are fetched again with as many entries as they showed.
 */
export function useLazyTree(fetchPage: FetchPage) {
  const root = shallowRef<TreeNode>()
  const pages = shallowReactive(new Map<string, PageState>())
  const expanded = shallowReactive(new Map<string, readonly TreeKey[]>())
  /**
   * How many entries each branch (and the root) last had loaded. Unlike `pages`, it survives a new
   * payload, so a payload arriving while a refetch is still in flight refetches the full count.
   */
  const extent = new Map<string, number>()
  /** Bumped by each payload, so that a page asked for under an older one is dropped. */
  let generation = 0

  async function load(path: readonly TreeKey[], start: number, count: number) {
    const key = pathKey(path)
    const before = pages.get(key)
    if (before?.loading) return
    const asked = generation
    pages.set(key, {
      size: before?.size ?? 0,
      entries: before?.entries ?? [],
      loading: true,
      error: undefined,
      failed: undefined,
    })
    let result: PageResult
    try {
      result = await fetchPage(path, start, count)
    } catch (e) {
      result = { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
    const current = pages.get(key)
    if (asked !== generation || current == null) return
    if (!result.ok) {
      pages.set(key, {
        ...current,
        loading: false,
        error: result.message,
        failed: { start, count },
      })
      return
    }
    const entries = [...current.entries.slice(0, start), ...result.page.entries]
    extent.set(key, entries.length)
    pages.set(key, {
      size: result.page.size,
      entries,
      loading: false,
      error: undefined,
      failed: undefined,
    })
  }

  function setRoot(prepared: Prepared | undefined) {
    generation += 1
    pages.clear()
    root.value = prepared?.root
    if (prepared == null || !('children' in prepared)) {
      expanded.clear()
      extent.clear()
      return
    }
    const first = prepared.children
    pages.set(pathKey([]), {
      size: first.size,
      entries: first.entries,
      loading: false,
      error: undefined,
      failed: undefined,
    })
    const rootKey = pathKey([])
    const rootShown = extent.get(rootKey) ?? 0
    if (rootShown > first.entries.length && first.entries.length < first.size)
      void load([], first.entries.length, rootShown - first.entries.length)
    else extent.set(rootKey, first.entries.length)
    for (const [key, path] of expanded)
      void load(path, 0, Math.max(PAGE_SIZE, extent.get(key) ?? 0))
  }

  function toggle(path: readonly TreeKey[]) {
    const key = pathKey(path)
    if (expanded.delete(key)) return
    expanded.set(key, path)
    const page = pages.get(key)
    if (page == null || (page.entries.length === 0 && page.error != null))
      void load(path, 0, PAGE_SIZE)
  }

  function showMore(path: readonly TreeKey[]) {
    const page = pages.get(pathKey(path))
    if (page == null || page.loading) return
    void load(path, page.entries.length, PAGE_SIZE)
  }

  function retry(path: readonly TreeKey[]) {
    const failed = pages.get(pathKey(path))?.failed
    if (failed != null) void load(path, failed.start, failed.count)
  }

  function pushPage(
    rows: TreeRow[],
    path: readonly TreeKey[],
    depth: number,
    chain: readonly string[] | null,
  ) {
    const page = pages.get(pathKey(path))
    if (page == null) return
    for (const entry of page.entries) {
      const entryPath = [...path, entry.key]
      const entryChain =
        chain != null && entry.expr != null && isNodeExpression(entry.expr) ?
          [...chain, entry.expr]
        : null
      const open = entry.kind !== 'leaf' && expanded.has(pathKey(entryPath))
      rows.push({
        kind: 'entry',
        path: entryPath,
        depth,
        entry,
        expanded: open,
        chain: entryChain,
      })
      if (open) pushPage(rows, entryPath, depth + 1, entryChain)
    }
    if (page.loading) rows.push({ kind: 'loading', path, depth })
    else if (page.error != null) rows.push({ kind: 'error', path, depth, message: page.error })
    else if (page.entries.length < page.size)
      rows.push({
        kind: 'more',
        path,
        depth,
        shown: page.entries.length,
        total: page.size,
      })
  }

  const rows = computed<TreeRow[]>(() => {
    const node = root.value
    if (node == null) return []
    const result: TreeRow[] = [{ kind: 'root', path: [], depth: 0, node }]
    if (node.kind !== 'leaf') pushPage(result, [], 1, [])
    return result
  })

  return { rows, setRoot, toggle, showMore, retry }
}
