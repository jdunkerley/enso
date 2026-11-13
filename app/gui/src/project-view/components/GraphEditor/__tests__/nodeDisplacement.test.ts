import { expect, test } from 'vitest'
import { boxAt, relayout, type Displaced, type LayoutNode } from '../nodeDisplacement'

function node(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 32,
  extra: Partial<LayoutNode> = {},
): LayoutNode {
  return { id, pos: { x, y }, size: { x: w, y: h }, ...extra }
}

/** Resize node `id` to `size`, lay out, and return the graph with the result applied. */
function resize(nodes: LayoutNode[], id: string, size: { x: number; y: number }): LayoutNode[] {
  const target = nodes.find((n) => n.id === id)!
  const old = boxAt(target.pos, target.size)
  const next = nodes.map((n) => (n.id === id ? { ...n, size } : n))
  return apply(next, relayout(next, [{ id, old, adds: true }]))
}

function apply(nodes: LayoutNode[], placements: ReturnType<typeof relayout>): LayoutNode[] {
  return nodes.map((n) => {
    const p = placements.get(n.id)
    return p ? { ...n, pos: p.pos, displaced: p.displaced } : n
  })
}

function pos(nodes: LayoutNode[], id: string) {
  return nodes.find((n) => n.id === id)!.pos
}
function field(nodes: LayoutNode[], id: string): Displaced | undefined {
  return nodes.find((n) => n.id === id)!.displaced
}

const OPEN = { x: 200, y: 182 }
const CLOSED = { x: 100, y: 32 }

test('a node in the way moves down and keeps the gap it had', () => {
  const after = resize([node('A', 0, 0), node('B', 0, 52)], 'A', OPEN)
  expect(pos(after, 'B')).toEqual({ x: 0, y: 202 })
  expect(field(after, 'B')).toEqual({
    home: { x: 0, y: 52 },
    at: { x: 0, y: 202 },
    by: [{ id: 'A', gap: 20, dir: 'down' }],
  })
})

test('closing returns it to its exact position and removes the field', () => {
  const open = resize([node('A', 0, 0), node('B', 0, 52)], 'A', OPEN)
  const closed = resize(open, 'A', CLOSED)
  expect(pos(closed, 'B')).toEqual({ x: 0, y: 52 })
  expect(field(closed, 'B')).toBeUndefined()
})

test('the gap is at most 32', () => {
  const after = resize([node('A', 0, 0), node('B', 0, 132)], 'A', OPEN)
  expect(pos(after, 'B')).toEqual({ x: 0, y: 214 })
})

test('a node that is not reached does not move', () => {
  const nodes = [node('A', 0, 0), node('B', 0, 300), node('C', 300, 52)]
  const A = nodes[0]!
  const next = nodes.map((n) => (n.id === 'A' ? { ...n, size: OPEN } : n))
  expect(relayout(next, [{ id: 'A', old: boxAt(A.pos, A.size), adds: true }]).size).toBe(0)
})

test('a pushed node pushes the node below it', () => {
  const start = [node('A', 0, 0), node('B', 0, 52), node('C', 0, 104)]
  const open = resize(start, 'A', OPEN)
  expect(pos(open, 'B')).toEqual({ x: 0, y: 202 })
  expect(pos(open, 'C')).toEqual({ x: 0, y: 254 })
  // The visualization would reach C by itself, so C lists it too; the push from B is the larger.
  expect(field(open, 'C')?.by).toEqual([
    { id: 'A', gap: 32, dir: 'down' },
    { id: 'B', gap: 20, dir: 'down' },
  ])
  const closed = resize(open, 'A', CLOSED)
  expect(closed).toEqual(start)
})

test('growing in steps ends where growing at once does, and shrinking follows', () => {
  const start = [node('A', 0, 0), node('B', 0, 52)]
  const stepped = resize(resize(start, 'A', { x: 200, y: 100 }), 'A', OPEN)
  expect(pos(stepped, 'B')).toEqual({ x: 0, y: 202 })
  const smaller = resize(stepped, 'A', { x: 200, y: 100 })
  expect(pos(smaller, 'B')).toEqual({ x: 0, y: 120 })
})

