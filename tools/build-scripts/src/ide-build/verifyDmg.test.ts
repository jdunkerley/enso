/** @file Which files the dmg check looks at. */
import { expect, test } from 'vitest'
import { appNames, dmgNames } from './verifyDmg.ts'

test('only dmgs in dist/ide are checked', () => {
  const names = [
    'enso-mac-arm64-2026.1.1.dmg',
    'enso-mac-arm64-2026.1.1.sha256',
    'enso-mac-arm64-2026.1.1.zip',
    'mac-arm64',
    'electron-builder-config.yaml',
  ]
  expect(dmgNames(names)).toEqual(['enso-mac-arm64-2026.1.1.dmg'])
})

test('only apps at the dmg root are checked, not the Applications link', () => {
  expect(appNames(['Applications', '.background', 'Enso.app', '.DS_Store'])).toEqual(['Enso.app'])
})
