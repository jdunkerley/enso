import { expect, test } from 'vitest'
import type { Uuid } from 'ydoc-shared/languageServerTypes'
import { parseRootAddress, resolveRelativeImport, rootAddress } from '../rootAddress'

const ROOT = '6f9d2c1e-0000-4000-8000-000000000001' as Uuid
const BASE = 'http://localhost:5173/'

test('an address round-trips', () => {
  const address = rootAddress(ROOT, ['visualizations', 'Image.vue'])
  expect(address).toBe(`enso-root:${ROOT}/visualizations/Image.vue`)
  expect(parseRootAddress(address)).toEqual({
    rootId: ROOT,
    segments: ['visualizations', 'Image.vue'],
  })
})

test('segments with special characters round-trip', () => {
  const segments = ['visualizations', 'My Viz (2) 100%.vue']
  expect(parseRootAddress(rootAddress(ROOT, segments))).toEqual({ rootId: ROOT, segments })
})

test('a relative import resolves inside the same root, with the worker’s own resolution', () => {
  const dir = rootAddress(ROOT, ['visualizations', 'Image.vue']).replace(/[^/\\]+$/, '')
  const resolved = resolveRelativeImport(dir, './util/helper.ts', BASE)
  expect(resolved).toBe(`enso-root:${ROOT}/visualizations/util/helper.ts`)
  expect(parseRootAddress(resolved)).toEqual({
    rootId: ROOT,
    segments: ['visualizations', 'util', 'helper.ts'],
  })
})

test('a parent-directory import resolves inside the same root', () => {
  const dir = `enso-root:${ROOT}/visualizations/sub/`
  expect(parseRootAddress(resolveRelativeImport(dir, '../shared/a.ts', BASE))).toEqual({
    rootId: ROOT,
    segments: ['visualizations', 'shared', 'a.ts'],
  })
})

test('an import that climbs out of the root is refused', () => {
  const dir = `enso-root:${ROOT}/visualizations/`
  expect(() => resolveRelativeImport(dir, '../../a.ts', BASE)).toThrow(/outside its content root/)
})

test('an import that climbs into another root is refused', () => {
  const dir = `enso-root:${ROOT}/visualizations/`
  const other = '6f9d2c1e-0000-4000-8000-000000000009'
  // Climbing above the root is clamped by the resolver, so this lands in `other`'s root.
  expect(() => resolveRelativeImport(dir, `../../../${other}/a.ts`, BASE)).toThrow(
    /outside its content root/,
  )
})

test('an import between two directories of one root is allowed', () => {
  const dir = `enso-root:${ROOT}/visualizations/`
  expect(resolveRelativeImport(dir, '../lib/a.ts', BASE)).toBe(`enso-root:${ROOT}/lib/a.ts`)
})

test('an address with a dot segment is not a root address', () => {
  expect(parseRootAddress(`enso-root:${ROOT}/visualizations/../a.vue`)).toBeUndefined()
  expect(parseRootAddress(`enso-root:${ROOT}/visualizations/./a.vue`)).toBeUndefined()
  expect(parseRootAddress(`enso-root:${ROOT}/visualizations/%2e%2e/a.vue`)).toBeUndefined()
})

test('an address whose segment holds a slash is not a root address', () => {
  expect(parseRootAddress(`enso-root:${ROOT}/visualizations%2Fa.vue`)).toBeUndefined()
})

test('an address whose segment holds a backslash is not a root address', () => {
  expect(parseRootAddress(`enso-root:${ROOT}/visualizations/%5C..%5Cx`)).toBeUndefined()
  expect(parseRootAddress(`enso-root:${ROOT}/visualizations%5Ca.vue`)).toBeUndefined()
})

test('http imports are left as absolute URLs', () => {
  expect(resolveRelativeImport('https://example.com/viz/', './a.ts', BASE)).toBe(
    'https://example.com/viz/a.ts',
  )
})

test('other addresses are not root addresses', () => {
  expect(parseRootAddress('https://example.com/a.vue')).toBeUndefined()
  expect(parseRootAddress('enso-root:not-a-uuid/a.vue')).toBeUndefined()
  expect(parseRootAddress('enso-current-project:visualizations/a.vue')).toBeUndefined()
})
