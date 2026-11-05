import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { parse } from 'yaml'
import { readGroups } from './groups'

test('groups of a fixture library: declared colour or none', () => {
  const yaml =
    'name: Fixture\nnamespace: Standard\ncomponent-groups:\n  new:\n    - Selections: { color: oklch(0.464 0.14 325) }\n    - Shaping\n'
  expect(readGroups(yaml)).toEqual({
    library: 'Standard.Fixture',
    groups: [
      { project: 'Standard.Fixture', name: 'Selections', color: 'oklch(0.464 0.14 325)' },
      { project: 'Standard.Fixture', name: 'Shaping' },
    ],
  })
})

test('a library without component groups has none; `extends` adds no group', () => {
  expect(readGroups('name: X\nnamespace: Standard\n').groups).toEqual([])
  expect(
    readGroups(
      'name: X\nnamespace: Standard\ncomponent-groups:\n  extends:\n    - Standard.Base.Input:\n        exports: [a]\n',
    ).groups,
  ).toEqual([])
})

test("parity: Standard.Base's groups and colours are package.yaml's", () => {
  const file = fileURLToPath(
    new URL('../../../distribution/lib/Standard/Base/0.0.0-dev/package.yaml', import.meta.url),
  )
  const text = readFileSync(file, 'utf8')
  const declared = (
    parse(text)['component-groups'].new as Record<string, { color?: string }>[]
  ).map((group) => Object.entries(group)[0]!)
  const { library, groups } = readGroups(text)
  expect(library).toBe('Standard.Base')
  expect(groups.map((group) => [group.name, group.color])).toEqual(
    declared.map(([name, value]) => [name, value.color]),
  )
})
