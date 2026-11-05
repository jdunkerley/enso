/** @file `ENSO_JVM_OPTIONS` as the launcher splits it. */
import { expect, test } from 'vitest'
import { jvmOptionsValue, splitJvmOptions } from '../jvmOptions.js'

test('splitJvmOptions: lines when there is a newline, whitespace otherwise', () => {
  expect(splitJvmOptions(' -Da=1  -Db=2 ')).toEqual(['-Da=1', '-Db=2'])
  expect(splitJvmOptions('-Da=a b\r\n\n-Db=2\n')).toEqual(['-Da=a b', '-Db=2'])
  expect(splitJvmOptions('')).toEqual([])
})

test('jvmOptionsValue: one per line, a whitespace-separated inherited value split first', () => {
  expect(jvmOptionsValue('-Da=1 -Db=2', ['-XX:AOTCache=C:\Users\John Smith\enso.aot'])).toBe(
    '-Da=1\n-Db=2\n-XX:AOTCache=C:\Users\John Smith\enso.aot',
  )
  expect(jvmOptionsValue(undefined, ['-Dx=a b', '-Dy=1'])).toBe('-Dx=a b\n-Dy=1')
})

test('jvmOptionsValue: a single option ends with a newline, so its spaces are kept', () => {
  const value = jvmOptionsValue('  ', ['-XX:AOTCacheOutput=C:\Users\John Smith\enso.aot.tmp'])
  expect(value).toBe('-XX:AOTCacheOutput=C:\Users\John Smith\enso.aot.tmp\n')
  expect(splitJvmOptions(value)).toEqual(['-XX:AOTCacheOutput=C:\Users\John Smith\enso.aot.tmp'])
})