test('a node beside the row moves right when the row widens', () => {
  const after = resize([node('A', 0, 0), node('D', 120, 0)], 'A', {
    x: 300,
    y: 32,
  })
  expect(pos(after, 'D')).toEqual({ x: 320, y: 0 })
  expect(field(after, 'D')?.by).toEqual([{ id: 'A', gap: 20, dir: 'right' }])
})

test('a diagonal node moves down', () => {
  const after = resize([node('A', 0, 0), node('E', 150, 60)], 'A', OPEN)
  expect(pos(after, 'E')).toEqual({ x: 150, y: 210 })
})

test('with two pushers the node returns part of the way, then home, in either order', () => {
  const start = [node('P1', 0, 0), node('P2', 110, 0), node('X', 50, 52, 110)]
  const one = resize(start, 'P1', { x: 100, y: 182 })
  expect(pos(one, 'X')).toEqual({ x: 50, y: 202 })
  const both = resize(one, 'P2', { x: 100, y: 232 })
  expect(pos(both, 'X')).toEqual({ x: 50, y: 252 })
  expect(field(both, 'X')?.by.map((e) => e.id)).toEqual(['P1', 'P2'])

  const p2Closed = resize(both, 'P2', CLOSED)
  expect(pos(p2Closed, 'X')).toEqual({ x: 50, y: 202 })
  expect(resize(p2Closed, 'P1', CLOSED)).toEqual(start)

  const p1Closed = resize(both, 'P1', CLOSED)
  expect(pos(p1Closed, 'X')).toEqual({ x: 50, y: 252 })
  expect(resize(p1Closed, 'P2', CLOSED)).toEqual(start)
})

test('a node moved by hand stays where it was put and loses its home', () => {
  const open = resize([node('A', 0, 0), node('B', 0, 52)], 'A', OPEN)
  const dragged = open.map((n) => (n.id === 'B' ? { ...n, pos: { x: 300, y: 300 } } : n))
  const closed = resize(dragged, 'A', CLOSED)
  expect(pos(closed, 'B')).toEqual({ x: 300, y: 300 })
  expect(field(closed, 'B')).toBeUndefined()
})

test('a position within a pixel of the saved one is not a move by hand', () => {
  const open = resize([node('A', 0, 0), node('B', 0, 52)], 'A', OPEN)
  const rounded = open.map((n) => (n.id === 'B' ? { ...n, pos: { x: 0.4, y: 202 } } : n))
  expect(pos(resize(rounded, 'A', CLOSED), 'B')).toEqual({ x: 0, y: 52 })
})

test('removing the pusher returns the nodes it pushed', () => {
  const open = resize([node('A', 0, 0), node('B', 0, 52), node('C', 0, 104)], 'A', OPEN)
  const A = open.find((n) => n.id === 'A')!
  const without = open.filter((n) => n.id !== 'A')
  const after = apply(
    without,
    relayout(without, [{ id: 'A', old: boxAt(A.pos, A.size), adds: false }]),
  )
  expect(after).toEqual([node('B', 0, 52), node('C', 0, 104)])
})

test('a pusher that vanished without a removal leaves the node where it is', () => {
  const stranded = node('B', 0, 202, 100, 32, {
    displaced: {
      home: { x: 0, y: 52 },
      at: { x: 0, y: 202 },
      by: [{ id: 'gone', gap: 20, dir: 'down' }],
    },
  })
  const nodes = [node('A', 500, 0), stranded]
  const after = apply(
    nodes,
    relayout(nodes, [{ id: 'A', old: boxAt({ x: 500, y: 0 }, CLOSED), adds: true }]),
  )
  expect(pos(after, 'B')).toEqual({ x: 0, y: 202 })
  expect(field(after, 'B')).toBeUndefined()
})

