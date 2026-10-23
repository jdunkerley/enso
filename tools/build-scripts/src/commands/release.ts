/**
 * @file `release <action>`: the release workflow's steps, as `./run release …` and `./run ide
 * upload` ran them. Every action talks to GitHub with `GITHUB_TOKEN`, about `GITHUB_REPOSITORY`.
 *
 * - `create-draft` — drafts release `ENSO_VERSION` at `GITHUB_SHA`, with the notes from
 *   `CHANGELOG.md`; publishes `ENSO_RELEASE_ID` and the version triple.
 * - `upload-ide` — uploads this platform's installer, its `.sha256` and the update files from
 *   `dist/ide` to the draft `ENSO_RELEASE_ID`.
 * - `publish` — publishes the draft `ENSO_RELEASE_ID`, noting missing installers, and checks the
 *   installers download.
 * - `promote <stable|patch|rc|nightly>` — the next version of that kind after `origin`'s tags;
 *   publishes the version triple. Needs no token.
 * - `update-latest-version` — records a stable `ENSO_VERSION` as `latest-release` in
 *   `build-config.yaml`; publishes `ENSO_LATEST_RELEASE_UPDATED`. Needs no token.
 *
 *     corepack pnpm --filter build-scripts run release create-draft
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { targetOs } from '../ide-build/ideBuild.ts'
import { publish } from '../lib/github.ts'
import { gitHubFromEnv } from '../lib/githubApi.ts'
import { capture, commandArguments, REPO_ROOT } from '../lib/repo.ts'
import { ideUploadFiles } from '../release/assets.ts'
import { withLatestRelease } from '../release/latestRelease.ts'
import {
  createDraft,
  isPrerelease,
  parseDesignation,
  publishRelease,
  releaseId,
  releaseVersion,
  uploadIdeAssets,
} from '../release/release.ts'
import {
  generateVersion,
  isReleaseMode,
  parseLsRemoteTags,
  todayUtc,
  type Version,
} from '../version/version.ts'

const USAGE =
  'Usage: release create-draft | upload-ide | publish | promote <stable|patch|rc|nightly> | update-latest-version'

/** The version triple, under the names `./run` published. */
function versionValues(version: Version): Record<string, string> {
  return {
    ENSO_VERSION: version.text,
    ENSO_EDITION: version.text,
    ENSO_RELEASE_MODE: String(isReleaseMode(version)),
  }
}

/** The checkout's `HEAD`, or `null` when this is not a git checkout. */
function head(): string | null {
  const result = capture('git', ['rev-parse', '--verify', 'HEAD'])
  return result.status === 0 ? result.stdout.trim() : null
}

/** `origin`'s tags as versions. */
function remoteReleases(): Version[] {
  const result = capture('git', ['ls-remote', '--tags', 'origin'])
  if (result.status !== 0) {
    throw new Error(`\`git ls-remote --tags origin\` failed: ${result.stderr.trim()}`)
  }
  return parseLsRemoteTags(result.stdout)
}

const log = (line: string) => console.log(line)

try {
  const [action, ...rest] = commandArguments()
  const env = process.env
  switch (action) {
    case 'create-draft': {
      const version = releaseVersion(env)
      const commit = env.GITHUB_SHA ?? ''
      if (commit === '') throw new Error('GITHUB_SHA is not set.')
      const draft = await createDraft(gitHubFromEnv(env), {
        version,
        commit,
        head: head(),
        changelog: readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'),
        log,
      })
      publish({ ...versionValues(version), ENSO_RELEASE_ID: String(draft.id) })
      break
    }
    case 'upload-ide': {
      const version = releaseVersion(env)
      const files = ideUploadFiles(
        targetOs(process.platform),
        version.text,
        path.join(REPO_ROOT, 'dist', 'ide'),
        existsSync,
      )
      await uploadIdeAssets(gitHubFromEnv(env), releaseId(env), files, log)
      break
    }
    case 'publish': {
      await publishRelease(gitHubFromEnv(env), releaseId(env), releaseVersion(env), log)
      break
    }
    case 'promote': {
      if (rest.length !== 1) throw new Error(USAGE)
      const designation = parseDesignation(rest[0])
      const version = generateVersion(designation, remoteReleases(), todayUtc(new Date()))
      // On stderr, so that locally `eval "$(… release promote rc)"` reads only the exports.
      console.error(`Promoting ${designation}: ${version.text}`)
      publish(versionValues(version))
      break
    }
    case 'update-latest-version': {
      const version = releaseVersion(env)
      const file = path.join(REPO_ROOT, 'build-config.yaml')
      let updated = false
      if (isPrerelease(version)) {
        log(`${version.text} is a prerelease; leaving the latest-release entry untouched.`)
      } else {
        const old = readFileSync(file, 'utf8')
        const next = withLatestRelease(old, version.text)
        updated = next !== old
        if (updated) {
          writeFileSync(file, next)
          log(`Recorded ${version.text} as the latest release in ${file}.`)
        } else {
          log(`${file} already records ${version.text} as the latest release.`)
        }
      }
      publish({ ENSO_LATEST_RELEASE_UPDATED: String(updated) })
      break
    }
    default:
      throw new Error(USAGE)
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
