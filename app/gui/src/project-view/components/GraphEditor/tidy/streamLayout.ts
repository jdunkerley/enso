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
  /** Inputs actually used, after breaking any cycle. */
  readonly inputs: ReadonlyMap<Id, readonly Id[]>
  /** The child continuing each component's column, if it has children. */
  readonly mainChild: ReadonlyMap<Id, Id>
  /** Components in dependency order. */
  readonly topological: readonly Id[]
  /** The initial column order, taken from the current positions. */
  readonly initialOrder: ColumnOrder<Id>
}

const centreX = <Id>(c: LayoutComponent<Id>) => c.position.x + c.size.x / 2
const byPosition = <Id>(a: LayoutComponent<Id>, b: LayoutComponent<Id>) =>
  centreX(a) - centreX(b) || a.order - b.order

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

/** Build the stream forest: acyclic inputs, parents, the column-continuing child, and initial order. */
export function buildForest<Id>(components: readonly LayoutComponent<Id>[]): StreamForest<Id> {
  const byId = new Map(components.map((c) => [c.id, c]))
  let inputs = new Map(
    components.map((c) => [c.id, [...new Set(c.inputs)].filter((i) => byId.has(i) && i !== c.id)]),
  )
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
    const px = centreX(byId.get(p)!)
    const main = [...kids].sort(
      (a, b) => Math.abs(centreX(a) - px) - Math.abs(centreX(b) - px) || a.order - b.order,
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

/** Positions for a given column order, before anchoring (top-left of the result is (0, 0)). */
export function placeColumns<Id>(
  forest: StreamForest<Id>,
  order: ColumnOrder<Id>,
  spacing: LayoutSpacing,
): Map<Id, Vec2> {
  const column = new Map<Id, number>()
  let nextColumn = 0
  const assign = (id: Id, col: number) => {
    column.set(id, col)
    const branchCols = (order.branches.get(id) ?? []).map(() => nextColumn++)
    const main = forest.mainChild.get(id)
    if (main != null) assign(main, col)
    ;(order.branches.get(id) ?? []).forEach((b, i) => assign(b, branchCols[i]!))
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

  const result = new Map<Id, Vec2>()
  for (const [id, col] of column) {
    const c = forest.byId.get(id)!
    result.set(id, new Vec2(columnX[col]! + (widths[col]! - c.size.x) / 2, top.get(id)!))
  }
  return result
}

/** Number of pairs of edges that cross, modelling each edge as a segment from the source's bottom centre to the target's top centre. */
export function countCrossings<Id>(
  components: readonly LayoutComponent<Id>[],
  positions: ReadonlyMap<Id, Vec2>,
): number {
  const byId = new Map(components.map((c) => [c.id, c]))
  type Segment = {
    from: Id
    to: Id
    x1: number
    y1: number
    x2: number
    y2: number
  }
  const segments: Segment[] = []
  for (const c of components) {
    const tp = positions.get(c.id)
    if (tp == null) continue
    for (const i of c.inputs) {
      const src = byId.get(i)
      const sp = positions.get(i)
      if (src == null || sp == null) continue
      segments.push({
        from: i,
        to: c.id,
        x1: sp.x + src.size.x / 2,
        y1: sp.y + src.size.y,
        x2: tp.x + c.size.x / 2,
        y2: tp.y,
      })
    }
  }
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
  let crossings = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i]!
      const t = segments[j]!
      if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue
      const d1 = orient(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1)
      const d2 = orient(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2)
      const d3 = orient(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1)
      const d4 = orient(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2)
      if (d1 * d2 < 0 && d3 * d4 < 0) crossings++
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

/** Rounds of adjacent-swap optimisation the crossing pass runs before giving up. */
export const MAX_CROSSING_ROUNDS = 4

/** Lay out `components` as a top-to-bottom flow of straight columns; returns new top-left positions. */
export function streamLayout<Id>(
  components: readonly LayoutComponent<Id>[],
  spacing: LayoutSpacing,
): Map<Id, Vec2> {
  if (components.length === 0) return new Map()
  const forest = buildForest(components)
  const order: ColumnOrder<Id> = {
    roots: [...forest.initialOrder.roots],
    branches: new Map([...forest.initialOrder.branches].map(([k, v]) => [k, [...v]])),
  }
  const groups: Id[][] = [order.roots, ...order.branches.values()].filter((g) => g.length > 1)
  let best = countCrossings(components, placeColumns(forest, order, spacing))
  // One optimisation pass over column order only: keep an adjacent swap iff it strictly reduces
  // crossings, so ties keep the user's order and a tidied graph stays unchanged.
  for (let round = 0; round < MAX_CROSSING_ROUNDS && best > 0; round++) {
    let improved = false
    for (const group of groups) {
      for (let i = 0; i + 1 < group.length; i++) {
        ;[group[i], group[i + 1]] = [group[i + 1]!, group[i]!]
        const crossings = countCrossings(components, placeColumns(forest, order, spacing))
        if (crossings < best) {
          best = crossings
          improved = true
        } else {
          ;[group[i], group[i + 1]] = [group[i + 1]!, group[i]!]
        }
      }
    }
    if (!improved) break
  }
  return anchor(components, placeColumns(forest, order, spacing))
}
