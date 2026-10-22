/**
 * @file The Enso version: a port of `build_tools/build/src/version.rs`, `version/promote.rs` and
 * `version/nightly.rs`. `ENSO_VERSION` wins when it is a valid version; otherwise a build is
 * `<next stable>-dev`, where the next stable follows `latest-release` in `build-config.yaml` (or,
 * without that key, the repository's remote tags). `generateVersion` also covers the nightly, rc,
 * stable and patch designations, which Phase 4's `promote` uses.
 */
import semver from 'semver'
import { parse as parseYaml } from 'yaml'

/**
 * Strict SemVer 2.0.0, as Rust's `semver` crate parses it: no leading `v` or `=`, no surrounding
 * whitespace, no leading zeros in numeric identifiers. npm's `semver.parse` accepts `v1.2.3` and
 * padded input, so every input is checked against this first.
 */
export const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** A parsed version. `text` is the input, verbatim: npm's `SemVer.version` would drop the build. */
export interface Version {
  readonly text: string
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** The prerelease identifiers joined by `.`, or `''`. */
  readonly pre: string
  /** The build metadata identifiers joined by `.`, or `''`. */
  readonly build: string
}

/** A calendar day in UTC. */
export interface Day {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** `text` as a version, or `null` when it is not strict SemVer. */
export function parseVersion(text: string): Version | null {
  const match = STRICT_SEMVER.exec(text)
  if (match == null) return null
  return {
    text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? '',
    build: match[5] ?? '',
  }
}

/** `text` as a version; throws when it is not strict SemVer. */
export function version(text: string): Version {
  const parsed = parseVersion(text)
  if (parsed == null) throw new Error(`Not a valid version: ${text}`)
  return parsed
}

/** A version from its parts. */
export function makeVersion(
  major: number,
  minor: number,
  patch: number,
  pre = '',
  build = '',
): Version {
  return version(`${major}.${minor}.${patch}${pre ? `-${pre}` : ''}${build ? `+${build}` : ''}`)
}

/**
 * SemVer precedence, with build metadata as the final tie-break, as Rust's `Ord for Version`
 * (npm's `compareBuild`; plain `compare` ignores the build).
 */
export function compareVersions(a: Version, b: Version): number {
  return semver.compareBuild(a.text, b.text)
}

/** The greatest of `versions`, or `null` when there is none. */
export function maxVersion(versions: readonly Version[]): Version | null {
  let best: Version | null = null
  for (const candidate of versions) {
    if (best == null || compareVersions(candidate, best) > 0) best = candidate
  }
  return best
}

/** Equal major, minor and patch, ignoring the prerelease and the build. */
export function sameCore(a: Version, b: Version): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch
}

/** A build kind (`version.rs` `Kind`). */
export type Kind = 'dev' | 'nightly' | 'rc' | 'stable'

/** Whether `v` is of `kind`: a plain prefix test on the prerelease, so `rc1` is an rc too. */
export function kindMatches(kind: Kind, v: Version): boolean {
  switch (kind) {
    case 'dev':
      return v.pre.startsWith('dev')
    case 'nightly':
      return v.pre.startsWith('nightly')
    case 'rc':
      return v.pre.startsWith('rc')
    case 'stable':
      return v.pre === ''
  }
}

/** The first kind, in the order dev, nightly, rc, stable, that `v` matches. */
export function deduceKind(v: Version): Kind {
  const kinds: readonly Kind[] = ['dev', 'nightly', 'rc', 'stable']
  const kind = kinds.find((candidate) => kindMatches(candidate, v))
  if (kind == null) throw new Error(`Failed to deduce build kind for version ${v.text}`)
  return kind
}

/** `ENSO_RELEASE_MODE`: false when the prerelease contains `dev` or `SNAPSHOT`. */
export function isReleaseMode(v: Version): boolean {
  return !v.pre.includes('dev') && !v.pre.includes('SNAPSHOT')
}

