/**
 * @file Tidy up: a stream-based automatic layout for the graph editor.
 *
 * Each component hangs below the component feeding its `self` argument (or, lacking one, its
 * first input), which turns the graph into a forest of streams. Every chain of components is one
 * straight column; rows are packed per column. See
 * `docs/superpowers/specs/2026-09-26-tidy-up-layout-design.md`.
 */
import { Vec2 } from '@/util/data/vec2'

/** One component as the layout sees it. */
export interface LayoutComponent<Id> {
  readonly id: Id
  /** Rendered size, including an open visualization. */
  readonly size: Vec2
  /** Current top-left position. */
  readonly position: Vec2
  /** The in-scope component feeding this one's `self` argument, if any. */
  readonly selfSource?: Id | undefined
  /** In-scope components feeding this one, in argument order. */
  readonly inputs: readonly Id[]
  /** Code order, for tie-breaks. */
  readonly order: number
}

/** Gaps between components. */
export interface LayoutSpacing {
  readonly horizontal: number
  readonly vertical: number
}

/** The column order the layout is computed from; the crossing pass permutes these lists. */
export interface ColumnOrder<Id> {
  /** Roots of independent streams, left to right. */
  readonly roots: Id[]
  /** For each component, its branch children (all children but the column-continuing one), left to right. */
  readonly branches: Map<Id, Id[]>
}

/** The acyclic stream structure derived from the components. */
export interface StreamForest<Id> {
  readonly byId: ReadonlyMap<Id, LayoutComponent<Id>>
  /** Inputs actually used: de-duplicated, self-edges dropped, and any cycle broken. */
  readonly inputs: ReadonlyMap<Id, readonly Id[]>
  /** The child continuing each component's column, if it has children. */
  readonly mainChild: ReadonlyMap<Id, Id>
  /** Components in dependency order. */
  readonly topological: readonly Id[]
  /** The initial column order, taken from the current positions. */
  readonly initialOrder: ColumnOrder<Id>
}

const leftX = <Id>(c: LayoutComponent<Id>) => c.position.x
const byPosition = <Id>(a: LayoutComponent<Id>, b: LayoutComponent<Id>) =>
  leftX(a) - leftX(b) || a.order - b.order

/** Every map here is keyed by component id, so ids must be unique. */
function assertUniqueIds<Id>(components: readonly LayoutComponent<Id>[]): void {
  const seen = new Set<Id>()
  for (const c of components) {
    if (seen.has(c.id)) throw new Error(`streamLayout: duplicate component id ${String(c.id)}`)
    seen.add(c.id)
  }
}

/** Kahn's algorithm; returns undefined if `inputs` contains a cycle. */
function topologicalOrder<Id>(
  components: readonly LayoutComponent<Id>[],
  inputs: ReadonlyMap<Id, readonly Id[]>,
): Id[] | undefined {
  const remaining = new Map(components.map((c) => [c.id, inputs.get(c.id)!.length]))
  const dependents = new Map<Id, Id[]>(components.map((c) => [c.id, []]))
  for (const c of components) for (const i of inputs.get(c.id)!) dependents.get(i)!.push(c.id)
  const byOrder = [...components].sort((a, b) => a.order - b.order)
  const ready = byOrder.filter((c) => remaining.get(c.id) === 0).map((c) => c.id)
  const result: Id[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    result.push(id)
    for (const d of dependents.get(id)!) {
      const left = remaining.get(d)! - 1
      remaining.set(d, left)
      if (left === 0) ready.push(d)
    }
  }
  return result.length === components.length ? result : undefined
}

/** De-duplicated, self-edge-free inputs for every component, from its raw `inputs`. */
function cleanInputs<Id>(
  components: readonly LayoutComponent<Id>[],
  byId: ReadonlyMap<Id, LayoutComponent<Id>>,
): Map<Id, Id[]> {
  return new Map(
    components.map((c) => [c.id, [...new Set(c.inputs)].filter((i) => byId.has(i) && i !== c.id)]),
  )
}

