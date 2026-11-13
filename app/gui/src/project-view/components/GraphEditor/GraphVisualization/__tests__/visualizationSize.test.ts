import { visualizationSize } from '@/components/GraphEditor/GraphVisualization/visualizationSize'
import { Vec2 } from '@/util/data/vec2'
import { expect, test } from 'vitest'

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
