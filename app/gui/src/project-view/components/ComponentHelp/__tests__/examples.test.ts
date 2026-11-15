import { exampleCodeText, exampleToNodes } from '@/components/ComponentHelp/examples'
import { expect, test } from 'vitest'

const EXAMPLE = [
  'start = Date.new 2020 1 1',
  'end = Date.new 2020 2 1',
  'start.work_days_until end',
  '# → 23',
].join('\n')

test('each statement becomes a node; assignments keep their names', () => {
  const nodes = exampleToNodes(EXAMPLE)!
  expect(nodes.map(({ binding, expression }) => ({ binding, expression }))).toEqual([
    { binding: 'start', expression: 'Date.new 2020 1 1' },
    { binding: 'end', expression: 'Date.new 2020 2 1' },
    { binding: undefined, expression: 'start.work_days_until end' },
  ])
})

test('nodes are stacked downwards, one under the other', () => {
  const ys = exampleToNodes(EXAMPLE)!.map((n) => n.metadata!.position!.y)
  expect(ys[0]).toBe(0)
  expect(ys[1]).toBeGreaterThan(ys[0]!)
  expect(ys[2]).toBeGreaterThan(ys[1]!)
})

test('comments and the result line are not nodes', () => {
  expect(exampleToNodes('# a note\nx = 1\n# → 1')).toHaveLength(1)
})

test('an example that does not parse, or is empty, gives no nodes', () => {
  expect(exampleToNodes('x = = 1')).toBeUndefined()
  expect(exampleToNodes('# only a comment')).toBeUndefined()
})

test('the text drops the result line', () => {
  expect(exampleCodeText(EXAMPLE)).toBe(EXAMPLE.split('\n').slice(0, 3).join('\n'))
})
