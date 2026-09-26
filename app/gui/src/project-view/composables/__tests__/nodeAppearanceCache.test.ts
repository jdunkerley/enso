import {
  appearanceToCache,
  appearanceToWrite,
  type AppearanceInput,
} from '@/composables/nodeAppearanceCache'
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
  const appearance = appearanceToCache({
    ...computedNode,
    hasColorOverride: true,
    colorSource: 'override',
    icon: DEFAULT_ICON,
  })
  expect(appearance).toEqual({})
  expect(appearanceToWrite(appearance!, undefined, undefined)).toBeUndefined()
})

test('a group colour the sanitizer rejects is not cached', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: 'group',
      resolvedColor: 'hsl(200 50% 40%)',
      icon: 'table',
    }),
  ).toBeUndefined()
})

test('a type colour the sanitizer rejects is not cached', () => {
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: 'type',
      resolvedColor: 'hsl(200 50% 40%)',
      icon: 'table',
    }),
  ).toBeUndefined()
})

const mine = { color: 'oklch(0.464 0.14 123)', icon: 'table' } as const
const theirs = { color: '#4a7fb0', icon: 'data_input' } as const

test('a first computation that matches the stored appearance is not written', () => {
  expect(appearanceToWrite(mine, undefined, { ...mine })).toBeUndefined()
})

test('a first computation that differs from the stored appearance is written', () => {
  expect(appearanceToWrite(mine, undefined, undefined)).toEqual(mine)
  expect(appearanceToWrite(mine, undefined, theirs)).toEqual(mine)
  expect(appearanceToWrite(mine, undefined, { color: mine.color })).toEqual(mine)
})

test('an unchanged local appearance is never rewritten, even after a remote overwrite', () => {
  expect(appearanceToWrite(mine, { ...mine }, { ...mine })).toBeUndefined()
  expect(appearanceToWrite(mine, { ...mine }, theirs)).toBeUndefined()
  expect(appearanceToWrite(mine, { ...mine }, undefined)).toBeUndefined()
})

test('a changed local appearance is written, whatever is stored', () => {
  expect(appearanceToWrite(mine, theirs, theirs)).toEqual(mine)
  expect(appearanceToWrite(mine, { color: mine.color }, { color: mine.color })).toEqual(mine)
})

test('a changed local appearance that is already stored is not written again', () => {
  expect(appearanceToWrite(mine, theirs, { ...mine })).toBeUndefined()
})

test('the computed appearance does not depend on what is stored, bar an overridden colour', () => {
  expect(appearanceToCache({ ...computedNode, stored: { ...mine } })).toEqual(mine)
  expect(appearanceToCache({ ...computedNode, stored: theirs })).toEqual(mine)
})
