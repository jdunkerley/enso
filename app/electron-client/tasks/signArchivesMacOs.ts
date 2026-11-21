/**
 * @file Signs the macOS binaries that sit inside the engine's archives (jars and zips).
 *
 * electron-builder signs every loose binary in the app bundle, but not the ones packed inside an
 * archive, and notarization rejects an app whose archives hold an unsigned Mach-O file. This runs
 * from the `afterSign` hook: it finds those files, signs them, writes them back into their archives,
 * and then re-signs the app so its seal covers the changed archives.
 *
 * Note [Signing Inside Archives]
 * ==============================
 * The archives are found, not listed: every `.jar` and `.zip` under `Contents/Resources/enso` is
 * listed with `unzip -Z1`, and an entry is a candidate when its name looks like a native library
 * (`.dylib`, `.jnilib`, `.so`) or an executable in a `bin/` directory. Candidates are extracted and
 * kept only when their first bytes are a Mach-O header, so the Linux and Windows natives that the
 * same jars carry are left alone. A hand-written list went stale: by 2026-11 most of its entries
 * matched nothing (the bundled JDK is a jlinked runtime with no `jmods`, and the libraries' natives
 * moved out of their jars into `polyglot/lib`). The whole scan takes a few seconds.
 *
 * The signed files are written back with `zip`, which replaces just those entries and keeps the
 * rest of the archive (the manifest included) as it was, so no `jar` tool or JDK is needed. `zip`,
 * `unzip` and `codesign` ship with macOS.
 */

import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as pathModule from 'node:path'

import glob from 'fast-glob'

/** Archive entry names that may be a native binary. */
const CANDIDATE_ENTRY = /\.(dylib|jnilib|so)$|(^|\/)bin\/[^/.]+$/

/** The magic numbers of thin Mach-O files, both byte orders, 32 and 64 bit. */
const THIN_MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe])
/** The magic number of a fat (universal) Mach-O file; Java class files share it. */
const FAT_MACHO_MAGIC = 0xcafebabe

/** Run a program and return its standard output. */
export function run(cmd: string, args: string[], cwd?: string) {
  console.log('Running', cmd, args, cwd ?? '')
  return childProcess.execFileSync(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }).toString()
}

/** Whether the file at `path` starts with a Mach-O header. */
async function isMachO(path: string): Promise<boolean> {
  const file = await fs.open(path, 'r')
  try {
    const head = Buffer.alloc(8)
    const { bytesRead } = await file.read(head, 0, 8, 0)
    if (bytesRead < 8) return false
    const magic = head.readUInt32BE(0)
    if (THIN_MACHO_MAGICS.has(magic)) return true
    // A fat binary's second word is its (small) architecture count; a class file's is its
    // version, 45 or more.
    return magic === FAT_MACHO_MAGIC && head.readUInt32BE(4) < 20
  } finally {
    await file.close()
  }
}

/** What `codesign` needs to sign a binary. */
interface SigningContext {
  /** The signing identity: a name or SHA-1 hash on the keychain search list. */
  readonly identity: string
  /** Path to the entitlements file. */
  readonly entitlements: string
}

/** Sign one file or bundle for notarization: hardened runtime and a secure timestamp. */
function codesign(target: string, { identity, entitlements }: SigningContext) {
  run('codesign', [
    '--force',
    '--options=runtime',
    '--timestamp',
    '--entitlements',
    entitlements,
    '--sign',
    identity,
    target,
  ])
}

/**
 * Sign the Mach-O files inside `archive` and write them back into it. Returns the names of the
 * entries it signed.
 */
async function signInsideArchive(archive: string, context: SigningContext): Promise<string[]> {
  const candidates = run('unzip', ['-Z1', archive])
    .split('\n')
    .filter((entry) => CANDIDATE_ENTRY.test(entry))
  if (candidates.length === 0) return []

  const workingDir = await fs.mkdtemp(pathModule.join(os.tmpdir(), 'enso-signing-'))
  try {
    run('unzip', ['-q', '-o', archive, ...candidates, '-d', workingDir])
    const signed: string[] = []
    for (const entry of candidates) {
      const extracted = pathModule.join(workingDir, entry)
      if (!(await isMachO(extracted))) continue
      codesign(extracted, context)
      signed.push(entry)
    }
    if (signed.length > 0) {
      // `zip` replaces the named entries and leaves the rest of the archive untouched.
      run('zip', ['-q', '-X', archive, ...signed], workingDir)
    }
    return signed
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true })
  }
}

/** Input of {@link signArchives}. */
interface Input extends SigningContext {
  readonly appOutDir: string
  readonly productFilename: string
}

/**
 * Sign the binaries inside the engine's archives (Note [Signing Inside Archives]), then re-sign
 * the app. Meant to be called from electron-builder's `afterSign` hook, before notarization.
 */
export async function signArchives(context: Input) {
  const appDir = pathModule.join(context.appOutDir, `${context.productFilename}.app`)
  const ensoDir = pathModule.join(appDir, 'Contents', 'Resources', 'enso')
  const archives = await glob('**/*.{jar,zip}', { cwd: ensoDir, absolute: true })
  console.log(`Looking for binaries inside ${archives.length} archives under ${ensoDir}.`)

  let signedCount = 0
  for (const archive of archives) {
    const signed = await signInsideArchive(archive, context)
    for (const entry of signed)
      console.log(`  Signed ${pathModule.relative(ensoDir, archive)}!${entry}`)
    signedCount += signed.length
  }
  console.log(`Signed ${signedCount} binaries inside archives.`)

  // The archives changed after electron-builder sealed the app, so seal it again. Nested code
  // keeps its own signatures; only the app's resource seal and main executable are redone.
  codesign(appDir, context)
}
