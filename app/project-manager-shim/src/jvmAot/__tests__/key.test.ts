/** @file The AOT cache's key and the engine paths it is made from. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { expect, test } from 'vitest'
import { aotKey, enginePaths, isAppImageMount, isTranslocated, readJvmOptionsText } from '../key.js'

const base = {
  appVersion: '2026.2.0',
  engineRoot: '/a/dist/2026.2.0',
  runtimeRoot: '/a/runtime/g',
  jvmOptionsText: '-Dx=1\n',
}

test('the key is stable and moves with each input', () => {
  expect(aotKey(base)).toMatch(/^[0-9a-f]{16}$/)
  expect(aotKey({ ...base })).toBe(aotKey(base))
  for (const field of Object.keys(base) as (keyof typeof base)[]) {
    expect(aotKey({ ...base, [field]: base[field] + 'x' })).not.toBe(aotKey(base))
  }
})

test('enginePaths finds the engine root and the one runtime', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aot-paths-')))
  try {
    const bin = path.join(root, 'enso', 'dist', '1.0', 'bin')
    await fs.mkdir(bin, { recursive: true })
    await fs.writeFile(path.join(bin, 'enso'), '')
    expect(await enginePaths(path.join(bin, 'enso'))).toBeUndefined()
    await fs.mkdir(path.join(root, 'enso', 'runtime', 'graalvm-x'), { recursive: true })
    expect(await enginePaths(path.join(bin, 'enso'))).toEqual({
      engineRoot: path.join(root, 'enso', 'dist', '1.0'),
      runtimeRoot: path.join(root, 'enso', 'runtime', 'graalvm-x'),
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readJvmOptionsText is empty without the file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-options-'))
  try {
    expect(await readJvmOptionsText(root)).toBe('')
    await fs.writeFile(path.join(root, 'jvm.options'), '-Da=1\n')
    expect(await readJvmOptionsText(root)).toBe('-Da=1\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('isTranslocated', () => {
  expect(
    isTranslocated(
      '/private/var/folders/x/T/AppTranslocation/1234/d/Enso.app/Contents/Resources/enso/dist/1',
    ),
  ).toBe(true)
  expect(isTranslocated('/Applications/Enso.app/Contents/Resources/enso/dist/1')).toBe(false)
})

test('isAppImageMount', () => {
  expect(isAppImageMount('/tmp/.mount_enso-lT6xuLn/resources/enso/dist/1')).toBe(true)
  expect(isAppImageMount('/var/tmp/.mount_x/resources/enso/dist/1')).toBe(true)
  // `--appimage-extract-and-run` extracts to a directory named after the AppImage's hash.
  expect(isAppImageMount('/tmp/appimage_extracted_0123abcd/resources/enso/dist/1')).toBe(true)
  expect(isAppImageMount('/home/u/.config/enso/engine/1/dist/1')).toBe(false)
  expect(isAppImageMount('/opt/enso/resources/enso/dist/1')).toBe(false)
})
