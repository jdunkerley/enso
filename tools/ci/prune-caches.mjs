// Prunes the repository's GitHub Actions cache (capped at 10 GB; see issue #314), for
// `.github/workflows/prune-caches.yml`. Run `node tools/ci/prune-caches.mjs --dry-run` locally
// (needs an authenticated `gh`) to list what it would delete.
//
// A cache entry is deleted when it is:
//  - scoped to a pull request that is no longer open (a PR's cache is invisible to every other
//    ref, so it only eats the budget);
//  - not accessed for `--days` days (GitHub evicts at 7 days anyway, but only when it is short of
//    room, so the cap is hit first); or
//  - superseded: a dependency cache (`sbt-deps-*`, `node-cache-*`, `v0-rust-*`) whose key ends in a
//    content hash, when a newer entry with the same key but another hash exists on the same ref.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DAY_MS = 24 * 60 * 60 * 1000
/**
 * The family of a key whose trailing hash changes when the cached inputs do: `<family>-<sha256>`
 * (`sbt-deps-*`, `node-cache-*`), or rust-cache's `v0-rust-<key>-<OS>-<arch>-<8 hex>-<8 hex>`.
 */
function familyOf(key) {
  return (
    /^((?:sbt-deps|node-cache)-.+)-[0-9a-f]{64}$/.exec(key)?.[1] ??
    /^(v0-rust-.+)-[0-9a-f]{8}-[0-9a-f]{8}$/.exec(key)?.[1]
  )
}

/**
 * @param {{ id: number, key: string, ref: string, sizeInBytes: number, createdAt: string, lastAccessedAt: string }[]} caches
 * @param {{ openPrs: Set<number>, now: number, days: number }} options
 * @returns {{ cache: object, reason: string }[]}
 */
export function selectPrunable(caches, { openPrs, now, days }) {
  const result = new Map()
  const mark = (cache, reason) => {
    if (!result.has(cache.id)) result.set(cache.id, { cache, reason })
  }
  const newest = new Map()
  for (const cache of caches) {
    const pr = /^refs\/pull\/(\d+)\//.exec(cache.ref)
    if (pr && !openPrs.has(Number(pr[1]))) {
      mark(cache, `PR #${pr[1]} is not open`)
    } else if (now - Date.parse(cache.lastAccessedAt) > days * DAY_MS) {
      mark(cache, `not accessed for more than ${days} days`)
    }
    const family = familyOf(cache.key)
    if (family != null) {
      const group = `${cache.ref} ${family}`
      const best = newest.get(group)
      if (best == null || Date.parse(cache.createdAt) > Date.parse(best.createdAt)) {
        newest.set(group, cache)
      }
    }
  }
  for (const cache of caches) {
    const family = familyOf(cache.key)
    if (family != null && newest.get(`${cache.ref} ${family}`) !== cache) {
      mark(cache, 'superseded by a newer entry with another hash')
    }
  }
  return [...result.values()]
}

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const daysArg = args.indexOf('--days')
  const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 7
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days needs a positive number')

  const caches = JSON.parse(
    gh(
      'cache',
      'list',
      '--limit',
      '1000',
      '--json',
      'id,key,ref,sizeInBytes,createdAt,lastAccessedAt',
    ),
  )
  const openPrs = new Set(
    JSON.parse(gh('pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number')).map(
      (pr) => pr.number,
    ),
  )
  const doomed = selectPrunable(caches, { openPrs, now: Date.now(), days })
  const total = caches.reduce((sum, c) => sum + c.sizeInBytes, 0)
  const freed = doomed.reduce((sum, d) => sum + d.cache.sizeInBytes, 0)
  const mb = (bytes) => `${(bytes / 1e6).toFixed(0)} MB`
  const verb = dryRun ? 'would delete' : 'delete'
  for (const { cache, reason } of doomed) {
    console.log(`${verb} ${cache.key} (${cache.ref}, ${mb(cache.sizeInBytes)}): ${reason}`)
    if (!dryRun) gh('cache', 'delete', String(cache.id))
  }
  console.log(`${caches.length} caches, ${mb(total)}; ${verb} ${doomed.length}, ${mb(freed)}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