/** Build the stream forest: acyclic inputs, parents, the column-continuing child, and initial order. */
export function buildForest<Id>(components: readonly LayoutComponent<Id>[]): StreamForest<Id> {
  assertUniqueIds(components)
  const byId = new Map(components.map((c) => [c.id, c]))
  let inputs = cleanInputs(components, byId)
  let topological = topologicalOrder(components, inputs)
  if (topological == null) {
    // A cycle (only possible in broken code): drop every edge from a later-in-code-order source.
    inputs = new Map(
      components.map((c) => [c.id, inputs.get(c.id)!.filter((i) => byId.get(i)!.order < c.order)]),
    )
    topological = topologicalOrder(components, inputs)!
  }

  const parent = new Map<Id, Id>()
  for (const c of components) {
    const own = inputs.get(c.id)!
    const p = c.selfSource != null && own.includes(c.selfSource) ? c.selfSource : own[0]
    if (p != null) parent.set(c.id, p)
  }
  const children = new Map<Id, LayoutComponent<Id>[]>()
  for (const [child, p] of parent) {
    const list = children.get(p) ?? []
    list.push(byId.get(child)!)
    children.set(p, list)
  }

  const mainChild = new Map<Id, Id>()
  const branches = new Map<Id, Id[]>()
  for (const [p, kids] of children) {
    const px = leftX(byId.get(p)!)
    const main = [...kids].sort(
      (a, b) => Math.abs(leftX(a) - px) - Math.abs(leftX(b) - px) || a.order - b.order,
    )[0]!
    mainChild.set(p, main.id)
    branches.set(
      p,
      kids
        .filter((k) => k.id !== main.id)
        .sort(byPosition)
        .map((k) => k.id),
    )
  }
  const roots = components
    .filter((c) => !parent.has(c.id))
    .sort(byPosition)
    .map((c) => c.id)

  return {
    byId,
    inputs,
    mainChild,
    topological,
    initialOrder: { roots, branches },
  }
}

/**
 * Positions for a given column order, before anchoring (top-left of the result is (0, 0)).
 *
 * Assigns each subtree's columns contiguously: a component's main child continues its column, and
 * only once that whole subtree's columns are assigned do the component's branches each open their
 * own new column, in `order`'s current left-to-right sequence. A subtree's columns therefore
 * always form one contiguous block, wherever it sits among its siblings.
 */
export function placeColumns<Id>(
  forest: StreamForest<Id>,
  order: ColumnOrder<Id>,
  spacing: LayoutSpacing,
): Map<Id, Vec2> {
  return placeColumnsAtRows(forest, order, spacing, rowTops(forest, spacing))
}

/**
 * `placeColumns`, but with every component's row (top y) precomputed, since rows never depend on
 * column order: a caller placing many candidate column orders in a row (the crossing pass) can
 * compute them once and reuse them, rather than have every call redo it. Kept internal, unlike
 * `placeColumns`, so a caller can't pass rows that don't cover every id in `order`.
 */
function placeColumnsAtRows<Id>(
  forest: StreamForest<Id>,
  order: ColumnOrder<Id>,
  spacing: LayoutSpacing,
  rows: ReadonlyMap<Id, number>,
): Map<Id, Vec2> {
  const column = new Map<Id, number>()
  let nextColumn = 0
  const assign = (id: Id, col: number) => {
    column.set(id, col)
    const main = forest.mainChild.get(id)
    if (main != null) assign(main, col)
    for (const b of order.branches.get(id) ?? []) assign(b, nextColumn++)
  }
  for (const root of order.roots) assign(root, nextColumn++)

  const widths = Array.from({ length: nextColumn }, () => 0)
  for (const [id, col] of column) widths[col] = Math.max(widths[col]!, forest.byId.get(id)!.size.x)
  const columnX: number[] = []
  let x = 0
  for (const w of widths) {
    columnX.push(x)
    x += w + spacing.horizontal
  }

  const result = new Map<Id, Vec2>()
  for (const [id, col] of column) {
    // Left-aligned: a component sits at its column's left edge, since the self input — the
    // continuing edge into the column — is always the leftmost port.
    result.set(id, new Vec2(columnX[col]!, rows.get(id)!))
  }
  return result
}

/**
 * Every component's row (top y), packed per column. Column order never affects this: it depends
 * only on the forest's dependency structure, so it can be computed once and reused.
 */
