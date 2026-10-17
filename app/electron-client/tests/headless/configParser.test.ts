import { parseArgs } from '@/configParser'
import { PASS_TO_WEB } from 'enso-common/src/options'
import { expect, test } from 'vitest'

test('there are no authentication options', () => {
  expect(() => parseArgs(['--authentication.enabled'])).toThrow()
  expect([...PASS_TO_WEB].filter((key) => key.startsWith('authentication.'))).toEqual([])
  expect(parseArgs([])).not.toHaveProperty('authentication')
})
