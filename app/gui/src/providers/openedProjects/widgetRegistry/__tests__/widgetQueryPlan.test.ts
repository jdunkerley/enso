/* eslint-disable camelcase */
import { describe, expect, test } from 'vitest'
import {
  RESOLVER_TIME_BOX_MS,
  SEARCH_DEBOUNCE_MS,
  isStaticAnswer,
  namedDependencies,
  queryUuids,
  revisionStamp,
  withoutUnsetDependencyNotes,
} from '../widgetQueryPlan'

const all = { right: 'id-right', on: 'id-on', join_kind: 'id-kind' }
const onResolver = new Map([['on', { dependencies: ['self', 'right'], searchable: false }]])

describe('queryUuids', () => {
  test('the first query sends every argument', () => {
    expect(queryUuids(all, undefined)).toEqual(all)
  })
  test('afterwards only declared dependencies', () => {
    expect(queryUuids(all, onResolver)).toEqual({ right: 'id-right' })
  })
  test('an unrelated argument changing leaves the sent ids equal', () => {
    expect(queryUuids({ ...all, join_kind: 'id-kind-2' }, onResolver)).toEqual(
      queryUuids(all, onResolver),
    )
  })
  test('a dependency not in the call is not sent', () => {
    expect(queryUuids({ on: 'id-on' }, onResolver)).toEqual({})
  })
  test('resolvers depending only on self send nothing', () => {
    const selfOnly = new Map([['a', { dependencies: ['self'], searchable: true }]])
    expect(queryUuids(all, selfOnly)).toEqual({})
  })
})

test('namedDependencies drops self and repeats', () => {
  const resolvers = new Map([
    ['a', { dependencies: ['self', 'x'], searchable: false }],
    ['b', { dependencies: ['x', 'y'], searchable: true }],
  ])
  expect(namedDependencies(resolvers)).toEqual(['x', 'y'])
  expect(namedDependencies(undefined)).toEqual([])
})

test('revisionStamp follows the values by identity', () => {
  const ids = new WeakMap<object, number>()
  const v1 = {}
  const v2 = {}
  const first = revisionStamp([v1], ids)
  expect(revisionStamp([v1], ids)).toBe(first)
  expect(revisionStamp([v2], ids)).not.toBe(first)
  expect(revisionStamp([], ids)).toBe('')
  expect(revisionStamp([undefined, v1], ids)).toBe(`undefined.${first}`)
})

test('isStaticAnswer', () => {
  expect(isStaticAnswer({ arguments: [['a', { widget: null }]] })).toBe(true)
  expect(
    isStaticAnswer({
      arguments: [['a', { widget: null, resolver: { dependencies: ['self'], searchable: false } }]],
    }),
  ).toBe(false)
  expect(
    isStaticAnswer({
      arguments: [
        [
          'a',
          {
            error: { step: 'resolver', message: 'x' },
            resolver: { dependencies: [], searchable: false },
          },
        ],
      ],
    }),
  ).toBe(false)
  expect(
    isStaticAnswer({
      arguments: [['a', { widget: null }]],
      columns: { '': { names: [], kinds: [], type_names: [] } },
    }),
  ).toBe(false)
})

test('the time constants', () => {
  expect(SEARCH_DEBOUNCE_MS).toBe(250)
  expect(RESOLVER_TIME_BOX_MS).toBe(2000)
})

describe('withoutUnsetDependencyNotes', () => {
  const unavailable = (dependency: string) =>
    ({ kind: 'unavailable', dependency, message: 'boom' }) as const
  test('an unset dependency gets no marker (a Missing_Argument, not a problem)', () => {
    expect(withoutUnsetDependencyNotes(new Map([['on', unavailable('right')]]), new Set())).toBe(
      undefined,
    )
  })
  test('a set dependency whose value is an error keeps it', () => {
    const notes = new Map([['on', unavailable('right')]])
    expect(withoutUnsetDependencyNotes(notes, new Set(['right']))).toEqual(notes)
  })
  test('`self` and loading notes are kept', () => {
    const notes = new Map<string, ReturnType<typeof unavailable> | { kind: 'loading' }>([
      ['on', unavailable('self')],
      ['columns', { kind: 'loading' }],
      ['other', unavailable('right')],
    ])
    expect([...(withoutUnsetDependencyNotes(notes, new Set())?.keys() ?? [])]).toEqual([
      'on',
      'columns',
    ])
  })
})
