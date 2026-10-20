import { ProjectSessionId } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { expect, test, vi } from 'vitest'
import { fetchSessionLines } from '../engineLogHistory'

test('reads every page of a session, oldest first', async () => {
  const pages: Record<string, { scrollId: string; hits: string[] }> = {
    start: { scrollId: 'archive:1', hits: ['a0'] },
    'archive:1': { scrollId: 'active', hits: ['a1'] },
    active: { scrollId: 'done', hits: ['live 1', 'live 2'] },
  }
  const getProjectSessionLogs = vi.fn<LocalBackend['getProjectSessionLogs']>(
    async (_id, { scrollId }) => pages[scrollId ?? 'start']!,
  )
  const lines = await fetchSessionLines({ getProjectSessionLogs }, ProjectSessionId('s1'))
  expect(lines).toEqual(['a0', 'a1', 'live 1', 'live 2'])
  expect(getProjectSessionLogs.mock.calls.map(([, params]) => params.scrollId)).toEqual([
    null,
    'archive:1',
    'active',
  ])
})

test('stops when a page does not move on', async () => {
  const getProjectSessionLogs = vi.fn<LocalBackend['getProjectSessionLogs']>(async () => ({
    scrollId: 'stuck',
    hits: ['x'],
  }))
  const lines = await fetchSessionLines({ getProjectSessionLogs }, ProjectSessionId('s1'))
  expect(lines).toEqual(['x', 'x'])
  expect(getProjectSessionLogs).toHaveBeenCalledTimes(2)
})
