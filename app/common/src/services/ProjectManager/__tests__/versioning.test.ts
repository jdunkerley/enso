import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { Path } from '../types'

describe('ProjectManager versioning methods', () => {
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
  const project = Path('/root/P')

  it('versioningStatus', async () => {
    const status = {
      git: true,
      repoRoot: '/root',
      changed: false,
      lastVersion: { id: 'a'.repeat(40), date: '2026-10-16T00:00:00Z' },
      blocked: null,
      enabled: true,
      optedOut: false,
    }
    nextResult = status
    expect(await manager().versioningStatus(project)).toEqual(status)
    expect(calls).toEqual([
      { url: '/api/project-service/versioning/status', body: { path: project } },
    ])
  })

  it('initVersioning', async () => {
    nextResult = { repoRoot: '/root' }
    expect(await manager().initVersioning(Path('/root'))).toEqual({ repoRoot: '/root' })
    expect(calls).toEqual([
      { url: '/api/project-service/versioning/init', body: { rootPath: '/root' } },
    ])
  })

  it('enableVersioning and disableVersioning', async () => {
    await manager().enableVersioning(Path('/root'))
    await manager().disableVersioning(Path('/root'))
    expect(calls).toEqual([
      { url: '/api/project-service/versioning/enable', body: { repoRoot: '/root' } },
      { url: '/api/project-service/versioning/disable', body: { repoRoot: '/root' } },
    ])
  })

  it('commitVersion', async () => {
    nextResult = { id: 'abc' }
    expect(await manager().commitVersion(project, 'msg')).toEqual({ id: 'abc' })
    expect(calls).toEqual([
      {
        url: '/api/project-service/versioning/commit',
        body: { path: project, message: 'msg' },
      },
    ])
  })

  it('listVersions', async () => {
    nextResult = { versions: [] }
    expect(await manager().listVersions(project)).toEqual({ versions: [] })
    expect(calls).toEqual([{ url: '/api/project-service/versioning/log', body: { path: project } }])
  })

  it('versionFileContent', async () => {
    nextResult = 'main = 1\n'
    expect(await manager().versionFileContent(project, 'abc', 'src/Main.enso')).toBe('main = 1\n')
    expect(calls).toEqual([
      {
        url: '/api/project-service/versioning/file-at',
        body: { path: project, id: 'abc', relativePath: 'src/Main.enso' },
      },
    ])
  })

  it('restoreVersion', async () => {
    nextResult = { id: 'def' }
    expect(await manager().restoreVersion(project, 'abc')).toEqual({ id: 'def' })
    expect(calls).toEqual([
      { url: '/api/project-service/versioning/restore', body: { path: project, id: 'abc' } },
    ])
  })

  it('duplicateVersion', async () => {
    nextResult = {
      projectId: 'id-2',
      projectName: 'P (copy)',
      projectNormalizedName: 'P_copy',
      projectPath: '/root/P_copy',
    }
    expect(await manager().duplicateVersion(project, 'abc', 'P (copy)', Path('/root'))).toEqual(
      nextResult,
    )
    expect(calls).toEqual([
      {
        url: '/api/project-service/versioning/duplicate-at',
        body: { path: project, id: 'abc', title: 'P (copy)', parentPath: '/root' },
      },
    ])
  })

  it('setVersionComment', async () => {
    await manager().setVersionComment(project, 'abc', 'hello')
    expect(calls).toEqual([
      {
        url: '/api/project-service/versioning/set-comment',
        body: { path: project, id: 'abc', comment: 'hello' },
      },
    ])
  })

  it('enableVersioningIfInside', async () => {
    nextResult = { enabled: true }
    expect(await manager().enableVersioningIfInside(Path('/root'), Path('/root'))).toEqual({
      enabled: true,
    })
    expect(calls).toEqual([
      {
        url: '/api/project-service/versioning/enable-if-inside',
        body: { repoRoot: '/root', rootPath: '/root' },
      },
    ])
  })

  it('a JSON-RPC error rejects with its message', async () => {
    nextError = 'versioning/restore failed: nope'
    await expect(manager().restoreVersion(project, 'abc')).rejects.toThrow('nope')
  })
})
