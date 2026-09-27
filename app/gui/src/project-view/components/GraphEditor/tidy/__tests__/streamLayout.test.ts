import { Vec2 } from '@/util/data/vec2'
import { describe, expect, test, vi } from 'vitest'
import {
  buildForest,
  countCrossings,
  placeColumns,
  streamLayout,
  type LayoutComponent,
} from '../streamLayout'

const SPACING = { horizontal: 40, vertical: 40 }
const SIZE = new Vec2(100, 32)

/** A component at `(x, y)` with the default size, fed by `inputs` (the first one is its self input unless `self` says otherwise). */
function comp(
  id: string,
  x: number,
  y: number,
  inputs: string[] = [],
  opts: { self?: string | null; size?: Vec2; order?: number } = {},
): LayoutComponent<string> {
  const self = opts.self === null ? undefined : (opts.self ?? inputs[0])
  return {
    id,
    position: new Vec2(x, y),
    size: opts.size ?? SIZE,
    inputs,
    selfSource: self,
    order: opts.order ?? 0,
  }
}

function withOrder(components: LayoutComponent<string>[]) {
  return components.map((c, i) => ({ ...c, order: i }))
}

function leftX(pos: Map<string, Vec2>, id: string) {
  return pos.get(id)!.x
}

/** A small, fast seeded PRNG (mulberry32), for reproducible random fixtures. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random tree (no merges): each node but the first takes a random earlier node as its one input. */
function randomTree(rand: () => number, n: number): LayoutComponent<string>[] {
  const nodes: LayoutComponent<string>[] = [comp('n0', rand() * 2000, 0)]
  for (let i = 1; i < n; i++) {
    const parent = Math.floor(rand() * i)
    nodes.push(comp(`n${i}`, rand() * 2000, i * 90, [`n${parent}`]))
  }
  return withOrder(nodes)
}

/** A random DAG: each node takes a random earlier node as its self input, plus a few extra earlier inputs (merges). */
function randomDag(
  rand: () => number,
  n: number,
  extraEdgesPerNode = 1,
): LayoutComponent<string>[] {
  const nodes: LayoutComponent<string>[] = [comp('n0', rand() * 3000, 0)]
  for (let i = 1; i < n; i++) {
    const self = Math.floor(rand() * i)
    const inputs = [`n${self}`]
    for (let e = 0; e < extraEdgesPerNode; e++) {
      if (i > 1 && rand() < 0.5) {
        const extra = Math.floor(rand() * i)
        if (extra !== self) inputs.push(`n${extra}`)
      }
    }
    nodes.push(comp(`n${i}`, rand() * 3000, i * 90, inputs))
  }
  return withOrder(nodes)
}

/** Whether two axis-aligned rectangles (top-left + size) overlap. */
function rectsOverlap(aPos: Vec2, aSize: Vec2, bPos: Vec2, bSize: Vec2): boolean {
  return (
    aPos.x < bPos.x + bSize.x &&
    bPos.x < aPos.x + aSize.x &&
    aPos.y < bPos.y + bSize.y &&
    bPos.y < aPos.y + aSize.y
  )
}

