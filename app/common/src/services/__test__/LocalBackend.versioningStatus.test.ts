/** @file `LocalBackend.versioningStatus` reads the shim's status of a path. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Path, type VersioningStatus } from '../ProjectManager/types'
import { makeLocalBackend } from './localBackendTestUtils'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LocalBackend.versioningStatus', () => {
  it('reads the status of the path', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const status: VersioningStatus = {
      git: true,
      repoRoot: Path('/root'),
      changed: true,
      lastVersion: null,
      blocked: null,
      enabled: true,
      optedOut: false,
    }
    const spy = vi.spyOn(projectManager, 'versioningStatus').mockResolvedValue(status)
    expect(await localBackend.versioningStatus(Path('/root/P'))).toEqual(status)
    expect(spy).toHaveBeenCalledWith('/root/P')
  })
})
