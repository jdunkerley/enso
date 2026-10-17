/** @file `LocalBackend`'s versioning writes call `ProjectManager` with project paths. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newProjectId } from '../LocalBackend'
import { Path } from '../ProjectManager/types'
import { makeLocalBackend } from './localBackendTestUtils'

const PROJECT = Path('/root/P')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LocalBackend versioning writes', () => {
  it('commits the project at the id’s path, with the message as given', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const spy = vi.spyOn(projectManager, 'commitVersion').mockResolvedValue({ id: 'a'.repeat(40) })
    expect(await localBackend.commitVersion(newProjectId(PROJECT), '')).toEqual({
      id: 'a'.repeat(40),
    })
    expect(spy).toHaveBeenCalledWith(PROJECT, '')
  })

  it('initialises, enables, disables, and enables a repository inside the root', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const init = vi
      .spyOn(projectManager, 'initVersioning')
      .mockResolvedValue({ repoRoot: Path('/root') })
    const enable = vi.spyOn(projectManager, 'enableVersioning').mockResolvedValue()
    const disable = vi.spyOn(projectManager, 'disableVersioning').mockResolvedValue()
    const inside = vi
      .spyOn(projectManager, 'enableVersioningIfInside')
      .mockResolvedValue({ enabled: false })
    expect(await localBackend.initVersioning(Path('/root'))).toEqual({
      repoRoot: '/root',
    })
    await localBackend.enableVersioning(Path('/root'))
    await localBackend.disableVersioning(Path('/root'))
    expect(await localBackend.enableVersioningIfInside(Path('/'), Path('/root'))).toEqual({
      enabled: false,
    })
    expect(init).toHaveBeenCalledWith('/root')
    expect(enable).toHaveBeenCalledWith('/root')
    expect(disable).toHaveBeenCalledWith('/root')
    expect(inside).toHaveBeenCalledWith('/', '/root')
  })

  it('returns the close commit’s warning; closeProject still resolves to nothing', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'closeProject').mockResolvedValue({
      versioningWarning: 'locked',
    })
    expect(await localBackend.closeProjectReportingVersioning(newProjectId(PROJECT), 'P')).toEqual({
      versioningWarning: 'locked',
    })
    expect(await localBackend.closeProject(newProjectId(PROJECT), 'P')).toBeUndefined()
  })

  it('wraps a failed close as closeProject did', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'closeProject').mockRejectedValue(new Error('gone'))
    await expect(
      localBackend.closeProjectReportingVersioning(newProjectId(PROJECT), 'P'),
    ).rejects.toThrow("Could not close project 'P': gone.")
  })
})
