/** @file Finding the engine package. */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { enginePackageDir, ensoBinary, findEnginePackage } from './engine.ts'

const repo = () => mkdtempSync(path.join(tmpdir(), 'engine-'))
const makePackage = (root: string, version: string, triple: string) => {
  const dir = path.join(
    root,
    'built-distribution',
    `enso-engine-${version}-${triple}`,
    `enso-${version}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

test('the path sbt names', () => {
  expect(enginePackageDir('/r', '2026.1.1-dev', 'linux', 'x64')).toBe(
    path.join(
      '/r',
      'built-distribution',
      'enso-engine-2026.1.1-dev-linux-amd64',
      'enso-2026.1.1-dev',
    ),
  )
  expect(enginePackageDir('/r', '1.0.0', 'win32', 'x64')).toContain(
    'enso-engine-1.0.0-windows-amd64',
  )
  expect(enginePackageDir('/r', '1.0.0', 'darwin', 'arm64')).toContain(
    'enso-engine-1.0.0-macos-aarch64',
  )
})

describe('findEnginePackage', () => {
  test('with a version, that version, which must exist', () => {
    const root = repo()
    const dir = makePackage(root, '2026.1.1-dev', 'linux-amd64')
    expect(findEnginePackage(root, '2026.1.1-dev', 'linux', 'x64')).toEqual({
      dir,
      version: '2026.1.1-dev',
    })
    expect(() => findEnginePackage(root, '0.0.0-dev', 'linux', 'x64')).toThrow(
      'No engine package at',
    )
  })
  test('without a version, the only package', () => {
    const root = repo()
    const dir = makePackage(root, '0.0.0-dev', 'linux-amd64')
    expect(findEnginePackage(root, undefined, 'linux', 'x64')).toEqual({
      dir,
      version: '0.0.0-dev',
    })
    expect(findEnginePackage(root, '', 'linux', 'x64').dir).toBe(dir)
  })
  test('without a version, none or two packages is an error', () => {
    const root = repo()
    expect(() => findEnginePackage(root, undefined, 'linux', 'x64')).toThrow('found none')
    makePackage(root, '0.0.0-dev', 'linux-amd64')
    makePackage(root, '2026.1.1-dev', 'linux-amd64')
    expect(() => findEnginePackage(root, undefined, 'linux', 'x64')).toThrow('Expected exactly one')
  })
})

test('the launcher name', () => {
  expect(ensoBinary('/p', 'linux')).toBe(path.join('/p', 'bin', 'enso'))
  expect(ensoBinary('/p', 'win32')).toBe(path.join('/p', 'bin', 'enso.exe'))
})
