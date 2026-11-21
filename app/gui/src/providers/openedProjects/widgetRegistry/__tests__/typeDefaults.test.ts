import * as engineLogAppend from '$/providers/engineLogAppend'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import {
  RESOLVE_TYPE_EXPRESSION,
  TypeDefaults,
  defaultSourceType,
  hasWidgetConversion,
} from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import { flushPromises } from '@vue/test-utils'
import { Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import type { ExternalId } from 'ydoc-shared/yjsModel'

const DATE = 'Standard.Base.Data.Time.Date.Date'
const frameA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as ExternalId
const frameB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as ExternalId

test.each([
  ['Standard.Base.Data.Numbers.Integer', 'Standard.Base.Data.Numbers.Integer'],
  [
    'Standard.Base.Data.Numbers.Integer | Standard.Base.Nothing.Nothing',
    'Standard.Base.Data.Numbers.Integer',
  ],
  ['Standard.Base.Nothing.Nothing | Standard.Base.Data.Text.Text', 'Standard.Base.Data.Text.Text'],
  ['Standard.Base.Nothing.Nothing', undefined],
  [undefined, undefined],
])('defaultSourceType(%s)', (repr, expected) => {
  expect(defaultSourceType(repr)).toBe(expected)
})

test('asks once per type and caches the answer', async () => {
  const query = vi.fn(async () => Ok({ widget: { constructor: 'Date_Input' } }))
  const defaults = new TypeDefaults(() => true, query)
  expect(defaults.lookup(DATE, frameA)).toBeUndefined() // pending
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
  expect(defaults.lookup(DATE, frameB)).toEqual({ kind: 'Date_Input' })
  expect(query).toHaveBeenCalledTimes(1)
  expect(query).toHaveBeenCalledWith(frameA, RESOLVE_TYPE_EXPRESSION(DATE))
})

test('does not ask for a type without a Widget conversion', () => {
  const query = vi.fn()
  const defaults = new TypeDefaults(() => false, query)
  expect(defaults.lookup('My.Type', frameA)).toBeUndefined()
  expect(query).not.toHaveBeenCalled()
})

test.each([
  ['an error', { error: { step: 'type_default', message: 'boom' } }],
  ['a null widget', { widget: null }],
  ['an unreadable widget', { widget: { constructor: 'Nope' } }],
])('%s gives no default and is not asked again', async (_name, answer) => {
  const query = vi.fn(async () => Ok(answer))
  const defaults = new TypeDefaults(() => true, query)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toBeUndefined()
  expect(query).toHaveBeenCalledTimes(1)
})

test('an unreadable widget is reported once', async () => {
  const report = vi
    .spyOn(engineLogAppend, 'reportWidgetSchemaMismatch')
    .mockImplementation(() => {})
  const defaults = new TypeDefaults(
    () => true,
    async () => Ok({ widget: { constructor: 'Nope' } }),
  )
  defaults.lookup(DATE, frameA)
  await flushPromises()
  defaults.lookup(DATE, frameA)
  expect(report).toHaveBeenCalledTimes(1)
})

test('a failed query (no result yet) is retried on the next lookup', async () => {
  const query = vi
    .fn<(frame: ExternalId, code: string) => Promise<Result<unknown> | null>>()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(Ok({ widget: { constructor: 'Date_Input' } }))
  const defaults = new TypeDefaults(() => true, query)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toBeUndefined() // asks again
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
  expect(query).toHaveBeenCalledTimes(2)
})

test('hasWidgetConversion reads the suggestion database `Widget.from` entries', () => {
  const db = SuggestionDb.createMock([
    makeMethod('Standard.Base.Metadata.Widget.from', {
      args: [makeArgument('that', `${DATE}.type`)],
    }),
  ])
  expect(hasWidgetConversion(db, DATE)).toBe(true)
  expect(hasWidgetConversion(db, 'Standard.Base.Data.Text.Text')).toBe(false)
})
