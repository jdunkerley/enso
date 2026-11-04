/** @file Utilities getting various metadata about the app. */
import * as common from 'enso-common/src/constants'
import * as detect from 'enso-common/src/utilities/detect'
import gt from 'semver/functions/gt'
import parse from 'semver/functions/parse'

const ONE_HOUR_MS = 3_600_000
const HTTP_NOT_FOUND = 404

/**
 * The GitHub repository whose releases the app checks for updates and downloads: this fork's, not
 * upstream `enso-org/enso`. The fork diverges from upstream, so an upstream release is not an update
 * of this build; #180 decided this.
 */
export const RELEASES_REPOSITORY = 'jdunkerley/enso'
export const LATEST_RELEASE_PAGE_URL = `https://github.com/${RELEASES_REPOSITORY}/releases/latest`
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`
// Includes prereleases, which `/releases/latest` never does. The newest 30 are plenty.
const RELEASES_API_URL = `https://api.github.com/repos/${RELEASES_REPOSITORY}/releases?per_page=30`

/** Metadata for a GitHub user. */
interface GitHubSimpleUser {
  readonly name?: string
  readonly email?: string
  readonly login: string
  readonly id: number
  readonly node_id: string
  readonly avatar_url: string
  readonly gravatar_id?: string
  readonly url: string
  readonly html_url: string
  readonly followers_url: string
  readonly following_url: string
  readonly gists_url: string
  readonly starred_url: string
  readonly subscriptions_url: string
  readonly organizations_url: string
  readonly repos_url: string
  readonly events_url: string
  readonly received_events_url: string
  readonly type: string
  readonly site_admin: boolean
  readonly starred_at: string
}

/** State of an asset attached to a GitHub release. */
export enum GitHubReleaseAssetState {
  uploaded = 'uploaded',
  open = 'open',
}

/** Metadata for an asset attached to a GitHub release. */
interface GitHubReleaseAsset {
  readonly url: string
  readonly browser_download_url: string
  readonly id: number
  readonly node_id: string
  readonly name: string
  readonly label?: string
  readonly state: GitHubReleaseAssetState
  readonly content_type: string
  readonly size: number
  readonly download_count: number
  readonly created_at: string
  readonly updated_at: string
  readonly uploader?: GitHubSimpleUser
}

/** Metadata for a GitHub release. */
interface GitHubRelease {
  readonly url: string
  readonly assets_url: string
  readonly upload_url: string
  readonly html_url: string
  readonly tarball_url?: string
  readonly zipball_url?: string
  readonly id: number
  readonly author: GitHubSimpleUser
  readonly node_id: string
  /** The name of the tag. */
  readonly tag_name: string
  /** Specifies the commitish value that determines where the Git tag is created from. */
  readonly target_commitish: string
  readonly name?: string
  readonly body?: string
  /** `true` to create a draft (unpublished) release, `false` to create a published one. */
  readonly draft: boolean
  /** Whether to identify the release as a prerelease or a full release. */
  readonly prerelease: boolean
  readonly created_at: string
  readonly published_at: string
  readonly assets: GitHubReleaseAsset[]
}

/** Metadata for a GitHub release (`null`: there is none), plus metadata for caching purposes. */
interface CachedRelease {
  readonly lastFetchEpochMs: number
  readonly gitHubRelease: GitHubRelease | null
}

// Keyed on the repository, so that a release cached from another one is never taken for its own.
const LOCAL_STORAGE_KEY = `${common.PRODUCT_NAME.toLowerCase()}-cached-release-${RELEASES_REPOSITORY}`
// The newest release including prereleases is another answer, so it is cached apart.
const PRERELEASES_LOCAL_STORAGE_KEY = `${LOCAL_STORAGE_KEY}-with-prereleases`

function storageKey(includePrereleases: boolean) {
  return includePrereleases ? PRERELEASES_LOCAL_STORAGE_KEY : LOCAL_STORAGE_KEY
}

/** Whether a parsed response body looks like a release: enough of one for its callers. */
function isRelease(data: unknown): data is GitHubRelease {
  return (
    typeof data === 'object' &&
    data != null &&
    'tag_name' in data &&
    typeof data.tag_name === 'string' &&
    'assets' in data &&
    Array.isArray(data.assets)
  )
}

