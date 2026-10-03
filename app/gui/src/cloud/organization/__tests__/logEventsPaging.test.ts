/**
 * @file The activity log's paging (#196): it asks for one page after another only while the
 * backend keeps returning full pages, so that a log shorter than the view is fetched a bounded
 * number of times, while a long one still loads every page.
 */
import { QueryClient } from '@tanstack/vue-query'
import type { AuditLogEvent, Backend } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { logEventsQueryOptions, nextLogEventsPageParam } from '../queries'

const PAGE_SIZE = 100
/** More pages than any of these logs has: the most `fetchInfiniteQuery` may ask for. */
const MAX_PAGES = 10

/** A log of `count` events, served a page at a time from the offset `from`. */
function mockBackend(count: number) {
  const events = Array.from({ length: count }, (_, i) => ({ id: i }) as unknown as AuditLogEvent)
  const getLogEvents = vi.fn(({ from, pageSize }: { from: number; pageSize: number }) =>
    Promise.resolve(events.slice(from, from + pageSize)),
  )
  return { type: 'remote', getLogEvents } as unknown as Backend & {
    getLogEvents: typeof getLogEvents
  }
}

async function fetchAllPages(backend: ReturnType<typeof mockBackend>) {
  const options = logEventsQueryOptions(backend, () => ({ pageSize: PAGE_SIZE }))
  const data = await new QueryClient().fetchInfiniteQuery({ ...options, pages: MAX_PAGES })
  return data.pages
}

describe('nextLogEventsPageParam', () => {
  test('asks for the next offset after a full page', () => {
    const page = Array(PAGE_SIZE).fill(null)
    expect(nextLogEventsPageParam(page, [page], PAGE_SIZE)).toBe(PAGE_SIZE)
    expect(nextLogEventsPageParam(page, [page, page], PAGE_SIZE)).toBe(2 * PAGE_SIZE)
  })

  test('stops after a short page', () => {
    const full = Array(PAGE_SIZE).fill(null)
    expect(nextLogEventsPageParam([null], [full, [null]], PAGE_SIZE)).toBeUndefined()
  })

  test('stops after an empty page', () => {
    expect(nextLogEventsPageParam([], [[]], PAGE_SIZE)).toBeUndefined()
  })
})

describe('logEventsQueryOptions', () => {
  test('a log shorter than a page takes one request', async () => {
    const backend = mockBackend(3)
    const pages = await fetchAllPages(backend)
    expect(pages.flat()).toHaveLength(3)
    expect(backend.getLogEvents).toHaveBeenCalledTimes(1)
  })

  test('an empty log takes one request', async () => {
    const backend = mockBackend(0)
    await fetchAllPages(backend)
    expect(backend.getLogEvents).toHaveBeenCalledTimes(1)
  })

  test('a long log is loaded page by page, to its end', async () => {
    const backend = mockBackend(2 * PAGE_SIZE + 50)
    const pages = await fetchAllPages(backend)
    expect(pages.map((page) => page.length)).toEqual([PAGE_SIZE, PAGE_SIZE, 50])
    expect(backend.getLogEvents.mock.calls.map(([params]) => params.from)).toEqual([
      0,
      PAGE_SIZE,
      2 * PAGE_SIZE,
    ])
  })

  test('a log of whole pages ends at the first empty page', async () => {
    const backend = mockBackend(2 * PAGE_SIZE)
    const pages = await fetchAllPages(backend)
    expect(pages.flat()).toHaveLength(2 * PAGE_SIZE)
    expect(backend.getLogEvents).toHaveBeenCalledTimes(3)
  })
})
