import { ProjectSessionId } from 'enso-common/src/services/Backend'
import { expect, test, vi } from 'vitest'
import {
  fetchNewestSessionLines,
  SessionLogWindow,
  type SessionPageReader,
} from '../sessionLogWindow'

const SESSION = ProjectSessionId('s1')

/** A session whose pages hold `sizes[i]` lines each, named `p<page>-<line>`. */
function session(sizes: readonly number[]) {
  const pages = sizes.map((_, index) =>
    index === sizes.length - 1 ? 'active' : `archive:${index}`,
  )
  const content = new Map(
    pages.map((id, page) => [id, Array.from({ length: sizes[page]! }, (_, n) => `p${page}-${n}`)]),
  )
  const reader = {
    listProjectSessionPages: vi.fn(async () => pages),
    getProjectSessionLogs: vi.fn(
      async (_id: unknown, { scrollId }: { scrollId: string | null }) => ({
        scrollId: 'unused',
        hits: content.get(scrollId ?? '') ?? [],
      }),
    ),
  }
  const all = pages.flatMap((id) => content.get(id)!)
  return { reader: reader as unknown as SessionPageReader & typeof reader, all, content }
}

test('latest reads the newest lines, from the newest page backwards', async () => {
  const { reader, all } = session([5, 5, 5])
  const window = new SessionLogWindow(reader, SESSION, 7, 3)
  await window.latest()
  expect(window.lines).toEqual(all.slice(-7))
  expect(window.hasOlder).toBe(true)
  expect(window.hasNewer).toBe(false)
  // The oldest page was never read.
  expect(reader.getProjectSessionLogs.mock.calls.map(([, p]) => p.scrollId)).toEqual([
    'active',
    'archive:1',
  ])
})

test('a short session fits whole', async () => {
  const { reader, all } = session([2, 3])
  const window = new SessionLogWindow(reader, SESSION, 10, 5)
  await window.latest()
  expect(window.lines).toEqual(all)
  expect(window.hasOlder).toBe(false)
  expect(window.hasNewer).toBe(false)
})

test('older moves back a step and keeps the size; newer moves forward again', async () => {
  const { reader, all } = session([5, 5, 5])
  const window = new SessionLogWindow(reader, SESSION, 7, 3)
  await window.latest()
  // all[8..15)
  await window.older()
  expect(window.lines).toEqual(all.slice(5, 12))
  expect(window.hasNewer).toBe(true)
  await window.older()
  expect(window.lines).toEqual(all.slice(2, 9))
  await window.older()
  expect(window.lines).toEqual(all.slice(0, 7))
  expect(window.hasOlder).toBe(false)
  // At the start: nothing more to load.
  await window.older()
  expect(window.lines).toEqual(all.slice(0, 7))
  await window.newer()
  expect(window.lines).toEqual(all.slice(3, 10))
  await window.newer()
  await window.newer()
  expect(window.lines).toEqual(all.slice(8, 15))
  expect(window.hasNewer).toBe(false)
  expect(window.hasOlder).toBe(true)
})

test('every line is reachable by paging back, over empty and long pages alike', async () => {
  const { reader, all } = session([3, 0, 12, 1])
  const window = new SessionLogWindow(reader, SESSION, 4, 2)
  await window.latest()
  const seen = new Set(window.lines)
  while (window.hasOlder) {
    await window.older()
    for (const line of window.lines) seen.add(line)
    expect(window.lines.length).toBeLessThanOrEqual(4)
  }
  expect([...seen].sort()).toEqual([...all].sort())
  expect(window.lines).toEqual(all.slice(0, 4))
})

test('latest again is a reload: it lists the pages afresh', async () => {
  const { reader, content } = session([2])
  const window = new SessionLogWindow(reader, SESSION, 10, 5)
  await window.latest()
  expect(window.lines).toEqual(['p0-0', 'p0-1'])
  content.set('active', ['p0-0', 'p0-1', 'later'])
  await window.latest()
  expect(window.lines).toEqual(['p0-0', 'p0-1', 'later'])
  expect(reader.listProjectSessionPages).toHaveBeenCalledTimes(2)
})

test('a session with no pages is empty', async () => {
  const reader = {
    listProjectSessionPages: async () => [],
    getProjectSessionLogs: vi.fn(),
  } as unknown as SessionPageReader
  const window = new SessionLogWindow(reader, SESSION, 10, 5)
  await window.latest()
  expect(window.lines).toEqual([])
  expect(window.hasOlder).toBe(false)
  expect(window.hasNewer).toBe(false)
})

test('fetchNewestSessionLines reads only as far back as it needs', async () => {
  const { reader, all } = session([4, 4, 4])
  expect(await fetchNewestSessionLines(reader, SESSION, 5)).toEqual(all.slice(-5))
  expect(reader.getProjectSessionLogs).toHaveBeenCalledTimes(2)
})
