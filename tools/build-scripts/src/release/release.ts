/**
 * @file The release operations: a port of the retired build CLI's `release.rs`
 * (`draft_a_new_release`, `publish_release`, `validate_release`, `update_latest_release_version`,
 * `resolve_version_designation`) and of the retired build CLI's `ide upload`'s upload half (the
 * retired build CLI's `lib.rs` `upload_ide_assets`). Deliberate differences, each named where it
 * happens: the release version must be given (no silent `-dev` fallback), no `assets.json`, the
 * draft is edited and published in one call, a draft with a half-written asset is not published,
 * and an upload replaces same-named assets on a draft but never touches a published release's.
 */
/* eslint-disable camelcase -- GitHub's REST API names its fields in snake_case. */
import { retryDelays } from '../ide-build/ideBuild.ts'
import type { GitHub, Release, ReleaseAsset } from '../lib/githubApi.ts'
import { deduceKind, parseVersion, type Designation, type Version } from '../version/version.ts'
import {
  contentType,
  downloadUrl,
  installerName,
  missingInstallersNote,
  splitUploaded,
  type ReleaseTarget,
  type UploadFile,
} from './assets.ts'
import { prettyName, releaseBody } from './notes.ts'

/**
 * The version a release command works on: `ENSO_VERSION`, which the release workflow sets from its
 * input. Unlike `version`, an empty or invalid value is an error (Phase 3's R4 left that footgun to
 * this phase): a typo must not produce a `-dev` release. A set `ENSO_EDITION` must equal it.
 */
export function releaseVersion(env: Readonly<Record<string, string | undefined>>): Version {
  const text = env.ENSO_VERSION ?? ''
  const parsed = parseVersion(text)
  if (parsed == null) throw new Error(`ENSO_VERSION is not a version: ${JSON.stringify(text)}.`)
  if (env.ENSO_EDITION !== undefined && env.ENSO_EDITION !== parsed.text) {
    throw new Error('Inconsistent ENSO_VERSION and ENSO_EDITION variable values.')
  }
  return parsed
}

/** `ENSO_RELEASE_ID`, the draft `create-draft` made. */
export function releaseId(env: Readonly<Record<string, string | undefined>>): number {
  const text = env.ENSO_RELEASE_ID ?? ''
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`ENSO_RELEASE_ID is not a release id: ${JSON.stringify(text)}.`)
  }
  return Number(text)
}

const DESIGNATIONS: readonly Designation[] = ['stable', 'patch', 'rc', 'nightly']

/** `promote`'s argument. */
export function parseDesignation(text: string | undefined): Designation {
  const found = DESIGNATIONS.find((designation) => designation === text)
  if (found == null) {
    throw new Error(
      `Unknown designation ${JSON.stringify(text)}; expected one of ${DESIGNATIONS.join(', ')}.`,
    )
  }
  return found
}

/** Whether `version` is a prerelease (nightly, rc or dev): GitHub marks it so. */
export function isPrerelease(version: Version): boolean {
  return deduceKind(version) !== 'stable'
}

/** What `createDraft` needs besides GitHub. */
export interface DraftInputs {
  readonly version: Version
  /** The commit to tag (`GITHUB_SHA`). */
  readonly commit: string
  /** The checkout's `HEAD`, or `null` outside a git checkout. */
  readonly head: string | null
  /** The text of `CHANGELOG.md`. */
  readonly changelog: string
  readonly log: (line: string) => void
}

/**
 * Creates the draft release for `inputs.version` at `inputs.commit`. Refuses when the checkout is
 * at another commit, when a release of that tag is already published, or when the tag exists.
 */
