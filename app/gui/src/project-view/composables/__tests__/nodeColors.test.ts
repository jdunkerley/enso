import { computeNodeColor } from '@/composables/nodeColors'
import { colorFromString } from '@/util/colors'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'

const group = { name: 'Input', project: 'Standard.Base' as QualifiedName }
const typeName = ProjectPath.create(
  'Standard.Base' as QualifiedName,
  'Data.Numbers.Integer' as QualifiedName,
)
const cached = () => '#4a7fb0'
const none = () => undefined

test('input and output nodes have a fixed colour, even with a cache', () => {
  expect(computeNodeColor(() => 'output', none, none, cached)).toEqual({
    color: 'var(--output-node-color)',
    source: 'fixed',
  })
  expect(computeNodeColor(() => 'input', none, none, cached).source).toBe('fixed')
})

test('a group colour beats the type and the cache', () => {
  expect(
    computeNodeColor(
      () => 'component',
      () => group,
      () => typeName,
      cached,
    ),
  ).toEqual({
    color: 'var(--group-color-Standard-Base-Input)',
    source: 'group',
  })
})

test('a type colour beats the cache', () => {
  expect(
    computeNodeColor(
      () => 'component',
      none,
      () => typeName,
      cached,
    ),
  ).toEqual({
    color: colorFromString(typeName.key()),
    source: 'type',
  })
})

test('the cached colour is used when nothing is known', () => {
  expect(computeNodeColor(() => 'component', none, none, cached)).toEqual({
    color: '#4a7fb0',
    source: 'cached',
  })
})

test('without a cache the no-type colour is used', () => {
  expect(computeNodeColor(() => 'component', none, none)).toEqual({
    color: 'var(--node-color-no-type)',
    source: 'none',
  })
})