function rowTops<Id>(forest: StreamForest<Id>, spacing: LayoutSpacing): Map<Id, number> {
  const top = new Map<Id, number>()
  for (const id of forest.topological) {
    const ins = forest.inputs.get(id)!
    top.set(
      id,
      ins.length === 0 ?
        0
      : Math.max(...ins.map((i) => top.get(i)! + forest.byId.get(i)!.size.y)) + spacing.vertical,
    )
  }
  return top
}

/** A dependency edge: `from` feeds `to`. */
interface Edge<Id> {
  readonly from: Id
  readonly to: Id
}

/**
 * A straight line from the source's bottom centre to the target's top centre. This stays
 * centre-to-centre even though components are left-aligned in their column: it is only a
 * heuristic for scoring *column order* in the crossing pass, not a claim about where an edge is
 * actually drawn, so it doesn't need to track the real left-aligned positions.
 */
interface Segment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))

/** Whether segments `a` and `b`, which share no endpoint, cross. */
function segmentsCross(a: Segment, b: Segment): boolean {
  // Disjoint bounding boxes can't intersect; this rejects most non-crossing pairs cheaply.
  if (
    Math.max(a.x1, a.x2) < Math.min(b.x1, b.x2) ||
    Math.max(b.x1, b.x2) < Math.min(a.x1, a.x2) ||
    Math.max(a.y1, a.y2) < Math.min(b.y1, b.y2) ||
    Math.max(b.y1, b.y2) < Math.min(a.y1, a.y2)
  )
    return false
  const d1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1)
  const d2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
  const d3 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1)
  const d4 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2)
  return d1 * d2 < 0 && d3 * d4 < 0
}

const sharesEndpoint = <Id>(a: Edge<Id>, b: Edge<Id>) =>
  a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to

/** The layout's edges: cleaned inputs (de-duplicated, no self-edges) for every component. */
function edgesOf<Id>(
  components: readonly LayoutComponent<Id>[],
  byId: ReadonlyMap<Id, LayoutComponent<Id>>,
  inputs?: ReadonlyMap<Id, readonly Id[]>,
): Edge<Id>[] {
  const table = inputs ?? cleanInputs(components, byId)
  const edges: Edge<Id>[] = []
  for (const c of components)
    for (const from of table.get(c.id) ?? []) edges.push({ from, to: c.id })
  return edges
}

function segmentOf<Id>(
  byId: ReadonlyMap<Id, LayoutComponent<Id>>,
  positions: ReadonlyMap<Id, Vec2>,
  edge: Edge<Id>,
): Segment | undefined {
  const src = byId.get(edge.from)
  const dst = byId.get(edge.to)
  const sp = positions.get(edge.from)
  const tp = positions.get(edge.to)
  if (src == null || dst == null || sp == null || tp == null) return undefined
  return {
    x1: sp.x + src.size.x / 2,
    y1: sp.y + src.size.y,
    x2: tp.x + dst.size.x / 2,
    y2: tp.y,
  }
}

/**
 * Number of pairs of edges that cross, modelling each edge as a segment from the source's bottom
 * centre to the target's top centre.
 *
 * `inputs`, if given, is the cleaned input list to read edges from (as `StreamForest.inputs`);
 * without it, every component's own `inputs` are cleaned the same way (de-duplicated, self-edges
 * dropped) before use.
 */
export function countCrossings<Id>(
  components: readonly LayoutComponent<Id>[],
  positions: ReadonlyMap<Id, Vec2>,
  inputs?: ReadonlyMap<Id, readonly Id[]>,
): number {
  const byId = new Map(components.map((c) => [c.id, c]))
  const edges = edgesOf(components, byId, inputs)
  const segments = edges.map((e) => segmentOf(byId, positions, e))
  let crossings = 0
  for (let i = 0; i < edges.length; i++) {
    const si = segments[i]
    if (si == null) continue
    for (let j = i + 1; j < edges.length; j++) {
      const sj = segments[j]
      if (sj == null || sharesEndpoint(edges[i]!, edges[j]!)) continue
      if (segmentsCross(si, sj)) crossings++
    }
  }
  return crossings
}

/**
 * For every edge, the indices of the other edges whose y-range overlaps it (a straight segment
 * can only cross another that spans some of the same vertical range). Rows never depend on column
 * order, so this is fixed for the whole crossing pass and only needs computing once, however many
 * candidate swaps are tried.
 */
