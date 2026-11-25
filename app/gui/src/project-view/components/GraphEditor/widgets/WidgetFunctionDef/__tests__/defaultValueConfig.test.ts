import { expect, test, vi } from 'vitest'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { defaultValueConfig } from '../defaultValueConfig'

const DATE = 'Standard.Base.Data.Time.Date.Date'
const frame = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as ExternalId

test('without a frame, the type default is not looked up', () => {
  const lookup = vi.fn(() => ({ kind: 'Date_Input' }) as const)
  expect(defaultValueConfig({ lookup }, DATE, undefined)).toBeUndefined()
  expect(lookup).not.toHaveBeenCalled()
})

test("with a frame, it is the declared type's default, asked in that frame", () => {
  const lookup = vi.fn(() => ({ kind: 'Date_Input' }) as const)
  expect(defaultValueConfig({ lookup }, DATE, frame)).toEqual({ kind: 'Date_Input' })
  expect(lookup).toHaveBeenCalledWith(DATE, frame)
})
