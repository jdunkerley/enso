/** @file Suite selection, against today's test projects. */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import {
  discoverProjects,
  parseOnly,
  selectProjects,
  skipsForMissingAwsCredentials,
  suiteNamed,
  SUITES,
  unselectedNames,
} from './suites.ts'

/** The projects on 2026-10-22; `Google_Test` and `Benchmarks` are not `*_Tests`. */
const PROJECTS = [
  'AWS_Tests',
  'Base_Internal_Tests',
  'Base_Tests',
  'Cloud_Tests',
  'DuckDB_Tests',
  'Examples_Tests',
  'Generic_JDBC_Tests',
  'Geo_Tests',
  'Image_Tests',
  'Microsoft_Tests',
  'Saas_Tests',
  'Snowflake_Tests',
  'Table_Internal_Tests',
  'Table_Tests',
  'Tableau_Tests',
  'Test_Tests',
  'Visualization_Tests',
]

test('discovery finds every *_Tests project with a package.yaml', () => {
  const found = discoverProjects(path.join(REPO_ROOT, 'test'))
  expect(found).toContain('Examples_Tests')
  expect(found).not.toContain('Google_Test')
  expect(found).not.toContain('Benchmarks')
  expect(found).toEqual([...found].sort())
})

describe('selection, as ./run selected', () => {
  test('both standard-library suites run 15 projects: all but Microsoft and AWS', () => {
    for (const name of ['standard-library', 'standard-library-in-native']) {
      const selected = selectProjects(PROJECTS, suiteNamed(name).suite)
      expect(selected).toHaveLength(15)
      expect(selected).not.toContain('Microsoft_Tests')
      expect(selected).not.toContain('AWS_Tests')
    }
  })
  test('the dedicated suites run one project each', () => {
    expect(selectProjects(PROJECTS, suiteNamed('std-aws').suite)).toEqual(['AWS_Tests'])
    expect(selectProjects(PROJECTS, suiteNamed('std-microsoft').suite)).toEqual(['Microsoft_Tests'])
    expect(selectProjects(PROJECTS, suiteNamed('std-snowflake-jvm').suite)).toEqual([
      'Snowflake_Tests',
    ])
  })
  test('std-cloud-related, and --only', () => {
    expect(selectProjects(PROJECTS, suiteNamed('std-cloud-related').suite)).toEqual([
      'AWS_Tests',
      'Base_Internal_Tests',
      'Base_Tests',
      'Image_Tests',
      'Microsoft_Tests',
      'Table_Tests',
    ])
    expect(
      selectProjects(PROJECTS, suiteNamed('stdlib').suite, ['Examples_Tests', 'AWS_Tests']),
    ).toEqual(['Examples_Tests'])
  })
  test('--only names are trimmed, and those the suite does not run are reported', () => {
    expect(parseOnly('Base_Tests, Table_Tests ,Image_Tests')).toEqual([
      'Base_Tests',
      'Table_Tests',
      'Image_Tests',
    ])
    expect(parseOnly('Base_Tests,')).toEqual(['Base_Tests', ''])
    const stdlib = suiteNamed('stdlib').suite
    expect(unselectedNames(PROJECTS, stdlib, parseOnly('Base_Tests, Table_Tests'))).toEqual([])
    expect(
      unselectedNames(PROJECTS, stdlib, ['Base_Tests', 'Base_Test', 'AWS_Tests', '', 'Nope']),
    ).toEqual(['Base_Test', 'AWS_Tests', '', 'Nope'])
  })
  test('aliases, and an unknown suite', () => {
    expect(suiteNamed('stdlib-native').name).toBe('standard-library-in-native')
    expect(() => suiteNamed('std-everything')).toThrow('Unknown suite std-everything')
    expect(Object.keys(SUITES)).toHaveLength(8)
  })
})

describe('the AWS suite without credentials (enso.rs test)', () => {
  const aws = suiteNamed('std-aws').suite
  test('is skipped without both keys', () => {
    expect(skipsForMissingAwsCredentials(aws, {})).toBe(true)
    expect(skipsForMissingAwsCredentials(aws, { ENSO_LIB_S3_AWS_ACCESS_KEY_ID: 'a' })).toBe(true)
    expect(
      skipsForMissingAwsCredentials(aws, {
        ENSO_LIB_S3_AWS_ACCESS_KEY_ID: 'a',
        ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: '',
      }),
    ).toBe(true)
  })
  test('runs with both keys', () => {
    const env = { ENSO_LIB_S3_AWS_ACCESS_KEY_ID: 'a', ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: 'b' }
    expect(skipsForMissingAwsCredentials(aws, env)).toBe(false)
  })
  test('only the dedicated suite is skipped', () => {
    expect(skipsForMissingAwsCredentials(suiteNamed('std-cloud-related').suite, {})).toBe(false)
    expect(skipsForMissingAwsCredentials(suiteNamed('standard-library').suite, {})).toBe(false)
  })
})
