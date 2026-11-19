/**
 * @file Where a packaged IDE's engine launcher is, relative to its Electron binary, and where the
 * IDE built by `ide-local` is. Unlike `packagedIde.ts` it finds nothing when it is imported, so a
 * tool given `--exe` (or only printing a command line) works without a built `dist/ide/`.
 */
import fs from 'node:fs'
import path from 'node:path'

export const POSSIBLE_ELECTRON_PATHS = [
  '../../../dist/ide/linux-unpacked/enso',
  '../../../dist/ide/win-unpacked/Enso.exe',
  '../../../dist/ide/mac/Enso.app/Contents/MacOS/Enso',
  '../../../dist/ide/mac-arm64/Enso.app/Contents/MacOS/Enso',
]

/** The packaged binary under `dist/ide/`, or `undefined` when none was built. */
export async function findBuiltElectronExecutable(): Promise<string | undefined> {
  for (const candidate of POSSIBLE_ELECTRON_PATHS) {
    const full = path.resolve(import.meta.dirname, candidate)
    try {
      await fs.promises.access(full, fs.constants.X_OK)
      return full
    } catch {
      // Not this platform's.
    }
  }
  return undefined
}

/** Locate the packaged engine launcher next to the Electron binary. */
export function launcherOf(executable: string): string | undefined {
  const unpackedDir = path.dirname(executable)
  const launcherNames = process.platform === 'win32' ? ['enso.bat', 'enso.exe'] : ['enso']
  for (const resources of ['resources', 'Resources']) {
    const binParent = path.join(unpackedDir, resources, 'enso', 'dist')
    let versions: string[]
    try {
      versions = fs.readdirSync(binParent)
    } catch {
      continue
    }
    for (const version of versions) {
      for (const name of launcherNames) {
        const candidate = path.join(binParent, version, 'bin', name)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  return undefined
}
