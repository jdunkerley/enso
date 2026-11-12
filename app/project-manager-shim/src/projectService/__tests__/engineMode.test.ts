import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_ENGINE_MODE,
  describeEngineMode,
  liftJvmFlag,
  parseEngineMode,
  resolveDefaultEngineMode,
  resolveEngineMode,
} from '../engineMode.js'

let project: string
beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-mode-'))
})
afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true })
})
const writeYaml = (text: string) => fs.writeFile(path.join(project, 'package.yaml'), text)

describe('resolveEngineMode', () => {
  test('package.yaml jvm: true wins over everything', async () => {
    await writeYaml('name: P\njvm: true\n')
    expect(
      await resolveEngineMode(project, {
        option: 'native',
        environment: 'native',
        defaultMode: 'native',
      }),
    ).toEqual({ mode: 'jvm', source: 'package.yaml' })
  })
  test('package.yaml jvm: false wins over everything', async () => {
    await writeYaml('name: P\njvm: false\n')
    expect(
      await resolveEngineMode(project, { option: 'jvm', environment: 'jvm', defaultMode: 'jvm' }),
    ).toEqual({ mode: 'native', source: 'package.yaml' })
  })
  test('then the option', async () => {
    await writeYaml('name: P\n')
    expect(await resolveEngineMode(project, { option: 'jvm', environment: 'native' })).toEqual({
      mode: 'jvm',
      source: 'option',
    })
  })
  test('then the environment', async () => {
    expect(await resolveEngineMode(project, { environment: 'jvm' })).toEqual({
      mode: 'jvm',
      source: 'environment',
    })
  })
  test('an unknown environment value is ignored', async () => {
    expect(
      await resolveEngineMode(project, { environment: 'graal', defaultMode: 'native' }),
    ).toEqual({ mode: 'native', source: 'default' })
  })
  test('then the default', async () => {
    expect(await resolveEngineMode(project, { defaultMode: 'jvm' })).toEqual({
      mode: 'jvm',
      source: 'default',
    })
    expect((await resolveEngineMode(project, {})).source).toBe('default')
  })
})

test('the built-in default is the JVM', () => {
  expect(DEFAULT_ENGINE_MODE).toBe('jvm')
  expect(resolveDefaultEngineMode({})).toEqual({ mode: 'jvm', source: 'default' })
})

test('resolveDefaultEngineMode ignores the project', () => {
  expect(resolveDefaultEngineMode({ environment: 'JVM' })).toEqual({
    mode: 'jvm',
    source: 'environment',
  })
})

test('parseEngineMode', () => {
  expect(parseEngineMode(' Native ')).toBe('native')
  expect(parseEngineMode('jvm')).toBe('jvm')
  expect(parseEngineMode('')).toBeUndefined()
  expect(parseEngineMode(undefined)).toBeUndefined()
  expect(parseEngineMode('espresso')).toBeUndefined()
})

test('describeEngineMode', () => {
  expect(describeEngineMode({ mode: 'jvm', source: 'package.yaml' })).toBe(
    'Engine mode: jvm (package.yaml)',
  )
  expect(describeEngineMode({ mode: 'native', source: 'environment' })).toBe(
    'Engine mode: native (ENSO_ENGINE_MODE)',
  )
  expect(describeEngineMode({ mode: 'native', source: 'option' })).toBe(
    'Engine mode: native (--engine-mode)',
  )
  expect(describeEngineMode({ mode: 'native', source: 'default' })).toBe(
    'Engine mode: native (default)',
  )
})

test('liftJvmFlag turns a --jvm argument into the jvm option', () => {
  expect(liftJvmFlag(['--log-level', 'info'], undefined)).toEqual({
    args: ['--log-level', 'info'],
    option: undefined,
  })
  expect(liftJvmFlag(['--jvm', '--log-level', 'info'], undefined)).toEqual({
    args: ['--log-level', 'info'],
    option: 'jvm',
  })
  // An explicit option wins over the back door.
  expect(liftJvmFlag(['--jvm'], 'native')).toEqual({ args: [], option: 'native' })
})