describe('streamLayout', () => {
  test('a straight chain forms one column, packed with the vertical gap', () => {
    const pos = streamLayout(
      withOrder([comp('a', 0, 0), comp('b', 300, 500, ['a']), comp('c', 80, 90, ['b'])]),
      SPACING,
    )
    expect(pos.get('a')).toEqual(new Vec2(0, 0))
    expect(pos.get('b')).toEqual(new Vec2(0, 72))
    expect(pos.get('c')).toEqual(new Vec2(0, 144))
  })

  test('on a split the closest child continues the column; others open columns to the right in current order', () => {
    const pos = streamLayout(
      withOrder([
        comp('p', 0, 0),
        comp('far', 400, 80, ['p']),
        comp('below', 10, 80, ['p']),
        comp('mid', 200, 80, ['p']),
      ]),
      SPACING,
    )
    expect(leftX(pos, 'below')).toBe(leftX(pos, 'p'))
    expect(leftX(pos, 'mid')).toBeGreaterThan(leftX(pos, 'below'))
    expect(leftX(pos, 'far')).toBeGreaterThan(leftX(pos, 'mid'))
    expect(pos.get('mid')!.x - pos.get('below')!.x).toBe(SIZE.x + SPACING.horizontal)
  })

  test('a merge sits below every input and in its self input’s column', () => {
    const pos = streamLayout(
      withOrder([
        comp('left', 0, 0),
        comp('right', 200, 0),
        comp('r2', 200, 80, ['right']),
        comp('r3', 200, 160, ['r2']),
        comp('join', 0, 100, ['left', 'r3']),
      ]),
      SPACING,
    )
    expect(leftX(pos, 'join')).toBe(leftX(pos, 'left'))
    const r3Bottom = pos.get('r3')!.y + SIZE.y
    expect(pos.get('join')!.y).toBe(r3Bottom + SPACING.vertical)
  })

  test('a merge whose self input sits to the right of its other input still follows the self column', () => {
    const pos = streamLayout(
      withOrder([
        comp('left', 0, 0),
        comp('right', 300, 0),
        comp('join', 100, 100, ['left', 'right'], { self: 'right' }),
      ]),
      SPACING,
    )
    expect(leftX(pos, 'join')).toBe(leftX(pos, 'right'))
  })

  test('without a self input a component follows its first input', () => {
    const pos = streamLayout(
      withOrder([
        comp('a', 0, 0),
        comp('b', 300, 0),
        comp('f', 250, 90, ['b', 'a'], { self: null }),
      ]),
      SPACING,
    )
    expect(leftX(pos, 'f')).toBe(leftX(pos, 'b'))
  })

  test('independent streams keep their left-to-right order', () => {
    const pos = streamLayout(
      withOrder([comp('right', 500, 0), comp('left', 0, 0), comp('mid', 250, 0)]),
      SPACING,
    )
    expect(pos.get('left')!.x).toBeLessThan(pos.get('mid')!.x)
    expect(pos.get('mid')!.x).toBeLessThan(pos.get('right')!.x)
  })

  test('columns are as wide as their widest component and components are left-aligned', () => {
    const wide = new Vec2(300, 32)
    const pos = streamLayout(
      withOrder([comp('a', 0, 0), comp('b', 0, 80, ['a'], { size: wide }), comp('other', 900, 0)]),
      SPACING,
    )
    // The narrow component ('a') and the wide one ('b') share the column's left edge.
    expect(pos.get('b')!.x).toBe(0)
    expect(pos.get('a')!.x).toBe(0)
    expect(pos.get('other')!.x).toBe(300 + SPACING.horizontal)
  })

  test('the column-continuing child is chosen by left x, not centre x', () => {
    // p is narrow, at x=0. a is wide, also at x=0: its left edge matches p's exactly, but its
    // centre (150) is far from p's centre (50). b is narrow, at x=40: its centre (90) is closer to
    // p's centre (50) than a's is, but its left edge (40) is farther from p's (0) than a's. Left x
    // must win: a continues p's column, not b.
    const wide = new Vec2(300, 32)
    const pos = streamLayout(
      withOrder([
        comp('p', 0, 0),
        comp('a', 0, 80, ['p'], { size: wide }),
        comp('b', 40, 80, ['p']),
      ]),
      SPACING,
    )
    expect(pos.get('a')!.x).toBe(pos.get('p')!.x)
    expect(pos.get('b')!.x).toBe(300 + SPACING.horizontal)
  })

  test('a tall component pushes only its own column down', () => {
    const tall = new Vec2(100, 400)
    const pos = streamLayout(
      withOrder([
        comp('a', 0, 0, [], { size: tall }),
        comp('a2', 0, 450, ['a']),
        comp('b', 200, 0),
        comp('b2', 200, 80, ['b']),
      ]),
      SPACING,
    )
    expect(pos.get('a2')!.y).toBe(400 + SPACING.vertical)
    expect(pos.get('b2')!.y).toBe(SIZE.y + SPACING.vertical)
  })

  test('the result is anchored at the original top-left', () => {
    const pos = streamLayout(
      withOrder([comp('a', 1000, 2000), comp('b', 1400, 2300, ['a'])]),
      SPACING,
    )
    expect(pos.get('a')).toEqual(new Vec2(1000, 2000))
    expect(pos.get('b')).toEqual(new Vec2(1000, 2072))
  })

  test('anchoring uses the current bounding box even when the min x and min y come from different components', () => {
    const pos = streamLayout(
      withOrder([
        comp('a', 500, 100, [], { size: new Vec2(50, 20) }),
        comp('b', 100, 900, [], { size: new Vec2(50, 20) }),
      ]),
      SPACING,
    )
    // a has the original min y (100); b has the original min x (100).
    expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(100)
    expect(Math.min(...[...pos.values()].map((p) => p.y))).toBe(100)
  })

  test('tidying a tidied layout changes nothing', () => {
    const input = withOrder([
      comp('d', 0, 0),
      comp('n1', 300, 0),
      comp('n3', 320, 80, ['n1']),
      comp('j', 10, 200, ['d', 'n3']),
      comp('s', 0, 300, ['j']),
      comp('br', 200, 300, ['j']),
    ])
    const once = streamLayout(input, SPACING)
    const again = streamLayout(
      input.map((c) => ({ ...c, position: once.get(c.id)! })),
      SPACING,
    )
    expect(again).toEqual(once)
  })

  test('a cycle does not hang and drops the later-in-code-order edge', () => {
    const pos = streamLayout(withOrder([comp('a', 0, 0, ['b']), comp('b', 0, 80, ['a'])]), SPACING)
    expect(pos.get('a')!.y).toBeLessThan(pos.get('b')!.y)
  })

  test('duplicate ids are rejected with a clear error', () => {
    const input = withOrder([comp('a', 0, 0), comp('a', 300, 0)])
    expect(() => streamLayout(input, SPACING)).toThrow(/duplicate/i)
  })

  test('countCrossings counts a crossing pair of edges', () => {
    // a→d and b→c cross: a (left top) → d (right bottom), b (right top) → c (left bottom).
    const cs = withOrder([
      comp('a', 0, 0),
      comp('b', 200, 0),
      comp('c', 0, 200, ['b']),
      comp('d', 200, 200, ['a']),
    ])
    const pos = new Map(cs.map((c) => [c.id, c.position]))
    expect(countCrossings(cs, pos)).toBe(1)
  })

  test('countCrossings does not double-count a duplicate input', () => {
    // Same crossing as above, but c lists b twice: the duplicate must not be counted as a second edge.
    const cs = withOrder([
      comp('a', 0, 0),
      comp('b', 200, 0),
      comp('c', 0, 200, ['b', 'b']),
      comp('d', 200, 200, ['a']),
    ])
    const pos = new Map(cs.map((c) => [c.id, c.position]))
    expect(countCrossings(cs, pos)).toBe(1)
  })

  test('nested splits keep each subtree’s columns contiguous, so a plain tree never crosses', () => {
    // p’s main child m continues p’s column; p’s branch b opens a new column. m itself splits
    // into main child m2 and branch mb. mb’s column must stay inside m’s own block, next to m and
    // m2, rather than being pushed out past b’s column.
    const input = withOrder([
      comp('p', 0, 0),
      comp('m', 0, 80, ['p']),
      comp('b', 300, 80, ['p']),
      comp('m2', 0, 160, ['m']),
      comp('mb', 150, 160, ['m']),
      comp('b2', 300, 160, ['b']),
    ])
    const pos = streamLayout(input, SPACING)
    expect(countCrossings(input, pos)).toBe(0)
  })

  test('random trees (no merges) always give zero crossings', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const input = randomTree(mulberry32(seed), 30)
      const pos = streamLayout(input, SPACING)
      expect(countCrossings(input, pos)).toBe(0)
    }
  })

  test('no two components overlap, across several random DAGs', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const input = randomDag(mulberry32(seed), 40)
      const pos = streamLayout(input, SPACING)
      for (let i = 0; i < input.length; i++) {
        for (let j = i + 1; j < input.length; j++) {
          const a = input[i]!
          const b = input[j]!
          expect(rectsOverlap(pos.get(a.id)!, a.size, pos.get(b.id)!, b.size)).toBe(false)
        }
      }
    }
  })
})

