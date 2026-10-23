/** @file The release's installers and update files (the `manifest.rs` and `project/ide.rs` tests). */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  checksumPath,
  contentType,
  downloadUrl,
  ideUploadFiles,
  installerName,
  missingInstallersNote,
  RELEASE_TARGETS,
  releaseTarget,
  splitUploaded,
  updateFiles,
} from './assets.ts'

test('the installers are the IDE images electron-builder names', () => {
  expect(RELEASE_TARGETS.map((target) => installerName(target, '2026.2.0'))).toEqual([
    'enso-win-x64-2026.2.0.exe',
    'enso-linux-x86_64-2026.2.0.AppImage',
    'enso-mac-arm64-2026.2.0.dmg',
  ])
})

test("rc.4's download link, as published", () => {
  expect(
    downloadUrl(
      'jdunkerley/enso',
      '2026.1.1-rc.4',
      installerName(releaseTarget('linux'), '2026.1.1-rc.4'),
    ),
  ).toBe(
    'https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.4/enso-linux-x86_64-2026.1.1-rc.4.AppImage',
  )
})

test('the checksum replaces the last extension only', () => {
  expect(checksumPath('dist/ide/enso-win-x64-2026.1.1-rc.4.exe')).toBe(
    'dist/ide/enso-win-x64-2026.1.1-rc.4.sha256',
  )
  expect(checksumPath('enso-linux-x86_64-2026.1.1.AppImage')).toBe(
    'enso-linux-x86_64-2026.1.1.sha256',
  )
})

describe('splitUploaded (uploaded_manifest_leaves_out_missing_installers)', () => {
  test('a release without the dmg lists Windows and Linux, and misses macOS', () => {
    const { present, missing } = splitUploaded('2026.2.0-rc.1', [
      'enso-win-x64-2026.2.0-rc.1.exe',
      'enso-win-x64-2026.2.0-rc.1.exe.blockmap',
      'enso-linux-x86_64-2026.2.0-rc.1.AppImage',
      'latest.yml',
    ])
    expect(present.map((target) => target.os)).toEqual(['windows', 'linux'])
    expect(missing.map((target) => target.pretty)).toEqual(['macOS (Apple silicon)'])
  })
  test('the note names the missing platforms', () => {
    const { missing } = splitUploaded('2026.2.0', [])
    expect(missingInstallersNote(missing)).toBe(
      '\n\n> [!NOTE]\n> This release was published without an installer for Windows, Linux, ' +
        'macOS (Apple silicon): that build failed or was skipped. Re-running its jobs in the ' +
        'release workflow uploads it here.',
    )
  })
})

describe('updateFiles (update_files_are_the_existing_feed_and_blockmaps)', () => {
  const dist = path.join('dist', 'ide')
  test('Windows: the blockmap and latest.yml, when they exist', () => {
    const installer = path.join(dist, 'enso-win-x64-2026.2.0.exe')
    expect(updateFiles('windows', installer, dist, () => false)).toEqual([])
    const present = new Set([
      `${installer}.blockmap`,
      path.join(dist, 'latest.yml'),
      path.join(dist, 'latest-linux.yml'),
    ])
    expect(updateFiles('windows', installer, dist, (file) => present.has(file))).toEqual([
      `${installer}.blockmap`,
      path.join(dist, 'latest.yml'),
    ])
  })
  test('Linux: latest-linux.yml', () => {
    const installer = path.join(dist, 'enso-linux-x86_64-2026.2.0.AppImage')
    const present = new Set([path.join(dist, 'latest-linux.yml')])
    expect(updateFiles('linux', installer, dist, (file) => present.has(file))).toEqual([
      path.join(dist, 'latest-linux.yml'),
    ])
  })
  test('macOS: the feed, the zip and its blockmap (macos_update_files_include_the_zip)', () => {
    const installer = path.join(dist, 'enso-mac-arm64-2026.2.0.dmg')
    expect(updateFiles('macos', installer, dist, () => true)).toEqual([
      path.join(dist, 'latest-mac.yml'),
      path.join(dist, 'enso-mac-arm64-2026.2.0.zip'),
      path.join(dist, 'enso-mac-arm64-2026.2.0.zip.blockmap'),
    ])
  })
})

describe('ideUploadFiles', () => {
  const dist = path.join('dist', 'ide')
  test('the installer, its checksum, then the update files, under their own names', () => {
    const exe = path.join(dist, 'enso-win-x64-2026.1.1-rc.5.exe')
    const present = new Set([
      exe,
      path.join(dist, 'enso-win-x64-2026.1.1-rc.5.sha256'),
      `${exe}.blockmap`,
      path.join(dist, 'latest.yml'),
    ])
    expect(
      ideUploadFiles('windows', '2026.1.1-rc.5', dist, (file) => present.has(file)).map(
        (entry) => entry.name,
      ),
    ).toEqual([
      'enso-win-x64-2026.1.1-rc.5.exe',
      'enso-win-x64-2026.1.1-rc.5.sha256',
      'enso-win-x64-2026.1.1-rc.5.exe.blockmap',
      'latest.yml',
    ])
  })
  test('a missing installer or checksum is an error', () => {
    expect(() => ideUploadFiles('linux', '2026.1.1', dist, () => false)).toThrow(
      'enso-linux-x86_64-2026.1.1.AppImage does not exist',
    )
    const installer = path.join(dist, 'enso-linux-x86_64-2026.1.1.AppImage')
    expect(() => ideUploadFiles('linux', '2026.1.1', dist, (file) => file === installer)).toThrow(
      'enso-linux-x86_64-2026.1.1.sha256 does not exist',
    )
  })
})

test("content types are what rc.4's assets were uploaded with", () => {
  expect(contentType('enso-win-x64-2026.1.1-rc.4.exe')).toBe(
    'application/vnd.microsoft.portable-executable',
  )
  expect(contentType('latest-linux.yml')).toBe('text/yaml')
  expect(contentType('enso-mac-arm64-2026.1.1-rc.4.dmg')).toBe('application/octet-stream')
  expect(contentType('enso-win-x64-2026.1.1-rc.4.exe.blockmap')).toBe('application/octet-stream')
  expect(contentType('enso-linux-x86_64-2026.1.1-rc.4.sha256')).toBe('application/octet-stream')
  expect(contentType('enso-mac-arm64-2026.1.1.zip')).toBe('application/zip')
})