/** A nightly prerelease, `nightly.<year>.<month>.<day>[.<index>]` (`version/nightly.rs`). */
export interface Nightly {
  readonly date: Day
  readonly index: number | null
}

const INTEGER = /^\d+$/
const SIGNED_INTEGER = /^-?\d+$/

/** The nightly prerelease of `v`; throws when it is not one. */
export function parseNightly(v: Version): Nightly {
  const ids = v.pre.split('.')
  if (ids[0] !== 'nightly') throw new Error('Not a nightly build.')
  if (ids.length !== 4 && ids.length !== 5) throw new Error('Wrong number of identifiers.')
  const [, year = '', month = '', day = '', index] = ids
  if (!SIGNED_INTEGER.test(year) || !INTEGER.test(month) || !INTEGER.test(day)) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`)
  }
  if (index != null && !INTEGER.test(index)) throw new Error(`Invalid nightly index: ${index}`)
  const date = { year: Number(year), month: Number(month), day: Number(day) }
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day))
  if (
    check.getUTCFullYear() !== date.year ||
    check.getUTCMonth() + 1 !== date.month ||
    check.getUTCDate() !== date.day
  ) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`)
  }
  return { date, index: index == null ? null : Number(index) }
}

/** A nightly prerelease string. The date is not zero-padded: `nightly.2021.2.3`. */
export function formatNightly(date: Day, index: number | null): string {
  const base = `nightly.${date.year}.${date.month}.${date.day}`
  return index == null ? base : `${base}.${index}`
}

/** The next nightly index on the same day: none becomes 1, 1 becomes 2. */
export function nextNightlyIndex(index: number | null): number {
  return (index ?? 0) + 1
}

/** Today in UTC. */
export function todayUtc(now: Date): Day {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() }
}

const sameDay = (a: Day, b: Day) => a.year === b.year && a.month === b.month && a.day === b.day

/** The next rc after `v`, `rc.<n>` becoming `rc.<n+1>` (the core and build kept). */
export function incrementRc(v: Version): Version {
  if (!kindMatches('rc', v)) throw new Error(`Version is not an RC version: ${v.text}.`)
  const parts = v.pre.split('.')
  if (parts.length !== 2 || parts[0] !== 'rc') {
    throw new Error(`RC version has an unexpected prerelease: ${v.text}.`)
  }
  const index = parts[1] ?? ''
  if (!INTEGER.test(index) || Number(index) > 0xffffffff) throw new Error('Parsing RC index.')
  return makeVersion(v.major, v.minor, v.patch, `rc.${Number(index) + 1}`, v.build)
}

/** What `promote` (Phase 4) asks for; a dev build uses `stable` and appends `-dev`. */
export type Designation = 'stable' | 'patch' | 'rc' | 'nightly'

/**
 * The next version of `designation`, given the existing `versions` and `today` (`Releases` in
 * `version/promote.rs`). A new stable is `<year>.<minor + 1>.1`, or `<year>.1.1` in a new year.
 */
