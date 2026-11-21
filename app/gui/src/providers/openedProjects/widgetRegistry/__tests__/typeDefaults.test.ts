import * as engineLogAppend from '$/providers/engineLogAppend'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import {
  MAX_RETRY_DELAY_MS,
  RESOLVE_TYPE_EXPRESSION,
  RETRY_DELAY_MS,
  TypeDefaults,
  chooseComputedFrame,
  defaultSourceType,
  hasWidgetConversion,
  isTypeDefault,
} from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import { flushPromises } from '@vue/test-utils'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed, effectScope } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'

const make = (
  ...args: ConstructorParameters<typeof TypeDefaults> extends (
    [infer H, infer Q, infer F, ...unknown[]]
  ) ?
    [H, Q, F?]
  : never
) => {
  const defaults = new TypeDefaults(args[0], args[1], args[2] ?? ((frame) => frame), 'project')
  created.push(defaults)
  return defaults
}
const created: TypeDefaults[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(engineLogAppend, 'reportWidgetSchemaMismatch').mockImplementation(() => {})
})
afterEach(() => {
  created.splice(0).forEach((defaults) => defaults.dispose())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
  const defaults = make(() => true, query)
  expect(defaults.lookup(DATE, frameA)).toBeUndefined() // pending
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
  expect(defaults.lookup(DATE, frameB)).toEqual({ kind: 'Date_Input' })
  expect(query).toHaveBeenCalledTimes(1)
  expect(query).toHaveBeenCalledWith(frameA, RESOLVE_TYPE_EXPRESSION(DATE))
})

test('does not ask for a type without a Widget conversion', () => {
  const query = vi.fn()
  const defaults = make(() => false, query)
  expect(defaults.lookup('My.Type', frameA)).toBeUndefined()
  expect(query).not.toHaveBeenCalled()
})

test.each([
  ['an error', { error: { step: 'type_default', message: 'boom' } }],
  ['a null widget', { widget: null }],
  ['an unreadable widget', { widget: { constructor: 'Nope' } }],
])('%s gives no default and is not asked again', async (_name, answer) => {
  const query = vi.fn(async () => Ok(answer))
  const defaults = make(() => true, query)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toBeUndefined()
  expect(query).toHaveBeenCalledTimes(1)
})

test('an unreadable widget is reported once', async () => {
  const report = vi.mocked(engineLogAppend.reportWidgetSchemaMismatch)
  const defaults = make(
    () => true,
    async () => Ok({ widget: { constructor: 'Nope' } }),
  )
  defaults.lookup(DATE, frameA)
  await flushPromises()
  defaults.lookup(DATE, frameA)
  expect(report).toHaveBeenCalledTimes(1)
})

const WIDGET = Ok({ widget: { constructor: 'Date_Input' } })
type Query = (frame: ExternalId, code: string) => Promise<Result<unknown> | null>

test.each([
  ['no result yet', () => Promise.resolve(null)],
  ['an Err result (a timeout)', () => Promise.resolve(Err('timeout'))],
  ['a rejected promise', () => Promise.reject(new Error('boom'))],
])('%s is asked again once the retry delay has passed', async (_name, failure) => {
  const query = vi.fn<Query>().mockImplementationOnce(failure).mockResolvedValueOnce(WIDGET)
  const defaults = make(() => true, query)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  // The delay has not passed: no new query.
  expect(defaults.lookup(DATE, frameA)).toBeUndefined()
  await flushPromises()
  expect(query).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(RETRY_DELAY_MS)
  expect(defaults.lookup(DATE, frameA)).toBeUndefined() // asks again
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
  expect(query).toHaveBeenCalledTimes(2)
})

test('a failure does not re-run what called lookup until the timer fires', async () => {
  const query = vi.fn<Query>().mockResolvedValue(null)
  const defaults = make(() => true, query)
  const scope = effectScope()
  const runs = vi.fn()
  const result = scope.run(() =>
    computed(() => {
      runs()
      return defaults.lookup(DATE, frameA)
    }),
  )!
  void result.value
  await flushPromises()
  void result.value
  await flushPromises()
  expect(runs).toHaveBeenCalledTimes(1)
  expect(query).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(RETRY_DELAY_MS)
  void result.value
  expect(runs).toHaveBeenCalledTimes(2)
  expect(query).toHaveBeenCalledTimes(2)
  scope.stop()
})

