/**
 * @file Finding the engine package that `sbt buildEngineDistribution` built (or that a CI job
 * downloaded): `built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`, the path
 * sbt's `engineDistributionRoot` and `./run`'s `paths.yaml` both name.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** The OS part of the artifact name, as `DistributionPackage.OS` spells it. */
export function osName(platform: NodeJS.Platform): 'linux' | 'windows' | 'macos' {
  switch (platform) {
    case 'linux':
      return 'linux'
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macos'
    default:
      throw new Error(`No engine package is built for ${platform}.`)
  }
}

/** The architecture part of the artifact name, as `DistributionPackage.Architecture` spells it. */
export function archName(arch: string): 'amd64' | 'aarch64' {
  if (arch === 'x64') return 'amd64'
  if (arch === 'arm64') return 'aarch64'
  throw new Error(`No engine package is built for ${arch}.`)
}

/** The engine package directory for `version` on this platform. */
export function enginePackageDir(
  repoRoot: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  const triple = `${version}-${osName(platform)}-${archName(arch)}`
  return path.join(repoRoot, 'built-distribution', `enso-engine-${triple}`, `enso-${version}`)
}

/** An engine package: its directory and the version it was built at. */
export interface EnginePackage {
  readonly dir: string
  readonly version: string
}

/**
 * The engine package to use. With `version` (a job takes it from the build job's outputs, as the
 * Enso lint does) it is that version's directory, which must exist. Without, the only package
 * under `built-distribution/`; none or several is an error.
 */
export function findEnginePackage(
  repoRoot: string,
  version: string | undefined,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): EnginePackage {
  if (version != null && version !== '') {
    const dir = enginePackageDir(repoRoot, version, platform, arch)
    if (!existsSync(dir)) throw new Error(`No engine package at ${dir}.`)
    return { dir, version }
  }
  const root = path.join(repoRoot, 'built-distribution')
  const found: EnginePackage[] = []
  if (existsSync(root)) {
    for (const artifact of readdirSync(root)) {
      if (!artifact.startsWith('enso-engine-')) continue
      const artifactDir = path.join(root, artifact)
      for (const child of readdirSync(artifactDir)) {
        const childVersion = child.match(/^enso-(.+)$/)?.[1]
        if (childVersion != null && artifact.startsWith(`enso-engine-${childVersion}-`)) {
          found.push({ dir: path.join(artifactDir, child), version: childVersion })
        }
      }
    }
  }
  if (found.length !== 1) {
    const list = found.map((entry) => entry.dir).join(', ') || 'none'
    throw new Error(
      `Expected exactly one engine package under ${root}, found ${list}. Set ENSO_VERSION to choose.`,
    )
  }
  return found[0] as EnginePackage
}

/** The `enso` launcher of an engine package. */
export function ensoBinary(packageDir: string, platform: NodeJS.Platform): string {
  return path.join(packageDir, 'bin', platform === 'win32' ? 'enso.exe' : 'enso')
}
