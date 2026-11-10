/** @file The toolchain check's pins, version parsing and verdicts. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import {
  evaluate,
  graalVMDownload,
  parseGraalVM,
  type Pins,
  readPins,
  report,
  toolsToCheck,
} from './check.ts'

const PINS: Pins = {
  graalvm: '25.0.1',
  graalvmJdk: '25.0.1',
  sbt: '1.10.6',
  flatc: '24.3.25',
  graalpy: '25.0.1',
  node: '24.21.0',
  pnpm: '12.5.1',
  rust: '1.98.1',
}
/** GraalVM CE 25.5.5.0.3, an innovation release: its JDK is 25.0.5.0.3, its GraalPy 25.5.5. */
const INNOVATION: Pins = {
  ...PINS,
  graalvm: '25.5.5.0.3',
  graalvmJdk: '25.0.5.0.3',
  graalpy: '25.5.5',
}
/** `java -version` of GraalVM CE 25.0.1 and of 25.5.5.0.3, as the real binaries print it. */
const JAVA_25_0_1 =
  'openjdk version "25.0.1" 2025-10-21\nOpenJDK Runtime Environment GraalVM CE 25.0.1+8.1 (build 25.0.1+8-jvmci-b01)\nOpenJDK 64-Bit Server VM GraalVM CE 25.0.1+8.1 (build 25.0.1+8-jvmci-b01, mixed mode, sharing)\n'
const JAVA_25_5 =
  'openjdk version "25.0.5.0.3" 2026-10-24\nOpenJDK Runtime Environment GraalVM CE 25.5.5.0.3+1.1 (build 25.0.5.0.3+1-jvmci-25.5-b26)\nOpenJDK 64-Bit Server VM GraalVM CE 25.5.5.0.3+1.1 (build 25.0.5.0.3+1-jvmci-25.5-b26, mixed mode, sharing)\n'
const OTHER_FILES = {
  nodeVersion: '24.21.0\n',
  packageJson: '{"packageManager": "pnpm@12.5.1+sha512.abc"}',
  rustToolchain: '[toolchain]\nchannel = "1.98.1"\n',
}
const tool = (name: string, pins: Pins = PINS) => {
  const found = toolsToCheck(pins).find((candidate) => candidate.name === name)
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
    // Three to five components: GraalVM's innovation releases have five (25.5.5.0.3).
    for (const value of Object.values(pins)) expect(value).toMatch(/^\d+(\.\d+){2,4}$/)
  })
  test('names the file of a missing pin', () => {
    const files = {
      buildConfig:
        'toolchain:\n  graalvm: 25.0.1\n  graalvm-jdk: 25.0.1\n  sbt: 1.10.6\n  flatc: 24.3.25\n',
      ...OTHER_FILES,
    }
    expect(() => readPins(files)).toThrow('build-config.yaml (`toolchain.graalpy`)')
    const pins = readPins({ ...files, buildConfig: files.buildConfig + '  graalpy: 25.0.1\n' })
    expect(pins).toEqual(PINS)
    expect(() =>
      readPins({
        ...OTHER_FILES,
        buildConfig:
          'toolchain:\n  graalvm: 25.0.1\n  sbt: 1.10.6\n  flatc: 24.3.25\n  graalpy: 25.0.1\n',
      }),
    ).toThrow('build-config.yaml (`toolchain.graalvm-jdk`)')
  })
  test('reads an innovation release: five-part versions, the JDK apart from the release', () => {
    const pins = readPins({
      ...OTHER_FILES,
      buildConfig:
        'toolchain:\n  graalvm: 25.5.5.0.3\n  graalvm-jdk: 25.0.5.0.3\n  sbt: 1.10.6\n  flatc: 24.3.25\n  graalpy: 25.5.5\n',
    })
    expect(pins).toEqual(INNOVATION)
  })
})

describe('GraalVM versions', () => {
  test('parses the release and the JDK from `java -version`', () => {
    expect(parseGraalVM(JAVA_25_0_1)).toBe('25.0.1 (JDK 25.0.1)')
    expect(parseGraalVM(JAVA_25_5)).toBe('25.5.5.0.3 (JDK 25.0.5.0.3)')
    const temurin = 'openjdk version "21.0.4"\nOpenJDK Runtime Environment Temurin-21.0.4+7\n'
    expect(parseGraalVM(temurin)).toBe(null)
  })
  test('downloads 25.0.x by its JDK tag and an innovation release by its release tag', () => {
    expect(graalVMDownload(PINS)).toBe(
      'https://github.com/graalvm/graalvm-ce-builds/releases/tag/jdk-25.0.1',
    )
    expect(graalVMDownload(INNOVATION)).toBe(
      'https://github.com/graalvm/graalvm-ce-builds/releases/tag/graal-25.5.5.0.3',
    )
  })
})

describe('evaluate', () => {
  test('GraalVM from `java -version`', () => {
    expect(evaluate(tool('GraalVM'), 0, JAVA_25_0_1)).toMatchObject({ status: 'ok', fails: false })
    const temurin = 'openjdk version "21.0.4"\nOpenJDK Runtime Environment Temurin-21.0.4+7\n'
    expect(evaluate(tool('GraalVM'), 0, temurin)).toMatchObject({
      status: 'missing',
      found: 'openjdk version "21.0.4"',
      fails: true,
    })
  })
  test('an innovation release needs both its release and its JDK', () => {
    expect(evaluate(tool('GraalVM', INNOVATION), 0, JAVA_25_5)).toMatchObject({
      status: 'ok',
      fails: false,
    })
    expect(evaluate(tool('GraalVM', INNOVATION), 0, JAVA_25_0_1)).toMatchObject({
      status: 'mismatch',
      found: '25.0.1 (JDK 25.0.1)',
      fails: true,
    })
    expect(evaluate(tool('GraalVM'), 0, JAVA_25_5)).toMatchObject({
      status: 'mismatch',
      fails: true,
    })
    expect(tool('GraalVM', INNOVATION).hint).toContain('releases/tag/graal-25.5.5.0.3')
    expect(tool('GraalVM', INNOVATION).hint).not.toContain('SDKMAN')
    expect(tool('GraalVM').hint).toContain('sdk install java 25.0.1-graalce')
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
  test("GraalPy 25.5's version names the GraalVM release it was built from", () => {
    const output = 'GraalPy 3.13.14 (GraalVM CE Native 25.5.5.0.3)\n'
    expect(evaluate(tool('GraalPy', INNOVATION), 0, output).status).toBe('ok')
    expect(evaluate(tool('GraalPy'), 0, output)).toMatchObject({ status: 'mismatch', fails: false })
    const near = 'GraalPy 3.13.14 (GraalVM CE Native 25.5.50)\n'
    expect(evaluate(tool('GraalPy', INNOVATION), 0, near).status).toBe('mismatch')
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
