/** @file The runner's orchestration, with the engine, the helper server and the file system faked. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runStdlibTests, type StdlibTestContext } from './run.ts'

/** A repository whose `test/` holds the given projects. */
function repository(projects: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stdlib-test-'))
  for (const project of projects) {
    mkdirSync(path.join(root, 'test', project), { recursive: true })
    writeFileSync(path.join(root, 'test', project, 'package.yaml'), 'name: x\n')
  }
  return root
}

function context(root: string, overrides: Partial<StdlibTestContext> = {}) {
  const calls: string[] = []
  const logged: string[] = []
  const base: StdlibTestContext = {
    repoRoot: root,
    platform: 'linux',
    env: { GITHUB_ACTIONS: 'true' },
    home: '/home/u',
    enginePackage: { dir: '/e', version: '2026.1.1-dev' },
    exists: () => true,
    startHttpbin: async () => {
      calls.push('httpbin start')
      return { url: 'http://localhost:1/', stop: () => calls.push('httpbin stop') }
    },
    runProject: (file, args, env) => {
      calls.push(`${file} ${args.at(-1)} junit=${env.ENSO_TEST_JUNIT_DIR}`)
      return args.at(-1)?.endsWith('Failing_Tests') ? 1 : 0
    },
    remove: (target) => calls.push(`remove ${target}`),
    benchReports: () => ['/r/bench-report.xml'],
    resetDir: (dir) => calls.push(`reset ${dir}`),
    appendSummary: () => {},
    log: (line) => logged.push(line),
  }
  return { calls, logged, context: { ...base, ...overrides } }
}

