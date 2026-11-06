import { ProjectPath } from '@/util/projectPath'
import { projectPathKey } from '@/util/projectPathKey'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'

test.each<[string | undefined, string | undefined]>([
  ['Standard.Table', 'Table.Table'],
  ['Standard.Table', 'Main'],
  ['Standard.Table', 'Main.Foo'],
  ['Standard.Table', undefined],
  [undefined, 'Main.Foo'],
  [undefined, undefined],
])('projectPathKey(%s, %s) is ProjectPath.key()', (project, path) => {
  const key = ProjectPath.create(
    project as QualifiedName | undefined,
    path as QualifiedName | undefined,
  ).key()
  expect(projectPathKey(project, path)).toBe(key)
})
