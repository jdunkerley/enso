import { expect, test } from 'vitest'
import { computed } from 'vue'
import type { WidgetQueryAnswer } from '../configuration'
import { StaticAnswerCache, modulesOfSuggestionUpdates } from '../staticAnswerCache'

const answer = (name: string): WidgetQueryAnswer => ({ arguments: [[name, { widget: null }]] })

test('the key names the method and every argument, in order', () => {
  const cache = new StaticAnswerCache()
  expect(cache.key('T.m', ['a', 'b'])).not.toBe(cache.key('T.m', ['a']))
  expect(cache.key('T.m', ['a', 'b'])).not.toBe(cache.key('T.n', ['a', 'b']))
  expect(cache.key('T.m', ['a', 'b'])).toBe(cache.key('T.m', ['a', 'b']))
})

test('keeps answers, and drops the least recently used past its size', () => {
  const cache = new StaticAnswerCache(2)
  const a = answer('a')
  cache.set('a', a, 'M')
  cache.set('b', answer('b'), 'M')
  expect(cache.get('a')).toBe(a) // `a` is now the most recent
  cache.set('c', answer('c'), 'M')
  expect(cache.get('b')).toBeUndefined()
  expect(cache.get('a')).toBe(a)
  expect(cache.get('c')).toBeDefined()
  expect(cache.size).toBe(2)
})

test('clear empties, dropModules drops only those modules', () => {
  const cache = new StaticAnswerCache()
  cache.set('a', answer('a'), 'M1')
  cache.set('b', answer('b'), 'M2')
  cache.dropModules(new Set(['M1']))
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('b')).toBeDefined()
  cache.clear()
  expect(cache.size).toBe(0)
})

test('is reactive: a reader notices an answer stored later', () => {
  const cache = new StaticAnswerCache()
  const seen = computed(() => cache.get('k'))
  expect(seen.value).toBeUndefined()
  const a = answer('a')
  cache.set('k', a, 'M')
  expect(seen.value).toBe(a)
  cache.dropModules(new Set(['M']))
  expect(seen.value).toBeUndefined()
})

test('the modules a suggestion update touches', () => {
  const known = new Map([
    [1, 'local.P.Main'],
    [2, 'Standard.Table.Table'],
  ])
  const modules = modulesOfSuggestionUpdates(
    [
      { type: 'Add', id: 3, suggestion: { module: 'Standard.DuckDB.X' } as never },
      { type: 'Modify', id: 1, module: { tag: 'Set', value: 'local.P.Other' } },
      { type: 'Remove', id: 2 },
      { type: 'Remove', id: 9 },
    ],
    (id) => known.get(id),
  )
  expect([...modules].sort()).toEqual([
    'Standard.DuckDB.X',
    'Standard.Table.Table',
    'local.P.Main',
    'local.P.Other',
  ])
})