describe('runStdlibTests', () => {
  test('cleans, starts the helper, runs every project in order, stops the helper', async () => {
    const root = repository(['Base_Tests', 'AWS_Tests', 'Examples_Tests'])
    const { calls, context: c } = context(root)
    const junit = path.join(root, 'target', 'test-results')
    expect(
      await runStdlibTests({ suite: 'standard-library-in-native', clean: true, dryRun: false }, c),
    ).toBe(0)
    expect(calls).toEqual([
      `remove ${path.join('/home/u', '.local', 'share', 'enso', 'cache')}`,
      'remove /r/bench-report.xml',
      `reset ${junit}`,
      'httpbin start',
      `${path.join('/e', 'bin', 'enso')} ${path.join(root, 'test', 'Base_Tests')} junit=${junit}`,
      `${path.join('/e', 'bin', 'enso')} ${path.join(root, 'test', 'Examples_Tests')} junit=${junit}`,
      'httpbin stop',
    ])
  })
  test('a failing project fails the run after the others have run', async () => {
    const root = repository(['Failing_Tests', 'Test_Tests'])
    const { calls, logged, context: c } = context(root)
    expect(await runStdlibTests({ suite: 'stdlib', clean: false, dryRun: false }, c)).toBe(1)
    expect(calls.filter((call) => call.includes('Test_Tests'))).toHaveLength(1)
    expect(logged.at(-1)).toBe(
      '::error title=Failed Standard Library Tests::1 test suite(s) failed: Failing_Tests: the test run exited with status 1',
    )
    expect(calls.at(-1)).toBe('httpbin stop')
  })
  test('the AWS suite without credentials succeeds and starts nothing', async () => {
    const { calls, context: c } = context(repository(['AWS_Tests']))
    expect(await runStdlibTests({ suite: 'std-aws', clean: true, dryRun: false }, c)).toBe(0)
    expect(calls).toEqual([])
  })
  test('no cleaning outside GitHub Actions, and a given helper URL is used', async () => {
    const root = repository(['Base_Tests'])
    const { calls, context: c } = context(root, {
      env: { CI: 'true', ENSO_HTTP_TEST_HTTPBIN_URL: 'http://localhost:9/' },
    })
    await runStdlibTests({ suite: 'stdlib', clean: true, dryRun: false }, c)
    expect(calls.some((call) => call.startsWith('remove') || call.startsWith('httpbin'))).toBe(
      false,
    )
  })
  test('the JVM suite needs the small JDK', async () => {
    const { context: c } = context(repository(['Base_Tests']), { exists: () => false })
    await expect(
      runStdlibTests({ suite: 'standard-library', clean: false, dryRun: false }, c),
    ).rejects.toThrow('buildSmallJdkForRelease')
  })
  test('the cloud suites refuse cloud credentials', async () => {
    const env = Object.fromEntries(
      [
        'ENSO_CLOUD_TEST_ACCOUNT_USERNAME',
        'ENSO_CLOUD_TEST_ACCOUNT_PASSWORD',
        'ENSO_CLOUD_COGNITO_USER_POOL_WEB_CLIENT_ID',
        'ENSO_CLOUD_COGNITO_USER_POOL_ID',
        'ENSO_CLOUD_COGNITO_REGION',
      ].map((name) => [name, 'x']),
    )
    const { context: c } = context(repository(['Base_Tests']), { env })
    await expect(
      runStdlibTests({ suite: 'std-cloud-related', clean: false, dryRun: false }, c),
    ).rejects.toThrow('cannot sign in to Enso Cloud')
  })
  test('a dry run lists the commands and runs nothing', async () => {
    const { calls, logged, context: c } = context(repository(['Base_Tests']))
    expect(await runStdlibTests({ suite: 'stdlib-native', clean: true, dryRun: true }, c)).toBe(0)
    expect(calls).toEqual([])
    expect(logged.at(-1)).toContain('--no-ir-caches --run')
  })
  test('--only runs just those projects', async () => {
    const root = repository(['Base_Tests', 'Table_Tests', 'Image_Tests'])
    const { calls, context: c } = context(root)
    const only = ['Table_Tests', 'Base_Tests']
    expect(await runStdlibTests({ suite: 'stdlib', only, clean: false, dryRun: false }, c)).toBe(0)
    expect(calls.filter((call) => call.includes('_Tests'))).toEqual([
      expect.stringContaining(path.join(root, 'test', 'Base_Tests')),
      expect.stringContaining(path.join(root, 'test', 'Table_Tests')),
    ])
  })
  describe('a group filter', () => {
    const FILTER = '^\\[SQLite File\\]'
    const only = ['Table_Tests']
    /** A run whose Table_Tests report holds `cases` (`<testcase>` elements). */
    function filtered(cases: string) {
      const root = repository(['Table_Tests', 'Base_Tests'])
      return context(root, {
        env: { GITHUB_ACTIONS: 'true', ENSO_TEST_GROUP_FILTER: FILTER },
        runProject: (file, args, env) => {
          const dir = path.join(env.ENSO_TEST_JUNIT_DIR ?? '', 'Table_Tests')
          mkdirSync(dir, { recursive: true })
          writeFileSync(
            path.join(dir, 'JUnit.xml'),
            `<testsuites><testsuite name="[SQLite File] Select">${cases}</testsuite></testsuites>`,
          )
          return 0
        },
      })
    }
    test('a run in which it ran no test fails', async () => {
      const { logged, context: c } = filtered(
        '<testcase name="PENDING"><skipped message="x"/></testcase>',
      )
      expect(await runStdlibTests({ suite: 'stdlib', only, clean: false, dryRun: false }, c)).toBe(
        1,
      )
      expect(logged.at(-1)).toContain('::error')
      expect(logged.at(-1)).toContain('ran no test')
    })
    test('a run in which it ran a test passes', async () => {
      const { context: c } = filtered('<testcase name="works"></testcase>')
      expect(await runStdlibTests({ suite: 'stdlib', only, clean: false, dryRun: false }, c)).toBe(
        0,
      )
    })
    test('it applies to one project only', async () => {
      const { context: c } = filtered('<testcase name="works"></testcase>')
      await expect(
        runStdlibTests(
          { suite: 'stdlib', only: ['Table_Tests', 'Base_Tests'], clean: false, dryRun: false },
          c,
        ),
      ).rejects.toThrow(/one project/)
    })
  })
  test('--only with a name the suite does not run is an error, before anything starts', async () => {
    const root = repository(['Base_Tests', 'AWS_Tests'])
    const { calls, context: c } = context(root)
    const only = ['Base_Tests', 'Base_Test', 'AWS_Tests']
    await expect(
      runStdlibTests({ suite: 'stdlib', only, clean: true, dryRun: false }, c),
    ).rejects.toThrow(
      '--only names projects that suite standard-library does not run: "Base_Test", "AWS_Tests".',
    )
    expect(calls).toEqual([])
  })
})
