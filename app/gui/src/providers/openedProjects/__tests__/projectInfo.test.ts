import { expect, test } from 'vitest'
import { PROJECT_INFO_SCHEMA, RUNNING_PROJECT_INFO_SCHEMA } from '../projectInfo'

const info = {
  id: 'project-/root/P',
  parentId: 'directory-/root',
  title: 'P',
  ensoPath: '/root/P',
}

test('a project runs only locally', () => {
  expect(RUNNING_PROJECT_INFO_SCHEMA.safeParse({ ...info, mode: 'local' }).success).toBe(true)
  for (const mode of ['cloud', 'hybrid']) {
    expect(PROJECT_INFO_SCHEMA.safeParse({ ...info, mode }).success).toBe(false)
  }
})