test('input nodes and unplaced nodes are never moved', () => {
  const nodes = [
    node('A', 0, 0),
    node('I', 0, 52, 100, 32, { fixed: true }),
    node('U', Infinity, Infinity),
    node('Z', 0, 60, 0, 0),
  ]
  expect(resize(nodes, 'A', OPEN)).toEqual(
    nodes.map((n) => (n.id === 'A' ? { ...n, size: OPEN } : n)),
  )
})

test('a node that already overlapped the pusher is not pushed', () => {
  const nodes = [node('A', 0, 0), node('B', 0, 10)]
  expect(pos(resize(nodes, 'A', OPEN), 'B')).toEqual({ x: 0, y: 10 })
})

test('home taken: the node returns as far as it can and forgets its home', () => {
  const open = resize([node('A', 0, 0), node('B', 0, 52)], 'A', OPEN)
  const withNew = [...open, node('Z', 0, 52)]
  const closed = resize(withNew, 'A', CLOSED)
  expect(pos(closed, 'B')).toEqual({ x: 0, y: 116 })
  expect(field(closed, 'B')).toBeUndefined()
})

test('nodes that overlapped at home return onto each other', () => {
  const start = [node('A', 0, 0), node('B', 0, 52), node('B2', 0, 52)]
  const open = resize(start, 'A', OPEN)
  expect(pos(open, 'B')).toEqual({ x: 0, y: 202 })
  expect(pos(open, 'B2')).toEqual({ x: 0, y: 202 })
  expect(resize(open, 'A', CLOSED)).toEqual(start)
})

test('a pusher moved by hand releases its nodes and pushes nothing at its new place', () => {
  const open = resize([node('A', 0, 0), node('B', 0, 52), node('Q', 500, 52)], 'A', OPEN)
  const A = open.find((n) => n.id === 'A')!
  const moved = open.map((n) => (n.id === 'A' ? { ...n, pos: { x: 500, y: 0 } } : n))
  const after = apply(moved, relayout(moved, [{ id: 'A', old: boxAt(A.pos, A.size), adds: false }]))
  expect(pos(after, 'B')).toEqual({ x: 0, y: 52 })
  expect(field(after, 'B')).toBeUndefined()
  expect(pos(after, 'Q')).toEqual({ x: 500, y: 52 })
})

/** Move node `id` by hand to `to`, lay out, and return the graph with the result applied. */
function moveByHand(
  nodes: LayoutNode[],
  id: string,
  to: { x: number; y: number },
  stats?: { capped: boolean },
): LayoutNode[] {
  const target = nodes.find((n) => n.id === id)!
  const old = boxAt(target.pos, target.size)
  const next = nodes.map((n) => (n.id === id ? { ...n, pos: to } : n))
  return apply(next, relayout(next, [{ id, old, adds: false }], stats))
}

test('a node pushed further out by a pusher moved by hand pushes what it reaches', () => {
  // D is 34px below where C is pushed to: out of reach until A is moved down by hand.
  const start = [node('A', 0, 0), node('B', 0, 52), node('C', 0, 104), node('D', 0, 320)]
  const open = resize(start, 'A', { x: 100, y: 182 })
  expect(pos(open, 'B')).toEqual({ x: 0, y: 202 })
  expect(pos(open, 'C')).toEqual({ x: 0, y: 254 })
  expect(pos(open, 'D')).toEqual({ x: 0, y: 320 })
  const nudged = moveByHand(open, 'A', { x: 0, y: 40 })
  expect(pos(nudged, 'B')).toEqual({ x: 0, y: 242 })
  expect(pos(nudged, 'C')).toEqual({ x: 0, y: 294 })
  expect(pos(nudged, 'D')).toEqual({ x: 0, y: 358 })
  const back = moveByHand(nudged, 'A', { x: 0, y: 0 })
  expect(pos(back, 'B')).toEqual({ x: 0, y: 202 })
  expect(pos(back, 'C')).toEqual({ x: 0, y: 254 })
  expect(pos(back, 'D')).toEqual({ x: 0, y: 320 })
  expect(field(back, 'D')).toBeUndefined()
})

