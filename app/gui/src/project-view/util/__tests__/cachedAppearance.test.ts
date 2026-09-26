import { sanitizeCachedAppearance } from '@/util/cachedAppearance'
import { expect, test } from 'vitest'

/** A valid `rgb()` colour exactly `length` characters long, padded with zeros in its fraction. */
function longColor(length: number) {
  const prefix = 'rgb(74 127 176.'
  return prefix + '0'.repeat(length - prefix.length - 1) + ')'
}

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
  // At most 64 characters, as the file format allows; one over drops the colour alone.
  [
    { color: longColor(64), icon: 'table' },
    { color: longColor(64), icon: 'table' },
  ],
  [{ color: longColor(65), icon: 'table' }, { icon: 'table' }],
  [{ color: '#4a7fb0', icon: 'x'.repeat(65) }, { color: '#4a7fb0' }],
])('sanitizeCachedAppearance(%o) = %o', (raw, expected) => {
  expect(sanitizeCachedAppearance(raw)).toEqual(expected)
})
