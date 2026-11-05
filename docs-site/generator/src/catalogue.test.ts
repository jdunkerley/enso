import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { FIXTURES_LIB, findLibraryDirs, readCatalogue, readLibraries } from './catalogue'

test('finds every library directory under a lib root', () => {
  expect(
    findLibraryDirs(FIXTURES_LIB).map((dir) =>
      dir.replaceAll('\\', '/').split('/').slice(-3).join('/'),
    ),
  ).toEqual(['Standard/Fixture/0.0.0-dev', 'Standard/Fixture_Ext/0.0.0-dev'])
})

test('reads the fixture libraries with their groups and catalogues', () => {
  const libraries = readLibraries([FIXTURES_LIB])
  expect(libraries.map((library) => library.name)).toEqual([
    'Standard.Fixture',
    'Standard.Fixture_Ext',
  ])
  expect(libraries[0]!.groups.map((group) => group.name)).toEqual(['Selections', 'Shaping'])
  expect(libraries[0]!.catalogue?.entries.length).toBe(14)
})

test('a library without a catalogue is kept for its groups, with no catalogue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-site-'))
  writeFileSync(join(dir, 'package.yaml'), 'name: Nocat\nnamespace: Standard\n')
  expect(readLibraries([dir])).toEqual([
    { name: 'Standard.Nocat', dir, groups: [], catalogue: undefined },
  ])
})

test('a catalogue of another format fails, naming the library', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-site-'))
  const file = join(dir, 'catalogue.json')
  writeFileSync(file, JSON.stringify({ format: 2, library: 'Standard.Future', entries: [] }))
  expect(() => readCatalogue(file)).toThrow(/Standard\.Future.*format 2/)
})
