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

/**
 * Page `window` all the way in one direction, recording each line by its number (`firstLine` +
 * index): every number must keep its line, and the lines must come out as the session, in order and
 * without duplicates or gaps.
 */
async function pageThrough(window: SessionLogWindow, direction: 'older' | 'newer') {
  const byNumber = new Map<number, string>()
  const record = () =>
    window.lines.forEach((line, index) => {
      const number = window.firstLine + index
      const seen = byNumber.get(number)
      if (seen != null) expect(seen).toBe(line)
      byNumber.set(number, line)
    })
  record()
  while (direction === 'older' ? window.hasOlder : window.hasNewer) {
    await window[direction]()
    expect(window.lines.length).toBeLessThanOrEqual(window.size)
    record()
  }
  return [...byNumber.entries()].sort(([a], [b]) => a - b).map(([, line]) => line)
}

test('every line is reachable by paging back, once and in order, over empty and long pages', async () => {
  const { reader, all } = session([3, 0, 12, 0, 1])
  const window = new SessionLogWindow(reader, SESSION, 4, 2)
  await window.latest()
  expect(await pageThrough(window, 'older')).toEqual(all)
  expect(window.lines).toEqual(all.slice(0, 4))
})

test('every line is reachable paging forward again, over empty pages', async () => {
  const { reader, all } = session([2, 0, 0, 5, 0, 3])
  const window = new SessionLogWindow(reader, SESSION, 3, 2)
  await window.latest()
  while (window.hasOlder) await window.older()
  expect(window.lines).toEqual(all.slice(0, 3))
  expect(await pageThrough(window, 'newer')).toEqual(all)
  expect(window.lines).toEqual(all.slice(-3))
  expect(window.hasNewer).toBe(false)
})

test('a failed reload leaves the window as it was', async () => {
  const { reader, all } = session([5, 5])
  const window = new SessionLogWindow(reader, SESSION, 4, 2)
  await window.latest()
  await window.older()
  const before = { lines: window.lines, firstLine: window.firstLine }
  reader.getProjectSessionLogs.mockRejectedValueOnce(new Error('unreadable'))
  await expect(window.latest()).rejects.toThrow('unreadable')
  expect({ lines: window.lines, firstLine: window.firstLine }).toEqual(before)
  // And it still pages from where it was.
  await window.newer()
  expect(window.lines).toEqual(all.slice(-4))
})

test("a window that starts inside an entry knows the entry's start", async () => {
  const entry = '[ERROR] [2026-10-19T09:00:00.000Z] [Standard.Base.Data.Vector] boom'
  const pages = ['active']
  const lines = ['[INFO] [2026-10-19T09:00:00.000Z] [a.b] before', entry, '  at one', '  at two']
  const reader = {
    listProjectSessionPages: vi.fn(async () => pages),
    getProjectSessionLogs: vi.fn(async () => ({ scrollId: 'unused', hits: lines })),
  } as unknown as SessionPageReader
  const window = new SessionLogWindow(reader, SESSION, 2, 1)
  await window.latest()
  expect(window.lines).toEqual(['  at one', '  at two'])
  expect(window.leadingEntry).toBe(entry)
  await window.older()
  expect(window.lines).toEqual([entry, '  at one'])
  expect(window.leadingEntry).toBeNull()
  await window.newer()
  expect(window.lines).toEqual(['  at one', '  at two'])
  expect(window.leadingEntry).toBe(entry)
})

test('a session with no files says so', async () => {
  const reader = {
    listProjectSessionPages: vi.fn(async () => []),
    getProjectSessionLogs: vi.fn(),
  } as unknown as SessionPageReader
  const window = new SessionLogWindow(reader, SESSION, 4, 2)
  expect(window.noFiles).toBe(false)
  await window.latest()
  expect(window.noFiles).toBe(true)
  expect(window.lines).toEqual([])
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

test('fetchNewestSessionLines reads only as far back as it needs, and says what is left', async () => {
  const { reader, all } = session([4, 4, 4])
  expect(await fetchNewestSessionLines(reader, SESSION, 5)).toEqual({
    lines: all.slice(-5),
    hasOlder: true,
  })
  expect(reader.getProjectSessionLogs).toHaveBeenCalledTimes(2)
  expect(await fetchNewestSessionLines(reader, SESSION, 12)).toEqual({
    lines: all,
    hasOlder: false,
  })
})
