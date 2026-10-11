import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLORS, LabelName, TagId } from '../../Backend'
import { ProjectManager } from '../ProjectManager'
import { Path, UTCDateTime, UUID } from '../types'

const LABEL = {
  id: TagId('11111111-1111-1111-1111-111111111111'),
  value: LabelName('a'),
  color: COLORS[0],
}

describe('ProjectManager local metadata methods', () => {
  let calls: { url: string; body: unknown }[]
  let nextResult: unknown
  let nextError: string | null

  beforeEach(() => {
    calls = []
    nextResult = null
    nextError = null
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
      const json =
        nextError != null ?
          { jsonrpc: '2.0', id: 0, error: { code: 0, message: nextError } }
        : { jsonrpc: '2.0', id: 0, result: nextResult }
      return new Response(JSON.stringify(json))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const manager = () => new ProjectManager(Path('/root'))

  it('listLabels', async () => {
    nextResult = [LABEL]
    expect(await manager().listLabels()).toEqual([LABEL])
    expect(calls).toEqual([{ url: '/api/project-service/labels/list', body: {} }])
  })

  it('createLabel', async () => {
    nextResult = LABEL
    expect(await manager().createLabel({ value: LabelName('a'), color: COLORS[0] })).toEqual(LABEL)
    expect(calls).toEqual([
      { url: '/api/project-service/labels/create', body: { value: 'a', color: COLORS[0] } },
    ])
  })

  it('deleteLabel', async () => {
    await manager().deleteLabel({ id: LABEL.id })
    expect(calls).toEqual([{ url: '/api/project-service/labels/delete', body: { id: LABEL.id } }])
  })

  it('setProjectLabels', async () => {
    await manager().setProjectLabels({
      projectPath: Path('/root/P'),
      labels: [LabelName('a'), LabelName('b')],
    })
    expect(calls).toEqual([
      {
        url: '/api/project-service/project/set-labels',
        body: { path: '/root/P', labels: ['a', 'b'] },
      },
    ])
  })

  it('listRecentProjects normalises slashes', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    nextResult = [{ path: 'C:\\root\\P', projectId: 'id-1', openedAt: '2026-10-11T00:00:00.000Z' }]
    expect(await manager().listRecentProjects()).toEqual([
      {
        path: Path('C:/root/P'),
        projectId: UUID('id-1'),
        openedAt: UTCDateTime('2026-10-11T00:00:00.000Z'),
      },
    ])
    expect(calls).toEqual([{ url: '/api/project-service/recent/list', body: {} }])
  })

  it('recordRecentProject', async () => {
    await manager().recordRecentProject(Path('/root/P'))
    expect(calls).toEqual([
      { url: '/api/project-service/recent/record', body: { path: '/root/P' } },
    ])
  })

  it('forgetRecentProject', async () => {
    await manager().forgetRecentProject(Path('/root/P'))
    expect(calls).toEqual([
      { url: '/api/project-service/recent/forget', body: { path: '/root/P' } },
    ])
  })

  it('a JSON-RPC error rejects with its message', async () => {
    nextError = "labels/create failed: A label named 'a' already exists."
    await expect(
      manager().createLabel({ value: LabelName('a'), color: COLORS[0] }),
    ).rejects.toThrow("A label named 'a' already exists.")
  })
})
