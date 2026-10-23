import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  ENGINE_LOGGER_ROOTS,
  filterRows,
  LineClassifier,
  logOrigin,
  rowsFromLines,
  STD_BITS_PACKAGE_ROOTS,
  type LogRow,
  type RowFilter,
} from '../engineLogModel'

const entry = (level: string, logger: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [${logger}] ${message}`

describe('logOrigin', () => {
  test.each([
    'org.enso.interpreter.runtime.EnsoContext',
    'org.enso.compiler.Compiler',
    'org.enso.languageserver.boot.LanguageServerComponent',
    'org.enso.runner.Main',
    'org.enso.jvm.interop',
    'org.enso',
    'enso',
    'enso.org.enso.interpreter.runtime.EnsoContext',
    'enso-runtime-server.org.enso.interpreter.instrument.job.ExecuteJob',
    'epb.org.enso.interpreter.epb.EpbContext',
    'engine',
    'akka.actor.ActorSystemImpl',
    'org.graalvm.polyglot.Engine',
    'com.oracle.truffle.api.TruffleLogger',
    'io.helidon.webserver.LoomServer',
    'org.eclipse.jetty.server.Server',
  ])('%s is the engine', (name) => {
    expect(logOrigin(name)).toBe('engine')
  })

  test.each([
    // The standard library's Enso modules, and a user's project.
    'Standard.Base.Logging.Progress',
    'Standard.Database.Connection',
    'local.My_Project.Main.Report',
    // The std-bits helpers, under `org.enso` but the libraries'.
    'org.enso.table',
    'org.enso.table.read.ExcelReader',
    'org.enso.base.net.http.HttpClient',
    'org.enso.database.JDBCProxy',
    'org.enso.tableau.HyperReader',
    'org.enso.nativeimage.Foo',
    // Third-party Java the libraries pull in, and anything unforeseen.
    'software.amazon.awssdk.request',
    'com.azure.identity.ClientSecretCredential',
    'net.snowflake.client.jdbc.SnowflakeDriver',
    'org.postgresql.Driver',
    'something.nobody.foresaw',
  ])('%s is a library', (name) => {
    expect(logOrigin(name)).toBe('library')
  })

  test('matches whole name segments only', () => {
    // A std-bits root does not cover a longer segment, so these fall back to `org.enso`: the engine.
    expect(logOrigin('org.enso.tableaux')).toBe('engine')
    expect(logOrigin('org.enso.tab')).toBe('engine')
    expect(logOrigin('org.enso.baseline.Thing')).toBe('engine')
    // `org.enso.tableau` is its own root, not `org.enso.table` plus a suffix.
    expect(logOrigin('org.enso.tableau')).toBe('library')
    // An engine root does not cover a longer segment either.
    expect(logOrigin('org.ensoish.Thing')).toBe('library')
    expect(logOrigin('akkadia.Thing')).toBe('library')
    expect(logOrigin('ensoUser.Main')).toBe('library')
    expect(logOrigin('engineer.Main')).toBe('library')
  })

  test('the two root lists do not shadow each other', () => {
    for (const root of STD_BITS_PACKAGE_ROOTS) expect(root.startsWith('org.enso.')).toBe(true)
    for (const root of ENGINE_LOGGER_ROOTS) expect(STD_BITS_PACKAGE_ROOTS).not.toContain(root)
  })
})

describe('std-bits package roots', () => {
  // `app/gui/src/project-view/components/EngineLogs/__tests__` → the repository root.
  const repoRoot = path.resolve(__dirname, '../../../../../../..')
  const stdBits = path.join(repoRoot, 'std-bits')

  /** Every `org.enso.<root>` that a std-bits library's main Java sources define. */
  function rootsOnDisk(): string[] {
    const roots: string[] = []
    for (const lib of fs.readdirSync(stdBits, { withFileTypes: true })) {
      if (!lib.isDirectory()) continue
      const ensoDir = path.join(stdBits, lib.name, 'src', 'main', 'java', 'org', 'enso')
      if (!fs.existsSync(ensoDir)) continue
      for (const pkg of fs.readdirSync(ensoDir, { withFileTypes: true })) {
        if (pkg.isDirectory()) roots.push(`org.enso.${pkg.name}`)
      }
    }
    return roots
  }

  test('every root on disk is classified as a library', () => {
    const roots = rootsOnDisk()
    // Guard against passing vacuously if the layout moves.
    expect(roots.length).toBeGreaterThan(0)
    const misfiled = roots.filter(
      (root) => logOrigin(root) !== 'library' || logOrigin(`${root}.SomeClass`) !== 'library',
    )
    expect(misfiled, 'add these to STD_BITS_PACKAGE_ROOTS in engineLogModel.ts').toEqual([])
  })
})

describe('LineClassifier origin', () => {
  test('an entry takes its logger origin; continuation lines take their entry', () => {
    const classifier = new LineClassifier()
    const origins = [
      classifier.classify('a line before any entry', 'file'),
      classifier.classify(entry('INFO', 'org.enso.compiler.Compiler', 'compiled'), 'file'),
      classifier.classify('  at org.enso.compiler.Compiler.run', 'file'),
      classifier.classify(entry('ERROR', 'Standard.Base.Data', 'oops'), 'file'),
      classifier.classify('  at Standard.Base.Data.read', 'file'),
      classifier.classify('Picked up JAVA_TOOL_OPTIONS', 'stderr'),
      classifier.classify('  after stderr, the last entry still holds', 'file'),
    ].map((line) => line.origin)
    expect(origins).toEqual([
      'library',
      'engine',
      'engine',
      'library',
      'library',
      'engine',
      'library',
    ])
  })

  test('reset forgets the entry: continuation lines are a library again', () => {
    const classifier = new LineClassifier()
    classifier.classify(entry('INFO', 'akka.actor.ActorSystem', 'started'), 'file')
    expect(classifier.classify('continued', 'file').origin).toBe('engine')
    classifier.reset()
    expect(classifier.classify('continued', 'file').origin).toBe('library')
  })
})

describe('filterRows by origin', () => {
  const rows: LogRow[] = [
    { kind: 'divider', key: 0, divider: 'restarted' },
    ...rowsFromLines([
      entry('INFO', 'org.enso.languageserver.Boot', 'server started'),
      entry('WARN', 'Standard.Database.Connection', 'slow query'),
      entry('ERROR', 'org.enso.database.JDBCProxy', 'query failed'),
      '  at org.enso.database.JDBCProxy.run',
      entry('ERROR', 'org.enso.interpreter.runtime.EnsoContext', 'context failed'),
    ]).map((row) => ({ ...row, key: row.key + 10 })),
  ]
  const texts = (filter: Partial<RowFilter>) =>
    filterRows(rows, { level: 'info', text: '', origin: 'all', ...filter }).map((row) =>
      row.kind === 'line' ? row.text : `--${row.divider}--`,
    )

  test('All keeps every line', () => {
    expect(texts({})).toHaveLength(6)
  })

  test('Libraries and Engine keep their own lines, and every divider', () => {
    expect(texts({ origin: 'library' })).toEqual([
      '--restarted--',
      entry('WARN', 'Standard.Database.Connection', 'slow query'),
      entry('ERROR', 'org.enso.database.JDBCProxy', 'query failed'),
      '  at org.enso.database.JDBCProxy.run',
    ])
    expect(texts({ origin: 'engine' })).toEqual([
      '--restarted--',
      entry('INFO', 'org.enso.languageserver.Boot', 'server started'),
      entry('ERROR', 'org.enso.interpreter.runtime.EnsoContext', 'context failed'),
    ])
  })

  test('combines with the level and the text', () => {
    expect(texts({ origin: 'library', level: 'error' })).toEqual([
      '--restarted--',
      entry('ERROR', 'org.enso.database.JDBCProxy', 'query failed'),
      '  at org.enso.database.JDBCProxy.run',
    ])
    expect(texts({ origin: 'engine', level: 'error', text: 'CONTEXT' })).toEqual([
      '--restarted--',
      entry('ERROR', 'org.enso.interpreter.runtime.EnsoContext', 'context failed'),
    ])
    expect(texts({ origin: 'engine', text: 'query' })).toEqual(['--restarted--'])
    expect(texts({ origin: 'all', level: 'warn', text: 'query' })).toEqual([
      '--restarted--',
      entry('WARN', 'Standard.Database.Connection', 'slow query'),
      entry('ERROR', 'org.enso.database.JDBCProxy', 'query failed'),
    ])
  })
})