export async function createDraft(api: GitHub, inputs: DraftInputs): Promise<Release> {
  const tag = inputs.version.text
  if (inputs.head != null && inputs.head !== inputs.commit) {
    throw new Error(
      `Local HEAD ${inputs.head} is not the same as the commit ${inputs.commit} we were ordered to build.`,
    )
  }
  const repo = `/repos/${api.repository}`
  // `releases/tags/<tag>` finds published releases only, so a hit is always a published one.
  const colliding = await api.json<Release>('GET', `${repo}/releases/tags/${tag}`)
  if (colliding != null) {
    if (!colliding.draft) throw new Error(`Release ${tag} has already been published.`)
    inputs.log(
      `Release ${tag} has already been drafted: ${colliding.html_url}. Creating a new one.`,
    )
  }
  const ref = await api.json<{ object: unknown }>('GET', `${repo}/git/ref/tags/${tag}`)
  if (ref != null) {
    throw new Error(`Tag ${tag} already exists on remote as ${JSON.stringify(ref.object)}.`)
  }
  const release = await api.json<Release>('POST', `${repo}/releases`, {
    tag_name: tag,
    target_commitish: inputs.commit,
    name: prettyName(tag),
    body: releaseBody(api.repository, tag, inputs.changelog),
    prerelease: isPrerelease(inputs.version),
    draft: true,
  })
  if (release == null) throw new Error(`Creating the draft release ${tag} returned nothing.`)
  inputs.log(`Drafted ${release.name ?? tag} (id ${release.id}): ${release.html_url}`)
  return release
}

/** Release `id`; an error when it does not exist. */
async function getRelease(api: GitHub, id: number): Promise<Release> {
  const release = await api.json<Release>('GET', `/repos/${api.repository}/releases/${id}`)
  if (release == null) throw new Error(`Release ${id} does not exist.`)
  return release
}

/**
 * Publishes the draft `id`, which must be release `version` (its tag) and hold only fully
 * uploaded assets: a `starter` asset is an upload that died part-way, and would be published
 * broken. Installers that were not uploaded (a skipped or failed macOS build) are named in a note
 * appended to the body. The tag and target are restated in the same call: editing a draft
 * without them turns it into `untagged-…`, and it would publish without a tag. Then checks that
 * every uploaded installer downloads. Returns the targets left out.
 */
export async function publishRelease(
  api: GitHub,
  id: number,
  version: Version,
  log: (line: string) => void,
): Promise<ReleaseTarget[]> {
  const release = await getRelease(api, id)
  if (!release.draft) throw new Error('Release has been already published!')
  if (release.tag_name !== version.text) {
    throw new Error(
      `Release ${id} is ${release.tag_name}, not ${version.text}: check the release id and version.`,
    )
  }
  const partial = release.assets.filter((asset) => asset.state !== 'uploaded')
  if (partial.length > 0) {
    const names = partial.map((asset) => `${asset.name} (${asset.state})`).join(', ')
    throw new Error(`Not publishing: assets not fully uploaded: ${names}. Re-run their uploads.`)
  }
  const { present, missing } = splitUploaded(
    version.text,
    release.assets.map((asset) => asset.name),
  )
  let body = release.body ?? ''
  if (missing.length > 0) {
    log(`::warning::Publishing without installers for: ${missing.map((t) => t.pretty).join(', ')}.`)
    body += missingInstallersNote(missing)
  }
  await api.json('PATCH', `/repos/${api.repository}/releases/${id}`, {
    tag_name: release.tag_name,
    target_commitish: release.target_commitish,
    body,
    draft: false,
  })
  log(`Published ${release.tag_name}: ${release.html_url}`)
  await validateRelease(api, id, present)
  return missing
}

/**
 * Checks that release `id` is published and that each of `installers` downloads. Run only after
 * publishing: a draft's download URLs do not work. A failure is reported, but the release stays
 * published, as before.
 */
export async function validateRelease(
  api: GitHub,
  id: number,
  installers: readonly ReleaseTarget[],
): Promise<void> {
  const release = await getRelease(api, id)
  if (release.draft) throw new Error(`Release ${id} is not published.`)
  for (const target of installers) {
    const url = downloadUrl(
      api.repository,
      release.tag_name,
      installerName(target, release.tag_name),
    )
    const status = await api.status(url)
    if (status < 200 || status >= 300) {
      throw new Error(`Failed to download asset: ${url} (${status}).`)
    }
  }
}

