// Run with `node --test tools/ci/prune-caches.test.mjs`.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { selectPrunable } from './prune-caches.mjs'

const now = Date.parse('2026-10-29T12:00:00Z')
const hash = (c) => c.repeat(64)
let id = 0
const cache = (key, ref, createdAt, lastAccessedAt = createdAt) => ({
  id: id++,
  key,
  ref,
  sizeInBytes: 1,
  createdAt,
  lastAccessedAt,
})
const run = (caches, openPrs = []) =>
  selectPrunable(caches, { openPrs: new Set(openPrs), now, days: 7 }).map((d) => d.cache.key)

describe('selectPrunable', () => {
  test('keeps recent entries on develop and open PRs', () => {
    const a = cache('Linux-gui-1', 'refs/heads/develop', '2026-10-28T00:00:00Z')
    const b = cache('Linux-gui-2', 'refs/pull/5/merge', '2026-10-28T00:00:00Z')
    assert.deepEqual(run([a, b], [5]), [])
  })
  test('deletes the caches of PRs that are not open', () => {
    const a = cache('x', 'refs/pull/5/merge', '2026-10-28T00:00:00Z')
    assert.deepEqual(run([a], [6]), ['x'])
  })
  test('deletes entries not accessed for more than the limit', () => {
    const a = cache('old', 'refs/heads/develop', '2026-10-01T00:00:00Z')
    const b = cache('used', 'refs/heads/develop', '2026-10-01T00:00:00Z', '2026-10-29T00:00:00Z')
    assert.deepEqual(run([a, b]), ['old'])
  })
  test('keeps only the newest hash of a dependency cache per ref and key', () => {
    const accessed = '2026-10-29T00:00:00Z'
    const develop = 'refs/heads/develop'
    const old = cache(`sbt-deps-engine-Linux-${hash('a')}`, develop, '2026-10-25T00:00:00Z', accessed)
    const fresh = cache(`sbt-deps-engine-Linux-${hash('b')}`, develop, '2026-10-28T00:00:00Z')
    const other = cache(`sbt-deps-engine-Windows-${hash('a')}`, develop, '2026-10-25T00:00:00Z', accessed)
    assert.deepEqual(run([old, fresh, other]), [old.key])
  })
  test('lists an entry once when several rules match', () => {
    const old = cache(`node-cache-Linux-${hash('a')}`, 'refs/pull/5/merge', '2026-10-01T00:00:00Z')
    const fresh = cache(`node-cache-Linux-${hash('b')}`, 'refs/pull/5/merge', '2026-10-28T00:00:00Z')
    assert.deepEqual(run([old, fresh], [5]), [old.key])
  })
})
