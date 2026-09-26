import { appearanceToCache, type AppearanceInput } from '@/composables/nodeAppearanceCache'
import { DEFAULT_ICON } from '@/util/getIconName'
import { expect, test } from 'vitest'

const computedNode: AppearanceInput = {
  type: 'component',
  pending: false,
  hasColorOverride: false,
  colorSource: 'type',
  resolvedColor: 'oklch(0.464 0.14 123)',
  icon: 'table',
  stored: undefined,
}

test('a computed node is cached', () => {
  expect(appearanceToCache(computedNode)).toEqual({
    color: 'oklch(0.464 0.14 123)',
    icon: 'table',
  })
})

test('a group colour is cached as its resolved value, trimmed', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: 'group',
      resolvedColor: ' #4a7fb0',
    }),
  ).toEqual({ color: '#4a7fb0', icon: 'table' })
})

test('the default icon is stored as absent', () => {
  expect(appearanceToCache({ ...computedNode, icon: DEFAULT_ICON })).toEqual({
    color: 'oklch(0.464 0.14 123)',
  })
})

test('nothing is written when the stored appearance is unchanged', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      stored: { color: 'oklch(0.464 0.14 123)', icon: 'table' },
    }),
  ).toBeUndefined()
})

test('a changed colour is rewritten', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      stored: { color: '#000000', icon: 'table' },
    }),
  ).toEqual({ color: 'oklch(0.464 0.14 123)', icon: 'table' })
})

test.each(['input', 'output'] as const)('%s nodes are never cached', (type) => {
  expect(appearanceToCache({ ...computedNode, type })).toBeUndefined()
})

test('pending nodes are not cached', () => {
  expect(appearanceToCache({ ...computedNode, pending: true })).toBeUndefined()
})

test.each(['cached', 'none', 'fixed'] as const)(
  'a colour from source %s is not cached',
  (colorSource) => {
    expect(appearanceToCache({ ...computedNode, colorSource })).toBeUndefined()
  },
)

test('an unresolved group colour is not cached', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: 'group',
      resolvedColor: undefined,
    }),
  ).toBeUndefined()
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: 'group',
      resolvedColor: '',
    }),
  ).toBeUndefined()
})

test('with a colour override, only the icon is updated and a stored colour is kept', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      hasColorOverride: true,
      colorSource: 'override',
      resolvedColor: '#ff0000',
      stored: { color: '#111111', icon: 'data_input' },
    }),
  ).toEqual({ color: '#111111', icon: 'table' })
  expect(
    appearanceToCache({
      ...computedNode,
      hasColorOverride: true,
      colorSource: 'override',
      resolvedColor: '#ff0000',
    }),
  ).toEqual({ icon: 'table' })
})

test('with a colour override and the default icon, nothing is written', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      hasColorOverride: true,
      colorSource: 'override',
      icon: DEFAULT_ICON,
    }),
  ).toBeUndefined()
})
