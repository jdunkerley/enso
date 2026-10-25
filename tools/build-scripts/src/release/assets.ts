/**
 * @file The release's installers and the files that go with them: a port of the retired build CLI's
 * `manifest.rs` and of `project/ide.rs`' `electron_image_filename` and `Artifact::update_files`.
 * One deliberate difference: there is no `assets.json`. Only upstream's website read it; nothing in
 * this repository does.
 */
import path from 'node:path'
import type { TargetOs } from '../ide-build/ideBuild.ts'

/** A platform a release ships an installer for. */
export interface ReleaseTarget {
  readonly os: TargetOs
  /** The architecture as electron-builder spells it in the file name. */
  readonly arch: 'x64' | 'x86_64' | 'arm64'
  /** How the release notes name the platform. */
  readonly pretty: string
}

/**
 * The installers a release ships, in the order the notes list them. `release.yml` builds one for
 * each; keep the two in step.
 */
export const RELEASE_TARGETS: readonly ReleaseTarget[] = [
  { os: 'windows', arch: 'x64', pretty: 'Windows' },
  { os: 'linux', arch: 'x86_64', pretty: 'Linux' },
  { os: 'macos', arch: 'arm64', pretty: 'macOS (Apple silicon)' },
]

/** The release target for `os`. */
export function releaseTarget(os: TargetOs): ReleaseTarget {
  const target = RELEASE_TARGETS.find((candidate) => candidate.os === os)
  if (target == null) throw new Error(`No release target for ${os}.`)
  return target
}

/** The installer electron-builder writes for `target` (`artifactName` in its configuration). */
export function installerName(target: ReleaseTarget, version: string): string {
  switch (target.os) {
    case 'linux':
      return `enso-linux-${target.arch}-${version}.AppImage`
    case 'macos':
      return `enso-mac-${target.arch}-${version}.dmg`
    case 'windows':
      return `enso-win-${target.arch}-${version}.exe`
  }
}

/** The public download URL of a release asset. */
export function downloadUrl(repository: string, tag: string, name: string): string {
  return `https://github.com/${repository}/releases/download/${tag}/${name}`
}

/** `file` with its last extension replaced by `.sha256`, as `computeHashes` names the checksum. */
export function checksumPath(file: string): string {
  const extension = path.extname(file)
  return `${file.slice(0, file.length - extension.length)}.sha256`
}

/**
 * The installers named in `uploaded`, and the targets whose installer is not there. The macOS jobs
 * do not block publishing, so a release can go out without its `.dmg`.
 */
export function splitUploaded(
  version: string,
  uploaded: readonly string[],
): { readonly present: ReleaseTarget[]; readonly missing: ReleaseTarget[] } {
  const present: ReleaseTarget[] = []
  const missing: ReleaseTarget[] = []
  for (const target of RELEASE_TARGETS) {
    if (uploaded.includes(installerName(target, version))) present.push(target)
    else missing.push(target)
  }
  return { present, missing }
}

/** The note `publish` appends to the body when installers are missing. */
export function missingInstallersNote(missing: readonly ReleaseTarget[]): string {
  const platforms = missing.map((target) => target.pretty).join(', ')
  return (
    `\n\n> [!NOTE]\n> This release was published without an installer for ${platforms}: that ` +
    'build failed or was skipped. Re-running its jobs in the release workflow uploads it here.'
  )
}

/**
 * What `electron-updater` needs next to the installer: the feed and the blockmaps, and on macOS
 * the zip it updates from. Release builds write them (`ENSO_BUILD_UPDATE_INFO`, and a signed
 * macOS build for the zip); those that do not exist are left out.
 */
export function updateFiles(
  os: TargetOs,
  installer: string,
  distDir: string,
  exists: (file: string) => boolean,
): string[] {
  const candidates =
    os === 'windows' ? [`${installer}.blockmap`, path.join(distDir, 'latest.yml')]
    : os === 'linux' ? [`${installer}.blockmap`, path.join(distDir, 'latest-linux.yml')]
    : [
        path.join(distDir, 'latest-mac.yml'),
        `${installer.slice(0, -'.dmg'.length)}.zip`,
        `${installer.slice(0, -'.dmg'.length)}.zip.blockmap`,
      ]
  return candidates.filter(exists)
}

/** One file to upload, and the asset name it gets. */
export interface UploadFile {
  readonly file: string
  readonly name: string
}

/**
 * Everything `upload-ide` uploads from `distDir` for `os`: the installer, its `.sha256`, then the
 * update files. The installer and the checksum must exist.
 */
export function ideUploadFiles(
  os: TargetOs,
  version: string,
  distDir: string,
  exists: (file: string) => boolean,
): UploadFile[] {
  const installer = path.join(distDir, installerName(releaseTarget(os), version))
  const checksum = checksumPath(installer)
  for (const required of [installer, checksum]) {
    if (!exists(required)) throw new Error(`${required} does not exist: was the IDE packaged?`)
  }
  return [installer, checksum, ...updateFiles(os, installer, distDir, exists)].map((file) => ({
    file,
    name: path.basename(file),
  }))
}

/**
 * The content type an asset is uploaded with, as the retired build CLI guessed it from the
 * extension.
 */
export function contentType(name: string): string {
  const extension = path.extname(name).toLowerCase()
  switch (extension) {
    case '.exe':
      return 'application/vnd.microsoft.portable-executable'
    case '.yml':
    case '.yaml':
      return 'text/yaml'
    case '.json':
      return 'application/json'
    case '.zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}