test('the retry delay doubles up to a cap and starts over after an answer', async () => {
  const query = vi.fn<Query>().mockResolvedValue(null)
  const defaults = make(() => true, query)
  const asks = async () => {
    defaults.lookup(DATE, frameA)
    await flushPromises()
    return query.mock.calls.length
  }
  expect(await asks()).toBe(1)
  let delay = RETRY_DELAY_MS
  for (let calls = 2; calls <= 8; calls++) {
    vi.advanceTimersByTime(delay - 1)
    expect(await asks()).toBe(calls - 1) // not yet
    vi.advanceTimersByTime(1)
    expect(await asks()).toBe(calls)
    delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
  }
  expect(delay).toBe(MAX_RETRY_DELAY_MS)
  query.mockResolvedValueOnce(WIDGET)
  vi.advanceTimersByTime(MAX_RETRY_DELAY_MS)
  expect(await asks()).toBe(9)
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
})

test('types are cached independently', async () => {
  const query = vi.fn<Query>().mockResolvedValue(WIDGET)
  const defaults = make(() => true, query)
  defaults.lookup(DATE, frameA)
  defaults.lookup('Standard.Base.Data.Text.Text', frameA)
  await flushPromises()
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

test('a query goes to another computed frame when the first callers frame is not computed', async () => {
  const query = vi.fn<Query>().mockResolvedValue(WIDGET)
  const defaults = make(
    () => true,
    query,
    (preferred) => (preferred === frameA ? frameB : preferred),
  )
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(query).toHaveBeenCalledWith(frameB, RESOLVE_TYPE_EXPRESSION(DATE))
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
})

test('with no computed frame nothing is asked, and a retry picks the frame again', async () => {
  const query = vi.fn<Query>().mockResolvedValue(WIDGET)
  let available: ExternalId | undefined = undefined
  const defaults = make(
    () => true,
    query,
    () => available,
  )
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(query).not.toHaveBeenCalled()
  expect(defaults.lookup(DATE, frameA)).toBeUndefined() // waiting for the retry
  available = frameB
  vi.advanceTimersByTime(RETRY_DELAY_MS)
  expect(defaults.lookup(DATE, frameA)).toBeUndefined() // asks again
  await flushPromises()
  expect(query).toHaveBeenCalledWith(frameB, RESOLVE_TYPE_EXPRESSION(DATE))
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: 'Date_Input' })
})

test('only a configuration a lookup returned is a type default', async () => {
  const defaults = make(
    () => true,
    async () => WIDGET,
  )
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(isTypeDefault(defaults.lookup(DATE, frameA))).toBe(true)
  expect(isTypeDefault({ kind: 'Date_Input' })).toBe(false)
  expect(isTypeDefault(undefined)).toBe(false)
})

const frameC = 'cccccccc-cccc-cccc-cccc-cccccccccccc' as ExternalId
const frameStale = 'dddddddd-dddd-dddd-dddd-dddddddddddd' as ExternalId

test('a computed entry that is not a candidate (a stale one) is never chosen', () => {
  const computed = new Set([frameStale, frameB])
  const isComputed = (frame: ExternalId) => computed.has(frame)
  // The registry holds the stale entry; the graph's nodes are only B and C.
  expect(chooseComputedFrame(frameA, new Set(), [frameB, frameC], isComputed)).toBe(frameB)
  expect(chooseComputedFrame(frameA, new Set([frameB]), [frameB, frameC], isComputed)).toBe(
    undefined,
  )
})

test('the caller frame is chosen when computed and not avoided', () => {
  const isComputed = () => true
  expect(chooseComputedFrame(frameA, new Set(), [frameB], isComputed)).toBe(frameA)
  expect(chooseComputedFrame(frameA, new Set([frameA]), [frameB], isComputed)).toBe(frameB)
})

test('a frame the query failed in is not asked again while another exists', async () => {
  const query = vi.fn<Query>().mockResolvedValue(null)
  const pick = vi.fn((preferred: ExternalId, avoid: ReadonlySet<ExternalId>) =>
    [preferred, frameB].find((frame) => !avoid.has(frame)),
  )
  const defaults = make(() => true, query, pick)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  vi.advanceTimersByTime(RETRY_DELAY_MS)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(query.mock.calls.map(([frame]) => frame)).toEqual([frameA, frameB])
  // Both failed: it starts over instead of giving up.
  vi.advanceTimersByTime(2 * RETRY_DELAY_MS)
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(query.mock.calls.map(([frame]) => frame)).toEqual([frameA, frameB, frameA])
})