describe('crossing pass', () => {
  test('swaps independent streams when that removes a crossing', () => {
    // Roots A, B, C left to right. m (in C's column, self = C) also takes A as an input, so the
    // edge A→m spans column B and crosses B→b2. Swapping A and B removes the crossing.
    // Hand-checked: before, A→m runs (50,32)→(330,72) and meets B→b2 (x=190, y 32..72) at y≈52.
    const input = withOrder([
      comp('A', 0, 0),
      comp('B', 300, 0),
      comp('b2', 300, 80, ['B']),
      comp('C', 600, 0),
      comp('m', 600, 300, ['C', 'A']),
    ])
    const forest = buildForest(input)
    expect(countCrossings(input, placeColumns(forest, forest.initialOrder, SPACING))).toBe(1)
    const pos = streamLayout(input, SPACING)
    expect(countCrossings(input, pos)).toBe(0)
  })

  test('keeps the current order when swapping does not strictly reduce crossings', () => {
    // A symmetric "bowtie": m (self P) also takes Q, n (self Q) also takes P. Q→m and P→n cross
    // once; swapping P and Q just mirrors the same picture, so the crossing count is unchanged
    // and the original left-to-right order must be kept.
    const input = withOrder([
      comp('P', 0, 0),
      comp('Q', 300, 0),
      comp('m', 0, 200, ['P', 'Q']),
      comp('n', 300, 200, ['Q', 'P']),
    ])
    const forest = buildForest(input)
    const before = countCrossings(input, placeColumns(forest, forest.initialOrder, SPACING))
    expect(before).toBe(1)
    const pos = streamLayout(input, SPACING)
    expect(countCrossings(input, pos)).toBe(1)
    expect(pos.get('P')!.x).toBeLessThan(pos.get('Q')!.x)
  })

  test('reorders branch columns of one parent to remove a crossing', () => {
    // p's main child m continues its column; branches b1, b2 open columns in that order. z, fed
    // by [b2, m], and w, fed by [b1], sit in the next row: m→z crosses b1→w because b1's column
    // sits between m's and b2's. Swapping b1 and b2 puts z's column right next to m's, removing
    // the crossing.
    const input = withOrder([
      comp('p', 0, 0),
      comp('m', 0, 80, ['p']),
      comp('b1', 200, 80, ['p']),
      comp('b2', 400, 80, ['p']),
      comp('z', 200, 300, ['b2', 'm']),
      comp('w', 400, 300, ['b1']),
    ])
    const forest = buildForest(input)
    const before = countCrossings(input, placeColumns(forest, forest.initialOrder, SPACING))
    expect(before).toBe(1)
    const pos = streamLayout(input, SPACING)
    expect(countCrossings(input, pos)).toBe(0)
    expect(pos.get('b2')!.x).toBeLessThan(pos.get('b1')!.x)
  })

  test('tidying a tidied layout changes nothing, even when the crossing pass swapped something', () => {
    const input = withOrder([
      comp('A', 0, 0),
      comp('B', 300, 0),
      comp('b2', 300, 80, ['B']),
      comp('C', 600, 0),
      comp('m', 600, 300, ['C', 'A']),
    ])
    const once = streamLayout(input, SPACING)
    const again = streamLayout(
      input.map((c) => ({ ...c, position: once.get(c.id)! })),
      SPACING,
    )
    expect(again).toEqual(once)
  })

  test('is idempotent on a wide graph that needs more than a handful of rounds to settle', () => {
    // Roots L, A, B1..B6, X, left to right; each Bi has one child Bic. m (self A) also takes X; n
    // (self L) also takes A. X→m runs all the way back to A's column, crossing every Bi→Bic once
    // (6 crossings to start: X→m's segment moves monotonically from X's column to A's column, so
    // it must cross each Bi→Bic's vertical segment along the way). Untangling that takes more
    // adjacent-swap rounds than a small fixed round limit allows — this must still reach a stable,
    // idempotent layout, not stop partway through.
    const bs: LayoutComponent<string>[] = []
    for (let i = 1; i <= 6; i++) {
      bs.push(comp(`B${i}`, 400 + (i - 1) * 200, 0))
      bs.push(comp(`B${i}c`, 400 + (i - 1) * 200, 80, [`B${i}`]))
    }
    const input = withOrder([
      comp('L', 0, 0),
      comp('A', 200, 0),
      ...bs,
      comp('X', 1600, 0),
      comp('m', 1600, 300, ['A', 'X']),
      comp('n', 0, 300, ['L', 'A']),
    ])
    const forest = buildForest(input)
    const before = countCrossings(
      input,
      placeColumns(forest, forest.initialOrder, SPACING),
      forest.inputs,
    )
    expect(before).toBe(6)
    const once = streamLayout(input, SPACING)
    const again = streamLayout(
      input.map((c) => ({ ...c, position: once.get(c.id)! })),
      SPACING,
    )
    expect(again).toEqual(once)
  })

  test('is idempotent on a random DAG (regression guard for the old column-interleaving bug)', () => {
    // This fixture settles in 2 rounds, so it doesn't exercise the round cap; it's kept only as a
    // regression guard for the earlier bug where a parent's branch columns were reserved before
    // recursing into its main child, which could break idempotence independently of rounds.
    const input = randomDag(mulberry32(21), 30, 2)
    const once = streamLayout(input, SPACING)
    const again = streamLayout(
      input.map((c) => ({ ...c, position: once.get(c.id)! })),
      SPACING,
    )
    expect(again).toEqual(once)
  })

  test('a time budget stops the pass early, keeping a valid layout, and warns once', () => {
    // Same fixture as "reorders branch columns...": one crossing, fixable by swapping b1 and b2.
    const input = withOrder([
      comp('p', 0, 0),
      comp('m', 0, 80, ['p']),
      comp('b1', 200, 80, ['p']),
      comp('b2', 400, 80, ['p']),
      comp('z', 200, 300, ['b2', 'm']),
      comp('w', 400, 300, ['b1']),
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // The deadline is set from the first call; every later call reports it as already passed, so
      // the pass must stop before trying (let alone accepting) a single swap.
      let calls = 0
      const now = () => (calls++ === 0 ? 0 : Number.POSITIVE_INFINITY)

      const pos = streamLayout(input, SPACING, { now })

      // The crossing the pass would normally fix is still there: the budget really did stop it
      // before any swap, not just cut a round short after some progress.
      expect(countCrossings(input, pos)).toBe(1)
      // It's still a valid (non-overlapping) layout — the un-optimised column order is one placeColumns
      // always produces, never a partial or corrupt one.
      for (let i = 0; i < input.length; i++) {
        for (let j = i + 1; j < input.length; j++) {
          const a = input[i]!
          const b = input[j]!
          expect(rectsOverlap(pos.get(a.id)!, a.size, pos.get(b.id)!, b.size)).toBe(false)
        }
      }
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
