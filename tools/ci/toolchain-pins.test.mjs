// Run with `node --test tools/ci/toolchain-pins.test.mjs`.


import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readToolchainPins } from './toolchain-pins.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'toolchain-pins-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** Each fixture is a `build-config.yaml`, and the keys to read from it. */
const FIXTURES = {
  'the real file': {
    text: readFileSync(path.join(repoRoot, 'build-config.yaml'), 'utf8'),
    keys: ['graalvm', 'graalpy', 'sbt', 'flatc', 'missing'],
  },
  'a value glued to its key is no pin': {
    text: 'toolchain:\n  graalvm:25.0.1\n',
    keys: ['graalvm'],
  },
  'a glued comment is kept, a later word dropped': {
    text: 'toolchain:\n  sbt: 1.10.6#x\n  flatc: 24.3.25 x\n',
    keys: ['sbt', 'flatc'],
  },
  'the first of two lines wins': {
    text: 'toolchain:\n  sbt: 1\n  sbt: 2\n',
    keys: ['sbt'],
  },
  'a tab-indented line closes the block': {
    text: 'toolchain:\n\tgraalvm: 1\n  sbt: 2\n',
    keys: ['graalvm', 'sbt'],
  },
  'blank lines and column-0 comments keep it open, CRLF is dropped': {
    text: 'toolchain:\r\n\r\n# a note\r\n  sbt: 1.10.6\r\n  # flatc: 9\r\n  flatc: 24.3.25 # pinned\r\n',
    keys: ['sbt', 'flatc'],
  },
  'a key with no value is empty': {
    text: 'toolchain:\n  sbt:\n',
    keys: ['sbt'],
  },
  'a later top-level key closes the block': {
    text: 'toolchain:\n  sbt: 1\nother:\n  flatc: 2\n',
    keys: ['sbt', 'flatc'],
  },
}

/** The awk program in `setup-jvm`'s "Read the pinned versions" step. */
function setupJvmAwkProgram() {
  const action = readFileSync(
    path.join(repoRoot, '.github', 'actions', 'setup-jvm', 'action.yml'),
    'utf8',
  )
  const program = action.match(/awk -v key="\$1" '([^']+)' build-config\.yaml/)?.[1]
  assert.ok(program, 'setup-jvm reads the pins with `awk -v key="$1" \'…\' build-config.yaml`')
  return program
}

const awkAvailable = spawnSync('awk', ['--version']).error == null

describe('readToolchainPins agrees with the awk reader in setup-jvm', () => {
  // CI (Linux) always has awk; a Windows shell without Git Bash on the PATH may not.
  const run = awkAvailable || process.env.CI ? test : test.skip
  let count = 0
  for (const [name, { text, keys }] of Object.entries(FIXTURES)) {
    run(name, () => {
      const file = path.join(scratch, `build-config-${count++}.yaml`)
      writeFileSync(file, text)
      const program = setupJvmAwkProgram()
      const pins = readToolchainPins(text)
      for (const key of keys) {
        const awk = spawnSync('awk', ['-v', `key=${key}`, program, file], { encoding: 'utf8' })
        assert.equal(awk.status, 0, awk.stderr)
        assert.equal(pins[key] ?? '', awk.stdout.replace(/\n$/, ''), `key ${key}`)
      }
    })
  }
})

test('readToolchainPins reads the real pins', () => {
  const pins = readToolchainPins(readFileSync(path.join(repoRoot, 'build-config.yaml'), 'utf8'))
  for (const key of ['graalvm', 'graalpy', 'sbt', 'flatc']) {
    assert.match(pins[key] ?? '', /^\d+\.\d+\.\d+$/, key)
  }
})
