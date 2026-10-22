/** @file Locating the repository, and starting programs on Windows. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { commandArguments, invocation, REPO_ROOT, windowsCommandLine } from './repo.ts'

test('REPO_ROOT is the repository root', () => {
  expect(existsSync(path.join(REPO_ROOT, 'build-config.yaml'))).toBe(true)
  expect(existsSync(path.join(REPO_ROOT, 'tools', 'build-scripts', 'package.json'))).toBe(true)
})

test('Windows shims go through the shell, as one command line', () => {
  expect(invocation('corepack', ['pnpm', 'run', 'build:ide'], 'win32')).toEqual({
    file: 'corepack pnpm run build:ide',
    args: [],
    shell: true,
  })
  expect(invocation('sbt', ['-Dsbt.server.autostart=false', 'a b'], 'win32').file).toBe(
    'sbt -Dsbt.server.autostart=false "a b"',
  )
})

test('everything else starts directly', () => {
  expect(invocation('git', ['diff'], 'win32')).toEqual({
    file: 'git',
    args: ['diff'],
    shell: false,
  })
  expect(invocation('corepack', ['pnpm'], 'linux')).toEqual({
    file: 'corepack',
    args: ['pnpm'],
    shell: false,
  })
})

test('an argument with a double quote is refused', () => {
  expect(() => windowsCommandLine('sbt', ['say "hi"'])).toThrow('double quote')
})

test("a command's arguments, without the `--` pnpm passes on", () => {
  expect(commandArguments(['node', 'x.ts', '--', 'std-aws', '--dry-run'])).toEqual([
    'std-aws',
    '--dry-run',
  ])
  expect(commandArguments(['node', 'x.ts', 'std-aws'])).toEqual(['std-aws'])
})
