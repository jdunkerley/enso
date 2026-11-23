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
  convertsBetween,
  hasWidgetConversion,
  isTypeDefault,
} from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import { flushPromises } from '@vue/test-utils'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed, effectScope, reactive, watch } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'

const make = (
  ...args: ConstructorParameters<typeof TypeDefaults> extends (
    [infer H, infer Q, infer F, infer _P, infer C]
  ) ?
    [H, Q, F?, C?]
  : never
) => {
  const defaults = new TypeDefaults(
    args[0],
    args[1],
    args[2] ?? ((frame) => frame),
    'project',
    args[3],
  )
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
const TEXT = 'Standard.Base.Data.Text.Text'
const INTEGER = 'Standard.Base.Data.Numbers.Integer'
const FILE = 'Standard.Base.System.File.File'
const NOTHING = 'Standard.Base.Nothing.Nothing'
const frameA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as ExternalId
const frameB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as ExternalId

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

const answerFor = (answers: Record<string, unknown>) => async (_frame: ExternalId, code: string) =>
  Ok(answers[Object.keys(answers).find((t) => code.includes(`'${t}'`))!])

test('a union asks each member once and composes them', async () => {
  const query = vi.fn(
    answerFor({
      [TEXT]: { widget: { constructor: 'Text_Input' } },
      [INTEGER]: { widget: { constructor: 'Numeric_Input' } },
    }),
  )
  const defaults = make(() => true, query)
  const union = `${TEXT} | ${INTEGER} | ${NOTHING}`
  expect(defaults.lookup(union, frameA)).toBeUndefined() // pending
  await flushPromises()
  expect(defaults.lookup(union, frameA)).toMatchObject({
    kind: 'Union',
    kinds: [{ label: 'Text' }, { label: 'Integer' }, { label: 'Nothing', config: null }],
  })
  expect(query).toHaveBeenCalledTimes(2) // Nothing is never asked
  defaults.lookup(TEXT, frameB)
  expect(query).toHaveBeenCalledTimes(2) // members are cached as types
})

test('a composed union is a type default, with a stable identity', async () => {
  const defaults = make(
    () => true,
    answerFor({
      [TEXT]: { widget: { constructor: 'Text_Input' } },
      [INTEGER]: { widget: { constructor: 'Numeric_Input' } },
    }),
  )
  const union = `${TEXT} | ${INTEGER}`
  defaults.lookup(union, frameA)
  await flushPromises()
  const first = defaults.lookup(union, frameA)
  expect(first?.kind).toBe('Union')
  expect(isTypeDefault(first)).toBe(true)
  expect(defaults.lookup(union, frameA)).toBe(first)
})

test('a member without a Widget conversion is not asked and not a kind', async () => {
  const query = vi.fn(async () => Ok({ widget: { constructor: 'Text_Input' } }))
  const defaults = make((t) => t === TEXT, query)
  const repr = `${TEXT} | Standard.Base.Network.URI.URI`
  defaults.lookup(repr, frameA)
  await flushPromises()
  expect(defaults.lookup(repr, frameA)).toEqual({ kind: 'Text_Input' })
  expect(query).toHaveBeenCalledTimes(1)
})

test('Integer | Nothing is no longer just Integers widget', async () => {
  const defaults = make(
    () => true,
    async () => Ok({ widget: { constructor: 'Numeric_Input' } }),
  )
  const repr = `${INTEGER} | ${NOTHING}`
  defaults.lookup(repr, frameA)
  await flushPromises()
  expect(defaults.lookup(repr, frameA)?.kind).toBe('Union')
})

test('a conversion between members drops the absorbed one', async () => {
  const defaults = make(
    () => true,
    answerFor({
      [TEXT]: { widget: { constructor: 'Text_Input' } },
      [FILE]: {
        /* eslint-disable camelcase */
        widget: { constructor: 'File_Browse', existing_only: true, action: 'Open', file_types: [] },
        /* eslint-enable camelcase */
      },
    }),
    undefined,
    (source, target) => source === TEXT && target === FILE,
  )
  defaults.lookup(`${TEXT} | ${FILE}`, frameA)
  await flushPromises()
  expect(defaults.lookup(`${TEXT} | ${FILE}`, frameA)?.kind).toBe('File_Browse')
})

test('a union re-composes when a conversion appears, and is stable until then', async () => {
  const known = reactive(new Set<string>())
  const defaults = make(
    () => true,
    answerFor({
      [TEXT]: { widget: { constructor: 'Text_Input' } },
      [INTEGER]: { widget: { constructor: 'Numeric_Input' } },
    }),
    undefined,
    (source, target) => known.has(`${source}>${target}`),
  )
  const union = `${TEXT} | ${INTEGER}`
  defaults.lookup(union, frameA)
  await flushPromises()
  const seen: (string | undefined)[] = []
  const scope = effectScope()
  const config = scope.run(() => computed(() => defaults.lookup(union, frameA)))!
  scope.run(() => watch(config, (value) => seen.push(value?.kind), { flush: 'sync' }))
  const first = config.value
  expect(first?.kind).toBe('Union')
  expect(defaults.lookup(union, frameA)).toBe(first)
  known.add(`${TEXT}>${INTEGER}`)
  expect(config.value?.kind).toBe('Numeric_Input')
  expect(seen).toEqual(['Numeric_Input'])
  scope.stop()
})

test('convertsBetween reads the suggestion database `Target.from` entries', () => {
  const db = SuggestionDb.createMock([
    makeMethod(`${FILE}.from`, { args: [makeArgument('that', TEXT)] }),
  ])
  expect(convertsBetween(db, TEXT, FILE)).toBe(true)
  expect(convertsBetween(db, FILE, TEXT)).toBe(false)
})

test('a type whose default is a resolver has no static default, and says what it reads', async () => {
  const report = vi.mocked(engineLogAppend.reportWidgetSchemaMismatch)
  const resolver = { dependencies: ['self'], searchable: false }
  const query = vi.fn(async () => Ok({ widget: null, resolver }))
  const defaults = make(() => true, query)
  expect(defaults.resolverDefault(DATE, frameA)).toBeUndefined() // pending
  await flushPromises()
  expect(defaults.lookup(DATE, frameA)).toBeUndefined()
  expect(defaults.resolverDefault(DATE, frameA)).toEqual(resolver)
  expect(defaults.resolverDefault(`${DATE} | ${TEXT}`, frameA)).toBeUndefined()
  expect(query).toHaveBeenCalledTimes(1)
  expect(report).not.toHaveBeenCalled()
})

test('a static default is no resolver default', async () => {
  const defaults = make(
    () => true,
    async () => Ok({ widget: { constructor: 'Date_Input' } }),
  )
  defaults.lookup(DATE, frameA)
  await flushPromises()
  expect(defaults.resolverDefault(DATE, frameA)).toBeUndefined()
})