/** Waits `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Deletes release `id`'s asset `name`, if it has one. */
async function deleteAssetNamed(api: GitHub, id: number, name: string): Promise<void> {
  const stale = (await getRelease(api, id)).assets.find((asset) => asset.name === name)
  if (stale != null) {
    await api.json('DELETE', `/repos/${api.repository}/releases/assets/${stale.id}`)
  }
}

/**
 * After a failed upload of `name`: the asset it left on release `id`, `null` when it left none, or
 * `undefined` when the release could not be read (a transient API error). That error is only
 * logged: it must not replace the upload's error or end its retries.
 */
async function leftoverAsset(
  api: GitHub,
  id: number,
  name: string,
  log: (line: string) => void,
): Promise<ReleaseAsset | null | undefined> {
  try {
    return (await getRelease(api, id)).assets.find((asset) => asset.name === name) ?? null
  } catch (lookupError) {
    log(`Could not check release ${id} for a partial ${name} (${String(lookupError)}).`)
    return undefined
  }
}

/**
 * Uploads `files` to release `id`, each retried as the retired build CLI retried it (five more
 * times, 0.5 s growing by half).
 *
 * - On a draft, an asset of the same name is replaced: one left by an earlier run of the job
 *   before the upload, and the half-written one a failed attempt leaves before each retry and
 *   after the last (GitHub refuses a second asset of a name).
 * - On a published release (re-running a skipped platform's jobs adds its installer, as with the
 *   retired build CLI), nothing is ever deleted or replaced: an asset of any of the names, fully
 *   uploaded or not, stops the upload before its first file, so the release is never half-updated;
 *   one a failed attempt left stops it with an error.
 *
 * A failure to read the release after a failed attempt is logged and the retries go on; when the
 * last attempt fails, its upload error is the final error (as the `cause` when the release could
 * not be checked for its partial asset).
 */
export async function uploadIdeAssets(
  api: GitHub,
  id: number,
  files: readonly UploadFile[],
  log: (line: string) => void,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  const release = await getRelease(api, id)
  const tag = release.tag_name
  const delays = retryDelays(5)
  const named = (name: string) => release.assets.filter((asset) => asset.name === name)
  if (!release.draft) {
    const collisions = files.flatMap(({ name }) => named(name))
    if (collisions.length > 0) {
      const names = collisions
        .map((asset) =>
          asset.state === 'uploaded' ? asset.name : `${asset.name} (${asset.state})`,
        )
        .join(', ')
      const [them, they] = collisions.length === 1 ? ['the asset', 'it'] : ['the assets', 'they']
      throw new Error(
        `Release ${tag} is published and already has ${names}; a published release's assets ` +
          `are never replaced. Delete ${them} by hand first if ${they} must change.`,
      )
    }
  }
  for (const { file, name } of files) {
    if (named(name).length > 0) {
      log(`Replacing ${name}, left on the draft by an earlier run.`)
      await deleteAssetNamed(api, id, name)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        log(`Uploading ${name}.`)
        await api.upload(id, name, file, contentType(name))
        break
      } catch (error) {
        const leftover = await leftoverAsset(api, id, name, log)
        if (leftover != null && !release.draft) {
          throw new Error(
            `Uploading ${name} to the published release ${tag} failed and left a partial ` +
              `asset, which is never deleted automatically; delete it by hand and re-run. ` +
              `(${String(error)})`,
            { cause: error },
          )
        }
        let unchecked = leftover === undefined
        if (leftover != null) {
          try {
            await api.json('DELETE', `/repos/${api.repository}/releases/assets/${leftover.id}`)
          } catch (deleteError) {
            log(`Could not delete the partial ${name} (${String(deleteError)}).`)
            unchecked = true
          }
        }
        const delay = delays[attempt]
        if (delay == null) {
          if (!unchecked) throw error
          throw new Error(
            `Uploading ${name} to release ${tag} failed (${String(error)}), and a partial asset ` +
              'it may have left could not be checked or deleted; check the release by hand.',
            { cause: error },
          )
        }
        log(`Uploading ${name} failed (${String(error)}); retrying in ${delay} ms.`)
        await wait(delay)
      }
    }
  }
}
