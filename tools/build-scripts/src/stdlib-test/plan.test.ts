/** @file Tests for the standard-library test plan: selection from changed files, and sharding. */
/* eslint-disable camelcase -- Test project names are `Name_Tests`, as the directories under `test/`. */
import { describe, expect, test } from 'vitest'
import {
  planMatrix,
  planSummary,
  selectTestProjects,
  type StdlibTestMap,
  type SuiteEntry,
} from './plan.ts'

const MAP: StdlibTestMap = {
  everything: { libraries: ['Base', 'Test'], stdBits: ['tests'] },
  libraries: {
    Base: { stdBits: ['base'], dependsOn: [] },
    Table: { stdBits: ['table'], dependsOn: ['Base'] },
    Database: { stdBits: ['database'], dependsOn: ['Base', 'Table'] },
    Geo: { stdBits: [], dependsOn: ['Base', 'Table'] },
    Tableau: { stdBits: ['tableau'], dependsOn: ['Base', 'Table'] },
    Test: { stdBits: [], dependsOn: ['Base'] },
  },
  testProjects: {
    AWS_Tests: { imports: ['Base'], testImports: [] },
    Base_Tests: { imports: ['Base', 'Test'], testImports: [] },
    DuckDB_Tests: { imports: ['Database'], testImports: ['Table_Tests'] },
    Geo_Tests: { imports: ['Geo', 'Table'], testImports: [] },
    Table_Tests: {
      imports: ['Database', 'Table'],
      testImports: ['Base_Tests'],
    },
    Tableau_Tests: { imports: ['Tableau'], testImports: ['Table_Tests'] },
    Visualization_Tests: { imports: ['Geo'], testImports: [] },
  },
  shards: [
    { name: 'Table', projects: ['Table_Tests'] },
    { name: 'Base', projects: ['Base_Tests', 'DuckDB_Tests'] },
    { name: 'Others', projects: '*' },
  ],
}

const sorted = (files: readonly string[]) => {
  const { projects } = selectTestProjects(MAP, files)
  return projects == null ? null : [...projects].sort()
}

describe('selectTestProjects', () => {
  test('runs everything outside a pull request', () => {
    expect(selectTestProjects(MAP, null).projects).toBeNull()
  })
  test('a library with no dependents runs its own test project', () => {
    expect(sorted(['distribution/lib/Standard/Tableau/0.0.0-dev/src/Hyper_File.enso'])).toEqual([
      'Tableau_Tests',
    ])
  })
  test('a std-bits directory counts as its library', () => {
    expect(sorted(['std-bits/tableau/src/main/java/X.java'])).toEqual(['Tableau_Tests'])
  })
  test('runs every project that imports the library', () => {
    expect(sorted(['distribution/lib/Standard/Geo/0.0.0-dev/src/Geo.enso'])).toEqual([
      'Geo_Tests',
      'Visualization_Tests',
    ])
  })
  test('runs the projects of the libraries that depend on it, transitively', () => {
    expect(sorted(['distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso'])).toEqual([
      'DuckDB_Tests',
      'Geo_Tests',
      'Table_Tests',
      'Tableau_Tests',
      'Visualization_Tests',
    ])
  })
  test('a test project runs, with the projects that import it', () => {
    expect(sorted(['test/Table_Tests/src/Main.enso'])).toEqual([
      'DuckDB_Tests',
      'Table_Tests',
      'Tableau_Tests',
    ])
  })
  test.each([
    'distribution/lib/Standard/Base/0.0.0-dev/src/Main.enso',
    'distribution/lib/Standard/Test/0.0.0-dev/src/Main.enso',
    'distribution/lib/Standard/New/0.0.0-dev/src/Main.enso',
    'std-bits/base/src/X.java',
    'std-bits/tests/src/X.java',
    'std-bits/unknown/src/X.java',
    'test/Helpers/src/Main.enso',
    'test/Unknown_Tests/src/Main.enso',
    'engine/runtime/src/main/java/X.java',
    '.github/workflows/engine-checks-platform.yml',
    'tools/build-scripts/src/stdlib-test/run.ts',
  ])('%s runs everything', (file) => {
    expect(
      sorted(['distribution/lib/Standard/Tableau/0.0.0-dev/src/Hyper_File.enso', file]),
    ).toBeNull()
  })
  test('says why', () => {
    expect(selectTestProjects(MAP, ['engine/x.java']).reasons).toEqual([
      'engine/x.java: outside any one library or test project; every project runs.',
    ])
  })
})

const PROJECTS = [
  'AWS_Tests',
  'Base_Tests',
  'DuckDB_Tests',
  'Geo_Tests',
  'Microsoft_Tests',
  'Table_Tests',
  'Tableau_Tests',
  'Visualization_Tests',
]
const JVM: SuiteEntry = {
  suite: 'standard-library',
  title: 'JVM',
  'small-jdk': true,
  postgres: true,
  mssql: false,
}
const AWS: SuiteEntry = { suite: 'std-aws', title: 'AWS', 'small-jdk': false }

describe('planMatrix', () => {
  test('shards a deny-list suite and keeps an allow-list suite whole', () => {
    expect(planMatrix([JVM, AWS], MAP, PROJECTS, { projects: null, reasons: [] }, true)).toEqual([
      { ...JVM, title: 'JVM (Table)', only: 'Table_Tests' },
      { ...JVM, title: 'JVM (Base)', only: 'Base_Tests,DuckDB_Tests' },
      {
        ...JVM,
        title: 'JVM (Others)',
        only: 'Geo_Tests,Tableau_Tests,Visualization_Tests',
      },
      { ...AWS, only: 'AWS_Tests' },
    ])
  })
  test('drops the jobs with no selected project', () => {
    const selection = { projects: new Set(['Tableau_Tests']), reasons: [] }
    expect(planMatrix([JVM, AWS], MAP, PROJECTS, selection, true)).toEqual([
      { ...JVM, title: 'JVM (Others)', only: 'Tableau_Tests' },
    ])
  })
  test('keeps one job per suite when sharding is off', () => {
    expect(planMatrix([JVM, AWS], MAP, PROJECTS, { projects: null, reasons: [] }, false)).toEqual([
      {
        ...JVM,
        only: 'Base_Tests,DuckDB_Tests,Geo_Tests,Table_Tests,Tableau_Tests,Visualization_Tests',
      },
      { ...AWS, only: 'AWS_Tests' },
    ])
  })
})

describe('planSummary', () => {
  test('lists the reasons and the jobs', () => {
    const selection = {
      projects: new Set(['Tableau_Tests']),
      reasons: ['a.enso: Standard.Tableau'],
    }
    const matrix = planMatrix([JVM], MAP, PROJECTS, selection, true)
    expect(planSummary(selection, matrix)).toEqual([
      '### Standard library tests',
      '',
      '- a.enso: Standard.Tableau',
      '',
      '| Job | Projects |',
      '| --- | --- |',
      '| JVM (Others) | Tableau_Tests |',
    ])
  })
  test('says when no job runs', () => {
    const selection = {
      projects: new Set<string>(),
      reasons: ['x: Standard.Google'],
    }
    expect(planSummary(selection, [])).toEqual([
      '### Standard library tests',
      '',
      '- x: Standard.Google',
      '',
      'No test project is affected: the standard library test jobs are skipped.',
    ])
  })
})
