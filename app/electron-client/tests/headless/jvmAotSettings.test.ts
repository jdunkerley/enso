/** @file The AOT cache's root and its gate: it trains only when the JVM is the default engine. */
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isJvmDefaultEngine, jvmAotRootDirectory } from '../../src/jvmAotSettings'

describe('isJvmDefaultEngine', () => {
  test('native by default: nothing is trained before the switch', () => {
    expect(isJvmDefaultEngine(undefined, {})).toBe(false)
    expect(isJvmDefaultEngine({}, { ENSO_ENGINE_MODE: 'bogus' })).toBe(false)
  })
  test('ENSO_ENGINE_MODE and --engine-mode turn it on; the option wins', () => {
    expect(isJvmDefaultEngine(undefined, { ENSO_ENGINE_MODE: 'jvm' })).toBe(true)
    expect(isJvmDefaultEngine({ option: 'jvm' }, {})).toBe(true)
    expect(isJvmDefaultEngine({ option: 'native' }, { ENSO_ENGINE_MODE: 'jvm' })).toBe(false)
  })
})

describe('jvmAotRootDirectory', () => {
  test('<userData>/jvm-aot, unless ENSO_JVM_AOT_DIR is set and not empty', () => {
    expect(jvmAotRootDirectory({}, 'U')).toBe(path.join('U', 'jvm-aot'))
    expect(jvmAotRootDirectory({ ENSO_JVM_AOT_DIR: '' }, 'U')).toBe(path.join('U', 'jvm-aot'))
    expect(jvmAotRootDirectory({ ENSO_JVM_AOT_DIR: 'D' }, 'U')).toBe('D')
  })
})
