import { sanitizeCachedAppearance } from '@/util/cachedAppearance'
import { expect, test } from 'vitest'

test.each([
  [undefined, undefined],
  [null, undefined],
  [{}, undefined],
  [
    { color: '#4a7fb0', icon: 'table' },
    { color: '#4a7fb0', icon: 'table' },
  ],
  [{ color: 'oklch(0.464 0.14 123)' }, { color: 'oklch(0.464 0.14 123)' }],
  [{ color: 'rgb(74 127 176)' }, { color: 'rgb(74 127 176)' }],
  [{ color: 'not a colour', icon: 'table' }, { icon: 'table' }],
  [{ color: 'red; background: url(x)' }, undefined],
  [{ color: 42 }, undefined],
  [{ color: '#4a7fb0', icon: 'no_such_icon' }, { color: '#4a7fb0' }],
  [{ icon: '$evaluating' }, undefined],
])('sanitizeCachedAppearance(%o) = %o', (raw, expected) => {
  expect(sanitizeCachedAppearance(raw)).toEqual(expected)
})
