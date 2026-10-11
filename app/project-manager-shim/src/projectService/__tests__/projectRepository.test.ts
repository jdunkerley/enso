import { Rfc3339DateTime } from 'enso-common/src/utilities/data/dateTime'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createProject, readProjectJson } from '../../localMetadata/__tests__/testUtils.js'
import { updateJsonFile } from '../../localMetadata/jsonFile.js'
import { ProjectFileRepository } from '../projectRepository.js'
import { Path, UUID } from '../types.js'

let root: string
let repo: ProjectFileRepository

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-repository-test-'))
  repo = new ProjectFileRepository(Path(root))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('project.json fields the repository does not know about', () => {
  test('update keeps labels and unknown fields', async () => {
    const dir = await createProject(path.join(root, 'P'), 'id-1', {
      labels: ['a', 'b'],
      extra: 1,
    })
    const project = await repo.tryLoadProject(Path(dir))
    expect(project).not.toBeNull()
    await repo.update({ ...project!, lastOpened: Rfc3339DateTime('2026-10-11T00:00:00.000Z') })
    expect(await readProjectJson(dir)).toEqual({
      id: 'id-1',
      kind: 'UserProject',
      created: '2026-01-01T00:00:00.000Z',
      lastOpened: '2026-10-11T00:00:00.000Z',
      labels: ['a', 'b'],
      extra: 1,
    })
  })

  test('concurrent updates do not lose labels written in between', async () => {
    const dir = await createProject(path.join(root, 'P'), 'id-1')
    const project = (await repo.tryLoadProject(Path(dir)))!
    const projectJsonPath = path.join(dir, '.enso', 'project.json')
    await Promise.all([
      repo.update({ ...project, lastOpened: Rfc3339DateTime('2026-10-11T00:00:00.000Z') }),
      updateJsonFile(projectJsonPath, (current) => ({
        ...(current as object),
        labels: ['x'],
      })),
    ])
    expect(await readProjectJson(dir)).toMatchObject({
      labels: ['x'],
      lastOpened: '2026-10-11T00:00:00.000Z',
    })
  })

  test('copyProject keeps labels on the copy, with the new id', async () => {
    const dir = await createProject(path.join(root, 'Source'), 'id-1', { labels: ['a'] })
    const project = (await repo.tryLoadProject(Path(dir)))!
    const copy = await repo.copyProject(project, 'Copy', {
      id: UUID('id-2'),
      name: 'Copy',
      namespace: 'local',
      created: Rfc3339DateTime('2026-10-11T00:00:00.000Z'),
    })
    expect(await readProjectJson(copy.path)).toEqual({
      id: 'id-2',
      kind: 'UserProject',
      created: '2026-10-11T00:00:00.000Z',
      lastOpened: null,
      labels: ['a'],
    })
  })
})