test('a node pushed further out never pushes the node that pushes it', () => {
  // A is moved below B's home: B is recomputed below A, and must not push A in turn.
  const open = resize([node('A', 0, 0), node('B', 0, 52), node('C', 0, 104)], 'A', {
    x: 100,
    y: 182,
  })
  const stats = { capped: false }
  const moved = moveByHand(open, 'A', { x: 0, y: 300 }, stats)
  expect(stats.capped).toBe(false)
  expect(pos(moved, 'A')).toEqual({ x: 0, y: 300 })
  expect(field(moved, 'A')).toBeUndefined()
})

test('several nodes changing at once are laid out in the order given', () => {
  const start = [node('A', 0, 0), node('B', 0, 52), node('C', 0, 104)]
  const next = start.map((n) => (n.id === 'C' ? n : { ...n, size: { x: 100, y: 182 } }))
  const after = apply(
    next,
    relayout(next, [
      { id: 'A', old: boxAt({ x: 0, y: 0 }, CLOSED), adds: true },
      { id: 'B', old: boxAt({ x: 0, y: 52 }, CLOSED), adds: true },
    ]),
  )
  expect(pos(after, 'B')).toEqual({ x: 0, y: 202 })
  expect(pos(after, 'C')).toEqual({ x: 0, y: 404 })
})

test('a node placed onto a pushed node returns onto it, not beside it', () => {
  const opened = resize([node('G', 0, 0), node('X', 0, 52), node('A', 110, 150)], 'G', {
    x: 100,
    y: 182,
  })
  expect(pos(opened, 'X')).toEqual({ x: 0, y: 202 })
  const withB = [...opened, node('B', 50, 210)]
  const grown = resize(withB, 'A', { x: 100, y: 100 })
  expect(pos(grown, 'B')).toEqual({ x: 50, y: 278 })
  const shrunk = resize(grown, 'A', CLOSED)
  expect(pos(shrunk, 'B')).toEqual({ x: 50, y: 210 })
  expect(field(shrunk, 'B')).toBeUndefined()
})

test('a pusher with no measured size leaves the node and its field as they are', () => {
  const start = [node('P1', 0, 0), node('P2', 110, 0), node('X', 50, 52, 110)]
  const both = resize(resize(start, 'P1', { x: 100, y: 232 }), 'P2', { x: 100, y: 182 })
  expect(pos(both, 'X')).toEqual({ x: 50, y: 252 })
  const before = field(both, 'X')
  expect(before?.by.map((e) => e.id)).toEqual(['P1', 'P2'])
  const P2 = both.find((n) => n.id === 'P2')!
  const next = both.map((n) =>
    n.id === 'P1' ? { ...n, size: { x: 0, y: 0 } }
    : n.id === 'P2' ? { ...n, size: CLOSED }
    : n,
  )
  const placements = relayout(next, [{ id: 'P2', old: boxAt(P2.pos, P2.size), adds: true }])
  expect(placements.has('X')).toBe(false)
  const after = apply(next, placements)
  expect(pos(after, 'X')).toEqual({ x: 50, y: 252 })
  expect(field(after, 'X')).toEqual(before)
})

test('home taken after a push to the right: it steps aside to the right', () => {
  const open = resize([node('A', 0, 0), node('D', 120, 0)], 'A', { x: 300, y: 32 })
  expect(pos(open, 'D')).toEqual({ x: 320, y: 0 })
  const closed = resize([...open, node('Z', 120, 0)], 'A', CLOSED)
  expect(pos(closed, 'D')).toEqual({ x: 252, y: 0 })
  expect(field(closed, 'D')).toBeUndefined()
})