function yOverlapNeighbors<Id>(
  edges: readonly Edge<Id>[],
  byId: ReadonlyMap<Id, LayoutComponent<Id>>,
  top: ReadonlyMap<Id, number>,
): number[][] {
  const range = edges.map((e) => {
    const y1 = top.get(e.from)! + byId.get(e.from)!.size.y
    const y2 = top.get(e.to)!
    return y1 < y2 ? [y1, y2] : [y2, y1]
  })
  const byMin = edges.map((_, i) => i).sort((a, b) => range[a]![0]! - range[b]![0]!)
  const neighbors: number[][] = edges.map(() => [])
  const active: number[] = []
  for (const i of byMin) {
    for (let k = active.length - 1; k >= 0; k--) {
      if (range[active[k]!]![1]! < range[i]![0]!) active.splice(k, 1)
    }
    for (const j of active) {
      neighbors[i]!.push(j)
      neighbors[j]!.push(i)
    }
    active.push(i)
  }
  return neighbors
}

/** For every component id, the indices of the edges it is an endpoint of. */
function incidentEdges<Id>(edges: readonly Edge<Id>[]): Map<Id, number[]> {
  const incident = new Map<Id, number[]>()
  edges.forEach((e, i) => {
    for (const id of [e.from, e.to]) {
      const list = incident.get(id)
      if (list != null) list.push(i)
      else incident.set(id, [i])
    }
  })
  return incident
}

/** Indices of the edges with an endpoint in `movedIds` (looked up via `incident`, not scanned for). */
function touchingEdges<Id>(
  incident: ReadonlyMap<Id, readonly number[]>,
  movedIds: ReadonlySet<Id>,
): ReadonlySet<number> {
  const touching = new Set<number>()
  for (const id of movedIds) for (const idx of incident.get(id) ?? []) touching.add(idx)
  return touching
}

/**
 * A memoised lookup of every edge's segment under whichever positions `current()` returns right
 * now, valid for as long as that stays the same object. The crossing pass calls `current()`
 * before evaluating each candidate swap, so a whole round of swap attempts that all still share
 * the layout's last-accepted positions reuse the same cached segments, computed at most once each.
 */
function segmentCache<Id>(
  edges: readonly Edge<Id>[],
  byId: ReadonlyMap<Id, LayoutComponent<Id>>,
  current: () => ReadonlyMap<Id, Vec2>,
): (i: number) => Segment | undefined {
  let forPositions: ReadonlyMap<Id, Vec2> | undefined
  let cache: (Segment | undefined)[] = []
  return (i: number) => {
    const positions = current()
    if (positions !== forPositions) {
      forPositions = positions
      cache = new Array(edges.length)
    }
    const cached = cache[i]
    if (cached != null) return cached
    const s = segmentOf(byId, positions, edges[i]!)
    if (s != null) cache[i] = s
    return s
  }
}

/**
 * Number of crossings among `touching` — pairs where at least one edge is in it — restricted to
 * pairs whose rows overlap (`neighbors`), reading each edge's segment from `segmentAt`. Given the
 * same `touching` set (the edges incident to the two subtrees a candidate swap would move), calling
 * this once with a lookup for the positions before the swap and once for after gives the exact
 * change in the total crossing count: every other edge's segment is unchanged by the swap, so only
 * these pairs can change. Cost scales with the size of `touching`, not with the whole graph.
 */
function crossingsTouching<Id>(
  edges: readonly Edge<Id>[],
  neighbors: readonly (readonly number[])[],
  touching: ReadonlySet<number>,
  segmentAt: (i: number) => Segment | undefined,
): number {
  let crossings = 0
  for (const i of touching) {
    for (const j of neighbors[i] ?? []) {
      // Each touching↔touching pair is visited from both sides; count it once, when i < j.
      if (touching.has(j) && i >= j) continue
      const e1 = edges[i]!
      const e2 = edges[j]!
      if (sharesEndpoint(e1, e2)) continue
      const s1 = segmentAt(i)
      const s2 = segmentAt(j)
      if (s1 == null || s2 == null) continue
      if (segmentsCross(s1, s2)) crossings++
    }
  }
  return crossings
}

/**
 * Number of crossings among every edge, restricted to pairs whose rows overlap (`neighbors`).
 * Equivalent to `countCrossings` on the same edge set, but reuses the precomputed y-overlap index
 * instead of testing every pair, so it is cheap to call again after a swap that moves too much of
 * the graph for `crossingsTouching`'s incremental scoring to be worth it.
 */
