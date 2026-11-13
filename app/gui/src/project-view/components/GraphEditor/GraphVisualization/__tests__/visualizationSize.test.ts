import {
  handleResize,
  visualizationSize,
} from '@/components/GraphEditor/GraphVisualization/visualizationSize'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { expect, test } from 'vitest'

// A default visualization under a 120px node at (100, 50): drawn 200 wide, its right edge at 300.
const drag = (dx: number) => new Rect(new Vec2(100 + dx, 50), new Vec2(200 - dx, 150))

test('a left drag inwards past the floor keeps the right edge fixed', () => {
  expect(handleResize(drag(60), { left: true }, 120)).toEqual({
    width: 200,
    position: new Vec2(100, 50),
  })
})

test('a left drag inwards is floored at the node width when that is wider', () => {
  // Started 400 wide at x 100 (right edge 500), dragged 150 inwards under a 300px node.
  const dragged = new Rect(new Vec2(250, 50), new Vec2(250, 150))
  expect(handleResize(dragged, { left: true }, 300)).toEqual({
    width: 300,
    position: new Vec2(200, 50),
  })
})

test('a left drag onto the right edge still sends the width with the position', () => {
  const collapsed = new Rect(new Vec2(300, 50), new Vec2(0, 150))
  expect(handleResize(collapsed, { left: true }, 120)).toEqual({
    width: 200,
    position: new Vec2(100, 50),
  })
})

test('a left drag outwards widens and moves left by the same amount', () => {
  expect(handleResize(drag(-40), { left: true }, 120)).toEqual({
    width: 240,
    position: new Vec2(60, 50),
  })
})

test('right and bottom drags carry no position', () => {
  const grown = new Rect(new Vec2(100, 50), new Vec2(260, 190))
  expect(handleResize(grown, { right: true }, 120)).toEqual({ width: 260 })
  expect(handleResize(grown, { bottom: true }, 120)).toEqual({ height: 190 })
  expect(handleResize(grown, { right: true, bottom: true }, 120)).toEqual({
    width: 260,
    height: 190,
  })
})

test('a side dragged onto the opposite one saves no zero size', () => {
  const flat = new Rect(new Vec2(100, 50), new Vec2(0, 0))
  expect(handleResize(flat, { right: true, bottom: true }, 120)).toEqual({})
})

test.each([
  {
    name: 'defaults',
    width: null,
    height: null,
    node: 120,
    expected: new Vec2(200, 150),
  },
  {
    name: 'saved size',
    width: 500,
    height: 300,
    node: 120,
    expected: new Vec2(500, 300),
  },
  {
    name: 'never narrower than the node',
    width: 250,
    height: null,
    node: 400,
    expected: new Vec2(400, 150),
  },
  {
    name: 'never below the minimum',
    width: 50,
    height: 10,
    node: 120,
    expected: new Vec2(200, 32),
  },
])('visualizationSize: $name', ({ width, height, node, expected }) => {
  expect(visualizationSize(width, height, node)).toEqual(expected)
})
