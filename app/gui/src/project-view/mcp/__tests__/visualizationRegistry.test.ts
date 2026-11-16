import { expect, test } from 'vitest'
import {
  lookupVisualization,
  registerVisualization,
  type VisualizationEntry,
} from '../visualizationRegistry'

function entry(name: string): VisualizationEntry {
  return {
    panel: () => undefined,
    status: () => 'ready',
    name: () => name,
    data: () => null,
    fullscreen: () => false,
  }
}

test('an entry is found by project and node until it is removed', () => {
  const remove = registerVisualization('p1', 'n1', entry('Table'))
  expect(lookupVisualization('p1', 'n1')?.name()).toBe('Table')
  expect(lookupVisualization('p2', 'n1')).toBeUndefined()
  expect(lookupVisualization('p1', 'n2')).toBeUndefined()
  remove()
  expect(lookupVisualization('p1', 'n1')).toBeUndefined()
})

test('removing a replaced entry leaves its replacement', () => {
  const removeOld = registerVisualization('p1', 'n1', entry('Old'))
  const removeNew = registerVisualization('p1', 'n1', entry('New'))
  removeOld()
  expect(lookupVisualization('p1', 'n1')?.name()).toBe('New')
  removeNew()
  expect(lookupVisualization('p1', 'n1')).toBeUndefined()
})