function crossingsAll<Id>(
  edges: readonly Edge<Id>[],
  neighbors: readonly (readonly number[])[],
  byId: ReadonlyMap<Id, LayoutComponent<Id>>,
  positions: ReadonlyMap<Id, Vec2>,
): number {
  const segments = edges.map((e) => segmentOf(byId, positions, e))
  let crossings = 0
  for (let i = 0; i < edges.length; i++) {
    const si = segments[i]
    if (si == null) continue
    for (const j of neighbors[i] ?? []) {
      if (j <= i) continue
      const sj = segments[j]
      if (sj == null || sharesEndpoint(edges[i]!, edges[j]!)) continue
      if (segmentsCross(si, sj)) crossings++
    }
  }
  return crossings
}

/** Shift `positions` so their top-left equals the components' current top-left. */
function anchor<Id>(
  components: readonly LayoutComponent<Id>[],
  positions: Map<Id, Vec2>,
): Map<Id, Vec2> {
  const originX = Math.min(...components.map((c) => c.position.x))
  const originY = Math.min(...components.map((c) => c.position.y))
  const minX = Math.min(...[...positions.values()].map((p) => p.x))
  const minY = Math.min(...[...positions.values()].map((p) => p.y))
  const result = new Map<Id, Vec2>()
  for (const [id, p] of positions)
    result.set(id, new Vec2(p.x - minX + originX, p.y - minY + originY))
  return result
}

/** Every id's subtree: itself, its main child's whole subtree, and every branch's whole subtree. */
function subtreeIndex<Id>(forest: StreamForest<Id>): (id: Id) => ReadonlySet<Id> {
  const cache = new Map<Id, ReadonlySet<Id>>()
  const subtreeOf = (id: Id): ReadonlySet<Id> => {
    const cached = cache.get(id)
    if (cached != null) return cached
    const set = new Set<Id>([id])
    const main = forest.mainChild.get(id)
    if (main != null) for (const m of subtreeOf(main)) set.add(m)
    for (const b of forest.initialOrder.branches.get(id) ?? [])
      for (const d of subtreeOf(b)) set.add(d)
    cache.set(id, set)
    return set
  }
  return subtreeOf
}

/** Options for {@link streamLayout}. */
export interface StreamLayoutOptions {
  /** Clock for the crossing pass's time budget. Injectable so a test can force it to expire. */
  readonly now?: () => number
}

/**
 * The crossing pass's wall-clock budget. On a pathological graph the pass can take many rounds of
 * adjacent swaps to settle; past this many milliseconds it stops and keeps the best order found so
 * far rather than let a single Tidy up run indefinitely.
 */
const CROSSING_PASS_BUDGET_MS = 300

