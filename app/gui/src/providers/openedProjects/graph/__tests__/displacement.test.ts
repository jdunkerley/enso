import {
  createDisplacement,
  nodeBox,
  type NodeChange,
} from '$/providers/openedProjects/graph/displacement'
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { Vec2 } from '@/util/data/vec2'
import { expect, test } from 'vitest'
import type { NodeDisplacementMetadata } from 'ydoc-shared/ast'
import type { VisualizationMetadata } from 'ydoc-shared/yjsModel'

const SHOWN: VisualizationMetadata = {
  identifier: null,
  visible: true,
  width: null,
  height: null,
}

interface Spec {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  vis?: VisualizationMetadata
  fixed?: boolean
}

function graph(specs: Spec[]) {
  const nodes = new Map(
    specs.map((s) => [
      s.id as NodeId,
      {
        id: s.id as NodeId,
        position: new Vec2(s.x, s.y),
        vis: s.vis,
        fixed: s.fixed ?? false,
      },
    ]),
  )
  const bare = new Map(specs.map((s) => [s.id as NodeId, new Vec2(s.w ?? 100, s.h ?? 32)]))
  const displaced = new Map<NodeId, NodeDisplacementMetadata>()
  const displacement = createDisplacement({
    nodes: () => nodes.values(),
    bareSize: (id) => bare.get(id),
    readDisplaced: (id) => displaced.get(id),
    write: (id, placement) => {
      nodes.get(id)!.position = placement.position
      if (placement.displaced) displaced.set(id, placement.displaced)
      else displaced.delete(id)
    },
  })
  /** What the store does: lay out, then write the change itself. */
  function change(id: string, update: NodeChange, adds = true) {
    displacement.afterChange(new Map([[id as NodeId, update]]), adds)
    const node = nodes.get(id as NodeId)!
    if ('vis' in update) node.vis = update.vis ?? undefined
    if (update.position) node.position = update.position
  }
  const y = (id: string) => nodes.get(id as NodeId)!.position.y
  const x = (id: string) => nodes.get(id as NodeId)!.position.x
  return { nodes, displaced, displacement, change, x, y }
}

test('nodeBox: the visualization sits under the node and may be wider', () => {
  expect(nodeBox(new Vec2(10, 20), new Vec2(100, 32), undefined)).toEqual({
    left: 10,
    top: 20,
    right: 110,
    bottom: 52,
  })
  expect(nodeBox(new Vec2(10, 20), new Vec2(100, 32), SHOWN)).toEqual({
    left: 10,
    top: 20,
    right: 210,
    bottom: 202,
  })
  expect(nodeBox(new Vec2(0, 0), new Vec2(100, 32), { ...SHOWN, visible: false })).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 32,
  })
})

test('showing a visualization pushes the node below, hiding it puts it back', () => {
  const g = graph([
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 0, y: 52 },
  ])
  g.change('A', { vis: SHOWN })
  expect(g.y('B')).toBe(202)
  expect(g.displaced.get('B' as NodeId)?.home).toEqual({ x: 0, y: 52 })
  g.change('A', { vis: undefined })
  expect(g.y('B')).toBe(52)
  expect(g.displaced.size).toBe(0)
})

test('widening by the right handle pushes right; by the left handle pushes nothing', () => {
  const start: Spec[] = [
    { id: 'A', x: 0, y: 0, vis: SHOWN },
    { id: 'C', x: 220, y: 40 },
  ]
  const right = graph(start)
  right.change('A', { vis: { ...SHOWN, width: 300 } })
  expect(right.x('C')).toBe(320)

  const left = graph(start)
  left.change('A', {
    vis: { ...SHOWN, width: 300 },
    position: new Vec2(-100, 0),
  })
  expect(left.x('C')).toBe(220)
  expect(left.displaced.size).toBe(0)
})

test('several nodes changing at once are handled top to bottom, whatever the order given', () => {
  const g = graph([
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 0, y: 52 },
    { id: 'C', x: 0, y: 104 },
  ])
  g.displacement.afterChange(
    new Map([
      ['B' as NodeId, { vis: SHOWN }],
      ['A' as NodeId, { vis: SHOWN }],
    ]),
    true,
  )
  expect(g.y('B')).toBe(202)
  expect(g.y('C')).toBe(404)
})

test('a pusher moved by hand releases its nodes and pushes nothing new', () => {
  const g = graph([
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 0, y: 52 },
    { id: 'Q', x: 500, y: 52 },
  ])
  g.change('A', { vis: SHOWN })
  g.change('A', { position: new Vec2(500, 0) }, false)
  expect(g.y('B')).toBe(52)
  expect(g.y('Q')).toBe(52)
})

test('a pushed node moved by hand loses its home at the next layout', () => {
  const g = graph([
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 0, y: 52 },
  ])
  g.change('A', { vis: SHOWN })
  g.change('B', { position: new Vec2(300, 300) }, false)
  expect(g.displaced.size).toBe(0)
  g.change('A', { vis: undefined })
  expect(g.nodes.get('B' as NodeId)!.position).toEqual(new Vec2(300, 300))
})

test('removing a pusher returns the nodes it pushed', () => {
  const g = graph([
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 0, y: 52 },
  ])
  g.change('A', { vis: SHOWN })
  g.displacement.afterRemoval(['A' as NodeId])
  expect(g.y('B')).toBe(52)
})

test('a node with no measured size neither moves nor pushes', () => {
  const g = graph([
    { id: 'A', x: 0, y: 0, w: 0, h: 0 },
    { id: 'B', x: 0, y: 52 },
  ])
  g.change('A', { vis: SHOWN })
  expect(g.y('B')).toBe(52)
})
