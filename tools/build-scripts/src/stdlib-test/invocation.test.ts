/** @file The command lines and environment, against the ones `./run` logged in CI (run 39666057183). */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  irCacheDirectory,
  missingServiceWarnings,
  projectArguments,
  runnerArguments,
  testEnvironment,
} from './invocation.ts'
import { suiteNamed } from './suites.ts'

const jdk = '/home/runner/work/enso/enso/target/small-jdk'
const project = (name: string) => `/home/runner/work/enso/enso/test/${name}`

describe('the command line', () => {
  test('Linux JVM, as logged', () => {
    const runner = runnerArguments(suiteNamed('standard-library').suite, 'linux', jdk, 'GraalVM CE')
    expect(projectArguments(runner, project('Base_Internal_Tests'))).toEqual([
      '-XX:+HeapDumpOnOutOfMemoryError',
      '--jvm',
      jdk,
      '--no-ir-caches',
      '--run',
      project('Base_Internal_Tests'),
      '--disable-private-check',
    ])
  })
  test('Windows JVM: no heap-dump argument', () => {
    const windowsJdk = 'D:\\a\\enso\\enso\\target\\small-jdk'
    const runner = runnerArguments(
      suiteNamed('standard-library').suite,
      'win32',
      windowsJdk,
      'GraalVM CE',
    )
    expect(runner).toEqual(['--jvm', windowsJdk])
  })
  test('native: the heap-dump argument on Linux, nothing on Windows', () => {
    const native = suiteNamed('standard-library-in-native').suite
    expect(
      projectArguments(runnerArguments(native, 'linux', jdk, 'GraalVM CE'), project('Base_Tests')),
    ).toEqual(['-XX:+HeapDumpOnOutOfMemoryError', '--no-ir-caches', '--run', project('Base_Tests')])
    expect(runnerArguments(native, 'win32', jdk, 'GraalVM CE')).toEqual([])
  })
  test('Oracle GraalVM runs the JVM suite without the small JDK', () => {
    const runner = runnerArguments(
      suiteNamed('standard-library').suite,
      'linux',
      jdk,
      'Oracle GraalVM',
    )
    expect(runner).toEqual(['-XX:+HeapDumpOnOutOfMemoryError'])
  })
  test('suites with their own runner arguments replace the heap-dump argument', () => {
    expect(runnerArguments(suiteNamed('std-snowflake-jvm').suite, 'linux', jdk, undefined)).toEqual(
      ['--jvm'],
    )
  })
})

describe('the environment', () => {
  const base = {
    PATH: '/bin',
    JAVA_TOOL_OPTIONS: '-Xmx1g',
    ENSO_POSTGRES_DATABASE: '',
    ENSO_POSTGRES_HOST: 'localhost:5432',
    ENSO_SQLSERVER_DATABASE: '',
  }
  test('Linux JVM', () => {
    const runner = runnerArguments(suiteNamed('standard-library').suite, 'linux', jdk, undefined)
    const env = testEnvironment({
      base,
      platform: 'linux',
      enginePackage: '/e',
      nativeRunner: true,
      runnerArgs: runner,
      junitDir: '/r/target/test-results',
      httpbinUrl: 'http://localhost:19649/',
    })
    expect(env).toEqual({
      PATH: '/bin',
      ENSO_POSTGRES_HOST: 'localhost:5432',
      JAVA_TOOL_OPTIONS: '-enableassertions -XX:+HeapDumpOnOutOfMemoryError',
      ENSO_META_TEST_COMMAND: path.join('/e', 'bin', 'enso'),
      ENSO_META_TEST_ARGS: `--no-ir-caches -XX:+HeapDumpOnOutOfMemoryError --jvm ${jdk} --run`,
      ENSO_ENABLE_ASSERTIONS: 'true',
      ENSO_TEST_ANSI_COLORS: 'true',
      ENSO_TEST_JUNIT_DIR: '/r/target/test-results',
      ENSO_HTTP_TEST_HTTPBIN_URL: 'http://localhost:19649/',
    })
  })
  test('Windows native: the time factors, and the native launcher', () => {
    const env = testEnvironment({
      base: {},
      platform: 'win32',
      enginePackage: 'D:\\e',
      nativeRunner: true,
      runnerArgs: [],
      junitDir: 'D:\\r',
      httpbinUrl: null,
    })
    expect(env.ENSO_META_TEST_ARGS).toBe('--no-ir-caches --run')
    expect(env.ENSO_META_TEST_COMMAND).toBe(path.join('D:\\e', 'bin', 'enso.exe'))
    expect(env.CI_TEST_TIMEFACTOR).toBe('2')
    expect(env.CI_TEST_FLAKY_ENABLE).toBe('true')
    expect(env.ENSO_HTTP_TEST_HTTPBIN_URL).toBeUndefined()
  })
  test('the time factors are absent on Linux, not empty', () => {
    const env = testEnvironment({
      base: {},
      platform: 'linux',
      enginePackage: '/e',
      nativeRunner: true,
      runnerArgs: [],
      junitDir: '/j',
      httpbinUrl: null,
    })
    expect('CI_TEST_TIMEFACTOR' in env).toBe(false)
    expect('CI_TEST_FLAKY_ENABLE' in env).toBe(false)
  })
})

test('a Linux run warns when a database the suite expects is missing', () => {
  expect(missingServiceWarnings(['Table_Tests', 'Microsoft_Tests'], 'linux', {})).toHaveLength(2)
  expect(
    missingServiceWarnings(['Table_Tests'], 'linux', { ENSO_POSTGRES_DATABASE: 'enso_test_db' }),
  ).toEqual([])
  expect(missingServiceWarnings(['Table_Tests'], 'win32', {})).toEqual([])
})

test('the IR cache directory', () => {
  expect(irCacheDirectory('linux', {}, '/home/u')).toBe(
    path.join('/home/u', '.local', 'share', 'enso', 'cache'),
  )
  expect(irCacheDirectory('linux', { XDG_DATA_HOME: '/x' }, '/home/u')).toBe(
    path.join('/x', 'enso', 'cache'),
  )
  expect(irCacheDirectory('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\U')).toBe(
    path.join('C:\\L', 'enso', 'cache'),
  )
  expect(irCacheDirectory('linux', { ENSO_DATA_DIRECTORY: '/d' }, '/home/u')).toBe(
    path.join('/d', 'cache'),
  )
})