/** Lay out `components` as a top-to-bottom flow of straight columns; returns new top-left positions. */
export function streamLayout<Id>(
  components: readonly LayoutComponent<Id>[],
  spacing: LayoutSpacing,
  options: StreamLayoutOptions = {},
): Map<Id, Vec2> {
  if (components.length === 0) return new Map()
  const forest = buildForest(components)
  const order: ColumnOrder<Id> = {
    roots: [...forest.initialOrder.roots],
    branches: new Map([...forest.initialOrder.branches].map(([k, v]) => [k, [...v]])),
  }
  const groups: Id[][] = [order.roots, ...order.branches.values()].filter((g) => g.length > 1)
  const edges = edgesOf(components, forest.byId, forest.inputs)
  // Membership of a subtree never changes as the pass permutes `order` — only sibling order
  // does — so it is safe, and enough, to compute this once.
  const subtreeOf = subtreeIndex(forest)
  // Rows, and so which edges could possibly cross at all, never depend on column order — compute
  // all of this once and reuse it for every candidate swap instead of rescanning the whole graph.
  const top = rowTops(forest, spacing)
  const neighbors = yOverlapNeighbors(edges, forest.byId, top)
  const incident = incidentEdges(edges)

  let positions = placeColumnsAtRows(forest, order, spacing, top)
  let best = crossingsAll(edges, neighbors, forest.byId, positions)
  // Segments for the current (last-accepted) positions, memoised: a whole round of swap attempts
  // shares these positions until one is accepted, so this computes each edge's segment at most
  // once per accepted swap rather than once per candidate.
  const stableSegmentAt = segmentCache(edges, forest.byId, () => positions)
  // One optimisation pass over column order only: keep an adjacent swap iff it strictly reduces
  // crossings, so ties keep the user's order and a tidied graph stays unchanged. Runs to a local
  // optimum — crossings is a non-negative integer that strictly drops on every kept swap, so this
  // always terminates — rather than a fixed number of rounds, so the result really is stable.
  //
  // A swap never moves a component's row, only its column, and only within the two swapped
  // subtrees; every other position is unchanged. That holds even when the two subtrees have
  // different widths: they are adjacent, contiguous blocks of columns, so swapping them only
  // reorders columns inside the span they already share. Its total width, and so the x of every
  // column after it, is the same either way. For a small pair of subtrees, `crossingsTouching`
  // re-scores only the edges touching them, once against the positions before the swap and once
  // after, instead of recounting the whole graph — and even for the "after" positions, only the
  // touching edges' segments actually differ from `stableSegmentAt`, so those are the only ones
  // computed fresh. But on a widely-branching tree a swap near the root can move most of the
  // graph, at which point the two partial counts (plus the bookkeeping to find what they touch)
  // cost more than one `crossingsAll` on the result — so past a certain number of touched edges,
  // this falls back to that instead. The cutoff was tuned empirically against
  // `streamLayout.bench.ts`'s uniform-parent benchmark, not chosen as half the edge count: with
  // parents spread uniformly across the graph rather than clustered locally, most edges end up
  // sharing a row, so `crossingsTouching`'s cost stops scaling down long before touching reaches
  // half of them. The cutoff is well below the point the two approaches cost the same.
  //
  // Pathological inputs (see the same bench) can still take rounds of adjacent swaps to settle, so
  // the pass carries a wall-clock budget: once `CROSSING_PASS_BUDGET_MS` has elapsed, it stops and
  // keeps the best order found so far, which is always a valid, non-overlapping layout — every
  // accepted swap already placed one. This can only cost idempotence on the pathological graphs
  // that hit the budget in the first place; every case fast enough to finish keeps the guarantee.
  const now = options.now ?? (() => performance.now())
  const deadline = now() + CROSSING_PASS_BUDGET_MS
  let timedOut = false
  while (best > 0 && !timedOut) {
    let improved = false
    for (const group of groups) {
      for (let i = 0; i + 1 < group.length; i++) {
        if (now() >= deadline) {
          timedOut = true
          break
        }
        const movedIds = new Set(subtreeOf(group[i]!))
        for (const id of subtreeOf(group[i + 1]!)) movedIds.add(id)
        const touching = touchingEdges(incident, movedIds)
        const useFullCount = touching.size > 40 // tuned against the adversarial uniform-parent benchmark
        const before =
          useFullCount ? 0 : crossingsTouching(edges, neighbors, touching, stableSegmentAt)
        ;[group[i], group[i + 1]] = [group[i + 1]!, group[i]!]
        const candidate = placeColumnsAtRows(forest, order, spacing, top)
        let crossings: number
        if (useFullCount) {
          crossings = crossingsAll(edges, neighbors, forest.byId, candidate)
        } else {
          const fresh = new Map<number, Segment>()
          const afterSegmentAt = (idx: number): Segment | undefined => {
            if (!touching.has(idx)) return stableSegmentAt(idx)
            const cached = fresh.get(idx)
            if (cached != null) return cached
            const s = segmentOf(forest.byId, candidate, edges[idx]!)
            if (s != null) fresh.set(idx, s)
            return s
          }
          crossings = best - before + crossingsTouching(edges, neighbors, touching, afterSegmentAt)
        }
        if (crossings < best) {
          best = crossings
          positions = candidate
          improved = true
        } else {
          ;[group[i], group[i + 1]] = [group[i + 1]!, group[i]!]
        }
      }
      if (timedOut) break
    }
    if (!improved) break
  }
  if (timedOut) {
    console.warn(
      'Tidy up: the crossing-minimisation pass hit its time budget and stopped early; layout ' +
        'quality may be reduced. Running Tidy up again may move things further.',
    )
  }
  return anchor(components, positions)
}
