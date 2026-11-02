/**
 * @file Checking a macOS installer after packaging: the app inside each dmg must pass a deep
 * signature check. `dmgbuild` drops files without failing when the image is too small, and a
 * missing file breaks the signature's seal (`code object is not signed at all`), so a truncated
 * image fails here instead of shipping.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { capture } from '../lib/repo.ts'

/** The dmgs among the file names of `dist/ide`. */
export function dmgNames(names: readonly string[]): string[] {
  return names.filter((name) => name.endsWith('.dmg')).sort()
}

/** The apps among the file names at a mounted dmg's root. */
export function appNames(names: readonly string[]): string[] {
  return names.filter((name) => name.endsWith('.app')).sort()
}

/** Runs a program, throwing with its output when it fails. */
function check(program: string, args: readonly string[]): void {
  const result = capture(program, args)
  if (result.status !== 0) {
    throw new Error(
      `\`${program} ${args.join(' ')}\` failed (exit ${result.status}):\n${result.stderr}${result.stdout}`,
    )
  }
}

/** Mounts `dmg` read-only, checks every app at its root with `codesign`, and unmounts it. */
function verifyDmg(dmg: string): void {
  const mountPoint = mkdtempSync(path.join(tmpdir(), 'enso-dmg-'))
  check('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])
  try {
    const apps = appNames(readdirSync(mountPoint))
    if (apps.length === 0) throw new Error(`${dmg} holds no app.`)
    for (const app of apps) {
      check('codesign', ['--verify', '--deep', '--strict', path.join(mountPoint, app)])
      console.log(`Verified ${app} in ${path.basename(dmg)}.`)
    }
  } finally {
    check('hdiutil', ['detach', mountPoint])
    rmSync(mountPoint, { recursive: true, force: true })
  }
}

/** Checks every dmg in `ideDir`; throws when there is none, or when one fails. */
export function verifyDmgs(ideDir: string): void {
  const dmgs = dmgNames(readdirSync(ideDir))
  if (dmgs.length === 0) throw new Error(`${ideDir} holds no dmg.`)
  for (const dmg of dmgs) verifyDmg(path.join(ideDir, dmg))
}