/** P2 is left of X and pushes it right; P1 is above X and pushes it down. */
function pushedRightThenDown() {
  const start = [node('P1', 120, 0), node('P2', 0, 52), node('X', 120, 52)]
  const right = resize(start, 'P2', { x: 120, y: 32 })
  expect(pos(right, 'X')).toEqual({ x: 140, y: 52 })
  const both = resize(right, 'P1', { x: 100, y: 182 })
  return { start, both }
}

test('a node pushed right by one pusher and down by another returns home when both shrink', () => {
  const { start, both } = pushedRightThenDown()
  expect(pos(both, 'X')).toEqual({ x: 140, y: 202 })
  expect(field(both, 'X')?.by).toEqual([
    { id: 'P2', gap: 20, dir: 'right' },
    { id: 'P1', gap: 20, dir: 'down' },
  ])
  const p1Closed = resize(both, 'P1', CLOSED)
  expect(pos(p1Closed, 'X')).toEqual({ x: 140, y: 52 })
  expect(resize(p1Closed, 'P2', CLOSED)).toEqual(start)
})

test('home taken steps aside in the direction of the push it is returning from', () => {
  const { both } = pushedRightThenDown()
  // X's first push was to the right, but closing P1 returns it upwards onto Z.
  const closed = resize([...both, node('Z', 140, 52)], 'P1', CLOSED)
  expect(pos(closed, 'X')).toEqual({ x: 140, y: 116 })
  expect(field(closed, 'X')).toBeUndefined()
})

test('a pusher moved by hand counts as moved when a removal recomputes its nodes', () => {
  // Q pushed N once, then was itself moved by hand away from N's column: its saved home is stale.
  const N = node('N', 0, 250, 100, 32, {
    displaced: {
      home: { x: 0, y: 100 },
      at: { x: 0, y: 250 },
      by: [
        { id: 'R', gap: 32, dir: 'down' },
        { id: 'Q', gap: 32, dir: 'down' },
      ],
    },
  })
  const Q = node('Q', 500, 0, 100, 82, {
    displaced: { home: { x: 0, y: 0 }, at: { x: 0, y: 0 }, by: [{ id: 'S', gap: 0, dir: 'down' }] },
  })
  const nodes = [N, Q]
  const after = apply(
    nodes,
    relayout(nodes, [{ id: 'R', old: boxAt({ x: 0, y: 0 }, { x: 100, y: 218 }), adds: false }]),
  )
  expect(pos(after, 'N')).toEqual({ x: 0, y: 100 })
  expect(field(after, 'N')).toBeUndefined()
})

/** A small seeded generator, so a failure can be reproduced. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('random layouts: growing nodes and shrinking them back restores every position', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = mulberry32(seed)
    const int = (max: number) => Math.floor(random() * max)
    const start: LayoutNode[] = Array.from({ length: 2 + int(10) }, (_, i) =>
      node(`n${i}`, int(8) * 60, int(10) * 40, 60 + int(4) * 40, 32 + int(2) * 32),
    )
    const growers = [...start].sort(() => random() - 0.5).slice(0, 1 + int(3))
    let nodes = start
    const stats = { capped: false }
    const change = (id: string, size: { x: number; y: number }) => {
      const target = nodes.find((n) => n.id === id)!
      const old = boxAt(target.pos, target.size)
      const next = nodes.map((n) => (n.id === id ? { ...n, size } : n))
      nodes = apply(next, relayout(next, [{ id, old, adds: true }], stats))
    }
    for (const g of growers)
      change(g.id, {
        x: g.size.x + int(5) * 50,
        y: g.size.y + 20 + int(5) * 60,
      })
    for (const g of [...growers].sort(() => random() - 0.5)) change(g.id, g.size)
    expect(stats.capped, `seed ${seed}`).toBe(false)
    expect(nodes, `seed ${seed}`).toEqual(start)
  }
})
