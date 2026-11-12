/** @file `jvm.options` and `ENSO_JVM_OPTIONS` as `JvmOptions.java` parses them. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { expect, test } from 'vitest'
import { parseJvmOptionsFile, splitJvmOptions } from '../jvmOptions.js'

/** The cases `JvmOptionsTest` (engine/runner) runs against `JvmOptions.java`. */
const CASES_FILE = path.resolve(
  import.meta.dirname,
  '../../../../../engine/runner/src/test/resources/org/enso/runner/jvm-options-cases.txt',
)

interface SharedCase {
  name: string
  file?: string
  env?: string
  fileExpect: string[]
  envExpect: string[]
}

function unescape(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, escape: string) => {
    if (escape.startsWith('u') && escape.length === 5) {
      return String.fromCharCode(parseInt(escape.slice(1), 16))
    }
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\' }
    const result = simple[escape]
    if (result == null) throw new Error(`unknown escape \\${escape}`)
    return result
  })
}

function readCases(): SharedCase[] {
  const cases: SharedCase[] = []
  for (const line of fs.readFileSync(CASES_FILE, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('== ')) {
      cases.push({ name: line.slice(3), fileExpect: [], envExpect: [] })
    } else if (line !== '' && !line.startsWith('#')) {
      const current = cases.at(-1)!
      const colon = line.indexOf(': ')
      const key = line.slice(0, colon)
      const value = unescape(line.slice(colon + 2))
      if (key === 'file') current.file = value
      else if (key === 'env') current.env = value
      else if (key === 'file-expect') current.fileExpect.push(value)
      else if (key === 'env-expect') current.envExpect.push(value)
      else throw new Error(`unknown key ${key}`)
    }
  }
  return cases
}

const cases = readCases()

test('the shared fixture has its cases', () => {
  expect(cases.length).toBeGreaterThanOrEqual(8)
})

test.each(cases.map((c) => [c.name, c] as const))('shared case: %s', (_name, c) => {
  if (c.file != null) expect(parseJvmOptionsFile(c.file)).toEqual(c.fileExpect)
  if (c.env != null) expect(splitJvmOptions(c.env)).toEqual(c.envExpect)
})

test('splitJvmOptions: lines when there is a newline, whitespace otherwise', () => {
  expect(splitJvmOptions(' -Da=1  -Db=2 ')).toEqual(['-Da=1', '-Db=2'])
  expect(splitJvmOptions('-Da=a b\r\n\n-Db=2\n')).toEqual(['-Da=a b', '-Db=2'])
  expect(splitJvmOptions('')).toEqual([])
})
