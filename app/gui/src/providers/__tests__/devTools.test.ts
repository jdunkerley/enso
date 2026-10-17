import { createDevtoolsStore } from '$/providers/devTools'
import { expect, test } from 'vitest'

test('the devtools store only carries the version checker override', () => {
  expect(Object.keys(createDevtoolsStore())).toEqual(['showVersionChecker'])
})
