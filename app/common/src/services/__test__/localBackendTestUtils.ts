/** @file A `LocalBackend` over a real `ProjectManager` whose methods the tests spy on. */
import { vi } from 'vitest'
import { defaultGetText } from '../../text'
import { HttpClient } from '../HttpClient'
import { LocalBackend } from '../LocalBackend'
import { ProjectManager } from '../ProjectManager/ProjectManager'
import { Path } from '../ProjectManager/types'

/**
 * A `LocalBackend` rooted at `/root`. Stub the `ProjectManager` methods a test needs with
 * `vi.spyOn(projectManager, …)`. Call `vi.unstubAllGlobals()` and `vi.restoreAllMocks()` after
 * each test.
 */
export function makeLocalBackend() {
  vi.stubGlobal('location', { href: 'http://localhost/' })
  const projectManager = new ProjectManager(Path('/root'))
  const localBackend = new LocalBackend(
    defaultGetText,
    projectManager,
    new HttpClient(),
    () => {},
    () => null,
    undefined,
  )
  return { projectManager, localBackend }
}