export function generateVersion(
  designation: Designation,
  versions: readonly Version[],
  today: Day,
): Version {
  for (const v of versions) {
    if (v.major > today.year) throw new Error(`Found version from the future: ${v.text}.`)
  }
  const latestStable = maxVersion(versions.filter((v) => kindMatches('stable', v)))
  const nextStable =
    latestStable != null && latestStable.major === today.year ?
      makeVersion(today.year, latestStable.minor + 1, 1)
    : makeVersion(today.year, 1, 1)
  switch (designation) {
    case 'stable':
      return nextStable
    case 'patch': {
      if (latestStable == null) {
        throw new Error(
          'No stable releases found. There must be some stable release before creating a patch release.',
        )
      }
      return makeVersion(latestStable.major, latestStable.minor, latestStable.patch + 1)
    }
    case 'rc': {
      const lastRc = maxVersion(
        versions.filter((v) => kindMatches('rc', v) && sameCore(v, nextStable)),
      )
      return lastRc != null ?
          incrementRc(lastRc)
        : makeVersion(nextStable.major, nextStable.minor, nextStable.patch, 'rc.1')
    }
    case 'nightly': {
      const todays = versions.filter((v) => {
        if (!kindMatches('nightly', v) || !sameCore(v, nextStable)) return false
        try {
          return sameDay(parseNightly(v).date, today)
        } catch {
          return false
        }
      })
      const last = maxVersion(todays)
      if (last == null) {
        return makeVersion(
          nextStable.major,
          nextStable.minor,
          nextStable.patch,
          formatNightly(today, null),
        )
      }
      const index = nextNightlyIndex(parseNightly(last).index)
      return makeVersion(
        last.major,
        last.minor,
        last.patch,
        formatNightly(today, index),
        last.build,
      )
    }
  }
}

/** The published triple. `ENSO_EDITION` always equals the version. */
export interface Versions {
  readonly version: Version
  readonly releaseMode: boolean
}

/** What `deduceOrGenerate` reads. `releases` is called only when no `ENSO_VERSION` applies. */
export interface VersionInputs {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly releases: () => readonly Version[]
  readonly today: Day
}

/**
 * `version::deduce_or_generate`. A valid `ENSO_VERSION` wins; an empty or invalid one is ignored,
 * silently, as `./run` did. When it wins, a set `ENSO_EDITION` (even an empty one) must equal it.
 * `ENSO_RELEASE_MODE` is never read: it follows from the version.
 */
export function deduceOrGenerate(inputs: VersionInputs): Versions {
  const fromEnv = parseVersion(inputs.env.ENSO_VERSION ?? '')
  if (fromEnv != null) {
    const edition = inputs.env.ENSO_EDITION
    if (edition !== undefined && edition !== fromEnv.text) {
      throw new Error('Inconsistent ENSO_VERSION and ENSO_EDITION variable values.')
    }
    return { version: fromEnv, releaseMode: isReleaseMode(fromEnv) }
  }
  const next = generateVersion('stable', inputs.releases(), inputs.today)
  return { version: makeVersion(next.major, next.minor, next.patch, 'dev'), releaseMode: false }
}

/**
 * `latest-release` from `build-config.yaml`, or `null` when the key is absent. An invalid value is
 * an error, as it failed `./run`'s whole configuration load.
 */
export function latestReleaseFromConfig(configText: string): Version | null {
  const config: unknown = parseYaml(configText)
  const value =
    config != null && typeof config === 'object' ?
      (config as Record<string, unknown>)['latest-release']
    : undefined
  if (value == null) return null
  const parsed = parseVersion(String(value))
  if (parsed == null) {
    throw new Error(`build-config.yaml: \`latest-release\` is not a version: ${String(value)}`)
  }
  return parsed
}

/**
 * The versions among the tags that `git ls-remote --tags origin` printed. A tag that is not strict
 * SemVer is skipped; a line that is not `<hash> <ref>` fails, as in `./run`.
 */
export function parseLsRemoteTags(stdout: string): Version[] {
  const found = new Map<string, Version>()
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.trim().split(/\s+/)
    const ref = parts[1]
    if (parts.length !== 2 || ref == null)
      throw new Error(`Unexpected \`git ls-remote\` line: ${line}`)
    if (ref.startsWith('refs/tags/')) {
      const name = ref.slice('refs/tags/'.length).replace(/\^\{\}$/, '')
      const parsed = parseVersion(name)
      if (parsed != null) found.set(parsed.text, parsed)
    } else if (!(
      ref === 'HEAD' ||
      ref.startsWith('refs/heads/') ||
      ref.startsWith('refs/remotes/')
    )) {
      throw new Error(`Unknown ref name: ${ref}`)
    }
  }
  return [...found.values()]
}
