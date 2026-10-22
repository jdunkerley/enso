/** @file The toolchain check's pins, version parsing and verdicts. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import { evaluate, type Pins, readPins, report, toolsToCheck } from './check.ts'

const PINS: Pins = {
  graalvm: '25.0.1',
  sbt: '1.10.6',
  flatc: '24.3.25',
  graalpy: '25.0.1',
  node: '24.21.0',
  pnpm: '12.5.1',
  rust: '1.98.1',
}
const tool = (name: string) => {
  const found = toolsToCheck(PINS).find((candidate) => candidate.name === name)
  if (found == null) throw new Error(name)
  return found
}

describe('readPins', () => {
  test("reads the repository's own pins", () => {
    const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8')
    const pins = readPins({
      buildConfig: read('build-config.yaml'),
      nodeVersion: read('.node-version'),
      packageJson: read('package.json'),
      rustToolchain: read('rust-toolchain.toml'),
    })
    for (const value of Object.values(pins)) expect(value).toMatch(/^\d+\.\d+\.\d+$/)
  })
  test('names the file of a missing pin', () => {
    const files = {
      buildConfig: 'toolchain:\n  graalvm: 25.0.1\n  sbt: 1.10.6\n  flatc: 24.3.25\n',
      nodeVersion: '24.21.0\n',
      packageJson: '{"packageManager": "pnpm@12.5.1+sha512.abc"}',
      rustToolchain: '[toolchain]\nchannel = "1.98.1"\n',
    }
    expect(() => readPins(files)).toThrow('build-config.yaml (`toolchain.graalpy`)')
    const pins = readPins({ ...files, buildConfig: files.buildConfig + '  graalpy: 25.0.1\n' })
    expect(pins).toEqual(PINS)
  })
})

describe('evaluate', () => {
  test('GraalVM from `java -version`', () => {
    const output =
      'openjdk version "25.0.1" 2025-10-21\nOpenJDK Runtime Environment GraalVM CE 25.0.1+8.1 (build 25.0.1+8-jvmci-b01)\n'
    expect(evaluate(tool('GraalVM'), 0, output)).toMatchObject({ status: 'ok', fails: false })
    const temurin = 'openjdk version "21.0.4"\nOpenJDK Runtime Environment Temurin-21.0.4+7\n'
    expect(evaluate(tool('GraalVM'), 0, temurin)).toMatchObject({
      status: 'missing',
      found: 'openjdk version "21.0.4"',
      fails: true,
    })
  })
  test('a different sbt launcher only warns', () => {
    expect(evaluate(tool('sbt launcher'), 0, '2.0.8\n')).toMatchObject({
      status: 'mismatch',
      found: '2.0.8',
      fails: false,
    })
  })
  test('a different flatc, Node, pnpm or Rust fails', () => {
    expect(evaluate(tool('flatc'), 0, 'flatc version 23.5.26\n').fails).toBe(true)
    expect(evaluate(tool('Node'), 0, 'v22.1.0\n').fails).toBe(true)
    expect(evaluate(tool('pnpm'), 0, '10.0.0\n').fails).toBe(true)
    expect(evaluate(tool('Rust'), 0, 'rustc 1.90.0 (abc 2025-01-01)\n').fails).toBe(true)
    expect(evaluate(tool('Rust'), 0, 'rustc 1.98.1 (48a229cea 2026-09-01)\n').status).toBe('ok')
  })
  test('a missing GraalPy only warns', () => {
    expect(evaluate(tool('GraalPy'), -1, '')).toMatchObject({ status: 'missing', fails: false })
    expect(evaluate(tool('GraalPy'), 0, 'GraalPy 3.12.8 (GraalVM CE Native 25.0.1)\n').status).toBe(
      'ok',
    )
  })
  test('a missing required tool fails', () => {
    expect(evaluate(tool('flatc'), 1, "'flatc' is not recognized\n")).toMatchObject({
      status: 'missing',
      found: null,
      fails: true,
    })
  })
})

test('report: one line per tool, and the hint under a problem', () => {
  const lines = report([
    evaluate(tool('Node'), 0, 'v24.21.0\n'),
    evaluate(tool('flatc'), 0, 'flatc version 23.5.26\n'),
  ])
  expect(lines).toEqual([
    'ok    Node   24.21.0',
    'FAIL  flatc  23.5.26 installed, 24.3.25 pinned',
    `             ${tool('flatc').hint}`,
  ])
})