/** The cached latest release, if it was fetched less than an hour ago. */
function readCache(includePrereleases: boolean): CachedRelease | null {
  try {
    const saved = localStorage.getItem(storageKey(includePrereleases))
    const cached: unknown = saved != null ? JSON.parse(saved) : null
    if (
      typeof cached === 'object' &&
      cached != null &&
      'lastFetchEpochMs' in cached &&
      typeof cached.lastFetchEpochMs === 'number' &&
      'gitHubRelease' in cached &&
      (cached.gitHubRelease === null || isRelease(cached.gitHubRelease)) &&
      Number(new Date()) - cached.lastFetchEpochMs < ONE_HOUR_MS
    ) {
      return { lastFetchEpochMs: cached.lastFetchEpochMs, gitHubRelease: cached.gitHubRelease }
    }
  } catch {
    // An unreadable cache is a cache miss.
  }
  return null
}

function writeCache(gitHubRelease: GitHubRelease | null, includePrereleases: boolean) {
  try {
    localStorage.setItem(
      storageKey(includePrereleases),
      JSON.stringify({
        lastFetchEpochMs: Number(new Date()),
        gitHubRelease,
      } satisfies CachedRelease),
    )
  } catch {
    // Not caching only costs another request.
  }
}

/** The latest release could not be fetched: offline, rate-limited, or an unexpected answer. */
export class ReleaseCheckError extends Error {}

/**
 * The release with the greatest semantic version among `releases`, ignoring drafts and tags that
 * are not versions; `null` when there is none. (GitHub lists by creation date, which is not
 * version order: an rc of the next release can be older than a patch of this one.)
 */
export function newestRelease(releases: readonly GitHubRelease[]): GitHubRelease | null {
  let newest: { release: GitHubRelease; version: NonNullable<ReturnType<typeof parse>> } | null =
    null
  for (const release of releases) {
    const version = release.draft ? null : parse(release.tag_name)
    if (version != null && (newest == null || gt(version, newest.version)))
      newest = { release, version }
  }
  return newest?.release ?? null
}

/**
 * Gets the metadata for the latest release of the app, or `null` when the repository has none
 * (GitHub answers 404; this fork has no release yet). With `includePrereleases` it is the newest
 * release by semantic version, a prerelease or not (`/releases/latest` never answers a
 * prerelease); otherwise the latest stable release.
 *
 * This is a background check, so it logs nothing either way. "No release" is cached like a
 * release, for an hour. A failed request (offline, rate-limited with 403 or 429, an unexpected
 * body) is not cached: it throws a {@link ReleaseCheckError}, for the caller to try again on its
 * own schedule.
 */
export async function getLatestRelease(includePrereleases = false): Promise<GitHubRelease | null> {
  const cached = readCache(includePrereleases)
  if (cached != null) return cached.gitHubRelease
  const response = await fetch(includePrereleases ? RELEASES_API_URL : LATEST_RELEASE_API_URL, {
    headers: [
      ['Accept', 'application/vnd.github+json'],
      ['X-GitHub-Api-Version', '2022-11-28'],
    ],
  }).catch((error: unknown) => {
    throw new ReleaseCheckError('The request failed.', { cause: error })
  })
  if (response.status === HTTP_NOT_FOUND) {
    writeCache(null, includePrereleases)
    return null
  }
  if (!response.ok) {
    throw new ReleaseCheckError(`HTTP ${response.status}`)
  }
  const data: unknown = await response.json().catch(() => null)
  if (includePrereleases) {
    if (!Array.isArray(data) || !data.every(isRelease))
      throw new ReleaseCheckError('Unexpected response.')
    const newest = newestRelease(data)
    writeCache(newest, includePrereleases)
    return newest
  }
  if (!isRelease(data)) {
    throw new ReleaseCheckError('Unexpected response.')
  }
  writeCache(data, includePrereleases)
  return data
}

const appExtension = (() => {
  switch (detect.platform()) {
    case detect.Platform.macOS:
      return '.dmg'
    case detect.Platform.windows:
      return '.exe'
    case detect.Platform.unknown:
    case detect.Platform.linux:
    case detect.Platform.windowsPhone:
    case detect.Platform.iPhoneOS:
    case detect.Platform.android:
    default:
      // assume Unix-like.
      return '.AppImage'
  }
})()

/** Gets the download URL of the latest release of the app, or `null` when there is none to be had. */
export async function getDownloadUrl(includePrereleases = false) {
  const assets = (await getLatestRelease(includePrereleases).catch(() => null))?.assets ?? []
  return (
    assets.find((item) => item.browser_download_url.endsWith(appExtension))?.browser_download_url ??
    null
  )
}
